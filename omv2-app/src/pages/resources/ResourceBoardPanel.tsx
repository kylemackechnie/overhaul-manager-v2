/**
 * ResourceBoardPanel.tsx
 * The Resource Manager's home screen.
 * Cross-project view of all people in resources joined to persons.
 * Grouped by status: On Site / Incoming / Free / Compliance Hold.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonProfileDrawer } from '../personnel/PersonProfileDrawer'
import { PersonPicker } from '../../components/PersonPicker'
import type { Person } from '../../lib/persons'
import { toast } from '../../components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BoardResource {
  id: string
  name: string
  role: string | null
  shift: string | null
  category: string | null
  mob_in: string | null
  mob_out: string | null
  project_id: string
  person_id: string | null
  flight_required: boolean
  accom_required: boolean
  car_required: boolean
  full_name: string | null
  default_category: string | null
  gid: string | null
  status: string | null
  medical_date: string | null
  induction_ehs_date: string | null
  induction_qual_date: string | null
  project_name: string
}

interface Project {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
}

type BoardStatus = 'onsite' | 'incoming' | 'free' | 'hold'

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

const PROJ_COLORS = [
  '#00898a', '#0369a1', '#7c3aed', '#d97706', '#dc2626',
  '#059669', '#0891b2', '#4f46e5', '#be123c', '#15803d',
]

const PLACEHOLDER_NAMES = ['TBC', 'Scaffolder 3', 'Scaffolder 5']

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatus(r: BoardResource): BoardStatus {
  const today = new Date().toISOString().slice(0, 10)
  const ehsExp  = r.induction_ehs_date  && r.induction_ehs_date  < today
  const qualExp = r.induction_qual_date && r.induction_qual_date < today
  const medExp  = r.medical_date        && r.medical_date         < today
  if (ehsExp || qualExp || medExp) return 'hold'
  const mobIn  = r.mob_in  ?? ''
  const mobOut = r.mob_out ?? ''
  if (mobIn <= today && (!mobOut || mobOut >= today)) return 'onsite'
  if (mobIn > today) {
    const daysUntil = Math.round((new Date(mobIn).getTime() - Date.now()) / 86400000)
    if (daysUntil <= 14) return 'incoming'
  }
  return 'free'
}

function complianceDot(r: BoardResource): 'green' | 'amber' | 'red' | 'grey' {
  const today = new Date().toISOString().slice(0, 10)
  const soon  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  const dates = [r.induction_ehs_date, r.induction_qual_date, r.medical_date]
  if (!dates.some(Boolean)) return 'grey'
  if (dates.some(d => d && d < today))              return 'red'
  if (dates.some(d => d && d >= today && d <= soon)) return 'amber'
  return 'green'
}

function complianceLabel(r: BoardResource): string {
  const today = new Date().toISOString().slice(0, 10)
  const soon  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  if (!r.induction_ehs_date && !r.induction_qual_date && !r.medical_date) return 'No induction data'
  if (r.induction_ehs_date  && r.induction_ehs_date  < today) return 'EHS expired'
  if (r.induction_qual_date && r.induction_qual_date < today) return 'QUAL expired'
  if (r.medical_date        && r.medical_date         < today) return 'Medical expired'
  if (r.induction_ehs_date  && r.induction_ehs_date  <= soon) return 'EHS expiring soon'
  if (r.induction_qual_date && r.induction_qual_date <= soon) return 'QUAL expiring soon'
  if (r.medical_date        && r.medical_date         <= soon) return 'Medical expiring soon'
  return 'All current'
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function shortProjName(name: string) {
  return name.replace(/Outage 2026\s*-?\s*/i, '').replace(/2026\s*-?\s*/i, '').trim().slice(0, 24)
}

// ── Person Card ────────────────────────────────────────────────────────────────

