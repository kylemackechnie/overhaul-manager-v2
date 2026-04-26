/**
 * Cost Engine — ported from Overhaul Manager v4.34
 * Pure functions, no UI dependencies, no Supabase calls.
 * All outputs verified to match the original HTML app.
 */

import type { RateCard, CrewMember, DayEntry, DayCostRow, PersonDay } from '../types'

// ─── Date utilities ───────────────────────────────────────────────────────────

export function localDateStr(d?: Date): string {
  const date = d || new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateLocal(s: string): Date {
  if (!s) return new Date()
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function daysBetween(start: string, end: string): number {
  const a = parseDateLocal(start)
  const b = parseDateLocal(end)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function fcDateRange(start: string, end: string): string[] {
  if (!start || !end || start > end) return []
  const days: string[] = []
  const cur = parseDateLocal(start)
  const last = parseDateLocal(end)
  while (cur <= last) {
    days.push(localDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export function fcWeekKey(dateStr: string): string {
  const d = parseDateLocal(dateStr)
  const dow = d.getDay()
  const toMon = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + toMon)
  return localDateStr(d)
}

// ─── Day type ────────────────────────────────────────────────────────────────

type DayType = 'weekday' | 'saturday' | 'sunday' | 'publicHoliday'

export function fcDayType(dateStr: string, publicHolidays: string[] = []): DayType {
  if (publicHolidays.includes(dateStr)) return 'publicHoliday'
  const dow = parseDateLocal(dateStr).getDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}

// ─── Split hours ─────────────────────────────────────────────────────────────
// Mirrors splitHours() from the HTML app exactly

export interface HourSplit {
  dnt: number; dt15: number; ddt: number; ddt15: number
  nnt: number; ndt: number; ndt15: number
}

export function splitHours(
  totalHrs: number,
  dayType: DayType,
  shiftType: 'day' | 'night',
  regime: 'lt12' | 'ge12',
  rcRegime?: unknown
): HourSplit {
  const split: HourSplit = { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }

  // Use regime-aware config if provided
  const cfg = rcRegime as Record<string, Record<string, number>> | null | undefined
  const regimeCfg = cfg?.[regime]

  if (shiftType === 'night') {
    if (dayType === 'weekday') {
      if (regimeCfg) {
        split.nnt = regimeCfg.nnt ?? totalHrs
        split.ndt = regimeCfg.ndt ?? 0
        split.ndt15 = regimeCfg.ndt15 ?? 0
      } else {
        split.nnt = regime === 'ge12' ? Math.min(totalHrs, 8) : totalHrs
        if (regime === 'ge12') split.ndt = Math.max(0, totalHrs - 8)
      }
    } else if (dayType === 'saturday' || dayType === 'publicHoliday') {
      split.ndt = totalHrs
    } else if (dayType === 'sunday') {
      split.ndt15 = totalHrs
    }
  } else {
    // day shift
    if (dayType === 'weekday') {
      if (regimeCfg) {
        split.dnt = regimeCfg.dnt ?? totalHrs
        split.dt15 = regimeCfg.dt15 ?? 0
        split.ddt = regimeCfg.ddt ?? 0
        split.ddt15 = regimeCfg.ddt15 ?? 0
      } else {
        split.dnt = regime === 'ge12' ? Math.min(totalHrs, 8) : totalHrs
        if (regime === 'ge12') split.dt15 = Math.max(0, totalHrs - 8)
      }
    } else if (dayType === 'saturday') {
      split.ddt = regime === 'ge12' ? Math.min(totalHrs, 8) : totalHrs
      if (regime === 'ge12') split.ddt15 = Math.max(0, totalHrs - 8)
    } else if (dayType === 'sunday' || dayType === 'publicHoliday') {
      split.ddt15 = totalHrs
    }
  }

  return split
}

// ─── Calc hours cost ─────────────────────────────────────────────────────────

export function calcHoursCost(
  split: HourSplit,
  rc: RateCard,
  mode: 'cost' | 'sell'
): number {
  const rates = mode === 'cost' ? rc.rates?.cost : rc.rates?.sell
  if (!rates) return 0
  const r = rates as Record<string, number>
  return (
    (split.dnt   * (r.dnt   || 0)) +
    (split.dt15  * (r.dt15  || 0)) +
    (split.ddt   * (r.ddt   || 0)) +
    (split.ddt15 * (r.ddt15 || 0)) +
    (split.nnt   * (r.nnt   || 0)) +
    (split.ndt   * (r.ndt   || 0)) +
    (split.ndt15 * (r.ndt15 || 0))
  )
}

// ─── Calc crew member total ───────────────────────────────────────────────────

export interface CrewMemberTotal {
  hours: number; cost: number; sell: number; allowances: number
}

export function calcCrewMemberTotal(
  member: CrewMember,
  regime: 'lt12' | 'ge12',
  rateCards: RateCard[],
  publicHolidays: string[] = []
): CrewMemberTotal {
  const rc = rateCards.find(c => c.role.toLowerCase() === member.role.toLowerCase())
  let hours = 0, cost = 0, sell = 0, allowances = 0

  for (const [date, day] of Object.entries(member.days as Record<string, DayEntry>)) {
    if (!day || !day.hours) continue
    const dayType = fcDayType(date, publicHolidays)
    const split = splitHours(day.hours, dayType, day.shiftType, regime, rc?.regime)
    hours += day.hours
    if (rc) {
      cost += calcHoursCost(split, rc, 'cost')
      sell += calcHoursCost(split, rc, 'sell')
      if (day.laha) {
        const isMgmt = rc.category === 'management' || rc.category === 'seag'
        if (isMgmt) { cost += rc.fsa_cost; sell += rc.fsa_sell; allowances += rc.fsa_sell }
        else { cost += rc.laha_cost; sell += rc.laha_sell; allowances += rc.laha_sell }
      }
      if (day.meal) { cost += rc.meal_cost; sell += rc.meal_sell; allowances += rc.meal_sell }
    }
  }

  return { hours, cost, sell, allowances }
}

// ─── Convert to base currency ─────────────────────────────────────────────────

export function convertToBase(
  amount: number,
  fromCode: string,
  currencies?: Array<{ code: string; rate: number }> | null,
  baseCurrency = 'AUD'
): number {
  if (!amount) return 0
  if (!fromCode || fromCode === baseCurrency) return amount
  const entry = (currencies || []).find(c => c.code === fromCode)
  // Note: never hardcode a fallback rate — if no rate configured, return 1:1
  // so the user is alerted by incorrect totals rather than silently wrong ones
  const rate = entry?.rate ?? 1
  return amount * rate
}

// ─── fcAggregate — the main forecast engine ──────────────────────────────────

import type {
  Resource, WeeklyTimesheet, HireItem, Car, Accommodation,
  Expense, GlobalTV, ToolingCosting, GlobalDepartment, BackOfficeHour, Project
} from '../types'

export interface FcAggregateResult {
  byDay: Record<string, DayCostRow>
  days: string[]
  accomWarnings: AccomWarning[]
}

export interface AccomWarning {
  property: string; room: string; person: string
  personStart: string; personEnd: string; bookStart: string; bookEnd: string
  outsideBefore: boolean; outsideAfter: boolean
}

export function ensureDay(byDay: Record<string, DayCostRow>, d: string): DayCostRow {
  if (!byDay[d]) {
    byDay[d] = {
      trades:    { cost: 0, sell: 0, headcount: 0, hours: 0 },
      mgmt:      { cost: 0, sell: 0, headcount: 0, hours: 0 },
      seag:      { cost: 0, sell: 0, headcount: 0, hours: 0 },
      dryHire:   { cost: 0, sell: 0 },
      wetHire:   { cost: 0, sell: 0 },
      localHire: { cost: 0, sell: 0 },
      tooling:   { cost: 0, sell: 0 },
      cars:      { cost: 0, sell: 0 },
      accom:     { cost: 0, sell: 0 },
      expenses:  { cost: 0, sell: 0 },
      people:    [],
    }
  }
  return byDay[d]
}

export interface FcAggregateInput {
  project: Project
  resources: Resource[]
  timesheets: WeeklyTimesheet[]
  backOfficeHours: BackOfficeHour[]
  hireItems: HireItem[]
  cars: Car[]
  accommodation: Accommodation[]
  expenses: Expense[]
  rateCards: RateCard[]
  globalTVs: GlobalTV[]
  globalDepartments: GlobalDepartment[]
  toolingCostings: ToolingCosting[]
  fcConfig?: Record<string, { on: boolean }>
}

function calcCustomerPrice(cost: number, gmPct: number): number {
  if (gmPct >= 100) return cost
  return cost / (1 - gmPct / 100)
}

function calcRentalCost(_tv: GlobalTV, costing: ToolingCosting, dept: GlobalDepartment) {
  const rates = dept.rates as Record<string, number>
  if (!rates) return null
  if (!costing.charge_start || !costing.charge_end) return null
  const days = daysBetween(costing.charge_start, costing.charge_end) + 1
  if (days <= 0) return null
  const costPerDay = rates.costPerDay || 0
  const sellPerDay = rates.sellPerDay || 0
  return {
    cost: costPerDay * days,
    sell: sellPerDay * days,
  }
}

export function fcAggregate(input: FcAggregateInput): FcAggregateResult {
  const {
    project, resources, backOfficeHours, hireItems, cars, accommodation,
    expenses, rateCards, globalTVs, globalDepartments, toolingCostings,
    fcConfig,
  } = input

  const byDay: Record<string, DayCostRow> = {}
  const accomWarnings: AccomWarning[] = []
  const publicHolidays = (project.public_holidays || []).map(h => h.date)
  const stdHours = project.std_hours || { day: {}, night: {} }
  const dowMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const cfg = fcConfig || {}

  const cfgOn = (key: string) => cfg[key]?.on !== false

  // ── LABOUR ──
  if (cfgOn('labour')) {
    resources.forEach(r => {
      if (!r.mob_in) return
      const rc = rateCards.find(c => c.role.toLowerCase() === r.role.toLowerCase())
      if (!rc) return
      const cat = rc.category
      const catKey = cat === 'management' ? 'mgmt' : cat === 'seag' ? 'seag' : 'trades'

      const days = fcDateRange(r.mob_in, r.mob_out || project.end_date || r.mob_in)
      days.forEach((d, _idx) => {
        const isMob = d === r.mob_in
        const isDemob = d === (r.mob_out || r.mob_in)
        const dow = dowMap[new Date(d).getDay()]
        const dayType = fcDayType(d, publicHolidays)

        let totalHrs = 0, labCost = 0, labSell = 0

        const personShift = r.shift || 'day'
        if (personShift === 'day' || personShift === 'both') {
          const dayHrs = (stdHours.day as Record<string, number>)[dow] ?? 0
          totalHrs += dayHrs
          if (dayHrs > 0) {
            const regime = dayHrs >= 12 ? 'ge12' : 'lt12'
            const split = splitHours(dayHrs, dayType, 'day', regime, rc.regime)
            labCost += calcHoursCost(split, rc, 'cost')
            labSell += calcHoursCost(split, rc, 'sell')
          }
        }
        if (personShift === 'night' || personShift === 'both') {
          const nightHrs = (stdHours.night as Record<string, number>)[dow] ?? 0
          totalHrs += nightHrs
          if (nightHrs > 0) {
            const regime = nightHrs >= 12 ? 'ge12' : 'lt12'
            const split = splitHours(nightHrs, dayType, 'night', regime, rc.regime)
            labCost += calcHoursCost(split, rc, 'cost')
            labSell += calcHoursCost(split, rc, 'sell')
          }
        }

        // Allowances
        if (cat === 'trades') {
          labSell += rc.laha_sell; labCost += rc.laha_cost
        } else {
          labCost += rc.fsa_cost; labSell += rc.fsa_sell
        }

        const day = ensureDay(byDay, d)
        const dk = day[catKey] as { cost: number; sell: number; headcount: number; hours: number }
        // SE AG rate cards store amounts in EUR — convert to base currency for totalling.
        // Allowances (FSA) are already in AUD regardless of category.
        let finalCost = labCost, finalSell = labSell
        if (catKey === 'seag') {
          const rcCurrency = (rc as typeof rc & { currency?: string }).currency || 'EUR'
          const fsaCost = rc.fsa_cost || 0; const fsaSell = rc.fsa_sell || 0
          const convertedCost = convertToBase(labCost - fsaCost, rcCurrency, project.currency_rates as {code:string;rate:number}[]|undefined) + fsaCost
          const convertedSell = convertToBase(labSell - fsaSell, rcCurrency, project.currency_rates as {code:string;rate:number}[]|undefined) + fsaSell
          finalCost = convertedCost; finalSell = convertedSell
        }
        dk.cost += finalCost; dk.sell += finalSell; dk.headcount += 1; dk.hours += totalHrs
        const person: PersonDay = { name: r.name, role: r.role || '', category: catKey, cost: finalCost, sell: finalSell, hours: totalHrs, isMob, isDemob }
        day.people.push(person)
      })
    })
  }

  // ── BACK OFFICE HOURS ──
  if (cfgOn('labour')) {
    backOfficeHours.forEach(e => {
      if (!e.date || !e.hours || !e.role) return
      const rc = rateCards.find(c => c.role.toLowerCase() === e.role.toLowerCase())
      if (!rc) return
      const cat = rc.category
      const catKey = cat === 'management' ? 'mgmt' : cat === 'seag' ? 'seag' : 'trades'
      const ntCost = (rc.rates?.cost as Record<string, number>)?.dnt || 0
      const ntSell = (rc.rates?.sell as Record<string, number>)?.dnt || 0
      const day = ensureDay(byDay, e.date)
      const dk = day[catKey] as { cost: number; sell: number; headcount: number; hours: number }
      dk.cost += e.hours * ntCost; dk.sell += e.hours * ntSell; dk.hours += e.hours
      day.people.push({ name: e.name || 'Back Office', role: e.role, category: catKey, cost: e.hours * ntCost, sell: e.hours * ntSell, hours: e.hours, isBackOffice: true })
    })
  }

  // ── EQUIPMENT HIRE ──
  function spreadHire(items: HireItem[], catKey: keyof DayCostRow, on: boolean) {
    if (!on) return
    items.forEach(item => {
      if (!item.start_date) return
      const days = fcDateRange(item.start_date, item.end_date || item.start_date)
      if (!days.length) return
      const totalCost = item.hire_cost || 0
      const totalSell = item.customer_total || calcCustomerPrice(totalCost, item.gm_pct ?? 0) || totalCost
      const perDay = totalCost / days.length
      const perDaySell = totalSell / days.length
      days.forEach(d => {
        const day = ensureDay(byDay, d)
        const dk = day[catKey] as { cost: number; sell: number }
        dk.cost += perDay; dk.sell += perDaySell
      })
    })
  }

  const dry   = hireItems.filter(h => h.hire_type === 'dry')
  const wet   = hireItems.filter(h => h.hire_type === 'wet')
  const local = hireItems.filter(h => h.hire_type === 'local')
  spreadHire(dry,   'dryHire',   cfgOn('dryHire'))
  spreadHire(wet,   'wetHire',   cfgOn('wetHire'))
  spreadHire(local, 'localHire', cfgOn('localHire'))

  // ── RENTAL TOOLING ──
  if (cfgOn('tooling')) {
    globalTVs.forEach(tv => {
      const costing = toolingCostings.find(c => c.tv_no === tv.tv_no)
      if (!costing || !costing.charge_start || !costing.charge_end) return
      const dept = tv.department_id ? globalDepartments.find(d => d.id === tv.department_id) : null
      if (!dept) return
      const calc = calcRentalCost(tv, costing, dept)
      if (!calc) return
      const days = fcDateRange(costing.charge_start, costing.charge_end)
      if (!days.length) return
      const perDay = calc.cost / days.length
      const perDaySell = calc.sell / days.length
      days.forEach(d => {
        const day = ensureDay(byDay, d)
        day.tooling.cost += perDay; day.tooling.sell += perDaySell
      })
    })
  }

  // ── CARS ──
  if (cfgOn('cars')) {
    cars.forEach(c => {
      const totalCost = c.total_cost || 0
      const totalSell = c.customer_total || calcCustomerPrice(totalCost, c.gm_pct ?? 0) || totalCost
      let spreadStart = c.start_date, spreadEnd = c.end_date || c.start_date
      if (c.person_id) {
        const person = resources.find(r => r.id === c.person_id)
        if (person?.mob_in) { spreadStart = person.mob_in; spreadEnd = person.mob_out || person.mob_in }
      }
      if (!spreadStart) return
      const days = fcDateRange(spreadStart, spreadEnd || spreadStart)
      if (!days.length) return
      const perDay = totalCost / days.length, perDaySell = totalSell / days.length
      days.forEach(d => { const day = ensureDay(byDay, d); day.cars.cost += perDay; day.cars.sell += perDaySell })
    })
  }

  // ── ACCOMMODATION ──
  if (cfgOn('accom')) {
    accommodation.forEach(a => {
      const totalCost = a.total_cost || 0
      const totalSell = a.customer_total || calcCustomerPrice(totalCost, a.gm_pct ?? 0) || totalCost
      const occupants = a.occupants || []
      let spreadStart = a.check_in, spreadEnd = a.check_out || a.check_in

      if (occupants.length) {
        const occResources = occupants.map(id => resources.find(r => r.id === id)).filter(Boolean) as Resource[]
        const withDates = occResources.filter(r => r.mob_in)
        if (withDates.length) {
          const mobIns  = withDates.map(r => r.mob_in!).sort()
          const mobOuts = withDates.map(r => r.mob_out || r.mob_in!).sort()
          spreadStart = mobIns[0]
          spreadEnd   = mobOuts[mobOuts.length - 1]
          if (a.check_in || a.check_out) {
            withDates.forEach(r => {
              const outsideBefore = !!(a.check_in && r.mob_in! < a.check_in)
              const outsideAfter  = !!(a.check_out && (r.mob_out || r.mob_in!) > a.check_out)
              if (outsideBefore || outsideAfter) {
                accomWarnings.push({ property: a.property || 'Unknown', room: a.room || '', person: r.name, personStart: r.mob_in!, personEnd: r.mob_out || r.mob_in!, bookStart: a.check_in || '', bookEnd: a.check_out || '', outsideBefore, outsideAfter })
              }
            })
          }
        }
      }

      if (!spreadStart) return
      const days = fcDateRange(spreadStart, spreadEnd || spreadStart)
      if (!days.length) return
      const perDay = totalCost / days.length, perDaySell = totalSell / days.length
      days.forEach(d => { const day = ensureDay(byDay, d); day.accom.cost += perDay; day.accom.sell += perDaySell })
    })
  }

  // ── EXPENSES ──
  if (cfgOn('expenses')) {
    expenses.forEach(e => {
      if (!e.date) return
      const cost = e.cost_ex_gst || 0
      const sell = e.sell_price || cost
      const day = ensureDay(byDay, e.date)
      day.expenses.cost += cost; day.expenses.sell += sell
    })
  }

  const days = Object.keys(byDay).sort()
  return { byDay, days, accomWarnings }
}

// ─── fcDayTotal ───────────────────────────────────────────────────────────────

export function fcDayTotal(row: DayCostRow, mode: 'cost' | 'sell'): number {
  const cats = ['trades', 'mgmt', 'seag', 'dryHire', 'wetHire', 'localHire', 'tooling', 'cars', 'accom', 'expenses'] as const
  return cats.reduce((s, c) => {
    const v = (row[c] as Record<string, number>)?.[mode] || 0
    return s + v
  }, 0)
}


// ─── NRG TCE Actuals Engine ───────────────────────────────────────────────────
// Mirrors the HTML app's nrgLineActual / nrgInvoiceActual / _nrgMatchAllocForLine.
// All functions are pure — no Supabase calls. Pass in pre-fetched data.

export interface NrgWoAlloc {
  wo: string
  tceItemId: string | null
  _tceMode?: boolean
  hours: number
  label?: string
}

export interface NrgTceLineMin {
  item_id: string | null
  source: string
  work_order: string
  line_type: string
}

export interface NrgTimesheetCrewDay {
  dayType: string
  shiftType: string
  hours: number
  nrgWoAllocations?: NrgWoAlloc[]
  // Allowance flags (same as DayEntry in full types)
  laha?: boolean
  meal?: boolean
  fsa?: boolean
  camp?: boolean
}

export interface NrgTimesheetCrew {
  personId: string
  name: string
  role: string
  mealBreakAdj?: boolean
  days: Record<string, NrgTimesheetCrewDay>
}

export interface NrgTimesheet {
  id: string
  week_start: string
  type: string
  status: string
  scope_tracking: string
  regime: string
  crew: NrgTimesheetCrew[]
}

export interface NrgInvoiceMin {
  tce_item_id: string | null
  amount: number
  status: string
}

export interface NrgExpenseMin {
  tce_item_id: string | null
  cost_ex_gst: number
  amount: number
}

export interface NrgVariationMin {
  status: string
  tce_link: string
  sell_total: number
}

/**
 * _nrgMatchAllocForLine — THE core matcher.
 * Resolution order (spec Part 6):
 * 1. tceItemId exact match — works for overheads and skilled-without-WO
 * 2. wo exact match with !tceItemId guard — covers TasTK imports AND _tceMode WO rows
 * The !tceItemId guard prevents double-counting alloc rows that have both fields.
 */
export function nrgMatchAllocForLine(
  allocs: NrgWoAlloc[],
  line: NrgTceLineMin
): NrgWoAlloc | null {
  // Pass 1: tceItemId exact match
  const byItemId = allocs.find(a => a.tceItemId && a.tceItemId === (line.item_id || ''))
  if (byItemId) return byItemId

  // Pass 2: wo exact match, but ONLY for allocs without tceItemId
  // The guard prevents double-counting rows that have both fields
  if (line.work_order) {
    const byWo = allocs.find(a => !a.tceItemId && a.wo === line.work_order)
    if (byWo) return byWo
  }

  return null
}

/**
 * nrgVariationActual — sum of approved variation sell totals for a TCE item_id.
 * Approved-only — draft/submitted/rejected are invisible to TCE register.
 */
export function nrgVariationActual(
  itemId: string | null,
  variations: NrgVariationMin[]
): number {
  if (!itemId) return 0
  return variations
    .filter(v => v.status === 'approved' && v.tce_link === itemId)
    .reduce((s, v) => s + (v.sell_total || 0), 0)
}

/**
 * nrgInvoiceActual — sum of supplier invoices + expenses + approved variations
 * for a given TCE item_id. This is the non-labour path.
 * NOTE: Do NOT also call nrgVariationActual() in render — it's already here.
 */
export function nrgInvoiceActual(
  itemId: string | null,
  invoices: NrgInvoiceMin[],
  expenses: NrgExpenseMin[],
  variations: NrgVariationMin[]
): number {
  if (!itemId) return 0

  const invTotal = invoices
    .filter(i => i.tce_item_id === itemId && i.status !== 'rejected')
    .reduce((s, i) => s + (i.amount || 0), 0)

  const expTotal = expenses
    .filter(e => e.tce_item_id === itemId)
    .reduce((s, e) => s + (e.cost_ex_gst || e.amount || 0), 0)

  const vnTotal = nrgVariationActual(itemId, variations)

  return invTotal + expTotal + vnTotal
}

/**
 * nrgLineActualHours — total actual hours allocated to a Labour TCE line.
 * Walks all approved timesheets, finds matching allocations using the matcher.
 */
export function nrgLineActualHours(
  line: NrgTceLineMin,
  timesheets: NrgTimesheet[]
): number {
  let total = 0
  for (const ts of timesheets) {
    if (ts.status !== 'approved') continue
    if (ts.scope_tracking !== 'tce' && ts.scope_tracking !== 'nrg_tce') continue
    for (const member of ts.crew) {
      for (const day of Object.values(member.days)) {
        if (!day.hours || day.hours <= 0) continue
        const allocs = day.nrgWoAllocations || []
        const match = nrgMatchAllocForLine(allocs, line)
        if (match) total += match.hours
      }
    }
  }
  return total
}

/**
 * nrgLineActual — total actual cost for a TCE line.
 * For Labour lines: walks approved timesheets + rate cards using splitHours+calcHoursCost
 * so overtime, night shift, Saturday etc. are correctly costed.
 * For non-Labour: delegates to nrgInvoiceActual.
 */
export function nrgLineActual(
  line: NrgTceLineMin,
  timesheets: NrgTimesheet[],
  invoices: NrgInvoiceMin[],
  expenses: NrgExpenseMin[],
  variations: NrgVariationMin[],
  getRateCardForRole: (role: string) => RateCard | null
): number {
  const isLabour = line.line_type === 'Labour' || line.source === 'skilled'

  if (!isLabour) {
    return nrgInvoiceActual(line.item_id, invoices, expenses, variations)
  }

  // Labour: sum cost from approved TCE-mode timesheets using proper rate splitting
  // Matches NrgInvoicingPanel.lineActualInPeriod — includes allowances + mealBreakAdj.
  let total = 0
  for (const ts of timesheets) {
    if (ts.status !== 'approved') continue
    if (ts.scope_tracking !== 'tce' && ts.scope_tracking !== 'nrg_tce') continue
    const pf = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }
    for (const member of ts.crew) {
      const rc = getRateCardForRole(member.role)
      const rcAny = rc as unknown as Record<string, unknown>
      const isMgmt = rcAny && (rcAny.category === 'management' || rcAny.category === 'seag')
      for (const [date, day] of Object.entries(member.days)) {
        if (!day.hours || day.hours <= 0) continue
        const allocs = day.nrgWoAllocations || []
        const match = nrgMatchAllocForLine(allocs, line)
        if (!match) continue
        if (!rc) continue

        // mealBreakAdj: +0.5h per worked day for trades/subcon (EBA)
        const adjH = (member.mealBreakAdj && match.hours > 0 && !isMgmt) ? 0.5 : 0
        const effH = match.hours + adjH

        // Hourly sell via proper rate split
        const dayType = fcDayType(date, [])
        const split = splitHours(effH, dayType, day.shiftType as 'day' | 'night', ts.regime as 'lt12' | 'ge12', rc.regime)
        total += calcHoursCost(split, rc, 'sell')

        // Allowances (sell) — must match invoicing panel logic exactly
        if (isMgmt) {
          if (day.fsa || day.camp)  total += pf(rcAny.fsa_sell)  || 0
          else if (day.laha)        total += pf(rcAny.fsa_sell)  || 0
        } else {
          if (day.laha) total += pf(rcAny.laha_sell) || 0
          if (day.meal) total += pf(rcAny.meal_sell) || 0
        }
      }
    }
  }

  // Also add any invoices/expenses directly tagged to this labour line
  total += nrgInvoiceActual(line.item_id, invoices, expenses, variations)

  return total
}
