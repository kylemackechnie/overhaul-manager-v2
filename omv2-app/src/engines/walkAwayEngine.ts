/**
 * Walk-Away engine.
 *
 * Classifies every dollar in the project's EAC into one of four buckets
 * for a chosen walk-away date `asOf`:
 *
 *   - Sunk          — already spent, irrecoverable as of asOf
 *   - Locked        — committed, paid even if we stop on asOf (inside
 *                     notice period or contractually bound)
 *   - Avoidable     — currently forecast but recoverable if we stop by asOf
 *   - Discretionary — future cost with no commitment yet
 *
 * Buckets sum to the current EAC within rounding. As asOf moves forward,
 * Discretionary shrinks (more becomes committed), and Avoidable shrinks
 * (cancellation windows close). Sunk and Locked grow.
 *
 * Each cost source gets its own classifier function (classifyFlights,
 * classifyExpenses, ...). The top-level classifyWalkAway() calls them all
 * and aggregates into a WalkAwayResult.
 *
 * Notice periods are read from projects.walk_away_settings.notice_days
 * (per-cost-source map of days). Missing keys default to 1 day.
 *
 * Build phase: this commit implements flights + expenses only. Other sources
 * are stubbed with empty arrays returned — they get filled in over subsequent
 * commits and will plug into the same Result shape without UI changes.
 */

import type {
  WalkAwayInput, WalkAwayResult, WalkAwayLineItem, WalkAwayBucket,
  WalkAwaySource, WalkAwayBucketTotals,
  Flight, Expense, Resource,
} from '../types'

// ── Date helpers (string-based, YYYY-MM-DD to avoid Date timezone gotchas) ────

/** ISO date string for "today" in the local timezone, suitable for refDate fields. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Add `days` whole days to an ISO date and return the new ISO date. */
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Default notice for a source if not in the project's map. */
function noticeFor(source: WalkAwaySource, noticeDays: Partial<Record<WalkAwaySource, number>>): number {
  const n = noticeDays[source]
  return typeof n === 'number' && n >= 0 ? n : 1
}

/** FX → AUD multiplier. AUD currency = 1, others looked up in fxRates. */
function fxToAud(currency: string | null | undefined, fxRates: { code: string; rate: number }[]): number {
  if (!currency || currency === 'AUD') return 1
  const r = fxRates.find(x => x.code === currency)
  return r?.rate ?? 1
}

// ── Source 1: Flights ─────────────────────────────────────────────────────────

/**
 * Classify all flight legs.
 *
 * Per leg:
 *  - status='cancelled'           → excluded (no contribution)
 *  - linked_expense_id set        → SUNK (paid; the expense itself is also
 *                                          classified via the expenses path,
 *                                          BUT we skip it there by checking
 *                                          its category — see classifyExpenses)
 *  - effectiveDate <  asOf        → SUNK (the flight happened — even if we
 *                                          haven't yet seen the bill, that
 *                                          cost is committed historically)
 *  - flight_number entered AND
 *      effectiveDate >= asOf      → LOCKED (booking carries cancellation
 *                                          penalties regardless of date)
 *  - effectiveDate in
 *      [asOf, asOf+notice)        → LOCKED (inside notice window)
 *  - effectiveDate >= asOf+notice → AVOIDABLE (cancellable, not yet booked)
 *
 * Custom legs are treated the same way operationally — they have an
 * effective date (depart_at) and may have a flight_number.
 *
 * effectiveDate = depart_at if set; else mob_in for outbound, mob_out
 * for return; null for custom legs with no depart_at.
 */
export function classifyFlights(
  asOf: string,
  flights: Flight[],
  resources: Resource[],
  expenses: Expense[],
  fxRates: { code: string; rate: number }[],
  noticeDays: Partial<Record<WalkAwaySource, number>>,
): WalkAwayLineItem[] {
  const notice = noticeFor('flights', noticeDays)
  const cutoffLocked = addDays(asOf, notice)
  const resById = new Map(resources.map(r => [r.id, r]))
  const expById = new Map(expenses.map(e => [e.id, e]))
  const lines: WalkAwayLineItem[] = []

  for (const f of flights) {
    if (f.status === 'cancelled') continue
    const resource = resById.get(f.resource_id)
    if (!resource || !resource.flight_required) continue

    // Effective date for classification
    let effectiveDate: string | null = null
    if (f.depart_at) {
      effectiveDate = f.depart_at.slice(0, 10)
    } else if (f.leg_type === 'outbound') {
      effectiveDate = resource.mob_in || null
    } else if (f.leg_type === 'return') {
      effectiveDate = (resource as Resource & { mob_out?: string | null }).mob_out || resource.mob_in || null
    }
    // Custom legs without depart_at have no implied date — treat as Discretionary
    // since they're ad-hoc by design.

    // Use the LINKED EXPENSE'S amount when available (actuals beat planned for
    // walk-away purposes — we want to know what's actually been paid, not what
    // was forecast). For unlinked legs, fall back to the leg's planned cost.
    const linkedExp = f.linked_expense_id ? expById.get(f.linked_expense_id) : null
    let amount: number
    if (linkedExp) {
      amount = (linkedExp.cost_ex_gst || linkedExp.amount || 0) * fxToAud(linkedExp.currency, fxRates)
    } else {
      amount = (f.planned_cost || 0) * fxToAud(f.planned_currency, fxRates)
    }
    if (amount <= 0) continue

    let bucket: WalkAwayBucket
    if (linkedExp) {
      // Linked expense exists — the cost has been paid. SUNK regardless of date.
      // The expense itself is skipped in classifyExpenses to avoid double-count.
      bucket = 'sunk'
    } else if (!effectiveDate) {
      bucket = 'discretionary'
    } else if (effectiveDate < asOf) {
      bucket = 'sunk'
    } else if (f.flight_number && f.flight_number.trim()) {
      bucket = 'locked'
    } else if (effectiveDate < cutoffLocked) {
      bucket = 'locked'
    } else {
      bucket = 'avoidable'
    }

    const legLabel = f.leg_type === 'outbound' ? 'Outbound'
                   : f.leg_type === 'return'   ? 'Return'
                   : (f.leg_label || 'Custom')
    const detail = [
      legLabel,
      f.flight_number,
      effectiveDate,
      f.origin && f.destination ? `${f.origin}→${f.destination}` : null,
    ].filter(Boolean).join(' · ')

    lines.push({
      source: 'flights',
      bucket,
      amount,
      wbs: resource.wbs || '',
      description: `${resource.name} — ${detail || legLabel}`,
      refDate: effectiveDate,
      refId: f.id,
    })
  }

  return lines
}

