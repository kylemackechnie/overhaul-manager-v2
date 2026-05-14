/**
 * useProjectHealth
 *
 * Single source of truth for the EVM-style project indices used across the
 * dashboards. Every health-related tile (Cost Snapshot, CPI, SPI, EAC, TCPI,
 * Project Health composite) reads from this hook so the numbers always agree.
 *
 * Data sources (all read-only from existing tables):
 *   - mika_wbs_lines        → BAC (PM100), client forecast (Forecast TC), PM80
 *   - timesheet_cost_lines  → labour AC (cost) and EV (sell, as proxy for earned value)
 *   - invoices              → invoiced / approved / paid actuals (Type B)
 *   - purchase_orders       → committed (in conjunction with invoices)
 *   - expenses              → small actuals
 *   - variations            → approved scope-uplift adjustment to BAC
 *   - projects.start/end    → time elapsed % for SPI baseline
 *
 * Note: this hook does NOT re-run the full wbsAggregator (heavy). It uses
 * MIKA as the budget baseline and rolls up actuals/commitments at the project
 * level. Where MikaPanel and Project Health disagree, MikaPanel is the deep
 * truth — Project Health is the executive summary.
 */

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/appStore'
import { supabase } from '../lib/supabase'

export interface ProjectHealth {
  /** Budget At Completion — total approved budget incl. approved variations */
  bac: number
  /** Budget At Completion — PM100 only, before variations */
  pm100: number
  /** PM80 — committed sell budget */
  pm80: number
  /** Approved variation value (uplift on BAC) */
  variationUplift: number

  /** Earned Value — sell value of work done to date (proxy via timesheet sell + approved invoice sell-equivalent) */
  ev: number
  /** Actual Cost — total cost incurred to date */
  ac: number
  /** Planned Value — straight-line BAC × % time elapsed */
  pv: number

  /** PO commitments outstanding (PO value − invoiced for that PO) */
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

  /** Composite health score (0–100) — used by the hero tile */
  healthScore: number
  /** Top reasons the health score isn't 100 — for the "why" expansion */
  healthIssues: { label: string; severity: 'red' | 'amber' }[]
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

export function useProjectHealth(projectId: string | undefined) {
  const { activeProject } = useAppStore()

  return useQuery<ProjectHealth>({
    queryKey: ['project_health', projectId],
    queryFn: async () => {
      const pid = projectId!

      const [mikaR, tclR, invR, poR, expR, varR] = await Promise.all([
        supabase.from('mika_wbs_lines').select('pm80,pm100,forecast_tc').eq('project_id', pid),
        supabase.from('timesheet_cost_lines').select('cost_labour,sell_labour,cost_allowances,sell_allowances,timesheet_status,work_date').eq('project_id', pid),
        supabase.from('invoices').select('amount,status,sell_price').eq('project_id', pid),
        supabase.from('purchase_orders').select('po_value,status').eq('project_id', pid),
        supabase.from('expenses').select('cost_ex_gst,sell_price,date').eq('project_id', pid),
        supabase.from('variations').select('value,sell_total,cost_total,status').eq('project_id', pid),
      ])

      const mika = (mikaR.data || []) as { pm80: number | null; pm100: number | null; forecast_tc: number | null }[]
      const tcl = (tclR.data || []) as { cost_labour: number | null; sell_labour: number | null; cost_allowances: number | null; sell_allowances: number | null; timesheet_status: string | null; work_date: string | null }[]
      const inv = (invR.data || []) as { amount: number | null; status: string; sell_price: number | null }[]
      const pos = (poR.data || []) as { po_value: number | null; status: string }[]
      const exp = (expR.data || []) as { cost_ex_gst: number | null; sell_price: number | null; date: string | null }[]
      const vars = (varR.data || []) as { value: number | null; sell_total: number | null; cost_total: number | null; status: string }[]

      // ── Budget ──────────────────────────────────────────────────────────
      const pm100 = mika.reduce((s, r) => s + (r.pm100 || 0), 0)
      const pm80 = mika.reduce((s, r) => s + (r.pm80 || 0), 0)
      const variationUplift = vars
        .filter(v => v.status === 'approved')
        .reduce((s, v) => s + (v.sell_total || v.value || 0), 0)
      const bac = pm100 + variationUplift

      // ── Actual Cost ─────────────────────────────────────────────────────
      // Approved labour + approved/paid invoices + expenses
      const labourCost = tcl
        .filter(l => l.timesheet_status === 'approved')
        .reduce((s, l) => s + (l.cost_labour || 0) + (l.cost_allowances || 0), 0)
      const invoiceActuals = inv
        .filter(i => i.status === 'approved' || i.status === 'paid')
        .reduce((s, i) => s + (i.amount || 0), 0)
      const expenseActuals = exp.reduce((s, e) => s + (e.cost_ex_gst || 0), 0)
      const ac = labourCost + invoiceActuals + expenseActuals

      // ── Earned Value ───────────────────────────────────────────────────
      // EV = sell value of work done. Labour sell + approved invoice sell + variation sell delivered
      // (sell ≈ earned value of revenue-side work performed)
      const labourEv = tcl
        .filter(l => l.timesheet_status === 'approved')
        .reduce((s, l) => s + (l.sell_labour || 0) + (l.sell_allowances || 0), 0)
      const invoiceEv = inv
        .filter(i => i.status === 'approved' || i.status === 'paid')
        .reduce((s, i) => s + (i.sell_price != null && i.sell_price !== 0 ? i.sell_price : (i.amount || 0)), 0)
      const expenseEv = exp.reduce((s, e) => s + (e.sell_price || e.cost_ex_gst || 0), 0)
      const ev = labourEv + invoiceEv + expenseEv

      // ── Time elapsed → Planned Value ───────────────────────────────────
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

      // ── Procurement totals ─────────────────────────────────────────────
      const invoiced = inv.reduce((s, i) => s + (i.amount || 0), 0)
      const invoicedApproved = inv
        .filter(i => i.status === 'approved' || i.status === 'paid')
        .reduce((s, i) => s + (i.amount || 0), 0)
      const invoicedPending = inv
        .filter(i => i.status === 'received' || i.status === 'checked')
        .reduce((s, i) => s + (i.amount || 0), 0)
      const poValueActive = pos
        .filter(p => p.status === 'active')
        .reduce((s, p) => s + (p.po_value || 0), 0)
      const poCommitted = Math.max(0, poValueActive - invoiced)

      // ── EVM indices ────────────────────────────────────────────────────
      const cpi = ac > 0.01 ? ev / ac : null
      const spi = pv > 0.01 ? ev / pv : null
      const eac = cpi != null && cpi > 0.01 ? ac + (bac - ev) / cpi : null
      const vac = eac != null ? bac - eac : null
      const vacPct = vac != null && bac > 0.01 ? (vac / bac) * 100 : null
      const tcpi = (bac - ac) > 0.01 && bac > 0.01 ? (bac - ev) / (bac - ac) : null

      const progressPct = bac > 0.01 ? (ev / bac) * 100 : 0
      const burnPct = bac > 0.01 ? (ac / bac) * 100 : 0

      // ── Composite health score ────────────────────────────────────────
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
      }
    },
    enabled: !!projectId && !!activeProject,
    staleTime: 60_000,
  })
}
