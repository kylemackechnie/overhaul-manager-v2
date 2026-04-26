import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { buildForecast, weekKey, bucketTotal } from '../../engines/forecastEngine'
import type { ForecastData } from '../../engines/forecastEngine'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts'

interface WeekRow { week: string; trades: number; mgmt: number; seag: number; hire: number; tooling: number; cars: number; accom: number; total: number; actual?: number }

const COLORS = { trades:'#6366f1', mgmt:'#0891b2', seag:'#f59e0b', hire:'#f97316', tooling:'#0891b2', cars:'#be185d', accom:'#7c3aed' }

const fmt = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n.toFixed(0)}`

export function ForecastPanel() {
  const { activeProject } = useAppStore()
  const [data, setData] = useState<ForecastData|null>(null)
  const [weekRows, setWeekRows] = useState<WeekRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'cost'|'sell'>('sell')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({
    labour: true, dryHire: true, wetHire: true, localHire: true,
    tooling: true, cars: true, accom: true, expenses: true,
  })
  const [showBaseline, setShowBaseline] = useState(false)
  const [baselineMenuOpen, setBaselineMenuOpen] = useState(false)
  const [savingBaseline, setSavingBaseline] = useState(false)

  const baseline = activeProject?.forecast_baseline as {setAt:string;setBy:string;grandCost:number;grandSell:number;weeks:Record<string,{cost:number;sell:number;hours:number}>} | null | undefined

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    const [resData, rcData, boData, hireData, carData, acData, tcData, invData] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
      supabase.from('invoices').select('amount,invoice_date,status').eq('project_id', pid),
    ])

    // Group invoice actuals by week
    const actualsByWk: Record<string,number> = {}
    for (const inv of (invData.data || []) as {amount:number;invoice_date:string|null;status:string}[]) {
      if (!inv.invoice_date || inv.status === 'rejected') continue
      const wk = weekKey(inv.invoice_date)
      actualsByWk[wk] = (actualsByWk[wk] || 0) + (inv.amount || 0)
    }
    const stdHours = activeProject!.std_hours as { day: Record<string,number>; night: Record<string,number> } || { day:{}, night:{} }
    const publicHolidays = (activeProject!.public_holidays as {date:string}[]) || []

    const fxRates = (activeProject!.currency_rates as {code:string;rate:number}[] | undefined) || []
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
      fxRates,
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

  function exportCSV() {
    downloadCSV(
      [
        ['Week', 'Trades', 'Mgmt', 'SE AG', 'Hire', 'Tooling', 'Cars', 'Accom', 'Total'],
        ...weekRows.map(w => [w.week, w.trades, w.mgmt, w.seag, w.hire, w.tooling, w.cars, w.accom, w.total])
      ],
      'forecast_' + (activeProject?.name || 'project')
    )
  }

  const peakWeek = weekRows.length > 0 ? weekRows.reduce((a, b) => a.total > b.total ? a : b) : null
  const totalForecast = weekRows.reduce((s, w) => s + w.total, 0)
  const fmtFull = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits:0, maximumFractionDigits:0 })

  async function saveBaseline() {
    if (!activeProject || !weekRows.length) return
    setSavingBaseline(true)
    const weeks: Record<string, {cost:number;sell:number;hours:number}> = {}
    weekRows.forEach(w => { weeks[w.week] = { cost: w.total, sell: w.total, hours: 0 } })
    const bl = {
      setAt: new Date().toISOString(),
      setBy: 'user',
      grandCost: weekRows.reduce((s,w) => s+w.total, 0),
      grandSell: weekRows.reduce((s,w) => s+w.total, 0),
      weeks
    }
    await supabase.from('projects').update({ forecast_baseline: bl }).eq('id', activeProject.id)
    // Update local store
    useAppStore.getState().setActiveProject({ ...activeProject, forecast_baseline: bl } as typeof activeProject)
    setSavingBaseline(false)
    setBaselineMenuOpen(false)
    setShowBaseline(true)
    toast('Baseline saved ✓', 'success')
  }

  async function clearBaseline() {
    if (!activeProject || !confirm('Clear the forecast baseline?')) return
    await supabase.from('projects').update({ forecast_baseline: null }).eq('id', activeProject.id)
    useAppStore.getState().setActiveProject({ ...activeProject, forecast_baseline: null } as typeof activeProject)
    setShowBaseline(false)
    setBaselineMenuOpen(false)
    toast('Baseline cleared', 'info')
  }

  return (
    <div style={{ padding:'24px', maxWidth:'1200px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <h1 style={{ fontSize:'18px', fontWeight:707 }}>Project Forecast</h1>
            <button className="btn btn-sm" onClick={() => setShowConfig(s => !s)}>⚙ Configure</button>
          {weekRows.length > 0 && <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>}

          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm" onClick={() => setBaselineMenuOpen(o => !o)}
              style={{ background: baseline ? 'rgba(99,102,241,.1)' : undefined, color: baseline ? 'var(--accent)' : undefined }}>
              📸 Baseline{baseline ? ' ✓' : ''}
            </button>
            {baselineMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '32px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.15)', padding: '6px', minWidth: '210px', zIndex: 200 }}
                onMouseLeave={() => setBaselineMenuOpen(false)}>
                <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px' }}
                  onMouseOver={e => (e.currentTarget.style.background='var(--bg3)')} onMouseOut={e => (e.currentTarget.style.background='none')}
                  onClick={saveBaseline} disabled={savingBaseline}>
                  📸 {baseline ? 'Replace' : 'Set'} Baseline (snapshot now)
                </button>
                {baseline && <>
                  <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseOver={e => (e.currentTarget.style.background='var(--bg3)')} onMouseOut={e => (e.currentTarget.style.background='none')}
                    onClick={() => { setShowBaseline(s => !s); setBaselineMenuOpen(false) }}>
                    👁 {showBaseline ? 'Hide' : 'Show'} Baseline Comparison
                  </button>
                  <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px', color: 'var(--red)' }}
                    onMouseOver={e => (e.currentTarget.style.background='var(--bg3)')} onMouseOut={e => (e.currentTarget.style.background='none')}
                    onClick={clearBaseline}>
                    🗑 Clear Baseline
                  </button>
                </>}
              </div>
            )}
          </div>
          </div>
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

      {showConfig && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>⚙ Forecast Configuration — included categories</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '8px' }}>
            {([
              ['labour', '👷 Labour'],
              ['dryHire', '🚜 Dry Hire'],
              ['wetHire', '🏗 Wet Hire'],
              ['localHire', '🧰 Local Equip'],
              ['tooling', '🔧 Tooling'],
              ['cars', '🚗 Cars'],
              ['accom', '🏨 Accommodation'],
              ['expenses', '🧾 Expenses'],
            ] as [keyof typeof config, string][]).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 10px', background: config[key] ? 'rgba(99,102,241,.08)' : 'var(--bg3)', borderRadius: '6px', border: `1px solid ${config[key] ? 'var(--accent)' : 'var(--border)'}`, fontSize: '13px' }}>
                <input type="checkbox" checked={config[key]} style={{ accentColor: 'var(--accent)' }}
                  onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      {baseline && showBaseline && (
        <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,.08)', borderLeft: '3px solid var(--accent)', borderRadius: '6px', marginBottom: '10px', fontSize: '12px', display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>📸 Baseline active</span>
          <span style={{ color: 'var(--text3)' }}>Set {new Date(baseline.setAt).toLocaleDateString('en-AU', {day:'2-digit',month:'short',year:'numeric'})}</span>
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>Grand total: ${baseline.grandCost.toLocaleString('en-AU', {maximumFractionDigits:0})}</span>
        </div>
      )}
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
              <ComposedChart data={weekRows} margin={{ top:4, right:16, left:0, bottom:4 }}>
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
                <Line type="monotone" dataKey="actual" name="Actuals (invoiced)" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
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
