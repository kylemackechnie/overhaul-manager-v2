/**
 * WalkAwayPanel — Sandbox › Walk-Away Analysis
 *
 * Picks a date D and answers: "if we stopped the project on D, what's the bill?"
 *
 * Each dollar in EAC classifies into one of four buckets:
 *   - Sunk          — already spent, irrecoverable as of D
 *   - Locked        — committed, paid even if we stop on D (inside notice
 *                     period or contractually bound)
 *   - Avoidable     — currently forecast but recoverable if we stop by D
 *   - Discretionary — future cost with no commitment yet
 *
 * Sources currently implemented: flights, expenses. Other sources are stubbed
 * in the engine and contribute zero; they get filled in over subsequent
 * commits and plug into this UI without changes.
 *
 * Notice periods (per cost source) come from projects.walk_away_settings.notice_days
 * and are editable from the popover near the date picker.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { HelpButton } from '../../components/HelpButton'
import { classifyWalkAway, todayIso } from '../../engines/walkAwayEngine'
import { buildForecast } from '../../engines/forecastEngine'
import type {
  Resource, Flight, Expense, Car, Accommodation, HireItem,
  ToolingCosting, WeeklyTimesheet, BackOfficeHour, SeSupportEntry,
  Variation, VariationLine, PurchaseOrder, Invoice, RateCard,
  WalkAwayResult, WalkAwaySource, WalkAwayTimesheetCostLine, GlobalTV, GlobalDepartment,
} from '../../types'

// ── Source display labels (order = panel row order) ──────────────────────────
const SOURCE_LABELS: { key: WalkAwaySource; label: string; implemented: boolean }[] = [
  { key: 'flights',         label: 'Flights',           implemented: true  },
  { key: 'expenses',        label: 'Expenses',          implemented: true  },
  { key: 'cars',            label: 'Cars',              implemented: true  },
  { key: 'accommodation',   label: 'Accommodation',     implemented: true  },
  { key: 'dry_hire',        label: 'Dry Hire',          implemented: true  },
  { key: 'wet_hire',        label: 'Wet Hire',          implemented: true  },
  { key: 'local_hire',      label: 'Local Hire',        implemented: true  },
  { key: 'tooling',         label: 'Tooling',           implemented: true  },
  { key: 'labour_trades',   label: 'Labour (Trades)',   implemented: true  },
  { key: 'labour_mgmt',     label: 'Labour (Mgmt)',     implemented: true  },
  { key: 'labour_seag',     label: 'Labour (SE AG)',    implemented: true  },
  { key: 'labour_subcon',   label: 'Labour (Subcon)',   implemented: true  },
  { key: 'back_office',     label: 'Back Office',       implemented: true  },
  { key: 'se_ag_support',   label: 'SE AG Support',     implemented: true  },
  { key: 'variations',      label: 'Variations',        implemented: true  },
]

const BUCKET_META = {
  sunk:          { label: 'Sunk',          color: '#475569', desc: 'Already spent — irrecoverable' },
  locked:        { label: 'Locked',        color: '#b45309', desc: 'Committed — paid even if we stop' },
  avoidable:     { label: 'Avoidable',     color: '#059669', desc: 'Forecast but still cancellable' },
  discretionary: { label: 'Discretionary', color: '#3b82f6', desc: 'Future cost — no commitment yet' },
} as const

// Compact currency formatter — Walk-Away numbers are bigger than expense ones
const fmt = (v: number) => {
  if (Math.abs(v) < 0.5) return '—'
  return '$' + v.toLocaleString('en-AU', { maximumFractionDigits: 0 })
}
const pct = (n: number, of: number) => of <= 0 ? '0%' : `${Math.round((n / of) * 100)}%`

// Render a signed delta with sign + thousands separator. "—" for near-zero
// to keep the eye from chasing rounding noise.
const fmtDelta = (delta: number) => {
  if (Math.abs(delta) < 0.5) return '—'
  const sign = delta >= 0 ? '+' : '−'
  return sign + '$' + Math.abs(Math.round(delta)).toLocaleString('en-AU')
}

export function WalkAwayPanel() {
  const { activeProject } = useAppStore()

  // The walk-away date the engine runs against (default = today)
  const [asOf, setAsOf] = useState<string>(todayIso())

  // Compare-two-dates mode. When enabled, the engine also runs against asOfB
  // and the panel renders A → B side-by-side. Default B is project end date
  // (most useful "what gets locked between now and finish" question), with
  // today + 30 days as a fallback if the project has no end date set.
  const [compareMode, setCompareMode] = useState<boolean>(false)
  const [asOfB, setAsOfB] = useState<string>(todayIso())

  // Per-source notice periods, sourced from projects.walk_away_settings.notice_days.
  // Editable inline via the popover; saves back to the project record.
  const [noticeDays, setNoticeDays] = useState<Partial<Record<WalkAwaySource, number>>>({})
  const [showNoticeEditor, setShowNoticeEditor] = useState(false)
  const [savingNotice, setSavingNotice] = useState(false)

  // Raw cost-source data loaded once per project
  const [resources, setResources] = useState<Resource[]>([])
  const [flights, setFlights] = useState<Flight[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [accom, setAccom] = useState<Accommodation[]>([])
  const [hireItems, setHireItems] = useState<HireItem[]>([])
  const [toolingCostings, setToolingCostings] = useState<ToolingCosting[]>([])
  const [weeklyTimesheets, setWeeklyTimesheets] = useState<WeeklyTimesheet[]>([])
  const [backOfficeHours, setBackOfficeHours] = useState<BackOfficeHour[]>([])
  const [variations, setVariations] = useState<Variation[]>([])
  const [variationLines, setVariationLines] = useState<VariationLine[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [globalTVs, setGlobalTVs] = useState<GlobalTV[]>([])
  const [globalDepartments, setGlobalDepartments] = useState<GlobalDepartment[]>([])
  const [timesheetCostLines, setTimesheetCostLines] = useState<WalkAwayTimesheetCostLine[]>([])
  const [seSupport, setSeSupport] = useState<SeSupportEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Pick up FX rates + notice settings from the active project
  const fxRates = useMemo(
    () => (activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || [],
    [activeProject],
  )

  useEffect(() => {
    if (!activeProject) return
    // Seed notice-days from the project's saved settings; fall back to 1 per source
    const saved = (activeProject.walk_away_settings?.notice_days as Record<string, number> | undefined) || {}
    const seeded: Partial<Record<WalkAwaySource, number>> = {}
    for (const s of SOURCE_LABELS) {
      seeded[s.key] = typeof saved[s.key] === 'number' ? saved[s.key] : 1
    }
    setNoticeDays(seeded)
    // Seed compare date B with the project end date (most useful default).
    // Falls back to today + 30 if no end date is set.
    if (activeProject.end_date) {
      setAsOfB(activeProject.end_date)
    } else {
      const d = new Date()
      d.setDate(d.getDate() + 30)
      setAsOfB(d.toISOString().slice(0, 10))
    }
  }, [activeProject])

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id
    const [resR, flR, expR, carR, accR, hireR, tcR, tsR, boR, varR, varLR, poR, invR, rcR, tvR, depR, tclR, seR] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('flights').select('*').eq('project_id', pid),
      supabase.from('expenses').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
      supabase.from('weekly_timesheets').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('variations').select('*').eq('project_id', pid),
      supabase.from('variation_lines').select('*').eq('project_id', pid),
      supabase.from('purchase_orders').select('*').eq('project_id', pid),
      supabase.from('invoices').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('global_tvs').select('*'),
      supabase.from('global_departments').select('*'),
      // All statuses (draft/submitted/approved) — walk-away treats any timesheet
      // entry as an incurred cost, regardless of approval workflow position.
      supabase.from('timesheet_cost_lines')
        .select('work_date,category,cost_labour,cost_allowances,wbs,timesheet_status')
        .eq('project_id', pid),
      supabase.from('se_support_costs').select('*').eq('project_id', pid),
    ])
    setResources((resR.data || []) as Resource[])
    setFlights((flR.data || []) as Flight[])
    setExpenses((expR.data || []) as Expense[])
    setCars((carR.data || []) as Car[])
    setAccom((accR.data || []) as Accommodation[])
    setHireItems((hireR.data || []) as HireItem[])
    setToolingCostings((tcR.data || []) as ToolingCosting[])
    setWeeklyTimesheets((tsR.data || []) as WeeklyTimesheet[])
    setBackOfficeHours((boR.data || []) as BackOfficeHour[])
    setVariations((varR.data || []) as Variation[])
    setVariationLines((varLR.data || []) as VariationLine[])
    setPurchaseOrders((poR.data || []) as PurchaseOrder[])
    setInvoices((invR.data || []) as Invoice[])
    setRateCards((rcR.data || []) as RateCard[])
    setGlobalTVs((tvR.data || []) as GlobalTV[])
    setGlobalDepartments((depR.data || []) as GlobalDepartment[])
    setTimesheetCostLines((tclR.data || []) as WalkAwayTimesheetCostLine[])
    setSeSupport((seR.data || []) as SeSupportEntry[])
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeProject?.id])

  // Build the forecast once per data change. Reused for both walk-away dates
  // when compare mode is active — buildForecast is heavy, no need to re-run
  // it for the same project state just because asOfB changes.
  const forecast = useMemo(() => {
    if (!activeProject || loading) return null
    return buildForecast(
      resources,
      rateCards,
      backOfficeHours,
      hireItems,
      cars,
      accom,
      toolingCostings,
      activeProject.std_hours,
      activeProject.public_holidays || [],
      activeProject.start_date,
      activeProject.end_date,
      fxRates,
      expenses,
      0,
      globalTVs,
      globalDepartments,
      purchaseOrders,
      invoices,
      flights,
    )
  }, [activeProject, loading, resources, rateCards, backOfficeHours, hireItems, cars, accom, toolingCostings, fxRates, expenses, globalTVs, globalDepartments, purchaseOrders, invoices, flights])

  // Common input bag for classifyWalkAway — extracted so the A and B runs
  // can't drift in what they're given.
  const engineInput = useMemo(() => {
    if (!activeProject || !forecast) return null
    return {
      project: activeProject,
      resources, flights, expenses, cars, accommodation: accom,
      hireItems, toolingCostings, weeklyTimesheets, backOfficeHours,
      seSupport,
      variations, variationLines, purchaseOrders, invoices, rateCards,
      fxRates,
      noticeDays,
      forecast,
      timesheetCostLines,
    }
  }, [activeProject, forecast, resources, flights, expenses, cars, accom, hireItems, toolingCostings, weeklyTimesheets, backOfficeHours, seSupport, variations, variationLines, purchaseOrders, invoices, rateCards, fxRates, noticeDays, timesheetCostLines])

  // Run the engine for date A (always) and date B (only in compare mode)
  const result: WalkAwayResult | null = useMemo(() => {
    if (!engineInput) return null
    return classifyWalkAway(engineInput, asOf)
  }, [engineInput, asOf])

  const resultB: WalkAwayResult | null = useMemo(() => {
    if (!engineInput || !compareMode) return null
    return classifyWalkAway(engineInput, asOfB)
  }, [engineInput, compareMode, asOfB])

  async function saveNoticeDays() {
    if (!activeProject) return
    setSavingNotice(true)
    const payload = {
      walk_away_settings: { notice_days: noticeDays },
    }
    const { error } = await supabase.from('projects').update(payload).eq('id', activeProject.id)
    setSavingNotice(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Notice periods saved', 'success')
    setShowNoticeEditor(false)
  }

  if (!activeProject) {
    return <div style={{ padding: '24px' }}>Select a project to run Walk-Away analysis.</div>
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div data-tour="walkaway-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>🚪 Walk-Away Analysis</h1>
        <HelpButton panelId="sandbox-walkaway" />
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text3)', margin: '0 0 16px 0' }}>
        If we stopped on the chosen date, what's the bill? Sunk + Locked is the cost you can't avoid; Avoidable + Discretionary is what you save by stopping.
      </p>

      {/* Date picker + notice-period editor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <label data-tour="walkaway-date" style={{ fontSize: '12px', color: 'var(--text2)' }}>
          {compareMode ? 'Date A:' : 'Walk-away date:'}&nbsp;
          <input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} style={{ width: '160px' }} />
        </label>
        <button className="btn btn-sm" onClick={() => setAsOf(todayIso())}>Today</button>
        {compareMode && (
          <label style={{ fontSize: '12px', color: 'var(--text2)' }}>
            Date B:&nbsp;
            <input type="date" className="input" value={asOfB} onChange={e => setAsOfB(e.target.value)} style={{ width: '160px' }} />
          </label>
        )}
        <button
          data-tour="walkaway-compare"
          className={'btn btn-sm' + (compareMode ? ' btn-primary' : '')}
          onClick={() => setCompareMode(c => !c)}
          title="Run the engine for two dates and show A → B with deltas"
        >
          {compareMode ? '✓ Compare' : '⇄ Compare two dates'}
        </button>
        <button data-tour="walkaway-notice" className="btn btn-sm" onClick={() => setShowNoticeEditor(s => !s)}>
          ⚙️ Notice periods {showNoticeEditor ? '▲' : '▼'}
        </button>
        {loading && <span style={{ fontSize: '12px', color: 'var(--text3)' }}><span className="spinner" style={{ width: 12, height: 12 }} /> Loading…</span>}
      </div>

      {showNoticeEditor && (
        <div className="card" style={{ padding: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '8px' }}>
            Notice period (days) for each cost source. If a flight, booking, or commitment falls within this window before the walk-away date, it counts as <strong>Locked</strong> instead of <strong>Avoidable</strong>. 1 day = same-day cancellation only.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px', marginBottom: '12px' }}>
            {SOURCE_LABELS.map(s => (
              <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', opacity: s.implemented ? 1 : 0.5 }}>
                <span style={{ flex: 1 }}>{s.label}</span>
                <input
                  type="number"
                  className="input"
                  min={0}
                  step={1}
                  value={noticeDays[s.key] ?? 1}
                  onChange={e => setNoticeDays(prev => ({ ...prev, [s.key]: Math.max(0, parseInt(e.target.value) || 0) }))}
                  style={{ width: '70px', textAlign: 'right' }}
                  disabled={!s.implemented}
                  title={s.implemented ? undefined : 'Source not yet implemented in engine'}
                />
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveNoticeDays} disabled={savingNotice}>
            {savingNotice ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* KPI strip */}
      {result && (
        <div data-tour="walkaway-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
          {(Object.keys(BUCKET_META) as (keyof typeof BUCKET_META)[]).map(b => {
            const meta = BUCKET_META[b]
            const amt = result.buckets[b].total
            const amtB = resultB?.buckets[b].total ?? 0
            const delta = amtB - amt
            const isEmpty = Math.abs(amt) < 0.5 && (!compareMode || Math.abs(amtB) < 0.5)
            return (
              <div key={b} className="card" style={{ padding: '14px', borderLeft: `4px solid ${meta.color}`, opacity: isEmpty ? 0.55 : 1 }}>
                <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: meta.color, marginTop: '4px' }}>{fmt(amt)}</div>
                {compareMode && resultB ? (
                  <div style={{ fontSize: '12px', fontFamily: 'var(--mono)', color: 'var(--text2)', marginTop: '4px' }}>
                    → {fmt(amtB)} <span style={{ color: 'var(--text3)' }}>({fmtDelta(delta)})</span>
                  </div>
                ) : null}
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                  {isEmpty ? meta.desc : `${pct(amt, result.total)} of total · ${meta.desc}`}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Cost-to-stop / cost-to-continue headline */}
      {result && (
        <div data-tour="walkaway-headline" className="card" style={{ padding: '14px', marginBottom: '16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase' }}>
              If we stop on {asOf}{compareMode && resultB ? ` vs ${asOfB}` : ''}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#b45309' }}>
              {fmt(result.buckets.sunk.total + result.buckets.locked.total)}
              {compareMode && resultB && (
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text2)', marginLeft: '8px' }}>
                  → {fmt(resultB.buckets.sunk.total + resultB.buckets.locked.total)}
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Sunk + Locked</div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '20px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase' }}>We'd save</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#059669' }}>
              {fmt(result.buckets.avoidable.total + result.buckets.discretionary.total)}
              {compareMode && resultB && (
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text2)', marginLeft: '8px' }}>
                  → {fmt(resultB.buckets.avoidable.total + resultB.buckets.discretionary.total)}
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Avoidable + Discretionary</div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '20px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase' }}>Total EAC contribution</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
              {fmt(result.total)}
              {compareMode && resultB && (
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text2)', marginLeft: '8px' }}>
                  → {fmt(resultB.total)}
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>All 15 cost sources combined</div>
          </div>
        </div>
      )}

      {/* Breakdown table */}
      {result && (
        <div data-tour="walkaway-breakdown" className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Cost source</th>
                {(Object.keys(BUCKET_META) as (keyof typeof BUCKET_META)[]).map(b => (
                  <th key={b} style={{ textAlign: 'right', color: BUCKET_META[b].color }}>{BUCKET_META[b].label}</th>
                ))}
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {SOURCE_LABELS.map(s => {
                const sunk = result.buckets.sunk.bySource[s.key] || 0
                const locked = result.buckets.locked.bySource[s.key] || 0
                const avoidable = result.buckets.avoidable.bySource[s.key] || 0
                const discretionary = result.buckets.discretionary.bySource[s.key] || 0
                const rowTotal = sunk + locked + avoidable + discretionary
                // B-side values (only meaningful when compareMode + resultB)
                const sunkB = resultB?.buckets.sunk.bySource[s.key] || 0
                const lockedB = resultB?.buckets.locked.bySource[s.key] || 0
                const avoidableB = resultB?.buckets.avoidable.bySource[s.key] || 0
                const discretionaryB = resultB?.buckets.discretionary.bySource[s.key] || 0
                const rowTotalB = sunkB + lockedB + avoidableB + discretionaryB
                const isComparing = compareMode && !!resultB

                if (!s.implemented && rowTotal === 0 && rowTotalB === 0) {
                  return (
                    <tr key={s.key} style={{ opacity: 0.45 }}>
                      <td>{s.label}</td>
                      <td colSpan={5} style={{ fontSize: '11px', color: 'var(--text3)', fontStyle: 'italic' }}>
                        Engine support coming in a later commit
                      </td>
                    </tr>
                  )
                }
                // Per-cell A → B rendering. When not comparing, just A.
                const cell = (a: number, b: number, color: string) => (
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color }}>
                    {fmt(a)}
                    {isComparing && (
                      <div style={{ fontSize: '10.5px', color: 'var(--text3)', fontWeight: 400 }}>→ {fmt(b)}</div>
                    )}
                  </td>
                )
                return (
                  <tr key={s.key}>
                    <td style={{ fontWeight: 500 }}>{s.label}</td>
                    {cell(sunk, sunkB, BUCKET_META.sunk.color)}
                    {cell(locked, lockedB, BUCKET_META.locked.color)}
                    {cell(avoidable, avoidableB, BUCKET_META.avoidable.color)}
                    {cell(discretionary, discretionaryB, BUCKET_META.discretionary.color)}
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>
                      {fmt(rowTotal)}
                      {isComparing && (
                        <div style={{ fontSize: '10.5px', color: 'var(--text3)', fontWeight: 400 }}>→ {fmt(rowTotalB)}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td style={{ padding: '10px 12px' }}>Totals</td>
                {(Object.keys(BUCKET_META) as (keyof typeof BUCKET_META)[]).map(b => {
                  const a = result.buckets[b].total
                  const bVal = resultB?.buckets[b].total ?? 0
                  return (
                    <td key={b} style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: BUCKET_META[b].color }}>
                      {fmt(a)}
                      {compareMode && resultB && (
                        <div style={{ fontSize: '10.5px', color: 'var(--text3)', fontWeight: 400 }}>
                          → {fmt(bVal)} <span style={{ marginLeft: 4 }}>({fmtDelta(bVal - a)})</span>
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                  {fmt(result.total)}
                  {compareMode && resultB && (
                    <div style={{ fontSize: '10.5px', color: 'var(--text3)', fontWeight: 400 }}>
                      → {fmt(resultB.total)} <span style={{ marginLeft: 4 }}>({fmtDelta(resultB.total - result.total)})</span>
                    </div>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '14px', fontStyle: 'italic' }}>
        All 15 cost sources classified. Labour on past days prefers timesheet actuals where present, with forecast as the fallback. Variations classify by status (approved → Locked; draft/submitted → Discretionary). Empty rows mean no data in this project for that source.
      </p>
    </div>
  )
}