function PersonCard({
  resource, projColor, onOpenProfile, selected, onSelect,
}: {
  resource: BoardResource; projColor: string
  onOpenProfile: (personId: string) => void
  selected: boolean; onSelect: () => void
}) {
  const cat = resource.default_category || resource.category
  const catStyle = cat ? (CAT_STYLE[cat] ?? { bg: 'var(--bg3)', color: 'var(--text3)' }) : null
  const dot = complianceDot(resource)
  const dotColors = { green: 'var(--green)', amber: 'var(--orange)', red: 'var(--red)', grey: 'var(--text3)' }
  const dotColor = dotColors[dot]
  const label = complianceLabel(resource)
  const status = getStatus(resource)
  const isPlaceholder = !resource.person_id || PLACEHOLDER_NAMES.includes(resource.name)

  const today = new Date().toISOString().slice(0, 10)
  const daysUntilMob = resource.mob_in
    ? Math.round((new Date(resource.mob_in).getTime() - Date.now()) / 86400000)
    : null

  const borderColor = selected ? 'var(--accent)' : dot === 'red' ? '#fca5a5' : dot === 'amber' ? '#fcd34d' : 'var(--border)'

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? 'var(--accent-light)' : 'var(--bg2)',
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius)', padding: '11px 13px',
        cursor: 'pointer', opacity: isPlaceholder ? 0.55 : 1,
        transition: 'border-color 0.1s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.borderColor = borderColor }}
    >
      {/* Name + category */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {resource.full_name || resource.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {resource.role || '—'}
          </div>
        </div>
        {cat && catStyle && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, flexShrink: 0, textTransform: 'capitalize', ...catStyle }}>
            {cat === 'management' ? 'Mgmt' : cat === 'subcontractor' ? 'Sub' : cat === 'seag' ? 'SE AG' : 'Trades'}
          </span>
        )}
      </div>

      {/* Project + dates */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
          background: projColor + '20', color: projColor, border: `1px solid ${projColor}40`,
        }}>
          {shortProjName(resource.project_name)}
        </span>
        {status === 'incoming' && daysUntilMob !== null && (
          <span style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 600 }}>mobs {daysUntilMob}d</span>
        )}
        {status === 'onsite' && resource.mob_out && resource.mob_out >= today && (
          <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>→ {fmtDate(resource.mob_out)}</span>
        )}
      </div>

      {/* Compliance */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: dotColor, flex: 1 }}>{label}</span>
        {resource.person_id && !isPlaceholder && (
          <button
            onClick={e => { e.stopPropagation(); onOpenProfile(resource.person_id!) }}
            style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0, flexShrink: 0 }}
          >
            Profile →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Board Section ─────────────────────────────────────────────────────────────

function BoardSection({ title, dot, count, children, defaultOpen = true }: {
  title: string; dot: string; count: number
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 20 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 10 : 0, cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)' }}>{title}</span>
        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', padding: '1px 7px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)' }}>{count}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && children}
    </div>
  )
}

// ── Assign Modal ──────────────────────────────────────────────────────────────

