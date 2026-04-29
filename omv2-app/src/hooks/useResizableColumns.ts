/**
 * useResizableColumns
 *
 * Provides drag-to-resize column widths for <table> elements.
 * Widths persist in localStorage, namespaced by tableId.
 * On first mount with no stored data, reads actual rendered widths
 * from th elements so columns never "jump" on first drag.
 *
 * Usage:
 *   const { widths, onResizeStart, thRef } = useResizableColumns('my-table', {
 *     col0: 80, col1: 200, col2: 120, ...
 *   })
 *   // In thead:
 *   <th ref={el => thRef(el, 0)} style={{ width: widths[0] }}>
 *     ...
 *     <div {...onResizeStart(0)} style={resizerStyle} />
 *   </th>
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'col_widths_v1_'
const MIN_COL_WIDTH = 32
const MAX_COL_WIDTH = 800
const RESIZER_WIDTH = 6

export const resizerStyle: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: `${RESIZER_WIDTH}px`,
  cursor: 'col-resize',
  userSelect: 'none',
  zIndex: 10,
  // Subtle visual hint on hover — handled by CSS class
}

export function useResizableColumns(
  tableId: string,
  /** Default widths in pixels, one per column. Use 0 for "auto" (will read from DOM). */
  defaults: number[],
) {
  const storageKey = STORAGE_PREFIX + tableId
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const dragging = useRef<{ colIdx: number; startX: number; startWidth: number } | null>(null)
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed: number[] = JSON.parse(stored)
        // If stored length matches defaults, use stored. Otherwise discard (column count changed).
        if (parsed.length === defaults.length && parsed.every(w => typeof w === 'number' && w >= MIN_COL_WIDTH)) {
          return parsed
        }
      }
    } catch { /* ignore */ }
    return defaults
  })

  // On mount: for any column with default=0, read actual rendered width from DOM
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) return // already have persisted widths, don't override
    } catch { /* ignore */ }
    // Read rendered widths for columns that were set to 0 (auto)
    const hasAuto = defaults.some(d => d === 0)
    if (!hasAuto) return
    // Small delay to let table render
    const timer = setTimeout(() => {
      const rendered = thRefs.current.map((th, i) => {
        if (defaults[i] === 0 && th) return Math.max(MIN_COL_WIDTH, th.offsetWidth)
        return defaults[i] || MIN_COL_WIDTH
      })
      setWidths(rendered)
    }, 50)
    return () => clearTimeout(timer)
  }, [tableId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback((w: number[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(w)) } catch { /* ignore */ }
  }, [storageKey])

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.startX
    const newW = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, dragging.current.startWidth + dx))
    setWidths(prev => {
      const next = [...prev]
      next[dragging.current!.colIdx] = newW
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
  }, [onMouseMove, save])

  const onResizeStart = useCallback((colIdx: number) => ({
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const th = thRefs.current[colIdx]
      const startWidth = th ? th.offsetWidth : (widths[colIdx] || 100)
      dragging.current = { colIdx, startX: e.clientX, startWidth }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
  }), [widths, onMouseMove, onMouseUp])

  const thRef = useCallback((el: HTMLTableCellElement | null, colIdx: number) => {
    thRefs.current[colIdx] = el
  }, [])

  const resetWidths = useCallback(() => {
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    setWidths(defaults)
  }, [storageKey, defaults]) // eslint-disable-line react-hooks/exhaustive-deps

  return { widths, onResizeStart, thRef, resetWidths }
}
