import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { buildForecast, weekKey, bucketTotal } from '../../engines/forecastEngine'
import type { ForecastData } from '../../engines/forecastEngine'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface WeekRow { week: string; trades: number; mgmt: number; seag: number; hire: number; tooling: number; cars: number; accom: number; total: number }

const COLORS = { trades:'#6366f1', mgmt:'#0891b2', seag:'#f59e0b', hire:'#f97316', tooling:'#0891b2', cars:'#be185d', accom:'#7c3aed' }

const fmt = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n.toFixed(0)}`

export function ForecastPanel() {
  const { activeProject } = useAppStore()
  const [data, setData] = useState<ForecastData|null>(null)
  const [weekRows, setWeekRows] = useState<WeekRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'cost'|'sell'>('sell')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    const [resData, rcData, boData, hireData, carData, acData, tcData] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
    ])

    const stdHours = activeProject!.std_hours as { day: Record<string,number>; night: Record<string,number> } || { day:{}, night:{} }
    const publicHolidays = (activeProject!.public_holidays as {date:string}[]) || []

    const forecast = buildForecast(
      resData.data || [],
      rcData.data || [],
      boData.data || [],
      hireData.data || [],
      carData.data || [],
      acData.data || [],
      tcData.data || [],
      stdHours,
      publicHolidays,
      activeProject!.start_date,
      activeProject!.end_date,
    )

    setData(forecast)

    // Aggregate by week
    const byWeek: Record<string, WeekRow> = {}
    for (const d of forecast.days) {
      const wk = weekKey(d)
      if (!byWeek[wk]) byWeek[wk] = { week: wk, trades:0, mgmt:0, seag:0, hire:0, tooling:0, cars:0, accom:0, total:0 }
      const b = forecast.byDay[d]
      const m = mode === 'sell' ? 'sell' : 'cost'
      byWeek[wk].trades += b.trades[m]
      byWeek[wk].mgmt += b.mgmt[m]
      byWeek[wk].seag += b.seag[m]
      byWeek[wk].hire += b.dryHire[m] + b.wetHire[m] + b.localHire[m]
      byWeek[wk].tooling += b.tooling[m]
      byWeek[wk].cars += b.cars[m]
      byWeek[wk].accom += b.accom[m]
      byWeek[wk].total += bucketTotal(b)[m]
    }

    setWeekRows(Object.values(byWeek).sort((a,b) => a.week.localeCompare(b.week)))
    setLoading(false)
  }

  // Recompute week rows when mode changes
  useEffect(() => {
    if (!data) return
    const byWeek: Record<string, WeekRow> = {}
    for (const d of data.days) {
      const wk = weekKey(d)
      if (!byWeek[wk]) byWeek[wk] = { week: wk, trades:0, mgmt:0, seag:0, hire:0, tooling:0, cars:0, accom:0, total:0 }
      const b = data.byDay[d]
      const m = mode === 'sell' ? 'sell' : 'cost'
      byWeek[wk].trades += b.trades[m]
      byWeek[wk].mgmt += b.mgmt[m]
      byWeek[wk].seag += b.seag[m]
      byWeek[wk].hire += b.dryHire[m] + b.wetHire[m] + b.localHire[m]
      byWeek[wk].tooling += b.tooling[m]
      byWeek[wk].cars += b.cars[m]
      byWeek[wk].accom += b.accom[m]
      byWeek[wk].total += bucketTotal(b)[m]
    }
    setWeekRows(Object.values(byWeek).sort((a,b) => a.week.localeCompare(b.week)))
  }, [mode, data])

  const peakWeek = weekRows.length > 0 ? weekRows.reduce((a, b) => a.total > b.total ? a : b) : null
  const totalForecast = weekRows.reduce((s, w) => s + w.total, 0)
  const fmtFull = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits:0, maximumFractionDigits:0 })

  return (
    <div style={{ padding:'24px', maxWidth:'1200px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:707 }}>Project Forecast</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>
            {weekRows.length} weeks · Total {fmtFull(totalForecast)}
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {(['cost','sell'] as const).map(m => (
            <button key={m} className="btn btn-sm"
              style={{ background:mode===m?'var(--accent)':'var(--bg)', color:mode===m?'#fff':'var(--text)' }}
              onClick={() => setMode(m)}>{m === 'sell' ? 'Sell (Revenue)' : 'Cost'}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Building forecast...</div>
      : weekRows.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📈</div>
          <h3>No forecast data</h3>
          <p>Add resources with mob dates, hire items, and tooling to generate a forecast. Ensure rate cards are assigned to resources and standard hours are configured in Project Settings.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="kpi-grid" style={{ marginBottom:'20px' }}>
            <div className="kpi-card" style={{ borderTopColor:'var(--accent)' }}>
              <div className="kpi-val">{fmtFull(totalForecast)}</div>
              <div className="kpi-lbl">Total {mode === 'sell' ? 'Revenue' : 'Cost'}</div>
            </div>
            <div className="kpi-card" style={{ borderTopColor:'var(--blue)' }}>
              <div className="kpi-val">{weekRows.length}</div>
              <div className="kpi-lbl">Weeks</div>
            </div>
            {peakWeek && (
              <div className="kpi-card" style={{ borderTopColor:'var(--amber)' }}>
                <div className="kpi-val">{fmtFull(peakWeek.total)}</div>
                <div className="kpi-lbl">Peak Week ({peakWeek.week})</div>
              </div>
            )}
            <div className="kpi-card" style={{ borderTopColor:'var(--green)' }}>
              <div className="kpi-val">{weekRows.length > 0 ? fmtFull(totalForecast / weekRows.length) : '—'}</div>
              <div className="kpi-lbl">Avg / Week</div>
            </div>
          </div>

          {/* Chart */}
          <div className="card" style={{ marginBottom:'20px' }}>
            <div style={{ fontWeight:600, marginBottom:'12px', fontSize:'13px' }}>Weekly {mode === 'sell' ? 'Revenue' : 'Cost'} by Category</div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={weekRows} margin={{ top:4, right:16, left:0, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="week" tick={{ fontSize:10 }} tickFormatter={w => w.slice(5)} />
                <YAxis tickFormatter={fmt} tick={{ fontSize:10 }} />
                <Tooltip formatter={(v: unknown) => fmtFull(Number(v))} labelFormatter={l => `Week: ${l}`} />
                <Legend />
                <Bar dataKey="trades" name="Trades" stackId="a" fill={COLORS.trades} />
                <Bar dataKey="mgmt" name="Management" stackId="a" fill={COLORS.mgmt} />
                <Bar dataKey="seag" name="SE AG" stackId="a" fill={COLORS.seag} />
                <Bar dataKey="hire" name="Equipment Hire" stackId="a" fill={COLORS.hire} />
                <Bar dataKey="tooling" name="Tooling" stackId="a" fill={COLORS.tooling} />
                <Bar dataKey="cars" name="Cars" stackId="a" fill={COLORS.cars} />
                <Bar dataKey="accom" name="Accommodation" stackId="a" fill={COLORS.accom} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Weekly table */}
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            <table style={{ fontSize:'12px' }}>
              <thead>
                <tr>
                  <th>Week</th>
                  <th style={{ textAlign:'right' }}>Trades</th>
                  <th style={{ textAlign:'right' }}>Mgmt</th>
                  <th style={{ textAlign:'right' }}>SE AG</th>
                  <th style={{ textAlign:'right' }}>Hire</th>
                  <th style={{ textAlign:'right' }}>Tooling</th>
                  <th style={{ textAlign:'right' }}>Cars</th>
                  <th style={{ textAlign:'right' }}>Accom</th>
                  <th style={{ textAlign:'right', fontWeight:700 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {weekRows.map(w => (
                  <tr key={w.week}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:500 }}>{w.week}</td>
                    {(['trades','mgmt','seag','hire','tooling','cars','accom'] as const).map(k => (
                      <td key={k} style={{ textAlign:'right', fontFamily:'var(--mono)', color: w[k] > 0 ? undefined : 'var(--text3)' }}>
                        {w[k] > 0 ? fmt(w[k]) : '—'}
                      </td>
                    ))}
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:700 }}>{fmt(w.total)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg3)' }}>
                  <td style={{ fontWeight:700, padding:'6px 8px' }}>Total</td>
                  {(['trades','mgmt','seag','hire','tooling','cars','accom'] as const).map(k => (
                    <td key={k} style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, padding:'6px 8px' }}>
                      {fmt(weekRows.reduce((s,w)=>s+w[k],0))}
                    </td>
                  ))}
                  <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:700, padding:'6px 8px' }}>{fmtFull(totalForecast)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
