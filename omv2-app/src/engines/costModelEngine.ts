import { fcDateRange, fcDayType, fcWeekKey, calcHoursCost } from './costEngine'
import type {
  RfqDocument, RfqResponse,
  RfqLabourRow, RfqResponseLabourRates,
  PublicHoliday,
} from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CostModelShiftPattern = 'weekday' | 'sevenDay'

export interface CostModelParams {
  startDate: string
  endDate: string
  pattern: CostModelShiftPattern
  headcountOverrides?: Record<number, number>
}

export interface PerWeekRoleBreakdown {
  weekKey: string
  cost: number
  days: number
  phDays: number
  equipCost: number
}

export interface PerVendorRoleResult {
  roleIndex: number
  roleName: string
  shiftType: string
  headcount: number
  totalCost: number
  shiftTotal: number
  lahaTotal: number
  perWeek: PerWeekRoleBreakdown[]
  // per-position shift cost by day type
  wdCost: number
  satCost: number
  sunCost: number
  phCost: number
  lahaPerDay: number
  // shift counts (per headcount position)
  wdShifts: number
  satShifts: number
  sunShifts: number
  totalShifts: number
  activePeriod: string
}

export interface PerVendorEquipResult {
  desc: string
  rate: number
  unit: 'day' | 'week' | 'lump'
  durationDays: number
  totalCost: number
  transportIn: number
  transportOut: number
}

export interface VendorWeekSummary {
  weekKey: string
  labourCost: number
  equipCost: number
  totalCost: number
  days: number
  phDays: number
}

export interface PerVendorResult {
  responseId: string
  vendor: string
  currency: string
  totalQuote: number | null
  labourCost: number
  equipCost: number
  projectedTotal: number
  shiftGrandTotal: number
  lahaGrandTotal: number
  roles: PerVendorRoleResult[]
  equip: PerVendorEquipResult[]
  weekSummaries: VendorWeekSummary[]
  variance: number | null
  variancePct: number | null
}

export interface CostModelResult {
  vendors: PerVendorResult[]
  weekKeys: string[]
  totalDays: number
  phCount: number
}

// ─── Working day enumeration ──────────────────────────────────────────────────

interface DayInfo {
  date: string
  dayType: 'weekday' | 'saturday' | 'sunday' | 'publicHoliday'
}

function enumerateWorkingDays(start: string, end: string, pattern: CostModelShiftPattern, phs: string[]): DayInfo[] {
  return fcDateRange(start, end)
    .map(d => ({ date: d, dayType: fcDayType(d, phs) }))
    .filter(d => {
      if (d.dayType === 'publicHoliday') return true
      if (pattern === 'sevenDay') return true
      return d.dayType === 'weekday'
    })
}

// ─── Shift cost (no LAHA) for one position on one day ────────────────────────

