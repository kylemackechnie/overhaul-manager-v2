import type { Resource, RateCard, BackOfficeHour, HireItem, Car, Accommodation, ToolingCosting, Expense, GlobalTV, GlobalDepartment, PurchaseOrder, Invoice } from '../types'
import { calcRentalCost } from '../lib/calculations'
import { resolveShift } from '../lib/shiftPhases'

export interface PoBucketPerson {
  resourceId: string
  name: string
  role: string
  mobIn: string
  mobOut: string
  totalCost: number
  totalHours: number
}

export interface PoBucket {
  labour:    { cost: number; hours: number; people: PoBucketPerson[] }
  dryHire:   { cost: number; items: string[] }  // item names
  wetHire:   { cost: number; items: string[] }
  localHire: { cost: number; items: string[] }
  cars:      { cost: number }
  accom:     { cost: number }
  total:     number
}

export interface DayPerson {
  name: string
  role: string
  category: 'trades' | 'mgmt' | 'seag' | 'subcon'
  cost: number
  sell: number
  hours: number
  isMob?: boolean
  isDemob?: boolean
  isBackOffice?: boolean
}

export interface DayBucket {
  trades:    { cost: number; sell: number; headcount: number; hours: number }
  mgmt:      { cost: number; sell: number; headcount: number; hours: number }
  seag:      { cost: number; sell: number; headcount: number; hours: number }
  subcon:    { cost: number; sell: number; headcount: number; hours: number }
  dryHire:   { cost: number; sell: number }
  wetHire:   { cost: number; sell: number }
  localHire: { cost: number; sell: number }
  tooling:   { cost: number; sell: number }
  cars:      { cost: number; sell: number }
  accom:     { cost: number; sell: number }
  expenses:  { cost: number; sell: number }
  people:    DayPerson[]
}

