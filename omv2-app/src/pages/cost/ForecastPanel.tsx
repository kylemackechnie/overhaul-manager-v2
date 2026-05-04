import { useEffect, useMemo, useState, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import {
  buildForecast, weekKey, monthKey, weekLabel, monthLabel,
  EUR_CATS, bucketTotalBase,
} from '../../engines/forecastEngine'
import type { ForecastData, DayPerson } from '../../engines/forecastEngine'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts'

type Period = 'week' | 'month'
type Mode = 'cost' | 'sell'

type CatKey = 'trades' | 'mgmt' | 'seag' | 'dryHire' | 'wetHire' | 'localHire' | 'tooling' | 'cars' | 'accom' | 'expenses'

const LABOUR_CATS: { key: CatKey; label: string; color: string }[] = [
  { key: 'trades', label: 'Trades', color: '#0891b2' },
  { key: 'mgmt',   label: 'Mgmt',   color: '#0369a1' },
  { key: 'seag',   label: 'SE AG',  color: '#1d4ed8' },
]
const OTHER_CATS: { key: CatKey; label: string; color: string }[] = [
  { key: 'dryHire',   label: 'Dry Hire',   color: '#d97706' },
  { key: 'wetHire',   label: 'Wet Hire',   color: '#b45309' },
  { key: 'localHire', label: 'Local Hire', color: '#92400e' },
  { key: 'tooling',   label: 'Tooling',    color: '#1d4ed8' },
  { key: 'cars',      label: 'Cars',       color: '#059669' },
  { key: 'accom',     label: 'Accom',      color: '#7c3aed' },
  { key: 'expenses',  label: 'Expenses',   color: '#dc2626' },
]
const ALL_CATS = [...LABOUR_CATS, ...OTHER_CATS]
const HOUR_CATS: { key: 'trades'|'mgmt'|'seag'; label: string }[] = [
  { key: 'trades', label: 'Trades hrs' },
  { key: 'mgmt',   label: 'Mgmt hrs' },
  { key: 'seag',   label: 'SE AG hrs' },
]

// ── Formatters ──
const fmt = (v: number): string => {
  if (Math.abs(v) < 0.5) return '$0'
  return '$' + Math.round(v).toLocaleString('en-AU')
}
const fmtEur = (v: number): string => {
  if (Math.abs(v) < 0.5) return '€0'
  return '€' + Math.round(v).toLocaleString('en-AU')
}
const fmtCat = (v: number, cat: CatKey): string => EUR_CATS.has(cat) ? fmtEur(v) : fmt(v)
const fmtFull = (v: number) => '$' + v.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const fmtGm = (cost: number, sell: number): string => {
  if (sell <= 0.5) return '—'
  const gm = ((sell - cost) / sell) * 100
  return gm.toFixed(1) + '%'
}

function isWeekend(d: string): boolean {
  const dow = new Date(d + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}

interface PeriodGroup {
  key: string
  label: string
  days: string[]
  totals: Record<CatKey, { cost: number; sell: number }>
  hc: number
  hours: { trades: number; mgmt: number; seag: number; total: number }
}

export function ForecastPanel() {
  const { activeProject } = useAppStore()
  const { prefs, setPref } = useUserPrefs()
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)

  const [period, _setPeriod] = useState<Period>((prefs.forecast_period as Period) || 'week')
  const [mode, _setMode] = useState<Mode>((prefs.forecast_mode as Mode) || 'cost')

  function setPeriod(v: Period) { _setPeriod(v); setPref('forecast_period', v) }
  function setMode(v: Mode) { _setMode(v); setPref('forecast_mode', v) }
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({
    labour: true, dryHire: true, wetHire: true, localHire: true,
    tooling: true, cars: true, accom: true, expenses: true,
  })

  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({})
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})

  const [showBaseline, setShowBaseline] = useState(false)
  const [baselineMenuOpen, setBaselineMenuOpen] = useState(false)
  const [savingBaseline, setSavingBaseline] = useState(false)

  const baseline = activeProject?.forecast_baseline as
    | { setAt: string; setBy: string; grandCost: number; grandSell: number; weeks: Record<string,{cost:number;sell:number;hours:number}> }
    | null | undefined

  // EUR→base rate for grand totals/KPIs (raw bucket values for EUR cats are kept in EUR).
  const eurRate = useMemo(() => {
    const rates = (activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || []
    return rates.find(r => r.code === 'EUR')?.rate ?? 1.65
  }, [activeProject?.currency_rates])

  useEffect(() => { if (activeProject) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, rcData, boData, hireData, carData, acData, tcData, expData, tvsData, deptsData] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
      supabase.from('expenses').select('*').eq('project_id', pid),
      supabase.from('global_tvs').select('*'),
      supabase.from('global_departments').select('*'),
    ])
    const stdHours = (activeProject!.std_hours as { day: Record<string,number>; night: Record<string,number> }) || { day:{}, night:{} }
    const publicHolidays = (activeProject!.public_holidays as { date: string }[]) || []
    const fxRates = (activeProject!.currency_rates as { code: string; rate: number }[] | undefined) || []
    const forecast = buildForecast(
      resData.data || [], rcData.data || [], boData.data || [],
      hireData.data || [], carData.data || [], acData.data || [],
      tcData.data || [],
      stdHours, publicHolidays,
      activeProject!.start_date, activeProject!.end_date,
      fxRates,
      (expData.data || []) as Parameters<typeof buildForecast>[12],
      0,
      tvsData.data || [],
      deptsData.data || [],
    )
    setData(forecast)
    setLoading(false)
  }

  const filteredDays = useMemo(() => {
    if (!data) return [] as string[]
    return data.days.filter(d => {
      const b = data.byDay[d]
      const hasLabour = config.labour && (b.trades.cost + b.mgmt.cost + b.seag.cost) > 0
      const hasDry  = config.dryHire   && b.dryHire.cost > 0
      const hasWet  = config.wetHire   && b.wetHire.cost > 0
      const hasLoc  = config.localHire && b.localHire.cost > 0
      const hasTool = config.tooling   && b.tooling.cost > 0
      const hasCar  = config.cars      && b.cars.cost > 0
      const hasAcc  = config.accom     && b.accom.cost > 0
      const hasExp  = config.expenses  && b.expenses.cost > 0
      return hasLabour || hasDry || hasWet || hasLoc || hasTool || hasCar || hasAcc || hasExp
    })
  }, [data, config])

  const groups = useMemo<PeriodGroup[]>(() => {
    if (!data) return []
    const map: Record<string, PeriodGroup> = {}
    for (const d of filteredDays) {
      const key = period === 'week' ? weekKey(d) : monthKey(d)
      if (!map[key]) {
        map[key] = {
          key,
          label: period === 'week' ? weekLabel(key) : monthLabel(key),
          days: [],
          totals: ALL_CATS.reduce((acc, c) => {
            acc[c.key] = { cost: 0, sell: 0 }
            return acc
          }, {} as PeriodGroup['totals']),
          hc: 0,
          hours: { trades: 0, mgmt: 0, seag: 0, total: 0 },
        }
      }
      const g = map[key]
      g.days.push(d)
      const b = data.byDay[d]
      for (const c of ALL_CATS) {
        g.totals[c.key].cost += b[c.key].cost
        g.totals[c.key].sell += b[c.key].sell
      }
      const dayHC = b.trades.headcount + b.mgmt.headcount + b.seag.headcount
      if (dayHC > g.hc) g.hc = dayHC
      g.hours.trades += b.trades.hours
      g.hours.mgmt   += b.mgmt.hours
      g.hours.seag   += b.seag.hours
      g.hours.total  += b.trades.hours + b.mgmt.hours + b.seag.hours
    }
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key))
  }, [data, filteredDays, period])

  const kpis = useMemo(() => {
    let grandCost = 0, grandSell = 0, grandHours = 0
    let peakHC = 0, peakHCDay = ''
    if (data) {
      for (const d of filteredDays) {
        const b = data.byDay[d]
        const tot = bucketTotalBase(b, eurRate)
        grandCost += tot.cost
        grandSell += tot.sell
        grandHours += b.trades.hours + b.mgmt.hours + b.seag.hours
        const hc = b.trades.headcount + b.mgmt.headcount + b.seag.headcount
        if (hc > peakHC) { peakHC = hc; peakHCDay = d }
      }
    }
    const gm = grandSell > 0.5 ? ((grandSell - grandCost) / grandSell * 100) : 0
    return { grandCost, grandSell, grandHours, peakHC, peakHCDay, gm, totalDays: filteredDays.length }
  }, [data, filteredDays, eurRate])

  const activeHrCats = useMemo(() =>
    HOUR_CATS.filter(h => groups.some(g => g.hours[h.key] > 0)),
    [groups]
  )
  const showHrCols = activeHrCats.length > 0

  const activeCats = useMemo(() => {
    if (!data) return []
    return ALL_CATS.filter(c => {
      const cfgKey = (c.key === 'trades' || c.key === 'mgmt' || c.key === 'seag') ? 'labour' : c.key
      if (!config[cfgKey as keyof typeof config]) return false
      return filteredDays.some(d => (data.byDay[d][c.key].cost || 0) > 0.5 || (data.byDay[d][c.key].sell || 0) > 0.5)
    })
  }, [data, filteredDays, config])

  function togglePeriod(k: string) { setExpandedPeriods(p => ({ ...p, [k]: !p[k] })) }
  function toggleDay(k: string) { setExpandedDays(p => ({ ...p, [k]: !p[k] })) }

  function exportCSVHandler() {
    const rows: (string | number)[][] = []
    rows.push(['Period', 'HC', ...activeCats.map(c => c.label + (EUR_CATS.has(c.key) ? ' (EUR)' : '')), 'Total (Base)', 'GM%', ...(showHrCols ? activeHrCats.map(h => h.label) : []), 'Total Hrs'])
    for (const g of groups) {
      const totalBase = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? g.totals[c.key][mode] * eurRate : g.totals[c.key][mode]), 0)
      const totalCost = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? g.totals[c.key].cost * eurRate : g.totals[c.key].cost), 0)
      const totalSell = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? g.totals[c.key].sell * eurRate : g.totals[c.key].sell), 0)
      rows.push([
        g.label,
        g.hc,
        ...activeCats.map(c => Math.round(g.totals[c.key][mode] || 0)),
        Math.round(totalBase),
        fmtGm(totalCost, totalSell),
        ...activeHrCats.map(h => Math.round(g.hours[h.key])),
        Math.round(g.hours.total),
      ])
    }
    downloadCSV(rows, `forecast_${period}_${activeProject?.name || 'project'}`)
  }

  async function saveBaseline() {
    if (!activeProject || !groups.length) return
    setSavingBaseline(true)
    // Baseline always stored by week so toggling period doesn't invalidate it.
    const weekMap: Record<string, { cost: number; sell: number; hours: number }> = {}
    if (data) {
      for (const d of filteredDays) {
        const wk = weekKey(d)
        if (!weekMap[wk]) weekMap[wk] = { cost: 0, sell: 0, hours: 0 }
        const b = data.byDay[d]
        const tot = bucketTotalBase(b, eurRate)
        weekMap[wk].cost += tot.cost
        weekMap[wk].sell += tot.sell
        weekMap[wk].hours += b.trades.hours + b.mgmt.hours + b.seag.hours
      }
    }
    const bl = {
      setAt: new Date().toISOString(),
      setBy: 'user',
      grandCost: kpis.grandCost,
      grandSell: kpis.grandSell,
      weeks: weekMap,
    }
    await supabase.from('projects').update({ forecast_baseline: bl }).eq('id', activeProject.id)
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

  // Chart is always weekly — monthly bars are too few to read as a curve.
  const chartData = useMemo(() => {
    if (!data) return []
    const map: Record<string, { week: string; trades:number; mgmt:number; seag:number; hire:number; tooling:number; cars:number; accom:number; expenses:number; total:number }> = {}
    for (const d of filteredDays) {
      const wk = weekKey(d)
      if (!map[wk]) map[wk] = { week: wk, trades:0, mgmt:0, seag:0, hire:0, tooling:0, cars:0, accom:0, expenses:0, total:0 }
      const b = data.byDay[d]
      map[wk].trades   += b.trades[mode]
      map[wk].mgmt     += b.mgmt[mode]
      map[wk].seag     += b.seag[mode] * eurRate
      map[wk].hire     += b.dryHire[mode] + b.wetHire[mode] + b.localHire[mode]
      map[wk].tooling  += b.tooling[mode] * eurRate
      map[wk].cars     += b.cars[mode]
      map[wk].accom    += b.accom[mode]
      map[wk].expenses += b.expenses[mode]
      map[wk].total    += bucketTotalBase(b, eurRate)[mode]
    }
    return Object.values(map).sort((a, b) => a.week.localeCompare(b.week))
  }, [data, filteredDays, mode, eurRate])

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#8b5cf6', margin: 0 }}>📈 Project Forecast</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', margin: '2px 0 0 0' }}>Day-by-day cost estimate from planned resources, hire, tooling &amp; accommodation</p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
            {(['week', 'month'] as const).map(p => (
              <button key={p}
                style={{ padding: '4px 10px', border: 'none', background: period === p ? 'var(--accent)' : 'var(--bg2)', color: period === p ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: '12px' }}
                onClick={() => setPeriod(p)}>
                {p === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => setMode(mode === 'cost' ? 'sell' : 'cost')}>
            View: {mode === 'cost' ? 'Cost' : 'Sell'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowConfig(s => !s)}>⚙ Configure</button>
          {groups.length > 0 && <button className="btn btn-sm" onClick={exportCSVHandler}>⬇ CSV</button>}
          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm" onClick={() => setBaselineMenuOpen(o => !o)}
              style={{ background: baseline ? 'rgba(99,102,241,.1)' : undefined, color: baseline ? 'var(--accent)' : undefined }}>
              📸 Baseline{baseline ? ' ✓' : ''}
            </button>
            {baselineMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '32px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.15)', padding: '6px', minWidth: '210px', zIndex: 200 }}
                onMouseLeave={() => setBaselineMenuOpen(false)}>
                <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px' }} onClick={saveBaseline} disabled={savingBaseline}>
                  📸 {baseline ? 'Replace' : 'Set'} Baseline (snapshot now)
                </button>
                {baseline && <>
                  <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px' }} onClick={() => { setShowBaseline(s => !s); setBaselineMenuOpen(false) }}>
                    👁 {showBaseline ? 'Hide' : 'Show'} Baseline Comparison
                  </button>
                  <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px', color: 'var(--red)' }} onClick={clearBaseline}>
                    🗑 Clear Baseline
                  </button>
                </>}
              </div>
            )}
          </div>
        </div>
      </div>

      {baseline && (
        <div style={{ padding: '8px 12px', background: '#f0f9ff', borderLeft: '3px solid #0ea5e9', borderRadius: '6px', marginBottom: '12px', fontSize: '12px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>📸</span>
          <span style={{ fontWeight: 600, color: '#0369a1' }}>
            Baseline set {new Date(baseline.setAt).toLocaleString('en-AU', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
          </span>
          <span style={{ color: '#64748b' }}>{fmtFull(baseline.grandCost)} cost · {fmtFull(baseline.grandSell)} sell</span>
        </div>
      )}

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
                <input type="checkbox" checked={config[key]} onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid" style={{ marginBottom: '14px' }}>
        <div className="kpi-card" style={{ borderTopColor: '#0891b2' }}>
          <div className="kpi-val" style={{ color: '#0891b2' }}>{fmtFull(kpis.grandCost)}</div>
          <div className="kpi-lbl">Total Cost ({(activeProject?.currency as string) || 'AUD'})</div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: '#059669' }}>
          <div className="kpi-val" style={{ color: '#059669' }}>{fmtFull(kpis.grandSell)}</div>
          <div className="kpi-lbl">Total Sell ({(activeProject?.currency as string) || 'AUD'})</div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: kpis.gm >= 15 ? 'var(--green)' : kpis.gm >= 10 ? 'var(--amber)' : 'var(--red)' }}>
          <div className="kpi-val" style={{ color: kpis.gm >= 15 ? 'var(--green)' : kpis.gm >= 10 ? 'var(--amber)' : 'var(--red)' }}>{kpis.gm.toFixed(1)}%</div>
          <div className="kpi-lbl">Blended GM%</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-val">{Math.ceil(kpis.totalDays / 7)}w / {kpis.totalDays}d</div>
          <div className="kpi-lbl">Forecast Span</div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: '#7c3aed' }}>
          <div className="kpi-val" style={{ color: '#7c3aed' }}>{kpis.peakHC}</div>
          <div className="kpi-lbl">Peak HC{kpis.peakHCDay ? ' · ' + kpis.peakHCDay.slice(5).replace('-', '/') : ''}</div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: '#0891b2' }}>
          <div className="kpi-val" style={{ color: '#0891b2' }}>{Math.round(kpis.grandHours).toLocaleString('en-AU')}h</div>
          <div className="kpi-lbl">Total Labour Hours</div>
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Building forecast...</div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📈</div>
          <h3>No forecast data</h3>
          <p>Add resources with mob dates, hire items, and tooling to generate a forecast. Ensure rate cards are assigned to resources and standard hours are configured in Project Settings.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    <th style={{ width: '32px' }}></th>
                    <th></th>
                    <th></th>
                    {activeCats.filter(c => LABOUR_CATS.find(l => l.key === c.key)).length > 0 && (
                      <th colSpan={activeCats.filter(c => LABOUR_CATS.find(l => l.key === c.key)).length}
                        style={{ textAlign: 'center', fontSize: '10px', color: '#0891b2', borderBottom: '2px solid #0891b2', padding: '4px 8px' }}>LABOUR</th>
                    )}
                    {activeCats.filter(c => OTHER_CATS.find(o => o.key === c.key)).map(c => <th key={'spacer-' + c.key}></th>)}
                    <th></th>
                    <th></th>
                    {showHrCols && (
                      <th colSpan={activeHrCats.length + 1}
                        style={{ textAlign: 'center', fontSize: '10px', color: '#0891b2', borderBottom: '2px solid #0891b2', padding: '4px 8px', borderLeft: '1px solid var(--border2)' }}>HOURS</th>
                    )}
                  </tr>
                  <tr style={{ background: 'var(--bg3)' }}>
                    <th style={{ width: '32px' }}></th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', minWidth: '180px' }}>{period === 'week' ? 'Week' : 'Month'} / Day</th>
                    <th style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text2)' }}>HC</th>
                    {activeCats.map(c => (
                      <th key={c.key} style={{ textAlign: 'center', fontSize: '11px', color: c.color, whiteSpace: 'nowrap', padding: '6px 8px' }}>{c.label}</th>
                    ))}
                    <th style={{ textAlign: 'center', fontSize: '11px', color: 'var(--accent)', whiteSpace: 'nowrap' }}>Total</th>
                    <th style={{ textAlign: 'center', fontSize: '11px', color: 'var(--green)' }}>GM%</th>
                    {showHrCols && activeHrCats.map((h, idx) => (
                      <th key={h.key} style={{ textAlign: 'center', fontSize: '11px', color: '#0891b2', whiteSpace: 'nowrap', borderLeft: idx === 0 ? '1px solid var(--border2)' : undefined }}>{h.label}</th>
                    ))}
                    {showHrCols && <th style={{ textAlign: 'center', fontSize: '11px', color: '#0891b2', fontWeight: 700, whiteSpace: 'nowrap' }}>Total hrs</th>}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => {
                    const isExp = !!expandedPeriods[g.key]
                    const totalBase = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? g.totals[c.key][mode] * eurRate : g.totals[c.key][mode]), 0)
                    const totalCost = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? g.totals[c.key].cost * eurRate : g.totals[c.key].cost), 0)
                    const totalSell = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? g.totals[c.key].sell * eurRate : g.totals[c.key].sell), 0)
                    return (
                      <PeriodRowFragment
                        key={g.key}
                        g={g}
                        isExp={isExp}
                        mode={mode}
                        period={period}
                        activeCats={activeCats}
                        activeHrCats={activeHrCats}
                        showHrCols={showHrCols}
                        eurRate={eurRate}
                        totalBase={totalBase}
                        totalCost={totalCost}
                        totalSell={totalSell}
                        data={data!}
                        baseline={baseline}
                        showBaseline={showBaseline}
                        expandedDays={expandedDays}
                        onTogglePeriod={() => togglePeriod(g.key)}
                        onToggleDay={k => toggleDay(k)}
                      />
                    )
                  })}
                  <tr style={{ background: '#0f1e2e', color: '#fff', borderTop: '3px solid var(--accent)' }}>
                    <td></td>
                    <td style={{ padding: '10px', fontWeight: 700, fontSize: '13px' }}>PROJECT TOTAL</td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', color: '#94a3b8' }}>Peak: {kpis.peakHC}</td>
                    {activeCats.map(c => {
                      let tot = 0
                      for (const g of groups) tot += g.totals[c.key][mode] || 0
                      return (
                        <td key={c.key} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtCat(tot, c.key)}</td>
                      )
                    })}
                    <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '14px', color: '#00c5c7' }}>{fmtFull(mode === 'sell' ? kpis.grandSell : kpis.grandCost)}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--mono)' }}>{fmtGm(kpis.grandCost, kpis.grandSell)}</td>
                    {showHrCols && activeHrCats.map((h, idx) => {
                      let hrs = 0
                      for (const g of groups) hrs += g.hours[h.key] || 0
                      return (
                        <td key={h.key} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, color: '#0891b2', borderLeft: idx === 0 ? '1px solid #334155' : undefined }}>
                          {Math.round(hrs)}h
                        </td>
                      )
                    })}
                    {showHrCols && <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 800, color: '#0891b2' }}>{Math.round(kpis.grandHours)}h</td>}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text3)', padding: '0 4px' }}>
            💡 Labour estimated from standard hours template × rate cards. SE AG and tooling shown in € (source); totals converted to base. Click a {period === 'week' ? 'week' : 'month'} to expand days. Click a day to see who's on site. 🟢/🔴 badges = mob/demob events.
          </div>

          {data?.accomWarnings && data.accomWarnings.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: '6px', padding: '10px 14px', marginTop: '12px', fontSize: '12px', color: '#78350f' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', color: '#92400e' }}>⚠ Accommodation booking mismatches — occupant dates fall outside booking window</div>
              {data.accomWarnings.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0', borderBottom: '1px solid #fde68a' }}>
                  <span>⚠</span>
                  <div>
                    <span style={{ fontWeight: 600 }}>{w.property}{w.room ? ' · ' + w.room : ''}</span>
                    <span style={{ color: '#92400e' }}>
                      {' '}— {w.person}'s dates {w.outsideBefore ? `start ${w.personStart} before booking opens ${w.bookStart}` : ''}
                      {w.outsideBefore && w.outsideAfter ? ' & ' : ''}
                      {w.outsideAfter ? `end ${w.personEnd} after booking closes ${w.bookEnd}` : ''}
                    </span>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '8px', color: 'var(--text3)' }}>Fix these in People &amp; HR → Accommodation. Forecast uses person's planned dates regardless.</div>
            </div>
          )}

          <div className="card" style={{ marginTop: '20px' }}>
            <div style={{ fontWeight: 600, marginBottom: '12px', fontSize: '13px' }}>Weekly {mode === 'sell' ? 'Sell' : 'Cost'} by Category</div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={w => w.slice(5)} />
                <YAxis tickFormatter={v => v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: unknown) => fmtFull(Number(v))} labelFormatter={l => `Week: ${l}`} />
                <Legend />
                <Bar dataKey="trades" name="Trades" stackId="a" fill="#0891b2" />
                <Bar dataKey="mgmt" name="Management" stackId="a" fill="#0369a1" />
                <Bar dataKey="seag" name="SE AG" stackId="a" fill="#1d4ed8" />
                <Bar dataKey="hire" name="Equipment Hire" stackId="a" fill="#d97706" />
                <Bar dataKey="tooling" name="Tooling" stackId="a" fill="#0ea5e9" />
                <Bar dataKey="cars" name="Cars" stackId="a" fill="#059669" />
                <Bar dataKey="accom" name="Accommodation" stackId="a" fill="#7c3aed" />
                <Bar dataKey="expenses" name="Expenses" stackId="a" fill="#dc2626" />
                <Line type="monotone" dataKey="total" name="Total" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}

