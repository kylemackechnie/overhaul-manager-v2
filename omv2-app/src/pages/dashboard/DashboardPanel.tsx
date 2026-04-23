import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface DashStats {
  resources: number
  purchaseOrders: number
  invoices: number
  expenses: number
  hireItems: number
  timesheets: number
  variations: number
  wbsLines: number
}

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function DashboardPanel() {
  const { activeProject } = useAppStore()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [invTotal, setInvTotal] = useState(0)
  const [approvedTotal, setApprovedTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeProject) return
    loadStats()
  }, [activeProject?.id])

  async function loadStats() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id

    const [res, pos, invs, exps, hire, ts, vars, wbs] = await Promise.all([
      supabase.from('resources').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('invoices').select('id,amount,status').eq('project_id', pid),
      supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('hire_items').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('weekly_timesheets').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('variations').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('wbs_list').select('id', { count: 'exact', head: true }).eq('project_id', pid),
    ])

    const invoiceRows = invs.data || []
    const total = invoiceRows.reduce((s: number, i: { amount: number }) => s + (i.amount || 0), 0)
    const approved = invoiceRows
      .filter((i: { status: string }) => i.status === 'approved' || i.status === 'paid')
      .reduce((s: number, i: { amount: number }) => s + (i.amount || 0), 0)

    setInvTotal(total)
    setApprovedTotal(approved)
    setStats({
      resources: res.count || 0,
      purchaseOrders: pos.count || 0,
      invoices: invoiceRows.length,
      expenses: exps.count || 0,
      hireItems: hire.count || 0,
      timesheets: ts.count || 0,
      variations: vars.count || 0,
      wbsLines: wbs.count || 0,
    })
    setLoading(false)
  }

  if (!activeProject) return null

  const proj = activeProject
  
  const daysLeft = proj.end_date
    ? Math.ceil((new Date(proj.end_date).getTime() - Date.now()) / 86400000)
    : null

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      {/* Project header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>
          {proj.name}
        </h1>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', color: 'var(--text3)', fontSize: '13px' }}>
          {proj.site && <span>📍 {(proj.site as { name: string }).name}</span>}
          {proj.wbs && <span className="mono" style={{ fontSize: '12px' }}>📋 {proj.wbs}</span>}
          {proj.start_date && <span>🗓️ {proj.start_date} → {proj.end_date || '—'}</span>}
          {daysLeft !== null && (
            <span style={{ color: daysLeft < 14 ? 'var(--amber)' : 'var(--text3)' }}>
              ⏳ {daysLeft > 0 ? `${daysLeft} days remaining` : daysLeft === 0 ? 'Ends today' : `${Math.abs(daysLeft)} days overdue`}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading...</div>
      ) : (
        <>
          {/* Financial KPIs */}
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              Financial Summary
            </h2>
            <div className="kpi-grid">
              <div className="kpi-card" style={{ borderTopColor: 'var(--blue)' }}>
                <div className="kpi-val">{fmtMoney(invTotal)}</div>
                <div className="kpi-lbl">Total Invoiced</div>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--green)' }}>
                <div className="kpi-val">{fmtMoney(approvedTotal)}</div>
                <div className="kpi-lbl">Approved / Paid</div>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--amber)' }}>
                <div className="kpi-val">{fmtMoney(invTotal - approvedTotal)}</div>
                <div className="kpi-lbl">Pending Approval</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-val">{proj.default_gm}%</div>
                <div className="kpi-lbl">Default GM</div>
              </div>
            </div>
          </div>

          {/* Module counts */}
          <div>
            <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              Project Data
            </h2>
            <div className="kpi-grid">
              {[
                { label: 'Resources', value: stats?.resources, icon: '👤' },
                { label: 'Purchase Orders', value: stats?.purchaseOrders, icon: '📄' },
                { label: 'Invoices', value: stats?.invoices, icon: '💳' },
                { label: 'Hire Items', value: stats?.hireItems, icon: '🚜' },
                { label: 'Timesheets', value: stats?.timesheets, icon: '⏱️' },
                { label: 'Expenses', value: stats?.expenses, icon: '🧾' },
                { label: 'Variations', value: stats?.variations, icon: '📝' },
                { label: 'WBS Lines', value: stats?.wbsLines, icon: '📍' },
              ].map(item => (
                <div key={item.label} className="kpi-card" style={{ borderTopColor: 'var(--border2)' }}>
                  <div className="kpi-val" style={{ fontSize: '24px' }}>
                    {item.icon} {item.value ?? '—'}
                  </div>
                  <div className="kpi-lbl">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {proj.notes && (
            <div className="card" style={{ marginTop: '20px' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                Notes
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{proj.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
