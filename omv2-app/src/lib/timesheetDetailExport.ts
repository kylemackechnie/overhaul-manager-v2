/**
 * timesheetDetailExport.ts
 *
 * Excel report for a single WeeklyTimesheet — one sheet per timesheet,
 * recreating the legacy spreadsheet layout that the team used before
 * OMV2.
 *
 * Layout (matches the screenshot kyle provided):
 *
 *   1. Per-person summary block at the top:
 *        Name | Role | WBS | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
 *        Total Hours | Total Sell
 *
 *   2. For each person, a detail block below:
 *        - One header row labeling the four hour buckets (N / T1.5 / D / LAHA)
 *          and four sell buckets ($ N / $ T1.5 / $ D / $ LAHA)
 *        - One row per day with:
 *            • Hours split into N / T1.5 / D using the same splitHours()
 *              function the cost engine uses (so numbers match the panel)
 *            • Sell amounts per bucket
 *            • Daily allowance ($ LAHA column — captures LAHA/Meal/FSA/Camp
 *              depending on category and what's ticked)
 *            • Daily total sell
 *        - Person totals row underneath
 *
 * Cost figures are computed alongside sell (rate-card rates × bucket hours)
 * and surfaced on a second sheet ('Cost detail') so the sell-side report
 * stays clean but the full picture is one click away.
 *
 * Consumer: TimesheetsPanel editor view via the toolbar.
 */

import * as XLSX from 'xlsx'
import { splitHours } from '../engines/costEngine'
import type { WeeklyTimesheet, RateCard, CrewMember, DayEntry } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAud(n: number): string | number {
  if (!isFinite(n) || Math.abs(n) < 0.005) return ''
  return Number(n.toFixed(2))
}

function rcByRole(rateCards: RateCard[]): Record<string, RateCard> {
  const map: Record<string, RateCard> = {}
  for (const r of rateCards) map[(r.role || '').toLowerCase()] = r
  return map
}

function asNum(v: unknown, fallback = 0): number {
  const n = parseFloat(String(v ?? 0))
  return isNaN(n) ? fallback : n
}

// Compress the 7-bucket HourSplit into the three the screenshot uses.
// Day + night are merged because the legacy report didn't split them out.
// If you ever want day/night separate, just promote the underlying split.
function bucketsNT15D(split: ReturnType<typeof splitHours>): { N: number; T15: number; D: number } {
  return {
    N:   (split.dnt   || 0) + (split.nnt   || 0),
    T15: (split.dt15  || 0) + (split.ndt15 || 0),
    D:   (split.ddt   || 0) + (split.ddt15 || 0) + (split.ndt || 0),
  }
}

// Walk the 7-day week starting Monday from week_start. ISO YYYY-MM-DD keys
// match the DayEntry keys exactly.
function weekDates(weekStart: string): { iso: string; date: Date; label: string }[] {
  const monday = new Date(weekStart + 'T12:00:00')
  const out: { iso: string; date: Date; label: string }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const iso = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    out.push({ iso, date: d, label })
  }
  return out
}

// Per-day computation. Returns hours split into N/T1.5/D, the matching
// sell/cost dollars, the daily allowance amount (sell + cost), and the
// effective hours actually charged.
//
// Mirrors calcPersonTotals exactly — both compositeDay branch and meal-
// break adjustment. If those diverge, fix calcPersonTotals first and
// keep this in sync.
interface DayCalc {
  effH: number
  N: number; T15: number; D: number
  sellN: number; sellT15: number; sellD: number
  costN: number; costT15: number; costD: number
  allowanceSell: number
  allowanceCost: number
}