function AssignModal({ person, projects, onAssign, onClose }: {
  person: Person; projects: Project[]
  onAssign: (projectId: string, role: string, mobIn: string, mobOut: string) => Promise<void>
  onClose: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [role, setRole] = useState(person.default_role || '')
  const [mobIn, setMobIn] = useState('')
  const [mobOut, setMobOut] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!projectId) return toast('Select a project', 'error')
    if (!mobIn)     return toast('Mob in date required', 'error')
    setSaving(true)
    await onAssign(projectId, role, mobIn, mobOut)
    setSaving(false)
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 440, background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', zIndex: 1101, overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Assign to Project</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{person.full_name}</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Project *</label>
            <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Role</label>
            <input className="input" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Mechanical Fitter DS" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Mob In *</label>
              <input className="input" type="date" value={mobIn} onChange={e => setMobIn(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Mob Out</label>
              <input className="input" type="date" value={mobOut} onChange={e => setMobOut(e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--accent)', padding: '6px 10px', background: 'var(--accent-light)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--accent)' }}>
            Creates a new row in the project's resource list. PM edits WBS, rate card and allowances from their Resources panel.
          </div>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
            Assign to project
          </button>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function ResourceBoardPanel() {
  const [resources, setResources] = useState<BoardResource[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [projFilter, setProjFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profilePersonId, setProfilePersonId] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [assignPerson, setAssignPerson] = useState<Person | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [resData, projData] = await Promise.all([
      supabase
        .from('resources')
        .select(`
          id, name, role, shift, category, mob_in, mob_out,
          project_id, person_id, flight_required, accom_required, car_required,
          persons:person_id (full_name, default_category, gid, status, medical_date, induction_ehs_date, induction_qual_date),
          projects:project_id (name, start_date, end_date)
        `)
        .order('mob_out', { ascending: false }),
      supabase
        .from('projects')
        .select('id, name, start_date, end_date')
        .not('name', 'ilike', '%test%')
        .neq('name', 'tet')
        .order('start_date'),
    ])

    const rows: BoardResource[] = ((resData.data || []) as Record<string, unknown>[]).map(r => {
      const p = (r.persons as Record<string, unknown> | null)
      const proj = (r.projects as Record<string, unknown> | null)
      return {
        id:                  r.id as string,
        name:                r.name as string,
        role:                r.role as string | null,
        shift:               r.shift as string | null,
        category:            r.category as string | null,
        mob_in:              r.mob_in as string | null,
        mob_out:             r.mob_out as string | null,
        project_id:          r.project_id as string,
        person_id:           r.person_id as string | null,
        flight_required:     (r.flight_required as boolean) ?? false,
        accom_required:      (r.accom_required as boolean) ?? false,
        car_required:        (r.car_required as boolean) ?? false,
        full_name:           p?.full_name as string | null,
        default_category:    p?.default_category as string | null,
        gid:                 p?.gid as string | null,
        status:              p?.status as string | null,
        medical_date:        p?.medical_date as string | null,
        induction_ehs_date:  p?.induction_ehs_date as string | null,
        induction_qual_date: p?.induction_qual_date as string | null,
        project_name:        proj?.name as string ?? 'Unknown',
      }
    })

    setResources(rows)
    setProjects((projData.data || []) as Project[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const projColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    projects.forEach((p, i) => { map[p.id] = PROJ_COLORS[i % PROJ_COLORS.length] })
    return map
  }, [projects])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return resources.filter(r => {
      if (catFilter !== 'all' && (r.default_category || r.category) !== catFilter) return false
      if (projFilter !== 'all' && r.project_id !== projFilter) return false
      if (!q) return true
      return (
        (r.full_name || r.name).toLowerCase().includes(q) ||
        (r.role || '').toLowerCase().includes(q) ||
        r.project_name.toLowerCase().includes(q)
      )
    })
  }, [resources, search, catFilter, projFilter])

  const groups = useMemo(() => {
    const g: Record<BoardStatus, BoardResource[]> = { onsite: [], incoming: [], free: [], hold: [] }
    for (const r of filtered) g[getStatus(r)].push(r)
    g.onsite.sort((a, b)   => (a.mob_out ?? '').localeCompare(b.mob_out ?? ''))
    g.incoming.sort((a, b) => (a.mob_in  ?? '').localeCompare(b.mob_in  ?? ''))
    g.free.sort((a, b)     => (b.mob_out ?? '').localeCompare(a.mob_out ?? ''))
    g.hold.sort((a, b)     => (a.full_name || a.name).localeCompare(b.full_name || b.name))
    return g
  }, [filtered])

  const stats = useMemo(() => ({
    onsite:   resources.filter(r => getStatus(r) === 'onsite').length,
    incoming: resources.filter(r => getStatus(r) === 'incoming').length,
    free:     resources.filter(r => getStatus(r) === 'free').length,
    hold:     resources.filter(r => getStatus(r) === 'hold').length,
    total:    resources.length,
  }), [resources])

  async function handleAssign(projectId: string, role: string, mobIn: string, mobOut: string) {
    if (!assignPerson) return
    const { error } = await supabase.from('resources').insert({
      project_id: projectId,
      person_id: assignPerson.id,
      name: assignPerson.full_name,
      role: role || assignPerson.default_role || '',
      category: assignPerson.default_category || 'trades',
      mob_in: mobIn || null,
      mob_out: mobOut || null,
    })
    if (error) { toast(error.message, 'error'); return }
    toast(`${assignPerson.full_name} assigned`, 'success')
    setAssignPerson(null)
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Resource Board</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>All people across active OMV2 projects · Live from resources table</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowPicker(true)}>+ Assign to project</button>
          </div>
        </div>

        {/* KPI */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {[
            { label: 'On Site',  val: stats.onsite,   color: 'var(--accent)' },
            { label: 'Incoming', val: stats.incoming,  color: 'var(--orange)' },
            { label: 'Free',     val: stats.free,      color: 'var(--green)' },
            { label: 'Hold',     val: stats.hold,      color: stats.hold > 0 ? 'var(--red)' : 'var(--text3)' },
            { label: 'Total',    val: stats.total,     color: 'var(--border2)' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', borderTop: `3px solid ${color}`, minWidth: 80 }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="search" placeholder="Search name, role, project…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 200px', minWidth: 180, fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--bg3)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
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
          {(search || catFilter !== 'all' || projFilter !== 'all') && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setSearch(''); setCatFilter('all'); setProjFilter('all') }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* Board */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div className="loading-center">
            <span className="spinner" />
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading resource board…</span>
          </div>
        ) : (
          <>
            {groups.hold.length > 0 && (
              <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 'var(--radius)', fontSize: 12, color: '#78350f', display: 'flex', gap: 8, alignItems: 'center' }}>
                ⚠️ <strong>{groups.hold.length} {groups.hold.length === 1 ? 'person' : 'people'}</strong> with expired inductions or medical — see Compliance Hold below
              </div>
            )}
            {([
              { key: 'onsite'   as BoardStatus, title: 'On Site',          dot: 'var(--green)'  },
              { key: 'incoming' as BoardStatus, title: 'Incoming ≤14 days', dot: 'var(--orange)' },
              { key: 'free'     as BoardStatus, title: 'Free / Available',  dot: 'var(--accent)' },
              { key: 'hold'     as BoardStatus, title: 'Compliance Hold',   dot: 'var(--red)'    },
            ]).map(({ key, title, dot }) => (
              <BoardSection key={key} title={title} dot={dot} count={groups[key].length}>
                {groups[key].length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0', fontStyle: 'italic' }}>None</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                    {groups[key].map(r => (
                      <PersonCard
                        key={r.id}
                        resource={r}
                        projColor={projColorMap[r.project_id] ?? 'var(--text3)'}
                        onOpenProfile={setProfilePersonId}
                        selected={selectedId === r.id}
                        onSelect={() => setSelectedId(id => id === r.id ? null : r.id)}
                      />
                    ))}
                  </div>
                )}
              </BoardSection>
            ))}
          </>
        )}
      </div>

      {/* Profile drawer */}
      {profilePersonId && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setProfilePersonId(null)} />
          <PersonProfileDrawer
            personId={profilePersonId}
            onClose={() => setProfilePersonId(null)}
            onNavigateToProject={() => setProfilePersonId(null)}
          />
        </>
      )}

      {/* Person picker */}
      {showPicker && (
        <PersonPicker
          title="Assign Person to Project"
          context="Search existing or create a new person record"
          onSelect={p => { setShowPicker(false); setAssignPerson(p) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Assign modal */}
      {assignPerson && (
        <AssignModal
          person={assignPerson}
          projects={projects}
          onAssign={handleAssign}
          onClose={() => setAssignPerson(null)}
        />
      )}
    </div>
  )
}
