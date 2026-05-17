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

import { fxRate } from '../lib/currency'
import type {
  Project, RateCard, Resource, WeeklyTimesheet,
  HireItem, Car, Accommodation, Expense,
  BackOfficeHour, Variation, VariationLine,
  ToolingCosting, GlobalTV, GlobalDepartment,
  Invoice, PurchaseOrder, PlannedCost,
} from '../types'

/** Minimum shape of se_support_costs rows needed for WBS rollup. */
export interface SeSupportEntry {
  wbs?: string | null
  amount?: number | null
  sell_price?: number | null
  currency?: string | null
  person?: string | null
  description?: string | null
  date?: string | null
}

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
  invoices: number       // approved invoice actuals (Type B costs)
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
  invoicesSell: number
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
  /**
   * Pre-calculated labour cost lines — written by writeTimesheetCostLines()
   * whenever a timesheet is saved. The aggregator reads these directly
   * instead of recalculating labour from the timesheet JSONB, so that
   * labour totals always match what the timesheet UI shows.
   */
  timesheetCostLines?: TimesheetCostLineLite[]
  toolingCostings: ToolingCosting[]
  globalTVs: GlobalTV[]
  globalDepartments: GlobalDepartment[]
  hireItems: HireItem[]
  cars: Car[]
  accommodation: Accommodation[]
  expenses: Expense[]
  backOfficeHours: BackOfficeHour[]
  /** SE AG support / mob costs from se_support_costs table */
  seSupport?: SeSupportEntry[]
  variations: Variation[]
  variationLines: VariationLine[]
  /** Approved invoices — used as hard actuals for Type B costs (hire, cars, accom, subcon) */
  invoices?: Invoice[]
  /** Purchase orders — used for WBS resolution when joining invoices */
  purchaseOrders?: PurchaseOrder[]
  /** Planned cost rows (PM100 lines without receipts). Only actualised rows
   *  contribute to the aggregator's actuals — non-actualised rows are
   *  Forecast and live in buildForecast.byWbs, not here. */
  plannedCosts?: PlannedCost[]
  publicHolidays?: string[]
  /** Required to scope tooling splits — tooling on other projects flows in via splits.projectId === activeProjectId */
  activeProjectId: string
}

