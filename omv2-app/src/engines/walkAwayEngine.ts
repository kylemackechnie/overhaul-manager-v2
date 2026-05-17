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
  WalkAwaySource, WalkAwayBucketTotals, WalkAwayTimesheetCostLine,
  Flight, Expense, Resource, Car, Accommodation, HireItem, ToolingCosting,
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

// ── Source 5-7: Hire (dry, wet, local) ────────────────────────────────────────

/**
 * Classify all hire items. HireItem has a hire_type ('dry' | 'wet' | 'local')
 * which maps to three separate WalkAwaySource keys so notice periods and
 * row totals are tracked independently per type. All three share the
 * classifyBookingPeriod model.
 *
 * Cost comes from hire_cost (planned). Currency is the item's currency, FX'd
 * to AUD. transport_in / transport_out costs aren't included here — they're
 * treated as separate one-off costs which would be captured via expenses or
 * POs in practice; revisit if real data shows otherwise.
 *
 * Wet hire complication: a wet hire's full cost is structured around a
 * shift calendar (ds/ns/wds/wns/sd day rates), not a flat daily rate. For
 * walk-away purposes, the planned hire_cost field still represents the
 * total committed amount, so we use that as the input to the pro-rata.
 * This is approximate — a more precise model would walk the calendar
 * day-by-day and only include shift days actually scheduled. Acceptable
 * for the first cut; refine if wet hire dominates a real project's EAC.
 */
export function classifyHire(
  asOf: string,
  hireItems: HireItem[],
  noticeDays: Partial<Record<WalkAwaySource, number>>,
  fxRates: { code: string; rate: number }[],
): WalkAwayLineItem[] {
  const lines: WalkAwayLineItem[] = []
  for (const h of hireItems) {
    const source: WalkAwaySource =
      h.hire_type === 'wet'   ? 'wet_hire'
      : h.hire_type === 'local' ? 'local_hire'
      : 'dry_hire'
    const notice = noticeFor(source, noticeDays)
    const costAud = (h.hire_cost || 0) * fxToAud(h.currency, fxRates)
    lines.push(...classifyBookingPeriod({
      source,
      asOf,
      start: h.start_date,
      end:   h.end_date,
      totalCost: costAud,
      notice,
      wbs: h.wbs || '',
      description: [h.name, h.vendor, h.description].filter(Boolean).join(' · '),
      refId: h.id,
    }))
  }
  return lines
}

// ── Source 8: Tooling ─────────────────────────────────────────────────────────

/**
 * Classify tooling costings (Siemens tooling charge-out from cross-project
 * shared pool). Each costing has charge_start, charge_end, and cost_eur.
 *
 * Simplification: this commit handles the basic single-project case
 * (no splits[] entries). Multi-project tooling — where one costing is
 * split across multiple projects via splits[] — needs per-split classification
 * using each split's own date range and discount, and isn't worth the extra
 * complexity until a real project's EAC has meaningful cross-project tooling.
 * For now: ignore splits[], use the costing's own charge_start/end.
 *
 * Currency is always EUR for Siemens tooling — FX'd to AUD on the way out.
 *
 * Cost-side only: this engine doesn't consider sell_eur or sell_override_eur.
 * Transport in/out costs (import_cost_eur, export_cost_eur) are typically
 * separate POs in practice — ignored here; will appear via POs/invoices
 * once that classifier comes online.
 */
export function classifyTooling(
  asOf: string,
  toolingCostings: ToolingCosting[],
  noticeDays: Partial<Record<WalkAwaySource, number>>,
  fxRates: { code: string; rate: number }[],
): WalkAwayLineItem[] {
  const notice = noticeFor('tooling', noticeDays)
  const lines: WalkAwayLineItem[] = []
  for (const t of toolingCostings) {
    if (Array.isArray(t.splits) && t.splits.length > 0) {
      // Multi-project tooling: skip for now. Total cost for this costing is
      // distributed across projects via splits[]; doing it properly needs
      // each split's discountPct + date range. See JSDoc above.
      continue
    }
    const costAud = (t.cost_eur || 0) * fxToAud('EUR', fxRates)
    lines.push(...classifyBookingPeriod({
      source: 'tooling',
      asOf,
      start: t.charge_start,
      end:   t.charge_end,
      totalCost: costAud,
      notice,
      wbs: t.wbs || '',
      description: `Tooling TV ${t.tv_no || '(no TV)'}`,
      refId: t.id,
    }))
  }
  return lines
}

// ── Source 9-12: Labour (from forecast.byDay) ─────────────────────────────────

