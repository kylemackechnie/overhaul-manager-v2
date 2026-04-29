/**
 * timesheetCostEngine.ts
 *
 * Single source of truth for NRG TCE cost tracking.
 *
 * Whenever a timesheet is saved, call writeTimesheetCostLines() to
 * explode the crew/days/allocations into timesheet_cost_lines rows.
 *
 * Every downstream consumer (NrgActualsPanel, NrgInvoicingPanel) reads
 * from that table — no recalculation, no divergence.
 *
 * Row granularity: one row per person × day × tce_item_id allocation.
 * If a day has no TCE allocation, no row is written for that day.
 */

import { supabase } from '../lib/supabase'
import { splitHours, calcHoursCost } from './costEngine'
import { fxRate } from '../lib/currency'
import type { RateCard, WeeklyTimesheet, Project } from '../types'

interface CostLineInsert {
  project_id: string
  timesheet_id: string
  week_start: string
  week_ending: string
  work_date: string
  person_id: string
  person_name: string
  role: string
  category: string
  wbs: string
  tce_item_id: string | null
  work_order: string | null
  day_type: string
  shift_type: string
  /** Legacy field — column has default '' since hours are now driven by
   *  rate-card thresholds, not a per-timesheet lt12/ge12 toggle. Writer
   *  no longer populates this; left in the type for old call sites. */
  regime?: string
  allocated_hours: number
  cost_labour: number
  sell_labour: number
  cost_allowances: number
  sell_allowances: number
  timesheet_status: string
}

/** Minimum TCE line shape needed for WO → item_id resolution at write time. */
interface TceLineLite {
  item_id: string | null
  work_order: string | null
}

/** Minimum Resource shape — only person_id → home WBS lookup is needed. */
interface ResourceLite {
  id: string
  wbs?: string | null
}

/**
 * Explode a timesheet into cost line rows and upsert to timesheet_cost_lines.
 * Deletes existing rows for this timesheet first (clean replace on every save).
 *
 * rateCards: all rate cards for the project (passed in — no DB fetch here)
 * tceLines:  optional list of project TCE lines, used to resolve a
 *            work_order-only allocation back to the owning TCE item_id.
 * resources: optional list of project resources, used to resolve a person's
 *            home WBS when neither the crew member nor the timesheet has
 *            one set. Lets the aggregator read this table directly without
 *            ever going back to the timesheet JSONB.
 * project:   optional project, needed for EUR→base conversion when an SE AG
 *            rate card is in EUR. Without it, EUR labour amounts land in
 *            cost_lines as raw EUR and get summed with AUD downstream — wrong.
 *            The timesheet UI shows EUR natively for display, but the cost
 *            lines table stores base currency so MIKA / Cost Summary / NRG
 *            actuals can sum across categories.
 */