function shiftCostForDay(rates: RfqResponseLabourRates, shiftType: RfqLabourRow['shiftType'], dayType: DayInfo['dayType']): number {
  if (rates.rateMode === 'flat') {
    const ds = rates.flatDs || 0, ns = rates.flatNs || 0
    const isDual = shiftType === 'dual', isNS = shiftType === 'single-night'
    let d = 0, n = 0
    if (!isNS) d = ds
    if (isDual || isNS) n = ns
    if (isNS) d = 0
    return d + n
  }

  const dnt = rates.dnt || 0, dt15 = rates.dt15 || 0, ddt = rates.ddt || 0, ddt15 = rates.ddt15 || 0
  const nnt = rates.nnt || 0, ndt = rates.ndt || 0, ndt15 = rates.ndt15 || ddt15 || 0
  const ntHrs = rates.ntHrs ?? 7.2, ot1Hrs = rates.ot1Hrs ?? 2.8, shiftHrs = rates.shiftHrs ?? 10
  const satNtHrs = rates.satNtHrs ?? 0, satT15Hrs = rates.satT15Hrs ?? shiftHrs, satShiftHrs = rates.satShiftHrs ?? shiftHrs
  const sunT15Hrs = rates.sunT15Hrs ?? 0, sunShiftHrs = rates.sunShiftHrs ?? shiftHrs
  const nntHrs = rates.nntHrs ?? 7.2, nshiftHrs = rates.nshiftHrs ?? 10
  if (!dnt && !nnt && !ndt) return 0

  const dayRc  = { rates: { cost: { dnt, dt15, ddt, ddt15, nnt: 0, ndt: 0, ndt15: 0 } } }
  const nightRc = { rates: { cost: { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt, ndt, ndt15 } } }

  const calcDay = (hrs: number): number => {
    let split: Record<string, number>
    if (dayType === 'weekday') { const nt=Math.min(hrs,ntHrs),t15=Math.min(Math.max(0,hrs-ntHrs),ot1Hrs),dt=Math.max(0,hrs-ntHrs-ot1Hrs); split={dnt:nt,dt15:t15,ddt:dt,ddt15:0,nnt:0,ndt:0,ndt15:0} }
    else if (dayType === 'saturday') { const nt=Math.min(hrs,satNtHrs),t15=Math.min(Math.max(0,hrs-satNtHrs),satT15Hrs),dt=Math.max(0,hrs-satNtHrs-satT15Hrs); split={dnt:nt,dt15:t15,ddt:dt,ddt15:0,nnt:0,ndt:0,ndt15:0} }
    else if (dayType === 'sunday') { const t15=Math.min(hrs,sunT15Hrs),dt=Math.max(0,hrs-sunT15Hrs); split={dnt:0,dt15:t15,ddt:dt,ddt15:0,nnt:0,ndt:0,ndt15:0} }
    else split={dnt:0,dt15:0,ddt:0,ddt15:hrs,nnt:0,ndt:0,ndt15:0}
    return calcHoursCost(split as never, dayRc as never, 'cost')
  }

  const calcNight = (hrs: number): number => {
    if (!nnt && !ndt) return 0
    const split = dayType === 'publicHoliday'
      ? {dnt:0,dt15:0,ddt:0,ddt15:0,nnt:0,ndt:0,ndt15:hrs}
      : {dnt:0,dt15:0,ddt:0,ddt15:0,nnt:Math.min(hrs,nntHrs),ndt:Math.max(0,hrs-nntHrs),ndt15:0}
    return calcHoursCost(split as never, nightRc as never, 'cost')
  }

  const isDual = shiftType === 'dual', isNS = shiftType === 'single-night'
  let dayHrs = shiftHrs
  if (dayType === 'saturday') dayHrs = satShiftHrs
  else if (dayType === 'sunday' || dayType === 'publicHoliday') dayHrs = sunShiftHrs

  const dayCost = isNS ? 0 : calcDay(dayHrs)
  const nightCost = (isDual || isNS) ? calcNight(nshiftHrs) : 0
  return dayCost + nightCost
}

// LAHA crew multiplier (dual weekday = 2 crews, otherwise 1)
function lahaMul(shiftType: RfqLabourRow['shiftType'], dow: number): number {
  if (shiftType !== 'dual') return 1
  return (dow !== 0 && dow !== 6) ? 2 : 1
}

// ─── Shift counts within a date range ────────────────────────────────────────

function countShifts(fromStr: string, toStr: string, shiftType: RfqLabourRow['shiftType'], phSet: Set<string>, pattern: CostModelShiftPattern) {
  let wd = 0, sat = 0, sun = 0
  const isDual = shiftType === 'dual', isNS = shiftType === 'single-night'
  const hasDay = !isNS, hasNight = isDual || isNS
  for (const d of fcDateRange(fromStr, toStr)) {
    if (phSet.has(d)) continue
    const dow = new Date(d + 'T00:00:00').getDay()
    const isSat = dow === 6, isSun = dow === 0
    if (pattern === 'weekday' && (isSat || isSun)) continue
    const n = (hasDay ? 1 : 0) + (hasNight ? 1 : 0)
    if (!isSat && !isSun) wd += n
    else if (isSat) sat += n
    else sun += n
  }
  return { wdShifts: wd, satShifts: sat, sunShifts: sun }
}

// ─── Equip cost ───────────────────────────────────────────────────────────────

