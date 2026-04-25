import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#059669'

export function HSEDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({
    inducted: 0, resources: 0, hseHours: 0,
    toolboxTalks: 0, observations: 0, incidents: 0,
    hseEntries: 0, co2Entries: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const today = new Date().toISOString().slice(0, 10)

    const [resData, hseData] = await Promise.all([
      supabase.from('resources').select('id,mob_in,mob_out').eq('project_id', pid),
      supabase.from('hse_hours').select('category,hours').eq('project_id', pid),
    ])

    const res = resData.data || []
    const hse = hseData.data || []
    const inducted = (activeProject?.induction_data as unknown[] | null)?.length || 0
    const onsite = res.filter(r => r.mob_in && r.mob_in <= today && (!r.mob_out || r.mob_out >= today)).length

    setStats({
      inducted,
      resources: onsite,
      hseHours: hse.reduce((s: number, h: { hours: number }) => s + (h.hours || 0), 0),
      toolboxTalks: hse.filter((h: { category: string }) => h.category === 'Toolbox Talk').length,
      observations: hse.filter((h: { category: string }) => h.category === 'Safety Observation').length,
      incidents: hse.filter((h: { category: string }) => h.category === 'Incident Investigation').length,
      hseEntries: hse.length,
      co2Entries: ((activeProject?.co2_config as { entries?: unknown[] } | null)?.entries || []).length,
    })
    setLoading(false)
  }

  const inductionPct = stats.resources > 0 ? Math.round(stats.inducted / Math.max(stats.inducted, stats.resources) * 100) : 0

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>HSE Dashboard</h1>

      {/* Induction progress */}
      <div className="card" style={{ padding: '16px', marginBottom: '16px', borderTop: `3px solid ${COLOR}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ fontWeight: 600 }}>Induction Status</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{stats.inducted} inducted · {stats.resources} on-site</div>
        </div>
        <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '8px', overflow: 'hidden', marginBottom: '6px' }}>
          <div style={{ height: '100%', width: inductionPct + '%', background: inductionPct >= 100 ? COLOR : inductionPct >= 80 ? 'var(--amber)' : 'var(--red)', borderRadius: '4px', transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{inductionPct}%</div>
          <button className="btn btn-sm" onClick={() => setActivePanel('hr-inductions')}>Manage Inductions →</button>
        </div>
      </div>

      {/* HSE activity tiles */}
      <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Activity</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Total HSE Hours', value: stats.hseHours.toFixed(1) + 'h', color: COLOR, panel: 'hse-hours' },
          { label: 'Toolbox Talks', value: stats.toolboxTalks, color: '#0284c7', panel: 'hse-hours' },
          { label: 'Safety Observations', value: stats.observations, color: '#7c3aed', panel: 'hse-hours' },
          { label: 'Incident Investigations', value: stats.incidents, color: stats.incidents > 0 ? 'var(--red)' : 'var(--text3)', panel: 'hse-hours' },
        ].map(t => (
          <div key={t.label} className="card" style={{ cursor: 'pointer', padding: '14px', borderTop: `3px solid ${t.color}` }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Environmental */}
      <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Environmental</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
        <div className="card" style={{ cursor: 'pointer', padding: '14px', borderTop: `3px solid #059669` }} onClick={() => setActivePanel('hse-co2')}>
          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#059669' }}>{stats.co2Entries}</div>
          <div style={{ fontSize: '11px', marginTop: '3px' }}>CO₂ Emission Entries</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>Click to view CO₂ tracking →</div>
        </div>
        <div className="card" style={{ cursor: 'pointer', padding: '14px', borderTop: `3px solid #64748b` }} onClick={() => setActivePanel('hr-inductions')}>
          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#64748b' }}>{stats.inducted}</div>
          <div style={{ fontSize: '11px', marginTop: '3px' }}>People Inducted</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>Site induction register →</div>
        </div>
      </div>

      {/* Quick links */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => setActivePanel('hse-hours')}>⏱ Log HSE Hours</button>
        <button className="btn btn-sm" onClick={() => setActivePanel('hr-inductions')}>📋 Inductions</button>
        <button className="btn btn-sm" onClick={() => setActivePanel('hse-co2')}>🌿 CO₂ Tracking</button>
      </div>
    </div>
  )
}
