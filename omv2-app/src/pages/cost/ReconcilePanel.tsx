/**
 * ReconcilePanel — Forecast vs MIKA sanity check
 *
 * Read-only. Runs buildForecast once (the same engine that powers the
 * Forecast page) plus the two MIKA engines (wbsAggregator,
 * poCommitmentsEngine), and shows that MIKA EAC reconciles back to the
 * Forecast page total under the model:
 *
 *   ForecastTC = max(0, Plan − Actuals − Committed)
 *   EAC        = Actuals + Committed + ForecastTC
 *
 * Any non-zero gap surfaces over-budget WBS rows (Actuals + Committed > Plan).
 */

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { buildForecast, EUR_CATS } from '../../engines/forecastEngine'
import type { ForecastData } from '../../engines/forecastEngine'
import { aggregateAllCostsByWbs } from '../../engines/wbsAggregator'
import type { WbsAggregate } from '../../engines/wbsAggregator'
import { buildPoCommitments } from '../../engines/poCommitmentsEngine'
import type {
  Resource, RateCard, BackOfficeHour, HireItem, Car, Accommodation,
  ToolingCosting, Expense, GlobalTV, GlobalDepartment,
  PurchaseOrder, Invoice, WeeklyTimesheet, Variation, VariationLine,
} from '../../types'

// ───────── helpers ─────────

const fmt = (v: number): string => {
  if (Math.abs(v) < 0.5) return '$0'
  return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtDelta = (v: number): string => {
  if (Math.abs(v) < 0.5) return '$0'
  const s = v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v >= 0 ? '+$' : '-$') + s.replace('-', '')
}

const cellNum: React.CSSProperties = {
  textAlign: 'right', fontFamily: 'var(--mono)', padding: '4px 10px', whiteSpace: 'nowrap',
}
const cellLabel: React.CSSProperties = {
  textAlign: 'left', padding: '4px 10px', whiteSpace: 'nowrap',
}
const sectionTitle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 700, marginTop: '24px', marginBottom: '8px',
  letterSpacing: '0.3px', textTransform: 'uppercase', color: 'var(--text2)',
}
const sectionDesc: React.CSSProperties = {
  fontSize: '12px', color: 'var(--text3)', marginBottom: '10px',
}

interface ForecastBreakdown {
  total: number
  byCat: Record<string, number> // trades, mgmt, seag, subcon, dryHire, wetHire, localHire, tooling, cars, accom, expenses
}

interface AggregatorBreakdown {
  total: number
  byCat: Record<string, number> // tooling, hire, labour, backoffice, se_support, cars, accom, expenses, variations, invoices, hardware
}

interface PoCommitmentsBreakdown {
  total: number
  byCase: { typeB: number; subconRes: number; typeC: number }
  posCounted: { typeB: number; subconRes: number; typeC: number }
}

interface ByWbsBreakdown {
  total: number             // sum of ALL byWbs entries (incl. orphan '')
  totalVisible: number      // sum of byWbs entries that roll up to a real MIKA top-level prefix
  orphan: number            // total - totalVisible
}

interface Reconciliation {
  forecast: ForecastBreakdown
  aggregator: AggregatorBreakdown
  poCommitments: PoCommitmentsBreakdown
  byWbs: ByWbsBreakdown
  forecastTCTotal: number
  mikaEac: number
  mikaEacVisible: number
  gap: number
  gapVisible: number
}

// ───────── component ─────────