export interface ForecastData {
  byDay: Record<string, DayBucket>
  byPo:  Record<string, PoBucket>   // keyed by po_id; 'unlinked' for anything with no PO
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
    subcon:    { cost: 0, sell: 0, headcount: 0, hours: 0 },
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

// Full 7-bucket split with regime detection — mirrors HTML splitHours exactly.
//
// HTML passes a computed regime flag ('lt12' | 'ge12') derived from whether
// the shift hours >= 12. This drives two distinct Saturday and weekday paths:
//   • ge12 Saturday → all DT (no T1.5 band)
//   • lt12 Saturday → T1.5 up to satT15 threshold, then DT
//   • ge12 Weekday  → NT up to wdNT, then DT (T1.5 skipped)
//   • lt12 Weekday  → NT → T1.5 → DT
//
// V2 previously dropped the regime param and always applied the T1.5 band,
// causing ~5% underestimate on 12hr Saturday shifts (~$45/person/day).
// Fixed by deriving regime from totalHrs >= 12, matching the HTML exactly.

type FcHourSplit = Record<string, number>
type FcRegimeConfig = { wdNT?:number; wdT15?:number; satT15?:number; nightNT?:number; restNT?:number } | null | undefined

function splitHours(totalHrs: number, dayType: string, shiftType: 'day'|'night', regimeConfig?: FcRegimeConfig): FcHourSplit {
  const zero: FcHourSplit = { dnt:0, dt15:0, ddt:0, ddt15:0, nnt:0, ndt:0, ndt15:0 }
  if (totalHrs <= 0) return { ...zero }
  const night = shiftType === 'night'
  const rc = regimeConfig || {}
  const WD_NT    = (rc as {wdNT?:number}).wdNT    ?? 7.2
  const WD_T15   = (rc as {wdT15?:number}).wdT15   ?? 3.3
  const SAT_T15  = (rc as {satT15?:number}).satT15  ?? 3
  const NIGHT_NT = (rc as {nightNT?:number}).nightNT ?? 7.2
  const REST_NT  = (rc as {restNT?:number}).restNT  ?? 7.2

  // Derive regime from hours — matches HTML: const regime = hours >= 12 ? 'ge12' : 'lt12'
  const ge12 = totalHrs >= 12

  if (dayType === 'public_holiday') return night ? { ...zero, ndt15: totalHrs } : { ...zero, ddt15: totalHrs }
  if (dayType === 'rest')  return night ? { ...zero, nnt: REST_NT } : { ...zero, dnt: REST_NT }
  if (dayType === 'travel' || dayType === 'mob') return { ...zero, dnt: totalHrs }
  if (night) {
    if (dayType === 'saturday' || dayType === 'sunday') return { ...zero, ndt: totalHrs }
    return { ...zero, nnt: Math.min(totalHrs, NIGHT_NT), ndt: Math.max(0, totalHrs - NIGHT_NT) }
  }
  if (dayType === 'saturday') {
    // ge12: all DT — no T1.5 band (HTML ge12 branch: return { ddt: h })
    if (ge12) return { ...zero, ddt: totalHrs }
    // lt12: T1.5 up to satT15, then DT
    return { ...zero, dt15: Math.min(totalHrs, SAT_T15), ddt: Math.max(0, totalHrs - SAT_T15) }
  }
  if (dayType === 'sunday') return { ...zero, ddt: totalHrs }
  // Weekday day
  if (ge12) {
    // ge12: NT up to wdNT, then DT — T1.5 band skipped (HTML ge12 branch)
    const dnt = Math.min(totalHrs, WD_NT)
    const ddt = Math.max(0, totalHrs - WD_NT)
    return { ...zero, dnt, ddt }
  }
  // lt12: NT → T1.5 → DT
  const dnt  = Math.min(totalHrs, WD_NT)
  const dt15 = Math.min(Math.max(0, totalHrs - WD_NT), WD_T15)
  const ddt  = Math.max(0, totalHrs - WD_NT - WD_T15)
  return { ...zero, dnt, dt15, ddt }
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
  globalTVs: GlobalTV[] = [],
  globalDepartments: GlobalDepartment[] = [],
  purchaseOrders: PurchaseOrder[] = [],
  invoices: Invoice[] = [],
): ForecastData {

  const byDay: Record<string, DayBucket> = {}
  const byPo:  Record<string, PoBucket>  = {}
  const holidays = new Set(publicHolidays.map(h => h.date))

  function ensurePo(poId: string): PoBucket {
    if (!byPo[poId]) byPo[poId] = {
      labour:    { cost: 0, hours: 0, people: [] },
      dryHire:   { cost: 0, items: [] },
      wetHire:   { cost: 0, items: [] },
      localHire: { cost: 0, items: [] },
      cars:      { cost: 0 },
      accom:     { cost: 0 },
      total:     0,
    }
    return byPo[poId]
  }

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
    const catKey = cat === 'management' ? 'mgmt' : cat === 'seag' ? 'seag' : cat === 'subcontractor' ? 'subcon' : 'trades'
    const end = r.mob_out || projEnd || r.mob_in
    const days = dateRange(r.mob_in, end)

    for (const d of days) {
      const dow = dayOfWeek(d)
      const dayType = getDayType(d, holidays)
      const shift = resolveShift(r, d)
      let labCost = 0, labSell = 0, hours = 0

      const rcCost = (rc.rates as { cost: Record<string,number> })?.cost || {}
      const rcSell = (rc.rates as { sell: Record<string,number> })?.sell || {}

      if (shift === 'day' || shift === 'both') {
        const h = stdHours.day?.[dow] ?? 0
        if (h > 0) {
          const rcRegime = (rc as RateCard & { regime?: FcRegimeConfig }).regime
          const split = splitHours(h, dayType, 'day', rcRegime)
          labCost += costForSplit(split, rcCost)
          labSell += costForSplit(split, rcSell)
          hours += h
        }
      }
      if (shift === 'night' || shift === 'both') {
        const h = stdHours.night?.[dow] ?? 0
        if (h > 0) {
          const rcRegime2 = (rc as RateCard & { regime?: FcRegimeConfig }).regime
          const split = splitHours(h, dayType, 'night', rcRegime2)
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
        // SE AG and tooling stay in their native currency (EUR) at the bucket
        // level — matches HTML convention which shows them with the € symbol
        // for clarity. Conversion to base currency happens only at total time
        // in the panel via fcToBase / EUR_CATS, so users see EUR values for
        // the source data and AUD totals at the bottom.
        // Note: allowances (FSA/camp) are stored AUD inside labCost/labSell,
        // so for SE AG we'd actually be mixing currencies here. We keep the
        // mix for parity with HTML — the panel's display logic does not
        // attempt to separate them, and any accounting export should sum the
        // base-currency totals from bucketTotal().
        day[catKey].cost += labCost
        day[catKey].sell += labSell
        day[catKey].headcount += 1
        day[catKey].hours += hours
        day.people.push({
          name: r.name,
          role: r.role || '',
          category: catKey,
          cost: labCost,
          sell: labSell,
          hours,
          isMob: d === r.mob_in,
          isDemob: d === (r.mob_out || r.mob_in),
        })

        // ── PO accumulation — cost rates only (not sell) ──
        const poKey = (r as Resource & { linked_po_id?: string | null }).linked_po_id || 'unlinked'
        ensurePo(poKey).labour.cost += labCost
        ensurePo(poKey).labour.hours += hours
      }
    }
    // ── PoBucketPerson summary (one entry per resource, after all days) ──
    const poKey = (r as Resource & { linked_po_id?: string | null }).linked_po_id || 'unlinked'
    const poBucket = ensurePo(poKey)
    const existing = poBucket.labour.people.find(p => p.resourceId === r.id)
    if (!existing) {
      const totalCostForResource = days.reduce((sum, d) => {
        const dow = dayOfWeek(d)
        const dayType = getDayType(d, holidays)
        const shift = resolveShift(r, d)
        const rcCost = (rc.rates as { cost: Record<string,number> })?.cost || {}
        const rcRegime = (rc as RateCard & { regime?: FcRegimeConfig }).regime
        let c = 0
        if (shift === 'day' || shift === 'both') {
          const h = stdHours.day?.[dow] ?? 0
          if (h > 0) c += costForSplit(splitHours(h, dayType, 'day', rcRegime), rcCost)
        }
        if (shift === 'night' || shift === 'both') {
          const h = stdHours.night?.[dow] ?? 0
          if (h > 0) c += costForSplit(splitHours(h, dayType, 'night', rcRegime), rcCost)
        }
        return sum + c
      }, 0)
      const totalHoursForResource = days.reduce((sum, d) => {
        const dow = dayOfWeek(d)
        const shift = resolveShift(r, d)
        let h = 0
        if (shift === 'day' || shift === 'both') h += stdHours.day?.[dow] ?? 0
        if (shift === 'night' || shift === 'both') h += stdHours.night?.[dow] ?? 0
        return sum + h
      }, 0)
      poBucket.labour.people.push({
        resourceId: r.id,
        name: r.name,
        role: r.role || '',
        mobIn: r.mob_in!,
        mobOut: (r as Resource & { mob_out?: string }).mob_out || r.mob_in!,
        totalCost: totalCostForResource,
        totalHours: totalHoursForResource,
      })
    }
  }

  // ── Back Office Hours ──
  for (const bo of backOffice) {
    if (!bo.date || !bo.hours) continue
    const day = ensure(bo.date)
    day.mgmt.cost += bo.cost || 0
    day.mgmt.sell += bo.sell || 0
    day.mgmt.hours += bo.hours
    day.people.push({
      name: bo.name || 'Back Office',
      role: bo.role || '',
      category: 'mgmt',
      cost: bo.cost || 0,
      sell: bo.sell || 0,
      hours: bo.hours,
      isBackOffice: true,
    })
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
      // ── PO accumulation ──
      const poKey = (item as HireItem & { linked_po_id?: string | null }).linked_po_id || 'unlinked'
      const pb = ensurePo(poKey)
      pb[catKey].cost += totalCost
      const itemName = (item as HireItem & { name?: string }).name || (item as HireItem & { description?: string }).description || 'Hire item'
      if (!pb[catKey].items.includes(itemName)) pb[catKey].items.push(itemName)
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
    // ── PO accumulation ──
    const poKey = (c as Car & { linked_po_id?: string | null }).linked_po_id || 'unlinked'
    ensurePo(poKey).cars.cost += c.total_cost || 0
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
    // ── PO accumulation ──
    const poKey = (a as Accommodation & { linked_po_id?: string | null }).linked_po_id || 'unlinked'
    ensurePo(poKey).accom.cost += a.total_cost || 0

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

  // ── Tooling ──
  // Live-calculate using calcRentalCost (same as wbsAggregator) so the
  // Forecast panel and MIKA actuals panel show consistent tooling costs.
  // Previously used stored cost_eur / sell_eur snapshots which go stale.
  // Result is in EUR — stored in the day bucket as raw EUR, panel converts
  // to base currency for grand totals (same as before).
  const tvByNo = Object.fromEntries(globalTVs.map(tv => [tv.tv_no, tv]))
  const deptById = Object.fromEntries(globalDepartments.map(d => [d.id, d]))

  for (const tc of toolingCostings) {
    const tv = tvByNo[tc.tv_no]
    const dept = tv?.department_id ? deptById[tv.department_id] : null
    const replVal = Number(tv?.replacement_value_eur || 0)

    if (tv && dept && replVal > 0) {
      // Live calc — same method as wbsAggregator
      const rates = dept.rates as Record<string, unknown>
      const deptCalc = {
        rental_pct: Number(rates.rentalPct || 0),
        rate_unit: ((rates.rateUnit as string) || 'weekly') as 'weekly' | 'daily' | 'monthly',
        gm_pct: Number(rates.gmPct || 0),
      }
      const splits = tc.splits || []
      if (splits.length > 0) {
        for (const sp of splits) {
          if (sp.type !== 'project' || !sp.startDate || !sp.endDate) continue
          const calc = calcRentalCost(replVal, {
            charge_start: sp.startDate, charge_end: sp.endDate,
            sell_override_eur: tc.sell_override_eur ?? null,
          }, deptCalc)
          if (!calc) continue
          const factor = sp.discountPct ? 1 - (sp.discountPct / 100) : 1
          const days = dateRange(sp.startDate, sp.endDate)
          if (!days.length) continue
          const perDayCost = (calc.cost * factor) / days.length
          const perDaySell = (calc.sell * factor) / days.length
          for (const d of days) { const day = ensure(d); day.tooling.cost += perDayCost; day.tooling.sell += perDaySell }
        }
      } else if (tc.charge_start && tc.charge_end) {
        const calc = calcRentalCost(replVal, {
          charge_start: tc.charge_start, charge_end: tc.charge_end,
          sell_override_eur: tc.sell_override_eur ?? null,
        }, deptCalc)
        if (calc) {
          const days = dateRange(tc.charge_start, tc.charge_end)
          if (days.length) {
            const perDayCost = calc.cost / days.length
            const perDaySell = calc.sell / days.length
            for (const d of days) { const day = ensure(d); day.tooling.cost += perDayCost; day.tooling.sell += perDaySell }
          }
        }
      }
    } else {
      // Fallback to stored snapshot if TV/dept data not available
      if (!tc.charge_start) continue
      const days = dateRange(tc.charge_start, tc.charge_end || tc.charge_start)
      if (!days.length) continue
      const perDayCost = (tc.cost_eur || 0) / days.length
      const perDaySell = (tc.sell_eur || 0) / days.length
      for (const d of days) { const day = ensure(d); day.tooling.cost += perDayCost; day.tooling.sell += perDaySell }
    }
  }

  const days = Object.keys(byDay).sort()
  // Grand totals — convert EUR-source categories (seag, tooling) to base.
  let totalCost = 0, totalSell = 0
  for (const d of days) {
    const b = byDay[d]
    for (const cat of ['trades','mgmt','seag','subcon','dryHire','wetHire','localHire','tooling','cars','accom','expenses'] as const) {
      const factor = EUR_CATS.has(cat) ? toBase(1, 'EUR') : 1
      totalCost += b[cat].cost * factor
      totalSell += b[cat].sell * factor
    }
  }

  // ── Subcontractor PO costs ────────────────────────────────────────────────
  // For each active/raised PO, spread uninvoiced cost across the forecast
  // period as a daily rate — invoice period_from/period_to replaces the
  // plan estimate for periods already invoiced.
  //
  // Three cases (matching poCommitmentsEngine logic):
  //   1. PO linked to resources (no rate card) → spread across mob dates
  //   2. PO linked to bookings (hire/cars/accom) → already in forecast, skip
  //   3. Standalone PO → spread across forecast_start/forecast_end

  // Build lookup: which POs have linked bookings?
  const poHasBooking = new Set<string>()
  for (const h of hireItems) {
    const lpi = (h as HireItem & { linked_po_id?: string | null }).linked_po_id
    if (lpi) poHasBooking.add(lpi)
  }
  for (const c of cars) {
    const lpi = (c as Car & { linked_po_id?: string | null }).linked_po_id
    if (lpi) poHasBooking.add(lpi)
  }
  for (const a of accom) {
    const lpi = (a as Accommodation & { linked_po_id?: string | null }).linked_po_id
    if (lpi) poHasBooking.add(lpi)
  }

  // Build lookup: which resources are subcon (no rate card) and link to a PO?
  const subconByPo: Record<string, Resource[]> = {}
  for (const r of resources) {
    const lpi = (r as Resource & { linked_po_id?: string | null }).linked_po_id
    if (!lpi || r.category !== 'subcontractor') continue
    const hasRateCard = rateCards.some(rc => rc.role.toLowerCase() === r.role.toLowerCase())
    if (hasRateCard) continue  // already in labour forecast
    if (!subconByPo[lpi]) subconByPo[lpi] = []
    subconByPo[lpi].push(r)
  }

  // Build approved invoice totals per PO
  const invoicedByPo: Record<string, number> = {}
  const invoicesByPo: Record<string, Invoice[]> = {}
  for (const inv of invoices) {
    if (!inv.po_id || inv.status !== 'approved') continue
    invoicedByPo[inv.po_id] = (invoicedByPo[inv.po_id] || 0) + (Number(inv.amount) || 0)
    if (!invoicesByPo[inv.po_id]) invoicesByPo[inv.po_id] = []
    invoicesByPo[inv.po_id].push(inv)
  }

  // Helper: how much of an invoice overlaps a single day?
  function invDayAmount(inv: Invoice, day: string): number {
    if (!inv.period_from || !inv.period_to) return 0
    if (day < inv.period_from || day > inv.period_to) return 0
    const days = Math.max(1,
      Math.round((new Date(inv.period_to + 'T12:00:00').getTime() -
                  new Date(inv.period_from + 'T12:00:00').getTime()) / 86400000) + 1
    )
    return (Number(inv.amount) || 0) / days
  }

  function invoicedOnDay(poId: string, day: string): number {
    return (invoicesByPo[poId] || []).reduce((s, inv) => s + invDayAmount(inv, day), 0)
  }

  // Helper: resolve FX for PO currency
  function poFx(currency: string): number {
    if (!currency || currency === 'AUD') return 1
    return fxRates.find(r => r.code === currency)?.rate || 1
  }

  // Helper: date range
  function dateRangePO(start: string, end: string): string[] {
    const result: string[] = []
    const cur = new Date(start + 'T12:00:00')
    const last = new Date(end + 'T12:00:00')
    while (cur <= last) {
      result.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
    return result
  }

  for (const po of purchaseOrders) {
    if (!['raised', 'active'].includes(po.status)) continue
    const poValue = Number(po.po_value) || 0
    if (!poValue) continue
    const fx = poFx(po.currency)
    const poValueAud = poValue * fx
    const invoicedTotal = invoicedByPo[po.id] || 0

    // ── Case 2: subcon resources with mob dates (checked FIRST — a PO can have
    //    both hire items and labour resources, e.g. a scaffolding PO) ──────────
    if (subconByPo[po.id]) {
      const subRes = subconByPo[po.id]

      // If the same PO has linked bookings (hire/cars/accom), those booking costs
      // are already in the forecast. Deduct them from the PO value so we only
      // spread the remaining labour portion across the resource mob dates.
      const linkedBookingCost = [
        ...hireItems.filter(h => (h as HireItem & { linked_po_id?: string | null }).linked_po_id === po.id)
          .map(h => Number(h.hire_cost) || 0),
        ...cars.filter(c => (c as Car & { linked_po_id?: string | null }).linked_po_id === po.id)
          .map(c => Number(c.total_cost) || 0),
        ...accom.filter(a => (a as Accommodation & { linked_po_id?: string | null }).linked_po_id === po.id)
          .map(a => Number(a.total_cost) || 0),
      ].reduce((s, v) => s + v, 0) * fx

      const labourValueAud = Math.max(0, poValueAud - linkedBookingCost - invoicedTotal)
      if (!labourValueAud) continue

      const totalMobDays = subRes.reduce((sum, r) => {
        if (!r.mob_in || !r.mob_out) return sum
        return sum + Math.max(1, Math.round(
          (new Date(r.mob_out + 'T12:00:00').getTime() - new Date(r.mob_in + 'T12:00:00').getTime()) / 86400000
        ) + 1)
      }, 0)
      if (!totalMobDays) continue
      const dailyRate = labourValueAud / totalMobDays

      for (const r of subRes) {
        if (!r.mob_in || !r.mob_out) continue
        for (const day of dateRangePO(r.mob_in, r.mob_out)) {
          const invAmt = invoicedOnDay(po.id, day)
          const dayCost = invAmt > 0 ? invAmt / subRes.length : dailyRate
          ensure(day).subcon.cost += dayCost
          ensure(day).subcon.sell += dayCost
        }
      }
      continue
    }

    // ── Case 1: PO has linked bookings but no subcon resources ────────────────
    // Booking costs (hire_cost, total_cost) are already in the forecast via the
    // hire/car/accom spread loops above. Skip to avoid double counting.
    if (poHasBooking.has(po.id)) continue

    // ── Case 3: standalone PO — spread across forecast_start/forecast_end ─────
    const remaining = Math.max(0, poValueAud - invoicedTotal)
    if (!remaining) continue

    const spreadStart = po.forecast_start || po.raised_date
    const spreadEnd   = po.forecast_end   || po.closed_date || projEnd
    if (!spreadStart || !spreadEnd || spreadStart > spreadEnd) continue

    const spreadDays = dateRangePO(spreadStart, spreadEnd)
    if (!spreadDays.length) continue
    const dailyRate = remaining / spreadDays.length

    for (const day of spreadDays) {
      const invAmt = invoicedOnDay(po.id, day)
      const dayCost = invAmt > 0 ? invAmt : dailyRate
      ensure(day).subcon.cost += dayCost
      ensure(day).subcon.sell += dayCost
    }
  }

  // Compute byPo totals
  for (const pb of Object.values(byPo)) {
    pb.total = pb.labour.cost + pb.dryHire.cost + pb.wetHire.cost + pb.localHire.cost + pb.cars.cost + pb.accom.cost
  }

  return { byDay, byPo, days, totalCost, totalSell, accomWarnings }
}

// Aggregate by week key (YYYY-WNN)
export function weekKey(d: string): string {
  const date = new Date(d + 'T12:00:00')
  const dow = date.getDay()
  const mon = new Date(date)
  mon.setDate(date.getDate() - (dow === 0 ? 6 : dow - 1))
  return mon.toISOString().slice(0, 10)
}

/** Calendar-month key for a date — YYYY-MM. Used by the panel's monthly view
 *  toggle for accounting-style breakdown. */
export function monthKey(d: string): string {
  return d.slice(0, 7)
}

/** Render a week label like "23 Mar – 29 Mar". The week key is the Monday. */
export function weekLabel(wk: string): string {
  const start = new Date(wk + 'T12:00:00')
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${start.toLocaleDateString('en-AU', opts)} – ${end.toLocaleDateString('en-AU', opts)}`
}

/** Render a month label like "April 2026". Key is YYYY-MM. */
export function monthLabel(mk: string): string {
  const d = new Date(mk + '-01T12:00:00')
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
}

/** Categories whose underlying figures are in EUR — surface with € sign in the
 *  panel so the user knows the cell is a native-currency view. The day-bucket
 *  values themselves are already converted to base currency, but display
 *  follows the source convention to match the HTML. */
export const EUR_CATS: ReadonlySet<string> = new Set(['seag', 'tooling'])

// Sum a DayBucket to a single cost/sell — in raw bucket units (EUR cats stay EUR).
export function bucketTotal(b: DayBucket): { cost: number; sell: number } {
  let cost = 0, sell = 0
  for (const cat of ['trades','mgmt','seag','dryHire','wetHire','localHire','tooling','cars','accom','expenses','subcon'] as const) {
    cost += b[cat].cost
    sell += b[cat].sell
  }
  return { cost, sell }
}

/** FX-aware bucket total — converts EUR-source categories to base currency. */
export function bucketTotalBase(b: DayBucket, eurRate: number): { cost: number; sell: number } {
  let cost = 0, sell = 0
  for (const cat of ['trades','mgmt','seag','dryHire','wetHire','localHire','tooling','cars','accom','expenses','subcon'] as const) {
    const factor = EUR_CATS.has(cat) ? eurRate : 1
    cost += b[cat].cost * factor
    sell += b[cat].sell * factor
  }
  return { cost, sell }
}


/**
 * buildForecastByWbs — compute planned total cost per WBS code.
 *
 * Same source data as buildForecast but grouped by resource/booking wbs field
 * instead of day. Used to feed MIKA Forecast TC column so it reflects the
 * OMV2 engine rather than the stale SAP-imported value.
 *
 * Returns a flat map of wbs → planned cost (AUD). Parent WBS rollup is done
 * in the caller (MikaPanel) using the same rollup() function as actuals/committed.
 */
export function buildForecastByWbs(
  resources: Resource[],
  rateCards: RateCard[],
  hireItems: HireItem[],
  cars: Car[],
  accom: Accommodation[],
  expenses: Expense[],
  purchaseOrders: PurchaseOrder[],
  invoices: Invoice[],
  stdHours: { day: Record<string,number>; night: Record<string,number> },
  publicHolidays: { date: string }[],
  fxRates: { code: string; rate: number }[],
  backOffice: BackOfficeHour[] = [],
  toolingCostings: ToolingCosting[] = [],
  projEnd: string | null = null,
): Record<string, number> {
  const byWbs: Record<string, number> = {}
  const holidays = new Set(publicHolidays.map(h => h.date))
  const eurRate = fxRates.find(f => f.code === 'EUR')?.rate || 1

  function add(wbs: string, cost: number) {
    if (!wbs || !cost) return
    byWbs[wbs] = (byWbs[wbs] || 0) + cost
  }

  function toBaseLocal(amount: number, currency?: string): number {
    if (!amount) return 0
    if (!currency || currency === 'AUD') return amount
    const r = fxRates.find(f => f.code === currency)?.rate || 1
    return amount * r
  }

  function costForSplitLocal(split: Record<string, number>, rates: Record<string,number>): number {
    let total = 0
    for (const [band, hrs] of Object.entries(split)) if (hrs && rates[band]) total += hrs * rates[band]
    return total
  }

  // ── Resources — mirrors buildForecast day loop exactly ────────────────────
  for (const r of resources) {
    const wbs = (r as Resource & { wbs?: string }).wbs || ''
    if (!r.mob_in) continue
    const rc = rateCards.find(rc2 => rc2.role.toLowerCase() === r.role.toLowerCase())
    if (!rc) continue
    const rcCost = (rc.rates as { cost?: Record<string,number> })?.cost || {}
    const rcRegime = (rc as RateCard & { regime?: FcRegimeConfig }).regime
    // Match buildForecast line 233-234: use rc.category first, then r.category
    const cat = (rc as RateCard & { category?: string }).category || r.category || 'trades'
    const catKey = cat === 'management' ? 'mgmt' : cat === 'seag' ? 'seag' : cat === 'subcontractor' ? 'subcon' : 'trades'
    const isEur = catKey === 'seag'
    // Match buildForecast line 235: use projEnd as fallback (not r.mob_in)
    const end = (r as Resource & { mob_out?: string }).mob_out || projEnd || r.mob_in
    const days = dateRange(r.mob_in, end)

    let resourceCost = 0
    let nShifts = 0
    for (const d of days) {
      const dow = dayOfWeek(d)
      const dayType = getDayType(d, holidays)
      const shift = resolveShift(r, d)
      let dayHasShift = false
      if (shift === 'day' || shift === 'both') {
        const h = stdHours.day?.[dow] ?? 0
        if (h > 0) { resourceCost += costForSplitLocal(splitHours(h, dayType, 'day', rcRegime), rcCost); dayHasShift = true }
      }
      if (shift === 'night' || shift === 'both') {
        const h = stdHours.night?.[dow] ?? 0
        if (h > 0) { resourceCost += costForSplitLocal(splitHours(h, dayType, 'night', rcRegime), rcCost); dayHasShift = true }
      }
      if (dayHasShift) nShifts++
    }
    // Allowances per shift day — matches buildForecast lines 269-277
    const rX = r as Resource & { allow_laha?: boolean; allow_meal?: boolean; allow_fsa?: boolean }
    if (catKey === 'trades') {
      if (rX.allow_laha !== false) resourceCost += (Number(rc.laha_cost) || 0) * nShifts
      if (rX.allow_meal !== false) resourceCost += (Number(rc.meal_cost) || 0) * nShifts
    } else {
      if (rX.allow_fsa !== false && rX.allow_laha !== false) resourceCost += (Number(rc.fsa_cost) || 0) * nShifts
    }
    // SE AG: convert EUR to AUD
    if (isEur) resourceCost *= eurRate
    add(wbs, resourceCost)
  }

  // ── Hire items ─────────────────────────────────────────────────────────────
  for (const h of hireItems) {
    const wbs = (h as HireItem & { wbs?: string }).wbs || ''
    add(wbs, toBaseLocal(Number(h.hire_cost) || 0, (h as HireItem & {currency?:string}).currency))
  }

  // ── Cars ───────────────────────────────────────────────────────────────────
  for (const c of cars) {
    const wbs = (c as Car & { wbs?: string }).wbs || ''
    add(wbs, Number(c.total_cost) || 0)
  }

  // ── Accommodation ──────────────────────────────────────────────────────────
  for (const a of accom) {
    const wbs = (a as Accommodation & { wbs?: string }).wbs || ''
    add(wbs, Number(a.total_cost) || 0)
  }

  // ── Expenses ───────────────────────────────────────────────────────────────
  for (const e of expenses) {
    const wbs = (e as Expense & { wbs?: string }).wbs || ''
    add(wbs, Number(e.cost_ex_gst) || 0)
  }

  // ── Back Office Hours ──────────────────────────────────────────────────────
  for (const bo of backOffice) {
    const wbs = (bo as BackOfficeHour & { wbs?: string }).wbs || ''
    add(wbs, bo.cost || 0)
  }

  // ── Tooling ────────────────────────────────────────────────────────────────
  for (const tc of toolingCostings) {
    const eurRate = fxRates.find(f => f.code === 'EUR')?.rate || 1
    const costEur = Number(tc.cost_eur) || 0
    // Tooling has wbs per-split; if no splits use top-level wbs
    if (tc.splits && tc.splits.length > 0) {
      for (const sp of tc.splits) {
        const wbs = sp.wbs || tc.wbs || ''
        add(wbs, costEur * eurRate / tc.splits.length)
      }
    } else {
      add(tc.wbs || '', costEur * eurRate)
    }
  }

  // ── Standalone POs ─────────────────────────────────────────────────────────
  const linkedPoIds = new Set<string>()
  for (const h of hireItems) {
    const lpi = (h as HireItem & { linked_po_id?: string }).linked_po_id
    if (lpi) linkedPoIds.add(lpi)
  }
  for (const c of cars) {
    const lpi = (c as Car & { linked_po_id?: string }).linked_po_id
    if (lpi) linkedPoIds.add(lpi)
  }
  for (const a of accom) {
    const lpi = (a as Accommodation & { linked_po_id?: string }).linked_po_id
    if (lpi) linkedPoIds.add(lpi)
  }
  const resourcePoIds = new Set(resources
    .map(r => (r as Resource & { linked_po_id?: string }).linked_po_id)
    .filter(Boolean) as string[])

  const invoicedByPo: Record<string, number> = {}
  for (const inv of invoices) {
    if (inv.po_id && inv.status === 'approved')
      invoicedByPo[inv.po_id] = (invoicedByPo[inv.po_id] || 0) + (Number(inv.amount) || 0)
  }

  for (const po of purchaseOrders) {
    if (!['raised', 'active'].includes(po.status)) continue
    if (linkedPoIds.has(po.id) || resourcePoIds.has(po.id)) continue
    const wbs = (po as PurchaseOrder & { wbs?: string; sap_wbs?: string }).sap_wbs
      || (po as PurchaseOrder & { wbs?: string }).wbs || ''
    const remaining = Math.max(0, (Number(po.po_value) || 0) - (invoicedByPo[po.id] || 0))
    const audRemaining = toBaseLocal(remaining, po.currency)
    add(wbs, audRemaining)
  }

  return byWbs
}
