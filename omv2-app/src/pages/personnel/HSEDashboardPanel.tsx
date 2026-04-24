import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

export function HSEDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [inducted, setInducted] = useState(0)
  const [resources, setResources] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const { count } = await supabase.from('resources').select('id',{count:'exact',head:true}).eq('project_id',pid)
    const inductionData = activeProject?.induction_data as unknown[]|null
    setResources(count||0)
    setInducted(inductionData?.length||0)
    setLoading(false)
  }

  const notInducted = Math.max(0, resources - inducted)
  const inductionPct = resources > 0 ? Math.round(inducted/resources*100) : 0

  return (
    <div style={{padding:'24px',maxWidth:'800px'}}>
      <h1 style={{fontSize:'18px',fontWeight:700,marginBottom:'20px'}}>HSE Dashboard</h1>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div> : (
        <>
          <div className="kpi-grid" style={{marginBottom:'20px'}}>
            <div className="kpi-card" style={{borderTopColor:'var(--green)',cursor:'pointer'}} onClick={()=>setActivePanel('hr-inductions')}>
              <div style={{fontSize:'24px',marginBottom:'4px'}}>📋</div>
              <div className="kpi-val" style={{color:'var(--green)'}}>{inducted}</div>
              <div className="kpi-lbl">People Inducted</div>
            </div>
            <div className="kpi-card" style={{borderTopColor:'var(--accent)',cursor:'pointer'}} onClick={()=>setActivePanel('hr-resources')}>
              <div style={{fontSize:'24px',marginBottom:'4px'}}>👥</div>
              <div className="kpi-val">{resources}</div>
              <div className="kpi-lbl">Total Resources</div>
            </div>
            <div className="kpi-card" style={{borderTopColor:notInducted>0?'var(--amber)':'var(--green)'}}>
              <div style={{fontSize:'24px',marginBottom:'4px'}}>{notInducted>0?'⚠️':'✅'}</div>
              <div className="kpi-val" style={{color:notInducted>0?'var(--amber)':'var(--green)'}}>{notInducted}</div>
              <div className="kpi-lbl">Not Yet Inducted</div>
            </div>
            <div className="kpi-card" style={{borderTopColor:'var(--blue)'}}>
              <div style={{fontSize:'24px',marginBottom:'4px'}}>📊</div>
              <div className="kpi-val">{inductionPct}%</div>
              <div className="kpi-lbl">Induction Rate</div>
            </div>
          </div>

          {inducted > 0 && resources > 0 && (
            <div className="card" style={{marginBottom:'16px'}}>
              <div style={{fontWeight:600,marginBottom:'8px',fontSize:'13px'}}>Induction Progress</div>
              <div style={{background:'var(--bg3)',borderRadius:'6px',height:'12px',overflow:'hidden'}}>
                <div style={{background:'var(--green)',height:'100%',width:`${inductionPct}%`,borderRadius:'6px',transition:'width 0.5s ease'}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:'4px',fontSize:'11px',color:'var(--text3)'}}>
                <span>{inducted} inducted</span>
                <span>{resources} total</span>
              </div>
            </div>
          )}

          <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
            <button className="btn" onClick={()=>setActivePanel('hr-inductions')}>📋 Inductions Register</button>
            <button className="btn" onClick={()=>setActivePanel('hr-resources')}>👥 Resources</button>
            <button className="btn" onClick={()=>setActivePanel('hse-co2')}>🌿 CO₂ Tracking</button>
          </div>
        </>
      )}
    </div>
  )
}