function calcDay(
  m: CrewMember,
  day: DayEntry,
  rc: RateCard | null,
  isMgmt: boolean,
): DayCalc {
  const empty: DayCalc = {
    effH: 0,
    N: 0, T15: 0, D: 0,
    sellN: 0, sellT15: 0, sellD: 0,
    costN: 0, costT15: 0, costD: 0,
    allowanceSell: 0, allowanceCost: 0,
  }
  if (!rc) return empty

  const rates = (rc.rates as { cost?: Record<string, unknown>; sell?: Record<string, unknown> } | undefined)
  const cr = rates?.cost || {}
  const sr = rates?.sell || {}
  const rcAny = rc as unknown as Record<string, unknown>
  const rcRegime = rcAny.regime as Parameters<typeof splitHours>[3]

  // Allowance — same rules as calcPersonTotals
  let allowSell = 0, allowCost = 0
  if (isMgmt) {
    if (day.fsa)       { allowSell += asNum(rcAny.fsa_sell, 183); allowCost += asNum(rcAny.fsa_cost, 130) }
    else if (day.camp) { allowSell += asNum(rcAny.camp, 199);     allowCost += asNum(rcAny.camp_cost || rcAny.camp, 165.2) }
    else if (day.laha) { allowSell += asNum(rcAny.fsa_sell, 183); allowCost += asNum(rcAny.fsa_cost, 130) }
  } else {
    if (day.laha) { allowSell += asNum(rcAny.laha_sell, 212); allowCost += asNum(rcAny.laha_cost, 212) }
    if (day.meal) { allowSell += asNum(rcAny.meal_sell, 94);  allowCost += asNum(rcAny.meal_cost, 94) }
  }
  // Travel allowance — hours-based, applies for all categories. Mirrors the
  // branch in calcPersonTotals; only triggers when both `travel` is ticked
  // AND day.hours > 0 (the rate is paid per worked hour, not per day).
  const dxTravel = day as DayEntry & { travel?: boolean }
  const h0 = day.hours || 0
  if (dxTravel.travel && h0 > 0) {
    allowSell += h0 * asNum(rcAny.travel_sell, 30)
    allowCost += h0 * asNum(rcAny.travel_cost, 30)
  }

  // Identify the date key in member.days — we need calendarDayType for
  // splitHours, which depends on which day of the week the iso falls on.
  const dateKey = Object.entries(m.days || {}).find(([, v]) => v === day)?.[0]
    || ''
  const calDow = dateKey ? new Date(dateKey + 'T12:00:00').getDay() : 1
  const calendarDayType = calDow === 0 ? 'sunday' : calDow === 6 ? 'saturday' : 'weekday'

  const workH = day.hours || 0
  const travelH = (day as DayEntry & { travel_hours?: number }).travel_hours || 0
  const isCompositeDay = day.dayType === 'travel_and_work' || day.dayType === 'sea_travel_and_work'

  let effH = 0
  let totalSplit: ReturnType<typeof splitHours> = { dnt:0, dt15:0, ddt:0, ddt15:0, nnt:0, ndt:0, ndt15:0 }

  if (isCompositeDay) {
    if (travelH > 0) {
      // calendarDayType only takes 'weekday'/'saturday'/'sunday' here but the
      // engine's travelDayType domain includes 'public_holiday' for future
      // expansion; cast through string for the equality check.
      const cdt = calendarDayType as string
      const travelDayType = (cdt === 'sunday' || cdt === 'public_holiday')
        ? calendarDayType : 'travel'
      const tSplit = splitHours(travelH, travelDayType, day.shiftType === 'night' ? 'night' : 'day', rcRegime, calendarDayType)
      effH += travelH
      for (const k of Object.keys(totalSplit) as (keyof typeof totalSplit)[]) {
        totalSplit[k] += tSplit[k] || 0
      }
    }
    if (workH > 0) {
      const adjH = (m.mealBreakAdj && workH > 10) ? 0.5 : 0
      const eff = workH + adjH
      effH += eff
      const wSplit = splitHours(eff, 'weekday', day.shiftType === 'night' ? 'night' : 'day', rcRegime, calendarDayType)
      for (const k of Object.keys(totalSplit) as (keyof typeof totalSplit)[]) {
        totalSplit[k] += wSplit[k] || 0
      }
    }
  } else if (workH > 0) {
    const adjH = (m.mealBreakAdj && workH > 10) ? 0.5 : 0
    const eff = workH + adjH
    effH += eff
    totalSplit = splitHours(eff, day.dayType || 'weekday', day.shiftType === 'night' ? 'night' : 'day', rcRegime, calendarDayType)
  }

  const buckets = bucketsNT15D(totalSplit)

  // Per-bucket sell/cost — compute by re-isolating each bucket family on the
  // original split, so we attribute correctly when a single day spans
  // multiple buckets (e.g. 7.2h NT + 3.3h T1.5 + 1.5h DT)
  const sellN   = (totalSplit.dnt   || 0) * asNum(sr.dnt)   + (totalSplit.nnt   || 0) * asNum(sr.nnt)
  const sellT15 = (totalSplit.dt15  || 0) * asNum(sr.dt15)  + (totalSplit.ndt15 || 0) * asNum(sr.ndt15)
  const sellD   = (totalSplit.ddt   || 0) * asNum(sr.ddt)   + (totalSplit.ddt15 || 0) * asNum(sr.ddt15) + (totalSplit.ndt || 0) * asNum(sr.ndt)
  const costN   = (totalSplit.dnt   || 0) * asNum(cr.dnt)   + (totalSplit.nnt   || 0) * asNum(cr.nnt)
  const costT15 = (totalSplit.dt15  || 0) * asNum(cr.dt15)  + (totalSplit.ndt15 || 0) * asNum(cr.ndt15)
  const costD   = (totalSplit.ddt   || 0) * asNum(cr.ddt)   + (totalSplit.ddt15 || 0) * asNum(cr.ddt15) + (totalSplit.ndt || 0) * asNum(cr.ndt)

  return {
    effH,
    N: buckets.N, T15: buckets.T15, D: buckets.D,
    sellN, sellT15, sellD,
    costN, costT15, costD,
    allowanceSell: allowSell,
    allowanceCost: allowCost,
  }
}

