import { fcDateRange, fcDayType, fcWeekKey, calcHoursCost } from './costEngine'
import type {
  RfqDocument, RfqResponse,
  RfqLabourRow, RfqResponseLabour, RfqResponseLabourRates,
  PublicHoliday,
} from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CostModelShiftPattern = 'weekday' | 'sevenDay'

export interface CostModelParams {
  startDate: string
  endDate: string
  pattern: CostModelShiftPattern
  // Override headcount per role index (matches doc.labour_rows order). Defaults to qty on the row.
  headcountOverrides?: Record<number, number>
}

export interface PerWeekRoleBreakdown {
  weekKey: string         // ISO Monday YYYY-MM-DD
  cost: number
}

export interface PerVendorRoleResult {
  roleIndex: number
  roleName: string
  headcount: number
  totalCost: number       // total over the period for this role × headcount
  perWeek: PerWeekRoleBreakdown[]
}

export interface PerVendorEquipResult {
  desc: string
  rate: number
  unit: 'day' | 'week' | 'lump'
  durationDays: number    // computed from doc equip row
  totalCost: number       // rate × periods + transport
  transportIn: number
  transportOut: number
}

export interface PerVendorResult {
  responseId: string
  vendor: string
  currency: string
  totalQuote: number | null
  // Computed projection
  labourCost: number
  equipCost: number
  projectedTotal: number
  // Detailed breakdowns
  roles: PerVendorRoleResult[]
  equip: PerVendorEquipResult[]
  // Variance vs total_quote (positive = projection higher than quoted)
  variance: number | null
  variancePct: number | null
}

export interface CostModelResult {
  vendors: PerVendorResult[]      // sorted by projectedTotal asc (best first)
  weekKeys: string[]              // sorted ascending
  totalDays: number
}

// ─── Working day enumeration ──────────────────────────────────────────────────

interface DayInfo {
  date: string
  dayType: 'weekday' | 'saturday' | 'sunday' | 'publicHoliday'
}

function enumerateWorkingDays(
  start: string,
  end: string,
  pattern: CostModelShiftPattern,
  publicHolidays: string[],
): DayInfo[] {
  const allDays = fcDateRange(start, end)
  return allDays
    .map(d => ({ date: d, dayType: fcDayType(d, publicHolidays) }))
    .filter(d => {
      if (d.dayType === 'publicHoliday') return true // always cost PHs
      if (pattern === 'sevenDay') return true
      // weekday pattern: Mon-Fri only
      return d.dayType === 'weekday'
    })
}

// ─── Per-role per-day labour cost (mirrors HTML rrPreviewShift logic) ─────────
// Uses the cost engine's calcHoursCost to compute weekday/sat/sun/PH costs
// for one role on one day for one vendor, given their schedule rates and shift type.