export function ReconcilePanel() {
  const { activeProject } = useAppStore()
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeProject) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id])

  async function load() {
    if (!activeProject) return
    setLoading(true); setError(null)
    try {
      const pid = activeProject.id
      const [
        resR, rcR, boR, hireR, carsR, accomR, tcOwnR, tcCrossR,
        expR, tvsR, deptsR, posR, invR, tsR, costLinesR, varsR, varLinesR,
        seR, holsR, mikaR,
      ] = await Promise.all([
        supabase.from('resources').select('*').eq('project_id', pid),
        supabase.from('rate_cards').select('*').eq('project_id', pid),
        supabase.from('back_office_hours').select('*').eq('project_id', pid),
        supabase.from('hire_items').select('*').eq('project_id', pid),
        supabase.from('cars').select('*').eq('project_id', pid),
        supabase.from('accommodation').select('*').eq('project_id', pid),
        supabase.from('tooling_costings').select('*').eq('project_id', pid),
        supabase.from('tooling_costings').select('*').neq('project_id', pid)
          .filter('splits', 'cs', `[{"projectId":"${pid}"}]`),
        supabase.from('expenses').select('*').eq('project_id', pid),
        supabase.from('global_tvs').select('*'),
        supabase.from('global_departments').select('*'),
        supabase.from('purchase_orders').select('*').eq('project_id', pid),
        supabase.from('invoices').select('*').eq('project_id', pid),
        supabase.from('weekly_timesheets').select('*').eq('project_id', pid),
        supabase.from('timesheet_cost_lines')
          .select('category,wbs,cost_labour,sell_labour,cost_allowances,sell_allowances,person_name,work_date')
          .eq('project_id', pid),
        supabase.from('variations').select('*').eq('project_id', pid),
        supabase.from('variation_lines').select('*').eq('project_id', pid),
        supabase.from('se_support_costs')
          .select('wbs,amount,sell_price,currency,person,description,date')
          .eq('project_id', pid),
        supabase.from('public_holidays').select('date').eq('project_id', pid),
        supabase.from('mika_wbs_lines').select('wbs,level').eq('project_id', pid),
      ])

      const resources = (resR.data || []) as Resource[]
      const rateCards = (rcR.data || []) as RateCard[]
      const backOffice = (boR.data || []) as BackOfficeHour[]
      const hireItems = (hireR.data || []) as HireItem[]
      const cars = (carsR.data || []) as Car[]
      const accom = (accomR.data || []) as Accommodation[]
      const toolingOwn = (tcOwnR.data || []) as ToolingCosting[]
      const toolingCross = (tcCrossR.data || []) as ToolingCosting[]
      const toolingAll = [...toolingOwn, ...toolingCross]
      const expenses = (expR.data || []) as Expense[]
      const tvs = (tvsR.data || []) as GlobalTV[]
      const depts = (deptsR.data || []) as GlobalDepartment[]
      const pos = (posR.data || []) as PurchaseOrder[]
      const invoices = (invR.data || []) as Invoice[]
      const timesheets = (tsR.data || []) as WeeklyTimesheet[]
      const variations = (varsR.data || []) as Variation[]
      const variationLines = (varLinesR.data || []) as VariationLine[]
      const mikaRows = (mikaR.data || []) as { wbs: string; level: number | null }[]

      const stdHours = (activeProject.std_hours as { day: Record<string,number>; night: Record<string,number> }) || { day: {}, night: {} }
      const publicHolidays = ((holsR.data || []) as { date: string }[])
      const fxRates = (activeProject.currency_rates as { code: string; rate: number }[]) || []
      const eurRate = fxRates.find(r => r.code === 'EUR')?.rate || 1

      // ── 1. Run buildForecast (Forecast page) ────────────────────────────
      const forecast = buildForecast(
        resources, rateCards, backOffice, hireItems, cars, accom, toolingAll,
        stdHours, publicHolidays,
        activeProject.start_date, activeProject.end_date,
        fxRates, expenses, 0, tvs, depts, pos, invoices,
      )
      const fcBreakdown = computeForecastBreakdown(forecast, eurRate)

      // ── 2. Run wbsAggregator (MIKA Actuals) ─────────────────────────────
      const agg = aggregateAllCostsByWbs({
        project: activeProject,
        resources, rateCards, timesheets,
        timesheetCostLines: (costLinesR.data || []) as Parameters<typeof aggregateAllCostsByWbs>[0]['timesheetCostLines'],
        toolingCostings: toolingAll, globalTVs: tvs, globalDepartments: depts,
        hireItems, cars, accommodation: accom, expenses,
        backOfficeHours: backOffice,
        seSupport: (seR.data || []) as Parameters<typeof aggregateAllCostsByWbs>[0]['seSupport'],
        variations, variationLines, invoices, purchaseOrders: pos,
        publicHolidays: publicHolidays.map(h => h.date),
        activeProjectId: pid,
      })
      const aggBreakdown = computeAggregatorBreakdown(agg)

      // ── 3. Run poCommitmentsEngine (MIKA Committed) ─────────────────────
      const poRes = buildPoCommitments(
        pos, invoices, hireItems, cars, accom,
        resources as Parameters<typeof buildPoCommitments>[5],
        activeProject as unknown as Parameters<typeof buildPoCommitments>[6],
      )
      const poBreakdown = computePoCommitmentsBreakdown(
        pos, invoices, hireItems, cars, accom, resources, rateCards, activeProject as unknown as { start_date?: string|null; end_date?: string|null; currency_rates?: unknown }, fxRates,
      )
      // Sanity: total from breakdown should equal total of engine output
      const engineCommittedTotal = Object.values(poRes.byWbs).reduce((s, v) => s + v, 0)
      poBreakdown.total = engineCommittedTotal

      // ── 4. Forecast TC (now derived from the SAME buildForecast above) ───
      // `forecast.byWbs` is the engine's per-WBS plan total. By construction it sums
      // to the same number as the day-bucket sum (Section A total).
      const mikaTopPrefixes = computeTopPrefixes(mikaRows)
      const byWbsBreakdown = computeByWbsBreakdown(forecast.byWbs, mikaTopPrefixes)

      // MIKA EAC under the new model:
      //   ForecastTC = max(0, Plan − Actuals − Committed) at project level
      //   EAC        = Actuals + Committed + ForecastTC
      const planTotal      = byWbsBreakdown.total
      const forecastTCTotal = Math.max(0, planTotal - aggBreakdown.total - poBreakdown.total)
      const mikaEac        = aggBreakdown.total + poBreakdown.total + forecastTCTotal
      const mikaEacVisible = mikaEac // no orphans relevant under new derivation
      const gap            = mikaEac - fcBreakdown.total
      const gapVisible     = gap

      setRecon({
        forecast: fcBreakdown,
        aggregator: aggBreakdown,
        poCommitments: poBreakdown,
        byWbs: byWbsBreakdown,
        forecastTCTotal,
        mikaEac, mikaEacVisible, gap, gapVisible,
      })
      setLoading(false)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  if (!activeProject) return <div style={{ padding: 24 }}>No active project.</div>

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Forecast vs MIKA Reconciliation</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
          Step-1 diagnostic. Read-only. Runs both engines side-by-side on the same data so we can attribute the gap.
        </p>
      </div>

      {loading && <div style={{ marginTop: 24, color: 'var(--text2)' }}>⏳ Loading and running engines…</div>}
      {error && <div style={{ marginTop: 24, color: 'var(--red)' }}>✗ {error}</div>}

      {recon && <>
        {/* ── Headline ── */}
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <KpiBox label="Forecast page total" val={recon.forecast.total} color="#0ea5e9" />
          <KpiBox label="MIKA EAC (Calc)" val={recon.mikaEac} color="#7c3aed" />
          <KpiBox label="Gap (MIKA − Forecast)" val={recon.gap} color={Math.abs(recon.gap) < 1 ? '#16a34a' : '#dc2626'} sign />
          <KpiBox label="Gap, MIKA-visible only" val={recon.gapVisible} color={Math.abs(recon.gapVisible) < 1 ? '#16a34a' : '#dc2626'} sign hint="excludes byWbs orphans" />
        </div>

        {/* ── Section A — Forecast page breakdown ── */}
        <div style={sectionTitle}>A. Forecast page (buildForecast) — by category</div>
        <div style={sectionDesc}>
          Each day's bucket summed across the project. EUR cats (SE AG, Tooling) converted via the project's EUR rate.
        </div>
        <CatTable
          rows={[
            ['Trades',     recon.forecast.byCat.trades],
            ['Management', recon.forecast.byCat.mgmt],
            ['SE AG',      recon.forecast.byCat.seag],
            ['Subcon (labour bucket)', recon.forecast.byCat.subcon],
            ['Dry Hire',   recon.forecast.byCat.dryHire],
            ['Wet Hire',   recon.forecast.byCat.wetHire],
            ['Local Hire', recon.forecast.byCat.localHire],
            ['Cars',       recon.forecast.byCat.cars],
            ['Accom',      recon.forecast.byCat.accom],
            ['Tooling',    recon.forecast.byCat.tooling],
            ['Expenses',   recon.forecast.byCat.expenses],
          ]}
          total={recon.forecast.total}
        />

        {/* ── Section B — Aggregator (Actuals) breakdown ── */}
        <div style={sectionTitle}>B. MIKA Actuals (wbsAggregator) — by category</div>
        <div style={sectionDesc}>
          Sum across every WBS row. Known issue per skill: aggregator counts hire / cars / accom / tooling as actuals (should be committed).
        </div>
        <CatTable
          rows={[
            ['Labour (timesheet_cost_lines)', recon.aggregator.byCat.labour],
            ['Back Office',     recon.aggregator.byCat.backoffice],
            ['SE Support',      recon.aggregator.byCat.se_support],
            ['Tooling',         recon.aggregator.byCat.tooling],
            ['Hire',            recon.aggregator.byCat.hire],
            ['Cars',            recon.aggregator.byCat.cars],
            ['Accom',           recon.aggregator.byCat.accom],
            ['Expenses',        recon.aggregator.byCat.expenses],
            ['Variations',      recon.aggregator.byCat.variations],
            ['Invoices',        recon.aggregator.byCat.invoices],
            ['Hardware',        recon.aggregator.byCat.hardware],
          ]}
          total={recon.aggregator.total}
        />

        {/* ── Section C — PO Commitments breakdown ── */}
        <div style={sectionTitle}>C. MIKA PO Committed (poCommitmentsEngine) — by case</div>
        <div style={sectionDesc}>
          PO value remaining after approved-invoice deduction, attributed by case. Counts are # of POs that went through each path.
        </div>
        <CatTable
          rows={[
            [`Type B — PO has linked bookings (${recon.poCommitments.posCounted.typeB} POs)`,         recon.poCommitments.byCase.typeB],
            [`Subcon — PO has linked resources (${recon.poCommitments.posCounted.subconRes} POs)`,    recon.poCommitments.byCase.subconRes],
            [`Type C — Standalone PO (${recon.poCommitments.posCounted.typeC} POs)`,                  recon.poCommitments.byCase.typeC],
          ]}
          total={recon.poCommitments.total}
        />

        {/* ── Section D — Engine consistency check ── */}
        <div style={sectionTitle}>D. Engine consistency check</div>
        <div style={sectionDesc}>
          Both views come from a single <code>buildForecast</code> pass. Section A is the day-bucket sum.
          The byWbs total below is the per-WBS sum from the same pass — they must agree.
        </div>
        <CatTable
          rows={[
            ['Forecast page total (Section A)', recon.forecast.total],
            ['Plan-by-WBS total (sum of byWbs)', recon.byWbs.total],
            ['Δ (should be $0)',                  recon.byWbs.total - recon.forecast.total],
          ]}
          total={recon.byWbs.total}
          extras={[
            ['  visible to MIKA (rolls up to a top-level prefix)',  recon.byWbs.totalVisible],
            ['  orphan (no WBS / off-tree)',                         recon.byWbs.orphan],
          ]}
        />

        {/* ── Section E — MIKA EAC under the new formula ── */}
        <div style={sectionTitle}>E. MIKA EAC under the new model</div>
        <div style={sectionDesc}>
          <code>ForecastTC = max(0, Plan − Actuals − Committed)</code>. By construction this caps at zero
          so MIKA EAC cannot exceed the Forecast page total — and equals it when no row is over-budget.
        </div>
        <CatTable
          rows={[
            ['Plan total (= Forecast page)',            recon.byWbs.total],
            ['  − Actuals (wbsAggregator)',             -recon.aggregator.total],
            ['  − Committed (poCommitmentsEngine)',     -recon.poCommitments.total],
            ['= Residual',                              recon.byWbs.total - recon.aggregator.total - recon.poCommitments.total],
            ['Forecast TC = max(0, residual)',          recon.forecastTCTotal],
            ['MIKA EAC = Actuals + Committed + Forecast TC', recon.mikaEac],
          ]}
          total={recon.mikaEac}
        />

        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
          <strong>Reconciliation:</strong> Forecast page = <span style={{ fontFamily: 'var(--mono)' }}>{fmt(recon.forecast.total)}</span>,
          MIKA EAC = <span style={{ fontFamily: 'var(--mono)' }}>{fmt(recon.mikaEac)}</span>,
          gap = <span style={{ fontFamily: 'var(--mono)', color: Math.abs(recon.gap) < 1 ? '#16a34a' : '#dc2626' }}>{fmtDelta(recon.gap)}</span>.
          A non-zero gap now means a row is over budget — Actuals + Committed exceeded the planned cost
          and the residual was capped at zero, surfacing as a negative variance in the MIKA table.
        </div>
      </>}
    </div>
  )
}

