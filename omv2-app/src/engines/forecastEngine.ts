import type { Resource, RateCard, BackOfficeHour, HireItem, Car, Accommodation, ToolingCosting, Expense } from '../types'

export interface DayBucket {
  trades:    { cost: number; sell: number; headcount: number; hours: number }
  mgmt:      { cost: number; sell: number; headcount: number; hours: number }
  seag:      { cost: number; sell: number; headcount: number; hours: number }
  dryHire:   { cost: number; sell: number }
  wetHire:   { cost: number; sell: number }
  localHire: { cost: number; sell: number }
  tooling:   { cost: number; sell: number }
  cars:      { cost: number; sell: number }
  accom:     { cost: number; sell: number }
  expenses:  { cost: number; sell: number }
}

export interface ForecastData {
  byDay: Record<string, DayBucket>
  days: string[]
  totalCost: number
  totalSell: number
  accomWarnings: { property: string; room: string; person: string; personStart: string; personEnd: string; bookStart: string; bookEnd: string; outsideBefore: boolean; outsideAfter: boolean }[]
}

// ---------- helpers ----------

const DOW = ['sun','mon','tue','wed','thu','fri','sat'] as const

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

function dayOfWeek(d: string): typeof DOW[number] {
  return DOW[new Date(d + 'T12:00:00').getDay()]
}

function emptyDay(): DayBucket {
  return {
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
  }
}

// Full 7-bucket split with regimeConfig — mirrors HTML splitHours() exactly
type FcHourSplit = Record<string, number>
type FcRegimeConfig = { wdNT?:number; wdT15?:number; satT15?:number; nightNT?:number; restNT?:number } | null | undefined

function splitHours(totalHrs: number, dayType: string, shiftType: 'day'|'night', regime: 'lt12'|'ge12', regimeConfig?: FcRegimeConfig): FcHourSplit {
  const zero: FcHourSplit = { dnt:0, dt15:0, ddt:0, ddt15:0, nnt:0, ndt:0, ndt15:0 }
  if (totalHrs <= 0) return { ...zero }
  const night = shiftType === 'night'
  const rc = regimeConfig || {}
  const WD_NT    = (rc as {wdNT?:number}).wdNT    ?? 7.2
  const WD_T15   = (rc as {wdT15?:number}).wdT15   ?? 3.3
  const SAT_T15  = (rc as {satT15?:number}).satT15  ?? 3
  const NIGHT_NT = (rc as {nightNT?:number}).nightNT ?? 7.2
  const REST_NT  = (rc as {restNT?:number}).restNT  ?? 7.2

  if (dayType === 'public_holiday') return night ? { ...zero, ndt15: totalHrs } : { ...zero, ddt15: totalHrs }
  if (dayType === 'rest')  return night ? { ...zero, nnt: REST_NT } : { ...zero, dnt: REST_NT }
  if (dayType === 'travel' || dayType === 'mob') return { ...zero, dnt: totalHrs }
  if (night) {
    if (dayType === 'saturday' || dayType === 'sunday') return { ...zero, ndt: totalHrs }
    return { ...zero, nnt: Math.min(totalHrs, NIGHT_NT), ndt: Math.max(0, totalHrs - NIGHT_NT) }
  }
  if (dayType === 'saturday') {
    if (regime === 'ge12') return { ...zero, ddt: totalHrs }
    return { ...zero, dt15: Math.min(totalHrs, SAT_T15), ddt: Math.max(0, totalHrs - SAT_T15) }
  }
  if (dayType === 'sunday') return { ...zero, ddt: totalHrs }
  if (regime === 'lt12') {
    const dnt  = Math.min(totalHrs, WD_NT)
    const dt15 = Math.min(Math.max(0, totalHrs - WD_NT), WD_T15)
    const ddt  = Math.max(0, totalHrs - WD_NT - WD_T15)
    return { ...zero, dnt, dt15, ddt }
  }
  return { ...zero, dnt: Math.min(totalHrs, WD_NT), ddt: Math.max(0, totalHrs - WD_NT) }
}

function getDayType(d: string, holidays: Set<string>): string {
  if (holidays.has(d)) return 'public_holiday'
  const dow = new Date(d + 'T12:00:00').getDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}

function calcGm(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return cost / (1 - gm / 100)
}

// ---------- main aggregate ----------

