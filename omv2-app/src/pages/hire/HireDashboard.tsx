import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#f59e0b'

export function HireDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ dry: 0, wet: 0, local: 0, totalCost: 0, totalSell: 0, active: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('hire_items').select('hire_type,hire_cost,customer_total,start_date,end_date').eq('project_id', activeProject!.id)
    const items = data || []
    const today = new Date().toISOString().slice(0, 10)
    setStats({
      dry: items.filter((i: {hire_type:string}) => i.hire_type === 'dry').length,
      wet: items.filter((i: {hire_type:string}) => i.hire_type === 'wet').length,
      local: items.filter((i: {hire_type:string}) => i.hire_type === 'local').length,
      totalCost: items.reduce((s: number, i: {hire_cost:number}) => s + (i.hire_cost || 0), 0),
      totalSell: items.reduce((s: number, i: {customer_total:number}) => s + (i.customer_total || 0), 0),
      active: items.filter((i: {start_date:string|null,end_date:string|null}) => (!i.start_date || i.start_date <= today) && (!i.end_date || i.end_date >= today)).length,
    })
    setLoading(false)
  }

  const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'
  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Equipment Hire</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Dry Hire', value: stats.dry, icon: '🚜', panel: 'hire-dry' },
          { label: 'Wet Hire', value: stats.wet, icon: '🏗️', panel: 'hire-wet' },
          { label: 'Local Equipment', value: stats.local, icon: '🧰', panel: 'hire-local' },
        ].map(t => (
          <div key={t.panel} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${COLOR}`, padding: '16px' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{t.icon}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {[
          { label: 'Active Now', value: stats.active },
          { label: 'Total Cost', value: fmt(stats.totalCost) },
          { label: 'Total Sell', value: fmt(stats.totalSell) },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '16px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
