/**
 * invoiceExpectedValue.ts
 *
 * Calculates the expected value of an invoice given:
 *  - A PO ID
 *  - A billing period (period_from → period_to)
 *  - The hire items linked to that PO (daily_rate / weekly_rate)
 *  - The resources linked to that PO (rate_card → cost rates, shift pattern, allowances)
 *  - Project std_hours and public holidays
 *
 * Mirrors the forecastEngine labour calculation exactly (same splitHours / costForSplit
 * logic) so expected values match forecast cost.
 */

import type { Resource, RateCard, HireItem } from '../types'
import { resolveShift } from '../lib/shiftPhases'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExpectedValueLine {
  label: string       // e.g. "Forklift 3T (×2)" or "Adam Ilott — Fitter"
  type: 'hire' | 'labour'
  days?: number
  cost: number        // cost to SE (ex margin)
}

export interface ExpectedValueResult {
  lines: ExpectedValueLine[]
  totalCost: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type FcRegimeConfig = { wdNT?: number; wdT15?: number; satT15?: number; nightNT?: number; restNT?: number } | null | undefined
type HourSplit = Record<string, number>

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + 'T12:00:00')
  const last = new Date(end + 'T12:00:00')
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

function getDayType(d: string, holidays: Set<string>): string {
  if (holidays.has(d)) return 'public_holiday'
  const dow = new Date(d + 'T12:00:00').getDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}

