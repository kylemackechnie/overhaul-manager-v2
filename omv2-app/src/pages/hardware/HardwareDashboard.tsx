import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#7c3aed'

export function HardwareDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ contracts: 0, active: 0, totalValue: 0, currency: 'EUR', carts: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('hardware_contracts').select('status,value,currency').eq('project_id', activeProject!.id)
    const items = data || []
    setStats({
      contracts: items.length,
      active: items.filter((c: {status:string}) => c.status === 'active').length,
      totalValue: items.reduce((s: number, c: {value:number}) => s + (c.value || 0), 0),
      currency: (items[0] as {currency?:string})?.currency || 'EUR',
      carts: 0,
    })
    setLoading(false)
  }

  const fmt = (n: number) => n > 0 ? n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'
  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Hardware</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Contracts', value: stats.contracts, icon: '📄', panel: 'hardware-contract' },
          { label: 'Active', value: stats.active, icon: '✅', panel: 'hardware-contract' },
          { label: 'Carts', value: stats.carts, icon: '🛒', panel: 'hardware-carts' },
        ].map(t => (
          <div key={t.label} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${COLOR}`, padding: '16px' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{t.icon}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{stats.currency} {fmt(stats.totalValue)}</div>
        <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>Total Contract Value</div>
      </div>
    </div>
  )
}
