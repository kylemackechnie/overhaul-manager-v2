/**
 * useProjectHealth
 *
 * Single source of truth for the EVM-style project indices used across the
 * dashboards. Every health-related tile (Cost Snapshot, CPI, SPI, EAC, TCPI,
 * Project Health composite) reads from this hook so the numbers always agree.
 *
 * **CRITICAL: this hook calls the canonical `aggregateAllCostsByWbs` and
 * `buildPoCommitments` engines that the MIKA Cost Plan uses.** This is heavy
 * (~18 parallel fetches plus a few thousand lines of computation) but is the
 * only way to guarantee dashboard numbers match MIKA exactly.
 *
 * React Query caches the result for 60s — subsequent tile reads are free.
 *
 * Data sources:
 *   - mika_wbs_lines        → BAC (PM100) and PM80, filtered to the minimum
 *                              level to avoid summing the WBS hierarchy.
 *   - aggregateAllCostsByWbs → AC and EV (canonical actuals)
 *   - buildPoCommitments    → committed PO costs
 *   - projects.start/end    → time elapsed % for the SPI baseline
 *
 * Where MikaPanel and Project Health disagree, MikaPanel is the deep truth
 * (per-WBS, per-line). Project Health rolls up the same data to project totals.
 */

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/appStore'
import { supabase } from '../lib/supabase'
import { aggregateAllCostsByWbs } from '../engines/wbsAggregator'
import { buildPoCommitments } from '../engines/poCommitmentsEngine'
import type {
  Resource, RateCard, WeeklyTimesheet, BackOfficeHour,
  HireItem, Car, Accommodation, ToolingCosting, Expense,
  GlobalTV, GlobalDepartment, Variation, VariationLine,
  PurchaseOrder, Invoice,
} from '../types'
import type { SeSupportEntry, TimesheetCostLineLite } from '../engines/wbsAggregator'
import type { PoCommitmentResource, PoCommitmentProject } from '../engines/poCommitmentsEngine'

export interface ProjectHealth {
  /** Budget At Completion — total approved budget incl. approved variations */
  bac: number
  /** Budget At Completion — PM100 only, before variations */
  pm100: number
  /** PM80 — committed sell budget */
  pm80: number
  /** Approved variation value (uplift on BAC) */
  variationUplift: number

  /** Earned Value — sell value of work delivered to date */
  ev: number
  /** Actual Cost — total cost incurred to date (from canonical aggregator) */
  ac: number
  /** Planned Value — straight-line BAC × % time elapsed */
  pv: number

  /** PO commitments outstanding (uninvoiced remaining commitment) */
  poCommitted: number
  /** Invoiced total (any status) */
  invoiced: number
  /** Approved + paid invoice value */
  invoicedApproved: number
  /** Pending approval invoice value */
  invoicedPending: number

  /** Cost Performance Index = EV / AC. >1 means under budget */
  cpi: number | null
  /** Schedule Performance Index = EV / PV. >1 means ahead of schedule */
  spi: number | null
  /** Estimate At Completion = AC + (BAC − EV) / CPI */
  eac: number | null
  /** Variance At Completion = BAC − EAC */
  vac: number | null
  /** VAC as % of BAC. Negative = projected overrun */
  vacPct: number | null
  /** To-Complete Performance Index = (BAC − EV) / (BAC − AC) — cost perf needed for remainder */
  tcpi: number | null

  /** % of project duration elapsed (0–100) */
  timeElapsedPct: number
  /** % of EV vs BAC */
  progressPct: number
  /** % of BAC consumed by AC (cost burn) */
  burnPct: number

  /** Outage day number (1 = first day on site) or null if pre-mob */
  outageDay: number | null
  /** Days until project start (negative if already started) */
  daysToStart: number | null
  /** Days left until project end */
  daysToEnd: number | null

  /** Composite health score (0–100) */
  healthScore: number
  /** Top reasons the health score isn't 100 — for the "why" expansion */
  healthIssues: { label: string; severity: 'red' | 'amber' }[]

