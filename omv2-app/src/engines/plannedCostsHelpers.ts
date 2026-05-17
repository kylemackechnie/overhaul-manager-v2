/**
 * plannedCostsHelpers.ts
 *
 * Shared utilities for spreading a planned_costs row across the project
 * timeline. The same helpers are consumed by:
 *
 *   - walkAwayEngine.classifyPlannedCosts — splits each row into
 *     Sunk / Locked / Avoidable based on a chosen walk-away date
 *   - wbsAggregator / forecast engine — rolls planned costs into the EAC
 *     forecast term, with actualised rows pulled across into actuals
 *
 * The model is deliberately simple: a planned cost has an effective window
 * (start_date → end_date) and a total amount. It accrues evenly within that
 * window, day by day. Lump-sum rows have a window of one day.
 *
 * Edge cases:
 *  - actualised=true → the cost has occurred in reality; treat as fully
 *    Sunk / Actual regardless of accrual window
 *  - project_duration mode with no explicit dates → resolve at call time
 *    using the project's start_date / end_date (caller passes them in)
 *  - lump_sum with no start_date → defaults to project start
 *  - end_date < start_date → treat as lump_sum on start_date (defensive)
 */

import type { PlannedCost } from '../types'

/** Resolve the effective accrual window for a planned cost row. */
export function plannedCostWindow(
  pc: PlannedCost,
  projectStart: string | null,
  projectEnd: string | null,
): { start: string; end: string } | null {
  // lump_sum: single day. Falls back to project start if no date set.
  if (pc.accrual_mode === 'lump_sum') {
    const d = pc.start_date || projectStart
    if (!d) return null
    return { start: d, end: d }
  }

  // project_duration: bind to project window
  if (pc.accrual_mode === 'project_duration') {
    if (!projectStart || !projectEnd) return null
    return { start: projectStart, end: projectEnd }
  }

  // monthly + date_range: use explicit dates, fall back to project window
  const start = pc.start_date || projectStart
  const end = pc.end_date || projectEnd
  if (!start || !end) return null

  // defensive: end < start → treat as lump on start
  if (end < start) return { start, end: start }

  return { start, end }
}

/** Inclusive day count between two ISO dates. */
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.max(1, Math.floor(ms / 86400000) + 1)
}

/**
 * Slice a planned cost across the buckets needed by Walk-Away.
 *
 * Returns the AUD-equivalent amount that falls into each of the three
 * date-driven buckets relative to `asOf` and `noticeCutoff`:
 *
 *   - sunk:      days strictly before asOf
 *   - locked:    days in [asOf, noticeCutoff)
 *   - avoidable: days from noticeCutoff onwards
 *
 * actualised=true short-circuits to fully Sunk regardless of dates.
 *
 * The amount returned is in the row's native currency — the caller is
 * responsible for FX-converting to AUD if needed.
 */
export function classifyPlannedCostByDate(
  pc: PlannedCost,
  asOf: string,
  noticeCutoff: string,
  projectStart: string | null,
  projectEnd: string | null,
): { sunk: number; locked: number; avoidable: number } {
  const zero = { sunk: 0, locked: 0, avoidable: 0 }
  if (pc.amount <= 0) return zero

  // Actualised → fully Sunk. No date arithmetic needed.
  if (pc.actualised) return { sunk: pc.amount, locked: 0, avoidable: 0 }

  const win = plannedCostWindow(pc, projectStart, projectEnd)
  if (!win) return zero

  // Lump-sum (single day): the whole amount lands in one bucket.
  if (win.start === win.end) {
    if (win.start < asOf) return { sunk: pc.amount, locked: 0, avoidable: 0 }
    if (win.start < noticeCutoff) return { sunk: 0, locked: pc.amount, avoidable: 0 }
    return { sunk: 0, locked: 0, avoidable: pc.amount }
  }

  // Multi-day: pro-rata by day count.
  const totalDays = daysBetween(win.start, win.end)
  const perDay = pc.amount / totalDays

  // Each bucket's day count:
  //   sunk:      days in [win.start, asOf)
  //   locked:    days in [max(win.start, asOf), noticeCutoff)
  //   avoidable: days in [max(win.start, noticeCutoff), win.end]
  const sunkEnd = asOf < win.start ? win.start : (asOf > win.end ? addDay(win.end) : asOf)
  const sunkDays = sunkEnd > win.start ? daysBetween(win.start, prevDay(sunkEnd)) : 0

  const lockedStart = asOf < win.start ? win.start : asOf
  const lockedEnd = noticeCutoff < lockedStart ? lockedStart
                  : (noticeCutoff > addDay(win.end) ? addDay(win.end) : noticeCutoff)
  const lockedDays = lockedEnd > lockedStart ? daysBetween(lockedStart, prevDay(lockedEnd)) : 0

  const availStart = noticeCutoff < win.start ? win.start : noticeCutoff
  const availDays = availStart <= win.end ? daysBetween(availStart, win.end) : 0

  // Clamp totals to handle off-by-one rounding edge cases on day arithmetic.
  // The three should sum to totalDays exactly when both bounds are inside
  // the window; reconcile any leftover into sunk (most stable).
  const accountedDays = sunkDays + lockedDays + availDays
  const slack = totalDays - accountedDays

  return {
    sunk:      Math.round((sunkDays + Math.max(0, slack)) * perDay * 100) / 100,
    locked:    Math.round(lockedDays * perDay * 100) / 100,
    avoidable: Math.round(availDays * perDay * 100) / 100,
  }
}

/**
 * Sum amount accrued into a specific [from, to] window.
 * Used by the forecast aggregator to attribute portions to days.
 * Inclusive on both ends.
 */
export function plannedCostAccruedInWindow(
  pc: PlannedCost,
  from: string,
  to: string,
  projectStart: string | null,
  projectEnd: string | null,
): number {
  if (pc.amount <= 0) return 0
  if (pc.actualised) {
    // Treat actualised as "spent on actualised_date"
    const d = pc.actualised_date || pc.start_date || projectStart
    if (!d) return 0
    return d >= from && d <= to ? pc.amount : 0
  }

  const win = plannedCostWindow(pc, projectStart, projectEnd)
  if (!win) return 0

  if (win.start === win.end) {
    return win.start >= from && win.start <= to ? pc.amount : 0
  }

  // Overlap of [win.start, win.end] with [from, to]
  const overlapStart = win.start > from ? win.start : from
  const overlapEnd   = win.end   < to   ? win.end   : to
  if (overlapEnd < overlapStart) return 0

  const totalDays   = daysBetween(win.start, win.end)
  const overlapDays = daysBetween(overlapStart, overlapEnd)
  return (pc.amount * overlapDays) / totalDays
}

// — small date helpers, kept local to avoid import sprawl —
function addDay(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
function prevDay(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
