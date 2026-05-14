/**
 * CustomisableDashboard
 *
 * Generic dashboard frame used by all 12+ dashboards.
 * Owns: edit mode, widget picker, DnD reorder, layout persistence, error boundaries, refresh.
 *
 * Each dashboard passes its own registry + tile components.
 * Tiles fetch their own data via React Query — no shared data load.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../../store/appStore'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import { usePermissions } from '../../lib/permissions'
import { getDefaultLayout, mergeLayout, filterRegistry, DASHBOARD_LAYOUT_VERSIONS } from '../../lib/dashboardLayout'
import { fmt as fmtCurrency } from '../../lib/currency'
import { MasonryGrid } from './MasonryGrid'
import type { MasonryItem } from './MasonryGrid'
import { DashboardToolbar } from './DashboardToolbar'
import { TileErrorBoundary } from './TileErrorBoundary'
import { WidgetPicker } from './WidgetPicker'
import type { TileDef, TileLayoutEntry, TileComponent, DashboardContext, TileSize } from '../../types/dashboard'

export interface CustomisableDashboardProps {
  /** Stable key that namespaces this dashboard's layout in UserPrefs */
  dashboardId: string

  /** Full tile registry for this dashboard */
  registry: TileDef[]

  /** Category display order for the widget picker */
  categories: string[]

  /** Map of tileId → TileComponent (def + Component) */
  tileComponents: Record<string, TileComponent>

  /** Optional content above the tile grid (project header, banner, etc.) */
  header?: ReactNode

  /** Optional alert strip between header and grid */
  alerts?: ReactNode

  /** Optional quick-link buttons below the grid */
  quickLinks?: { label: string; panel: string }[]

  /** Number of grid columns (default 4) */
  gridCols?: number

  /** Max content width in px (default 1200) */
  maxWidth?: number
}