// ─── PeriodRowFragment + nested days + people grid ────────────────────────────
interface PeriodRowProps {
  g: PeriodGroup
  isExp: boolean
  mode: Mode
  period: Period
  activeCats: { key: CatKey; label: string; color: string }[]
  activeHrCats: { key: 'trades'|'mgmt'|'seag'; label: string }[]
  showHrCols: boolean
  eurRate: number
  totalBase: number
  totalCost: number
  totalSell: number
  data: ForecastData
  baseline: { weeks: Record<string,{cost:number;sell:number;hours:number}> } | null | undefined
  showBaseline: boolean
  expandedDays: Record<string, boolean>
  onTogglePeriod: () => void
  onToggleDay: (k: string) => void
}

function PeriodRowFragment(props: PeriodRowProps) {
  const { g, isExp, mode, period, activeCats, activeHrCats, showHrCols, eurRate, totalBase, totalCost, totalSell, data, baseline, showBaseline, expandedDays, onTogglePeriod, onToggleDay } = props
  return (
    <>
      <tr style={{ background: 'var(--bg3)', borderTop: '2px solid var(--border2)' }}>
        <td style={{ textAlign: 'center', padding: '6px 4px', cursor: 'pointer' }} onClick={onTogglePeriod}>
          <span style={{ fontSize: '12px', color: 'var(--text3)' }}>{isExp ? '▾' : '▸'}</span>
        </td>
        <td style={{ fontWeight: 600, padding: '8px 10px', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={onTogglePeriod}>
          {g.label}
        </td>
        <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{g.hc || '—'}</td>
        {activeCats.map(c => {
          const v = g.totals[c.key][mode] || 0
          return (
            <td key={c.key} style={{ textAlign: 'center', fontFamily: 'var(--mono)' }}>
              {v > 0.5 ? fmtCat(v, c.key) : '—'}
            </td>
          )
        })}
        <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>{fmt(totalBase)}</td>
        <td style={{ textAlign: 'center', fontFamily: 'var(--mono)' }}>{fmtGm(totalCost, totalSell)}</td>
        {showHrCols && activeHrCats.map((h, idx) => (
          <td key={h.key} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: '#0891b2', borderLeft: idx === 0 ? '1px solid var(--border2)' : undefined }}>
            {g.hours[h.key] > 0 ? Math.round(g.hours[h.key]) + 'h' : '—'}
          </td>
        ))}
        {showHrCols && (
          <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600, color: '#0891b2' }}>
            {g.hours.total > 0 ? Math.round(g.hours.total) + 'h' : '—'}
          </td>
        )}
      </tr>

      {/* Baseline comparison row — weekly only since baseline is stored by week */}
      {baseline && showBaseline && period === 'week' && (() => {
        const bWk = baseline.weeks?.[g.key]
        const bVal = bWk ? bWk[mode === 'sell' ? 'sell' : 'cost'] : 0
        const delta = totalBase - bVal
        const deltaCol = delta > 0 ? '#dc2626' : delta < 0 ? '#059669' : '#94a3b8'
        const sign = delta >= 0 ? '+' : ''
        return (
          <tr style={{ background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}>
            <td></td>
            <td style={{ padding: '3px 10px 3px 28px', fontSize: '10px', color: '#0369a1', fontStyle: 'italic' }}>
              Baseline {bWk ? fmt(bVal) : '—'}
            </td>
            <td colSpan={activeCats.length + 1} style={{ fontSize: '10px', color: '#0369a1', textAlign: 'center' }}>
              {bWk ? <>vs baseline: <span style={{ color: deltaCol, fontWeight: 600 }}>{sign}{fmt(delta)}</span></> : <span style={{ color: '#94a3b8' }}>no baseline for this week</span>}
            </td>
            <td colSpan={1 + (showHrCols ? activeHrCats.length + 1 : 0)}></td>
          </tr>
        )
      })()}

      {isExp && g.days.map(d => {
        const b = data.byDay[d]
        const dayCost = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? b[c.key].cost * eurRate : b[c.key].cost), 0)
        const daySell = activeCats.reduce((s, c) => s + (EUR_CATS.has(c.key) ? b[c.key].sell * eurRate : b[c.key].sell), 0)
        const dayBase = mode === 'sell' ? daySell : dayCost
        const dayHC = b.trades.headcount + b.mgmt.headcount + b.seag.headcount
        const dayHrs = b.trades.hours + b.mgmt.hours + b.seag.hours
        const dayKey = g.key + '|' + d
        const dayExp = !!expandedDays[dayKey]
        const weekend = isWeekend(d)
        const dtLabel = new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
        const mobs = b.people.filter(p => p.isMob)
        const demobs = b.people.filter(p => p.isDemob && !p.isMob)

        return (
          <Fragment key={dayKey}>
            <tr style={{ background: weekend ? '#faf5ff' : 'var(--bg2)', borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => onToggleDay(dayKey)}>
              <td></td>
              <td style={{ padding: '6px 10px 6px 28px', fontSize: '12px', color: weekend ? '#7c3aed' : 'var(--text2)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text3)', marginRight: '4px' }}>{dayExp ? '▾' : '▸'}</span>
                {dtLabel}
                {mobs.length > 0 && (
                  <span style={{ fontSize: '10px', background: '#dcfce7', color: '#166534', borderRadius: '3px', padding: '1px 5px', marginLeft: '6px' }} title={mobs.map(p => p.name).join(', ') + ' arriving'}>
                    🟢 {mobs.length} mob
                  </span>
                )}
                {demobs.length > 0 && (
                  <span style={{ fontSize: '10px', background: '#fee2e2', color: '#991b1b', borderRadius: '3px', padding: '1px 5px', marginLeft: '4px' }} title={demobs.map(p => p.name).join(', ') + ' departing'}>
                    🔴 {demobs.length} demob
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{dayHC || '—'}</td>
              {activeCats.map(c => {
                const v = b[c.key][mode] || 0
                return (
                  <td key={c.key} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: v > 0.5 ? 'var(--text)' : 'var(--text3)' }}>
                    {v > 0.5 ? fmtCat(v, c.key) : '—'}
                  </td>
                )
              })}
              <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: dayBase > 0.5 ? 'var(--accent)' : 'var(--text3)' }}>
                {dayBase > 0.5 ? fmt(dayBase) : '—'}
              </td>
              <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px' }}>{fmtGm(dayCost, daySell)}</td>
              {showHrCols && activeHrCats.map((h, idx) => (
                <td key={h.key} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: '#0891b2', borderLeft: idx === 0 ? '1px solid var(--border2)' : undefined }}>
                  {b[h.key].hours > 0 ? Math.round(b[h.key].hours) + 'h' : '—'}
                </td>
              ))}
              {showHrCols && <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: '#0891b2' }}>{dayHrs > 0 ? Math.round(dayHrs) + 'h' : '—'}</td>}
            </tr>

            {dayExp && b.people.length > 0 && (
              <tr style={{ background: weekend ? '#f5f0ff' : '#f8fafc', borderTop: '1px solid var(--border)' }}>
                <td></td>
                <td colSpan={activeCats.length + 4 + (showHrCols ? activeHrCats.length + 1 : 0)} style={{ padding: '0 0 6px 56px' }}>
                  <PeopleGrid people={b.people} mode={mode} />
                </td>
              </tr>
            )}
          </Fragment>
        )
      })}
    </>
  )
}