function splitHours(totalHrs: number, dayType: string, shiftType: 'day' | 'night', regimeConfig?: FcRegimeConfig): HourSplit {
  const zero: HourSplit = { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
  if (totalHrs <= 0) return { ...zero }
  const night = shiftType === 'night'
  const rc = regimeConfig || {}
  const WD_NT = (rc as { wdNT?: number }).wdNT ?? 7.2
  const WD_T15 = (rc as { wdT15?: number }).wdT15 ?? 3.3
  const SAT_T15 = (rc as { satT15?: number }).satT15 ?? 3
  const NIGHT_NT = (rc as { nightNT?: number }).nightNT ?? 7.2
  const REST_NT = (rc as { restNT?: number }).restNT ?? 7.2
  const ge12 = totalHrs >= 12

  if (dayType === 'public_holiday') return night ? { ...zero, ndt15: totalHrs } : { ...zero, ddt15: totalHrs }
  if (dayType === 'rest') return night ? { ...zero, nnt: REST_NT } : { ...zero, dnt: REST_NT }
  if (dayType === 'travel' || dayType === 'mob') return { ...zero, dnt: totalHrs }
  if (night) {
    if (dayType === 'saturday' || dayType === 'sunday') return { ...zero, ndt: totalHrs }
    return { ...zero, nnt: Math.min(totalHrs, NIGHT_NT), ndt: Math.max(0, totalHrs - NIGHT_NT) }
  }
  if (dayType === 'saturday') {
    if (ge12) return { ...zero, ddt: totalHrs }
    return { ...zero, dt15: Math.min(totalHrs, SAT_T15), ddt: Math.max(0, totalHrs - SAT_T15) }
  }
  if (dayType === 'sunday') return { ...zero, ddt: totalHrs }
  if (ge12) {
    return { ...zero, dnt: Math.min(totalHrs, WD_NT), ddt: Math.max(0, totalHrs - WD_NT) }
  }
  const dnt = Math.min(totalHrs, WD_NT)
  const dt15 = Math.min(Math.max(0, totalHrs - WD_NT), WD_T15)
  const ddt = Math.max(0, totalHrs - WD_NT - WD_T15)
  return { ...zero, dnt, dt15, ddt }
}

function costForSplit(split: HourSplit, rates: Record<string, number>): number {
  return Object.entries(split).reduce((s, [b, h]) => s + h * (rates[b] || 0), 0)
}

// ── Main engine ───────────────────────────────────────────────────────────────

export function calcInvoiceExpectedValue(params: {
  periodFrom: string
  periodTo: string
  hireItems: HireItem[]          // already filtered to this PO
  resources: Resource[]          // already filtered to this PO, with rate_card joined
  rateCards: RateCard[]          // full project rate cards
  stdHours: { day: Record<string, number>; night: Record<string, number> }
  holidays: Set<string>
}): ExpectedValueResult {
  const { periodFrom, periodTo, hireItems, resources, rateCards, stdHours, holidays } = params
  const days = dateRange(periodFrom, periodTo)
  if (days.length === 0) return { lines: [], totalCost: 0 }

  const lines: ExpectedValueLine[] = []

  // ── Hire items ────────────────────────────────────────────────────────────
  // Group identical items (same name) to show "Forklift 3T (×2)"
  const hireGroups = new Map<string, { items: HireItem[]; dailyRate: number }>()
  for (const hi of hireItems) {
    const key = hi.name || hi.description || hi.id
    const rate = hi.daily_rate ?? (hi.weekly_rate != null ? hi.weekly_rate / 7 : 0)
    if (!hireGroups.has(key)) hireGroups.set(key, { items: [], dailyRate: rate })
    hireGroups.get(key)!.items.push(hi)
  }

  for (const [name, { items, dailyRate }] of hireGroups) {
    if (dailyRate <= 0) continue
    // Only count days within the hire item's own start/end window
    const activeDays = days.filter(d => {
      return items.some(hi => {
        const start = hi.start_date || '0000-00-00'
        const end = hi.end_date || '9999-99-99'
        return d >= start && d <= end
      })
    })
    const cost = dailyRate * items.length * activeDays.length
    if (cost === 0) continue
    lines.push({
      label: items.length > 1 ? `${name} (×${items.length})` : name,
      type: 'hire',
      days: activeDays.length,
      cost,
    })
  }

  // ── Labour from resources ─────────────────────────────────────────────────
  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

  for (const r of resources) {
    // Find rate card — prefer joined rate_card, else match by role
    const rc: RateCard | undefined = (r.rate_card) || rateCards.find(
      rc => rc.role.toLowerCase() === r.role.toLowerCase()
    )
    if (!rc) continue

    const rcCost = (rc.rates as { cost?: Record<string, number> })?.cost || {}
    const rcRegime = (rc as RateCard & { regime?: FcRegimeConfig }).regime

    // Resource must be on-site during the period
    const mobIn = r.mob_in || periodFrom
    const mobOut = r.mob_out || periodTo

    let resourceCost = 0

    for (const d of days) {
      // Resource must be on site this day
      if (d < mobIn || d > mobOut) continue

      const dow = DOW[new Date(d + 'T12:00:00').getDay()]
      const dayType = getDayType(d, holidays)
      const shift = resolveShift(r, d)

      let dayCost = 0

      if (shift === 'day' || shift === 'both') {
        const h = stdHours.day?.[dow] ?? 0
        if (h > 0) {
          const split = splitHours(h, dayType, 'day', rcRegime)
          dayCost += costForSplit(split, rcCost)
        }
      }
      if (shift === 'night' || shift === 'both') {
        const h = stdHours.night?.[dow] ?? 0
        if (h > 0) {
          const split = splitHours(h, dayType, 'night', rcRegime)
          dayCost += costForSplit(split, rcCost)
        }
      }

      // Allowances
      const rX = r as Resource & { allow_laha?: boolean; allow_meal?: boolean; allow_fsa?: boolean }
      const isTrades = rc.category === 'trades' || r.category === 'trades'
      if (isTrades) {
        if (rX.allow_laha !== false) dayCost += rc.laha_cost || 0
        if (rX.allow_meal !== false) dayCost += rc.meal_cost || 0
      } else {
        if (rX.allow_fsa !== false && rX.allow_laha !== false) dayCost += rc.fsa_cost || 0
      }

      resourceCost += dayCost
    }

    if (resourceCost === 0) continue
    lines.push({
      label: `${r.name} — ${r.role}`,
      type: 'labour',
      cost: resourceCost,
    })
  }

  const totalCost = lines.reduce((s, l) => s + l.cost, 0)
  return { lines, totalCost }
}