export function CustomisableDashboard({
  dashboardId,
  registry,
  categories,
  tileComponents,
  header,
  alerts,
  quickLinks,
  gridCols = 4,
  maxWidth = 99999,
}: CustomisableDashboardProps) {
  const { activeProject, currentUser, setActivePanel } = useAppStore()
  const { prefs, setPref } = useUserPrefs()
  const { canRead, canWrite } = usePermissions()
  const queryClient = useQueryClient()

  const [editMode, setEditMode] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  /** While a drag is in progress, we mutate this local copy of the layout in
   *  real-time so the masonry can reflow. Committed to Supabase on drag end. */
  const [draftLayout, setDraftLayout] = useState<TileLayoutEntry[] | null>(null)

  // Filter registry by permissions + project applicability
  const applicableRegistry = useMemo(
    () => filterRegistry(registry, canRead, canWrite, activeProject as ({ site_id?: string | null; [key: string]: unknown }) | null),
    [registry, canRead, canWrite, activeProject],
  )

  // Layout: merge saved prefs with current registry, respecting version migration.
  const savedLayout = prefs.dashboard_layouts?.[dashboardId] as TileLayoutEntry[] | undefined
  const savedVersion = prefs.dashboard_layout_versions?.[dashboardId] ?? 1
  const currentVersion = DASHBOARD_LAYOUT_VERSIONS[dashboardId] ?? 1
  const persistedLayout: TileLayoutEntry[] = useMemo(() => {
    if (savedLayout?.length) return mergeLayout(savedLayout, applicableRegistry, savedVersion, currentVersion)
    return getDefaultLayout(applicableRegistry)
  }, [savedLayout, applicableRegistry, savedVersion, currentVersion])
  // While dragging we show the local draft. Otherwise the persisted layout.
  const layout = draftLayout ?? persistedLayout

  // After loading, if the version was bumped, persist BOTH the migrated layout
  // AND the new version so subsequent loads don't re-trigger the migration
  // (and therefore don't accidentally hide tiles that were just promoted).
  //
  // CRITICAL: we must save the merged layout, not just bump the version. If we
  // only bump the version, the next render reads savedVersion === currentVersion
  // and rebuilds the layout with isOutdated=false, which hides the new tiles
  // that should be visible.
  useEffect(() => {
    if (savedLayout?.length && savedVersion < currentVersion) {
      const merged = mergeLayout(savedLayout, applicableRegistry, savedVersion, currentVersion)
      setPref('dashboard_layouts', {
        ...(prefs.dashboard_layouts || {}),
        [dashboardId]: merged,
      })
      setPref('dashboard_layout_versions', {
        ...(prefs.dashboard_layout_versions || {}),
        [dashboardId]: currentVersion,
      })
    }
    // We deliberately don't depend on `prefs` to avoid an infinite loop —
    // the only inputs we care about are savedVersion vs currentVersion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId, savedVersion, currentVersion, applicableRegistry])

  const visibleTiles = layout.filter(t => t.visible)

  // Build the context passed to every tile component
  const ctx: DashboardContext = useMemo(() => ({
    projectId: activeProject?.id,
    userId: currentUser?.id ?? '',
    timeWindow: { from: '', to: '', preset: '' },
    fmt: (n: number) => fmtCurrency(n, activeProject ?? null),
    setActivePanel,
  }), [activeProject, currentUser?.id, setActivePanel])

  // ── Layout mutators ─────────────────────────────────────────────────────────
  function saveLayout(next: TileLayoutEntry[]) {
    setPref('dashboard_layouts', {
      ...(prefs.dashboard_layouts || {}),
      [dashboardId]: next,
    })
  }

  function handleDragStart() {
    // Snapshot the current layout into the draft so we can mutate it freely
    setDraftLayout(layout.map(t => ({ ...t })))
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraftLayout(prev => {
      const base = prev ?? layout
      const oldIndex = base.findIndex(t => t.id === active.id)
      const newIndex = base.findIndex(t => t.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(base, oldIndex, newIndex).map((t, i) => ({ ...t, order: i }))
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const finalLayout = draftLayout ?? layout
    setDraftLayout(null)
    if (!over || active.id === over.id) return
    // Persist whatever the draft settled on. We compare to persistedLayout
    // and only write if order actually changed (avoids needless Supabase writes
    // on a tap-without-drag).
    const orderChanged = finalLayout.some((t, i) => persistedLayout[i]?.id !== t.id)
    if (orderChanged) saveLayout(finalLayout)
  }

  function handleDragCancel() {
    setDraftLayout(null)
  }

  function toggleTile(id: string) {
    const next = layout.map(t => (t.id === id ? { ...t, visible: !t.visible } : t))
    saveLayout(next)
  }

  function setTileSize(id: string, size: TileSize) {
    const next = layout.map(t => (t.id === id ? { ...t, size } : t))
    saveLayout(next)
  }

  function resetLayout() {
    saveLayout(getDefaultLayout(applicableRegistry))
    setPref('dashboard_layout_versions', {
      ...(prefs.dashboard_layout_versions || {}),
      [dashboardId]: currentVersion,
    })
    setConfirmReset(false)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  return (
    <div style={{ padding: '24px', maxWidth }}>

      {/* Project header */}
      {header}

      {/* Alerts */}
      {alerts && <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>{alerts}</div>}

      {/* Toolbar */}
      <DashboardToolbar
        editMode={editMode}
        onCustomise={() => setEditMode(true)}
        onAddWidget={() => setShowPicker(true)}
        onReset={() => setConfirmReset(true)}
        onDone={() => setEditMode(false)}
        onRefresh={() => { void queryClient.invalidateQueries() }}
      />

      {/* Tile grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={visibleTiles.map(t => t.id)} strategy={rectSortingStrategy}>
          <MasonryGrid
            columns={gridCols}
            editMode={editMode}
            items={visibleTiles.map<MasonryItem>(tile => ({
              id: tile.id,
              size: tile.size,
              render: (em) => {
                const entry = tileComponents[tile.id]
                if (!entry) return null
                const { Component } = entry
                return (
                  <div
                    style={{
                      position: 'relative',
                      outline: em ? '2px dashed var(--accent)' : 'none',
                      outlineOffset: '2px',
                      borderRadius: '6px',
                    }}
                  >
                    <TileErrorBoundary tileId={tile.id}>
                      <Component ctx={ctx} />
                    </TileErrorBoundary>

                    {/* Edit-mode remove button */}
                    {em && (
                      <button
                        onClick={() => toggleTile(tile.id)}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          background: 'rgba(239,68,68,0.85)', border: 'none',
                          borderRadius: '50%', width: 20, height: 20,
                          cursor: 'pointer', color: '#fff', fontSize: '11px',
                          lineHeight: 1, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', zIndex: 10,
                        }}
                        title="Remove widget"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              },
            }))}
          />
        </SortableContext>
      </DndContext>

      {/* Quick links */}
      {quickLinks && quickLinks.length > 0 && (
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {quickLinks.map(q => (
            <button key={q.panel} className="btn btn-sm" onClick={() => setActivePanel(q.panel)}>
              {q.label}
            </button>
          ))}
        </div>
      )}

      {/* Widget picker modal */}
      {showPicker && (
        <WidgetPicker
          registry={applicableRegistry}
          categories={categories}
          layout={layout}
          onClose={() => setShowPicker(false)}
          onToggle={toggleTile}
          onSizeChange={setTileSize}
        />
      )}

      {/* Reset confirm */}
      {confirmReset && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ padding: '24px', maxWidth: '360px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Reset layout?</div>
            <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>
              This will restore the default tile selection and order. Your customisations will be lost.
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button className="btn btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff' }} onClick={resetLayout}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
