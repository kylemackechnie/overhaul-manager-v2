/**
 * Core calculation functions matching HTML app logic exactly.
 * All functions here are pure — no side effects, no DB calls.
 */

// ─── Hire / Cost helpers ───────────────────────────────────────────────────

export function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  return Math.max(0, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

export function calcCustomerPrice(cost: number, gmPct: number): number {
  if (gmPct >= 100 || gmPct <= 0) return cost
  return parseFloat((cost / (1 - gmPct / 100)).toFixed(2))
}

// ─── calcHireCostForPeriod ─────────────────────────────────────────────────
// Pro-rates hire items linked to a PO across a given date window.
// Returns total cost that falls within [fromDate, toDate].

export interface HireItemForPeriod {
  id: string
  linked_po_id: string | null
  start_date: string | null
  end_date: string | null
  hire_cost: number
  daily_rate: number | null
  weekly_rate: number | null
  charge_unit: string | null
  qty: number | null
  transport_in: number | null
  transport_out: number | null
}

export function calcHireCostForPeriod(
  items: HireItemForPeriod[],
  poId: string,
  fromDate: string,
  toDate: string
): { total: number; breakdown: { name?: string; days: number; cost: number }[] } {
  const linked = items.filter(h => h.linked_po_id === poId && h.start_date)
  if (!linked.length) return { total: 0, breakdown: [] }

  const periodStart = new Date(fromDate)
  const periodEnd = new Date(toDate)
  let total = 0
  const breakdown: { name?: string; days: number; cost: number }[] = []

  for (const h of linked) {
    const hStart = new Date(h.start_date!)
    const hEnd = h.end_date ? new Date(h.end_date) : new Date(toDate)

    // Overlap of hire period with PO period
    const overlapStart = hStart > periodStart ? hStart : periodStart
    const overlapEnd = hEnd < periodEnd ? hEnd : periodEnd

    if (overlapStart > overlapEnd) continue

    const totalDays = daysBetween(h.start_date, h.end_date || toDate) || 1
    const overlapDays = daysBetween(
      overlapStart.toISOString().slice(0, 10),
      overlapEnd.toISOString().slice(0, 10)
    ) || 1

    // Pro-rate transport separately (not per day)
    const transport = ((h.transport_in || 0) + (h.transport_out || 0))
    const hireCostOnly = h.hire_cost - transport

    const proratedCost = (hireCostOnly * overlapDays / totalDays) +
      (overlapDays === totalDays ? transport : 0) // Only include transport if full period covered

    total += proratedCost
    breakdown.push({ days: overlapDays, cost: proratedCost })
  }

  return { total, breakdown }
}

// ─── calcApprovedSubconCost ────────────────────────────────────────────────
// Sum of approved subcontractor timesheet weeks linked to a PO.

export interface SubconWeek {
  id: string
  po_id: string | null
  status: string
  type: string
  week_start: string
  crew: { name: string; role: string; days: Record<string, unknown> }[]
  regime: string
}

export function calcApprovedSubconCost(
  weeks: SubconWeek[],
  poId: string,
  fromDate: string,
  toDate: string,
  rateCards: { role: string; rates: { cost: Record<string, number> }; regime: { ge12?: boolean } | null }[]
): { total: number; hours: number } {
  const linked = weeks.filter(w => {
    if (w.type !== 'subcon' || w.status !== 'approved' || w.po_id !== poId) return false
    const wEnd = new Date(w.week_start)
    wEnd.setDate(wEnd.getDate() + 6)
    return w.week_start <= toDate && wEnd.toISOString().slice(0, 10) >= fromDate
  })

  let total = 0, hours = 0
  for (const w of linked) {
    for (const m of w.crew || []) {
      for (const [, day] of Object.entries(m.days || {})) {
        const de = day as Record<string, unknown>
        hours += (de.hours as number) || 0
        // Simple cost: hours × DNT rate from rate card
        const rc = rateCards.find(r => r.role === m.role)
        const dntRate = rc?.rates?.cost?.dnt || 0
        total += ((de.hours as number) || 0) * dntRate
      }
    }
  }
  return { total, hours }
}

// ─── calcRentalCost ────────────────────────────────────────────────────────
// TV rental cost based on replacement value × rental% × duration.
// Mirrors the HTML calcRentalCost exactly.

export interface TvCosting {
  charge_start: string | null
  charge_end: string | null
  sell_override?: number | null
}

export interface ToolingDept {
  rental_pct: number      // % of replacement value per week
  rate_unit: 'weekly' | 'daily' | 'monthly'
  gm_pct: number
  rates?: { costPerDay?: number; sellPerDay?: number }
}

export function calcRentalCost(
  replacementValue: number,
  costing: TvCosting,
  dept: ToolingDept
): { days: number; weeklyRate: number; cost: number; sell: number } | null {
  if (!costing.charge_start || !costing.charge_end) return null

  const days = daysBetween(costing.charge_start, costing.charge_end)
  if (!days) return null

  const factor = (dept.rental_pct || 0) / 100
  const weeklyRate = replacementValue * factor
  let cost = 0

  if (dept.rate_unit === 'weekly') cost = (days / 7) * weeklyRate
  else if (dept.rate_unit === 'daily') cost = days * (weeklyRate / 7)
  else if (dept.rate_unit === 'monthly') cost = (days / 30.44) * (weeklyRate * 4.33)

  const gm = dept.gm_pct || 0
  let sell = gm > 0 ? cost / (1 - gm / 100) : cost

  if (costing.sell_override) {
    const r = costing.sell_override
    if (dept.rate_unit === 'weekly') sell = (days / 7) * r
    else if (dept.rate_unit === 'daily') sell = days * r
    else if (dept.rate_unit === 'monthly') sell = (days / 30.44) * r
  }

  return { days, weeklyRate, cost, sell }
}

// ─── calcCartTotal ─────────────────────────────────────────────────────────
// Hardware cart total from line items with escalation.

export interface CartLine {
  escalated_price: number | null
  transfer_price: number | null
  discounted_price: number | null
  qty_ordered: number | null
  qty: number | null
  list_price: number | null
}

export function calcCartTotal(lines: CartLine[]): {
  escalated: number
  transfer: number
  customer: number
} {
  return {
    escalated: lines.reduce((s, l) => s + (l.escalated_price || 0) * (l.qty_ordered || l.qty || 0), 0),
    transfer:  lines.reduce((s, l) => s + (l.transfer_price || 0) * (l.qty_ordered || l.qty || 0), 0),
    customer:  lines.reduce((s, l) => s + (l.discounted_price || l.escalated_price || 0) * (l.qty_ordered || l.qty || 0), 0),
  }
}

// ─── applyEscalation ──────────────────────────────────────────────────────
// Apply escalation factor to a base price.

export function applyEscalationFactor(basePrice: number, factor: number): number {
  return parseFloat((basePrice * factor).toFixed(2))
}

export function calcYoyChange(current: number, previous: number | null): number | null {
  if (!previous || previous === 0) return null
  return parseFloat(((current / previous - 1) * 100).toFixed(2))
}

// ─── PO spend tracking ─────────────────────────────────────────────────────

export function calcPoSpend(invoices: { amount: number; status: string; po_id: string }[], poId: string): {
  invoiced: number
  approved: number
  pending: number
} {
  const linked = invoices.filter(i => i.po_id === poId)
  const invoiced = linked.reduce((s, i) => s + (i.amount || 0), 0)
  const approved = linked
    .filter(i => i.status === 'approved' || i.status === 'paid')
    .reduce((s, i) => s + (i.amount || 0), 0)
  return { invoiced, approved, pending: invoiced - approved }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE CARD ENGINE — mirrors HTML splitHours / calcHoursCost / calcOhfForecast
// ═══════════════════════════════════════════════════════════════════════════

export interface HoursSplit {
  dnt: number; dt15: number; ddt: number; ddt15: number
  nnt: number; ndt: number; ndt15: number
}

export interface RegimeCfg {
  wdNT?: number; wdT15?: number; satT15?: number; nightNT?: number; restNT?: number
}

export interface RateCardCalc {
  role: string
  category?: string
  laha_sell: number; fsa_sell: number; meal_sell: number; camp: number
  rates: { sell?: Record<string, number>; cost?: Record<string, number> }
  regime: RegimeCfg | null
}

export interface ResourceCalc {
  id: string; name: string; role: string; shift: string
  mob_in: string | null; mob_out: string | null
  travel_days?: number
}

export interface StdHours {
  day: Record<string, number>
  night: Record<string, number>
}

const DOW = ['sun','mon','tue','wed','thu','fri','sat'] as const
const STD_HOURS_DEFAULT: StdHours = {
  day:   { mon:10.5, tue:10.5, wed:10.5, thu:10.5, fri:10.5, sat:10.5, sun:0 },
  night: { mon:10.5, tue:10.5, wed:10.5, thu:10.5, fri:10.5, sat:10.5, sun:10.5 },
}

/** Generate an inclusive list of YYYY-MM-DD strings between start and end. */
export function fcDateRange(start: string, end: string): string[] {
  if (!start || !end) return []
  const s = parseLocal(start), e = parseLocal(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return []
  const days: string[] = []
  const cur = new Date(s)
  while (cur <= e) {
    days.push(toDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function parseLocal(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

/** Determine day type from a date string, with optional public holiday list. */
export function fcDayType(
  dateStr: string,
  publicHolidays: { date: string }[] = []
): 'weekday' | 'saturday' | 'sunday' | 'public_holiday' {
  if (publicHolidays.some(h => h.date === dateStr)) return 'public_holiday'
  const d = parseLocal(dateStr)
  const dow = d.getDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}

/** Exact port of HTML splitHours. */
export function splitHours(
  totalHrs: number,
  dayType: string,
  shiftType: 'day' | 'night',
  regime: 'lt12' | 'ge12',
  regimeConfig?: RegimeCfg | null
): HoursSplit {
  const h = totalHrs
  const night = shiftType === 'night'
  const rc = regimeConfig || {}
  const WD_NT    = rc.wdNT    ?? 7.2
  const WD_T15   = rc.wdT15   ?? 3.3
  const SAT_T15  = rc.satT15  ?? 3
  const NIGHT_NT = rc.nightNT ?? 7.2
  const REST_NT  = rc.restNT  ?? 7.2

  const zero: HoursSplit = { dnt:0, dt15:0, ddt:0, ddt15:0, nnt:0, ndt:0, ndt15:0 }

  if (dayType === 'public_holiday') {
    return night
      ? { ...zero, ndt15: h }
      : { ...zero, ddt15: h }
  }
  if (dayType === 'rest') {
    return night ? { ...zero, nnt: REST_NT } : { ...zero, dnt: REST_NT }
  }
  if (dayType === 'travel') {
    return { ...zero, dnt: h }
  }

  if (night) {
    if (dayType === 'saturday' || dayType === 'sunday') return { ...zero, ndt: h }
    const nt  = Math.min(h, NIGHT_NT)
    const ddt = Math.max(0, h - NIGHT_NT)
    return { ...zero, nnt: nt, ndt: ddt }
  }

  // Day work
  if (dayType === 'saturday') {
    if (regime === 'lt12') {
      const t15 = Math.min(h, SAT_T15)
      const ddt = Math.max(0, h - SAT_T15)
      return { ...zero, dt15: t15, ddt }
    }
    return { ...zero, ddt: h }
  }
  if (dayType === 'sunday') return { ...zero, ddt: h }

  // Weekday day
  if (regime === 'lt12') {
    const nt  = Math.min(h, WD_NT)
    const t15 = Math.min(Math.max(0, h - WD_NT), WD_T15)
    const ddt = Math.max(0, h - WD_NT - WD_T15)
    return { ...zero, dnt: nt, dt15: t15, ddt }
  }
  // ge12
  const nt  = Math.min(h, WD_NT)
  const ddt = Math.max(0, h - WD_NT)
  return { ...zero, dnt: nt, ddt }
}

/** Exact port of HTML calcHoursCost. */
export function calcHoursCost(
  split: HoursSplit,
  rates: { sell?: Record<string, number>; cost?: Record<string, number> },
  type: 'sell' | 'cost'
): number {
  const r = rates?.[type] || {}
  return (split.dnt   * (r.dnt   || 0)) +
         (split.dt15  * (r.dt15  || 0)) +
         (split.ddt   * (r.ddt   || 0)) +
         (split.ddt15 * (r.ddt15 || 0)) +
         (split.nnt   * (r.nnt   || 0)) +
         (split.ndt   * (r.ndt   || 0)) +
         (split.ndt15 * (r.ndt15 || 0))
}

/**
 * Find the best-matching rate card for a role name.
 * Mirrors HTML getRateCardForRole (exact match → strip shift suffix → alias fallback).
 */
export function getRateCardForRole<T extends { role: string }>(
  roleName: string,
  cards: T[],
  aliases: { from: string; to: string }[] = []
): T | null {
  if (!roleName) return null
  const needle = roleName.toLowerCase().trim()

  let match = cards.find(c => c.role.toLowerCase() === needle)
  if (match) return match

  const stripped = needle
    .replace(/\s+(ds|ns|day shift|night shift|day|night)\s*$/i, '')
    .trim()

  if (stripped !== needle) {
    match = cards.find(c => c.role.toLowerCase() === stripped)
    if (match) return match
  }

  for (const alias of aliases) {
    const aFrom = alias.from.toLowerCase().trim()
    if (stripped === aFrom || needle === aFrom) {
      match = cards.find(c => c.role === alias.to)
      if (match) return match
    }
  }

  return null
}

/**
 * Sell-side OHF forecast for a single line — exact port of nrgOhfCalcLine.
 * Returns dollar value.
 */
export function calcOhfLineForecast(opts: {
  forecastType: string | null
  forecastSubtype?: string | null
  forecastEnabled: boolean
  forecastDateFrom: string | null
  forecastDateTo: string | null
  forecastResourceIds: string[]
  tceTotal: number
  resources: ResourceCalc[]
  rateCards: RateCardCalc[]
  aliases?: { from: string; to: string }[]
  stdHours?: StdHours
  publicHolidays?: { date: string }[]
}): number {
  if (!opts.forecastEnabled) return 0
  if (opts.forecastType === 'tce') return opts.tceTotal || 0

  const std  = opts.stdHours || STD_HOURS_DEFAULT
  const phs  = opts.publicHolidays || []
  const lineFrom = opts.forecastDateFrom || ''
  const lineTo   = opts.forecastDateTo   || ''

  const forecastRes = opts.forecastResourceIds
    .map(id => opts.resources.find(r => r.id === id))
    .filter((r): r is ResourceCalc => !!r)

  if (!forecastRes.length) return 0

  if (opts.forecastType === 'travel') {
    let total = 0
    for (const r of forecastRes) {
      const rc = getRateCardForRole(r.role, opts.rateCards, opts.aliases)
      if (!rc) continue
      const travelDays = typeof r.travel_days === 'number' ? r.travel_days : 1
      const shift = (r.shift === 'night' ? 'night' : 'day') as 'day' | 'night'
      const stdH  = shift === 'night' ? (std.night?.mon ?? 10.5) : (std.day?.mon ?? 10.5)
      const regime: 'lt12' | 'ge12' = stdH >= 12 ? 'ge12' : 'lt12'
      const split = splitHours(stdH, 'travel', shift, regime, rc.regime)
      const shiftSell = calcHoursCost(split, rc.rates, 'sell')
      total += travelDays * 2 * shiftSell   // return trip
    }
    return total
  }

  let total = 0
  for (const r of forecastRes) {
    const rc = getRateCardForRole(r.role, opts.rateCards, opts.aliases)
    if (!rc) continue

    const cat    = rc.category || 'trades'
    const isMgmt = cat === 'management' || cat === 'seag'

    // Effective window = intersection of line dates and resource mob window
    const effectiveFrom = [lineFrom, r.mob_in].filter(Boolean).sort().pop()!
    const effectiveTo   = [lineTo,   r.mob_out].filter(Boolean).sort()[0]
    if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) continue

    const days   = fcDateRange(effectiveFrom, effectiveTo)
    const shifts = r.shift === 'both' ? ['day', 'night'] : [r.shift || 'day']

    for (const dateStr of days) {
      const dayType = fcDayType(dateStr, phs)
      const dow     = DOW[parseLocal(dateStr).getDay()]

      for (const shiftType of shifts as ('day' | 'night')[]) {
        const hrs = std[shiftType]?.[dow] ?? 0
        if (hrs <= 0) continue
        const regime: 'lt12' | 'ge12' = hrs >= 12 ? 'ge12' : 'lt12'

        if (opts.forecastType === 'labour') {
          const split = splitHours(hrs, dayType, shiftType, regime, rc.regime)
          total += calcHoursCost(split, rc.rates, 'sell')
        } else if (opts.forecastType === 'allowances') {
          const sub = opts.forecastSubtype || 'laha'
          if (sub === 'accommodation') total += isMgmt ? (rc.camp || rc.fsa_sell || 0) : (rc.laha_sell || 0)
          else if (sub === 'laha')     total += isMgmt ? (rc.fsa_sell || rc.laha_sell || 0) : (rc.laha_sell || 0)
          else if (sub === 'travel_allow') total += rc.meal_sell || 0
          else if (sub === 'meal')     total += isMgmt ? (rc.meal_sell || 0) : (rc.meal_sell || 0)
        }
      }
    }
  }
  return total
}
