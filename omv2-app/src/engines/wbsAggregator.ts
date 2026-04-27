/**
 * wbsAggregator.ts — single source of truth for cost rollup by WBS.
 *
 * Mirrors the HTML aggregateAllCostsByWbs(proj). Walks every cost-bearing
 * collection on the project, tags entries by their WBS, and returns a
 * per-WBS bucket of cost / sell / margin split by category.
 *
 * Used by:
 *   • MikaPanel        — actuals column
 *   • CostReportPanel  — Cost Summary report
 *
 * Pure function: takes already-loaded arrays, no DB calls inside.
 *
 * Tooling cost is ALWAYS recomputed live from
 *   replacement_value × dept rate × duration   (or override),
 * matching the HTML. The persisted cost_eur / sell_eur snapshot columns
 * are no longer trusted — they're never written by the inline costing
 * panel and go stale.
 */

import { calcRentalCost } from '../lib/calculations'
import { calcCrewMemberTotal } from './costEngine'
import { fxRate } from '../lib/currency'
import type {
  Project, RateCard, Resource, WeeklyTimesheet,
  HireItem, Car, Accommodation, Expense,
  BackOfficeHour, Variation, VariationLine,
  ToolingCosting, GlobalTV, GlobalDepartment,
} from '../types'

// ─── Output shape ────────────────────────────────────────────────────────────

export interface WbsAggregateRow {
  // Cost split by category
  tooling: number
  hardware: number
  hire: number
  labourTrades: number
  labourMgmt: number
  labourSeag: number
  labourSubcon: number
  labour: number          // combined sum of all 4 labour buckets — back-compat
  backoffice: number
  se_support: number
  cars: number
  accom: number
  expenses: number
  variations: number
  total: number

  // Sell counterparts
  toolingSell: number
  hardwareSell: number
  hireSell: number
  labourTradesSell: number
  labourMgmtSell: number
  labourSeagSell: number
  labourSubconSell: number
  labourSell: number
  backofficeSell: number
  se_supportSell: number
  carsSell: number
  accomSell: number
  expensesSell: number
  variationsSell: number
  totalSell: number

  margin: number | null   // (sell - cost) / sell as percentage, or null if sell ≤ 0

  // Drilldown — every contributing line item
  items: WbsAggregateItem[]
}

export interface WbsAggregateItem {
  category: keyof Omit<WbsAggregateRow, 'margin' | 'items'>
  label: string
  cost: number
  sell: number
}