export async function writeTimesheetCostLines(
  timesheet: WeeklyTimesheet,
  projectId: string,
  rateCards: RateCard[],
  tceLines: TceLineLite[] = [],
  resources: ResourceLite[] = [],
  project: Project | null = null,
): Promise<{ error: string | null }> {
  // Build a one-to-many WO → item_ids map. Single match → safe to auto-resolve.
  // Multi match → ambiguous, leave alloc unresolved so the user picks the line.
  const itemIdsByWO: Record<string, string[]> = {}
  for (const l of tceLines) {
    const wo = l.work_order
    if (!wo || !l.item_id) continue
    if (!itemIdsByWO[wo]) itemIdsByWO[wo] = []
    itemIdsByWO[wo].push(l.item_id)
  }
  const wbsByResourceId: Record<string, string> = {}
  for (const r of resources) {
    if (r.wbs) wbsByResourceId[r.id] = r.wbs
  }

  // Only write for TCE-scoped timesheets. Accept the legacy 'tce' value as
  // well as the current 'nrg_tce' for backwards compat with old timesheets
  // saved before the scope_tracking rename.
  const scopeTracking = (timesheet as unknown as { scope_tracking?: string }).scope_tracking
  if (scopeTracking !== 'tce' && scopeTracking !== 'nrg_tce') {
    return { error: null }
  }

  const weekStart = timesheet.week_start
  const weekEndDate = new Date(weekStart + 'T00:00:00')
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  const weekEnding = weekEndDate.toISOString().slice(0, 10)
  // Timesheet-level default allowance TCE item — used unless a crew member
  // sets an override. Empty string = no default; allowance rows for members
  // without an override will write tce_item_id=null.
  const tsAllowancesDefault = ((timesheet as unknown as { allowances_tce_default?: string }).allowances_tce_default || '').trim()

  const getRc = (role: string): RateCard | null =>
    rateCards.find(r => r.role.toLowerCase() === role.toLowerCase()) || null

  const rows: CostLineInsert[] = []

  for (const member of timesheet.crew) {
    const rc = getRc(member.role)
    if (!rc) continue

    const rcAny = rc as unknown as Record<string, unknown>
    const category = (rcAny.category as string) || 'trades'
    const isMgmt = category === 'management' || category === 'seag'
    const rcRegime = rcAny.regime as Parameters<typeof splitHours>[3]
    const memberAny = member as unknown as { mealBreakAdj?: boolean; wbs?: string }
    const pf = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }

    // FX: rate-card hourly rates are in rc.currency (EUR for SE AG, AUD for the
    // rest). Convert labour to project base currency at write time so the cost
    // lines table is single-currency for downstream summing.
    // Allowances stay AUD (LAHA/FSA/meal/camp are Australian award allowances).
    const rcCurrency = (rcAny.currency as string) || 'AUD'
    const labourFx = rcCurrency !== 'AUD' && project ? fxRate(project, rcCurrency) : 1

    // WBS resolution — same priority the HTML uses:
    //   1. crew[i].wbs (per-member override on this week)
    //   2. timesheet.wbs (week-level default)
    //   3. resource.wbs (person's home WBS)
    const memberWbs = memberAny.wbs
      || (timesheet as WeeklyTimesheet & { wbs?: string }).wbs
      || (member.personId ? wbsByResourceId[member.personId] : '')
      || ''

    for (const [workDate, dayRaw] of Object.entries(member.days || {})) {
      const day = dayRaw as {
        hours?: number
        dayType?: string
        shiftType?: string
        laha?: boolean
        meal?: boolean
        fsa?: boolean
        camp?: boolean
        travel?: boolean
        nrgWoAllocations?: Array<{
          tceItemId?: string
          wo?: string
          hours: number
          _tceMode?: boolean
        }>
      }

      const dayHours = day.hours || 0
      const allocs = day.nrgWoAllocations || []
      // Allocations carry hours-based labour. Filter to TCE/WO-tagged only.
      const tceAllocs = allocs.filter(a => a.tceItemId || a.wo)
      const hasLabour = dayHours > 0 && tceAllocs.length > 0

      const dayType = day.dayType || 'weekday'
      const shiftType = (day.shiftType === 'night' ? 'night' : 'day') as 'day' | 'night'

      // ── Day-level labour calc (matches UI's calcPersonTotals exactly) ──
      // Apply meal-break adjustment to effective hours, then split ONCE for the
      // whole day so the NT/T1.5/DT bands honour the day's total — splitting
      // alloc-by-alloc is wrong (e.g. 6h+4h ≠ 10h split when bands kick in).
      let dayLabourCost = 0, dayLabourSell = 0
      if (hasLabour) {
        const adjH = (memberAny.mealBreakAdj && dayHours > 0) ? 0.5 : 0
        const effH = dayHours + adjH
        const split = splitHours(effH, dayType, shiftType, rcRegime)
        dayLabourCost = calcHoursCost(split, rc, 'cost') * labourFx
        dayLabourSell = calcHoursCost(split, rc, 'sell') * labourFx
      }

      // ── Day-level allowances — apply on rest days too (LAHA pays regardless of hours) ──
      let dayCostAllow = 0, daySellAllow = 0
      if (isMgmt) {
        // Management/SE AG: FSA, Camp, or LAHA-treated-as-FSA (mutually exclusive)
        if (day.fsa) {
          dayCostAllow = pf(rcAny.fsa_cost); daySellAllow = pf(rcAny.fsa_sell)
        } else if (day.camp) {
          dayCostAllow = pf(rcAny.camp_cost ?? rcAny.camp); daySellAllow = pf(rcAny.camp)
        } else if (day.laha) {
          // Legacy: management with LAHA toggle gets FSA rate
          dayCostAllow = pf(rcAny.fsa_cost); daySellAllow = pf(rcAny.fsa_sell)
        }
      } else {
        if (day.laha) { dayCostAllow += pf(rcAny.laha_cost); daySellAllow += pf(rcAny.laha_sell) }
        if (day.meal) { dayCostAllow += pf(rcAny.meal_cost); daySellAllow += pf(rcAny.meal_sell) }
      }

      // ── Travel allowance (hours-based, separate TCE item) ──
      const travelRate = pf(rcAny.travel_cost) || 30
      const travelRateSell = pf(rcAny.travel_sell) || 30
      const dayCostTravel = day.travel && dayHours > 0 ? dayHours * travelRate : 0
      const daySellTravel = day.travel && dayHours > 0 ? dayHours * travelRateSell : 0

      // Nothing to write — skip the day
      if (!hasLabour && dayCostAllow === 0 && daySellAllow === 0 && dayCostTravel === 0) continue

      // ── Labour rows: split across allocations proportionally by hours ──
      // Labour rows always carry allowances=0 — allowances now go to a dedicated
      // row tagged to the allowance TCE item (per-person override or timesheet
      // default), not whichever scope item happened to be first in the day.
      if (hasLabour) {
        for (const alloc of tceAllocs) {
          const allocHours = Number(alloc.hours) || 0
          if (!allocHours) continue

          const ratio = allocHours / dayHours  // proportion of the day's labour
          const costLabour = dayLabourCost * ratio
          const sellLabour = dayLabourSell * ratio

          // Resolve tce_item_id:
          //   1. Prefer the alloc's explicit tceItemId
          //   2. Fall back to WO → item_id when exactly one TCE line owns this WO
          //   3. Otherwise null (ambiguous; user must pick the TCE line)
          let resolvedItemId: string | null = alloc.tceItemId || null
          if (!resolvedItemId && alloc.wo) {
            const candidates = itemIdsByWO[alloc.wo] || []
            if (candidates.length === 1) resolvedItemId = candidates[0]
          }

          rows.push({
            project_id: projectId,
            timesheet_id: timesheet.id,
            week_start: weekStart,
            week_ending: weekEnding,
            work_date: workDate,
            person_id: member.personId,
            person_name: member.name,
            role: member.role,
            category,
            wbs: memberWbs,
            tce_item_id: resolvedItemId,
            work_order: alloc.wo || null,
            day_type: dayType,
            shift_type: shiftType,
            allocated_hours: allocHours,
            cost_labour: costLabour,
            sell_labour: sellLabour,
            cost_allowances: 0,
            sell_allowances: 0,
            timesheet_status: timesheet.status,
          })
        }
      }

      // ── Dedicated allowance row (LAHA / Meal / FSA / Camp) ──
      if (dayCostAllow > 0 || daySellAllow > 0) {
        const memberAllowanceItem = (member as unknown as { allowancesTceItemId?: string | null }).allowancesTceItemId
        const allowanceItemId: string | null = memberAllowanceItem || tsAllowancesDefault || null
        rows.push({
          project_id: projectId,
          timesheet_id: timesheet.id,
          week_start: weekStart,
          week_ending: weekEnding,
          work_date: workDate,
          person_id: member.personId,
          person_name: member.name,
          role: member.role,
          category,
          wbs: memberWbs,
          tce_item_id: allowanceItemId,
          work_order: null,
          day_type: dayType,
          shift_type: shiftType,
          allocated_hours: 0,
          cost_labour: 0,
          sell_labour: 0,
          cost_allowances: dayCostAllow,
          sell_allowances: daySellAllow,
          timesheet_status: timesheet.status,
        })
      }

      // ── Dedicated travel allowance row ──
      // Tagged to member.travelTceItemId → timesheet travel_tce_default → null.
      // Hours-based: hours × travel_cost/sell from rate card.
      if (dayCostTravel > 0 || daySellTravel > 0) {
        const memberTravelItem = (member as unknown as { travelTceItemId?: string | null }).travelTceItemId
        const tsTravelDefault = ((timesheet as unknown as { travel_tce_default?: string }).travel_tce_default || '').trim()
        const travelItemId: string | null = memberTravelItem || tsTravelDefault || null
        rows.push({
          project_id: projectId,
          timesheet_id: timesheet.id,
          week_start: weekStart,
          week_ending: weekEnding,
          work_date: workDate,
          person_id: member.personId,
          person_name: member.name,
          role: member.role,
          category,
          wbs: memberWbs,
          tce_item_id: travelItemId,
          work_order: null,
          day_type: dayType,
          shift_type: shiftType,
          allocated_hours: 0,
          cost_labour: 0,
          sell_labour: 0,
          cost_allowances: dayCostTravel,
          sell_allowances: daySellTravel,
          timesheet_status: timesheet.status,
        })
      }
    }
  }

  // Clean replace: delete all existing rows for this timesheet, then insert fresh
  const { error: delErr } = await supabase
    .from('timesheet_cost_lines')
    .delete()
    .eq('timesheet_id', timesheet.id)

  if (delErr) return { error: delErr.message }
  if (rows.length === 0) return { error: null }

  const { error: insErr } = await supabase
    .from('timesheet_cost_lines')
    .insert(rows)

  return { error: insErr?.message || null }
}