function dayCostForRole(
  rates: RfqResponseLabourRates,
  shiftType: RfqLabourRow['shiftType'],
  dayType: DayInfo['dayType'],
): number {
  // Flat rate mode: simple lookup
  if (rates.rateMode === 'flat') {
    const ds = rates.flatDs || 0
    const ns = rates.flatNs || 0
    const laha = rates.laha || 0
    const isDual = shiftType === 'dual'
    const isNightOnly = shiftType === 'single-night'
    let dayCost = 0, nightCost = 0
    if (!isNightOnly && (dayType === 'weekday' || dayType === 'saturday')) dayCost = ds
    if (isDual && (dayType === 'weekday' || dayType === 'saturday')) nightCost = ns
    if (!isNightOnly && (dayType === 'sunday' || dayType === 'publicHoliday')) dayCost = ds
    if ((isDual || isNightOnly) && (dayType === 'sunday' || dayType === 'publicHoliday')) nightCost = ns
    if (isNightOnly) { nightCost = ns; dayCost = 0 }
    const lahaMul = (dayCost > 0 ? 1 : 0) + (nightCost > 0 ? 1 : 0)
    return dayCost + nightCost + (laha * lahaMul)
  }

  // Hourly mode — full NT/T1.5/DT/Sat/Sun/PH math
  const dnt = rates.dnt || 0, dt15 = rates.dt15 || 0, ddt = rates.ddt || 0, ddt15 = rates.ddt15 || 0
  const nnt = rates.nnt || 0, ndt = rates.ndt || 0, ndt15 = rates.ndt15 || ddt15 || 0
  const laha = rates.laha || 0
  const ntHrs = rates.ntHrs ?? 7.2
  const ot1Hrs = rates.ot1Hrs ?? 2.8
  const shiftHrs = rates.shiftHrs ?? 10
  const satNtHrs = rates.satNtHrs ?? 0
  const satT15Hrs = rates.satT15Hrs ?? shiftHrs
  const satShiftHrs = rates.satShiftHrs ?? shiftHrs
  const sunT15Hrs = rates.sunT15Hrs ?? 0
  const sunShiftHrs = rates.sunShiftHrs ?? shiftHrs
  const nntHrs = rates.nntHrs ?? 7.2
  const nshiftHrs = rates.nshiftHrs ?? 10

  if (!dnt && !nnt && !ndt) return 0

  const dayRc = { rates: { cost: { dnt, dt15, ddt, ddt15, nnt: 0, ndt: 0, ndt15: 0 } } }
  const nightRc = { rates: { cost: { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt, ndt, ndt15 } } }

  const calcDay = (dt: DayInfo['dayType'], hrs: number): number => {
    let split: Record<string, number>
    if (dt === 'weekday') {
      const nt = Math.min(hrs, ntHrs)
      const t15 = Math.min(Math.max(0, hrs - ntHrs), ot1Hrs)
      const dtH = Math.max(0, hrs - ntHrs - ot1Hrs)
      split = { dnt: nt, dt15: t15, ddt: dtH, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
    } else if (dt === 'saturday') {
      const nt = Math.min(hrs, satNtHrs)
      const t15 = Math.min(Math.max(0, hrs - satNtHrs), satT15Hrs)
      const dtH = Math.max(0, hrs - satNtHrs - satT15Hrs)
      split = { dnt: nt, dt15: t15, ddt: dtH, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
    } else if (dt === 'sunday') {
      const t15 = Math.min(hrs, sunT15Hrs)
      const dtH = Math.max(0, hrs - sunT15Hrs)
      split = { dnt: 0, dt15: t15, ddt: dtH, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
    } else {
      split = { dnt: 0, dt15: 0, ddt: 0, ddt15: hrs, nnt: 0, ndt: 0, ndt15: 0 }
    }
    return calcHoursCost(split as never, dayRc as never, 'cost')
  }

  const calcNight = (dt: DayInfo['dayType'], hrs: number): number => {
    if (!nnt && !ndt) return 0
    let split: Record<string, number>
    if (dt === 'publicHoliday') {
      split = { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt: 0, ndt: 0, ndt15: hrs }
    } else {
      const nt = Math.min(hrs, nntHrs)
      const dtH = Math.max(0, hrs - nntHrs)
      split = { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt: nt, ndt: dtH, ndt15: 0 }
    }
    return calcHoursCost(split as never, nightRc as never, 'cost')
  }

  const isDual = shiftType === 'dual'
  const isNightOnly = shiftType === 'single-night'

  let dayHrs = shiftHrs
  if (dayType === 'saturday') dayHrs = satShiftHrs
  else if (dayType === 'sunday' || dayType === 'publicHoliday') dayHrs = sunShiftHrs

  const dayCost = isNightOnly ? 0 : calcDay(dayType, dayHrs)
  const nightCost = (isDual || isNightOnly) ? calcNight(dayType, nshiftHrs) : 0
  const lahaMul = (dayCost > 0 ? 1 : 0) + (nightCost > 0 ? 1 : 0)
  return dayCost + nightCost + (laha * lahaMul)
}

// ─── Equip cost ───────────────────────────────────────────────────────────────

function equipCostForVendor(
  doc: RfqDocument,
  response: RfqResponse,
  modelStart: string,
  modelEnd: string,
): PerVendorEquipResult[] {
  const out: PerVendorEquipResult[] = []
  for (const eRow of (doc.equip_rows || [])) {
    const matched = (response.equip || []).find(e => e.desc === eRow.desc)
    if (!matched) {
      out.push({
        desc: eRow.desc, rate: 0, unit: 'day', durationDays: 0,
        totalCost: 0, transportIn: 0, transportOut: 0,
      })
      continue
    }
    // Determine duration days
    let days = 0
    if (eRow.durMode === 'dates' && eRow.dateStart && eRow.dateEnd) {
      days = fcDateRange(eRow.dateStart, eRow.dateEnd).length
    } else if (eRow.durMode === 'qty' && eRow.dur) {
      // Convert qty to days based on unit
      if (eRow.unit === 'days') days = eRow.dur
      else if (eRow.unit === 'weeks') days = eRow.dur * 7
      else days = 0 // 'lump' has no day basis
    } else {
      // Fallback: full model period
      days = fcDateRange(modelStart, modelEnd).length
    }

    const rate = matched.rate || 0
    const tIn = matched.transportIn || 0
    const tOut = matched.transportOut || 0
    let totalCost = tIn + tOut
    if (matched.unit === 'day') totalCost += rate * days
    else if (matched.unit === 'week') totalCost += rate * Math.ceil(days / 7)
    else /* lump */ totalCost += rate

    out.push({
      desc: eRow.desc, rate, unit: matched.unit, durationDays: days,
      totalCost, transportIn: tIn, transportOut: tOut,
    })
  }
  return out
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function computeCostModel(
  doc: RfqDocument,
  responses: RfqResponse[],
  params: CostModelParams,
  publicHolidays: PublicHoliday[],
): CostModelResult {
  const phStrings = (publicHolidays || []).map(h => h.date)
  const allWorkingDays = enumerateWorkingDays(params.startDate, params.endDate, params.pattern, phStrings)
  const labourRows = doc.labour_rows || []

  // Per-role working day windows: each role can have its own date window via durMode='dates'
  const roleDayWindows: DayInfo[][] = labourRows.map(lr => {
    if (lr.durMode === 'dates' && lr.dateStart && lr.dateEnd) {
      // Restrict to role's window AND respect the model start/end
      const roleStart = lr.dateStart > params.startDate ? lr.dateStart : params.startDate
      const roleEnd = lr.dateEnd < params.endDate ? lr.dateEnd : params.endDate
      return enumerateWorkingDays(roleStart, roleEnd, params.pattern, phStrings)
    }
    return allWorkingDays
  })

  // For each vendor response, compute projection
  const vendors: PerVendorResult[] = responses.map(resp => {
    const roles: PerVendorRoleResult[] = labourRows.map((lr, ri) => {
      const headcount = params.headcountOverrides?.[ri] ?? lr.qty ?? 1
      const respLabour: RfqResponseLabour | undefined = (resp.labour || []).find(l => l.role === lr.role)
      const days = roleDayWindows[ri]

      if (!respLabour || !days.length) {
        return { roleIndex: ri, roleName: lr.role, headcount, totalCost: 0, perWeek: [] }
      }

      // Group by week
      const byWeek: Record<string, number> = {}
      let total = 0
      for (const d of days) {
        const cost = dayCostForRole(respLabour.rates, lr.shiftType, d.dayType)
        const lineCost = cost * headcount
        total += lineCost
        const wk = fcWeekKey(d.date)
        byWeek[wk] = (byWeek[wk] || 0) + lineCost
      }
      const perWeek: PerWeekRoleBreakdown[] = Object.keys(byWeek).sort().map(wk => ({ weekKey: wk, cost: byWeek[wk] }))
      return { roleIndex: ri, roleName: lr.role, headcount, totalCost: total, perWeek }
    })

    const labourCost = roles.reduce((s, r) => s + r.totalCost, 0)
    const equip = equipCostForVendor(doc, resp, params.startDate, params.endDate)
    const equipCost = equip.reduce((s, e) => s + e.totalCost, 0)
    const projectedTotal = labourCost + equipCost
    const variance = resp.total_quote != null ? projectedTotal - resp.total_quote : null
    const variancePct = (variance != null && resp.total_quote && resp.total_quote > 0)
      ? (variance / resp.total_quote) * 100
      : null

    return {
      responseId: resp.id,
      vendor: resp.vendor,
      currency: resp.currency || 'AUD',
      totalQuote: resp.total_quote,
      labourCost, equipCost, projectedTotal,
      roles, equip,
      variance, variancePct,
    }
  })

  // Sort cheapest first
  vendors.sort((a, b) => a.projectedTotal - b.projectedTotal)

  // Collect all week keys in order across all vendors
  const allWeekKeys = new Set<string>()
  for (const v of vendors) {
    for (const r of v.roles) {
      for (const w of r.perWeek) allWeekKeys.add(w.weekKey)
    }
  }
  const weekKeys = Array.from(allWeekKeys).sort()

  return { vendors, weekKeys, totalDays: allWorkingDays.length }
}
