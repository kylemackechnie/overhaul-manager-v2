import { useAppStore } from '../../store/appStore'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useState, useEffect, useCallback } from 'react'
import { GlobalSearch } from '../GlobalSearch'
import { usePermissions } from '../../lib/permissions'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import type { Module } from '../../lib/permissions'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface RibbonButton {
  icon: string
  label: string
  panel: string
}

interface RibbonGroup {
  label: string
  buttons: RibbonButton[]
}

interface RibbonTab {
  key: string
  label: string
  groups: RibbonGroup[]
  module?: Module   // permission module — undefined means always visible
  pinned?: boolean  // pinned tabs cannot be hidden by the user
}

// Maps ribbon tab key → permission module. Tabs without a module are always shown.
// Project tab is pinned — always visible regardless of user preferences.
const RIBBON_MODULES: RibbonTab[] = [
  {
    key: 'project', label: 'Project', pinned: true,  // always visible
    groups: [
      { label: 'Overview', buttons: [
        { icon: '📊', label: 'Dashboard', panel: 'dashboard' },
        { icon: '❓', label: 'Help', panel: 'help' },
        { icon: '📅', label: 'Calendar', panel: 'calendar' },
        { icon: '📋', label: 'Gantt', panel: 'gantt' },
        { icon: '📝', label: 'Variations', panel: 'variations' },
      ]},
      { label: 'Setup', buttons: [
        { icon: '⚙️', label: 'Settings', panel: 'project-settings' },
        { icon: '🗓️', label: 'Holidays', panel: 'public-holidays' },
        { icon: '📍', label: 'WBS', panel: 'wbs-list' },
      ]},
    ],
  },
  {
    key: 'cost', label: 'Cost Tracking', module: 'cost_tracking',
    groups: [
      { label: 'Tracking', buttons: [
        { icon: '💰', label: 'Dashboard', panel: 'cost-dashboard' },
        { icon: '📈', label: 'Forecast', panel: 'cost-forecast' },
        { icon: '📉', label: 'S-Curve', panel: 'cost-scurve' },
        { icon: '📊', label: 'MIKA', panel: 'cost-mika' },
      ]},
      { label: 'Records', buttons: [
        { icon: '🧾', label: 'Expenses', panel: 'expenses' },
        { icon: '📄', label: 'Purchase Orders', panel: 'purchase-orders' },
        { icon: '💳', label: 'Invoices', panel: 'invoices' },
        { icon: '🔄', label: 'SAP Recon', panel: 'sap-recon' },
      ]},
      { label: 'Reports', buttons: [
        { icon: '📑', label: 'Cost Report', panel: 'cost-report' },
        { icon: '👤', label: 'Customer Report', panel: 'cost-customer-report' },
        { icon: '📝', label: 'Pre-Planning', panel: 'pre-planning-report' },
        { icon: '📦', label: 'Reports DB', panel: 'reports-db' },
      ]},
    ],
  },
  {
    key: 'personnel', label: 'Personnel', module: 'personnel',
    groups: [
      { label: 'People', buttons: [
        { icon: '👥', label: 'Dashboard', panel: 'hr-dashboard' },
        { icon: '👤', label: 'Resources', panel: 'hr-resources' },
        { icon: '💲', label: 'Rate Cards', panel: 'hr-ratecards' },
      ]},
      { label: 'Timesheets', buttons: [
        { icon: '⏱️', label: 'Trades', panel: 'hr-timesheets-trades' },
        { icon: '⏱️', label: 'Management', panel: 'hr-timesheets-mgmt' },
        { icon: '⏱️', label: 'SE AG', panel: 'hr-timesheets-seag' },
        { icon: '⏱️', label: 'Subcon', panel: 'hr-timesheets-subcon' },
        { icon: '🏢', label: 'Back Office', panel: 'hr-backoffice' },
        { icon: '📊', label: 'Utilisation', panel: 'hr-utilisation' },
      ]},
      { label: 'Accommodation', buttons: [
        { icon: '🚗', label: 'Cars', panel: 'hr-cars' },
        { icon: '🏨', label: 'Accommodation', panel: 'hr-accommodation' },
      ]},
    ],
  },
  {
    key: 'hse', label: 'HSE', module: 'hse',
    groups: [
      { label: 'HSE', buttons: [
        { icon: '🦺', label: 'Dashboard', panel: 'hse-dashboard' },
        { icon: '📋', label: 'Inductions', panel: 'hr-inductions' },
        { icon: '⏱️', label: 'HSE Hours', panel: 'hse-hours' },
        { icon: '🌿', label: 'CO₂ Tracking', panel: 'hse-co2' },
      ]},
    ],
  },
  {
    key: 'subcon', label: 'Subcontractors', module: 'subcontractors',
    groups: [
      { label: 'Overview', buttons: [
        { icon: '🏢', label: 'Dashboard', panel: 'subcon-dashboard' },
      ]},
      { label: 'RFQs', buttons: [
        { icon: '📝', label: 'RFQ Document', panel: 'subcon-rfq-doc' },
        { icon: '📊', label: 'RFQ Register', panel: 'subcon-rfq-register' },
        { icon: '📈', label: 'Cost Model', panel: 'subcon-rfq' },
      ]},
      { label: 'Vendors', buttons: [
        { icon: '📊', label: 'Vendor Snapshot', panel: 'subcon-vendor-snapshot' },
      ]},
    ],
  },
  {
    key: 'logistics', label: 'Logistics', module: 'logistics',
    groups: [
      { label: 'Shipping', buttons: [
        { icon: '🚢', label: 'Dashboard', panel: 'shipping-dashboard' },
        { icon: '📥', label: 'Import', panel: 'shipping-import' },
        { icon: '📦', label: 'Inbound', panel: 'shipping-inbound' },
        { icon: '🚚', label: 'Outbound', panel: 'shipping-outbound' },
      ]},
    ],
  },
  {
    key: 'hardware', label: 'Hardware', module: 'hardware' as Module,
    groups: [
      { label: 'Hardware', buttons: [
        { icon: '💰', label: 'Dashboard', panel: 'hardware-dashboard' },
        { icon: '📥', label: 'Import (OPSA)', panel: 'hardware-import' },
        { icon: '📃', label: 'Contract Register', panel: 'hardware-contract' },
        { icon: '📈', label: 'Escalation', panel: 'hardware-escalation' },
        { icon: '🛒', label: 'Carts & Offers', panel: 'hardware-carts' },
        { icon: '📄', label: 'Reports', panel: 'hardware-reports' },
      ]},
      { label: 'Spare Parts', buttons: [
        { icon: '📦', label: 'Parts Dashboard', panel: 'parts-dashboard' },
        { icon: '🔩', label: 'Parts List', panel: 'parts-list' },
        { icon: '📬', label: 'Receiving', panel: 'parts-receiving' },
        { icon: '📋', label: 'Issue Parts', panel: 'parts-issue' },
        { icon: '🗄️', label: 'Inventory', panel: 'parts-inventory' },
        { icon: '📄', label: 'Reports', panel: 'parts-reports' },
      ]},
    ],
  },
  {
    key: 'tooling', label: 'Tooling', module: 'tooling' as Module,
    groups: [
      { label: 'SE AG Tooling', buttons: [
        { icon: '🔩', label: 'Dashboard', panel: 'tooling-dashboard' },
        { icon: '🧰', label: 'TV Register', panel: 'tooling-tvs' },
        { icon: '📦', label: 'Kollos', panel: 'tooling-kollos' },
        { icon: '💶', label: 'Costings', panel: 'tooling-costings' },
        { icon: '🏢', label: 'Departments', panel: 'tooling-departments' },
        { icon: '📄', label: 'Reports', panel: 'tooling-reports' },
        { icon: '🗺️', label: 'Tour View', panel: 'tooling-tour' },
      ]},
      { label: 'Equipment Hire', buttons: [
        { icon: '📊', label: 'Dashboard', panel: 'hire-dashboard' },
        { icon: '🚜', label: 'Dry Hire', panel: 'hire-dry' },
        { icon: '🏗️', label: 'Wet Hire', panel: 'hire-wet' },
        { icon: '🧰', label: 'Local Hire', panel: 'hire-local' },
        { icon: '📄', label: 'Hire Reports', panel: 'hire-reports' },
      ]},
    ],
  },
  {
    key: 'site', label: 'Site Specific', module: 'site_specific' as Module,
    groups: [
      { label: 'Overview', buttons: [
        { icon: '🏭', label: 'Site Dashboard', panel: 'site-dashboard' },
      ]},
      { label: 'Work Orders', buttons: [
        { icon: '📊', label: 'WO Dashboard', panel: 'wo-dashboard' },
        { icon: '⏱', label: 'WO Actuals', panel: 'wo-actuals' },
        { icon: '📋', label: 'Work Orders', panel: 'work-orders' },
        { icon: '📊', label: 'WO Progress', panel: 'wo-progress' },
      ]},
      { label: 'NRG Gladstone', buttons: [
        { icon: '📊', label: 'NRG Dashboard', panel: 'nrg-dashboard' },
        { icon: '📋', label: 'TCE Register', panel: 'nrg-tce' },
        { icon: '📈', label: 'OHF Forecast', panel: 'nrg-ohf' },
        { icon: '📊', label: 'Actuals', panel: 'nrg-actuals' },
        { icon: '🧾', label: 'Invoicing', panel: 'nrg-invoicing' },
        { icon: '🏆', label: 'KPI Model', panel: 'nrg-kpi' },
      ]},
    ],
  },
  {
    key: 'global', label: 'Global', module: 'global' as Module,
    groups: [
      { label: 'Global Registers', buttons: [
        { icon: '🧰', label: 'Tooling', panel: 'global-tooling' },
        { icon: '🔩', label: 'Parts Register', panel: 'global-parts' },
        { icon: '🔍', label: 'Parts Search', panel: 'parts-search' },
        { icon: '📦', label: 'Kits', panel: 'global-kits' },
      ]},
    ],
  },
]