  /** Per-WBS canonical roll-up (matches MIKA). Tiles can use this without
   *  re-running the aggregator. Keys: WBS code → {actuals, sell}. */
  wbsActuals: Record<string, { actuals: number; sell: number }>
  /** Per-WBS committed PO costs (canonical engine). */
  wbsCommitted: Record<string, number>
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

/**
 * Roll a WBS line's value into its own code AND every parent prefix.
 * "S.1.1.1" with value V contributes to S.1.1.1, S.1.1, S.1, and S.
 * Mirrors the MikaPanel "rollup" helper so per-WBS dashboard tiles match MIKA.
 */
function rollupByPrefix(
  map: Record<string, { actuals: number; sell: number }>,
  code: string,
  actuals: number,
  sell: number,
) {
  const parts = code.split('.')
  let prefix = parts[0]
  if (!map[prefix]) map[prefix] = { actuals: 0, sell: 0 }
  map[prefix].actuals += actuals
  map[prefix].sell += sell
  for (let i = 1; i < parts.length; i++) {
    prefix += '.' + parts[i]
    if (!map[prefix]) map[prefix] = { actuals: 0, sell: 0 }
    map[prefix].actuals += actuals
    map[prefix].sell += sell
  }
}

function rollupSingle(map: Record<string, number>, code: string, value: number) {
  const parts = code.split('.')
  let prefix = parts[0]
  map[prefix] = (map[prefix] || 0) + value
  for (let i = 1; i < parts.length; i++) {
    prefix += '.' + parts[i]
    map[prefix] = (map[prefix] || 0) + value
  }
}

export function useProjectHealth(projectId: string | undefined) {
  const { activeProject } = useAppStore()

  return useQuery<ProjectHealth>({
    queryKey: ['project_health', projectId],
    queryFn: async () => {
      const pid = projectId!

      // ── Fetch every collection the canonical aggregator needs ────────────
      const [
        mikaR, resourcesR, rateCardsR, timesheetsR, costLinesR,
        tcOwnedR, tcCrossR, tvsR, deptsR,
        hireR, carsR, accomR, expensesR, boR, seR,
        varsR, varLinesR, posR, invoicesR, holsR,
      ] = await Promise.all([
        supabase.from('mika_wbs_lines').select('pm80,pm100,level').eq('project_id', pid),
        supabase.from('resources').select('*').eq('project_id', pid),
        supabase.from('rate_cards').select('*').eq('project_id', pid),
        supabase.from('weekly_timesheets').select('*').eq('project_id', pid),
        supabase.from('timesheet_cost_lines')
          .select('category,wbs,cost_labour,sell_labour,cost_allowances,sell_allowances,person_name,work_date')
          .eq('project_id', pid),
        supabase.from('tooling_costings').select('*').eq('project_id', pid),
        supabase.from('tooling_costings').select('*').neq('project_id', pid)
          .filter('splits', 'cs', `[{"projectId":"${pid}"}]`),
        supabase.from('global_tvs').select('*'),
        supabase.from('global_departments').select('*'),
        supabase.from('hire_items').select('*').eq('project_id', pid),
        supabase.from('cars').select('*').eq('project_id', pid),
        supabase.from('accommodation').select('*').eq('project_id', pid),
        supabase.from('expenses').select('*').eq('project_id', pid),
        supabase.from('back_office_hours').select('*').eq('project_id', pid),
        supabase.from('se_support_costs')
          .select('wbs,amount,sell_price,currency,person,description,date')
          .eq('project_id', pid),
        supabase.from('variations').select('*').eq('project_id', pid),
        supabase.from('variation_lines').select('*').eq('project_id', pid),
        supabase.from('purchase_orders').select('*').eq('project_id', pid),
        supabase.from('invoices').select('*').eq('project_id', pid),
        supabase.from('public_holidays').select('date').eq('project_id', pid),
      ])

      const mikaAll = (mikaR.data || []) as { pm80: number | null; pm100: number | null; level: string | number | null }[]
      const resources = (resourcesR.data || []) as Resource[]
      const rateCards = (rateCardsR.data || []) as RateCard[]
      const timesheets = (timesheetsR.data || []) as WeeklyTimesheet[]
      const costLines = (costLinesR.data || []) as TimesheetCostLineLite[]
      const toolingCostings = [
        ...((tcOwnedR.data || []) as ToolingCosting[]),
        ...((tcCrossR.data || []) as ToolingCosting[]),
      ]
      const globalTVs = (tvsR.data || []) as GlobalTV[]
      const globalDepartments = (deptsR.data || []) as GlobalDepartment[]
      const hireItems = (hireR.data || []) as HireItem[]
      const cars = (carsR.data || []) as Car[]
      const accommodation = (accomR.data || []) as Accommodation[]
      const expenses = (expensesR.data || []) as Expense[]
      const backOfficeHours = (boR.data || []) as BackOfficeHour[]
      const seSupport = (seR.data || []) as SeSupportEntry[]
      const variations = (varsR.data || []) as Variation[]
      const variationLines = (varLinesR.data || []) as VariationLine[]
      const purchaseOrders = (posR.data || []) as PurchaseOrder[]
      const invoices = (invoicesR.data || []) as Invoice[]
      const publicHolidays = ((holsR.data || []) as { date: string }[]).map(h => h.date)

      // ── Budget (MIKA at the minimum level only to avoid hierarchy double-count)
      // mika_wbs_lines.level is stored as TEXT; coerce for comparison.
      let minLevel = Infinity
      for (const m of mikaAll) {
        const l = Number(m.level ?? 0)
        if (Number.isFinite(l) && l < minLevel) minLevel = l
      }
      const topLines = mikaAll.filter(m => Number(m.level ?? 0) === minLevel)
      const pm100 = topLines.reduce((s, r) => s + (r.pm100 || 0), 0)
      const pm80 = topLines.reduce((s, r) => s + (r.pm80 || 0), 0)
      const variationUplift = variations
        .filter(v => v.status === 'approved')
        .reduce((s, v) => s + (v.sell_total || v.value || 0), 0)
      const bac = pm100 + variationUplift

      // ── Actual Cost & Earned Value (canonical aggregator) ─────────────────
      const agg = aggregateAllCostsByWbs({
        project: activeProject,
        resources, rateCards, timesheets,
        timesheetCostLines: costLines,
        toolingCostings, globalTVs, globalDepartments,
        hireItems, cars, accommodation,
        expenses, backOfficeHours, seSupport,
        variations, variationLines,
        invoices, purchaseOrders,
        publicHolidays,
        activeProjectId: pid,
      })

      let ac = 0
      let ev = 0
      const wbsActuals: Record<string, { actuals: number; sell: number }> = {}
      for (const [code, row] of Object.entries(agg)) {
        ac += row.total
        ev += row.totalSell
        if (row.total || row.totalSell) {
          // Roll up to parent prefixes so e.g. "S.1.1.1" also contributes to
          // "S.1.1" and "S.1" and "S". Matches MikaPanel's per-row totals.
          rollupByPrefix(wbsActuals, code, row.total, row.totalSell)
        }
      }

      // ── PO commitments (canonical engine) ─────────────────────────────────
      const { byWbs: committedByWbs } = buildPoCommitments(
        purchaseOrders,
        invoices,
        hireItems,
        cars,
        accommodation,
        resources as unknown as PoCommitmentResource[],
        (activeProject || {}) as PoCommitmentProject,
      )
      const poCommitted = Object.values(committedByWbs).reduce((s, v) => s + v, 0)
      // Roll up the committed map by prefix for tile use
      const wbsCommitted: Record<string, number> = {}
      for (const [code, val] of Object.entries(committedByWbs)) {
        if (val) rollupSingle(wbsCommitted, code, val)
      }

      // ── Time elapsed → Planned Value ─────────────────────────────────────
      const start = activeProject?.start_date
      const end = activeProject?.end_date
      const today = todayStr()
      let timeElapsedPct = 0
      let outageDay: number | null = null
      let daysToStart: number | null = null
      let daysToEnd: number | null = null
      if (start && end) {
        const totalDays = Math.max(1, daysBetween(start, end))
        const elapsedDays = Math.max(0, Math.min(totalDays, daysBetween(start, today)))
        timeElapsedPct = (elapsedDays / totalDays) * 100
        daysToStart = daysBetween(today, start)
        daysToEnd = daysBetween(today, end)
        if (today >= start) {
          outageDay = daysBetween(start, today) + 1
        }
      }
      const pv = bac * (timeElapsedPct / 100)

      // ── Invoice totals (raw) ─────────────────────────────────────────────
      // NOTE: InvoiceStatus type doesn't include 'paid' but runtime allows it
      // (legacy data + status_history transitions). We treat both approved and
      // paid as "approved/paid" for cashflow display.
      const isApproved = (s: string) => s === 'approved' || s === 'paid'
      const isPending = (s: string) => s === 'received' || s === 'checked'
      const invoiced = invoices.reduce((s, i) => s + (i.amount || 0), 0)
      const invoicedApproved = invoices
        .filter(i => isApproved(i.status as unknown as string))
        .reduce((s, i) => s + (i.amount || 0), 0)
      const invoicedPending = invoices
        .filter(i => isPending(i.status as unknown as string))
        .reduce((s, i) => s + (i.amount || 0), 0)

      // ── EVM indices ──────────────────────────────────────────────────────
      const cpi = ac > 0.01 ? ev / ac : null
      const spi = pv > 0.01 ? ev / pv : null
      const eac = cpi != null && cpi > 0.01 ? ac + (bac - ev) / cpi : null
      const vac = eac != null ? bac - eac : null
      const vacPct = vac != null && bac > 0.01 ? (vac / bac) * 100 : null
      const tcpi = (bac - ac) > 0.01 && bac > 0.01 ? (bac - ev) / (bac - ac) : null

      const progressPct = bac > 0.01 ? (ev / bac) * 100 : 0
      const burnPct = bac > 0.01 ? (ac / bac) * 100 : 0

      // ── Composite health score ────────────────────────────────────────────
      let score = 100
      const issues: { label: string; severity: 'red' | 'amber' }[] = []

      if (cpi != null) {
        if (cpi < 0.9) { score -= 25; issues.push({ label: `CPI ${cpi.toFixed(2)} — cost overrun trending`, severity: 'red' }) }
        else if (cpi < 1.0) { score -= 10; issues.push({ label: `CPI ${cpi.toFixed(2)} — slightly over budget`, severity: 'amber' }) }
      }
      if (spi != null) {
        if (spi < 0.9) { score -= 20; issues.push({ label: `SPI ${spi.toFixed(2)} — behind schedule`, severity: 'red' }) }
        else if (spi < 1.0) { score -= 8; issues.push({ label: `SPI ${spi.toFixed(2)} — slightly behind schedule`, severity: 'amber' }) }
      }
      if (vacPct != null) {
        if (vacPct < -10) { score -= 15; issues.push({ label: `EAC projects ${Math.abs(vacPct).toFixed(0)}% overrun`, severity: 'red' }) }
        else if (vacPct < -3) { score -= 6; issues.push({ label: `EAC projects ${Math.abs(vacPct).toFixed(0)}% overrun`, severity: 'amber' }) }
      }
      if (invoicedPending > 0 && bac > 0) {
        const pendPct = (invoicedPending / bac) * 100
        if (pendPct > 5) { score -= 5; issues.push({ label: `${invoicedPending.toLocaleString('en-AU', { maximumFractionDigits: 0 })} of invoices pending approval`, severity: 'amber' }) }
      }

      score = Math.max(0, Math.min(100, Math.round(score)))

      return {
        bac, pm100, pm80, variationUplift,
        ev, ac, pv,
        poCommitted, invoiced, invoicedApproved, invoicedPending,
        cpi, spi, eac, vac, vacPct, tcpi,
        timeElapsedPct, progressPct, burnPct,
        outageDay, daysToStart, daysToEnd,
        healthScore: score,
        healthIssues: issues,
        wbsActuals, wbsCommitted,
      }
    },
    enabled: !!projectId && !!activeProject,
    // Heavy compute — cache for 60s, gc 5min after unused
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })
}
