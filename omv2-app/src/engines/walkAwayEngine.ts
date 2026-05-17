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
  Flight, Expense, Resource, Car, Accommodation,
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

// ── Helper: classify a time-bounded booking ──────────────────────────────────

/**
 * Generic classifier for a time-bounded booking (cars, accommodation, hire,
 * eventually tooling rentals). Splits the cost based on where asOf lands
 * relative to [start, end].
 *
 * Returns 1-3 line items depending on the booking's relationship to asOf:
 *
 *   end < asOf
 *     → single line: SUNK (rental fully consumed before walk-away)
 *
 *   start <= asOf <= end (mid-rental)
 *     → up to THREE lines using the day-count split:
 *       Sunk      = days in [start, asOf)             — already consumed
 *       Locked    = days in [asOf, asOf + notice)     — inside notice window
 *       Avoidable = days in [asOf + notice, end]      — cancellable via off-hire
 *
 *   start in [asOf, asOf + notice)
 *     → single line: LOCKED (starts inside notice window, can't cancel in time)
 *
 *   start >= asOf + notice
 *     → single line: AVOIDABLE (enough lead time to cancel)
 *
 * Day-count pro-rata uses (end - start + 1) total days; each portion is
 * (portion_days / total_days) × total_cost. This mirrors how most hire
 * contracts work: you pay for days you used + days inside the notice
 * window once you give notice; the rest is avoided.
 *
 * Returns [] if the booking has missing dates or zero cost.
 */
function classifyBookingPeriod(args: {
  source: WalkAwaySource
  asOf: string
  start: string | null
  end: string | null
  totalCost: number
  notice: number
  wbs: string
  description: string
  refId: string
}): WalkAwayLineItem[] {
  const { source, asOf, start, end, totalCost, notice, wbs, description, refId } = args
  if (!start || !end || totalCost <= 0) return []

  const out: WalkAwayLineItem[] = []
  const cutoffLocked = addDays(asOf, notice)

  if (end < asOf) {
    out.push({ source, bucket: 'sunk', amount: totalCost, wbs, description, refDate: start, refId })
  } else if (start <= asOf && asOf <= end) {
    // Mid-rental — three-way day-count split.
    const dayMs = 86400000
    const startMs = new Date(start + 'T00:00:00Z').getTime()
    const endMs   = new Date(end   + 'T00:00:00Z').getTime()
    const asMs    = new Date(asOf  + 'T00:00:00Z').getTime()
    const cutMs   = new Date(cutoffLocked + 'T00:00:00Z').getTime()

    const totalDays = Math.max(1, Math.round((endMs - startMs) / dayMs) + 1)
    const perDay = totalCost / totalDays

    // Days already consumed (start ≤ d < asOf)
    const sunkDays = Math.max(0, Math.round((asMs - startMs) / dayMs))
    // Days in the notice window after asOf, capped by booking end (asOf ≤ d < cutoff)
    const cutForBooking = Math.min(cutMs, endMs + dayMs)
    const lockedDays = Math.max(0, Math.round((cutForBooking - asMs) / dayMs))
    // Remainder is avoidable: end - cutoff (inclusive of end day)
    const avoidableDays = Math.max(0, totalDays - sunkDays - lockedDays)

    const sunk      = perDay * sunkDays
    const locked    = perDay * lockedDays
    const avoidable = perDay * avoidableDays

    if (sunk > 0)
      out.push({ source, bucket: 'sunk',      amount: sunk,      wbs, description: description + ' (consumed)',         refDate: start, refId })
    if (locked > 0)
      out.push({ source, bucket: 'locked',    amount: locked,    wbs, description: description + ' (notice-window days)', refDate: asOf,  refId })
    if (avoidable > 0)
      out.push({ source, bucket: 'avoidable', amount: avoidable, wbs, description: description + ' (after notice)',       refDate: cutoffLocked, refId })
  } else if (start < cutoffLocked) {
    out.push({ source, bucket: 'locked', amount: totalCost, wbs, description, refDate: start, refId })
  } else {
    out.push({ source, bucket: 'avoidable', amount: totalCost, wbs, description, refDate: start, refId })
  }
  return out
}

// ── Source 3: Cars ────────────────────────────────────────────────────────────

/**
 * Classify all car rentals. Uses total_cost (planned). Future enhancement: if
 * linked_po_id is set and the PO has been drawn, prefer the drawn value as
 * actual Sunk — requires cross-reference with PO commitments / invoices.
 */
export function classifyCars(
  asOf: string,
  cars: Car[],
  noticeDays: Partial<Record<WalkAwaySource, number>>,
): WalkAwayLineItem[] {
  const notice = noticeFor('cars', noticeDays)
  const lines: WalkAwayLineItem[] = []
  for (const c of cars) {
    lines.push(...classifyBookingPeriod({
      source: 'cars',
      asOf,
      start: c.start_date,
      end:   c.end_date,
      totalCost: c.total_cost || 0,
      notice,
      wbs: c.wbs || '',
      description: [c.vehicle_type, c.rego, c.vendor].filter(Boolean).join(' · '),
      refId: c.id,
    }))
  }
  return lines
}

// ── Source 4: Accommodation ───────────────────────────────────────────────────

export function classifyAccommodation(
  asOf: string,
  accom: Accommodation[],
  noticeDays: Partial<Record<WalkAwaySource, number>>,
): WalkAwayLineItem[] {
  const notice = noticeFor('accommodation', noticeDays)
  const lines: WalkAwayLineItem[] = []
  for (const a of accom) {
    lines.push(...classifyBookingPeriod({
      source: 'accommodation',
      asOf,
      start: a.check_in,
      end:   a.check_out,
      totalCost: a.total_cost || 0,
      notice,
      wbs: a.wbs || '',
      description: [a.property, a.room, a.vendor].filter(Boolean).join(' · '),
      refId: a.id,
    }))
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
  lines.push(...classifyCars(asOf, input.cars, input.noticeDays))
  lines.push(...classifyAccommodation(asOf, input.accommodation, input.noticeDays))

  return aggregate(lines, asOf)
}