// ── Main exporter ─────────────────────────────────────────────────────────────

export function exportTimesheetDetail(
  week: WeeklyTimesheet,
  projectName: string,
  rateCards: RateCard[],
): void {
  const dayLabels = weekDates(week.week_start)
  const dayLabelRow = dayLabels.map(d => d.label)
  const cards = rcByRole(rateCards)
  const typeLabel =
    week.type === 'mgmt'   ? 'Management' :
    week.type === 'seag'   ? 'SE AG'       :
    week.type === 'subcon' ? 'Subcontractor' :
                             'Trades'

  // Compute per-person + per-day rows once; both summary and detail blocks
  // use the same calc to guarantee they agree.
  const personRows = (week.crew || []).map(m => {
    const rc = cards[(m.role || '').toLowerCase()] || null
    const isMgmt = !!rc && (
      (rc as unknown as { category?: string }).category === 'management' ||
      (rc as unknown as { category?: string }).category === 'seag'
    )

    const dayCalcs = dayLabels.map(({ iso }) => {
      const day = (m.days || {})[iso] as DayEntry | undefined
      if (!day) return null
      // Render the day if it has work hours, travel hours, OR any allowance
      // flag set. The previous version only checked LAHA/meal, which dropped
      // mgmt-only days (FSA/Camp) with no hours — e.g. a Sunday with FSA
      // ticked for a manager who didn't work that day.
      const dx = day as DayEntry & {
        travel_hours?: number; fsa?: boolean; camp?: boolean; travel?: boolean
      }
      const hasAny =
        (day.hours || 0) > 0 ||
        (dx.travel_hours || 0) > 0 ||
        day.laha || day.meal || dx.fsa || dx.camp || dx.travel
      if (!hasAny) return null
      return { iso, calc: calcDay(m, day, rc, isMgmt), day }
    })

    const totalHrs   = dayCalcs.reduce((s, d) => s + (d?.calc.effH || 0), 0)
    const totalSell  = dayCalcs.reduce((s, d) => s + (d ? d.calc.sellN + d.calc.sellT15 + d.calc.sellD + d.calc.allowanceSell : 0), 0)
    const totalCost  = dayCalcs.reduce((s, d) => s + (d ? d.calc.costN + d.calc.costT15 + d.calc.costD + d.calc.allowanceCost : 0), 0)
    const totalAllow = dayCalcs.reduce((s, d) => s + (d?.calc.allowanceSell || 0), 0)
    const totalAllowCost = dayCalcs.reduce((s, d) => s + (d?.calc.allowanceCost || 0), 0)

    // Per-day hours (effH) for the summary block — empty cell if no entry
    const dayHours = dayCalcs.map(d => d ? d.calc.effH : '')

    return {
      member: m, rc, isMgmt, dayCalcs, dayHours,
      totalHrs, totalSell, totalCost, totalAllow, totalAllowCost,
    }
  })

  // ── Build sell-side AOA (the visible report) ───────────────────────────────
  const aoa: (string | number)[][] = []

  // Title block
  aoa.push([`Timesheet — ${typeLabel}`])
  aoa.push([projectName])
  aoa.push([
    `Week starting ${dayLabels[0].label}`,
    '', '', '', '', '', '', '', '',
    `Status: ${week.status}`,
  ])
  aoa.push([])

  // Summary block — exactly matches the screenshot's top section
  aoa.push(['Name', 'Role', 'WBS', ...dayLabelRow, 'Total Hours', 'Total Sell', 'Total Allowance', 'Total Cost'])
  for (const r of personRows) {
    aoa.push([
      r.member.name,
      r.member.role,
      r.member.wbs || week.wbs || '',
      ...r.dayHours.map(h => typeof h === 'number' ? Number(h.toFixed(2)) : ''),
      Number(r.totalHrs.toFixed(2)),
      fmtAud(r.totalSell),
      fmtAud(r.totalAllow),
      fmtAud(r.totalCost),
    ])
  }
  aoa.push([])

  // Per-person detail block
  for (const r of personRows) {
    // Person header
    aoa.push([r.member.name, r.member.role])
    // Bucket header row — hours on the left, $ on the right, then allowance + total
    aoa.push([
      '', '', 'Date',
      'N hrs', 'T1.5 hrs', 'D hrs',
      '$ N',   '$ T1.5',   '$ D',
      'LAHA $', 'Day Total $',
    ])
    for (const dc of r.dayCalcs) {
      if (!dc) continue
      const c = dc.calc
      const dayTotal = c.sellN + c.sellT15 + c.sellD + c.allowanceSell
      aoa.push([
        '', '', dayLabels.find(d => d.iso === dc.iso)?.label || dc.iso,
        c.N || '', c.T15 || '', c.D || '',
        fmtAud(c.sellN), fmtAud(c.sellT15), fmtAud(c.sellD),
        fmtAud(c.allowanceSell), fmtAud(dayTotal),
      ])
    }
    // Person totals
    aoa.push([
      '', '', 'Total',
      r.dayCalcs.reduce((s, d) => s + (d?.calc.N   || 0), 0) || '',
      r.dayCalcs.reduce((s, d) => s + (d?.calc.T15 || 0), 0) || '',
      r.dayCalcs.reduce((s, d) => s + (d?.calc.D   || 0), 0) || '',
      fmtAud(r.dayCalcs.reduce((s, d) => s + (d?.calc.sellN   || 0), 0)),
      fmtAud(r.dayCalcs.reduce((s, d) => s + (d?.calc.sellT15 || 0), 0)),
      fmtAud(r.dayCalcs.reduce((s, d) => s + (d?.calc.sellD   || 0), 0)),
      fmtAud(r.totalAllow),
      fmtAud(r.totalSell),
    ])
    aoa.push([])
  }

  // ── Cost-side AOA (mirror layout, cost numbers) ────────────────────────────
  const aoaCost: (string | number)[][] = []
  aoaCost.push([`Timesheet — ${typeLabel} (COST view)`])
  aoaCost.push([projectName])
  aoaCost.push([`Week starting ${dayLabels[0].label}`])
  aoaCost.push([])
  aoaCost.push(['Name', 'Role', 'WBS', ...dayLabelRow, 'Total Hours', 'Total Cost', 'Total Allowance Cost'])
  for (const r of personRows) {
    aoaCost.push([
      r.member.name,
      r.member.role,
      r.member.wbs || week.wbs || '',
      ...r.dayHours.map(h => typeof h === 'number' ? Number(h.toFixed(2)) : ''),
      Number(r.totalHrs.toFixed(2)),
      fmtAud(r.totalCost),
      fmtAud(r.totalAllowCost),
    ])
  }
  aoaCost.push([])
  for (const r of personRows) {
    aoaCost.push([r.member.name, r.member.role])
    aoaCost.push([
      '', '', 'Date',
      'N hrs', 'T1.5 hrs', 'D hrs',
      'Cost $ N', 'Cost $ T1.5', 'Cost $ D',
      'LAHA Cost $', 'Day Total Cost $',
    ])
    for (const dc of r.dayCalcs) {
      if (!dc) continue
      const c = dc.calc
      const dayTotal = c.costN + c.costT15 + c.costD + c.allowanceCost
      aoaCost.push([
        '', '', dayLabels.find(d => d.iso === dc.iso)?.label || dc.iso,
        c.N || '', c.T15 || '', c.D || '',
        fmtAud(c.costN), fmtAud(c.costT15), fmtAud(c.costD),
        fmtAud(c.allowanceCost), fmtAud(dayTotal),
      ])
    }
    aoaCost.push([
      '', '', 'Total',
      r.dayCalcs.reduce((s, d) => s + (d?.calc.N   || 0), 0) || '',
      r.dayCalcs.reduce((s, d) => s + (d?.calc.T15 || 0), 0) || '',
      r.dayCalcs.reduce((s, d) => s + (d?.calc.D   || 0), 0) || '',
      fmtAud(r.dayCalcs.reduce((s, d) => s + (d?.calc.costN   || 0), 0)),
      fmtAud(r.dayCalcs.reduce((s, d) => s + (d?.calc.costT15 || 0), 0)),
      fmtAud(r.dayCalcs.reduce((s, d) => s + (d?.calc.costD   || 0), 0)),
      fmtAud(r.totalAllowCost),
      fmtAud(r.totalCost),
    ])
    aoaCost.push([])
  }

  // ── Build workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  const wsSell = XLSX.utils.aoa_to_sheet(aoa)
  const wsCost = XLSX.utils.aoa_to_sheet(aoaCost)

  // Column widths — best-effort, applied to both sheets
  const colWidths = [
    { wch: 22 }, // Name
    { wch: 22 }, // Role
    { wch: 22 }, // WBS / Date
    ...dayLabelRow.map(() => ({ wch: 12 })),
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ]
  wsSell['!cols'] = colWidths
  wsCost['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, wsSell, 'Sell detail')
  XLSX.utils.book_append_sheet(wb, wsCost, 'Cost detail')

  const safeProject = (projectName || 'Project').replace(/[^\w-]+/g, '_').slice(0, 40)
  const filename = `Timesheet_${safeProject}_${typeLabel}_${week.week_start}.xlsx`
  XLSX.writeFile(wb, filename)
}
