/**
 * useResizableColumns
 *
 * Provides drag-to-resize column widths for <table> elements.
 * Widths persist per-user via useUserPrefs (localStorage + Supabase sync).
 *
 * Two call signatures:
 *
 *   A) Legacy — position-indexed array (backward compat):
 *      useResizableColumns('my-table', [80, 200, 120])
 *
 *   B) ID-keyed — required when column visibility is also used:
 *      useResizableColumns('my-table', [
 *        { id: 'name', default: 140 },
 *        { id: 'role', default: 110 },
 *      ])
 *
 * In both cases widths are stored internally keyed by ID ('col-0', 'col-1'...
 * for legacy, or the supplied id for B). This means adding/removing/reordering
 * columns in the definition doesn't corrupt stored widths for other columns.
 *
 * Usage:
 *   const { widths, onResizeStart, thRef } = useResizableColumns('my-table', [...])
 *   <th ref={el => thRef(el, 0)} style={{ width: widths[0] }}>
 *     <div {...onResizeStart(0)} style={resizerStyle} />
 *   </th>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useUserPrefs } from './useUserPrefs'
import { useAppStore } from '../store/appStore'

const MIN_COL_WIDTH = 40
const MAX_COL_WIDTH = 800
const LS_PREFS_PREFIX = 'omv2_prefs_'

/** Per-column minimum: largest of the hard floor and 50% of the default width */
function colMin(defaultWidth: number): number {
  return Math.max(MIN_COL_WIDTH, Math.floor(defaultWidth * 0.5))
}

// ── Column definition types ────────────────────────────────────────────────────

export interface ColDef {
  id: string
  default: number
  label?: string        // for future column visibility pickers
  hideable?: boolean    // default true — set false for columns that can't be hidden
}

type ColInput = number[] | ColDef[]

function normaliseDefs(input: ColInput): ColDef[] {
  if (input.length === 0) return []
  if (typeof input[0] === 'number') {
    return (input as number[]).map((w, i) => ({ id: `col-${i}`, default: w }))
  }
  return input as ColDef[]
}

// ── Sync localStorage read (bypasses async prefs cycle) ───────────────────────

function readStoredSync(tableId: string): Record<string, number> | null {
  try {
    const uid = useAppStore.getState().currentUser?.id
    if (!uid) return null
    const raw = localStorage.getItem(LS_PREFS_PREFIX + uid)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { col_widths_v2?: Record<string, Record<string, number>> }
    return parsed?.col_widths_v2?.[tableId] ?? null
  } catch { return null }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useResizableColumns(tableId: string, input: ColInput) {
  const { prefs, setPref } = useUserPrefs()
  const defs = normaliseDefs(input)
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const dragging = useRef<{ colIdx: number; startX: number; startWidth: number; minWidth: number } | null>(null)

  // Resolve stored widths (ID-keyed) → ordered array matching defs
  function resolveWidths(stored: Record<string, number> | null): number[] {
    return defs.map(d => {
      const w = stored?.[d.id]
      return (typeof w === 'number' && w >= MIN_COL_WIDTH) ? w : d.default
    })
  }

  const [widths, setWidths] = useState<number[]>(() =>
    resolveWidths(readStoredSync(tableId))
  )

  // When Supabase prefs arrive asynchronously, apply stored widths
  const storedMap = (prefs.col_widths_v2 as Record<string, Record<string, number>> | undefined)?.[tableId]
  const storedKey = storedMap ? Object.entries(storedMap).map(([k,v])=>`${k}:${v}`).join(',') : ''
  useEffect(() => {
    if (!storedMap) return
    setWidths(resolveWidths(storedMap))
  }, [storedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function save(w: number[]) {
    const idMap: Record<string, number> = {}
    defs.forEach((d, i) => { idMap[d.id] = w[i] })
    const existing = (prefs.col_widths_v2 as Record<string, Record<string, number>> | undefined) ?? {}
    setPref('col_widths_v2', { ...existing, [tableId]: idMap })
  }

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    const { colIdx, startX, startWidth, minWidth } = dragging.current
    const dx = e.clientX - startX
    const newW = Math.max(minWidth, Math.min(MAX_COL_WIDTH, startWidth + dx))
    setWidths(prev => {
      const next = [...prev]
      next[colIdx] = newW
      return next
    })
  }, [])

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return
    setWidths(prev => { save(prev); return prev })
    dragging.current = null
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onMouseMove]) // eslint-disable-line react-hooks/exhaustive-deps

  const onResizeStart = useCallback((colIdx: number) => ({
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const th = thRefs.current[colIdx]
      const startWidth = th ? th.offsetWidth : (widths[colIdx] || 100)
      const minWidth = colMin(defs[colIdx]?.default ?? MIN_COL_WIDTH)
      dragging.current = { colIdx, startX: e.clientX, startWidth, minWidth }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
  }), [widths, defs, onMouseMove, onMouseUp])

  const thRef = useCallback((el: HTMLTableCellElement | null, colIdx: number) => {
    thRefs.current[colIdx] = el
  }, [])

  const resetWidths = useCallback(() => {
    const existing = (prefs.col_widths_v2 as Record<string, Record<string, number>> | undefined) ?? {}
    const next = { ...existing }
    delete next[tableId]
    setPref('col_widths_v2', next)
    setWidths(defs.map(d => d.default))
  }, [prefs.col_widths_v2, tableId, defs, setPref])

  return { widths, onResizeStart, thRef, resetWidths, defs }
}
