/**
 * PersonsDirectoryPanel.tsx
 * Phase 3a: Searchable, filterable directory of all persons in the system.
 * Columns: name, GID, role, category, status, EHS date, QUAL date, medical date, current project.
 * Row click → PersonProfileDrawer.
 */
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonProfileDrawer } from './PersonProfileDrawer'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DirectoryRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  gid: string | null
  default_role: string | null
  default_category: string | null
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORIES = ['trades', 'management', 'seag', 'subcontractor'] as const

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function inductionStatus(date: string | null): 'current' | 'expiring' | 'expired' | 'missing' {
  if (!date) return 'missing'
  const d = new Date(date)
  const now = new Date()
  if (d < now) return 'expired'
  const diffDays = (d.getTime() - now.getTime()) / 86400000
  if (diffDays < 90) return 'expiring'
  return 'current'
}

const STATUS_PILL: Record<string, string> = {
  current:  'bg-green-50 text-green-700 border border-green-200',
  expiring: 'bg-amber-50 text-amber-700 border border-amber-200',
  expired:  'bg-red-50 text-red-700 border border-red-200',
  missing:  'bg-slate-100 text-slate-400',
}

function InductionCell({ date }: { date: string | null }) {
  const s = inductionStatus(date)
  const label = date ? fmtDate(date)! : '—'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_PILL[s]}`}>
      {label}
    </span>
  )
}

function CategoryBadge({ cat }: { cat: string | null }) {
  if (!cat) return <span className="text-slate-300 text-xs">—</span>
  const colors: Record<string, string> = {
    trades: 'bg-blue-50 text-blue-700',
    management: 'bg-purple-50 text-purple-700',
    seag: 'bg-orange-50 text-orange-700',
    subcontractor: 'bg-teal-50 text-teal-700',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${colors[cat] || 'bg-slate-100 text-slate-500'}`}>
      {cat}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PersonsDirectoryPanel() {
  const [rows, setRows] = useState<DirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [inductionFilter, setInductionFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { setActivePanel } = useAppStore()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('person_directory_view')
      .select('*')
      .order('full_name')
    if (error) { toast('Failed to load directory', 'error'); setLoading(false); return }
    setRows((data || []) as DirectoryRow[])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r => {
      if (statusFilter !== 'all' && (r.status || 'active') !== statusFilter) return false
      if (catFilter !== 'all' && r.default_category !== catFilter) return false
      if (inductionFilter !== 'all') {
        const s = inductionStatus(r.induction_ehs_date)
        if (inductionFilter === 'issues' && (s === 'current')) return false
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
  }, [rows, search, catFilter, statusFilter, inductionFilter])

  const stats = useMemo(() => ({
    total: rows.filter(r => (r.status || 'active') === 'active').length,
    issues: rows.filter(r => {
      const s1 = inductionStatus(r.induction_ehs_date)
      const s2 = inductionStatus(r.induction_qual_date)
      return s1 === 'expired' || s1 === 'missing' || s2 === 'expired' || s2 === 'missing'
    }).length,
    deployed: rows.filter(r => !!r.current_project).length,
  }), [rows])

  function handleNavigateToProject(_projectId: string) {
    setSelectedId(null)
    // navigate to resources panel — store picks up project from context
    setActivePanel('hr-resources')
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">People Directory</h2>
            <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
              <span>{stats.total} active</span>
              <span>{stats.deployed} deployed</span>
              {stats.issues > 0 && <span className="text-amber-600">⚠️ {stats.issues} induction issues</span>}
            </div>
          </div>
          <button
            onClick={load}
            className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-1"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            placeholder="Search name, email, GID, role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-slate-200 rounded px-3 py-1.5 flex-1 min-w-[200px] focus:outline-none focus:border-blue-400"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
          <select
            value={inductionFilter}
            onChange={e => setInductionFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5"
          >
            <option value="all">All inductions</option>
            <option value="issues">Issues only</option>
            <option value="expired">Expired</option>
            <option value="expiring">Expiring soon</option>
            <option value="missing">Missing</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400">Loading directory…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400">No people found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-800 text-slate-100 z-10">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">GID</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">EHS</th>
                <th className="text-left px-3 py-2 font-medium">QUAL</th>
                <th className="text-left px-3 py-2 font-medium">Medical</th>
                <th className="text-left px-3 py-2 font-medium">Current Project</th>
                <th className="text-center px-3 py-2 font-medium" title="Deployments">Dep.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const isSelected = selectedId === r.id
                const isInactive = (r.status || 'active') === 'inactive'
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`border-b border-slate-100 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50'
                        : i % 2 === 0
                        ? 'bg-white hover:bg-slate-50'
                        : 'bg-slate-50/50 hover:bg-slate-100'
                    } ${isInactive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.full_name}</div>
                      {r.email && <div className="text-xs text-slate-400 truncate max-w-[180px]">{r.email}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {r.gid ? <span className="text-xs font-mono text-slate-600">{r.gid}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[140px] truncate">{r.default_role || '—'}</td>
                    <td className="px-3 py-2"><CategoryBadge cat={r.default_category} /></td>
                    <td className="px-3 py-2"><InductionCell date={r.induction_ehs_date} /></td>
                    <td className="px-3 py-2"><InductionCell date={r.induction_qual_date} /></td>
                    <td className="px-3 py-2"><InductionCell date={r.medical_date} /></td>
                    <td className="px-3 py-2">
                      {r.current_project
                        ? <span className="text-xs text-blue-600 underline cursor-pointer" onClick={e => { e.stopPropagation(); r.current_project_id && handleNavigateToProject(r.current_project_id) }}>{r.current_project}</span>
                        : <span className="text-slate-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-400">{r.deployment_count || 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      {!loading && (
        <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-400">
          Showing {filtered.length} of {rows.length} people
        </div>
      )}

      {/* Profile Drawer */}
      {selectedId && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSelectedId(null)} />
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
