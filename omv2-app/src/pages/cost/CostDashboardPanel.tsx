import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface CostStats {
  // Invoices
  invoiceTotal: number; approvedTotal: number; pendingTotal: number; invoiceCount: number
  // POs
  poCount: number; activePoCount: number; poTotalValue: number
  // Cost categories
  expenseTotal: number; carTotal: number; accomTotal: number
  hireTotal: number; variationTotal: number; approvedVariations: number
  boTotal: number; seTotal: number
  // Labour
  tradesHours: number; tradesSell: number; tradesCost: number
  mgmtHours: number; mgmtSell: number; mgmtCost: number
  // WBS
  wbsCount: number
}

// Simplified local copy. The canonical engine reads card thresholds; this
// dashboard variant is approximate and uses a single weekday split (NT→T1.5→DT)
// driven by typical AU shift defaults. Card-specific overrides happen at the
// timesheet level — this is just a rollup KPI so the approximation is fine.
function splitHours(hrs: number, dayType: string, shift: string) {
  if (hrs <= 0) return { dnt:0, dt15:0, ddt:0, nnt:0, ndt:0 }
  if (dayType==='sunday'||dayType==='public_holiday') return { dnt:0, dt15:0, ddt:hrs, nnt:0, ndt:0 }
  if (dayType==='saturday') return { dnt:0, dt15:Math.min(hrs,2), ddt:Math.max(0,hrs-2), nnt:0, ndt:0 }
  if (shift==='night') return { dnt:0, dt15:0, ddt:0, nnt:Math.min(hrs,8), ndt:Math.max(0,hrs-8) }
  return { dnt:Math.min(hrs,7.6), dt15:Math.min(Math.max(0,hrs-7.6),2.4), ddt:Math.max(0,hrs-10), nnt:0, ndt:0 }
}

