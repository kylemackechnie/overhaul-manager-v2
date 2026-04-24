import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface CostStats {
  invoiceTotal: number; approvedTotal: number; pendingTotal: number
  poCount: number; activePoCount: number; invoiceCount: number
  expenseTotal: number; carTotal: number; accomTotal: number
  hireTotal: number; variationTotal: number; approvedVariations: number
}

export function CostDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState<CostStats|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [invData, poData, expData, carData, acData, hireData, varData] = await Promise.all([
      supabase.from('invoices').select('amount,status').eq('project_id',pid),
      supabase.from('purchase_orders').select('id,status').eq('project_id',pid),
      supabase.from('expenses').select('cost_ex_gst').eq('project_id',pid),
      supabase.from('cars').select('total_cost').eq('project_id',pid),
      supabase.from('accommodation').select('total_cost').eq('project_id',pid),
      supabase.from('hire_items').select('hire_cost').eq('project_id',pid),
      supabase.from('variations').select('value,status').eq('project_id',pid),
    ])
    const inv = invData.data || []
    const pos = poData.data || []
    const vars = varData.data || []
    setStats({
      invoiceTotal: inv.reduce((s,i)=>s+(i.amount||0),0),
      approvedTotal: inv.filter(i=>['approved','paid'].includes(i.status)).reduce((s,i)=>s+(i.amount||0),0),
      pendingTotal: inv.filter(i=>['received','checked'].includes(i.status)).reduce((s,i)=>s+(i.amount||0),0),
      poCount: pos.length, activePoCount: pos.filter(p=>p.status==='active').length,
      invoiceCount: inv.length,
      expenseTotal: (expData.data||[]).reduce((s,e)=>s+(e.cost_ex_gst||0),0),
      carTotal: (carData.data||[]).reduce((s,c)=>s+(c.total_cost||0),0),
      accomTotal: (acData.data||[]).reduce((s,a)=>s+(a.total_cost||0),0),
      hireTotal: (hireData.data||[]).reduce((s,h)=>s+(h.hire_cost||0),0),
      variationTotal: vars.filter(v=>v.status==='approved').reduce((s,v)=>s+(v.value||0),0),
      approvedVariations: vars.filter(v=>v.status==='approved').length,
    })
    setLoading(false)
  }

  const fmt = (n:number) => '$' + n.toLocaleString('en-AU',{minimumFractionDigits:0,maximumFractionDigits:0})

  return (
    <div style={{ padding:'24px', maxWidth:'1000px' }}>
      <h1 style={{ fontSize:'18px', fontWeight:700, marginBottom:'20px' }}>Cost Dashboard</h1>
      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div> : stats && (
        <>
          {/* Invoice summary */}
          <div style={{ marginBottom:'20px' }}>
            <h2 style={{ fontSize:'12px', fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'10px' }}>Invoices</h2>
            <div className="kpi-grid">
              <div className="kpi-card" onClick={() => setActivePanel('invoices')} style={{ cursor:'pointer', borderTopColor:'var(--blue)' }}>
                <div className="kpi-val">{fmt(stats.invoiceTotal)}</div>
                <div className="kpi-lbl">Total Invoiced ({stats.invoiceCount})</div>
              </div>
              <div className="kpi-card" onClick={() => setActivePanel('invoices')} style={{ cursor:'pointer', borderTopColor:'var(--green)' }}>
                <div className="kpi-val">{fmt(stats.approvedTotal)}</div>
                <div className="kpi-lbl">Approved / Paid</div>
              </div>
              <div className="kpi-card" onClick={() => setActivePanel('invoices')} style={{ cursor:'pointer', borderTopColor:'var(--amber)' }}>
                <div className="kpi-val">{fmt(stats.pendingTotal)}</div>
                <div className="kpi-lbl">Pending Approval</div>
              </div>
              <div className="kpi-card" onClick={() => setActivePanel('purchase-orders')} style={{ cursor:'pointer' }}>
                <div className="kpi-val">{stats.poCount}</div>
                <div className="kpi-lbl">POs ({stats.activePoCount} active)</div>
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          <div style={{ marginBottom:'20px' }}>
            <h2 style={{ fontSize:'12px', fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'10px' }}>Cost Breakdown</h2>
            <div className="kpi-grid">
              {[
                { label:'Expenses', value:stats.expenseTotal, panel:'expenses', icon:'🧾' },
                { label:'Car Hire', value:stats.carTotal, panel:'hr-cars', icon:'🚗' },
                { label:'Accommodation', value:stats.accomTotal, panel:'hr-accommodation', icon:'🏨' },
                { label:'Equipment Hire', value:stats.hireTotal, panel:'hire-dry', icon:'🚜' },
              ].map(item => (
                <div key={item.label} className="kpi-card" style={{ cursor:'pointer', borderTopColor:'var(--border2)' }}
                  onClick={() => setActivePanel(item.panel)}>
                  <div style={{ fontSize:'20px', marginBottom:'4px' }}>{item.icon}</div>
                  <div className="kpi-val" style={{ fontSize:'18px' }}>{fmt(item.value)}</div>
                  <div className="kpi-lbl">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Variations */}
          {stats.variationTotal > 0 && (
            <div>
              <h2 style={{ fontSize:'12px', fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'10px' }}>Variations</h2>
              <div className="kpi-grid">
                <div className="kpi-card" onClick={() => setActivePanel('variations')} style={{ cursor:'pointer', borderTopColor:'var(--green)' }}>
                  <div className="kpi-val">{fmt(stats.variationTotal)}</div>
                  <div className="kpi-lbl">Approved Variations ({stats.approvedVariations})</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
