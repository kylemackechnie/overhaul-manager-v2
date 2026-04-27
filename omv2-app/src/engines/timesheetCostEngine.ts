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
import type { RateCard, WeeklyTimesheet } from '../types'

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
  regime: string
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
 */
export async function writeTimesheetCostLines(
  timesheet: WeeklyTimesheet,
  projectId: string,
  rateCards: RateCard[],
  tceLines: TceLineLite[] = [],
  resources: ResourceLite[] = [],
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

  // Only write for TCE-scoped timesheets
  const scopeTracking = (timesheet as WeeklyTimesheet & {scope_tracking?:string}).scope_tracking
  if (scopeTracking !== 'tce' && scopeTracking !== 'nrg_tce') {
    return { error: null }
  }

  const weekStart = timesheet.week_start
  const weekEndDate = new Date(weekStart + 'T00:00:00')
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  const weekEnding = weekEndDate.toISOString().slice(0, 10)
  const regime = (timesheet.regime || 'lt12') as 'lt12' | 'ge12'

  const getRc = (role: string): RateCard | null =>
    rateCards.find(r => r.role.toLowerCase() === role.toLowerCase()) || null

  const rows: CostLineInsert[] = []

  for (const member of timesheet.crew) {
    const rc = getRc(member.role)
    if (!rc) continue

    const rcAny = rc as unknown as Record<string, unknown>
    const category = (rcAny.category as string) || 'trades'
    const isMgmt = category === 'management' || category === 'seag'
    const rcRegime = rcAny.regime as Parameters<typeof splitHours>[4]
    const memberAny = member as unknown as { mealBreakAdj?: boolean; wbs?: string }
    const pf = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }

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
        nrgWoAllocations?: Array<{
          tceItemId?: string
          wo?: string
          hours: number
          _tceMode?: boolean
        }>
      }

      const dayHours = day.hours || 0
      if (dayHours <= 0) continue

      const allocs = day.nrgWoAllocations || []
      // Only write rows for days with a TCE/WO allocation
      const tceAllocs = allocs.filter(a => a.tceItemId || a.wo)
      if (tceAllocs.length === 0) continue

      const dayType = day.dayType || 'weekday'
      const shiftType = (day.shiftType === 'night' ? 'night' : 'day') as 'day' | 'night'

      // ── Day-level labour calc (matches UI's calcPersonTotals exactly) ──
      // Apply meal-break adjustment to effective hours, then split ONCE for the
      // whole day so the NT/T1.5/DT bands honour the day's total — splitting
      // alloc-by-alloc is wrong (e.g. 6h+4h ≠ 10h split when bands kick in).
      const adjH = (memberAny.mealBreakAdj && dayHours > 0) ? 0.5 : 0
      const effH = dayHours + adjH
      const split = splitHours(effH, dayType, shiftType, regime, rcRegime)
      const dayLabourCost = calcHoursCost(split, rc, 'cost')
      const dayLabourSell = calcHoursCost(split, rc, 'sell')

      // ── Day-level allowances ──
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

      // ── Split across allocations proportionally by hours ──
      // First alloc carries the day's allowances; remaining allocs get 0.
      let allowancesAttributed = false
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
          regime,
          allocated_hours: allocHours,
          cost_labour: costLabour,
          sell_labour: sellLabour,
          cost_allowances: allowancesAttributed ? 0 : dayCostAllow,
          sell_allowances: allowancesAttributed ? 0 : daySellAllow,
          timesheet_status: timesheet.status,
        })
        allowancesAttributed = true
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
