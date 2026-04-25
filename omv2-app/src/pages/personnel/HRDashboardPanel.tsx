import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import type { RateCard } from '../../types'

const COLOR = 'var(--mod-hr)'
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
const fmtH = (n: number) => n.toFixed(1) + 'h'

interface WeekData { week_start: string; type: string; regime: string; crew: { role?: string; days?: Record<string, { hours?: number; dayType?: string; shiftType?: string }> }[] }

function splitHours(h: number, dayType: string, shift: string, regime: string) {
  if (h <= 0) return { dnt: 0, dt15: 0, ddt: 0, nnt: 0, ndt: 0 }
  if (dayType === 'sunday' || dayType === 'public_holiday') return { dnt: 0, dt15: 0, ddt: h, nnt: 0, ndt: 0 }
  if (dayType === 'saturday') return regime === 'ge12' ? { dnt: 0, dt15: 0, ddt: h, nnt: 0, ndt: 0 } : { dnt: 0, dt15: Math.min(h, 2), ddt: Math.max(0, h - 2), nnt: 0, ndt: 0 }
  if (shift === 'night') return { dnt: 0, dt15: 0, ddt: 0, nnt: Math.min(h, 8), ndt: Math.max(0, h - 8) }
  return regime === 'ge12'
    ? { dnt: Math.min(h, 8), dt15: Math.min(Math.max(0, h - 8), 2), ddt: Math.max(0, h - 10), nnt: 0, ndt: 0 }
    : { dnt: Math.min(h, 7.6), dt15: Math.min(Math.max(0, h - 7.6), 2.4), ddt: Math.max(0, h - 10), nnt: 0, ndt: 0 }
}

