import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#0891b2'
const fmt = (n: number) => '€' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

export function ToolingDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ tvs: 0, kollos: 0, totalCost: 0, totalSell: 0, tvDays: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [tvRes, kolloRes, costRes] = await Promise.all([
      supabase.from('project_tvs').select('tv_no', { count: 'exact', head: false }).eq('project_id', pid),
      supabase.from('project_kollos').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('tooling_costings').select('cost_eur,sell_eur,charge_start,charge_end').eq('project_id', pid),
    ])
    const costings = costRes.data || []
    const totalCost = costings.reduce((s, c) => s + (c.cost_eur || 0), 0)
    const totalSell = costings.reduce((s, c) => s + (c.sell_eur || 0), 0)
    const tvDays = costings.reduce((s, c) => {
      if (!c.charge_start || !c.charge_end) return s
      return s + Math.max(0, Math.ceil((new Date(c.charge_end).getTime() - new Date(c.charge_start).getTime()) / 86400000) + 1)
    }, 0)
    setStats({ tvs: tvRes.data?.length || 0, kollos: kolloRes.count || 0, totalCost, totalSell, tvDays })
    setLoading(false)
  }

  const gm = stats.totalSell > 0 ? ((stats.totalSell - stats.totalCost) / stats.totalSell * 100) : 0

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 707, marginBottom: '16px' }}>SE Rental Tooling</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'TVs on Project', value: stats.tvs, color: COLOR, panel: 'tooling-tvs' },
          { label: 'Kollos / Packages', value: stats.kollos, color: '#7c3aed', panel: 'tooling-kollos' },
          { label: 'Total TV Days', value: stats.tvDays > 0 ? stats.tvDays + 'd' : '—', color: COLOR, panel: 'tooling-costings' },
          { label: 'Gross Margin', value: gm > 0 ? gm.toFixed(1) + '%' : '—', color: gm >= 15 ? 'var(--green)' : 'var(--amber)', panel: 'tooling-costings' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {stats.totalCost > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="card" style={{ padding: '14px', borderTop: `3px solid ${COLOR}` }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{fmt(stats.totalCost)}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Cost (EUR)</div>
          </div>
          <div className="card" style={{ padding: '14px', borderTop: '3px solid var(--green)' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(stats.totalSell)}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Sell (EUR)</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[
          { label: '📋 TV Register', panel: 'tooling-tvs' },
          { label: '📦 Kollos', panel: 'tooling-kollos' },
          { label: '💶 Costings', panel: 'tooling-costings' },
          { label: '🏢 Departments', panel: 'tooling-departments' },
          { label: '📥 Import', panel: 'parts-import' },
          { label: '📊 Reports', panel: 'tooling-reports' },
        ].map(b => (
          <button key={b.panel} className="btn btn-sm" onClick={() => setActivePanel(b.panel)}>{b.label}</button>
        ))}
      </div>

      {stats.tvs === 0 && (
        <div className="empty-state" style={{ marginTop: '24px' }}>
          <div className="icon">🔩</div>
          <h3>No tooling assigned yet</h3>
          <p>Add TVs from the global register, import WOSIT/Kollo sheets, and enter charge dates for costing.</p>
        </div>
      )}
    </div>
  )
}
