import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#0891b2'

export function ToolingDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({
    tvs: 0, kollos: 0, wositLines: 0,
    totalCostEur: 0, totalSellEur: 0,
    departments: 0, kits: 0,
    dg: 0, inTransit: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [tvData, kolloData, wositData, costData, shipData, kitData, deptData] = await Promise.all([
      supabase.from('project_tvs').select('tv_no').eq('project_id', pid),
      supabase.from('project_kollos').select('kollo_id').eq('project_id', pid),
      supabase.from('wosit_lines').select('id').eq('project_id', pid),
      supabase.from('tooling_costings').select('cost_eur,sell_eur').eq('project_id', pid),
      supabase.from('shipments').select('status,has_dg').eq('project_id', pid),
      supabase.from('global_kits').select('id'),
      supabase.from('global_departments').select('id'),
    ])
    const costings = costData.data || []
    const ships = shipData.data || []
    setStats({
      tvs: (tvData.data || []).length,
      kollos: (kolloData.data || []).length,
      wositLines: (wositData.data || []).length,
      totalCostEur: costings.reduce((s: number, c: {cost_eur:number}) => s + (c.cost_eur || 0), 0),
      totalSellEur: costings.reduce((s: number, c: {sell_eur:number}) => s + (c.sell_eur || 0), 0),
      departments: (deptData.data || []).length,
      kits: (kitData.data || []).length,
      dg: ships.filter((s: {has_dg?:boolean}) => s.has_dg).length,
      inTransit: ships.filter((s: {status:string}) => s.status === 'in_transit').length,
    })
    setLoading(false)
  }

  const fmt = (n: number) => n > 0 ? '€' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>SE AG Tooling</h1>

      {/* Main counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Transport Vehicles', value: stats.tvs, icon: '📦', panel: 'tooling-tvs' },
          { label: 'Kollos', value: stats.kollos, icon: '📫', panel: 'tooling-kollos' },
          { label: 'Spare Parts (WOSIT)', value: stats.wositLines, icon: '🔩', panel: 'parts-list' },
          { label: 'Costed TVs', value: Object.keys(stats).length > 0 ? stats.tvs : 0, icon: '💶', panel: 'tooling-costings' },
        ].map(t => (
          <div key={t.label} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${COLOR}`, padding: '16px' }}
            onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{t.icon}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '12px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Cost */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div className="card" style={{ padding: '16px', borderTop: `3px solid ${COLOR}` }}>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{fmt(stats.totalCostEur)}</div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>Total Cost (EUR)</div>
        </div>
        <div className="card" style={{ padding: '16px', borderTop: `3px solid var(--green)` }}>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(stats.totalSellEur)}</div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>Total Sell (EUR)</div>
        </div>
      </div>

      {/* Alerts */}
      {stats.dg > 0 && (
        <div className="card" style={{ padding: '12px 16px', borderLeft: '4px solid var(--red)', background: '#fff1f2', marginBottom: '12px' }}>
          <div style={{ fontWeight: 600, color: 'var(--red)' }}>⚠ {stats.dg} shipment{stats.dg > 1 ? 's' : ''} with Dangerous Goods</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Ensure DG declarations are complete before shipping.</div>
        </div>
      )}
      {stats.inTransit > 0 && (
        <div className="card" style={{ padding: '12px 16px', borderLeft: `4px solid ${COLOR}`, background: '#ecfeff', marginBottom: '12px' }}>
          <div style={{ fontWeight: 600, color: COLOR }}>📦 {stats.inTransit} shipment{stats.inTransit > 1 ? 's' : ''} in transit</div>
        </div>
      )}

      {/* Global registers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {[
          { label: 'Departments', value: stats.departments, panel: 'tooling-departments' },
          { label: 'Global Kits', value: stats.kits, panel: 'global-kits' },
          { label: 'Global TVs', value: 0, panel: 'global-tooling' },
        ].map(t => (
          <div key={t.label} className="card" style={{ cursor: 'pointer', padding: '14px' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{t.value}</div>
            <div style={{ fontSize: '12px', marginTop: '2px', color: 'var(--text2)' }}>{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