export function HRDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0, onsite: 0, incoming7d: 0,
    trades: 0, mgmt: 0, seag: 0, subcon: 0,
    tsWeeks: { trades: 0, mgmt: 0, seag: 0, subcon: 0 },
    tradesSell: 0, tradesHrs: 0, tradesWeeks: 0,
    mgmtSell: 0, mgmtHrs: 0, mgmtWeeks: 0,
    cars: 0, accom: 0,
  })
  const [weeklyData, setWeeklyData] = useState<{ week: string; tradesHrs: number; mgmtHrs: number; tradeSell: number; mgmtSell: number }[]>([])
  const [scCategory, setScCategory] = useState<'all' | 'trades' | 'mgmt' | 'seag' | 'subcon'>('all')
  const [scUnit, setScUnit] = useState<'hours' | 'aud'>('hours')
  const [scMode, setScMode] = useState<'cumulative' | 'weekly'>('cumulative')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const todayStr = new Date().toISOString().slice(0, 10)
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useEffect(() => { drawChart() }, [weeklyData, scCategory, scUnit, scMode])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, tsData, rcData, carData, acData] = await Promise.all([
      supabase.from('resources').select('id,category,mob_in,mob_out').eq('project_id', pid),
      supabase.from('weekly_timesheets').select('week_start,type,regime,crew').eq('project_id', pid).order('week_start'),
      supabase.from('rate_cards').select('role,rates,laha_cost,laha_sell,fsa_cost,fsa_sell,meal_cost,meal_sell').eq('project_id', pid),
      supabase.from('cars').select('id').eq('project_id', pid),
      supabase.from('accommodation').select('id').eq('project_id', pid),
    ])

    const res = resData.data || []
    const sheets = (tsData.data || []) as WeekData[]
    const rcs = (rcData.data || []) as RateCard[]

    const rcMap: Record<string, RateCard> = {}
    rcs.forEach(r => { rcMap[r.role.toLowerCase()] = r })

    const onsite = res.filter(r => r.mob_in && r.mob_in <= todayStr && (!r.mob_out || r.mob_out >= todayStr)).length
    const incoming7d = res.filter(r => r.mob_in && r.mob_in > todayStr && r.mob_in <= next7).length

    // Compute per-week data for the S-curve
    const byWeek: Record<string, { tradesHrs: number; mgmtHrs: number; tradeSell: number; mgmtSell: number }> = {}
    let totalTradesHrs = 0, totalTradesSell = 0, totalMgmtHrs = 0, totalMgmtSell = 0
    let tradesWeeks = 0, mgmtWeeks = 0
    const tsWeeks = { trades: 0, mgmt: 0, seag: 0, subcon: 0 }

    for (const sheet of sheets) {
      const regime = sheet.regime || 'lt12'
      const isTrades = sheet.type === 'trades' || sheet.type === 'subcon'
      const isMgmt = sheet.type === 'mgmt' || sheet.type === 'seag'
      if (isTrades) tsWeeks.trades++; else if (sheet.type === 'mgmt') tsWeeks.mgmt++; else if (sheet.type === 'seag') tsWeeks.seag++; else if (sheet.type === 'subcon') tsWeeks.subcon++
      if (isTrades) tradesWeeks++; else if (isMgmt) mgmtWeeks++

      if (!byWeek[sheet.week_start]) byWeek[sheet.week_start] = { tradesHrs: 0, mgmtHrs: 0, tradeSell: 0, mgmtSell: 0 }
      const wk = byWeek[sheet.week_start]

      for (const member of (sheet.crew || [])) {
        const rc = rcMap[(member.role || '').toLowerCase()]
        const sr = (rc?.rates as { sell: Record<string, number> } | null)?.sell || {}
        for (const [, d] of Object.entries(member.days || {})) {
          const h = d.hours || 0; if (!h) continue
          const split = splitHours(h, d.dayType || 'weekday', d.shiftType || 'day', regime)
          const sell = Object.entries(split).reduce((s, [b, bh]) => s + bh * (sr[b] || 0), 0)
          if (isTrades) { wk.tradesHrs += h; wk.tradeSell += sell; totalTradesHrs += h; totalTradesSell += sell }
          else { wk.mgmtHrs += h; wk.mgmtSell += sell; totalMgmtHrs += h; totalMgmtSell += sell }
        }
      }
    }

    const weeklyArr = Object.entries(byWeek).sort().map(([week, v]) => ({ week, ...v }))
    setWeeklyData(weeklyArr)

    setStats({
      total: res.length, onsite, incoming7d,
      trades: res.filter(r => r.category === 'trades').length,
      mgmt: res.filter(r => r.category === 'management').length,
      seag: res.filter(r => r.category === 'seag').length,
      subcon: res.filter(r => r.category === 'subcontractor').length,
      tsWeeks, tradesWeeks, mgmtWeeks,
      tradesSell: totalTradesSell, tradesHrs: totalTradesHrs,
      mgmtSell: totalMgmtSell, mgmtHrs: totalMgmtHrs,
      cars: carData.data?.length || 0, accom: acData.data?.length || 0,
    })
    setLoading(false)
  }

  function drawChart() {
    const canvas = canvasRef.current
    if (!canvas || !weeklyData.length) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth, H = 200
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.scale(dpr, dpr); canvas.style.height = H + 'px'
    ctx.clearRect(0, 0, W, H)

    const pad = { l: 60, r: 20, t: 16, b: 32 }
    const chartW = W - pad.l - pad.r
    const chartH = H - pad.t - pad.b

    // Build series
    const getCat = (wk: typeof weeklyData[0]) => {
      if (scCategory === 'trades') return scUnit === 'hours' ? wk.tradesHrs : wk.tradeSell
      if (scCategory === 'mgmt') return scUnit === 'hours' ? wk.mgmtHrs : wk.mgmtSell
      return scUnit === 'hours' ? wk.tradesHrs + wk.mgmtHrs : wk.tradeSell + wk.mgmtSell
    }

    const values = weeklyData.map(getCat)
    const cumulative = values.reduce((acc: number[], v, i) => { acc.push((acc[i - 1] || 0) + v); return acc }, [])
    const display = scMode === 'cumulative' ? cumulative : values
    const maxVal = Math.max(...display, 1)

    const x = (i: number) => pad.l + (i / (weeklyData.length - 1 || 1)) * chartW
    const y = (v: number) => pad.t + (1 - v / maxVal) * chartH

    // Grid
    ctx.strokeStyle = 'rgba(148,163,184,0.15)'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + (i / 4) * chartH
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke()
      ctx.fillStyle = 'rgba(100,116,139,0.7)'; ctx.font = '9px Arial'; ctx.textAlign = 'right'
      const v = maxVal * (1 - i / 4)
      ctx.fillText(scUnit === 'hours' ? v.toFixed(0) + 'h' : '$' + Math.round(v).toLocaleString(), pad.l - 4, yy + 3)
    }

    // Line
    if (weeklyData.length > 1) {
      ctx.beginPath(); ctx.strokeStyle = 'var(--mod-hr, #0f766e)'; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      weeklyData.forEach((_, i) => {
        const method = i === 0 ? 'moveTo' : 'lineTo'
        ctx[method](x(i), y(display[i]))
      })
      ctx.stroke()

      // Fill
      ctx.beginPath(); ctx.moveTo(x(0), y(display[0]))
      weeklyData.forEach((_, i) => ctx.lineTo(x(i), y(display[i])))
      ctx.lineTo(x(weeklyData.length - 1), pad.t + chartH)
      ctx.lineTo(x(0), pad.t + chartH)
      ctx.closePath()
      ctx.fillStyle = 'rgba(15,118,110,0.08)'; ctx.fill()
    }

    // X labels
    ctx.fillStyle = 'rgba(100,116,139,0.8)'; ctx.font = '9px Arial'; ctx.textAlign = 'center'
    const step = Math.max(1, Math.ceil(weeklyData.length / 8))
    weeklyData.forEach((wk, i) => {
      if (i % step === 0) ctx.fillText(wk.week.slice(5), x(i), H - 8)
    })
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>People & HR</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" style={{ background: 'var(--mod-hr)', color: '#fff' }} onClick={() => setActivePanel('hr-resources')}>+ Add Person</button>
          <button className="btn btn-sm" onClick={() => setActivePanel('hr-resources')}>👤 Resources</button>
        </div>
      </div>

      {/* Top KPI strip — 5 stats matching HTML */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total People', value: stats.total, color: COLOR, panel: 'hr-resources' },
          { label: 'On Site Now', value: stats.onsite, color: 'var(--green)', panel: 'hr-resources' },
          { label: 'Hours to Date', value: fmtH(stats.tradesHrs + stats.mgmtHrs), color: COLOR, panel: 'hr-timesheets-trades' },
          { label: 'Incoming (7d)', value: stats.incoming7d, color: stats.incoming7d > 0 ? 'var(--amber)' : 'var(--text3)', panel: 'hr-resources' },
          { label: 'Labour Sell to Date', value: fmt(stats.tradesSell + stats.mgmtSell), color: 'var(--green)', panel: 'hr-timesheets-trades' },
        ].map(t => (
          <div key={t.label} style={{ textAlign: 'center', padding: '12px', background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* S-curve */}
      {weeklyData.length > 1 && (
        <div className="card" style={{ marginBottom: '16px', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>Progress Curve — Baseline vs Forecast vs Actual</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Cumulative tracking of labour commitments across the project</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select className="input" style={{ width: '130px', fontSize: '11px', padding: '4px 6px' }} value={scCategory} onChange={e => setScCategory(e.target.value as typeof scCategory)}>
                <option value="all">All categories</option>
                <option value="trades">Trades only</option>
                <option value="mgmt">Management only</option>
              </select>
              <select className="input" style={{ width: '90px', fontSize: '11px', padding: '4px 6px' }} value={scUnit} onChange={e => setScUnit(e.target.value as typeof scUnit)}>
                <option value="hours">Hours</option>
                <option value="aud">Cost ($)</option>
              </select>
              <select className="input" style={{ width: '110px', fontSize: '11px', padding: '4px 6px' }} value={scMode} onChange={e => setScMode(e.target.value as typeof scMode)}>
                <option value="cumulative">Cumulative</option>
                <option value="weekly">Per week</option>
              </select>
            </div>
          </div>
          <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
        </div>
      )}

      {/* Financial summary — matching HTML cards */}
      <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Labour & Cost Summary</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '16px' }}>
        {[
          { title: 'Trades Timesheets', sell: stats.tradesSell, hrs: stats.tradesHrs, weeks: stats.tradesWeeks, color: COLOR, panel: 'hr-timesheets-trades' },
          { title: 'Management Timesheets', sell: stats.mgmtSell, hrs: stats.mgmtHrs, weeks: stats.mgmtWeeks, color: '#7c3aed', panel: 'hr-timesheets-mgmt' },
          { title: 'Cars', sell: 0, hrs: stats.cars, weeks: 0, color: 'var(--mod-hire)', panel: 'hr-cars', isCount: true, label: 'bookings' },
          { title: 'Accommodation', sell: 0, hrs: stats.accom, weeks: 0, color: 'var(--mod-hr)', panel: 'hr-accommodation', isCount: true, label: 'rooms' },
        ].map(t => (
          <div key={t.title} style={{ padding: '14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', borderLeft: `4px solid ${t.color}`, cursor: 'pointer' }}
            onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', fontFamily: 'var(--mono)', letterSpacing: '0.06em', marginBottom: '6px' }}>{t.title}</div>
            {t.isCount ? (
              <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.hrs} <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text3)' }}>{t.label}</span></div>
            ) : (
              <div style={{ display: 'flex', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(t.sell)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Sell (AUD)</div>
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmtH(t.hrs)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Hours</div>
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{t.weeks}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Weeks</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* People by category */}
      <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>By Category</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '10px' }}>
        {[
          { icon: '🔨', label: 'Trades', value: stats.trades, panel: 'hr-timesheets-trades', color: '#0369a1' },
          { icon: '💼', label: 'Management', value: stats.mgmt, panel: 'hr-timesheets-mgmt', color: '#065f46' },
          { icon: '⚙️', label: 'SE AG', value: stats.seag, panel: 'hr-timesheets-seag', color: '#92400e' },
          { icon: '🤝', label: 'Subcontractors', value: stats.subcon, panel: 'hr-timesheets-subcon', color: '#6b21a8' },
        ].map(t => (
          <div key={t.label} className="card" style={{ borderTop: `3px solid ${t.color}`, cursor: 'pointer' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>{t.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
