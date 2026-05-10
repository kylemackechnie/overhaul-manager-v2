/**
 * dates.ts — timezone-safe date utilities for OMV2.
 *
 * WHY THIS EXISTS
 * ───────────────
 * JavaScript's `new Date(isoDateStr + 'T00:00:00')` parses as LOCAL midnight.
 * In UTC+10 (AEST/Australia), local midnight = previous UTC day.
 * This means date arithmetic like `date + 6 days → toISOString().slice(0,10)`
 * returns Saturday instead of Sunday for Australian users.
 *
 * All date arithmetic in this app MUST use noon UTC (T12:00:00Z) as the
 * anchor, and setUTCDate / getUTCDate for mutation. This makes results
 * identical in any timezone from UTC-11 to UTC+14.
 *
 * RULE: Never use `new Date(str + 'T00:00:00')` for any date that will be
 * written to the DB, used in a Set lookup, or compared against DB values.
 * Use the functions below instead.
 */

/** Parse an ISO date string (YYYY-MM-DD) as a noon-UTC Date — timezone safe. */
export function parseDate(isoDate: string): Date {
  return new Date(isoDate + 'T12:00:00Z')
}

/** Format a Date to an ISO date string (YYYY-MM-DD) using UTC date. */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Add N days to an ISO date string, returns ISO date string. */
export function addDays(isoDate: string, days: number): string {
  const d = parseDate(isoDate)
  d.setUTCDate(d.getUTCDate() + days)
  return formatDate(d)
}

/** Return the ISO date string for the Sunday (week_ending) of the week containing week_start (Monday). */
export function weekEndingFromStart(weekStart: string): string {
  return addDays(weekStart, 6)
}

/** Day of week index (0=Sun, 1=Mon, …, 6=Sat) for an ISO date string — UTC safe. */
export function dayOfWeekIndex(isoDate: string): number {
  return parseDate(isoDate).getUTCDay()
}

/** Return all ISO date strings in [startDate, endDate] inclusive. */
export function dateRange(startDate: string, endDate: string): string[] {
  const result: string[] = []
  const end = parseDate(endDate)
  const cur = parseDate(startDate)
  while (formatDate(cur) <= formatDate(end)) {
    result.push(formatDate(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return result
}

/** Format an ISO date string for display (e.g. "07 May 2026"). */
export function displayDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  return parseDate(isoDate).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** Natural-sort comparator for TCE item IDs like "2.02.7.2" vs "2.02.7.10".
 *  Splits on '.' and compares each segment numerically. */
export function naturalSortItemId(a: string | null | undefined, b: string | null | undefined): number {
  const segA = (a || '').split('.').map(s => parseInt(s, 10) || 0)
  const segB = (b || '').split('.').map(s => parseInt(s, 10) || 0)
  const len = Math.max(segA.length, segB.length)
  for (let i = 0; i < len; i++) {
    const diff = (segA[i] || 0) - (segB[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}
export function daysDiff(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}
