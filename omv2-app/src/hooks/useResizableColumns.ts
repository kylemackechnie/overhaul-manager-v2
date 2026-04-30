/**
 * useResizableColumns
 *
 * Provides drag-to-resize column widths for <table> elements.
 * Widths persist per-user via useUserPrefs (localStorage + Supabase sync).
 * On first mount with no stored data, reads actual rendered widths
 * from th elements so columns never "jump" on first drag.
 *
 * Usage:
 *   const { widths, onResizeStart, thRef } = useResizableColumns('my-table', [80, 200, 120])
 *   <th ref={el => thRef(el, 0)} style={{ width: widths[0] }}>
 *     <div {...onResizeStart(0)} style={resizerStyle} />
 *   </th>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useUserPrefs } from './useUserPrefs'

const MIN_COL_WIDTH = 32
const MAX_COL_WIDTH = 800

export function useResizableColumns(
  tableId: string,
  defaults: number[],
) {
  const { prefs, setPref } = useUserPrefs()
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const dragging = useRef<{ colIdx: number; startX: number; startWidth: number } | null>(null)

  const getStored = (): number[] | null => {
    const stored = prefs.col_widths?.[tableId]
    if (stored && stored.length === defaults.length && stored.every(w => typeof w === 'number' && w >= MIN_COL_WIDTH)) {
      return stored
    }
    return null
  }

  const [widths, setWidths] = useState<number[]>(() => getStored() ?? defaults)

  // When Supabase prefs arrive asynchronously, apply stored widths
  const storedKey = prefs.col_widths?.[tableId]?.join(',')
  useEffect(() => {
    const stored = getStored()
    if (stored) setWidths(stored)
  }, [storedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-measure DOM for default=0 columns on first mount
  useEffect(() => {
    const hasAuto = defaults.some(d => d === 0)
    if (!hasAuto || getStored()) return
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
    setPref('col_widths', { ...prefs.col_widths, [tableId]: w })
  }, [prefs.col_widths, tableId, setPref])

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
    const next = { ...prefs.col_widths }
    delete next[tableId]
    setPref('col_widths', next)
    setWidths(defaults)
  }, [prefs.col_widths, tableId, defaults, setPref])

  return { widths, onResizeStart, thRef, resetWidths }
}
