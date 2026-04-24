import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#7c3aed'

export function SubconDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ contracts: 0, totalValue: 0, active: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('subcon_contracts').select('status,value').eq('project_id', activeProject!.id)
    const contracts = data || []
    setStats({
      contracts: contracts.length,
      totalValue: contracts.reduce((s: number, c: {value:number}) => s + (c.value || 0), 0),
      active: contracts.filter((c: {status:string}) => c.status === 'active' || c.status === 'approved').length,
    })
    setLoading(false)
  }

  const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'
  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Subcontractors</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Contracts', value: stats.contracts, icon: '📄', panel: 'subcon-contracts' },
          { label: 'Active', value: stats.active, icon: '✅', panel: 'subcon-contracts' },
          { label: 'RFQs', value: 0, icon: '📊', panel: 'subcon-rfq' },
        ].map(t => (
          <div key={t.label} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${COLOR}`, padding: '16px' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{t.icon}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{fmt(stats.totalValue)}</div>
        <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>Total Contract Value</div>
      </div>
    </div>
  )
}