export function CostDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState<CostStats|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [invData, poData, expData, carData, acData, hireData, varData, tsData, rcData, boData, seData, wbsData] = await Promise.all([
      supabase.from('invoices').select('amount,status').eq('project_id',pid),
      supabase.from('purchase_orders').select('id,status,total_value').eq('project_id',pid),
      supabase.from('expenses').select('cost_ex_gst').eq('project_id',pid),
      supabase.from('cars').select('total_cost').eq('project_id',pid),
      supabase.from('accommodation').select('total_cost').eq('project_id',pid),
      supabase.from('hire_items').select('hire_cost,currency').eq('project_id',pid),
      supabase.from('variations').select('value,status').eq('project_id',pid),
      supabase.from('weekly_timesheets').select('type,regime,crew').eq('project_id',pid),
      supabase.from('rate_cards').select('role,rates,laha_cost,laha_sell,fsa_cost,fsa_sell,meal_cost,meal_sell').eq('project_id',pid),
      supabase.from('back_office_hours').select('cost,sell').eq('project_id',pid),
      supabase.from('se_support_costs').select('amount,sell_price').eq('project_id',pid),
      supabase.from('wbs_list').select('id').eq('project_id',pid),
    ])

    const inv = invData.data||[]; const pos = poData.data||[]; const vars = varData.data||[]
    const rcs = (rcData.data||[]) as {role:string;rates:{cost:Record<string,number>;sell:Record<string,number>};laha_cost:number;laha_sell:number;fsa_cost:number;fsa_sell:number;meal_cost:number;meal_sell:number}[]

    // Calculate timesheet labour costs
    let tradesHours=0, tradesSell=0, tradesCost=0, mgmtHours=0, mgmtSell=0, mgmtCost=0
    for (const sheet of (tsData.data||[])) {
      const isTrades = sheet.type==='trades'||sheet.type==='subcon'
      for (const member of (sheet.crew||[])) {
        const rc = rcs.find(r=>r.role.toLowerCase()===(member.role||'').toLowerCase())
        const cr = rc?.rates?.cost||{}; const sr = rc?.rates?.sell||{}
        for (const [,d] of Object.entries(member.days||{})) {
          const day = d as {hours?:number;dayType?:string;shiftType?:string;laha?:boolean;meal?:boolean}
          const h = day.hours||0; if (!h) continue
          const split = splitHours(h, day.dayType||'weekday', day.shiftType||'day')
          let cost=0, sell=0
          for (const [b,bh] of Object.entries(split)) { cost+=bh*(cr[b]||0); sell+=bh*(sr[b]||0) }
          if (day.laha) { cost+=rc?.laha_cost||0; sell+=rc?.laha_sell||0 }
          if (day.meal) { cost+=rc?.meal_cost||0; sell+=rc?.meal_sell||0 }
          if (isTrades) { tradesHours+=h; tradesCost+=cost; tradesSell+=sell }
          else { mgmtHours+=h; mgmtCost+=cost; mgmtSell+=sell }
        }
        // FSA for mgmt/seag
        if (!isTrades && rc?.fsa_sell) {
          const workedDays = Object.values(member.days||{}).filter((d:unknown)=>((d as {hours?:number}).hours||0)>0).length
          mgmtSell+=workedDays*(rc.fsa_sell||0); mgmtCost+=workedDays*(rc.fsa_cost||0)
        }
      }
    }

    setStats({
      invoiceTotal: inv.reduce((s,i)=>s+(i.amount||0),0),
      approvedTotal: inv.filter(i=>['approved','paid'].includes(i.status)).reduce((s,i)=>s+(i.amount||0),0),
      pendingTotal: inv.filter(i=>['received','checked'].includes(i.status)).reduce((s,i)=>s+(i.amount||0),0),
      invoiceCount: inv.length,
      poCount: pos.length, activePoCount: pos.filter(p=>p.status==='active').length,
      poTotalValue: pos.reduce((s,p)=>s+((p as {total_value?:number}).total_value||0),0),
      expenseTotal: (expData.data||[]).reduce((s,e)=>s+(e.cost_ex_gst||0),0),
      carTotal: (carData.data||[]).reduce((s,c)=>s+(c.total_cost||0),0),
      accomTotal: (acData.data||[]).reduce((s,a)=>s+(a.total_cost||0),0),
      hireTotal: (hireData.data||[]).reduce((s,h) => {
        const curr = (h as {hire_cost:number;currency?:string}).currency
        const rate = curr && curr !== (activeProject?.currency || 'AUD')
          ? ((activeProject?.currency_rates as {code:string;rate:number}[])||[]).find(r=>r.code===curr)?.rate || 1
          : 1
        return s + (h.hire_cost||0) * rate
      }, 0),
      variationTotal: vars.filter(v=>v.status==='approved').reduce((s,v)=>s+(v.value||0),0),
      approvedVariations: vars.filter(v=>v.status==='approved').length,
      boTotal: (boData.data||[]).reduce((s,b)=>s+(b.cost||0),0),
      seTotal: (seData.data||[]).reduce((s,e)=>s+(e.amount||0),0),
      tradesHours, tradesSell, tradesCost,
      mgmtHours, mgmtSell, mgmtCost,
      wbsCount: (wbsData.data||[]).length,
    })
    setLoading(false)
  }

  const fmt = (n:number) => '$'+n.toLocaleString('en-AU',{maximumFractionDigits:0})

  const catDefs = [
    { key:'tooling', label:'Rental Tooling', color:'var(--mod-tooling)', panel:'tooling-dashboard' },
    { key:'hardware', label:'Hardware / Parts', color:'var(--mod-hardware, #0891b2)', panel:'hardware-dashboard' },
    { key:'hire', label:'Equipment Hire', color:'var(--mod-hire)', panel:'hire-dashboard' },
    { key:'labour', label:'Labour / Timesheets', color:'var(--mod-hr)', panel:'hr-timesheets-trades' },
    { key:'cars', label:'Car Hire', color:'var(--mod-hire)', panel:'hr-cars' },
    { key:'accom', label:'Accommodation', color:'var(--mod-hr)', panel:'hr-accommodation' },
    { key:'expenses', label:'Expenses', color:'#f472b6', panel:'expenses' },
  ]

  const catCosts: Record<string,number> = {
    tooling: 0, // tooling costed in EUR — shown separately in tooling dashboard
    hardware: 0, // hardware priced in EUR
    hire: stats?.hireTotal || 0,
    labour: (stats?.tradesCost || 0) + (stats?.mgmtCost || 0) + (stats?.boTotal || 0),
    cars: stats?.carTotal || 0,
    accom: stats?.accomTotal || 0,
    expenses: stats?.expenseTotal || 0,
  }
  const catSells: Record<string,number> = {
    tooling: 0,
    hardware: 0,
    hire: stats?.hireTotal || 0,
    labour: stats ? (stats.tradesSell || 0) + (stats.mgmtSell || 0) : 0,
    cars: stats?.carTotal || 0,
    accom: stats?.accomTotal || 0,
    expenses: stats?.expenseTotal || 0,
  }
  const grandCost = Object.values(catCosts).reduce((s,v)=>s+v,0)
  const grandSell = Object.values(catSells).reduce((s,v)=>s+v,0)
  const fmtH = (n:number) => n.toFixed(1)+'h'

  return (
    <div style={{padding:'24px',maxWidth:'1100px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <h1 style={{fontSize:'18px',fontWeight:700}}>Cost Dashboard</h1>
        <div style={{fontSize:'12px',color:'var(--text3)'}}>{activeProject?.name}</div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div> : stats && (<>


      {/* Cost by Category — 7 tiles matching HTML layout */}
      <div style={{marginBottom:'20px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px'}}>
          <div style={{fontWeight:600,fontSize:'12px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Cost by Category</div>
          <div style={{fontSize:'11px',color:'var(--text3)',display:'flex',gap:'16px'}}>
            <span>Figures show: <strong style={{color:'var(--text)'}}>Cost</strong> (what you pay) · <strong style={{color:'var(--green)'}}>Sell</strong> (what you charge)</span>
            <span>Total Cost: <strong style={{fontFamily:'var(--mono)'}}>{fmt(grandCost)}</strong> · Total Sell: <strong style={{fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(grandSell)}</strong></span>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'10px'}}>
          {catDefs.map(cat => {
            const cost = catCosts[cat.key] || 0
            const sell = catSells[cat.key] || 0
            const hasSell = sell > 0 && Math.abs(sell - cost) > 1
            const gm = sell > 0 && cost > 0 ? ((sell - cost) / sell * 100) : 0
            return (
              <div key={cat.key} style={{padding:'10px',border:'1px solid var(--border)',borderRadius:'var(--radius)',borderTop:`3px solid ${cat.color}`,cursor:'pointer'}} onClick={()=>cat.panel&&setActivePanel(cat.panel)}>
                <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',fontFamily:'var(--mono)',letterSpacing:'0.06em',marginBottom:'4px'}}>{cat.label}</div>
                <div style={{fontSize:'13px',fontWeight:700,fontFamily:'var(--mono)',color:cat.color}}>{cost > 0 ? fmt(cost) : '—'}</div>
                <div style={{fontSize:'10px',color:'var(--text3)',marginTop:'1px'}}>Cost</div>
                {hasSell && <>
                  <div style={{fontSize:'12px',fontWeight:600,fontFamily:'var(--mono)',color:'var(--green)',marginTop:'4px'}}>{fmt(sell)}</div>
                  <div style={{fontSize:'10px',color:'var(--text3)'}}>Sell{gm > 0 ? ` · ${gm.toFixed(0)}% GM` : ''}</div>
                </>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Labour */}
      <div style={{marginBottom:'20px'}}>
        <div style={{fontWeight:600,fontSize:'12px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'10px'}}>Labour</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
          {[
            {label:'Trades Hours',value:fmtH(stats.tradesHours),sub:`Sell ${fmt(stats.tradesSell)}`,panel:'hr-timesheets-trades',color:'var(--mod-hr)'},
            {label:'Trades Cost',value:fmt(stats.tradesCost),sub:`GM ${stats.tradesSell>0?((stats.tradesSell-stats.tradesCost)/stats.tradesSell*100).toFixed(0)+'%':'—'}`,color:'var(--mod-hr)'},
            {label:'Mgmt/SE AG Hours',value:fmtH(stats.mgmtHours),sub:`Sell ${fmt(stats.mgmtSell)}`,panel:'hr-timesheets-mgmt',color:'#6366f1'},
            {label:'Back Office Cost',value:fmt(stats.boTotal),sub:`SE Support ${fmt(stats.seTotal)}`,panel:'hr-backoffice',color:'#6366f1'},
          ].map(t=>(
            <div key={t.label} className="card" style={{padding:'12px 16px',borderTop:`3px solid ${t.color}`,cursor:t.panel?'pointer':'default'}} onClick={()=>t.panel&&setActivePanel(t.panel)}>
              <div style={{fontSize:'18px',fontWeight:700,fontFamily:'var(--mono)',color:t.color}}>{t.value}</div>
              <div style={{fontWeight:600,fontSize:'12px',marginTop:'3px'}}>{t.label}</div>
              {t.sub&&<div style={{fontSize:'11px',color:'var(--text3)',marginTop:'2px'}}>{t.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Invoices & POs */}
      <div style={{marginBottom:'20px'}}>
        <div style={{fontWeight:600,fontSize:'12px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'10px'}}>Procurement</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
          {[
            {label:'Invoice Total',value:fmt(stats.invoiceTotal),sub:`${stats.invoiceCount} invoices`,panel:'invoices',color:'#0284c7'},
            {label:'Approved/Paid',value:fmt(stats.approvedTotal),sub:'Approved invoices',color:'var(--green)'},
            {label:'Pending',value:fmt(stats.pendingTotal),sub:'Received / in review',color:'var(--amber)'},
            {label:'Active POs',value:String(stats.activePoCount),sub:`of ${stats.poCount} total · ${fmt(stats.poTotalValue)} value`,panel:'purchase-orders',color:'#7c3aed'},
          ].map(t=>(
            <div key={t.label} className="card" style={{padding:'12px 16px',borderTop:`3px solid ${t.color}`,cursor:t.panel?'pointer':'default'}} onClick={()=>t.panel&&setActivePanel(t.panel)}>
              <div style={{fontSize:'18px',fontWeight:700,fontFamily:'var(--mono)',color:t.color}}>{t.value}</div>
              <div style={{fontWeight:600,fontSize:'12px',marginTop:'3px'}}>{t.label}</div>
              {t.sub&&<div style={{fontSize:'11px',color:'var(--text3)',marginTop:'2px'}}>{t.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Other costs */}
      <div style={{marginBottom:'20px'}}>
        <div style={{fontWeight:600,fontSize:'12px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'10px'}}>Other Costs</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
          {[
            {label:'Hire Equipment',value:fmt(stats.hireTotal),panel:'hire-dry',color:'#f59e0b'},
            {label:'Expenses',value:fmt(stats.expenseTotal),panel:'expenses',color:'#64748b'},
            {label:'Cars',value:fmt(stats.carTotal),panel:'hr-cars',color:'#64748b'},
            {label:'Accommodation',value:fmt(stats.accomTotal),panel:'hr-accommodation',color:'#64748b'},
          ].map(t=>(
            <div key={t.label} className="card" style={{padding:'12px 16px',borderTop:`3px solid ${t.color}`,cursor:t.panel?'pointer':'default'}} onClick={()=>t.panel&&setActivePanel(t.panel)}>
              <div style={{fontSize:'18px',fontWeight:700,fontFamily:'var(--mono)',color:t.color}}>{t.value}</div>
              <div style={{fontWeight:600,fontSize:'12px',marginTop:'3px'}}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Variations */}
      <div style={{marginBottom:'20px'}}>
        <div style={{fontWeight:600,fontSize:'12px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'10px'}}>Variations</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px'}}>
          {[
            {label:'Approved Value',value:fmt(stats.variationTotal),sub:`${stats.approvedVariations} approved variations`,panel:'variations',color:'var(--green)'},
            {label:'WBS Codes',value:String(stats.wbsCount),sub:'Cost allocation elements',panel:'wbs-list',color:'var(--text3)'},
          ].map(t=>(
            <div key={t.label} className="card" style={{padding:'12px 16px',borderTop:`3px solid ${t.color}`,cursor:t.panel?'pointer':'default'}} onClick={()=>t.panel&&setActivePanel(t.panel)}>
              <div style={{fontSize:'18px',fontWeight:700,fontFamily:'var(--mono)',color:t.color}}>{t.value}</div>
              <div style={{fontWeight:600,fontSize:'12px',marginTop:'3px'}}>{t.label}</div>
              {t.sub&&<div style={{fontSize:'11px',color:'var(--text3)',marginTop:'2px'}}>{t.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      </>)}
    </div>
  )
}