/** Minimum cost-line shape needed for WBS rollup. */
export interface TimesheetCostLineLite {
  category: string
  wbs: string
  cost_labour: number
  sell_labour: number
  cost_allowances: number
  sell_allowances: number
  person_name?: string
  work_date?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEmptyRow(): WbsAggregateRow {
  return {
    tooling: 0, hardware: 0, hire: 0,
    labourTrades: 0, labourMgmt: 0, labourSeag: 0, labourSubcon: 0, labour: 0,
    backoffice: 0, se_support: 0, cars: 0, accom: 0, expenses: 0, variations: 0, invoices: 0, total: 0,
    toolingSell: 0, hardwareSell: 0, hireSell: 0,
    labourTradesSell: 0, labourMgmtSell: 0, labourSeagSell: 0, labourSubconSell: 0, labourSell: 0,
    backofficeSell: 0, se_supportSell: 0, carsSell: 0, accomSell: 0, expensesSell: 0, variationsSell: 0, invoicesSell: 0, totalSell: 0,
    margin: null,
    items: [],
  }
}

const LABOUR_KEYS = new Set<keyof WbsAggregateRow>(['labourTrades','labourMgmt','labourSeag','labourSubcon'])

// ─── Main aggregator ─────────────────────────────────────────────────────────

export function aggregateAllCostsByWbs(input: WbsAggregatorInput): WbsAggregate {
  const {
    project,
    expenses,
    backOfficeHours, variations, variationLines,
  } = input
  // Inputs still accepted on the interface for caller-side simplicity but no
  // longer consumed here — booking-as-actual writes were removed; tooling
  // rental + freight moved to buildForecast.

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

  // ── Rental Tooling ────────────────────────────────────────────────────────
  // Tooling costings (rental + import/export freight) are NOT actuals —
  // they're plan (handled by buildForecast which now writes both the
  // calcRentalCost daily spread AND single-day freight events to byDay/byWbs).
  // Once an invoice posts against a tooling PO, the approved-invoices loop
  // below credits Actuals normally.
  // (Live-calc logic and TV/department resolution previously lived here;
  // moved to buildForecast as the single source of truth.)

  // ── Hardware Carts ────────────────────────────────────────────────────────
  // Not yet a V2 table — bucket exists for parity with HTML, no-op for now.

  // ── Equipment Hire ────────────────────────────────────────────────────────
  // Hire bookings are NOT actuals — they're plan (handled by buildForecast)
  // and committed (handled by poCommitmentsEngine when linked to a PO).
  // Real hire actuals flow through the approved-invoices loop below.

  // ── Labour: read from pre-calculated timesheet_cost_lines ─────────────────
  // Single source of truth — written by writeTimesheetCostLines() on every
  // timesheet save. We never recalculate from the timesheet JSONB here,
  // so the aggregator is guaranteed to agree with what the timesheet UI shows.
  for (const cl of (input.timesheetCostLines || [])) {
    if (!cl.wbs) continue
    const cost = (Number(cl.cost_labour) || 0) + (Number(cl.cost_allowances) || 0)
    const sell = (Number(cl.sell_labour) || 0) + (Number(cl.sell_allowances) || 0)
    if (!cost && !sell) continue
    const cat = (cl.category || 'trades').toLowerCase()
    const catKey: WbsAggregateItem['category'] =
      cat === 'management' ? 'labourMgmt'
    : cat === 'seag'       ? 'labourSeag'
    : cat === 'subcontractor' || cat === 'subcon' ? 'labourSubcon'
    :                        'labourTrades'
    const label = `${cl.person_name || ''}${cl.work_date ? ' ' + cl.work_date : ''}`.trim()
    add(cl.wbs, cost, sell, catKey, label || 'Labour')
  }

  // ── Back Office Hours ─────────────────────────────────────────────────────
  for (const e of backOfficeHours) {
    if (!e.wbs) continue
    const cost = Number(e.cost || 0)
    const sell = Number(e.sell || 0)
    add(e.wbs, cost, sell, 'backoffice', `Back Office: ${e.name || ''} (${e.role || ''}) ${e.date || ''}`)
  }

  // ── SE Support / Mob ──────────────────────────────────────────────────────
  // se_support_costs table — SE AG mobilisation / support costs.
  // Mirrors the HTML seSupport loop in aggregateAllCostsByWbs.
  for (const e of (input.seSupport || [])) {
    const wbs = e.wbs
    if (!wbs) continue
    const rawCost = Number(e.amount || 0)
    const rawSell = Number(e.sell_price || rawCost)
    const cost = rawCost && e.currency && e.currency !== 'AUD'
      ? rawCost * fxRate(project, e.currency)
      : rawCost
    const sell = rawSell && e.currency && e.currency !== 'AUD'
      ? rawSell * fxRate(project, e.currency)
      : rawSell
    if (!cost && !sell) continue
    add(wbs, cost, sell, 'se_support',
      `SE Support: ${e.person || ''} — ${e.description || ''} (${e.currency || 'AUD'})`.trim())
  }

  // ── Cars ──────────────────────────────────────────────────────────────────
  // Car bookings are NOT actuals — same principle as hire. Plan via
  // buildForecast, committed via poCommitmentsEngine, actuals only on
  // approved invoice.

  // ── Accommodation ─────────────────────────────────────────────────────────
  // Accommodation bookings are NOT actuals — same principle as hire/cars.
  // Plan via buildForecast, committed via poCommitmentsEngine, actuals only
  // on approved invoice.

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

  // ── Planned costs (PM100 lines without receipts) ──────────────────────────
  // Only actualised rows feed the actuals roll-up here — non-actualised rows
  // are Forecast and contribute via buildForecast.byWbs. Folded into the
  // 'expenses' bucket since that's the closest semantic match (ad-hoc cost
  // line not tied to a vendor invoice), and matches where these rows used to
  // live before the planned_costs table existed. Drill-down labels distinguish
  // them with the PC- prefix.
  const plannedCostsArr = input.plannedCosts || []
  for (const pc of plannedCostsArr) {
    if (!pc.actualised) continue
    if (!pc.wbs) continue
    const rawCost = Number(pc.amount) || 0
    if (rawCost <= 0) continue
    const cost = pc.currency && pc.currency !== 'AUD'
      ? convertEurOrCurrencyToBase(rawCost, pc.currency, project)
      : rawCost
    add(pc.wbs, cost, 0, 'expenses', `${pc.number}: ${pc.title}`)
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
    const cost = Number(line.cost_total || 0)   // cost side feeds EAC
    const sell = Number(line.sell_total || 0)
    add(wbs, cost, sell, 'variations', `VN ${approvedVnByNo[line.variation_id]}: ${line.description || line.category || ''}`.trim())
  }

  // ── Approved invoices — hard actuals for Type B costs ─────────────────────
  // WBS resolution: sap_wbs on invoice → PO line items (proportional) → PO top-level wbs
  const poMap = new Map<string, PurchaseOrder>(
    ((input.purchaseOrders || []) as PurchaseOrder[]).map(p => [p.id, p])
  )
  for (const inv of (input.invoices || []) as Invoice[]) {
    if (inv.status !== 'approved') continue
    const amount = Number(inv.amount) || 0
    if (!amount) continue

    // FX
    const invCurrency = inv.currency || 'AUD'
    const invFx = invCurrency !== 'AUD' ? fxRate(input.project, invCurrency) : 1
    const amountAud = amount * invFx

    // Resolve WBS: sap_wbs set directly on invoice (from SAP recon import)
    if (inv.sap_wbs) {
      add(inv.sap_wbs, amountAud, amountAud, 'invoices', `Invoice ${inv.invoice_number || inv.id}`)
      continue
    }

    // Resolve via linked PO line items
    if (inv.po_id) {
      const po = poMap.get(inv.po_id)
      if (po) {
        const lineItems = ((po as unknown as { line_items?: unknown[] }).line_items || []) as { wbs?: string; value?: number }[]
        const totalLineVal = lineItems.reduce((s, l) => s + (Number(l.value) || 0), 0)
        if (lineItems.length > 0 && totalLineVal > 0) {
          for (const line of lineItems) {
            const lineVal = Number(line.value) || 0
            if (!lineVal || !line.wbs) continue
            const share = lineVal / totalLineVal
            add(line.wbs, amountAud * share, amountAud * share, 'invoices',
              `Invoice ${inv.invoice_number || inv.id} (PO ${po.po_number})`)
          }
          continue
        }
        const poWbs = (po as PurchaseOrder & { wbs?: string }).wbs
        if (poWbs) {
          add(poWbs, amountAud, amountAud, 'invoices', `Invoice ${inv.invoice_number || inv.id}`)
        }
      }
    }
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

function convertEurOrCurrencyToBase(amount: number, currency: string, project: Project | null): number {
  if (!amount) return 0
  if (!currency || currency === 'AUD') return amount
  return amount * fxRate(project, currency)
}