// ── Sortable tab pill (used in the picker modal) ──────────────────────────────
function SortableTabPill({ id, label, hidden, onToggle }: {
  id: string; label: string; hidden: boolean; onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
      display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px',
      background: hidden ? 'var(--bg3)' : 'rgba(99,102,241,0.1)',
      border: `1px solid ${hidden ? 'var(--border)' : 'var(--accent)'}`,
    }}>
      <span {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text3)', fontSize: '14px', lineHeight: 1 }}>⠿</span>
      <span style={{ flex: 1, fontSize: '13px', fontWeight: hidden ? 400 : 600, color: hidden ? 'var(--text3)' : 'var(--text)' }}>{label}</span>
      <button onClick={onToggle} style={{ border: 'none', cursor: 'pointer', fontSize: '11px',
        color: hidden ? 'var(--text3)' : 'var(--accent)', fontWeight: 600, padding: '2px 6px',
        borderRadius: '4px', background: hidden ? 'var(--bg2)' : 'rgba(99,102,241,0.15)' }}>
        {hidden ? 'Show' : 'Hide'}
      </button>
    </div>
  )
}

export function Ribbon() {
  const { activePanel, setActivePanel, activeRibbonTab, setActiveRibbonTab, activeProject } = useAppStore()
  const { signOut, currentUser } = useAuth()
  const { canRead } = usePermissions()
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [counts, setCounts] = useState<Record<string,number>>({})

  const { prefs, setPref } = useUserPrefs()
  const [showTabPicker, setShowTabPicker] = useState(false)

  // ── Tab personalisation ────────────────────────────────────────────────────
  // Merge saved prefs with current RIBBON_MODULES registry.
  // New tabs added to the registry appear at the end, visible by default.
  // Tabs the user has no permission to see are always excluded (permission > pref).
  // Pinned tabs (project) can be hidden in prefs but are always shown.
  type TabPref = { key: string; hidden: boolean; order: number }
  const savedTabPrefs = (prefs.ribbon_tabs ?? []) as TabPref[]

  const mergedTabOrder = useCallback((): TabPref[] => {
    const knownKeys = new Set(RIBBON_MODULES.map(t => t.key))
    const maxOrder = savedTabPrefs.reduce((m, t) => Math.max(m, t.order), -1)
    const merged = savedTabPrefs.filter(t => knownKeys.has(t.key))
    const savedKeys = new Set(savedTabPrefs.map(t => t.key))
    let next = maxOrder + 1
    for (const tab of RIBBON_MODULES) {
      if (!savedKeys.has(tab.key)) merged.push({ key: tab.key, hidden: false, order: next++ })
    }
    return merged.sort((a, b) => a.order - b.order)
  }, [savedTabPrefs])

  const tabOrder = mergedTabOrder()

  // Apply: permission filter first, then user personalisation
  // Pinned tabs always shown regardless of hidden pref
  const permittedTabs = RIBBON_MODULES.filter(t => !t.module || canRead(t.module))
  const permittedKeys = new Set(permittedTabs.map(t => t.key))

  const orderedTabs = tabOrder
    .filter(tp => permittedKeys.has(tp.key))
    .map(tp => ({ ...tp, tab: RIBBON_MODULES.find(t => t.key === tp.key)! }))

  // visibleTabs: shown in ribbon row (not hidden, or pinned)
  const visibleTabs = orderedTabs
    .filter(({ hidden, tab }) => !hidden || tab.pinned)
    .map(({ tab }) => tab)

  // hiddenPermittedTabs: for the "…More" overflow
  const hiddenPermittedTabs = orderedTabs
    .filter(({ hidden, tab }) => hidden && !tab.pinned)
    .map(({ tab }) => tab)

  function saveTabPrefs(next: TabPref[]) {
    setPref('ribbon_tabs', next)
  }

  function toggleTabHidden(key: string) {
    const current = tabOrder.map(t =>
      t.key === key ? { ...t, hidden: !t.hidden } : t
    )
    saveTabPrefs(current)
  }

  function handleTabDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = tabOrder.findIndex(t => t.key === active.id)
    const newIdx = tabOrder.findIndex(t => t.key === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(tabOrder, oldIdx, newIdx).map((t, i) => ({ ...t, order: i }))
    saveTabPrefs(reordered)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    if (!activeProject) return
    const pid = activeProject.id
    Promise.all([
      supabase.from('resources').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['hr-resources',r.count||0]),
      supabase.from('weekly_timesheets').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['hr-timesheets-trades',r.count||0]),
      supabase.from('purchase_orders').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['purchase-orders',r.count||0]),
      supabase.from('invoices').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['invoices',r.count||0]),
      supabase.from('variations').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['variations',r.count||0]),
      supabase.from('work_orders').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['work-orders',r.count||0]),
      supabase.from('wosit_lines').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['parts-list',r.count||0]),
      supabase.from('wosit_lines').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['parts-dashboard',r.count||0]),
      supabase.from('hire_items').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['hire-dashboard',r.count||0]),
      supabase.from('hire_items').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['hire-dry',r.count||0]),
      supabase.from('nrg_tce_lines').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['nrg-tce',r.count||0]),
      supabase.from('shipments').select('id',{count:'exact',head:true}).eq('project_id',pid).then(r=>['shipping-inbound',r.count||0]),
    ]).then(results => {
      const c: Record<string,number> = {}
      results.forEach(([panel, count]) => { c[panel as string] = count as number })
      setCounts(c)
    })
  }, [activeProject?.id])

  if (!activeProject) return null

  const activeTab = RIBBON_MODULES.find(t => t.key === activeRibbonTab) ?? visibleTabs[0]

  return (
    <div style={{
      background: 'var(--bg)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)'
      }}>
        {/* File button */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--purple)', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={() => setFileMenuOpen(o => !o)}
          >
            ☰ File
          </button>
          {fileMenuOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                onClick={() => setFileMenuOpen(false)}
              />
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: '8px', boxShadow: 'var(--shadow-md)',
                minWidth: '200px', zIndex: 200, overflow: 'hidden'
              }}>
                {[
                  { icon: '👥', label: 'User Management', panel: 'user-management' },
                  { icon: '🌐', label: 'Global Rate Defaults', panel: 'rate-defaults' },
                  { icon: '⚖️', label: 'Payroll Rules', panel: 'payroll-rules' },
                  { icon: '📋', label: 'Audit Trail', panel: 'audit-trail' },
                  { icon: '📑', label: 'Reports Database', panel: 'reports-db' },
                  { icon: '🔄', label: 'Data Migration', panel: 'migration' },
                ].map(item => (
                  <button
                    key={item.panel}
                    className="btn"
                    style={{ width: '100%', borderRadius: 0, border: 'none', justifyContent: 'flex-start', borderBottom: '1px solid var(--border)' }}
                    onClick={() => { setActivePanel(item.panel); setFileMenuOpen(false) }}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
                <button
                  className="btn"
                  style={{ width: '100%', borderRadius: 0, border: 'none', justifyContent: 'flex-start', color: 'var(--red)' }}
                  onClick={() => { signOut(); setFileMenuOpen(false) }}
                >
                  🚪 Sign Out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Project name */}
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: '13px', fontWeight: 600, color: 'var(--text)'
        }}>
          <span style={{
            background: 'var(--accent)', color: '#fff', padding: '2px 8px',
            borderRadius: '4px', fontSize: '11px'
          }}>
            {activeProject.name}
          </span>
        </div>

        {/* Global Search */}
        <GlobalSearch />

        {/* User */}
        <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
          👤 {currentUser?.name || currentUser?.email}
        </div>
      </div>

      {/* Tab row */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '2px',
        padding: '4px 12px 0', background: 'var(--bg2)'
      }}>
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveRibbonTab(tab.key)
              const firstGroup = tab.groups[0]
              const firstBtn = firstGroup?.buttons[0]
              if (firstBtn) setActivePanel(firstBtn.panel)
            }}
            style={{
              padding: '5px 12px',
              background: activeRibbonTab === tab.key ? 'var(--bg)' : 'transparent',
              border: '1px solid transparent',
              borderBottom: activeRibbonTab === tab.key ? '1px solid var(--bg)' : '1px solid transparent',
              borderTop: activeRibbonTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: '4px 4px 0 0',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: activeRibbonTab === tab.key ? 600 : 400,
              color: activeRibbonTab === tab.key ? 'var(--accent)' : 'var(--text2)',
              transition: 'all 150ms',
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </button>
        ))}

        {/* …More — shows hidden permitted tabs */}
        {hiddenPermittedTabs.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMoreOpen(o => !o)}
              style={{
                padding: '5px 10px', background: 'transparent', border: '1px solid transparent',
                borderRadius: '4px 4px 0 0', cursor: 'pointer', fontSize: '12px',
                color: 'var(--text3)', marginBottom: '-1px',
              }}
              title={`${hiddenPermittedTabs.length} hidden tab${hiddenPermittedTabs.length > 1 ? 's' : ''}`}
            >
              ···
            </button>
            {moreOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 200,
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                padding: '4px', minWidth: '160px',
              }} onMouseLeave={() => setMoreOpen(false)}>
                {hiddenPermittedTabs.map(tab => (
                  <button key={tab.key} onClick={() => {
                    setActiveRibbonTab(tab.key)
                    const firstBtn = tab.groups[0]?.buttons[0]
                    if (firstBtn) setActivePanel(firstBtn.panel)
                    setMoreOpen(false)
                  }} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px', background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: '12px', color: 'var(--text2)',
                    borderRadius: '4px',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ⚙ Tab customiser */}
        <button
          onClick={() => setShowTabPicker(true)}
          style={{
            marginLeft: 'auto', padding: '4px 8px', background: 'transparent',
            border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--text3)',
            borderRadius: '4px', marginBottom: '2px', lineHeight: 1,
          }}
          title="Customise tabs"
        >⚙</button>
      </div>

      {/* Ribbon strip */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0',
        padding: '6px 12px', borderTop: '1px solid var(--border)',
        minHeight: '52px', alignItems: 'flex-start',
      }}>
        {activeTab.groups.map((group, gi) => (
          <div key={gi} style={{ display: 'flex', alignItems: 'flex-start', gap: '2px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                {group.buttons.map(btn => (
                  <button
                    key={btn.panel}
                    onClick={() => setActivePanel(btn.panel)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: '2px', padding: '4px 8px',
                      background: activePanel === btn.panel ? 'var(--accent)' : 'transparent',
                      border: '1px solid transparent',
                      borderRadius: '6px', cursor: 'pointer',
                      color: activePanel === btn.panel ? '#fff' : 'var(--text)',
                      transition: 'all 150ms',
                      minWidth: '52px',
                    }}
                    onMouseEnter={e => {
                      if (activePanel !== btn.panel) {
                        (e.currentTarget as HTMLElement).style.background = 'var(--bg3)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (activePanel !== btn.panel) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                      }
                    }}
                  >
                    <span style={{ fontSize: '16px', position: 'relative', display: 'inline-block' }}>
                      {btn.icon}
                      {(counts[btn.panel]||0) > 0 && (
                        <span style={{ position: 'absolute', top: '-5px', right: '-8px', background: 'var(--accent)', color: '#fff', borderRadius: '8px', fontSize: '8px', padding: '0 4px', fontFamily: 'var(--mono)', fontWeight: 700, minWidth: '14px', textAlign: 'center', lineHeight: '14px', display: 'block' }}>
                          {counts[btn.panel] > 99 ? '99+' : counts[btn.panel]}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{btn.label}</span>
                  </button>
                ))}
              </div>
              <span style={{
                fontSize: '10px', color: 'var(--text3)', borderTop: '1px solid var(--border)',
                paddingTop: '2px', width: '100%', textAlign: 'center',
              }}>
                {group.label}
              </span>
            </div>
            {gi < activeTab.groups.length - 1 && (
              <div style={{ width: '1px', background: 'var(--border)', margin: '4px 6px', alignSelf: 'stretch' }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Tab picker modal ─────────────────────────────────────────────────── */}
      {showTabPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }}
          onClick={() => setShowTabPicker(false)}>
          <div style={{ background: 'var(--bg2)', borderRadius: '12px', width: '420px', maxWidth: '95vw',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0,0,0,0.35)', border: '1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>Customise Tabs</div>
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                  Drag to reorder · toggle to show/hide · hidden tabs accessible via ···
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-sm" onClick={() => { saveTabPrefs([]); }}>Reset</button>
                <button className="btn btn-sm" onClick={() => setShowTabPicker(false)}>Done</button>
              </div>
            </div>

            {/* Sortable list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
                <SortableContext items={tabOrder.map(t => t.key)} strategy={horizontalListSortingStrategy}>
                  {tabOrder
                    .filter(tp => permittedKeys.has(tp.key))
                    .map(tp => {
                      const tab = RIBBON_MODULES.find(t => t.key === tp.key)!
                      return (
                        <SortableTabPill
                          key={tp.key}
                          id={tp.key}
                          label={tab.label}
                          hidden={tp.hidden && !tab.pinned}
                          onToggle={() => tab.pinned ? undefined : toggleTabHidden(tp.key)}
                        />
                      )
                    })}
                </SortableContext>
              </DndContext>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px', textAlign: 'center' }}>
                📌 Project tab is always visible · hidden tabs remain accessible via ···
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