function equipCostForVendor(doc: RfqDocument, response: RfqResponse, modelStart: string, modelEnd: string): PerVendorEquipResult[] {
  return (doc.equip_rows || []).map(eRow => {
    const matched = (response.equip || []).find(e => e.desc === eRow.desc)
    if (!matched) return { desc: eRow.desc, rate: 0, unit: 'day' as const, durationDays: 0, totalCost: 0, transportIn: 0, transportOut: 0 }
    let days = 0
    if (eRow.durMode === 'dates' && eRow.dateStart && eRow.dateEnd) days = fcDateRange(eRow.dateStart, eRow.dateEnd).length
    else if (eRow.durMode === 'qty' && eRow.dur) days = eRow.unit === 'weeks' ? eRow.dur * 7 : eRow.dur
    else days = fcDateRange(modelStart, modelEnd).length
    const rate = matched.rate || 0, tIn = matched.transportIn || 0, tOut = matched.transportOut || 0
    let totalCost = tIn + tOut
    if (matched.unit === 'day') totalCost += rate * days
    else if (matched.unit === 'week') totalCost += rate * Math.ceil(days / 7)
    else totalCost += rate
    return { desc: eRow.desc, rate, unit: matched.unit, durationDays: days, totalCost, transportIn: tIn, transportOut: tOut }
  })
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function computeCostModel(doc: RfqDocument, responses: RfqResponse[], params: CostModelParams, publicHolidays: PublicHoliday[]): CostModelResult {
  const phStrings = (publicHolidays || []).map(h => h.date)
  const phSet = new Set(phStrings)
  const allWorkingDays = enumerateWorkingDays(params.startDate, params.endDate, params.pattern, phStrings)
  const labourRows = doc.labour_rows || []

  // Role working day windows
  const roleDayWindows: DayInfo[][] = labourRows.map(lr => {
    if (lr.durMode === 'dates' && lr.dateStart && lr.dateEnd) {
      const s = lr.dateStart > params.startDate ? lr.dateStart : params.startDate
      const e = lr.dateEnd < params.endDate ? lr.dateEnd : params.endDate
      return enumerateWorkingDays(s, e, params.pattern, phStrings)
    }
    return allWorkingDays
  })

  // Role calendar windows for LAHA
  const roleCalWindows: string[][] = labourRows.map(lr => {
    if (lr.durMode === 'dates' && lr.dateStart && lr.dateEnd) {
      const s = lr.dateStart > params.startDate ? lr.dateStart : params.startDate
      const e = lr.dateEnd < params.endDate ? lr.dateEnd : params.endDate
      return fcDateRange(s, e)
    }
    return fcDateRange(params.startDate, params.endDate)
  })

  // Canonical week keys from all working days
  const weekKeysSet = new Set<string>()
  for (const d of allWorkingDays) weekKeysSet.add(fcWeekKey(d.date))
  const weekKeys = Array.from(weekKeysSet).sort()

  const vendors: PerVendorResult[] = responses.map(resp => {
    const roles: PerVendorRoleResult[] = labourRows.map((lr, ri) => {
      const headcount = params.headcountOverrides?.[ri] ?? lr.qty ?? 1
      const respLabour = (resp.labour || []).find(l => l.role === lr.role)
      const workDays = roleDayWindows[ri]
      const calDays = roleCalWindows[ri]

      const fmtD = (s: string | null) => s ? s.split('-').reverse().join('/') : '?'
      const activePeriod = (lr.durMode === 'dates' && lr.dateStart)
        ? `${fmtD(lr.dateStart)}–${fmtD(lr.dateEnd)}` : 'Full range'

      const roleFrom = (lr.durMode === 'dates' && lr.dateStart && lr.dateStart > params.startDate) ? lr.dateStart : params.startDate
      const roleTo   = (lr.durMode === 'dates' && lr.dateEnd && lr.dateEnd < params.endDate) ? lr.dateEnd : params.endDate
      const { wdShifts, satShifts, sunShifts } = countShifts(roleFrom, roleTo, lr.shiftType, phSet, params.pattern)
      const totalShifts = (wdShifts + satShifts + sunShifts) * headcount

      if (!respLabour) {
        return { roleIndex: ri, roleName: lr.role, shiftType: lr.shiftType, headcount, totalCost: 0, shiftTotal: 0, lahaTotal: 0, perWeek: weekKeys.map(wk => ({ weekKey: wk, cost: 0, days: 0, phDays: 0, equipCost: 0 })), wdCost: 0, satCost: 0, sunCost: 0, phCost: 0, lahaPerDay: 0, wdShifts, satShifts, sunShifts, totalShifts, activePeriod }
      }

      const rates = respLabour.rates
      const lahaPerDay = rates.laha || 0
      const wdCost  = shiftCostForDay(rates, lr.shiftType, 'weekday')
      const satCost = shiftCostForDay(rates, lr.shiftType, 'saturday')
      const sunCost = shiftCostForDay(rates, lr.shiftType, 'sunday')
      const phCost  = shiftCostForDay(rates, lr.shiftType, 'publicHoliday')

      // Shift cost by week
      const byWeekShift: Record<string, number> = {}
      const byWeekDays: Record<string, number> = {}
      const byWeekPH: Record<string, number> = {}
      let shiftTotal = 0
      for (const d of workDays) {
        const cost = shiftCostForDay(rates, lr.shiftType, d.dayType) * headcount
        shiftTotal += cost
        const wk = fcWeekKey(d.date)
        byWeekShift[wk] = (byWeekShift[wk] || 0) + cost
        byWeekDays[wk] = (byWeekDays[wk] || 0) + 1
        if (d.dayType === 'publicHoliday') byWeekPH[wk] = (byWeekPH[wk] || 0) + 1
      }

      // LAHA cost by week (calendar days)
      const byWeekLaha: Record<string, number> = {}
      let lahaTotal = 0
      for (const d of calDays) {
        const dow = new Date(d + 'T00:00:00').getDay()
        const cost = lahaPerDay * lahaMul(lr.shiftType, dow) * headcount
        lahaTotal += cost
        const wk = fcWeekKey(d)
        byWeekLaha[wk] = (byWeekLaha[wk] || 0) + cost
      }

      const perWeek: PerWeekRoleBreakdown[] = weekKeys.map(wk => ({
        weekKey: wk,
        cost: (byWeekShift[wk] || 0) + (byWeekLaha[wk] || 0),
        days: byWeekDays[wk] || 0,
        phDays: byWeekPH[wk] || 0,
        equipCost: 0,
      }))

      return { roleIndex: ri, roleName: lr.role, shiftType: lr.shiftType, headcount, totalCost: shiftTotal + lahaTotal, shiftTotal, lahaTotal, perWeek, wdCost, satCost, sunCost, phCost, lahaPerDay, wdShifts, satShifts, sunShifts, totalShifts, activePeriod }
    })

    const labourCost = roles.reduce((s, r) => s + r.totalCost, 0)
    const shiftGrandTotal = roles.reduce((s, r) => s + r.shiftTotal, 0)
    const lahaGrandTotal  = roles.reduce((s, r) => s + r.lahaTotal, 0)
    const equip = equipCostForVendor(doc, resp, params.startDate, params.endDate)
    const equipCost = equip.reduce((s, e) => s + e.totalCost, 0)
    const projectedTotal = labourCost + equipCost
    const equipPerWeek = weekKeys.length > 0 ? equipCost / weekKeys.length : 0

    // Weekly summaries
    const weekLabour: Record<string, number> = {}
    const weekDays: Record<string, number> = {}
    const weekPH: Record<string, number> = {}
    for (const role of roles) {
      for (const pw of role.perWeek) {
        weekLabour[pw.weekKey] = (weekLabour[pw.weekKey] || 0) + pw.cost
        weekDays[pw.weekKey] = Math.max(weekDays[pw.weekKey] || 0, pw.days)
        weekPH[pw.weekKey] = Math.max(weekPH[pw.weekKey] || 0, pw.phDays)
      }
    }
    const weekSummaries: VendorWeekSummary[] = weekKeys.map(wk => ({
      weekKey: wk, labourCost: weekLabour[wk] || 0, equipCost: equipPerWeek,
      totalCost: (weekLabour[wk] || 0) + equipPerWeek, days: weekDays[wk] || 0, phDays: weekPH[wk] || 0,
    }))

    const variance = resp.total_quote != null ? projectedTotal - resp.total_quote : null
    const variancePct = (variance != null && resp.total_quote && resp.total_quote > 0) ? (variance / resp.total_quote) * 100 : null

    return { responseId: resp.id, vendor: resp.vendor, currency: resp.currency || 'AUD', totalQuote: resp.total_quote, labourCost, equipCost, projectedTotal, shiftGrandTotal, lahaGrandTotal, roles, equip, weekSummaries, variance, variancePct }
  })

  vendors.sort((a, b) => {
    if (a.projectedTotal === 0 && b.projectedTotal > 0) return 1
    if (b.projectedTotal === 0 && a.projectedTotal > 0) return -1
    return a.projectedTotal - b.projectedTotal
  })

  const phCount = allWorkingDays.filter(d => d.dayType === 'publicHoliday').length
  return { vendors, weekKeys, totalDays: allWorkingDays.length, phCount }
}
