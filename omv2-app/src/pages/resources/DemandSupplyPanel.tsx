/**
 * DemandSupplyPanel.tsx
 * Cross-project demand vs supply view for the Resource Manager.
 *
 * Two modes:
 *   Crew Plan mode  — shows crew_plan slots (planned requirements) vs filled resources
 *                     Only shows when crew plan slots exist for a project
 *   Headcount mode  — shows actual resources grouped by role/category
 *                     Always available as a fallback / complementary view
 *
 * Open slots show a red "+ OPEN" chip that opens the PersonPicker.
 * Filled slots show the assigned person's name chip.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonPicker } from '../../components/PersonPicker'
import type { Person } from '../../lib/persons'
import { toast } from '../../components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrewSlot {
  id: string
  project_id: string
  role: string
  shift: string | null
  category: string | null
  qty: number
  mob_in: string | null
  mob_out: string | null
  wbs: string | null
  source: string
  flight_required: boolean
  accom_required: boolean
  car_required: boolean
  // filled resources linked to this slot
  filled: { id: string; name: string; person_id: string | null }[]
}

interface ResourceRow {
  id: string
  name: string
  role: string | null
  shift: string | null
  category: string | null
  mob_in: string | null
  mob_out: string | null
  person_id: string | null
  project_id: string
  crew_plan_id: string | null
}

interface Project {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  slot_count: number
  resource_count: number
  fill_pct: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

// ── Person chip ───────────────────────────────────────────────────────────────

function PersonChip({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: 'var(--accent-light)', border: '1px solid var(--accent)',
      color: 'var(--accent)', fontSize: 10, fontWeight: 600,
      padding: '2px 7px', borderRadius: 3,
    }}>
      {name}
    </span>
  )
}

function OpenChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: '#fff1f2', border: '1px dashed var(--red)',
        color: 'var(--red)', fontSize: 10, fontWeight: 700,
        padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#ffe4e6')}
      onMouseLeave={e => (e.currentTarget.style.background = '#fff1f2')}
    >
      + OPEN
    </button>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function FillBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'var(--green)' : pct >= 75 ? 'var(--accent)' : pct >= 50 ? 'var(--orange)' : 'var(--red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, height: 6, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color }}>{Math.round(pct)}%</span>
    </div>
  )
}

// ── Headcount table (fallback when no crew plan) ──────────────────────────────

function HeadcountView({ resources }: { resources: ResourceRow[] }) {
  // Group by role
  type RoleGroup = { role: string; category: string | null; ds: string[]; ns: string[]; total: number }
  const grouped = new Map<string, RoleGroup>()

  for (const r of resources) {
    const key = `${r.role || 'Unassigned'}__${r.category || ''}`
    if (!grouped.has(key)) {
      grouped.set(key, { role: r.role || 'Unassigned', category: r.category, ds: [], ns: [], total: 0 })
    }
    const g = grouped.get(key)!
    g.total++
    if (r.shift === 'night') g.ns.push(r.name)
    else g.ds.push(r.name)
  }

  const sorted = [...grouped.values()].sort((a, b) => {
    const catOrder = ['management', 'trades', 'seag', 'subcontractor']
    const ca = catOrder.indexOf(a.category || '') ?? 99
    const cb = catOrder.indexOf(b.category || '') ?? 99
    if (ca !== cb) return ca - cb
    return a.role.localeCompare(b.role)
  })

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg3)', borderBottom: '2px solid var(--border)' }}>
            {['Role', 'Category', 'Day Shift', 'Night Shift', 'Total'].map(h => (
              <th key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((g, i) => {
            const cat = g.category
            const catStyle = cat ? (CAT_STYLE[cat] ?? null) : null
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg)' }}>
                <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{g.role}</td>
                <td style={{ padding: '7px 10px' }}>
                  {cat && catStyle
                    ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, textTransform: 'capitalize', ...catStyle }}>{cat}</span>
                    : <span style={{ color: 'var(--text3)' }}>—</span>
                  }
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {g.ds.length > 0
                      ? g.ds.map((n, j) => <PersonChip key={j} name={n} />)
                      : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                    }
                  </div>
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {g.ns.length > 0
                      ? g.ns.map((n, j) => <PersonChip key={j} name={n} />)
                      : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                    }
                  </div>
                </td>
                <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{g.total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function DemandSupplyPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [slots, setSlots] = useState<CrewSlot[]>([])
  const [resources, setResources] = useState<ResourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'plan' | 'headcount'>('plan')
  const [projFilter, setProjFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [showOpenOnly, setShowOpenOnly] = useState(false)
  // Picker state
  const [pickerSlot, setPickerSlot] = useState<{ slotId: string; projectId: string; role: string; mobIn: string | null; mobOut: string | null } | null>(null)
  const [assigning, setAssigning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)

    const [projData, slotsData, resData] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, start_date, end_date')
        .not('name', 'ilike', '%test%')
        .neq('name', 'tet')
        .order('start_date'),

      supabase
        .from('crew_plan')
        .select('id, project_id, role, shift, category, qty, mob_in, mob_out, wbs, source, flight_required, accom_required, car_required')
        .order('category').order('role'),

      supabase
        .from('resources')
        .select('id, name, role, shift, category, mob_in, mob_out, person_id, project_id, crew_plan_id')
        .order('name'),
    ])

    const resRows = (resData.data || []) as ResourceRow[]
    const slotRows = (slotsData.data || []) as Omit<CrewSlot, 'filled'>[]

    // Map crew_plan_id → filled resources
    const slotFillMap = new Map<string, { id: string; name: string; person_id: string | null }[]>()
    for (const r of resRows) {
      if (!r.crew_plan_id) continue
      if (!slotFillMap.has(r.crew_plan_id)) slotFillMap.set(r.crew_plan_id, [])
      slotFillMap.get(r.crew_plan_id)!.push({ id: r.id, name: r.name, person_id: r.person_id })
    }

    const builtSlots: CrewSlot[] = slotRows.map(s => ({
      ...s,
      filled: slotFillMap.get(s.id) ?? [],
    }))

    // Build project summary
    const projs: Project[] = ((projData.data || []) as { id: string; name: string; start_date: string | null; end_date: string | null }[]).map(p => {
      const projSlots = builtSlots.filter(s => s.project_id === p.id)
      const projRes   = resRows.filter(r => r.project_id === p.id)
      const totalSlots = projSlots.reduce((acc, s) => acc + s.qty, 0)
      const totalFilled = projSlots.reduce((acc, s) => acc + s.filled.length, 0)
      return {
        ...p,
        slot_count:     totalSlots,
        resource_count: projRes.length,
        fill_pct:       totalSlots > 0 ? (totalFilled / totalSlots) * 100 : 0,
      }
    })

    setProjects(projs)
    setSlots(builtSlots)
    setResources(resRows)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAssign(person: Person, slot: typeof pickerSlot) {
    if (!slot) return
    setAssigning(true)

    // Create resources row linked to this crew plan slot
    const { error } = await supabase.from('resources').insert({
      project_id:   slot.projectId,
      person_id:    person.id,
      name:         person.full_name,
      role:         slot.role,
      category:     person.default_category || 'trades',
      mob_in:       slot.mobIn || null,
      mob_out:      slot.mobOut || null,
      crew_plan_id: slot.slotId,
    })

    if (error) { toast(error.message, 'error'); setAssigning(false); return }
    toast(`${person.full_name} assigned — slot filled`, 'success')
    setPickerSlot(null)
    setAssigning(false)
    load()
  }

  // Filtered views
  const filteredProjects = useMemo(() =>
    projects.filter(p => projFilter === 'all' || p.id === projFilter),
    [projects, projFilter]
  )

  const filteredSlots = useMemo(() => {
    return slots.filter(s => {
      if (projFilter !== 'all' && s.project_id !== projFilter) return false
      if (catFilter !== 'all' && s.category !== catFilter) return false
      if (showOpenOnly && s.filled.length >= s.qty) return false
      return true
    })
  }, [slots, projFilter, catFilter, showOpenOnly])

  const filteredResources = useMemo(() =>
    resources.filter(r => {
      if (projFilter !== 'all' && r.project_id !== projFilter) return false
      if (catFilter !== 'all' && r.category !== catFilter) return false
      return true
    }),
    [resources, projFilter, catFilter]
  )

  const totalOpen = useMemo(() =>
    slots.reduce((acc, s) => acc + Math.max(0, s.qty - s.filled.length), 0),
    [slots]
  )

  const projectHasSlots = (projId: string) => slots.some(s => s.project_id === projId)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Demand vs Supply</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Crew plan slots vs filled resources · {totalOpen > 0 ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{totalOpen} open slots</span> : 'All slots filled'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
          </div>
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 2 }}>
            {([['plan', '🎯 Crew Plan'], ['headcount', '📋 Headcount']] as [string, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setViewMode(v as 'plan' | 'headcount')}
                style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: viewMode === v ? 'var(--bg2)' : 'transparent',
                  color: viewMode === v ? 'var(--accent)' : 'var(--text3)',
                  boxShadow: viewMode === v ? 'var(--shadow)' : 'none',
                }}>
                {label}
              </button>
            ))}
          </div>
          {viewMode === 'plan' && slots.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--orange)', fontStyle: 'italic' }}>
              No crew plan slots yet — add them via Projects → Resources → 🎯 Crew Plan
            </span>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={projFilter} onChange={e => setProjFilter(e.target.value)}
            className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
            <option value="all">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
            <option value="all">All categories</option>
            <option value="trades">Trades</option>
            <option value="management">Management</option>
            <option value="seag">SE AG</option>
            <option value="subcontractor">Subcontractor</option>
          </select>
          {viewMode === 'plan' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text2)', userSelect: 'none' }}>
              <input type="checkbox" checked={showOpenOnly} onChange={e => setShowOpenOnly(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
              Open slots only
            </label>
          )}
          {(projFilter !== 'all' || catFilter !== 'all' || showOpenOnly) && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setProjFilter('all'); setCatFilter('all'); setShowOpenOnly(false) }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /><span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span></div>
        ) : viewMode === 'plan' ? (
          // ── Crew Plan view ─────────────────────────────────────────────────
          slots.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>No crew plan slots defined</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 360, textAlign: 'center', marginBottom: 16 }}>
                PMs define required roles per project under Projects → Resources → Crew Plan tab.
                Slots appear here once defined, and open ones can be filled directly from this view.
              </div>
            </div>
          ) : (
            filteredProjects.map(proj => {
              const projSlots = filteredSlots.filter(s => s.project_id === proj.id)
              if (projSlots.length === 0 && !projectHasSlots(proj.id)) return null
              const totalQty    = projSlots.reduce((acc, s) => acc + s.qty, 0)
              const totalFilled = projSlots.reduce((acc, s) => acc + Math.min(s.qty, s.filled.length), 0)
              const fillPct     = totalQty > 0 ? (totalFilled / totalQty) * 100 : 0

              return (
                <div key={proj.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
                  {/* Project header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{proj.name}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', marginTop: 2 }}>
                        {fmtDate(proj.start_date)} → {fmtDate(proj.end_date)} · {proj.resource_count} resources
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{totalFilled}/{totalQty} slots filled</span>
                      <FillBar pct={fillPct} />
                    </div>
                  </div>

                  {/* Slots */}
                  {projSlots.length === 0 ? (
                    <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
                      No slots match current filters
                    </div>
                  ) : (
                    <div>
                      {projSlots.map(slot => {
                        const cat = slot.category
                        const catStyle = cat ? (CAT_STYLE[cat] ?? null) : null
                        const openCount = Math.max(0, slot.qty - slot.filled.length)
                        const allFilled = openCount === 0

                        return (
                          <div key={slot.id} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '8px 16px', borderBottom: '1px solid var(--border)',
                            background: allFilled ? '#f0fdf4' : openCount > 0 ? '#fff7f7' : 'var(--bg2)',
                            flexWrap: 'wrap',
                          }}>
                            {/* Role */}
                            <div style={{ minWidth: 180, flex: '0 0 180px' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{slot.role}</div>
                              {slot.qty > 1 && <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>×{slot.qty}</div>}
                            </div>

                            {/* Category */}
                            <div style={{ width: 70, flexShrink: 0 }}>
                              {cat && catStyle
                                ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, textTransform: 'capitalize', ...catStyle }}>{cat === 'management' ? 'Mgmt' : cat === 'subcontractor' ? 'Sub' : cat === 'seag' ? 'SE AG' : 'Trades'}</span>
                                : null
                              }
                            </div>

                            {/* Shift */}
                            <div style={{ width: 32, flexShrink: 0 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                                background: slot.shift === 'night' ? '#1e1b4b' : '#e0f2fe',
                                color: slot.shift === 'night' ? '#a5b4fc' : '#0369a1',
                              }}>
                                {slot.shift === 'night' ? 'NS' : 'DS'}
                              </span>
                            </div>

                            {/* Dates */}
                            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {fmtDate(slot.mob_in)} → {fmtDate(slot.mob_out)}
                            </div>

                            {/* Chips — filled + open */}
                            <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              {slot.filled.map(f => <PersonChip key={f.id} name={f.name} />)}
                              {Array.from({ length: openCount }).map((_, i) => (
                                <OpenChip
                                  key={i}
                                  onClick={() => setPickerSlot({
                                    slotId: slot.id,
                                    projectId: slot.project_id,
                                    role: slot.role,
                                    mobIn: slot.mob_in,
                                    mobOut: slot.mob_out,
                                  })}
                                />
                              ))}
                            </div>

                            {/* Logistics icons */}
                            {(slot.flight_required || slot.accom_required || slot.car_required) && (
                              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                {slot.flight_required && <span title="Flights required" style={{ fontSize: 11 }}>✈</span>}
                                {slot.accom_required && <span title="Accommodation required" style={{ fontSize: 11 }}>🏨</span>}
                                {slot.car_required && <span title="Car required" style={{ fontSize: 11 }}>🚗</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )
        ) : (
          // ── Headcount view ─────────────────────────────────────────────────
          filteredProjects.map(proj => {
            const projRes = filteredResources.filter(r => r.project_id === proj.id)
            if (projRes.length === 0) return null
            return (
              <div key={proj.id} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{proj.name}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                    {fmtDate(proj.start_date)} → {fmtDate(proj.end_date)} · {projRes.length} people
                  </div>
                </div>
                <HeadcountView resources={projRes} />
              </div>
            )
          })
        )}
      </div>

      {/* Person picker for slot filling */}
      {pickerSlot && !assigning && (
        <PersonPicker
          title="Fill Open Slot"
          context={`${pickerSlot.role} · ${fmtDate(pickerSlot.mobIn)} → ${fmtDate(pickerSlot.mobOut)}`}
          onSelect={person => handleAssign(person, pickerSlot)}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  )
}
