/**
 * PersonsDirectoryPanel.tsx — redesigned to match OMV2 design language.
 * CSS variables, KPI cards, dark sticky table header, .badge/.btn classes.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonProfileDrawer } from './PersonProfileDrawer'
import { useAppStore } from '../../store/appStore'

interface DirectoryRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  gid: string | null
  default_role: string | null
  default_category: 'trades' | 'management' | 'seag' | 'subcontractor' | null
  status: string | null
  induction_ehs_date: string | null
  induction_qual_date: string | null
  medical_date: string | null
  current_project: string | null
  current_project_id: string | null
  deployment_count: number
  visa_count: number
  asset_count: number
  availability_notes: string | null
}

const CATEGORIES = ['trades', 'management', 'seag', 'subcontractor'] as const

function inductionStatus(date: string | null): 'current' | 'expiring' | 'expired' | 'missing' {
  if (!date) return 'missing'
  const d = new Date(date)
  const now = new Date()
  if (d < now) return 'expired'
  if ((d.getTime() - now.getTime()) / 86400000 < 90) return 'expiring'
  return 'current'
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function InductionBadge({ date }: { date: string | null }) {
  const s = inductionStatus(date)
  const styles: Record<string, { bg: string; color: string }> = {
    current:  { bg: '#d1fae5', color: '#065f46' },
    expiring: { bg: '#fef3c7', color: '#92400e' },
    expired:  { bg: '#fee2e2', color: '#991b1b' },
    missing:  { bg: 'var(--bg3)', color: 'var(--text3)' },
  }
  const { bg, color } = styles[s]
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
      background: bg, color, fontFamily: 'var(--mono)', whiteSpace: 'nowrap',
    }}>
      {date ? fmtDate(date) : '—'}
    </span>
  )
}

function CategoryBadge({ cat }: { cat: string | null }) {
  if (!cat) return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
  const styles: Record<string, { bg: string; color: string }> = {
    trades:        { bg: '#dbeafe', color: '#1e40af' },
    management:    { bg: '#ede9fe', color: '#5b21b6' },
    seag:          { bg: '#ffedd5', color: '#9a3412' },
    subcontractor: { bg: '#d1fae5', color: '#065f46' },
  }
  const { bg, color } = styles[cat] ?? { bg: 'var(--bg3)', color: 'var(--text3)' }
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: bg, color, textTransform: 'capitalize' }}>
      {cat}
    </span>
  )
}

function KpiCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '10px 14px',
      borderTop: `3px solid ${accent ?? 'var(--accent)'}`, minWidth: 110,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )
}

type SortKey = 'name' | 'role' | 'category' | 'ehs' | 'qual' | 'medical' | 'project' | 'deps'
type SortDir = 'asc' | 'desc'

function sortRows(rows: DirectoryRow[], key: SortKey, dir: SortDir) {
  const m = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let av: string | number, bv: string | number
    switch (key) {
      case 'name':     av = a.full_name; bv = b.full_name; break
      case 'role':     av = a.default_role ?? ''; bv = b.default_role ?? ''; break
      case 'category': av = a.default_category ?? ''; bv = b.default_category ?? ''; break
      case 'ehs':      av = a.induction_ehs_date ?? '9'; bv = b.induction_ehs_date ?? '9'; break
      case 'qual':     av = a.induction_qual_date ?? '9'; bv = b.induction_qual_date ?? '9'; break
      case 'medical':  av = a.medical_date ?? '9'; bv = b.medical_date ?? '9'; break
      case 'project':  av = a.current_project ?? ''; bv = b.current_project ?? ''; break
      case 'deps':     av = a.deployment_count; bv = b.deployment_count; break
      default:         av = ''; bv = ''
    }
    if (av < bv) return -m
    if (av > bv) return m
    return 0
  })
}

function SortTh({ label, sortKey, current, dir, onSort, style }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir
  onSort: (k: SortKey) => void; style?: React.CSSProperties
}) {
  const active = sortKey === current
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding: '10px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
        ...style,
      }}
    >
      {label}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

export function PersonsDirectoryPanel() {
  const [rows, setRows] = useState<DirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [inductionFilter, setInductionFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { setActivePanel } = useAppStore()

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('person_directory_view').select('*').order('full_name')
    setRows((data || []) as DirectoryRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rs = rows.filter(r => {
      if (statusFilter !== 'all' && (r.status || 'active') !== statusFilter) return false
      if (catFilter !== 'all' && r.default_category !== catFilter) return false
      if (inductionFilter !== 'all') {
        const s = inductionStatus(r.induction_ehs_date)
        if (inductionFilter === 'issues' && s === 'current') return false
        if (inductionFilter !== 'issues' && s !== inductionFilter) return false
      }
      if (!q) return true
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (r.gid || '').toLowerCase().includes(q) ||
        (r.default_role || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(q)
      )
    })
    return sortRows(rs, sortKey, sortDir)
  }, [rows, search, catFilter, statusFilter, inductionFilter, sortKey, sortDir])

  const stats = useMemo(() => ({
    active:   rows.filter(r => (r.status || 'active') === 'active').length,
    deployed: rows.filter(r => !!r.current_project).length,
    issues:   rows.filter(r => {
      const s1 = inductionStatus(r.induction_ehs_date)
      const s2 = inductionStatus(r.induction_qual_date)
      return s1 !== 'current' || s2 !== 'current'
    }).length,
    total: rows.length,
  }), [rows])

  function handleNavigateToProject(_projectId: string) {
    setSelectedId(null)
    setActivePanel('hr-resources')
  }

  const anyFilter = search || catFilter !== 'all' || statusFilter !== 'active' || inductionFilter !== 'all'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
        padding: '14px 20px 12px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>People Directory</h2>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span>↻</span> Refresh
          </button>
        </div>

        {/* KPI row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <KpiCard label="Active" value={stats.active} accent="var(--accent)" />
          <KpiCard label="Deployed" value={stats.deployed} accent="var(--blue)" />
          <KpiCard label="Induction Issues" value={stats.issues} accent={stats.issues > 0 ? 'var(--orange)' : 'var(--green)'} />
          <KpiCard label="Total" value={stats.total} accent="var(--border2)" />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search name, email, GID, role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: '1 1 200px', minWidth: 180, fontSize: 12,
              border: '1px solid var(--border2)', borderRadius: 6,
              padding: '6px 10px', background: 'var(--bg3)',
              color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)',
            }}
          />
          {([
            { val: statusFilter, set: setStatusFilter, opts: [['all','All status'],['active','Active'],['inactive','Inactive']] },
            { val: catFilter, set: setCatFilter, opts: [['all','All categories'], ...CATEGORIES.map(c => [c, c[0].toUpperCase() + c.slice(1)])] },
            { val: inductionFilter, set: setInductionFilter, opts: [['all','All inductions'],['issues','⚠ Issues only'],['expired','Expired'],['expiring','Expiring soon'],['missing','Missing']] },
          ] as const).map(({ val, set, opts }, i) => (
            <select
              key={i}
              value={val}
              onChange={e => (set as (v: string) => void)(e.target.value)}
              className="btn btn-sm btn-secondary"
              style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}
            >
              {(opts as unknown as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          {anyFilter && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => { setSearch(''); setCatFilter('all'); setStatusFilter('active'); setInductionFilter('all') }}
              style={{ color: 'var(--text3)' }}
            >
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {loading ? (
          <div className="loading-center">
            <div className="spinner" />
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading directory…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>No people found</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Try adjusting your search or filters</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 190 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 145 }} />
              <col style={{ width: 105 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 88 }} />
              <col style={{ minWidth: 160 }} />
              <col style={{ width: 46 }} />
            </colgroup>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <SortTh label="Name"           sortKey="name"     current={sortKey} dir={sortDir} onSort={handleSort} style={{ paddingLeft: 16 }} />
                <SortTh label="GID"            sortKey="name"     current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Role"           sortKey="role"     current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Category"       sortKey="category" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="EHS"            sortKey="ehs"      current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="QUAL"           sortKey="qual"     current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Medical"        sortKey="medical"  current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Current Project" sortKey="project" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="↕"              sortKey="deps"     current={sortKey} dir={sortDir} onSort={handleSort} style={{ textAlign: 'center' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const isSelected = selectedId === r.id
                const isInactive = (r.status || 'active') === 'inactive'
                const baseBg = i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)'
                const bg = isSelected ? 'var(--accent-light)' : baseBg

                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    style={{ cursor: 'pointer', background: bg, opacity: isInactive ? 0.5 : 1, borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg3)' }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = bg }}
                  >
                    <td style={{ padding: '7px 10px 7px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.full_name}
                      </div>
                      {r.email && (
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.email}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      {r.gid
                        ? <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', letterSpacing: '0.03em' }}>{r.gid}</span>
                        : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <span style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                        {r.default_role || <span style={{ color: 'var(--text3)' }}>—</span>}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <CategoryBadge cat={r.default_category} />
                    </td>
                    <td style={{ padding: '7px 10px' }}><InductionBadge date={r.induction_ehs_date} /></td>
                    <td style={{ padding: '7px 10px' }}><InductionBadge date={r.induction_qual_date} /></td>
                    <td style={{ padding: '7px 10px' }}><InductionBadge date={r.medical_date} /></td>
                    <td style={{ padding: '7px 10px' }}>
                      {r.current_project ? (
                        <span
                          onClick={e => { e.stopPropagation(); r.current_project_id && handleNavigateToProject(r.current_project_id) }}
                          style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
                        >
                          {r.current_project}
                        </span>
                      ) : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      {r.deployment_count > 0
                        ? <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', fontWeight: 600 }}>{r.deployment_count}</span>
                        : <span style={{ color: 'var(--text3)' }}>—</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {!loading && (
        <div style={{
          padding: '5px 16px', borderTop: '1px solid var(--border)',
          background: 'var(--bg2)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            Showing{' '}
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)', fontWeight: 600 }}>{filtered.length}</span>
            {' '}of{' '}
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)', fontWeight: 600 }}>{rows.length}</span>
            {' '}people
          </span>
          {selectedId && <span style={{ fontSize: 11, color: 'var(--accent)' }}>· Profile open</span>}
        </div>
      )}

      {/* Profile Drawer */}
      {selectedId && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setSelectedId(null)} />
          <PersonProfileDrawer
            personId={selectedId}
            onClose={() => setSelectedId(null)}
            onNavigateToProject={handleNavigateToProject}
          />
        </>
      )}
    </div>
  )
}
