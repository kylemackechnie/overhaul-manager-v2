import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = 'var(--mod-hr)'

export function HRDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({
    total: 0, onsite: 0, incoming: 0, tradesWeeks: 0, tradesHours: 0,
    mgmtWeeks: 0, mgmtHours: 0, cars: 0, rooms: 0, rateCards: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const today = new Date().toISOString().slice(0, 10)

    const [resData, tsData, carData, accomData, rcData] = await Promise.all([
      supabase.from('resources').select('id,mob_in,mob_out').eq('project_id', pid),
      supabase.from('weekly_timesheets').select('type,regime,crew').eq('project_id', pid),
      supabase.from('cars').select('id').eq('project_id', pid),
      supabase.from('accommodation').select('id').eq('project_id', pid),
      supabase.from('rate_cards').select('id').eq('project_id', pid),
    ])

    const resources = resData.data || []
    const onsite = resources.filter(r => r.mob_in && r.mob_in <= today && (!r.mob_out || r.mob_out >= today)).length
    const incoming = resources.filter(r => r.mob_in && r.mob_in > today && r.mob_in <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length

    const sheets = tsData.data || []
    const tradesSheets = sheets.filter(s => s.type === 'trades')
    const mgmtSheets = sheets.filter(s => s.type === 'mgmt' || s.type === 'seag' || s.type === 'subcon')
    const sumHours = (arr: typeof sheets) => arr.reduce((s, w) => {
      const crew = (w.crew || []) as { days?: Record<string, { hours?: number }> }[]
      return s + crew.reduce((cs, m) => cs + Object.values(m.days || {}).reduce((ds, d) => ds + (d.hours || 0), 0), 0)
    }, 0)

    setStats({
      total: resources.length, onsite, incoming,
      tradesWeeks: tradesSheets.length, tradesHours: sumHours(tradesSheets),
      mgmtWeeks: mgmtSheets.length, mgmtHours: sumHours(mgmtSheets),
      cars: (carData.data || []).length, rooms: (accomData.data || []).length,
      rateCards: (rcData.data || []).length,
    })
    setLoading(false)
  }

  const Tile = ({ label, value, sub, panel, color = COLOR }: { label: string; value: string | number; sub?: string; panel?: string; color?: string }) => (
    <div className="card" style={{ cursor: panel ? 'pointer' : 'default', borderTop: `3px solid ${color}`, padding: '16px' }}
      onClick={() => panel && setActivePanel(panel)}>
      <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)', color }}>{value}</div>
      <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Personnel Overview</h1>

      <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Crew</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <Tile label="Total People" value={stats.total} panel="hr-resources" />
        <Tile label="On-site Now" value={stats.onsite} sub="Based on mob dates" color="var(--green)" />
        <Tile label="Incoming (7 days)" value={stats.incoming} color="var(--amber)" />
        <Tile label="Rate Cards" value={stats.rateCards} panel="hr-ratecards" color="var(--text3)" />
      </div>

      <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Timesheets</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <Tile label="Trades Weeks" value={stats.tradesWeeks} panel="hr-timesheets-trades" />
        <Tile label="Trades Hours" value={stats.tradesHours.toFixed(0) + 'h'} panel="hr-timesheets-trades" />
        <Tile label="Mgmt/SE AG/Subcon Weeks" value={stats.mgmtWeeks} panel="hr-timesheets-mgmt" />
        <Tile label="Mgmt/SE AG/Subcon Hours" value={stats.mgmtHours.toFixed(0) + 'h'} panel="hr-timesheets-mgmt" />
      </div>

      <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Accommodation</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <Tile label="Car Hire Records" value={stats.cars} panel="hr-cars" color="#f59e0b" />
        <Tile label="Accommodation Records" value={stats.rooms} panel="hr-accommodation" color="#f59e0b" />
      </div>
    </div>
  )
}
