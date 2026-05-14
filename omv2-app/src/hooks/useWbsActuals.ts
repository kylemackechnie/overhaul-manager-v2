/**
 * useWbsActuals
 *
 * Lightweight per-WBS actuals rollup for dashboard tiles. NOT a replacement
 * for the canonical wbsAggregator (which is heavy and reads ~12 tables) —
 * this is the executive-summary version that pulls only the three biggest
 * cost sources: approved labour, approved/paid invoices, and expenses.
 *
 * Returns a map of WBS code → {actuals, sell, count}.
 *
 * For the deep view, users open MIKA Cost Plan or the Cost Register.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface WbsActualsRow {
  wbs: string
  actuals: number
  sell: number
  /** count of contributing line items */
  count: number
}

export interface WbsActualsResult {
  /** Keyed by WBS code, no entry if no actuals against that code */
  byWbs: Record<string, WbsActualsRow>
  /** Unallocated actuals — lines with no WBS */
  unallocated: WbsActualsRow
  /** Sum of all actuals (including unallocated) */
  total: number
}

export function useWbsActuals(projectId: string | undefined) {
  return useQuery<WbsActualsResult>({
    queryKey: ['wbs_actuals', projectId],
    queryFn: async () => {
      const pid = projectId!

      const [tclR, invR, poR, expR] = await Promise.all([
        // Approved labour cost lines
        supabase.from('timesheet_cost_lines')
          .select('wbs,cost_labour,sell_labour,cost_allowances,sell_allowances,timesheet_status')
          .eq('project_id', pid)
          .eq('timesheet_status', 'approved'),
        // Approved/paid invoices
        supabase.from('invoices')
          .select('amount,sell_price,status,sap_wbs,po_id')
          .eq('project_id', pid)
          .in('status', ['approved', 'paid']),
        // POs (for invoice WBS resolution fallback)
        supabase.from('purchase_orders')
          .select('id,line_items,wbs_codes')
          .eq('project_id', pid),
        // Expenses
        supabase.from('expenses')
          .select('wbs,cost_ex_gst,sell_price')
          .eq('project_id', pid),
      ])

      const tcl = (tclR.data || []) as { wbs: string | null; cost_labour: number | null; sell_labour: number | null; cost_allowances: number | null; sell_allowances: number | null }[]
      const inv = (invR.data || []) as { amount: number | null; sell_price: number | null; sap_wbs: string | null; po_id: string | null }[]
      const pos = (poR.data || []) as { id: string; line_items: unknown; wbs_codes: unknown }[]
      const exp = (expR.data || []) as { wbs: string | null; cost_ex_gst: number | null; sell_price: number | null }[]

      const byWbs: Record<string, WbsActualsRow> = {}
      const unallocated: WbsActualsRow = { wbs: '__unallocated', actuals: 0, sell: 0, count: 0 }

      const ensure = (w: string): WbsActualsRow => {
        if (!byWbs[w]) byWbs[w] = { wbs: w, actuals: 0, sell: 0, count: 0 }
        return byWbs[w]
      }

      // ── Labour ──────────────────────────────────────────────────────────
      for (const l of tcl) {
        const cost = (l.cost_labour || 0) + (l.cost_allowances || 0)
        const sell = (l.sell_labour || 0) + (l.sell_allowances || 0)
        if (cost === 0 && sell === 0) continue
        const target = l.wbs ? ensure(l.wbs) : unallocated
        target.actuals += cost
        target.sell += sell
        target.count++
      }

      // ── Build a PO-id → WBS resolver from line items ───────────────────
      const poWbs = new Map<string, string>()
      for (const p of pos) {
        // 1. line_items[].wbs_code (preferred)
        const items = Array.isArray(p.line_items) ? p.line_items : []
        const firstLineWbs = items.find((li: { wbs_code?: string }) => li && li.wbs_code)?.wbs_code as string | undefined
        // 2. po.wbs_codes top-level (fallback)
        const topWbsCodes = Array.isArray(p.wbs_codes) ? p.wbs_codes as string[] : []
        const fallback = firstLineWbs || topWbsCodes[0]
        if (fallback) poWbs.set(p.id, fallback)
      }

      // ── Invoices ────────────────────────────────────────────────────────
      for (const i of inv) {
        const cost = i.amount || 0
        const sell = i.sell_price != null && i.sell_price !== 0 ? i.sell_price : cost
        if (cost === 0 && sell === 0) continue
        const wbs = i.sap_wbs || (i.po_id ? poWbs.get(i.po_id) : undefined)
        const target = wbs ? ensure(wbs) : unallocated
        target.actuals += cost
        target.sell += sell
        target.count++
      }

      // ── Expenses ────────────────────────────────────────────────────────
      for (const e of exp) {
        const cost = e.cost_ex_gst || 0
        const sell = e.sell_price || cost
        if (cost === 0) continue
        const target = e.wbs ? ensure(e.wbs) : unallocated
        target.actuals += cost
        target.sell += sell
        target.count++
      }

      let total = unallocated.actuals
      for (const w of Object.values(byWbs)) total += w.actuals

      return { byWbs, unallocated, total }
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}