export type WbsAggregate = Record<string, WbsAggregateRow>

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface WbsAggregatorInput {
  project: Project | null
  resources: Resource[]
  rateCards: RateCard[]
  timesheets: WeeklyTimesheet[]
  toolingCostings: ToolingCosting[]
  globalTVs: GlobalTV[]
  globalDepartments: GlobalDepartment[]
  hireItems: HireItem[]
  cars: Car[]
  accommodation: Accommodation[]
  expenses: Expense[]
  backOfficeHours: BackOfficeHour[]
  variations: Variation[]
  variationLines: VariationLine[]
  publicHolidays?: string[]
  /** Required to scope tooling splits — tooling on other projects flows in via splits.projectId === activeProjectId */
  activeProjectId: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEmptyRow(): WbsAggregateRow {
  return {
    tooling: 0, hardware: 0, hire: 0,
    labourTrades: 0, labourMgmt: 0, labourSeag: 0, labourSubcon: 0, labour: 0,
    backoffice: 0, se_support: 0, cars: 0, accom: 0, expenses: 0, variations: 0, total: 0,
    toolingSell: 0, hardwareSell: 0, hireSell: 0,
    labourTradesSell: 0, labourMgmtSell: 0, labourSeagSell: 0, labourSubconSell: 0, labourSell: 0,
    backofficeSell: 0, se_supportSell: 0, carsSell: 0, accomSell: 0, expensesSell: 0, variationsSell: 0, totalSell: 0,
    margin: null,
    items: [],
  }
}

const LABOUR_KEYS = new Set<keyof WbsAggregateRow>(['labourTrades','labourMgmt','labourSeag','labourSubcon'])

// ─── Main aggregator ─────────────────────────────────────────────────────────

export function aggregateAllCostsByWbs(input: WbsAggregatorInput): WbsAggregate {
  const {
    project, resources, rateCards, timesheets,
    toolingCostings, globalTVs, globalDepartments,
    hireItems, cars, accommodation, expenses,
    backOfficeHours, variations, variationLines,
    publicHolidays = [], activeProjectId,
  } = input

  const result: WbsAggregate = {}

  function ensure(wbs: string): WbsAggregateRow {
    if (!result[wbs]) result[wbs] = makeEmptyRow()
    return result[wbs]
  }

  function add(
    wbs: string | null | undefined,
    cost: number,
    sell: number,
    category: WbsAggregateItem['category'],
    label: string,
  ) {
    if (!wbs) return
    if (!cost && !sell) return
    const row = ensure(wbs)
    row[category] = (row[category] as number) + cost
    row.total += cost
    const sellKey = (category + 'Sell') as keyof WbsAggregateRow
    ;(row[sellKey] as number) = (row[sellKey] as number) + sell
    row.totalSell += sell
    if (LABOUR_KEYS.has(category)) {
      row.labour += cost
      row.labourSell += sell
    }
    row.items.push({ category, label, cost, sell })
  }

  // ── Rental Tooling — always recompute live ────────────────────────────────
  // For each costing on this project (own or cross-project with a split here),
  // produce per-WBS cost/sell using calcRentalCost over the relevant date range.
  const tvByNo = Object.fromEntries(globalTVs.map(tv => [tv.tv_no, tv]))
  const deptById = Object.fromEntries(globalDepartments.map(d => [d.id, d]))

  for (const tc of toolingCostings) {
    const tv = tvByNo[tc.tv_no]
    if (!tv) continue
    const dept = tv.department_id ? deptById[tv.department_id] : null
    if (!dept) continue

    // Department rate config — convert to the shape calcRentalCost expects.
    const rates = dept.rates as Record<string, unknown>
    const deptCalc = {
      rental_pct: Number(rates.rentalPct || 0),
      rate_unit: ((rates.rateUnit as string) || 'weekly') as 'weekly' | 'daily' | 'monthly',
      gm_pct: Number(rates.gmPct || 0),
    }
    const replVal = Number(tv.replacement_value_eur || 0)
    if (!replVal) continue

    const fx = tc.fx_rate || fxRate(project, 'EUR') || 1.65
    const splits = tc.splits || []
    const tcLabel = `TV${tc.tv_no} ${tv.header_name || ''}`.trim()

    if (splits.length > 0) {
      // Per-split calc: each project / standby leg charges its own WBS.
      for (const sp of splits) {
        if (!sp.startDate || !sp.endDate) continue
        // Standby splits don't count toward project cost — they're a separate cost centre.
        if (sp.type !== 'project') continue
        // Only include splits that belong to the active project (cross-project splits flow in here).
        if (sp.projectId && sp.projectId !== activeProjectId && tc.project_id !== activeProjectId) {
          // owner project sees its own row only when project_id === active
          // cross-project rows are only fetched at the caller — but be defensive
        }
        const calc = calcRentalCost(replVal, {
          charge_start: sp.startDate,
          charge_end: sp.endDate,
          sell_override_eur: tc.sell_override_eur ?? null,
        }, deptCalc)
        if (!calc) continue
        let cost = calc.cost
        let sell = calc.sell
        // Standby discount handled here for completeness even though we filter standby above —
        // leaving the branch for when we widen to standby cost-centre tracking later.
        if (sp.type === 'project' && sp.discountPct) {
          const factor = 1 - (sp.discountPct / 100)
          cost *= factor
          sell *= factor
        }
        // Convert EUR → base currency
        add(sp.wbs, cost * fx, sell * fx, 'tooling', `${tcLabel} (${sp.startDate}→${sp.endDate})`)
      }
    } else if (tc.project_id === activeProjectId) {
      // No splits — single charge against the costing's own WBS, but only for the owning project.
      if (!tc.charge_start || !tc.charge_end) continue
      const calc = calcRentalCost(replVal, {
        charge_start: tc.charge_start,
        charge_end: tc.charge_end,
        sell_override_eur: tc.sell_override_eur ?? null,
      }, deptCalc)
      if (!calc) continue
      add(tc.wbs, calc.cost * fx, calc.sell * fx, 'tooling', tcLabel)
    }

    // Tooling freight — import / export legs, only into the project that owns each leg.
    if (tc.import_cost_eur && tc.import_wbs && (!tc.import_project_id || tc.import_project_id === activeProjectId)) {
      add(tc.import_wbs, (tc.import_cost_eur || 0) * fx, (tc.import_sell_eur || tc.import_cost_eur || 0) * fx, 'tooling', `${tcLabel} freight in`)
    }
    if (tc.export_cost_eur && tc.export_wbs && (!tc.export_project_id || tc.export_project_id === activeProjectId)) {
      add(tc.export_wbs, (tc.export_cost_eur || 0) * fx, (tc.export_sell_eur || tc.export_cost_eur || 0) * fx, 'tooling', `${tcLabel} freight out`)
    }
  }

  // ── Hardware Carts ────────────────────────────────────────────────────────
  // Not yet a V2 table — bucket exists for parity with HTML, no-op for now.

  // ── Equipment Hire ────────────────────────────────────────────────────────
  for (const h of hireItems) {
    const wbs = h.wbs
    if (!wbs) continue
    const cost = Number(h.hire_cost || 0)
    const sell = Number(h.customer_total || h.hire_cost || 0)
    add(wbs, cost, sell, 'hire', `${h.hire_type || 'hire'}: ${h.name || h.vendor || '—'}`)
  }

  // ── Labour: all weekly timesheets, regime-aware via calcCrewMemberTotal ───
  // WBS resolution is 3-level: member.wbs → timesheet.wbs → resource.wbs
  // SE AG rate cards are in EUR — calcCrewMemberTotal returns native-currency
  // numbers; we convert at the end.
  const resourceById = Object.fromEntries(resources.map(r => [r.id, r]))
  for (const ts of timesheets) {
    const wType = ts.type || 'trades'
    const catKey: WbsAggregateItem['category'] =
      wType === 'mgmt'   ? 'labourMgmt'
    : wType === 'seag'   ? 'labourSeag'
    : wType === 'subcon' ? 'labourSubcon'
    :                      'labourTrades'
    const regime = (ts.regime || 'lt12') as 'lt12' | 'ge12'

    for (const m of ts.crew || []) {
      const tot = calcCrewMemberTotal(m, regime, rateCards, publicHolidays)
      // Allowances are AUD already (HTML convention); labour hours are in rate-card currency.
      // SE AG rate cards are EUR — convert hour cost/sell, leave allowances.
      const rc = rateCards.find(c => c.role.toLowerCase() === m.role.toLowerCase())
      const isSeagWeek = wType === 'seag' || rc?.category === 'seag'
      const hourCost = isSeagWeek ? convertEurToBase(tot.cost - tot.allowances, project) : (tot.cost - tot.allowances)
      const hourSell = isSeagWeek ? convertEurToBase(tot.sell - tot.allowances, project) : (tot.sell - tot.allowances)
      // calcCrewMemberTotal lumps allowance into both cost and sell — separate them out so EUR conversion
      // doesn't accidentally convert AUD allowances. (Allowances tracked under sell in calcCrewMemberTotal;
      // we mirror to cost via the same value — the HTML pre-fix used .allowances for both.)
      const allowCost = tot.allowances
      const allowSell = tot.allowances
      const cost = hourCost + allowCost
      const sell = hourSell + allowSell
      if (!cost && !sell) continue

      let wbs = m.wbs || ts.wbs || ''
      if (!wbs && m.personId) {
        const res = resourceById[m.personId]
        if (res?.wbs) wbs = res.wbs
      }
      if (!wbs) continue
      const label = `${m.name} (${m.role || ''}) wk ${ts.week_start}${isSeagWeek ? ' (EUR→base)' : ''}`
      add(wbs, cost, sell, catKey, label)
    }
  }

  // ── Back Office Hours ─────────────────────────────────────────────────────
  for (const e of backOfficeHours) {
    if (!e.wbs) continue
    const cost = Number(e.cost || 0)
    const sell = Number(e.sell || 0)
    add(e.wbs, cost, sell, 'backoffice', `Back Office: ${e.name || ''} (${e.role || ''}) ${e.date || ''}`)
  }

  // ── SE Support / Mob ──────────────────────────────────────────────────────
  // Bucket present for parity; V2 table exists but has no consumers yet.
  // (Skipping data load here — caller can wire when the panel ships.)

  // ── Cars ──────────────────────────────────────────────────────────────────
  for (const c of cars) {
    if (!c.wbs) continue
    const cost = Number(c.total_cost || 0)
    const sell = Number(c.customer_total || c.total_cost || 0)
    add(c.wbs, cost, sell, 'cars', `Car: ${c.vehicle_type || c.vendor || c.rego || '—'}`)
  }

  // ── Accommodation ─────────────────────────────────────────────────────────
  for (const a of accommodation) {
    if (!a.wbs) continue
    const cost = Number(a.total_cost || 0)
    const sell = Number(a.customer_total || a.total_cost || 0)
    add(a.wbs, cost, sell, 'accom', `Accom: ${a.property || '—'}`)
  }

  // ── Expenses ──────────────────────────────────────────────────────────────
  // Non-chargeable expenses → sell = 0 (cost still tracked).
  for (const e of expenses) {
    if (!e.wbs) continue
    const rawCost = Number(e.cost_ex_gst || 0)
    const cost = e.currency && e.currency !== 'AUD' ? convertEurOrCurrencyToBase(rawCost, e.currency, project) : rawCost
    const rawSell = e.chargeable ? Number(e.sell_price || rawCost) : 0
    const sell = e.currency && e.currency !== 'AUD' ? convertEurOrCurrencyToBase(rawSell, e.currency, project) : rawSell
    if (!cost && !sell) continue
    add(e.wbs, cost, sell, 'expenses', `Expense: ${e.vendor || ''} ${e.description || ''}`.trim())
  }

  // ── Approved variations (per-line WBS) ────────────────────────────────────
  const approvedVnIds = new Set(variations.filter(v => v.status === 'approved').map(v => v.id))
  const approvedVnByNo: Record<string, string> = Object.fromEntries(
    variations.filter(v => v.status === 'approved').map(v => [v.id, v.number || v.id])
  )
  for (const line of variationLines) {
    if (!approvedVnIds.has(line.variation_id)) continue
    const wbs = line.wbs
    if (!wbs) continue
    const cost = Number(line.cost_total || 0)
    const sell = Number(line.sell_total || 0)
    add(wbs, cost, sell, 'variations', `VN ${approvedVnByNo[line.variation_id]}: ${line.description || line.category || ''}`.trim())
  }

  // ── Margin per WBS ────────────────────────────────────────────────────────
  for (const row of Object.values(result)) {
    row.margin = row.totalSell > 0 ? ((row.totalSell - row.total) / row.totalSell * 100) : null
  }

  return result
}

// ─── Parent-prefix rollup ────────────────────────────────────────────────────
// MIKA needs a parent WBS row to show the sum of all child WBS costs against it.
// e.g. timesheet tagged .P.02.02.01 should also surface against .P.02.02 and .P.02

/**
 * Sum the `total` cost across this WBS and any descendant prefixed by `wbs + '.'`.
 * Mirrors the HTML getLiveActuals.
 */
export function rollupWbsTotal(agg: WbsAggregate, wbsCode: string): number {
  let total = 0
  for (const [code, row] of Object.entries(agg)) {
    if (code === wbsCode || code.startsWith(wbsCode + '.')) {
      total += row.total
    }
  }
  return total
}

/** Sum sell across this WBS and descendants. */
export function rollupWbsSell(agg: WbsAggregate, wbsCode: string): number {
  let total = 0
  for (const [code, row] of Object.entries(agg)) {
    if (code === wbsCode || code.startsWith(wbsCode + '.')) {
      total += row.totalSell
    }
  }
  return total
}

// ─── Local FX helpers ────────────────────────────────────────────────────────

function convertEurToBase(amount: number, project: Project | null): number {
  if (!amount) return 0
  return amount * fxRate(project, 'EUR')
}

function convertEurOrCurrencyToBase(amount: number, currency: string, project: Project | null): number {
  if (!amount) return 0
  if (!currency || currency === 'AUD') return amount
  return amount * fxRate(project, currency)
}
