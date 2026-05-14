/**
 * MasonryGrid
 *
 * Column-packed dashboard layout. Each tile has a width in column units
 * (sm/md=1, lg=2, xl=3, full=all) and a measured height. Tiles flow into the
 * shortest column run that fits their width, filling holes automatically.
 *
 * Drag-and-drop is delegated to @dnd-kit/sortable via MasonryTile (below).
 * dnd-kit sees the linear ordered array; reordering is array reordering. The
 * masonry layer just decides where each tile sits in 2D space.
 *
 * Why not CSS column-count?
 *   - Doesn't support multi-column-spanning tiles
 *   - Hit-testing for drag becomes ambiguous (columns aren't real DOM)
 *
 * Why not CSS Grid with grid-auto-flow: dense?
 *   - It fills column gaps within a row, but every row still has a single
 *     height (= tallest item), which is what causes the visible stretching
 *     of small tiles. True masonry needs per-column flow.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TileSize } from '../../types/dashboard'

const GAP = 12
const ASSUMED_HEIGHT = 180 // before measure

export interface MasonryItem {
  id: string
  size: TileSize
  /** Rendered into the tile body. Receives editMode so it can show controls. */
  render: (editMode: boolean) => ReactNode
}

interface Props {
  items: MasonryItem[]
  columns: number
  editMode: boolean
  /** Minimum column width before we shrink from `columns` count */
  minColWidth?: number
}

function colSpanFor(size: TileSize, totalCols: number): number {
  if (size === 'full') return totalCols
  if (size === 'xl') return Math.min(3, totalCols)
  if (size === 'lg') return Math.min(2, totalCols)
  return 1
}

export function MasonryGrid({ items, columns, editMode, minColWidth = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [heights, setHeights] = useState<Record<string, number>>({})

  // Stable callback for tile children to report measured height
  const reportHeight = useCallback((id: string, h: number) => {
    setHeights(prev => {
      const cur = prev[id]
      if (cur != null && Math.abs(cur - h) < 0.5) return prev
      return { ...prev, [id]: h }
    })
  }, [])

  // Track container width (responsive)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sync = () => setContainerWidth(el.clientWidth)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Pack ─────────────────────────────────────────────────────────────────
  const effectiveCols = Math.max(
    1,
    Math.min(columns, Math.max(1, Math.floor((containerWidth + GAP) / (minColWidth + GAP)))),
  )
  const colWidth = effectiveCols > 0
    ? (containerWidth - GAP * (effectiveCols - 1)) / effectiveCols
    : 0

  const colBaselines = new Array(effectiveCols).fill(0) as number[]
  const placements: Record<string, { x: number; y: number; w: number }> = {}

  for (const item of items) {
    const span = colSpanFor(item.size, effectiveCols)
    if (span <= 0 || effectiveCols <= 0) continue

    // Find best start column: minimise the max baseline within the run
    let bestStart = 0
    let bestMax = Infinity
    for (let start = 0; start + span <= effectiveCols; start++) {
      let m = -Infinity
      for (let c = start; c < start + span; c++) {
        if (colBaselines[c] > m) m = colBaselines[c]
      }
      if (m < bestMax) {
        bestMax = m
        bestStart = start
      }
    }

    const x = bestStart * (colWidth + GAP)
    const y = bestMax
    const w = colWidth * span + GAP * (span - 1)
    const h = heights[item.id] ?? ASSUMED_HEIGHT
    placements[item.id] = { x, y, w }

    const newBaseline = y + h + GAP
    for (let c = bestStart; c < bestStart + span; c++) {
      colBaselines[c] = newBaseline
    }
  }

  const totalHeight = colBaselines.length > 0 ? Math.max(...colBaselines) - GAP : 0
  const measuredAll = items.every(i => heights[i.id] != null) || containerWidth === 0

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: containerWidth > 0 ? Math.max(0, totalHeight) : 'auto',
        minHeight: items.length > 0 ? 200 : 0,
        // Soften the layout shift between first measurement and stabilisation
        transition: measuredAll ? 'height 0.18s ease' : 'none',
      }}
    >
      {items.map(item => {
        const p = placements[item.id]
        const ready = containerWidth > 0 && p != null
        return (
          <MasonryTile
            key={item.id}
            id={item.id}
            x={ready ? p.x : 0}
            y={ready ? p.y : 0}
            width={ready ? p.w : containerWidth || 0}
            ready={ready}
            editMode={editMode}
            onMeasure={reportHeight}
          >
            {item.render(editMode)}
          </MasonryTile>
        )
      })}
    </div>
  )
}

// ─── MasonryTile — sortable + measured ──────────────────────────────────────

interface TileProps {
  id: string
  x: number
  y: number
  width: number
  ready: boolean
  editMode: boolean
  onMeasure: (id: string, h: number) => void
  children: ReactNode
}

function MasonryTile({ id, x, y, width, ready, editMode, onMeasure, children }: TileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const innerRef = useRef<HTMLDivElement>(null)

  // Measure the inner content's natural height and report up
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      onMeasure(id, el.offsetHeight)
    })
    ro.observe(el)
    onMeasure(id, el.offsetHeight)
    return () => ro.disconnect()
  }, [id, onMeasure])

  // When the user is dragging this tile, let dnd-kit drive motion via
  // `transform`. Otherwise our own absolute-position transitions handle the
  // shuffle animation. Two motion sources can't compete on the same element.
  const motionStyle = isDragging
    ? { transform: CSS.Transform.toString(transform), transition: 'none' }
    : { transform: 'none', transition: transition || 'left 0.22s ease, top 0.22s ease, width 0.22s ease, opacity 0.15s ease' }

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        opacity: ready ? (isDragging ? 0.85 : 1) : 0,
        zIndex: isDragging ? 100 : 1,
        // In edit mode, the whole tile is grabbable. Otherwise normal cursor.
        cursor: editMode ? (isDragging ? 'grabbing' : 'grab') : undefined,
        // Visual elevation while dragging
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.18)' : 'none',
        borderRadius: 6,
        ...motionStyle,
      }}
      // Apply both attributes (accessibility) and listeners (pointer handlers)
      // to the whole tile only when in edit mode. Outside edit mode, the tile
      // is just a regular interactive surface so clicks bubble to its inner
      // onClick handlers (open panel etc).
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      <div ref={innerRef} style={{ position: 'relative', pointerEvents: editMode ? 'none' : 'auto' }}>
        {/* Drag-handle pip — visual only when in edit mode */}
        {editMode && (
          <div
            style={{
              position: 'absolute', top: 6, left: 6, zIndex: 10,
              background: 'rgba(0,0,0,0.55)', borderRadius: '4px', padding: '3px 6px',
              fontSize: '13px', color: '#fff', userSelect: 'none', lineHeight: 1,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            ⠿
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
