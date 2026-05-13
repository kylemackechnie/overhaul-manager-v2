/**
 * YearViewPanel.tsx
 * 30,000ft resource view — all 34 Excel projects across 2026.
 * Projects with omv2_project_id = live OMV2 links.
 * All others = greyed "not in OMV2" label.
 * Person bars are clickable → ProfileDrawer.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonProfileDrawer } from './PersonProfileDrawer'
import { useAppStore } from '../../store/appStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RosterRow {
  id: string
  sheet_name: string
  project_title: string
  omv2_project_id: string | null
  person_name: string
  person_id: string | null
  role: string | null
  mob_date: string | null
  start_date: string | null
  finish_date: string | null
}

interface Project {
  sheet_name: string
  project_title: string
  omv2_project_id: string | null
  rows: RosterRow[]
  min_date: Date | null
  max_date: Date | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const YEAR = 2026
const YEAR_START = new Date(YEAR, 0, 1)
const YEAR_END   = new Date(YEAR, 11, 31)
const YEAR_DAYS  = Math.round((YEAR_END.getTime() - YEAR_START.getTime()) / 86400000) + 1

// Colour palette for projects (by index)
const PROJECT_COLORS = [
  '#0369a1', '#059669', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#65a30d', '#ea580c', '#be123c', '#4f46e5',
  '#0284c7', '#16a34a', '#ca8a04', '#b91c1c', '#6d28d9',
  '#0e7490', '#15803d', '#b45309', '#991b1b', '#5b21b6',
]

const OMV2_PROJECTS: Record<string, string> = {
  '36e9df78-d8f8-4ac6-95d1-4fd7aba29a05': 'Stanwell U3',
  'e8186920-0f08-4772-aa94-83ae325c7ae8': 'NRG U2',
  '8c329b83-9f21-48dd-9db2-39fa616367e1': 'Laverton',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayOffset(date: Date): number {
  return Math.round((date.getTime() - YEAR_START.getTime()) / 86400000)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function parseDate(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Person Bar ────────────────────────────────────────────────────────────────

function PersonBar({
  row, color, totalWidth, onClickPerson,
}: {
  row: RosterRow
  color: string
  totalWidth: number
  onClickPerson: (id: string) => void
}) {
  const start = parseDate(row.start_date) || parseDate(row.mob_date)
  const end   = parseDate(row.finish_date)
  if (!start || !end) return null

  const startDay = clamp(dayOffset(start), 0, YEAR_DAYS)
  const endDay   = clamp(dayOffset(end),   0, YEAR_DAYS)
  if (endDay < startDay) return null

  const leftPct  = (startDay / YEAR_DAYS) * 100
  const widthPct = ((endDay - startDay + 1) / YEAR_DAYS) * 100
  const leftPx   = (leftPct / 100) * totalWidth
  const widthPx  = Math.max(4, (widthPct / 100) * totalWidth)

  const tooltip = `${row.person_name}${row.role ? ' · ' + row.role : ''}\n${fmtDate(start)} → ${fmtDate(end)}`

  return (
    <div
      title={tooltip}
      onClick={e => { e.stopPropagation(); row.person_id && onClickPerson(row.person_id) }}
      style={{
        position: 'absolute',
        left: leftPx,
        width: widthPx,
        top: 2,
        bottom: 2,
        background: color,
        borderRadius: 3,
        opacity: row.person_id ? 0.85 : 0.4,
        cursor: row.person_id ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 4,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {widthPx > 60 && (
        <span style={{ fontSize: 10, color: '#fff', whiteSpace: 'nowrap', fontWeight: 500, lineHeight: 1 }}>
          {row.person_name}
        </span>
      )}
    </div>
  )
}

// ── Project Row ───────────────────────────────────────────────────────────────

function ProjectRow({
  project, color, totalWidth, expanded, onToggle, onClickPerson, onNavigateToProject,
}: {
  project: Project
  color: string
  totalWidth: number
  expanded: boolean
  onToggle: () => void
  onClickPerson: (id: string) => void
  onNavigateToProject: (id: string) => void
}) {
  const isLinked = !!project.omv2_project_id
  const label = project.omv2_project_id ? OMV2_PROJECTS[project.omv2_project_id] || 'OMV2' : null

  // Project-level span bar
  const projStart = project.min_date
  const projEnd   = project.max_date
  const startDay  = projStart ? clamp(dayOffset(projStart), 0, YEAR_DAYS) : null
  const endDay    = projEnd   ? clamp(dayOffset(projEnd),   0, YEAR_DAYS) : null
  const leftPx    = startDay != null ? (startDay / YEAR_DAYS) * totalWidth : 0
  const widthPx   = (startDay != null && endDay != null) ? Math.max(4, ((endDay - startDay + 1) / YEAR_DAYS) * totalWidth) : 0

  return (
    <div>
      {/* Project header row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 32,
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer',
          background: expanded ? 'var(--accent-light)' : 'var(--bg2)',
          transition: 'background 0.1s',
        }}
      >
        {/* Label column */}
        <div style={{
          width: 220, minWidth: 220, paddingLeft: 10, paddingRight: 8,
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', width: 12 }}>{expanded ? '▾' : '▸'}</span>
          <div style={{
            width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0,
          }} />
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.project_title}
            </div>
          </div>
        </div>

        {/* OMV2 badge + person count */}
        <div style={{ width: 90, minWidth: 90, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          {isLinked ? (
            <span
              onClick={e => { e.stopPropagation(); onNavigateToProject(project.omv2_project_id!) }}
              style={{
                fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: '#fff',
                borderRadius: 3, padding: '1px 5px', cursor: 'pointer', letterSpacing: 0.3,
              }}
            >
              {label}
            </span>
          ) : (
            <span style={{
              fontSize: 9, color: 'var(--text3)', background: 'var(--bg3)',
              borderRadius: 3, padding: '1px 5px', letterSpacing: 0.3,
            }}>
              {project.rows.length}p
            </span>
          )}
        </div>

        {/* Gantt area — project span bar */}
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          {widthPx > 0 && (
            <div style={{
              position: 'absolute',
              left: leftPx, width: widthPx,
              top: 8, bottom: 8,
              background: color, opacity: 0.25,
              borderRadius: 3,
            }} />
          )}
        </div>
      </div>

      {/* Person rows */}
      {expanded && project.rows.map(row => (
        <div
          key={row.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 24,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          {/* Name column */}
          <div style={{
            width: 220, minWidth: 220, paddingLeft: 28, paddingRight: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span
              style={{
                fontSize: 10.5, color: row.person_id ? 'var(--text2)' : 'var(--text3)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                cursor: row.person_id ? 'pointer' : 'default',
                textDecoration: row.person_id ? 'underline' : 'none',
                textDecorationColor: 'transparent',
              }}
              onClick={() => row.person_id && onClickPerson(row.person_id)}
              onMouseEnter={e => row.person_id && ((e.target as HTMLElement).style.textDecorationColor = 'var(--text2)')}
              onMouseLeave={e => ((e.target as HTMLElement).style.textDecorationColor = 'transparent')}
            >
              {row.person_name}
            </span>
          </div>
          {/* Role */}
          <div style={{ width: 90, minWidth: 90, flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', display: 'block', textOverflow: 'ellipsis' }}>
              {row.role || ''}
            </span>
          </div>
          {/* Bar */}
          <div style={{ flex: 1, position: 'relative', height: '100%' }}>
            <PersonBar row={row} color={color} totalWidth={totalWidth} onClickPerson={onClickPerson} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function YearViewPanel() {
  const [rows, setRows] = useState<RosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [omv2Only, setOmv2Only] = useState(false)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const ganttRef = useRef<HTMLDivElement>(null)
  const [ganttWidth, setGanttWidth] = useState(800)
  const { setActivePanel } = useAppStore()

  useEffect(() => {
    supabase.from('excel_roster').select('*').order('sheet_name').then(({ data }) => {
      setRows((data || []) as RosterRow[])
      setLoading(false)
    })
  }, [])

  // Measure gantt area width
  useEffect(() => {
    if (!ganttRef.current) return
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setGanttWidth(Math.max(400, entry.contentRect.width - 310))
    })
    ro.observe(ganttRef.current)
    return () => ro.disconnect()
  }, [])

  // Group rows into projects, ordered by first start date
  const projects = useMemo<Project[]>(() => {
    const map = new Map<string, Project>()
    for (const row of rows) {
      if (!map.has(row.sheet_name)) {
        map.set(row.sheet_name, {
          sheet_name: row.sheet_name,
          project_title: row.project_title,
          omv2_project_id: row.omv2_project_id,
          rows: [],
          min_date: null,
          max_date: null,
        })
      }
      const p = map.get(row.sheet_name)!
      p.rows.push(row)
      const start = parseDate(row.start_date) || parseDate(row.mob_date)
      const end = parseDate(row.finish_date)
      if (start && (!p.min_date || start < p.min_date)) p.min_date = start
      if (end   && (!p.max_date || end   > p.max_date)) p.max_date = end
    }
    return Array.from(map.values()).sort((a, b) => {
      const ad = a.min_date?.getTime() ?? 0
      const bd = b.min_date?.getTime() ?? 0
      return ad - bd
    })
  }, [rows])

  const filtered = useMemo(() => {
    let ps = projects
    if (omv2Only) ps = ps.filter(p => !!p.omv2_project_id)
    if (search.trim()) {
      const q = search.toLowerCase()
      ps = ps.filter(p =>
        p.project_title.toLowerCase().includes(q) ||
        p.rows.some(r => r.person_name.toLowerCase().includes(q) || (r.role || '').toLowerCase().includes(q))
      )
    }
    return ps
  }, [projects, omv2Only, search])

  function toggleAll() {
    if (expanded.size === filtered.length) {
      setExpanded(new Set())
    } else {
      setExpanded(new Set(filtered.map(p => p.sheet_name)))
    }
  }

  function handleNavigateToProject(_projectId: string) {
    setSelectedPersonId(null)
    setActivePanel('hr-resources')
  }

  // Today marker
  const today = new Date()
  const todayOffset = dayOffset(today)
  const todayPct = (todayOffset / YEAR_DAYS) * 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Resource Year View — 2026</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {projects.length} projects · {rows.length} allocations · {rows.filter(r => !!r.person_id).length} matched to persons
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={omv2Only} onChange={e => setOmv2Only(e.target.checked)} />
              OMV2 only
            </label>
            <button onClick={toggleAll} className="btn btn-sm" style={{ fontSize: 11 }}>
              {expanded.size === filtered.length ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search project or person…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', fontSize: 12, border: '1px solid var(--border)',
            borderRadius: 6, padding: '5px 10px', background: 'var(--bg3)',
            color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
          Loading…
        </div>
      ) : (
        <div ref={ganttRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {/* Sticky column + gantt header */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 20,
            display: 'flex', background: 'var(--bg2)', borderBottom: '2px solid var(--border)',
            height: 36,
          }}>
            {/* Name col */}
            <div style={{ width: 220, minWidth: 220, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Project / Person</span>
            </div>
            {/* Role/badge col */}
            <div style={{ width: 90, minWidth: 90, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Info</span>
            </div>
            {/* Month headers */}
            <div style={{ flex: 1, position: 'relative', height: '100%' }}>
              {MONTHS.map((m, i) => {
                const monthStart = new Date(YEAR, i, 1)
                const leftPct = (dayOffset(monthStart) / YEAR_DAYS) * 100
                return (
                  <div key={m} style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    top: 0, bottom: 0,
                    display: 'flex', alignItems: 'center',
                    borderLeft: '1px solid var(--border)',
                    paddingLeft: 4,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{m}</span>
                  </div>
                )
              })}
              {/* Today line */}
              {todayOffset >= 0 && todayOffset <= YEAR_DAYS && (
                <div style={{
                  position: 'absolute',
                  left: `${todayPct}%`,
                  top: 0, bottom: 0,
                  width: 2, background: 'var(--accent)', opacity: 0.8,
                  pointerEvents: 'none',
                }} />
              )}
            </div>
          </div>

          {/* Month grid lines overlay (behind rows) */}
          <div style={{ position: 'relative' }}>
            {/* Grid lines */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 310, right: 0, pointerEvents: 'none', zIndex: 1,
            }}>
              {MONTHS.map((m, i) => {
                const monthStart = new Date(YEAR, i, 1)
                const leftPct = (dayOffset(monthStart) / YEAR_DAYS) * 100
                return (
                  <div key={m} style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    top: 0, bottom: 0,
                    borderLeft: '1px solid var(--border)',
                    opacity: 0.5,
                  }} />
                )
              })}
              {/* Today line through content */}
              {todayOffset >= 0 && todayOffset <= YEAR_DAYS && (
                <div style={{
                  position: 'absolute',
                  left: `${todayPct}%`,
                  top: 0, bottom: 0,
                  width: 2, background: 'var(--accent)', opacity: 0.3,
                  pointerEvents: 'none',
                }} />
              )}
            </div>

            {/* Project rows */}
            {filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No projects found
              </div>
            ) : filtered.map((project, idx) => {
              const color = PROJECT_COLORS[idx % PROJECT_COLORS.length]
              return (
                <ProjectRow
                  key={project.sheet_name}
                  project={project}
                  color={color}
                  totalWidth={ganttWidth}
                  expanded={expanded.has(project.sheet_name)}
                  onToggle={() => {
                    const next = new Set(expanded)
                    next.has(project.sheet_name) ? next.delete(project.sheet_name) : next.add(project.sheet_name)
                    setExpanded(next)
                  }}
                  onClickPerson={setSelectedPersonId}
                  onNavigateToProject={handleNavigateToProject}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Profile Drawer */}
      {selectedPersonId && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setSelectedPersonId(null)}
          />
          <PersonProfileDrawer
            personId={selectedPersonId}
            onClose={() => setSelectedPersonId(null)}
            onNavigateToProject={handleNavigateToProject}
          />
        </>
      )}
    </div>
  )
}