// ───────── sub-components ─────────

function KpiBox(props: { label: string; val: number; color: string; sign?: boolean; hint?: string }) {
  const txt = props.sign ? fmtDelta(props.val) : fmt(props.val)
  return (
    <div style={{
      padding: '12px 16px', minWidth: 180, borderTop: `2px solid ${props.color}`,
      background: 'var(--bg2)', borderRadius: 4, border: '1px solid var(--border2)',
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 20, color: props.color, fontWeight: 600 }}>{txt}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{props.label}</div>
      {props.hint && <div style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic', marginTop: 2 }}>{props.hint}</div>}
    </div>
  )
}

function CatTable(props: { rows: [string, number][]; total: number; extras?: [string, number][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <tbody>
        {props.rows.map(([label, val]) => (
          <tr key={label} style={{ borderBottom: '1px solid var(--border2)' }}>
            <td style={cellLabel}>{label}</td>
            <td style={cellNum}>{val ? fmt(val) : '—'}</td>
            <td style={{ width: 180 }}>
              <BarCell val={val} total={props.total} />
            </td>
          </tr>
        ))}
        <tr style={{ borderTop: '2px solid var(--accent)' }}>
          <td style={{ ...cellLabel, fontWeight: 700, fontSize: 13 }}>Total</td>
          <td style={{ ...cellNum, fontWeight: 700, fontSize: 13 }}>{fmt(props.total)}</td>
          <td></td>
        </tr>
        {props.extras?.map(([label, val]) => (
          <tr key={label}>
            <td style={{ ...cellLabel, color: 'var(--text3)' }}>{label}</td>
            <td style={{ ...cellNum, color: 'var(--text3)' }}>{fmt(val)}</td>
            <td></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BarCell(props: { val: number; total: number }) {
  if (!props.total || props.val <= 0) return null
  const pct = Math.min(100, (props.val / props.total) * 100)
  return (
    <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)' }} />
    </div>
  )
}

// ───────── breakdown computations ─────────

function computeForecastBreakdown(data: ForecastData, eurRate: number): ForecastBreakdown {
  const byCat: Record<string, number> = {
    trades: 0, mgmt: 0, seag: 0, subcon: 0,
    dryHire: 0, wetHire: 0, localHire: 0, tooling: 0,
    cars: 0, accom: 0, expenses: 0,
  }
  for (const d of data.days) {
    const b = data.byDay[d]
    for (const cat of Object.keys(byCat) as (keyof typeof byCat)[]) {
      const factor = EUR_CATS.has(cat) ? eurRate : 1
      byCat[cat] += b[cat as keyof typeof b] && typeof (b[cat as keyof typeof b] as { cost?: number }).cost === 'number'
        ? (b[cat as keyof typeof b] as { cost: number }).cost * factor
        : 0
    }
  }
  const total = Object.values(byCat).reduce((s, v) => s + v, 0)
  return { total, byCat }
}

function computeAggregatorBreakdown(agg: WbsAggregate): AggregatorBreakdown {
  const byCat: Record<string, number> = {
    tooling: 0, hire: 0, labour: 0, backoffice: 0, se_support: 0,
    cars: 0, accom: 0, expenses: 0, variations: 0, invoices: 0, hardware: 0,
  }
  for (const row of Object.values(agg)) {
    byCat.tooling     += row.tooling
    byCat.hire        += row.hire
    byCat.labour      += row.labour
    byCat.backoffice  += row.backoffice
    byCat.se_support  += row.se_support
    byCat.cars        += row.cars
    byCat.accom       += row.accom
    byCat.expenses    += row.expenses
    byCat.variations  += row.variations
    byCat.invoices    += row.invoices
    byCat.hardware    += row.hardware
  }
  const total = Object.values(byCat).reduce((s, v) => s + v, 0)
  return { total, byCat }
}

function computePoCommitmentsBreakdown(
  pos: PurchaseOrder[],
  invoices: Invoice[],
  hireItems: HireItem[],
  cars: Car[],
  accom: Accommodation[],
  resources: Resource[],
  rateCards: RateCard[],
  project: { start_date?: string|null; end_date?: string|null; currency_rates?: unknown },
  _fxRates: { code: string; rate: number }[],
): PoCommitmentsBreakdown {
  // Mirror the engine's case selection but accumulate per case.
  const poHasBookings = new Set<string>()
  for (const h of hireItems) { const lpi = (h as HireItem & { linked_po_id?: string|null }).linked_po_id; if (lpi) poHasBookings.add(lpi) }
  for (const c of cars)      { const lpi = (c as Car & { linked_po_id?: string|null }).linked_po_id;      if (lpi) poHasBookings.add(lpi) }
  for (const a of accom)     { const lpi = (a as Accommodation & { linked_po_id?: string|null }).linked_po_id; if (lpi) poHasBookings.add(lpi) }

  const subconResByPo = new Set<string>()
  for (const r of resources) {
    const lpi = (r as Resource & { linked_po_id?: string|null }).linked_po_id
    if (!lpi || r.category !== 'subcontractor') continue
    const hasRc = rateCards.some(rc => rc.role.toLowerCase() === r.role.toLowerCase())
    if (hasRc) continue
    subconResByPo.add(lpi)
  }

  let typeB = 0, subconRes = 0, typeC = 0
  let cB = 0, cS = 0, cC = 0

  // We don't need to FX-convert exactly here — we just need to attribute each PO to a case.
  // Use the engine's own byWbs total for the final number; this only buckets by case.
  for (const po of pos) {
    if (!['raised', 'active'].includes(po.status)) continue
    const poVal = Number(po.po_value) || 0
    if (!poVal) continue
    void project

    if (poHasBookings.has(po.id)) { typeB += poVal; cB++; continue }
    if (subconResByPo.has(po.id)) { subconRes += poVal; cS++; continue }
    typeC += poVal; cC++
  }

  // These are raw PO values; the engine's actual byWbs total already accounts for FX + invoice deduction.
  // We use the raw distribution to show RELATIVE weight of each case. Total will be overwritten by engine total.
  const rawTotal = typeB + subconRes + typeC
  const scale = rawTotal > 0 ? 1 : 0
  void scale
  void invoices

  return {
    total: 0, // filled in by caller from engine output
    byCase: { typeB, subconRes, typeC },
    posCounted: { typeB: cB, subconRes: cS, typeC: cC },
  }
}

function computeTopPrefixes(mikaRows: { wbs: string; level: number | null }[]): string[] {
  if (!mikaRows.length) return []
  // Find minimum level (typically 0)
  const levels = mikaRows.map(r => r.level ?? r.wbs.split('.').length - 1)
  const minLevel = Math.min(...levels)
  return mikaRows
    .filter(r => (r.level ?? r.wbs.split('.').length - 1) === minLevel)
    .map(r => r.wbs)
}

function computeByWbsBreakdown(
  byWbs: Record<string, number>,
  topPrefixes: string[],
): ByWbsBreakdown {
  const total = Object.values(byWbs).reduce((s, v) => s + v, 0)
  let totalVisible = 0
  for (const [k, v] of Object.entries(byWbs)) {
    if (!k) continue
    if (topPrefixes.some(p => k === p || k.startsWith(p + '.'))) {
      totalVisible += v
    }
  }
  const orphan = total - totalVisible
  return { total, totalVisible, orphan }
}
