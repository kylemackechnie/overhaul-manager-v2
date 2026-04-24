import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface HRStats {
  resources: number; trades: number; management: number; seag: number; subcon: number
  timesheets: number; approvedSheets: number; totalHrs: number
  cars: number; accom: number; rooms: number
}

export function HRDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState<HRStats|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, tsData, carData, acData] = await Promise.all([
      supabase.from('resources').select('id,category').eq('project_id',pid),
      supabase.from('weekly_timesheets').select('id,status,crew').eq('project_id',pid),
      supabase.from('cars').select('id',{count:'exact',head:true}).eq('project_id',pid),
      supabase.from('accommodation').select('id,nights',{count:'exact'}).eq('project_id',pid),
    ])
    const res = resData.data || []
    const ts = tsData.data || []
    const totalHrs = ts.reduce((s, t) => {
      const crew = t.crew as {days:Record<string,{hours?:number}>}[] || []
      return s + crew.reduce((cs, m) => cs + Object.values(m.days||{}).reduce((ds, d) => ds + (d.hours||0), 0), 0)
    }, 0)
    setStats({
      resources: res.length,
      trades: res.filter(r => r.category === 'trades').length,
      management: res.filter(r => r.category === 'management').length,
      seag: res.filter(r => r.category === 'seag').length,
      subcon: res.filter(r => r.category === 'subcontractor').length,
      timesheets: ts.length,
      approvedSheets: ts.filter(t => t.status === 'approved').length,
      totalHrs: Math.round(totalHrs),
      cars: carData.count || 0,
      accom: (acData.data||[]).length,
      rooms: (acData.data||[]).length,
    })
    setLoading(false)
  }

  const tiles = stats ? [
    { icon:'👥', label:'Total People', value: stats.resources, panel:'hr-resources', color:'var(--accent)' },
    { icon:'🔨', label:'Trades', value: stats.trades, panel:'hr-timesheets-trades', color:'#0369a1' },
    { icon:'💼', label:'Management', value: stats.management, panel:'hr-timesheets-mgmt', color:'#065f46' },
    { icon:'⚙️', label:'SE AG', value: stats.seag, panel:'hr-timesheets-seag', color:'#92400e' },
    { icon:'🤝', label:'Subcontractors', value: stats.subcon, panel:'hr-timesheets-subcon', color:'#6b21a8' },
    { icon:'⏱️', label:'Timesheets', value: stats.timesheets, sub: `${stats.approvedSheets} approved`, panel:'hr-timesheets-trades', color:'#0284c7' },
    { icon:'📊', label:'Total Hours', value: stats.totalHrs.toLocaleString(), panel:'hr-timesheets-trades', color:'var(--green)' },
    { icon:'🚗', label:'Vehicles', value: stats.cars, panel:'hr-cars', color:'#be185d' },
    { icon:'🏨', label:'Rooms Booked', value: stats.rooms, panel:'hr-accommodation', color:'#7c3aed' },
  ] : []

  return (
    <div style={{ padding:'24px', maxWidth:'900px' }}>
      <h1 style={{ fontSize:'18px', fontWeight:700, marginBottom:'20px' }}>HR Dashboard</h1>
      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:'12px' }}>
          {tiles.map(t => (
            <div key={t.label} className="card" style={{ borderTop:`3px solid ${t.color}`, cursor:'pointer' }}
              onClick={() => setActivePanel(t.panel)}>
              <div style={{ fontSize:'24px', marginBottom:'6px' }}>{t.icon}</div>
              <div style={{ fontSize:'24px', fontWeight:700, fontFamily:'var(--mono)', color:t.color }}>{t.value}</div>
              <div style={{ fontSize:'11px', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.04em', marginTop:'2px' }}>{t.label}</div>
              {t.sub && <div style={{ fontSize:'11px', color:'var(--text3)', marginTop:'2px' }}>{t.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