interface PeopleGridProps { people: DayPerson[]; mode: Mode }
function PeopleGrid({ people, mode }: PeopleGridProps) {
  const sorted = [...people].sort((a, b) => {
    const order = { trades: 0, mgmt: 1, seag: 2 } as const
    return (order[a.category] ?? 3) - (order[b.category] ?? 3) || a.name.localeCompare(b.name)
  })
  const catColor = { trades: '#0891b2', mgmt: '#0369a1', seag: '#1d4ed8' } as const
  const catLabel = { trades: 'Trades', mgmt: 'Mgmt', seag: 'SE AG' } as const
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '4px', padding: '6px 16px 6px 0' }}>
      {sorted.map((p, i) => {
        const v = mode === 'sell' ? p.sell : p.cost
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 8px', background: 'var(--bg2)', borderRadius: '4px', borderLeft: `3px solid ${catColor[p.category]}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
              {p.role && <span style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{p.role}</span>}
              <span style={{ fontSize: '9px', background: catColor[p.category] + '22', color: catColor[p.category], borderRadius: '2px', padding: '1px 4px' }}>{catLabel[p.category]}</span>
              {p.isMob && <span style={{ fontSize: '9px', background: '#dcfce7', color: '#166534', borderRadius: '2px', padding: '1px 4px' }}>MOB</span>}
              {p.isDemob && !p.isMob && <span style={{ fontSize: '9px', background: '#fee2e2', color: '#991b1b', borderRadius: '2px', padding: '1px 4px' }}>DEMOB</span>}
              {p.isBackOffice && <span style={{ fontSize: '9px', background: '#e0e7ff', color: '#4338ca', borderRadius: '2px', padding: '1px 4px' }}>BO</span>}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)', whiteSpace: 'nowrap', marginLeft: '8px' }}>
              {fmt(v)}
              {p.hours > 0 && <span style={{ fontSize: '10px', color: '#0891b2', marginLeft: '6px' }}>{Math.round(p.hours)}h</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
