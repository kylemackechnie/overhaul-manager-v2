import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

export function NrgDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ tceLines:0, overheadTotal:0, skilledTotal:0, invoiceTotal:0, woCount:0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [tceData, invData, woData] = await Promise.all([
      supabase.from('nrg_tce_lines').select('tce_total,source').eq('project_id',pid),
      supabase.from('invoices').select('amount').eq('project_id',pid).not('tce_item_id','is',null),
      supabase.from('work_orders').select('id',{count:'exact',head:true}).eq('project_id',pid),
    ])
    const tce = tceData.data||[]
    setStats({
      tceLines: tce.length,
      overheadTotal: tce.filter(l=>l.source==='overhead').reduce((s,l)=>s+(l.tce_total||0),0),
      skilledTotal: tce.filter(l=>l.source==='skilled').reduce((s,l)=>s+(l.tce_total||0),0),
      invoiceTotal: (invData.data||[]).reduce((s,i)=>s+(i.amount||0),0),
      woCount: woData.count||0,
    })
    setLoading(false)
  }

  const fmt = (n:number) => '$'+n.toLocaleString('en-AU',{minimumFractionDigits:0})

  return (
    <div style={{padding:'24px',maxWidth:'900px'}}>
      <h1 style={{fontSize:'18px',fontWeight:700,marginBottom:'4px'}}>NRG Gladstone — Dashboard</h1>
      <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'20px'}}>Site-specific NRG module</p>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div> : (
        <>
          <div className="kpi-grid" style={{marginBottom:'20px'}}>
            {[
              {icon:'📋',label:'TCE Lines',value:stats.tceLines,panel:'nrg-tce',color:'var(--accent)'},
              {icon:'📊',label:'Overhead TCE',value:fmt(stats.overheadTotal),panel:'nrg-tce',color:'var(--blue)'},
              {icon:'👷',label:'Skilled TCE',value:fmt(stats.skilledTotal),panel:'nrg-tce',color:'var(--green)'},
              {icon:'💳',label:'TCE Invoiced',value:fmt(stats.invoiceTotal),panel:'invoices',color:'var(--amber)'},
              {icon:'📋',label:'Work Orders',value:stats.woCount,panel:'work-orders',color:'var(--text2)'},
            ].map(t => (
              <div key={t.label} className="kpi-card" style={{borderTopColor:t.color,cursor:'pointer'}} onClick={()=>setActivePanel(t.panel)}>
                <div style={{fontSize:'20px',marginBottom:'4px'}}>{t.icon}</div>
                <div className="kpi-val" style={{color:t.color,fontSize:'18px'}}>{t.value}</div>
                <div className="kpi-lbl">{t.label}</div>
              </div>
            ))}
          </div>

          <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
            {[
              {label:'TCE Register',panel:'nrg-tce',icon:'📋'},
              {label:'Overhead Forecast',panel:'nrg-ohf',icon:'📈'},
              {label:'Work Orders',panel:'work-orders',icon:'📋'},
              {label:'Invoices',panel:'invoices',icon:'💳'},
            ].map(b => (
              <button key={b.label} className="btn" style={{padding:'10px 16px'}} onClick={()=>setActivePanel(b.panel)}>
                {b.icon} {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
