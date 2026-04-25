import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const fmtH = (n: number) => n.toFixed(0) + 'h'
const today = new Date().toISOString().slice(0, 10)

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
}

function progressColor(pct: number) {
  return pct > 100 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)'
}

interface Stats {
  resources: number; onsite: number; incoming: number
  invoiceTotal: number; approvedTotal: number; pendingTotal: number
  poCount: number; invoiceCount: number
  tsWeeks: number; tsHours: number
  varCount: number; varApproved: number; varApprovedValue: number
  partsTotal: number; partsReceived: number
  wbsCount: number; hireCount: number
}

export function DashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, invData, poData, tsData, varData, partsData, wbsData, hireData] = await Promise.all([
      supabase.from('resources').select('mob_in,mob_out').eq('project_id', pid),
      supabase.from('invoices').select('amount,status').eq('project_id', pid),
      supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('weekly_timesheets').select('crew').eq('project_id', pid),
      supabase.from('variations').select('status,value').eq('project_id', pid),
      supabase.from('wosit_lines').select('status').eq('project_id', pid),
      supabase.from('wbs_list').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('hire_items').select('id', { count: 'exact', head: true }).eq('project_id', pid),
    ])

    const res = resData.data || []
    const inv = invData.data || []
    const vars = varData.data || []
    const parts = partsData.data || []

    // Timesheet hours
    let tsHours = 0
    for (const sheet of (tsData.data || [])) {
      const crew = (sheet.crew || []) as { days?: Record<string, { hours?: number }> }[]
      tsHours += crew.reduce((s, m) => s + Object.values(m.days || {}).reduce((ds, d) => ds + (d.hours || 0), 0), 0)
    }

    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    setStats({
      resources: res.length,
      onsite: res.filter(r => r.mob_in && r.mob_in <= today && (!r.mob_out || r.mob_out >= today)).length,
      incoming: res.filter(r => r.mob_in && r.mob_in > today && r.mob_in <= nextWeek).length,
      invoiceTotal: inv.reduce((s, i) => s + (i.amount || 0), 0),
      approvedTotal: inv.filter(i => i.status === 'approved' || i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0),
      pendingTotal: inv.filter(i => i.status === 'received' || i.status === 'checked').reduce((s, i) => s + (i.amount || 0), 0),
      poCount: poData.count || 0,
      invoiceCount: inv.length,
      tsWeeks: (tsData.data || []).length,
      tsHours,
      varCount: vars.length,
      varApproved: vars.filter(v => v.status === 'approved').length,
      varApprovedValue: vars.filter(v => v.status === 'approved').reduce((s, v) => s + (v.value || 0), 0),
      partsTotal: parts.length,
      partsReceived: parts.filter(p => p.status === 'received' || p.status === 'issued').length,
      wbsCount: wbsData.count || 0,
      hireCount: hireData.count || 0,
    })
    setLoading(false)
  }

  const dStart = daysUntil(activeProject?.start_date)
  const dEnd = daysUntil(activeProject?.end_date)
  const isLive = dStart !== null && dStart <= 0 && (dEnd === null || dEnd > 0)
  const outageDayNum = isLive && activeProject?.start_date
    ? Math.floor((Date.now() - new Date(activeProject.start_date).getTime()) / 86400000) + 1
    : null

  const Tile = ({ label, value, sub, panel, color = 'var(--accent)', icon }: { label: string; value: string | number; sub?: string; panel?: string; color?: string; icon?: string }) => (
    <div className="card" style={{ cursor: panel ? 'pointer' : 'default', borderTop: `3px solid ${color}`, padding: '14px 16px' }} onClick={() => panel && setActivePanel(panel)}>
      {icon && <div style={{ fontSize: '20px', marginBottom: '6px' }}>{icon}</div>}
      <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color }}>{value}</div>
      <div style={{ fontWeight: 600, fontSize: '12px', marginTop: '3px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      {/* Project header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>{activeProject?.name}</h1>
        <div style={{ display: 'flex', gap: '16px', marginTop: '6px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text3)' }}>
          {activeProject?.unit && <span>🔧 {activeProject.unit}</span>}
          {activeProject?.client && <span>👤 {activeProject.client}</span>}
          {activeProject?.pm && <span>📋 PM: {activeProject.pm}</span>}
          {activeProject?.start_date && <span>📅 {activeProject.start_date} → {activeProject.end_date || 'TBC'}</span>}
          <span style={{ padding: '2px 8px', borderRadius: '12px', background: isLive ? '#d1fae5' : dStart && dStart > 0 ? '#fef3c7' : '#f1f5f9', color: isLive ? '#065f46' : dStart && dStart > 0 ? '#92400e' : '#64748b', fontWeight: 600 }}>
            {isLive ? '🟢 Live' : dStart && dStart > 0 ? `⏳ Starts in ${dStart}d` : dEnd && dEnd <= 0 ? '✅ Complete' : '⬜ No dates'}
          </span>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div> : stats && (<>

        {/* Alerts */}
        {stats.incoming > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fef3c7', borderLeft: '4px solid var(--amber)', marginBottom: '14px', fontSize: '13px' }}>
            ⚠ <strong>{stats.incoming} person{stats.incoming > 1 ? 's' : ''}</strong> mobbing in the next 7 days
            <button className="btn btn-sm" style={{ marginLeft: '12px' }} onClick={() => setActivePanel('hr-resources')}>View Resources →</button>
          </div>
        )}
        {stats.pendingTotal > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fff7ed', borderLeft: '4px solid #f97316', marginBottom: '14px', fontSize: '13px' }}>
            🧾 <strong>{fmt(stats.pendingTotal)}</strong> in invoices pending approval
            <button className="btn btn-sm" style={{ marginLeft: '12px' }} onClick={() => setActivePanel('invoices')}>View Invoices →</button>
          </div>
        )}


        {/* Outage day counter */}
        {outageDayNum !== null && (
          <div style={{ display:'flex', gap:'12px', marginBottom:'16px' }}>
            <div className="card" style={{ padding:'12px 20px', borderTop:'3px solid #8b5cf6', display:'flex', alignItems:'center', gap:'20px' }}>
              <div>
                <div style={{ fontSize:'28px', fontWeight:800, fontFamily:'var(--mono)', color:'#8b5cf6' }}>Day {outageDayNum}</div>
                <div style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>Outage day</div>
              </div>
              {dEnd !== null && dEnd > 0 && (
                <div>
                  <div style={{ fontSize:'20px', fontWeight:700, fontFamily:'var(--mono)', color:'var(--text3)' }}>{dEnd}d left</div>
                  <div style={{ fontSize:'11px', color:'var(--text3)' }}>remaining</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Personnel */}
        <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Personnel</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <Tile label="Total People" value={stats.resources} panel="hr-resources" color="var(--mod-hr)" />
          <Tile label="On-site" value={stats.onsite} sub="Based on mob dates" color="var(--green)" />
          <Tile label="Incoming (7d)" value={stats.incoming} color="var(--amber)" />
          <Tile label="Timesheet Weeks" value={stats.tsWeeks} panel="hr-timesheets-trades" color="#0369a1" />
          <Tile label="Total Hours" value={fmtH(stats.tsHours)} panel="hr-timesheets-trades" color="#0369a1" />
        </div>

        {/* Procurement */}
        <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Procurement</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <Tile label="POs" value={stats.poCount} panel="purchase-orders" color="#7c3aed" />
          <Tile label="Invoices" value={stats.invoiceCount} panel="invoices" color="#0284c7" />
          <Tile label="Invoice Total" value={fmt(stats.invoiceTotal)} panel="invoices" color="#0284c7" />
          <Tile label="Approved" value={fmt(stats.approvedTotal)} color="var(--green)" />
          <Tile label="Pending Approval" value={fmt(stats.pendingTotal)} panel="invoices" color="var(--amber)" />
        </div>

        {/* Variations + Parts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Variations</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <Tile label="Total VNs" value={stats.varCount} panel="variations" color="var(--amber)" />
              <Tile label="Approved" value={stats.varApproved} panel="variations" color="var(--green)" />
              <Tile label="Approved Value" value={fmt(stats.varApprovedValue)} panel="variations" color="var(--green)" />
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Parts / WOSIT</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <Tile label="Total Parts" value={stats.partsTotal} panel="parts-list" color="#0891b2" />
              <Tile label="Received" value={stats.partsReceived} panel="parts-list" color="var(--green)" />
              {stats.partsTotal > 0 && (
                <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${progressColor(stats.partsTotal > 0 ? stats.partsReceived / stats.partsTotal * 100 : 0)}` }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: progressColor(stats.partsTotal > 0 ? stats.partsReceived / stats.partsTotal * 100 : 0) }}>
                    {stats.partsTotal > 0 ? Math.round(stats.partsReceived / stats.partsTotal * 100) + '%' : '—'}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginTop: '3px' }}>Received</div>
                  <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '4px', marginTop: '6px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, stats.partsTotal > 0 ? stats.partsReceived / stats.partsTotal * 100 : 0)}%`, background: progressColor(stats.partsTotal > 0 ? stats.partsReceived / stats.partsTotal * 100 : 0), borderRadius: '3px' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Quick Links</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { label: '📋 Timesheets', panel: 'hr-timesheets-trades' },
            { label: '📦 Parts List', panel: 'parts-list' },
            { label: '📥 Import Parts', panel: 'parts-import' },
            { label: '💰 Cost Dashboard', panel: 'cost-dashboard' },
            { label: '📈 Forecast', panel: 'cost-forecast' },
            { label: '📝 Variations', panel: 'variations' },
            { label: '⚙ Project Settings', panel: 'project-settings' },
            { label: '✅ Pre-Planning', panel: 'pre-planning' },
          ].map(q => (
            <button key={q.panel} className="btn btn-sm" onClick={() => setActivePanel(q.panel)}>{q.label}</button>
          ))}
        </div>
      </>)}
    </div>
  )
}