// ─── UI-side per-person totals ────────────────────────────────────────────
// calcPersonTotals matches the writer's day logic: same splitHours, same
// allowance rules, same mealBreakAdj. Used by TimesheetsPanel to display
// running totals as the user edits, and by HRDashboardPanel for header
// figures. Returns native rate-card currency for sell/cost (EUR for SE AG,
// AUD elsewhere) — no FX conversion. Allowances are always in AUD.

interface CrewMemberLite {
  days?: Record<string, unknown>
  mealBreakAdj?: boolean
}

type RegimeCfg = { wdNT?: number; wdT15?: number; satT15?: number; nightNT?: number; restNT?: number } | null | undefined

export function calcPersonTotals(member: CrewMemberLite, rc: RateCard | null) {
  let hours = 0, labourSell = 0, labourCost = 0, allowances = 0, allowCost = 0
  const rates = rc?.rates as { cost: Record<string,number>; sell: Record<string,number> } | null
  const cr = rates?.cost || {}; const sr = rates?.sell || {}
  const rcX = (rc || {}) as unknown as Record<string, unknown>
  const isMgmt = !!rc && (rcX.category === 'management' || rcX.category === 'seag')
  const rcRegime = rcX.regime as RegimeCfg

  // Parse allowance values — DB returns NUMERIC columns as strings from Supabase
  const pf = (v: unknown, fallback: number) => { const n = parseFloat(String(v || 0)); return isNaN(n) ? fallback : n }
  const lahaSell  = pf(rcX.laha_sell,  212)
  const lahaCost  = pf(rcX.laha_cost,  212)
  const mealSell  = pf(rcX.meal_sell,   94)
  const mealCost  = pf(rcX.meal_cost,   94)
  const fsaSell   = pf(rcX.fsa_sell,   183)
  const fsaCost   = pf(rcX.fsa_cost,   130)
  const campSell  = pf(rcX.camp,        199)
  const campCost  = pf(rcX.camp_cost || rcX.camp, 165.20)
  const travelCostRate = pf(rcX.travel_cost, 30)
  const travelSellRate = pf(rcX.travel_sell, 30)

  Object.entries(member.days || {}).forEach(([, d]) => {
    const day = d as { dayType?: string; shiftType?: string; hours?: number; laha?: boolean; meal?: boolean; fsa?: boolean; camp?: boolean; travel?: boolean }

    // Allowances apply on every day entry (rest days included), matching the
    // writer's behaviour from the dedicated-allowance-row commit.
    if (isMgmt) {
      if (day.fsa)       { allowances += fsaSell;  allowCost += fsaCost }
      else if (day.camp) { allowances += campSell; allowCost += campCost }
      else if (day.laha) { allowances += fsaSell;  allowCost += fsaCost }
    } else {
      if (day.laha) { allowances += lahaSell; allowCost += lahaCost }
      if (day.meal) { allowances += mealSell; allowCost += mealCost }
    }
    // Travel: hours-based, applies for all categories
    const h0 = day.hours || 0
    if (day.travel && h0 > 0) { allowances += h0 * travelSellRate; allowCost += h0 * travelCostRate }

    const h = day.hours || 0
    if (h <= 0) return

    // mealBreakAdj: +0.5h to cost/sell calc (not payroll). Matches writer.
    const adjH = (member.mealBreakAdj && h > 0) ? 0.5 : 0
    const effH = h + adjH
    hours += effH

    const split = splitHours(effH, day.dayType || 'weekday', (day.shiftType === 'night' ? 'night' : 'day'), rcRegime)
    Object.entries(split).forEach(([b, bh]) => {
      if (bh > 0) {
        labourCost += bh * (parseFloat(String(cr[b] || 0)) || 0)
        labourSell += bh * (parseFloat(String(sr[b] || 0)) || 0)
      }
    })
  })

  // sell/cost = labour + allowances (combined total, matching HTML)
  const sell = labourSell + allowances
  const cost = labourCost + allowCost
  return { hours, sell, cost, allowances, labourSell }
}
