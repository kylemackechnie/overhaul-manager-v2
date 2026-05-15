/**
 * CrewConfirmationPanel.tsx
 * Per-project mob readiness view for the Resource Manager.
 * Shows every person on a project checked against:
 * Confirmed / Flights / Accom / Car / Inductions / Medical
 *
 * Key data sources:
 * - resources table: the people + flight/accom/car required/booked booleans
 * - cars table:        car_booked derived via cars.person_id = resources.id
 * - accommodation:     accom_booked derived via resources.id in occupants JSONB
 * - persons:           induction dates + medical
 * - projects.induction_data JSONB: induction status (existing system)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackerRow {
  id: string
  name: string
  role: string | null
  shift: string | null
  category: string | null
  mob_in: string | null
  mob_out: string | null
  person_id: string | null
  full_name: string | null
  gid: string | null
  // persons compliance
  induction_ehs_date: string | null
  induction_qual_date: string | null
  medical_date: string | null
  // required flags
  flight_required: boolean
  accom_required: boolean
  car_required: boolean
  // booking details (null = not booked)
  flights_text: string | null        // resources.flights free text
  accom_detail: string | null        // accommodation.property
  car_detail: string | null          // cars: vendor · vehicle_type
  ind_status: 'ok' | 'expiring' | 'expired' | 'missing'
  med_status: 'ok' | 'expiring' | 'expired' | 'missing'
  overall: 'ready' | 'warn' | 'hold' | 'unconfirmed'
}

interface Project {
  id: string
  name: string
  client: string | null
  start_date: string | null
  end_date: string | null
}

type StatusFilter = 'all' | 'ready' | 'warn' | 'hold' | 'unconfirmed'
type SortCol = 'name' | 'mob_in' | 'mob_out' | 'overall'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  ready:       { label: '🟢 Ready',       bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  warn:        { label: '⚠ Warning',      bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  hold:        { label: '🔴 On Hold',      bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  unconfirmed: { label: '⏳ Unconfirmed', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateStatus(date: string | null, mobOut: string | null): 'ok' | 'expiring' | 'expired' | 'missing' {
  if (!date) return 'missing'
  const today = new Date().toISOString().slice(0, 10)
  const soon  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  if (date < today) return 'expired'
  // Also flag if expiring before demob date
  const expiryBeforeDemob = mobOut && date < mobOut
  if (date <= soon || expiryBeforeDemob) return 'expiring'
  return 'ok'
}

function overallStatus(row: Omit<TrackerRow, 'overall'>): TrackerRow['overall'] {
  if (row.ind_status === 'expired' || row.med_status === 'expired') return 'hold'
  if (row.flight_required && !row.flights_text) return 'warn'
  if (row.accom_required  && !row.accom_detail) return 'warn'
  if (row.car_required    && !row.car_detail)   return 'warn'
  if (row.ind_status === 'missing' || row.ind_status === 'expiring') return 'warn'
  if (row.med_status === 'missing' || row.med_status === 'expiring') return 'warn'
  if (!row.mob_in) return 'unconfirmed'
  return 'ready'
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

// ── Check cell ────────────────────────────────────────────────────────────────

type CheckState = 'yes' | 'no' | 'warn' | 'na' | 'missing'

function Check({ state, title }: { state: CheckState; title?: string }) {
  const styles: Record<CheckState, { bg: string; color: string; icon: string }> = {
    yes:     { bg: '#d1fae5', color: '#065f46', icon: '✓' },
    no:      { bg: '#fee2e2', color: '#991b1b', icon: '✗' },
    warn:    { bg: '#fef3c7', color: '#92400e', icon: '⚠' },
    na:      { bg: 'var(--bg3)', color: 'var(--text3)', icon: '—' },
    missing: { bg: '#f1f5f9', color: '#94a3b8', icon: '?' },
  }
  const s = styles[state]
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 4,
        background: s.bg, color: s.color,
        fontSize: 11, fontWeight: 700,
      }}
    >
      {s.icon}
    </span>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function CrewConfirmationPanel() {
  const { activeProject } = useAppStore()
  const [rows, setRows] = useState<TrackerRow[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('mob_in')
  const [sortAsc, setSortAsc] = useState(true)

  // Load project list
  useEffect(() => {
    supabase.from('projects')
      .select('id, name, client, start_date, end_date')
      .not('name', 'ilike', '%test%')
      .neq('name', 'tet')
      .order('start_date', { ascending: false })
      .then(({ data }) => {
        const ps = (data || []) as Project[]
        setProjects(ps)
        // Default to activeProject if available, else first
        const defaultId = activeProject?.id || ps[0]?.id || ''
        setSelectedProjectId(defaultId)
      })
  }, [activeProject?.id])

  const load = useCallback(async () => {
    if (!selectedProjectId) return
    setLoading(true)

    // 1. Resources + persons for this project
    const { data: resData } = await supabase
      .from('resources')
      .select(`
        id, name, role, shift, category, mob_in, mob_out, person_id, flights,
        flight_required, accom_required, car_required,
        persons:person_id (full_name, gid, induction_ehs_date, induction_qual_date, medical_date)
      `)
      .eq('project_id', selectedProjectId)
      .order('name')

    // 2. Cars booked (cars.person_id = resources.id) — fetch display detail
    const { data: carData } = await supabase
      .from('cars')
      .select('person_id, vendor, vehicle_type, reservation')
      .eq('project_id', selectedProjectId)

    // Map resources.id → car detail string
    const carDetailMap = new Map<string, string>()
    for (const car of (carData || []) as { person_id: string; vendor: string | null; vehicle_type: string | null; reservation: string | null }[]) {
      if (!car.person_id) continue
      const parts = [car.vendor, car.vehicle_type].filter(Boolean).join(' · ')
      carDetailMap.set(car.person_id, parts || 'Car booked')
    }

    // 3. Accommodation — fetch property name and map by occupant resources.id
    const { data: accomData } = await supabase
      .from('accommodation')
      .select('occupants, property, vendor')
      .eq('project_id', selectedProjectId)

    const accomDetailMap = new Map<string, string>()
    for (const a of (accomData || []) as { occupants: string[]; property: string | null; vendor: string | null }[]) {
      const detail = a.property || a.vendor || 'Accommodation booked'
      const occ = a.occupants || []
      occ.forEach(id => accomDetailMap.set(id, detail))
    }

    // Build rows
    const built: TrackerRow[] = ((resData || []) as Record<string, unknown>[]).map(r => {
      const p = r.persons as Record<string, unknown> | null
      const mobOut = r.mob_out as string | null

      const ind_ehs  = dateStatus(p?.induction_ehs_date as string | null, mobOut)
      const ind_qual = dateStatus(p?.induction_qual_date as string | null, mobOut)
      const med      = dateStatus(p?.medical_date as string | null, mobOut)

      // Combined induction status = worst of ehs/qual
      const ind_status: TrackerRow['ind_status'] =
        (ind_ehs === 'expired' || ind_qual === 'expired') ? 'expired' :
        (ind_ehs === 'expiring' || ind_qual === 'expiring') ? 'expiring' :
        (ind_ehs === 'missing' && ind_qual === 'missing') ? 'missing' : 'ok'

      const car_detail   = carDetailMap.get(r.id as string) ?? null
      const accom_detail = accomDetailMap.get(r.id as string) ?? null

      const partial: Omit<TrackerRow, 'overall'> = {
        id:               r.id as string,
        name:             r.name as string,
        role:             r.role as string | null,
        shift:            r.shift as string | null,
        category:         r.category as string | null,
        mob_in:           r.mob_in as string | null,
        mob_out:          mobOut,
        person_id:        r.person_id as string | null,
        flights_text:     (r.flights as string | null) || null,
        flight_required:  (r.flight_required as boolean) ?? false,
        accom_required:   (r.accom_required as boolean) ?? false,
        car_required:     (r.car_required as boolean) ?? false,
        accom_detail,
        car_detail,
        full_name:        p?.full_name as string | null,
        gid:              p?.gid as string | null,
        induction_ehs_date:  p?.induction_ehs_date as string | null,
        induction_qual_date: p?.induction_qual_date as string | null,
        medical_date:     p?.medical_date as string | null,
        ind_status,
        med_status: med,
      }
      return { ...partial, overall: overallStatus(partial) }
    })

    setRows(built)
    setLoading(false)
  }, [selectedProjectId])

  useEffect(() => { load() }, [load])

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rs = rows.filter(r => {
      if (statusFilter !== 'all' && r.overall !== statusFilter) return false
      if (shiftFilter !== 'all' && (r.shift ?? 'day') !== shiftFilter) return false
      if (!q) return true
      return (
        (r.full_name || r.name).toLowerCase().includes(q) ||
        (r.role || '').toLowerCase().includes(q)
      )
    })
    rs = [...rs].sort((a, b) => {
      let av: string, bv: string
      switch (sortCol) {
        case 'mob_in':   av = a.mob_in  ?? ''; bv = b.mob_in  ?? ''; break
        case 'mob_out':  av = a.mob_out ?? ''; bv = b.mob_out ?? ''; break
        case 'overall':  av = a.overall;        bv = b.overall;        break
        default:         av = (a.full_name || a.name).toLowerCase(); bv = (b.full_name || b.name).toLowerCase()
      }
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rs
  }, [rows, statusFilter, shiftFilter, search, sortCol, sortAsc])

  // Stats
  const stats = useMemo(() => {
    const counts = { ready: 0, warn: 0, hold: 0, unconfirmed: 0 }
    rows.forEach(r => counts[r.overall]++)
    return counts
  }, [rows])

  function toggleSort(col: SortCol) {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  function SortTh({ col, label, style }: { col: SortCol; label: string; style?: React.CSSProperties }) {
    const active = sortCol === col
    return (
      <th
        onClick={() => toggleSort(col)}
        style={{
          padding: '9px 10px', fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: active ? '#fff' : 'rgba(255,255,255,0.5)',
          cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
          background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
          textAlign: 'left', ...style,
        }}
      >
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  function exportCSV() {
    const headers = ['Name','GID','Role','Shift','Mob In','Mob Out','Flights','Accom Booked','Car Booked','EHS Date','QUAL Date','Medical Date','Status']
    const csvRows = filtered.map(r => [
      r.full_name || r.name, r.gid || '', r.role || '', r.shift || '',
      r.mob_in || '', r.mob_out || '',
      r.flights_text || '', r.accom_detail || '', r.car_detail || '',
      r.induction_ehs_date || '', r.induction_qual_date || '', r.medical_date || '',
      r.overall,
    ])
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `crew_confirmation_${selectedProjectId.slice(0, 8)}.csv`
    a.click()
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              Crew Confirmation Tracker
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {selectedProject ? `${selectedProject.name} · ${rows.length} people` : 'Select a project'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={exportCSV} title="Export CSV">⬇ Export</button>
            <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
          </div>
        </div>

        {/* Project selector */}
        <div style={{ marginBottom: 12 }}>
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="btn btn-sm btn-secondary"
            style={{ fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', padding: '6px 10px' }}
          >
            <option value="">— Select project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {(Object.entries(stats) as [TrackerRow['overall'], number][]).map(([key, val]) => {
            const s = STATUS_STYLE[key]
            return (
              <div
                key={key}
                onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
                style={{
                  background: statusFilter === key ? s.bg : 'var(--bg)',
                  border: `1px solid ${statusFilter === key ? s.border : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', padding: '8px 12px', cursor: 'pointer',
                  borderTop: `3px solid ${s.border}`, minWidth: 90, transition: 'all 0.1s',
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: statusFilter === key ? s.color : 'var(--text)' }}>{val}</div>
                <div style={{ fontSize: 10, color: statusFilter === key ? s.color : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label.split(' ').slice(1).join(' ')}</div>
              </div>
            )
          })}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', borderTop: '3px solid var(--border2)', minWidth: 70 }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{rows.length}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search" placeholder="Search name or role…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 180px', minWidth: 160, fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--bg3)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }}
          />
          <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}
            className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
            <option value="all">All shifts</option>
            <option value="day">Day Shift</option>
            <option value="night">Night Shift</option>
          </select>
          {(search || statusFilter !== 'all' || shiftFilter !== 'all') && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setSearch(''); setStatusFilter('all'); setShiftFilter('all') }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
            Showing {filtered.length} of {rows.length}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: '6px 20px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, flexShrink: 0, flexWrap: 'wrap' }}>
        {([
          { icon: '✓', label: 'Booked', bg: '#d1fae5', color: '#065f46' },
          { icon: '✗', label: 'Required — not booked', bg: '#fee2e2', color: '#991b1b' },
          { icon: '⚠', label: 'Expiring soon', bg: '#fef3c7', color: '#92400e' },
          { icon: '—', label: 'Not required', bg: 'var(--bg3)', color: 'var(--text3)' },
          { icon: '?', label: 'No data', bg: '#f1f5f9', color: '#94a3b8' },
        ]).map(({ icon, label, bg, color }) => (
          <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text3)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 3, background: bg, color, fontSize: 10, fontWeight: 700 }}>{icon}</span>
            {label}
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div className="loading-center">
            <span className="spinner" />
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
          </div>
        ) : !selectedProjectId ? (
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)' }}>Select a project to begin</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)' }}>No people match your filters</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <SortTh col="name"    label="Name / Role"   style={{ paddingLeft: 16, minWidth: 160 }} />
                <th style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, zIndex: 10, color: 'var(--text3)', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>Shift</th>
                <SortTh col="mob_in"  label="Mob In"   />
                <SortTh col="mob_out" label="Mob Out"  />
                <th style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, zIndex: 10, color: 'var(--text3)', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>✈ Flights</th>
                <th style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, zIndex: 10, color: 'var(--text3)', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>🏨 Accom</th>
                <th style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, zIndex: 10, color: 'var(--text3)', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>🚗 Car</th>
                <th style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, zIndex: 10, color: 'var(--text3)', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>Inductions</th>
                <th style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', top: 0, zIndex: 10, color: 'var(--text3)', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>Medical</th>
                <SortTh col="overall" label="Status" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const s = STATUS_STYLE[r.overall]
                const rowBg = r.overall === 'hold'
                  ? '#fff5f5'
                  : r.overall === 'warn'
                  ? '#fffbeb'
                  : r.overall === 'ready'
                  ? '#f0fdf4'
                  : i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)'

                // Flight check
                const flightCheck: CheckState = !r.flight_required ? 'na' : r.flights_text ? 'yes' : 'no'
                const accomCheck:  CheckState = !r.accom_required  ? 'na' : r.accom_detail  ? 'yes' : 'no'
                const carCheck:    CheckState = !r.car_required    ? 'na' : r.car_detail    ? 'yes' : 'no'
                const indCheck:    CheckState = r.ind_status === 'ok' ? 'yes' : r.ind_status === 'expiring' ? 'warn' : r.ind_status === 'expired' ? 'no' : 'missing'
                const medCheck:    CheckState = r.med_status === 'ok' ? 'yes' : r.med_status === 'expiring' ? 'warn' : r.med_status === 'expired' ? 'no' : 'missing'

                const indTitle = `EHS: ${fmtDate(r.induction_ehs_date)} · QUAL: ${fmtDate(r.induction_qual_date)}`
                const medTitle = `Medical: ${fmtDate(r.medical_date)}`

                return (
                  <tr key={r.id} style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
                    {/* Name */}
                    <td style={{ padding: '8px 10px 8px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {r.full_name || r.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                        {r.role || '—'}
                        {r.gid && <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', marginLeft: 6 }}>{r.gid}</span>}
                      </div>
                    </td>

                    {/* Shift */}
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                        background: r.shift === 'night' ? '#1e1b4b' : '#e0f2fe',
                        color: r.shift === 'night' ? '#a5b4fc' : '#0369a1',
                      }}>
                        {r.shift === 'night' ? 'NS' : 'DS'}
                      </span>
                    </td>

                    {/* Dates */}
                    <td style={{ padding: '8px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.mob_in)}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.mob_out)}
                    </td>

                    {/* Checks */}
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <Check state={flightCheck} title={!r.flight_required ? 'Not required' : r.flights_text ? r.flights_text : 'Required — not yet booked'} />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <Check state={accomCheck} title={!r.accom_required ? 'Not required' : r.accom_detail ? r.accom_detail : 'Required — not yet booked'} />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <Check state={carCheck} title={!r.car_required ? 'Not required' : r.car_detail ? r.car_detail : 'Required — not yet booked'} />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <Check state={indCheck} title={indTitle} />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <Check state={medCheck} title={medTitle} />
                    </td>

                    {/* Status pill */}
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10,
                        background: s.bg, color: s.color, border: `1px solid ${s.border}`,
                      }}>
                        {s.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