export function buildForecast(
  resources: Resource[],
  rateCards: RateCard[],
  backOffice: BackOfficeHour[],
  hireItems: HireItem[],
  cars: Car[],
  accom: Accommodation[],
  toolingCostings: ToolingCosting[],
  stdHours: { day: Record<string,number>; night: Record<string,number> },
  publicHolidays: { date: string }[],
  _projStart: string | null,
  projEnd: string | null,
  fxRates: { code: string; rate: number }[] = [],
  expenses: Expense[] = [],
  dailyExpenseEstimate: number = 0,
): ForecastData {

  const byDay: Record<string, DayBucket> = {}
  const holidays = new Set(publicHolidays.map(h => h.date))

  function ensure(d: string): DayBucket {
    if (!byDay[d]) byDay[d] = emptyDay()
    return byDay[d]
  }

  // Build rate card lookup by role
  const rcByRole: Record<string, RateCard> = {}
  for (const rc of rateCards) {
    rcByRole[rc.role.toLowerCase()] = rc
  }

  function getRC(role: string): RateCard | null {
    return rcByRole[role.toLowerCase()] || null
  }

  function costForSplit(split: Record<string, number>, rates: Record<string,number>): number {
    return Object.entries(split).reduce((s, [b, h]) => s + h * (rates[b] || 0), 0)
  }

  // ── Labour from resources ──
  for (const r of resources) {
    if (!r.mob_in) continue
    const rc = getRC(r.role)
    if (!rc) continue

    const cat = rc.category || r.category || 'trades'
    const catKey = cat === 'management' ? 'mgmt' : cat === 'seag' ? 'seag' : 'trades'
    const end = r.mob_out || projEnd || r.mob_in
    const days = dateRange(r.mob_in, end)

    for (const d of days) {
      const dow = dayOfWeek(d)
      const dayType = getDayType(d, holidays)
      const shift = r.shift || 'day'
      let labCost = 0, labSell = 0, hours = 0

      const rcCost = (rc.rates as { cost: Record<string,number> })?.cost || {}
      const rcSell = (rc.rates as { sell: Record<string,number> })?.sell || {}

      if (shift === 'day' || shift === 'both') {
        const h = stdHours.day?.[dow] ?? 0
        if (h > 0) {
          const regime: 'lt12'|'ge12' = h >= 12 ? 'ge12' : 'lt12'
          const rcRegime = (rc as RateCard & { regime?: FcRegimeConfig }).regime
          const split = splitHours(h, dayType, 'day', regime, rcRegime)
          labCost += costForSplit(split, rcCost)
          labSell += costForSplit(split, rcSell)
          hours += h
        }
      }
      if (shift === 'night' || shift === 'both') {
        const h = stdHours.night?.[dow] ?? 0
        if (h > 0) {
          const regime: 'lt12'|'ge12' = h >= 12 ? 'ge12' : 'lt12'
          const rcRegime2 = (rc as RateCard & { regime?: FcRegimeConfig }).regime
          const split = splitHours(h, dayType, 'night', regime, rcRegime2)
          labCost += costForSplit(split, rcCost)
          labSell += costForSplit(split, rcSell)
          hours += h
        }
      }

      // Allowances — only apply if resource has them enabled (mirrors HTML fcAggregate)
      const isTrades = catKey === 'trades'
      const rX = r as Resource & { allow_laha?: boolean; allow_meal?: boolean; allow_fsa?: boolean }
      if (isTrades) {
        if (rX.allow_laha !== false) { labCost += rc.laha_cost || 0; labSell += rc.laha_sell || 0 }
        if (rX.allow_meal !== false) { labCost += rc.meal_cost || 0; labSell += rc.meal_sell || 0 }
      } else {
        // mgmt/seag — FSA by default unless explicitly disabled
        if (rX.allow_fsa !== false && rX.allow_laha !== false) { labCost += rc.fsa_cost || 0; labSell += rc.fsa_sell || 0 }
      }

      if (labCost || labSell) {
        const day = ensure(d)
        // SE AG rate cards are in EUR — convert hourly amounts to base currency.
        // Allowances (FSA/camp) stay in AUD regardless.
        if (catKey === 'seag') {
          const rcCurrency = (rc as RateCard & { currency?: string }).currency || 'EUR'
          // For seag: hourly portion = total - allowance; convert hourly; re-add allowance
          const fsaCost = rc.fsa_cost || 0
          const fsaSell = rc.fsa_sell || 0
          const hourlyCost = labCost - fsaCost
          const hourlySell = labSell - fsaSell
          const convertedCost = toBase(hourlyCost, rcCurrency) + fsaCost
          const convertedSell = toBase(hourlySell, rcCurrency) + fsaSell
          day[catKey].cost += convertedCost
          day[catKey].sell += convertedSell
        } else {
          day[catKey].cost += labCost
          day[catKey].sell += labSell
        }
        day[catKey].headcount += 1
        day[catKey].hours += hours
      }
    }
  }

  // ── Back Office Hours ──
  for (const bo of backOffice) {
    if (!bo.date || !bo.hours) continue
    const day = ensure(bo.date)
    day.mgmt.cost += bo.cost || 0
    day.mgmt.sell += bo.sell || 0
    day.mgmt.hours += bo.hours
  }

  // FX conversion helper — converts amount to base currency
  function toBase(amount: number, currency?: string): number {
    if (!currency || !fxRates.length) return amount
    const rate = fxRates.find(r => r.code === currency)?.rate
    return rate ? amount * rate : amount
  }

  // ── Equipment Hire ──
  function spreadHire(items: HireItem[], catKey: 'dryHire'|'wetHire'|'localHire') {
    for (const item of items) {
      if (!item.start_date) continue
      const days = dateRange(item.start_date, item.end_date || item.start_date)
      if (!days.length) continue
      const totalCost = toBase(item.hire_cost || 0, (item as HireItem & {currency?:string}).currency)
      const totalSell = toBase(item.customer_total || calcGm(item.hire_cost || 0, item.gm_pct || 0), (item as HireItem & {currency?:string}).currency)
      const perDayCost = totalCost / days.length
      const perDaySell = totalSell / days.length
      for (const d of days) {
        const day = ensure(d)
        day[catKey].cost += perDayCost
        day[catKey].sell += perDaySell
      }
    }
  }

  spreadHire(hireItems.filter(h => h.hire_type === 'dry'), 'dryHire')
  spreadHire(hireItems.filter(h => h.hire_type === 'wet'), 'wetHire')
  spreadHire(hireItems.filter(h => h.hire_type === 'local'), 'localHire')

  // ── Cars — spread over assigned person's mob dates (HTML fcAggregate behaviour) ──
  for (const c of cars) {
    if (!c.start_date) continue
    const cX = c as Car & { person_id?: string }
    let spreadStart = c.start_date
    let spreadEnd   = c.end_date || c.start_date
    // If car is assigned to a person, use their mob dates
    if (cX.person_id) {
      const person = resources.find(r => r.id === cX.person_id)
      if (person?.mob_in) {
        spreadStart = person.mob_in
        spreadEnd   = (person as Resource & { mob_out?: string }).mob_out || person.mob_in
      }
    }
    const days = dateRange(spreadStart, spreadEnd)
    if (!days.length) continue
    const perDayCost = (c.total_cost || 0) / days.length
    const perDaySell = (c.customer_total || c.total_cost || 0) / days.length
    for (const d of days) {
      const day = ensure(d)
      day.cars.cost += perDayCost
      day.cars.sell += perDaySell
    }
  }

  const accomWarnings: ForecastData['accomWarnings'] = []

  // ── Accommodation — spread over occupant mob dates (HTML fcAggregate behaviour) ──
  for (const a of accom) {
    if (!a.check_in) continue
    const aX = a as Accommodation & { occupant_ids?: string[] }
    let spreadStart = a.check_in
    let spreadEnd   = a.check_out || a.check_in
    // If occupants assigned, spread over their mob date range
    if (aX.occupant_ids?.length) {
      const occupantResources = aX.occupant_ids
        .map(id => resources.find(r => r.id === id))
        .filter((r): r is Resource => !!r && !!r.mob_in)
      if (occupantResources.length) {
        const mobIns  = occupantResources.map(r => r.mob_in!).sort()
        const mobOuts = occupantResources.map(r => (r as Resource & {mob_out?:string}).mob_out || r.mob_in!).sort()
        spreadStart = mobIns[0]
        spreadEnd   = mobOuts[mobOuts.length - 1]
      }
    }
    const nights = dateRange(spreadStart, spreadEnd)
    if (!nights.length) continue
    const perNightCost = (a.total_cost || 0) / nights.length
    const perNightSell = (a.customer_total || a.total_cost || 0) / nights.length
    for (const d of nights) {
      const day = ensure(d)
      day.accom.cost += perNightCost
      day.accom.sell += perNightSell
    }

    // Flag occupants whose mob dates fall outside the booking window
    if (aX.occupant_ids?.length && (a.check_in || a.check_out)) {
      const occupantResources = aX.occupant_ids
        .map(id => resources.find(r => r.id === id))
        .filter((r): r is Resource => !!r && !!r.mob_in)
      for (const occ of occupantResources) {
        const personStart = occ.mob_in!
        const personEnd = (occ as Resource & {mob_out?:string}).mob_out || occ.mob_in!
        const bookStart = a.check_in || ''
        const bookEnd = a.check_out || ''
        const outsideBefore = !!bookStart && personStart < bookStart
        const outsideAfter  = !!bookEnd && personEnd > bookEnd
        if (outsideBefore || outsideAfter) {
          accomWarnings.push({
            property: (a as Accommodation & {property?:string}).property || 'Unknown',
            room: (a as Accommodation & {room?:string}).room || '',
            person: (occ as Resource & {name?:string}).name || '',
            personStart, personEnd, bookStart, bookEnd, outsideBefore, outsideAfter,
          })
        }
      }
    }
  }

  // ── Expenses — exact date entries + daily estimate fill for gaps ──
  for (const e of expenses) {
    const eDate = (e as Expense & {date?:string}).date
    if (!eDate) continue
    const day = ensure(eDate)
    const cost = (e as Expense & {cost_ex_gst?:number}).cost_ex_gst || e.amount || 0
    const sell = (e as Expense & {sell_price?:number}).sell_price || cost
    day.expenses.cost += cost
    day.expenses.sell += sell
  }
  // Fill gaps with daily estimate (HTML fcAggregate cfg.expenses.dailyEstimate)
  if (dailyExpenseEstimate > 0 && _projStart && projEnd) {
    for (const d of dateRange(_projStart, projEnd)) {
      const day = ensure(d)
      if (day.expenses.cost === 0) {
        day.expenses.cost += dailyExpenseEstimate
        day.expenses.sell += dailyExpenseEstimate
      }
    }
  }

  // ── Tooling — use project FX rate for EUR→base conversion ──
  const eurRate = fxRates.find(r => r.code === 'EUR')?.rate ?? 1.65 // fallback if no FX configured
  for (const tc of toolingCostings) {
    if (!tc.charge_start) continue
    const days = dateRange(tc.charge_start, tc.charge_end || tc.charge_start)
    if (!days.length) continue
    const totalCost = (tc.cost_eur || 0) * eurRate
    const totalSell = (tc.sell_eur || 0) * eurRate
    const perDayCost = totalCost / days.length
    const perDaySell = totalSell / days.length
    for (const d of days) {
      const day = ensure(d)
      day.tooling.cost += perDayCost
      day.tooling.sell += perDaySell
    }
  }

  const days = Object.keys(byDay).sort()
  let totalCost = 0, totalSell = 0
  for (const d of days) {
    const b = byDay[d]
    for (const cat of ['trades','mgmt','seag','dryHire','wetHire','localHire','tooling','cars','accom','expenses'] as const) {
      totalCost += b[cat].cost
      totalSell += b[cat].sell
    }
  }

  return { byDay, days, totalCost, totalSell, accomWarnings }
}

// Aggregate by week key (YYYY-WNN)
export function weekKey(d: string): string {
  const date = new Date(d + 'T12:00:00')
  const dow = date.getDay()
  const mon = new Date(date)
  mon.setDate(date.getDate() - (dow === 0 ? 6 : dow - 1))
  return mon.toISOString().slice(0, 10)
}

// Sum a DayBucket to a single cost/sell
export function bucketTotal(b: DayBucket): { cost: number; sell: number } {
  let cost = 0, sell = 0
  for (const cat of ['trades','mgmt','seag','dryHire','wetHire','localHire','tooling','cars','accom','expenses'] as const) {
    cost += b[cat].cost
    sell += b[cat].sell
  }
  return { cost, sell }
}