/**
 * Classify labour from a pre-computed forecast's byDay map.
 *
 * Forecast.byDay gives us cost per category (trades/mgmt/seag/subcon) per day,
 * already accounting for shift patterns, rate cards, public holidays, and
 * travel days. We walk the day list and bucket each day's cost by category:
 *
 *   - day < asOf                       → SUNK (work day has passed)
 *   - asOf ≤ day < asOf + notice       → LOCKED (demob notice window)
 *   - day ≥ asOf + notice              → AVOIDABLE (can demob from cutoff)
 *
 * Each category gets its own notice period (labour_trades / labour_mgmt /
 * labour_seag / labour_subcon) so admin can tune them independently — e.g.
 * subcon notice tends to be longer due to contract clauses.
 *
 * WBS attribution: omitted at the line level. Labour is allocated to WBS
 * in forecast.byWbs, not byDay. The Walk-Away WBS view will therefore
 * show labour as '(unallocated)'. Improving this means walking
 * forecast.byPo or running a separate per-day-per-resource WBS resolve;
 * not worth the complexity for the first cut, since labour is usually
 * dominated by one WBS code per category anyway.
 *
 * Past-day actuals vs forecast: this classifier trusts forecast cost for all
 * past days. Even if no timesheet was logged for day D < asOf, we still
 * count the forecast cost as SUNK on the assumption that work happened
 * (the resource was mobilised). For higher fidelity, a future enhancement
 * could substitute actuals from wbsAggregator on past days where they
 * exist. Acceptable first-cut accuracy.
 */
export function classifyLabourFromForecast(
  asOf: string,
  forecast: { byDay: Record<string, {
    trades: { cost: number }; mgmt: { cost: number }; seag: { cost: number }; subcon: { cost: number }
  }>; days: string[] } | undefined,
  noticeDays: Partial<Record<WalkAwaySource, number>>,
): WalkAwayLineItem[] {
  if (!forecast) return []

  const noticeTrades = noticeFor('labour_trades', noticeDays)
  const noticeMgmt   = noticeFor('labour_mgmt',   noticeDays)
  const noticeSeag   = noticeFor('labour_seag',   noticeDays)
  const noticeSubcon = noticeFor('labour_subcon', noticeDays)

  // Pre-compute cutoff dates per category so we don't do it per-day
  const cutTrades = addDays(asOf, noticeTrades)
  const cutMgmt   = addDays(asOf, noticeMgmt)
  const cutSeag   = addDays(asOf, noticeSeag)
  const cutSubcon = addDays(asOf, noticeSubcon)

  // Bucket totals across all days, then emit one summary line per
  // category × bucket (not per-day — would be hundreds of micro-lines).
  // refDate for emitted lines is the date of the first contributing day,
  // for the drill-down view.
  type Sum = { amount: number; firstDate: string | null }
  const init = (): Sum => ({ amount: 0, firstDate: null })

  const t = { sunk: init(), locked: init(), avoidable: init() }
  const m = { sunk: init(), locked: init(), avoidable: init() }
  const s = { sunk: init(), locked: init(), avoidable: init() }
  const c = { sunk: init(), locked: init(), avoidable: init() }

  function bucketFor(day: string, cutoff: string): 'sunk' | 'locked' | 'avoidable' {
    if (day < asOf)     return 'sunk'
    if (day < cutoff)   return 'locked'
    return 'avoidable'
  }

  function add(b: Sum, amount: number, day: string) {
    if (amount <= 0) return
    b.amount += amount
    if (!b.firstDate) b.firstDate = day
  }

  for (const day of forecast.days) {
    const bucket = forecast.byDay[day]
    if (!bucket) continue
    add(t[bucketFor(day, cutTrades)], bucket.trades.cost || 0, day)
    add(m[bucketFor(day, cutMgmt)],   bucket.mgmt.cost || 0,   day)
    add(s[bucketFor(day, cutSeag)],   bucket.seag.cost || 0,   day)
    add(c[bucketFor(day, cutSubcon)], bucket.subcon.cost || 0, day)
  }

  const lines: WalkAwayLineItem[] = []
  function emit(source: WalkAwaySource, b: { sunk: Sum; locked: Sum; avoidable: Sum }, label: string) {
    if (b.sunk.amount > 0)
      lines.push({ source, bucket: 'sunk',      amount: b.sunk.amount,      wbs: '', description: `${label} — consumed days`, refDate: b.sunk.firstDate, refId: `${source}_sunk` })
    if (b.locked.amount > 0)
      lines.push({ source, bucket: 'locked',    amount: b.locked.amount,    wbs: '', description: `${label} — demob-notice days`, refDate: b.locked.firstDate, refId: `${source}_locked` })
    if (b.avoidable.amount > 0)
      lines.push({ source, bucket: 'avoidable', amount: b.avoidable.amount, wbs: '', description: `${label} — after notice`, refDate: b.avoidable.firstDate, refId: `${source}_avoidable` })
  }

  emit('labour_trades', t, 'Trades labour')
  emit('labour_mgmt',   m, 'Management labour')
  emit('labour_seag',   s, 'SE AG labour')
  emit('labour_subcon', c, 'Subcon labour')

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
  lines.push(...classifyHire(asOf, input.hireItems, input.noticeDays, input.fxRates))
  lines.push(...classifyTooling(asOf, input.toolingCostings, input.noticeDays, input.fxRates))
  lines.push(...classifyLabourFromForecast(asOf, input.forecast, input.noticeDays))

  return aggregate(lines, asOf)
}