// ── Source 2: Expenses ────────────────────────────────────────────────────────

/**
 * Classify all expenses.
 *
 * Default rule:
 *  - expense.date < asOf                → SUNK (already paid by walk-away date)
 *  - expense.date in [asOf, asOf+notice) → LOCKED (committed, can't cancel)
 *  - expense.date >= asOf+notice         → AVOIDABLE (could still cancel/refund)
 *
 * Special case: an expense linked to a flight leg via flights.linked_expense_id.
 * The flights classifier already booked this cost as SUNK at the leg's
 * planned_cost. To avoid double-counting, we SKIP linked-flight expenses here.
 *
 * (Why classify the leg rather than the expense for linked flights?
 *  Because the leg's planned_cost is what was in the original forecast. The
 *  actual expense amount may differ — that variance shows up in MIKA Actuals
 *  the normal way; for walk-away we just want the original commitment counted
 *  once. The variance between planned and actual stays out of Walk-Away because
 *  it's already realised — neither cost-to-stop nor cost-to-continue includes it.)
 */
export function classifyExpenses(
  asOf: string,
  expenses: Expense[],
  flights: Flight[],
  fxRates: { code: string; rate: number }[],
  noticeDays: Partial<Record<WalkAwaySource, number>>,
): WalkAwayLineItem[] {
  const notice = noticeFor('expenses', noticeDays)
  const cutoffLocked = addDays(asOf, notice)
  // Set of expense IDs that are already classified via flights → skip here.
  const linkedFromFlights = new Set(
    flights.filter(f => f.linked_expense_id).map(f => f.linked_expense_id as string),
  )

  const lines: WalkAwayLineItem[] = []
  for (const e of expenses) {
    if (linkedFromFlights.has(e.id)) continue   // counted via flights
    const refDate = e.date || null
    const amount = (e.cost_ex_gst || e.amount || 0) * fxToAud(e.currency, fxRates)
    if (amount <= 0) continue

    let bucket: WalkAwayBucket
    if (!refDate) {
      // Undated expense → treat as SUNK (it's been entered as a known cost
      // but admin hasn't dated it; safest assumption is it's already incurred)
      bucket = 'sunk'
    } else if (refDate < asOf) {
      bucket = 'sunk'
    } else if (refDate < cutoffLocked) {
      bucket = 'locked'
    } else {
      bucket = 'avoidable'
    }

    lines.push({
      source: 'expenses',
      bucket,
      amount,
      wbs: e.wbs || '',
      description: [e.vendor, e.description, e.category].filter(Boolean).join(' · '),
      refDate,
      refId: e.id,
    })
  }
  return lines
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/** Build the empty bucket-totals scaffold. */
function emptyBuckets(): Record<WalkAwayBucket, WalkAwayBucketTotals> {
  return {
    sunk:          { total: 0, bySource: {} },
    locked:        { total: 0, bySource: {} },
    avoidable:     { total: 0, bySource: {} },
    discretionary: { total: 0, bySource: {} },
  }
}

/** Aggregate a flat list of WalkAwayLineItem into the WalkAwayResult shape. */
function aggregate(lines: WalkAwayLineItem[], asOf: string): WalkAwayResult {
  const buckets = emptyBuckets()
  const byWbs: Record<string, Record<WalkAwayBucket, number>> = {}
  let total = 0

  for (const ln of lines) {
    buckets[ln.bucket].total += ln.amount
    buckets[ln.bucket].bySource[ln.source] = (buckets[ln.bucket].bySource[ln.source] || 0) + ln.amount
    total += ln.amount

    const wbsKey = ln.wbs || '(unallocated)'
    if (!byWbs[wbsKey]) {
      byWbs[wbsKey] = { sunk: 0, locked: 0, avoidable: 0, discretionary: 0 }
    }
    byWbs[wbsKey][ln.bucket] += ln.amount
  }

  return { asOfDate: asOf, total, buckets, byWbs, lines }
}

/**
 * Top-level entry: run every source classifier and aggregate.
 *
 * Sources implemented:
 *   - flights
 *   - expenses
 *
 * Sources stubbed (return zero — implemented in subsequent commits):
 *   - cars, accommodation, dry_hire, wet_hire, local_hire, tooling,
 *     labour_trades, labour_mgmt, labour_seag, labour_subcon, back_office,
 *     se_ag_support, variations
 */
export function classifyWalkAway(input: WalkAwayInput, asOf: string): WalkAwayResult {
  const lines: WalkAwayLineItem[] = []

  lines.push(...classifyFlights(asOf, input.flights, input.resources, input.expenses, input.fxRates, input.noticeDays))
  lines.push(...classifyExpenses(asOf, input.expenses, input.flights, input.fxRates, input.noticeDays))

  return aggregate(lines, asOf)
}
