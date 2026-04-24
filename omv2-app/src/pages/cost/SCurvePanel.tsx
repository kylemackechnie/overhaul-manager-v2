import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { buildForecast, weekKey, bucketTotal } from '../../engines/forecastEngine'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'

interface SCurvePoint { week: string; forecast: number; cumulativeForecast: number; cumulativeActual: number }

const fmtK = (n: number) => n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n.toFixed(0)}`
const fmtFull = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits:0, maximumFractionDigits:0 })

export function SCurvePanel() {
  const { activeProject } = useAppStore()
  const [points, setPoints] = useState<SCurvePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'cost'|'sell'>('sell')
  const today = new Date().toISOString().slice(0, 10)
  const todayWk = weekKey(today)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    const [resData, rcData, boData, hireData, carData, acData, tcData, tsData] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
      supabase.from('weekly_timesheets').select('id,week_start,status,regime,type,crew').eq('project_id', pid).lte('week_start', today),
    ])

    const stdHours = activeProject!.std_hours as { day: Record<string,number>; night: Record<string,number> } || { day:{}, night:{} }
    const publicHolidays = (activeProject!.public_holidays as {date:string}[]) || []

    const forecast = buildForecast(
      resData.data || [], rcData.data || [], boData.data || [],
      hireData.data || [], carData.data || [], acData.data || [],
      tcData.data || [], stdHours, publicHolidays,
      activeProject!.start_date, activeProject!.end_date,
    )

    // Build weekly forecast
    const byWeek: Record<string, number> = {}
    for (const d of forecast.days) {
      const wk = weekKey(d)
      const b = forecast.byDay[d]
      byWeek[wk] = (byWeek[wk] || 0) + bucketTotal(b)[mode]
    }

    // Build weekly actuals from approved timesheets
    const rcByRole: Record<string, {rates:{cost:Record<string,number>;sell:Record<string,number>}}> = {}
    for (const rc of rcData.data || []) rcByRole[rc.role.toLowerCase()] = rc

    const actualByWeek: Record<string, number> = {}
    for (const ts of tsData.data || []) {
      if (!ts.week_start) continue
      const wk = weekKey(ts.week_start)
      let wkVal = 0
      for (const m of ts.crew || []) {
        const rc = rcByRole[(m.role || '').toLowerCase()]
        if (!rc) continue
        const rates = mode === 'sell' ? rc.rates.sell : rc.rates.cost
        const totalHours = Object.values(m.days || {} as Record<string,{hours?:number}>).reduce((s: number, d: unknown) => s + ((d as {hours?:number}).hours||0), 0)
        wkVal += totalHours * (rates?.dnt || 0)
      }
      actualByWeek[wk] = (actualByWeek[wk] || 0) + wkVal
    }

    // Build cumulative series
    const weeks = [...new Set([...Object.keys(byWeek), ...Object.keys(actualByWeek)])].sort()
    let cumForecast = 0, cumActual = 0
    const pts: SCurvePoint[] = []
    for (const wk of weeks) {
      cumForecast += byWeek[wk] || 0
      if (wk <= todayWk) cumActual += actualByWeek[wk] || 0
      pts.push({ week: wk, forecast: byWeek[wk] || 0, cumulativeForecast: cumForecast, cumulativeActual: wk <= todayWk ? cumActual : 0 })
    }

    setPoints(pts)
    setLoading(false)
  }

  useEffect(() => { if (activeProject) load() }, [mode])

  const totalForecast = points.length > 0 ? points[points.length-1].cumulativeForecast : 0
  const totalActual = points.filter(p => p.cumulativeActual > 0).pop()?.cumulativeActual || 0
  const pct = totalForecast > 0 ? Math.round(totalActual / totalForecast * 100) : 0

  return (
    <div style={{ padding:'24px', maxWidth:'1200px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>S-Curve</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>Cumulative {mode === 'sell' ? 'revenue' : 'cost'} forecast vs actuals</p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {(['cost','sell'] as const).map(m => (
            <button key={m} className="btn btn-sm"
              style={{ background:mode===m?'var(--accent)':'var(--bg)', color:mode===m?'#fff':'var(--text)' }}
              onClick={() => setMode(m)}>{m === 'sell' ? 'Sell (Revenue)' : 'Cost'}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Building S-Curve...</div>
      : points.length === 0 ? (
        <div className="empty-state"><div className="icon">📉</div><h3>No data</h3><p>Add resources and hire items to generate the S-Curve.</p></div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom:'20px' }}>
            <div className="kpi-card" style={{ borderTopColor:'#6366f1' }}>
              <div className="kpi-val">{fmtFull(totalForecast)}</div>
              <div className="kpi-lbl">Total Forecast</div>
            </div>
            <div className="kpi-card" style={{ borderTopColor:'var(--green)' }}>
              <div className="kpi-val">{fmtFull(totalActual)}</div>
              <div className="kpi-lbl">Actual to Date</div>
            </div>
            <div className="kpi-card" style={{ borderTopColor:'var(--amber)' }}>
              <div className="kpi-val">{pct}%</div>
              <div className="kpi-lbl">% Complete (by value)</div>
            </div>
            <div className="kpi-card" style={{ borderTopColor:'var(--text3)' }}>
              <div className="kpi-val">{fmtFull(totalForecast - totalActual)}</div>
              <div className="kpi-lbl">Remaining</div>
            </div>
          </div>

          <div className="card">
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={points} margin={{ top:4, right:16, left:16, bottom:4 }}>
                <defs>
                  <linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--green)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--green)" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="week" tick={{ fontSize:10 }} tickFormatter={w => w.slice(5)} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize:10 }} />
                <Tooltip
                  formatter={(v: unknown) => fmtFull(Number(v))}
                  labelFormatter={l => `Week: ${l}`}
                />
                <Legend />
                <Area type="monotone" dataKey="cumulativeForecast" name="Forecast (cumulative)" stroke="#6366f1" fill="url(#fcGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="cumulativeActual" name="Actual (cumulative)" stroke="var(--green)" fill="url(#actGrad)" strokeWidth={2} dot={false} />
                <ReferenceLine x={todayWk} stroke="var(--amber)" strokeDasharray="4 4" label={{ value:'Today', position:'insideTopLeft', fontSize:10 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
