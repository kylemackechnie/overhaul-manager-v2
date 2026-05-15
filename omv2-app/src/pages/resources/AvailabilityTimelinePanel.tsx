/**
 * AvailabilityTimelinePanel.tsx
 * Cross-project Gantt showing every person's deployments across 2026.
 * 
 * Two data layers:
 *   Teal bars  = OMV2 projects (live from resources table)
 *   Grey bars  = Excel register (roster_entries + roster_projects — transitional)
 * 
 * Free gaps are visually obvious — potential assignment windows.
 * Filters: name, category, show available only.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonRow {
  person_id: string
  full_name: string
  default_category: string | null
  gid: string | null
  bars: Bar[]
}

interface Bar {
  label: string           // project short name
  start: string           // ISO date
  end: string             // ISO date
  source: 'omv2' | 'roster'
  projectId?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Timeline window: Jan 2026 → Dec 2026
const WINDOW_START = '2026-01-01'
const WINDOW_END   = '2026-12-31'
const WINDOW_DAYS  = Math.round(
  (new Date(WINDOW_END).getTime() - new Date(WINDOW_START).getTime()) / 86400000
) + 1

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

const ROW_H = 32
const NAME_W = 220

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToX(dateStr: string, totalWidth: number): number {
  const d = new Date(Math.max(
    new Date(WINDOW_START).getTime(),
    Math.min(new Date(WINDOW_END).getTime(), new Date(dateStr).getTime())
  ))
  const days = Math.round((d.getTime() - new Date(WINDOW_START).getTime()) / 86400000)
  return (days / WINDOW_DAYS) * totalWidth
}

function dateWidth(start: string, end: string, totalWidth: number): number {
  const s = Math.max(new Date(WINDOW_START).getTime(), new Date(start).getTime())
  const e = Math.min(new Date(WINDOW_END).getTime(),   new Date(end).getTime())
  if (e <= s) return 0
  const days = Math.round((e - s) / 86400000)
  return (days / WINDOW_DAYS) * totalWidth
}

function isAvailableNow(bars: Bar[]): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return !bars.some(b => b.start <= today && b.end >= today)
}

function hasFutureGap(bars: Bar[]): boolean {
  // Returns true if there's any gap after today with no bar
  const today = new Date().toISOString().slice(0, 10)
  const futureEnd = WINDOW_END
  const futureBars = bars.filter(b => b.end >= today).sort((a, b) => a.start.localeCompare(b.start))
  if (futureBars.length === 0) return true
  // Check if first future bar starts after today (gap at start)
  if (futureBars[0].start > today) return true
  // Check gaps between consecutive bars
  for (let i = 0; i < futureBars.length - 1; i++) {
    if (futureBars[i].end < futureBars[i + 1].start) return true
  }
  // Check gap after last bar
  if (futureBars[futureBars.length - 1].end < futureEnd) return true
  return false
}

function shortProjName(name: string): string {
  return name
    .replace(/Outage \d{4}\s*[-–]?\s*/i, '')
    .replace(/\d{4}\s*[-–]?\s*/g, '')
    .trim()
    .slice(0, 18)
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function AvailabilityTimelinePanel() {
  const [rows, setRows] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [availableOnly, setAvailableOnly] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(800)

  // Measure chart area width responsively
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        setChartWidth(Math.max(600, e.contentRect.width - NAME_W - 20))
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)

    // 1. OMV2 resources — live data
    const { data: resData } = await supabase
      .from('resources')
      .select(`
        id, mob_in, mob_out, person_id, project_id,
        persons:person_id (full_name, default_category, gid),
        projects:project_id (name)
      `)
      .not('mob_in', 'is', null)

    // 2. Roster entries — broader Excel register
    const { data: rosterData } = await supabase
      .from('roster_entries')
      .select(`
        person_id, shift_start, finish_date,
        roster_projects:roster_project_id (title, omv2_project_id)
      `)
      .not('shift_start', 'is', null)

    // 3. Persons directory for name/category (for roster entries not in resources)
    const { data: personsData } = await supabase
      .from('persons')
      .select('id, full_name, default_category, gid')
      .eq('active', true)
      .not('full_name', 'ilike', 'TBC')

    const personMap = new Map<string, { full_name: string; default_category: string | null; gid: string | null }>(
      (personsData || []).map(p => [p.id, { full_name: p.full_name, default_category: p.default_category, gid: p.gid }])
    )

    // Build person → bars map
    const personBars = new Map<string, Bar[]>()

    function ensurePerson(personId: string) {
      if (!personBars.has(personId)) personBars.set(personId, [])
    }

    // OMV2 bars (teal)
    for (const r of (resData || []) as Record<string, unknown>[]) {
      const personId = r.person_id as string | null
      if (!personId) continue
      const mobIn  = r.mob_in  as string | null
      const mobOut = r.mob_out as string | null
      if (!mobIn) continue
      const proj = r.projects as { name: string } | null
      ensurePerson(personId)
      personBars.get(personId)!.push({
        label:  proj ? shortProjName(proj.name) : 'OMV2',
        start:  mobIn,
        end:    mobOut ?? mobIn,
        source: 'omv2',
        projectId: r.project_id as string,
      })
    }

    // Roster bars (grey) — skip if already covered by OMV2 for same person+dates
    for (const r of (rosterData || []) as Record<string, unknown>[]) {
      const personId   = r.person_id as string | null
      const shiftStart = r.shift_start  as string | null
      const finish     = r.finish_date  as string | null
      if (!personId || !shiftStart) continue
      const rp = r.roster_projects as { title: string; omv2_project_id: string | null } | null
      // Skip if this roster project is already an OMV2 project (data already from resources)
      if (rp?.omv2_project_id) continue
      ensurePerson(personId)
      personBars.get(personId)!.push({
        label:  rp ? shortProjName(rp.title) : 'Project',
        start:  shiftStart,
        end:    finish ?? shiftStart,
        source: 'roster',
      })
    }

    // Build person rows
    const built: PersonRow[] = []
    for (const [personId, bars] of personBars.entries()) {
      const info = personMap.get(personId)
      if (!info) continue
      // Filter out placeholder names
      if (['TBC', 'Scaffolder 3', 'Scaffolder 5'].includes(info.full_name)) continue
      built.push({
        person_id: personId,
        full_name: info.full_name,
        default_category: info.default_category,
        gid: info.gid,
        bars: bars.sort((a, b) => a.start.localeCompare(b.start)),
      })
    }

    // Sort by name
    built.sort((a, b) => a.full_name.localeCompare(b.full_name))
    setRows(built)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (catFilter !== 'all' && r.default_category !== catFilter) return false
      if (availableOnly && !hasFutureGap(r.bars)) return false
      if (!q) return true
      return r.full_name.toLowerCase().includes(q) || (r.gid || '').toLowerCase().includes(q)
    })
  }, [rows, search, catFilter, availableOnly])

  // Today position
  const todayX = dateToX(new Date().toISOString().slice(0, 10), chartWidth)

  // Month markers
  const monthMarkers = MONTHS.map((m, i) => {
    const d = `2026-${String(i + 1).padStart(2, '0')}-01`
    const x = dateToX(d, chartWidth)
    return { label: m, x }
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Availability Timeline</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {filtered.length} people · Jan → Dec 2026 ·
              <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 8, borderRadius: 2, background: 'var(--accent)', display: 'inline-block' }} /> OMV2 project
                <span style={{ width: 10, height: 8, borderRadius: 2, background: 'var(--text3)', opacity: 0.6, display: 'inline-block', marginLeft: 6 }} /> Register
              </span>
            </div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search" placeholder="Search name or GID…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 180px', minWidth: 160, fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--bg3)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }}
          />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
            <option value="all">All categories</option>
            <option value="trades">Trades</option>
            <option value="management">Management</option>
            <option value="seag">SE AG</option>
            <option value="subcontractor">Subcontractor</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text2)', userSelect: 'none' }}>
            <input
              type="checkbox" checked={availableOnly}
              onChange={e => setAvailableOnly(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Available only (has future gap)
          </label>
          {(search || catFilter !== 'all' || availableOnly) && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setSearch(''); setCatFilter('all'); setAvailableOnly(false) }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="loading-center">
          <span className="spinner" />
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>Building timeline…</span>
        </div>
      ) : (
        <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* Sticky month header */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 20,
            background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
            display: 'flex', flexShrink: 0,
          }}>
            {/* Name col header */}
            <div style={{
              width: NAME_W, minWidth: NAME_W, flexShrink: 0,
              padding: '7px 12px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)',
              borderRight: '1px solid var(--border)',
            }}>
              Person
            </div>
            {/* Month markers */}
            <div style={{ flex: 1, position: 'relative', height: 30 }}>
              {monthMarkers.map(({ label, x }) => (
                <div key={label} style={{
                  position: 'absolute', left: x,
                  height: '100%', borderLeft: '1px solid var(--border)',
                  paddingLeft: 4,
                  display: 'flex', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                </div>
              ))}
              {/* Today line in header */}
              <div style={{
                position: 'absolute', left: todayX, top: 0, bottom: 0,
                width: 2, background: 'var(--accent)', opacity: 0.8,
              }} />
            </div>
          </div>

          {/* Person rows */}
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 24, marginBottom: 8 }}>📅</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>No people match your filters</div>
            </div>
          ) : (
            filtered.map((person, idx) => {
              const cat = person.default_category
              const catStyle = cat ? (CAT_STYLE[cat] ?? null) : null
              const isAvail = isAvailableNow(person.bars)
              const rowBg = idx % 2 === 0 ? 'var(--bg)' : 'var(--bg2)'

              return (
                <div
                  key={person.person_id}
                  style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border)', background: rowBg }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                >
                  {/* Name column */}
                  <div style={{
                    width: NAME_W, minWidth: NAME_W, flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '0 10px',
                    borderRight: '1px solid var(--border)',
                    overflow: 'hidden',
                  }}>
                    {/* Availability dot */}
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: isAvail ? 'var(--green)' : 'var(--text3)',
                    }} />
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1,
                      }}>
                        {person.full_name}
                      </div>
                      {cat && catStyle && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 2, textTransform: 'capitalize', flexShrink: 0, ...catStyle }}>
                          {cat === 'management' ? 'Mgmt' : cat === 'subcontractor' ? 'Sub' : cat === 'seag' ? 'SE AG' : 'Trades'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bar area */}
                  <div style={{ flex: 1, position: 'relative' }}>

                    {/* Month grid lines */}
                    {monthMarkers.map(({ label, x }) => (
                      <div key={label} style={{
                        position: 'absolute', left: x, top: 0, bottom: 0,
                        width: 1, background: 'var(--border)', opacity: 0.5,
                      }} />
                    ))}

                    {/* Today line */}
                    <div style={{
                      position: 'absolute', left: todayX, top: 2, bottom: 2,
                      width: 2, background: 'var(--accent)', opacity: 0.6, borderRadius: 1,
                      zIndex: 5,
                    }} />

                    {/* Deployment bars */}
                    {person.bars.map((bar, bi) => {
                      const x = dateToX(bar.start, chartWidth)
                      const w = Math.max(4, dateWidth(bar.start, bar.end, chartWidth))
                      if (w <= 0) return null
                      const isOmv2 = bar.source === 'omv2'
                      return (
                        <div
                          key={bi}
                          title={`${bar.label}\n${bar.start} → ${bar.end}`}
                          style={{
                            position: 'absolute',
                            left: x, top: 5, bottom: 5, width: w,
                            borderRadius: 3,
                            background: isOmv2 ? 'var(--accent)' : 'var(--text3)',
                            opacity: isOmv2 ? 0.85 : 0.45,
                            display: 'flex', alignItems: 'center',
                            paddingLeft: 4, overflow: 'hidden',
                            cursor: 'default',
                            zIndex: isOmv2 ? 4 : 3,
                          }}
                        >
                          {w > 40 && (
                            <span style={{
                              fontSize: 9, fontWeight: 600,
                              color: '#fff', whiteSpace: 'nowrap',
                              overflow: 'hidden', textOverflow: 'ellipsis',
                              maxWidth: w - 8,
                            }}>
                              {bar.label}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
