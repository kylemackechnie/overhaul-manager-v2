/**
 * ResourceCalendar
 *
 * Gantt-style on-site calendar for the Resources panel.
 * Replaces the old day-cell heatmap table with:
 *  - Continuous bars (position: absolute %) per resource
 *  - View presets: 2 weeks, 4 weeks, 8 weeks, full project span
 *  - Prev/next navigation
 *  - Double date header: month blocks + DOW/day labels
 *  - Category grouping with section labels
 *  - Headcount summary row
 *  - Drag-to-resize bars (left edge = mob_in, right edge = mob_out, body = move both)
 *  - Click name → opens edit modal
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Resource } from '../../types'
import { toast } from '../../components/ui/Toast'

// ── Constants ─────────────────────────────────────────────────────────────────

const CELL_PX = 26  // pixels per day column
const ROW_H = 30    // px per person row
const EDGE_PX = 8   // drag-handle zone width at each end of bar

const CAT_ORDER: Resource['category'][] = ['management', 'trades', 'subcontractor', 'seag']
const CAT_LABEL: Record<Resource['category'], string> = {
  trades: 'Trades',
  management: 'Management',
  seag: 'SE AG',
  subcontractor: 'Subcontractors',
}
const CAT_COLOR: Record<Resource['category'], string> = {
  trades: '#0F6E56',
  management: '#7c3aed',
  seag: '#0369a1',
  subcontractor: '#f97316',
}

type ViewPreset = '2w' | '4w' | '8w' | 'span'

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}

function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min
  if (date > max) return max
  return date
}

function makeDayRange(start: string, end: string): string[] {
  const days: string[] = []
  let cur = start
  while (cur <= end) { days.push(cur); cur = addDays(cur, 1) }
  return days
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

// ── Component ─────────────────────────────────────────────────────────────────

interface DragState {
  resourceId: string
  handle: 'left' | 'right' | 'move'
  startClientX: number
  startMobIn: string | null
  startMobOut: string | null
}

interface Props {
  resources: Resource[]
  /** Save a single field change — should update local state + Supabase */
  onSave: (id: string, field: 'mob_in' | 'mob_out', value: string | null) => Promise<void>
  /** Open the edit modal for a resource */
  onOpenEdit: (r: Resource) => void
  /** Bulk-selection state from parent (shown above calendar if > 0) */
  selected: Set<string>
  onBulkEdit: () => void
  onClearSelected: () => void
}

