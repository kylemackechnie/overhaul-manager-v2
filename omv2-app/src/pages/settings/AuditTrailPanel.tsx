import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'

interface AuditRow {
  id: string
  action: string
  created_at: string
  project_id: string | null
  detail: Record<string, unknown> | null
  performed_by_user: { name: string; email: string } | null
  target_user: { name: string; email: string } | null
  target_person: { full_name: string; email: string | null } | null
  project: { name: string } | null
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  user_invited:             { label: 'User invited',          color: '#6366f1' },
  user_created:             { label: 'User created',          color: '#6366f1' },
  user_deactivated:         { label: 'User deactivated',      color: '#ef4444' },
  user_reactivated:         { label: 'User reactivated',      color: '#10b981' },
  permission_changed:       { label: 'Permissions changed',   color: '#f59e0b' },
  project_access_granted:   { label: 'Project access granted',color: '#10b981' },
  project_access_revoked:   { label: 'Project access revoked',color: '#ef4444' },
  role_changed:             { label: 'Role changed',          color: '#f59e0b' },
  password_reset_forced:    { label: 'Password reset forced', color: '#f59e0b' },
  user_login:               { label: 'User login',            color: '#6b7280' },
  user_logout:              { label: 'User logout',           color: '#6b7280' },
  password_changed:         { label: 'Password changed',      color: '#6b7280' },
  person_created:           { label: 'Person created',        color: '#6366f1' },
  person_merged:            { label: 'Persons merged',        color: '#f59e0b' },
  person_linked_to_user:    { label: 'Person linked to user', color: '#6366f1' },
  template_created:         { label: 'Template created',      color: '#6366f1' },
  template_deleted:         { label: 'Template deleted',      color: '#ef4444' },
}

export function AuditTrailPanel() {
  const { currentUser } = useAppStore()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => { if (isAdmin) load() }, [filterAction, filterFrom, filterTo, page])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('audit_log')
      .select(`
        id, action, created_at, project_id, detail,
        performed_by_user:app_users!performed_by(name,email),
        target_user:app_users!target_user_id(name,email),
        target_person:persons!target_person_id(full_name,email),
        project:projects!project_id(name)
      `)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filterAction) q = q.eq('action', filterAction)
    if (filterFrom)   q = q.gte('created_at', filterFrom)
    if (filterTo)     q = q.lte('created_at', filterTo + 'T23:59:59')

    const { data } = await q
    setRows((data || []) as unknown as AuditRow[])
    setLoading(false)
  }

  const filtered = filterUser
    ? rows.filter(r =>
        r.performed_by_user?.name?.toLowerCase().includes(filterUser.toLowerCase()) ||
        r.target_user?.name?.toLowerCase().includes(filterUser.toLowerCase()) ||
        r.target_person?.full_name?.toLowerCase().includes(filterUser.toLowerCase())
      )
    : rows

  function exportData() {
    const headers = ['Timestamp', 'Action', 'Performed By', 'Target User', 'Target Person', 'Project', 'Detail']
    const csvRows = filtered.map(r => [
      new Date(r.created_at).toLocaleString('en-AU'),
      r.action,
      r.performed_by_user?.name || '',
      r.target_user?.name || '',
      r.target_person?.full_name || '',
      r.project?.name || '',
      r.detail ? JSON.stringify(r.detail) : '',
    ])
    downloadCSV([headers, ...csvRows], 'audit_log')
  }

  if (!isAdmin) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>🔒 Admin access required</div>
  )

  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>Audit Log</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>All admin and user actions — permanent record</p>
        </div>
        <button className="btn btn-sm" onClick={exportData}>⬇ CSV</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 220 }} value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0) }}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input className="input" style={{ width: 180 }} placeholder="Filter by user name..."
          value={filterUser} onChange={e => setFilterUser(e.target.value)} />
        <input className="input" type="date" style={{ width: 150 }} value={filterFrom}
          onChange={e => { setFilterFrom(e.target.value); setPage(0) }} />
        <input className="input" type="date" style={{ width: 150 }} value={filterTo}
          onChange={e => { setFilterTo(e.target.value); setPage(0) }} />
        {(filterAction || filterUser || filterFrom || filterTo) && (
          <button className="btn btn-sm" onClick={() => { setFilterAction(''); setFilterUser(''); setFilterFrom(''); setFilterTo(''); setPage(0) }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'auto', flex: 1 }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>No audit entries found.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Timestamp</th>
                <th>Action</th>
                <th>Performed By</th>
                <th>Target</th>
                <th>Project</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const actionMeta = ACTION_LABELS[r.action] || { label: r.action, color: '#6b7280' }
                const target = r.target_user?.name || r.target_person?.full_name || '—'
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>
                      {new Date(r.created_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      <span style={{ background: actionMeta.color + '18', color: actionMeta.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {actionMeta.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{r.performed_by_user?.name || <span style={{ color: 'var(--text3)' }}>System</span>}</td>
                    <td style={{ fontSize: 12 }}>{target}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{r.project?.name || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.detail ? JSON.stringify(r.detail) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', fontSize: 13 }}>
        <button className="btn btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
        <span style={{ color: 'var(--text3)' }}>Page {page + 1}</span>
        <button className="btn btn-sm" onClick={() => setPage(p => p + 1)} disabled={rows.length < PAGE_SIZE}>Next →</button>
      </div>
    </div>
  )
}