export function ResourceCalendar({ resources, onSave, onOpenEdit, selected, onBulkEdit, onClearSelected }: Props) {
  const today = todayStr()

  // ── View state ───────────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<ViewPreset>('4w')
  const [offset, setOffset] = useState(0)  // days to shift window from default start

  // Resources that have at least one mob date
  const calResources = useMemo(
    () => resources.filter(r => r.mob_in || r.mob_out),
    [resources],
  )

  // Compute window bounds
  const { windowStart, windowEnd, totalDays } = useMemo(() => {
    if (preset === 'span') {
      const dates = calResources.flatMap(r => [r.mob_in, r.mob_out].filter(Boolean) as string[])
      if (!dates.length) {
        const s = addDays(today, -3)
        return { windowStart: s, windowEnd: addDays(s, 27), totalDays: 28 }
      }
      const earliest = dates.reduce((a, b) => a < b ? a : b)
      const latest = dates.reduce((a, b) => a > b ? a : b)
      // Pad 3 days either side
      return {
        windowStart: addDays(earliest, -3),
        windowEnd: addDays(latest, 3),
        totalDays: daysBetween(addDays(earliest, -3), addDays(latest, 3)) + 1,
      }
    }
    const n = preset === '2w' ? 14 : preset === '4w' ? 28 : 56
    const defaultStart = addDays(today, -3)
    const start = addDays(defaultStart, offset)
    return { windowStart: start, windowEnd: addDays(start, n - 1), totalDays: n }
  }, [preset, offset, today, calResources])

  const calDays = useMemo(() => makeDayRange(windowStart, windowEnd), [windowStart, windowEnd])

  // ── Drag state ───────────────────────────────────────────────────────────────
  const dragRef = useRef<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; mob_in: string | null; mob_out: string | null } | null>(null)

  // Pixel → day offset conversion
  const pixelsToDays = useCallback((px: number) => Math.round(px / CELL_PX), [])

  function getResourceDates(r: Resource) {
    if (dragPreview && dragPreview.id === r.id) return dragPreview
    return { mob_in: r.mob_in, mob_out: r.mob_out }
  }

  // Bar position in absolute pixels (matches CELL_PX grid exactly)
  function barPosition(r: Resource): { leftPx: number; widthPx: number; visible: boolean } {
    const { mob_in, mob_out } = getResourceDates(r)
    if (!mob_in && !mob_out) return { leftPx: 0, widthPx: 0, visible: false }

    const start = mob_in || windowStart
    const end = mob_out || windowEnd

    if (end < windowStart || start > windowEnd) return { leftPx: 0, widthPx: 0, visible: false }

    const clampedStart = clampDate(start, windowStart, windowEnd)
    const clampedEnd = clampDate(end, windowStart, windowEnd)
    const leftDays = daysBetween(windowStart, clampedStart)
    const widthDays = daysBetween(clampedStart, clampedEnd) + 1

    return {
      leftPx: leftDays * CELL_PX,
      widthPx: Math.max(CELL_PX, widthDays * CELL_PX),
      visible: true,
    }
  }

  // ── Mouse event handlers ──────────────────────────────────────────────────────
  function onBarMouseDown(e: React.MouseEvent, r: Resource, handle: DragState['handle']) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      resourceId: r.id,
      handle,
      startClientX: e.clientX,
      startMobIn: r.mob_in,
      startMobOut: r.mob_out,
    }
    setDragPreview({ id: r.id, mob_in: r.mob_in, mob_out: r.mob_out })
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return
      const deltaDays = pixelsToDays(e.clientX - drag.startClientX)
      if (deltaDays === 0) return

      let newIn = drag.startMobIn
      let newOut = drag.startMobOut

      if (drag.handle === 'left' && drag.startMobIn) {
        newIn = clampDate(addDays(drag.startMobIn, deltaDays), windowStart, newOut || windowEnd)
      } else if (drag.handle === 'right' && drag.startMobOut) {
        newOut = clampDate(addDays(drag.startMobOut, deltaDays), newIn || windowStart, windowEnd)
      } else if (drag.handle === 'move') {
        if (drag.startMobIn) newIn = clampDate(addDays(drag.startMobIn, deltaDays), windowStart, windowEnd)
        if (drag.startMobOut) newOut = clampDate(addDays(drag.startMobOut, deltaDays), windowStart, windowEnd)
        // Ensure in ≤ out
        if (newIn && newOut && newIn > newOut) {
          if (drag.startMobIn) newIn = drag.startMobIn
          if (drag.startMobOut) newOut = drag.startMobOut
        }
      }

      setDragPreview({ id: drag.resourceId, mob_in: newIn, mob_out: newOut })
    }

    async function onMouseUp() {
      const drag = dragRef.current
      if (!drag) return
      const preview = dragRef.current
      dragRef.current = null

      // Find what we previewed
      setDragPreview(prev => {
        if (!prev || prev.id !== preview?.resourceId) return null
        const r = resources.find(x => x.id === prev.id)
        if (!r) return null

        // Fire saves for changed fields
        if (prev.mob_in !== r.mob_in) {
          void onSave(r.id, 'mob_in', prev.mob_in).then(() => {
            toast(`${r.name}: Mob In → ${prev.mob_in || '—'}`, 'success')
          })
        }
        if (prev.mob_out !== r.mob_out) {
          void onSave(r.id, 'mob_out', prev.mob_out).then(() => {
            toast(`${r.name}: Mob Out → ${prev.mob_out || '—'}`, 'success')
          })
        }
        return null
      })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [resources, windowStart, windowEnd, pixelsToDays, onSave])

  // ── Navigation ────────────────────────────────────────────────────────────────
  function shift(direction: 1 | -1) {
    if (preset === 'span') return
    const n = preset === '2w' ? 7 : preset === '4w' ? 14 : 28
    setOffset(o => o + direction * n)
  }
  function resetOffset() { setOffset(0) }

  // ── Headcount per day ─────────────────────────────────────────────────────────
  const headcounts = useMemo(() => {
    return calDays.map(day => ({
      day,
      count: calResources.filter(r => {
        const { mob_in, mob_out } = getResourceDates(r)
        return mob_in && mob_in <= day && (!mob_out || mob_out >= day)
      }).length,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calDays, calResources, dragPreview])

  const maxHC = Math.max(1, ...headcounts.map(h => h.count))

  // ── Month groupings for header ─────────────────────────────────────────────
  const monthBlocks = useMemo(() => {
    const blocks: { label: string; days: number }[] = []
    for (const day of calDays) {
      const label = new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
      if (!blocks.length || blocks[blocks.length - 1].label !== label) {
        blocks.push({ label, days: 1 })
      } else {
        blocks[blocks.length - 1].days++
      }
    }
    return blocks
  }, [calDays])

  // ── Grouped resources ──────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    return CAT_ORDER
      .map(cat => ({ cat, rows: calResources.filter(r => r.category === cat) }))
      .filter(g => g.rows.length > 0)
  }, [calResources])

  // ── Render ─────────────────────────────────────────────────────────────────

  const ganttW = totalDays * CELL_PX

  function renderDayBg(day: string) {
    const dow = new Date(day + 'T12:00:00').getDay()
    const isWknd = dow === 0 || dow === 6
    const isToday = day === today
    return (
      <div
        key={day}
        style={{
          width: CELL_PX,
          flexShrink: 0,
          background: isToday ? 'rgba(15,118,110,0.06)' : isWknd ? 'rgba(0,0,0,0.025)' : 'transparent',
          borderRight: isToday ? '1.5px solid rgba(15,118,110,0.35)' : '0.5px solid var(--border)',
          height: '100%',
        }}
      />
    )
  }

  const labelW = 160  // name column width

  return (
    <div className="card" style={{ marginBottom: 16, padding: '12px 14px', userSelect: 'none' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          On-site Calendar
        </div>
        <div style={{ flex: 1 }} />

        {/* View presets */}
        {(['2w', '4w', '8w', 'span'] as ViewPreset[]).map(p => (
          <button
            key={p}
            className="btn btn-sm"
            style={preset === p ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : undefined}
            onClick={() => { setPreset(p); resetOffset() }}
          >
            {p === 'span' ? 'Full span' : p === '2w' ? '2 weeks' : p === '4w' ? '4 weeks' : '8 weeks'}
          </button>
        ))}

        {/* Nav arrows */}
        {preset !== 'span' && (
          <>
            <button className="btn btn-sm" onClick={() => shift(-1)}>←</button>
            <button className="btn btn-sm" onClick={resetOffset} title="Jump to today">Today</button>
            <button className="btn btn-sm" onClick={() => shift(1)}>→</button>
          </>
        )}
      </div>

      {/* Bulk-selection strip */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 'var(--radius)', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8' }}>{selected.size} selected</span>
          <button className="btn btn-sm" onClick={onBulkEdit}>✏ Bulk Edit</button>
          <button className="btn btn-sm" style={{ color: 'var(--text3)' }} onClick={onClearSelected}>✕ Clear</button>
        </div>
      )}

      {calResources.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>
          No resources with mob dates yet. Add mob-in/mob-out dates to resources to see the calendar.
        </div>
      )}

      {calResources.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: labelW + ganttW, position: 'relative' }}>

            {/* ── Date header ── */}
            <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
              {/* Name column header */}
              <div style={{ width: labelW, flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--text3)', padding: '2px 8px 4px', borderRight: '1px solid var(--border)' }}>
                Person
              </div>
              {/* Month blocks */}
              <div style={{ flex: 1 }}>
                {/* Row 1: month labels */}
                <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
                  {monthBlocks.map((b, i) => (
                    <div key={i} style={{
                      width: b.days * CELL_PX,
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--text3)',
                      padding: '2px 6px',
                      borderRight: '0.5px solid var(--border)',
                      letterSpacing: '0.04em',
                    }}>
                      {b.label}
                    </div>
                  ))}
                </div>
                {/* Row 2: day labels */}
                <div style={{ display: 'flex' }}>
                  {calDays.map(day => {
                    const d = new Date(day + 'T12:00:00')
                    const dow = d.getDay()
                    const isWknd = dow === 0 || dow === 6
                    const isToday = day === today
                    const dowLabel = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'][dow]
                    return (
                      <div key={day} style={{
                        width: CELL_PX,
                        flexShrink: 0,
                        textAlign: 'center',
                        fontSize: 9,
                        padding: '2px 0',
                        color: isToday ? 'var(--accent)' : isWknd ? 'var(--amber)' : 'var(--text3)',
                        fontWeight: isToday ? 700 : 400,
                        borderRight: isToday ? '1.5px solid rgba(15,118,110,0.35)' : '0.5px solid var(--border)',
                        lineHeight: 1.3,
                      }}>
                        {dowLabel}
                        <br />
                        {isToday ? '▼' : d.getDate()}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Resource rows by category ── */}
            {grouped.map(({ cat, rows }) => (
              <div key={cat}>
                {/* Category header */}
                <div style={{ display: 'flex', background: 'var(--bg3)', borderBottom: '0.5px solid var(--border)' }}>
                  <div style={{
                    width: labelW,
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 600,
                    color: CAT_COLOR[cat],
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    padding: '3px 8px',
                    borderRight: '1px solid var(--border)',
                  }}>
                    {CAT_LABEL[cat]} <span style={{ fontWeight: 400, color: 'var(--text3)' }}>({rows.length})</span>
                  </div>
                  <div style={{ flex: 1 }} />
                </div>

                {/* Person rows */}
                {rows.map(r => {
                  const pos = barPosition(r)
                  const barColor = CAT_COLOR[r.category]
                  const { mob_in, mob_out } = getResourceDates(r)
                  const inWindow = pos.visible

                  // Bar label
                  const isNarrow = pos.widthPx < 50
                  const barLabel = !inWindow ? null : isNarrow ? null : mob_out && mob_out < today ? 'demobbed' : mob_in && mob_in > today ? `mob ${mob_in.slice(5)}` : 'on site'

                  return (
                    <div key={r.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', height: ROW_H, alignItems: 'center' }}>
                      {/* Name cell — click opens edit modal */}
                      <div
                        style={{
                          width: labelW,
                          flexShrink: 0,
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--text)',
                          padding: '0 8px',
                          borderRight: '1px solid var(--border)',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          overflow: 'hidden',
                        }}
                        onClick={() => onOpenEdit(r)}
                        title={`Edit ${r.name}`}
                      >
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: barColor, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      </div>

                      {/* Gantt row — explicit px width so bars and bg cells share the same coordinate space */}
                      <div style={{ width: ganttW, flexShrink: 0, position: 'relative', height: '100%', overflow: 'hidden' }}>
                        {/* Day background stripes */}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                          {calDays.map(day => renderDayBg(day))}
                        </div>

                        {/* Mob bar */}
                        {inWindow && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 5,
                              bottom: 5,
                              left: pos.leftPx,
                              width: pos.widthPx,
                              background: barColor,
                              borderRadius: 3,
                              display: 'flex',
                              alignItems: 'center',
                              cursor: dragRef.current ? 'grabbing' : 'grab',
                              opacity: mob_out && mob_out < today ? 0.45 : 1,
                              minWidth: 6,
                            }}
                            title={`${r.name}: ${mob_in || '?'} → ${mob_out || 'open'}`}
                          >
                            {/* Left drag handle */}
                            <div
                              style={{
                                width: EDGE_PX,
                                flexShrink: 0,
                                height: '100%',
                                cursor: 'ew-resize',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              onMouseDown={e => onBarMouseDown(e, r, 'left')}
                            >
                              {!isNarrow && <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />}
                            </div>

                            {/* Bar body — move handle */}
                            <div
                              style={{ flex: 1, height: '100%', cursor: 'grab', overflow: 'hidden', display: 'flex', alignItems: 'center' }}
                              onMouseDown={e => onBarMouseDown(e, r, 'move')}
                            >
                              {barLabel && (
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.9)', fontWeight: 500, paddingLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {barLabel}
                                </span>
                              )}
                            </div>

                            {/* Right drag handle */}
                            <div
                              style={{
                                width: EDGE_PX,
                                flexShrink: 0,
                                height: '100%',
                                cursor: 'ew-resize',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              onMouseDown={e => onBarMouseDown(e, r, 'right')}
                            >
                              {!isNarrow && <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />}
                            </div>
                          </div>
                        )}

                        {/* Resource out of window hint */}
                        {!inWindow && (mob_in || mob_out) && (
                          <div style={{
                            position: 'absolute',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            ...(mob_out && mob_out < windowStart
                              ? { left: 4 }
                              : { right: 4 }),
                            fontSize: 9,
                            color: 'var(--text3)',
                            whiteSpace: 'nowrap',
                          }}>
                            {mob_out && mob_out < windowStart ? '← ' : '→ '}
                            {mob_in && mob_out ? `${mob_in.slice(5)} – ${mob_out.slice(5)}` : mob_in || mob_out}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* ── Headcount summary row ── */}
            <div style={{ display: 'flex', borderTop: '1px solid var(--border)', background: 'var(--bg3)' }}>
              <div style={{
                width: labelW,
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text3)',
                padding: '4px 8px',
                borderRight: '1px solid var(--border)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
              }}>
                Headcount
              </div>
              <div style={{ width: ganttW, flexShrink: 0, display: 'flex', height: 36, alignItems: 'flex-end', padding: '3px 0' }}>
                {headcounts.map(({ day, count }) => {
                  const dow = new Date(day + 'T12:00:00').getDay()
                  const isWknd = dow === 0 || dow === 6
                  const isToday = day === today
                  const barH = count > 0 ? Math.max(6, Math.round((count / maxHC) * 28)) : 0
                  return (
                    <div key={day} style={{
                      width: CELL_PX,
                      flexShrink: 0,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      borderRight: isToday ? '1.5px solid rgba(15,118,110,0.35)' : '0.5px solid var(--border)',
                      opacity: isWknd ? 0.4 : 1,
                    }}>
                      {count > 0 && (
                        <div style={{
                          width: CELL_PX - 4,
                          height: barH,
                          background: isToday ? 'var(--accent)' : 'var(--mod-hr, #0F6E56)',
                          borderRadius: '2px 2px 0 0',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                          paddingTop: 1,
                        }}>
                          {barH >= 14 && (
                            <span style={{ fontSize: 8, color: '#fff', fontWeight: 600, lineHeight: 1 }}>{count}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Legend */}
      {calResources.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text3)' }}>
          {CAT_ORDER.filter(c => grouped.some(g => g.cat === c)).map(cat => (
            <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CAT_COLOR[cat] }} />
              {CAT_LABEL[cat]}
            </span>
          ))}
          <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(0,0,0,0.08)', border: '0.5px solid var(--border)' }} />
            Weekend
          </span>
          <span style={{ color: 'var(--text3)' }}>
            Drag bar edges to adjust dates · Drag bar body to move · Click name to edit
          </span>
        </div>
      )}
    </div>
  )
}
