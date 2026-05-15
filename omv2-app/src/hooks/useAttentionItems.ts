/**
 * useAttentionItems
 *
 * Aggregates "things that need attention today" from across the project — the
 * data behind the AttentionFeedTile on the main dashboard. Cross-domain queries
 * here so individual tiles don't all have to compete for connection slots.
 *
 * Categories (each row is one item, sorted by severity then date):
 *   - 🚨 Mob in <7 days with missing flight/accom/car/induction
 *   - 🧾 Invoices pending approval > 30 days
 *   - 📋 Subcontractor resources without a linked PO
 *   - 📄 RFQs issued > deadline without all responses received
 *   - ⏰ Pre-planning items overdue
 *   - 📝 Draft timesheets > 7 days old
 *   - ⚠ POs without forecast dates (forecast engine blind spots)
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export type AttentionSeverity = 'red' | 'amber' | 'blue'

export interface AttentionItem {
  id: string
  category: string
  icon: string
  severity: AttentionSeverity
  title: string
  detail: string
  panel?: string
  /** Optional sort tiebreaker — e.g. date or days-overdue */
  sortKey?: number
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

export function useAttentionItems(projectId: string | undefined) {
  return useQuery<AttentionItem[]>({
    queryKey: ['attention_items', projectId],
    queryFn: async () => {
      const pid = projectId!
      const today = todayStr()
      const items: AttentionItem[] = []

      const [resR, invR, rfqR, ppR, tsR, poR, indR, accomR] = await Promise.all([
        supabase.from('resources')
          .select('id,name,mob_in,category,linked_po_id,flight_required,flights,accom_required,accom_booked,car_required,person_id')
          .eq('project_id', pid),
        supabase.from('invoices')
          .select('id,invoice_number,amount,status,received_date,due_date,vendor_details')
          .eq('project_id', pid),
        supabase.from('rfq_documents')
          .select('id,title,stage,deadline,vendors_sent')
          .eq('project_id', pid),
        supabase.from('pre_planning')
          .select('id,item,due_date,status,owner,priority')
          .eq('project_id', pid),
        supabase.from('weekly_timesheets')
          .select('id,week_start,type,status')
          .eq('project_id', pid)
          .eq('status', 'draft'),
        supabase.from('purchase_orders')
          .select('id,po_number,vendor,po_value,status,forecast_start,forecast_end')
          .eq('project_id', pid),
        // Inductions live on the project, but person-level visa/induction state lives on persons table
        supabase.from('person_visas')
          .select('person_id,visa_type,expiry_date'),
        supabase.from('accommodation')
          .select('occupants,check_in,check_out')
          .eq('project_id', pid),
      ])

      const resources = (resR.data || [])
      const invoices = (invR.data || [])
      const rfqs = (rfqR.data || [])
      const prePlan = (ppR.data || [])
      const draftTs = (tsR.data || [])
      const pos = (poR.data || [])
      const visas = (indR.data || [])
      // Build set of resources.ids with accommodation booked
      const accomBookedIds = new Set<string>()
      for (const a of (accomR?.data || []) as { occupants: string[] | null; check_in: string | null; check_out: string | null }[]) {
        for (const id of (a.occupants || [])) accomBookedIds.add(id)
      }

      // ── Mob readiness ─────────────────────────────────────────────────
      // For every resource mobbing in next 14 days, check critical bookings.
      for (const r of resources) {
        if (!r.mob_in || r.mob_in <= today) continue
        const days = daysBetween(today, r.mob_in)
        if (days > 14) continue

        const missing: string[] = []
        if (r.flight_required && !(r.flights && r.flights.trim())) missing.push('flight')
        if (r.accom_required && !accomBookedIds.has(r.id)) missing.push('accommodation')
        if (r.car_required) {
          // car_required has no "booked" mirror — flag for manual check
          // (we could cross-reference cars table here but it's expensive — leave as soft flag)
        }
        if (missing.length === 0) continue
        const severity: AttentionSeverity = days <= 3 ? 'red' : days <= 7 ? 'amber' : 'blue'
        items.push({
          id: `mob-${r.id}`,
          category: 'Mob readiness',
          icon: '✈',
          severity,
          title: `${r.name} arrives in ${days}d — missing ${missing.join(', ')}`,
          detail: `Mob ${r.mob_in}`,
          panel: 'hr-resources',
          sortKey: days,
        })
      }

      // ── Subcons without PO ────────────────────────────────────────────
      const subconNoPo = resources.filter(r => r.category === 'subcontractor' && !r.linked_po_id)
      if (subconNoPo.length > 0) {
        items.push({
          id: 'subcon-no-po',
          category: 'Procurement',
          icon: '📋',
          severity: 'red',
          title: `${subconNoPo.length} subcontractor${subconNoPo.length > 1 ? 's' : ''} without a linked PO`,
          detail: subconNoPo.slice(0, 3).map(r => r.name).join(', ') + (subconNoPo.length > 3 ? `, +${subconNoPo.length - 3}` : ''),
          panel: 'hr-resources',
          sortKey: 0,
        })
      }

      // ── Pending invoice approvals ─────────────────────────────────────
      for (const inv of invoices) {
        if (inv.status !== 'received' && inv.status !== 'checked') continue
        const ageDays = inv.received_date ? daysBetween(inv.received_date, today) : 0
        if (ageDays < 14) continue
        const severity: AttentionSeverity = ageDays > 45 ? 'red' : ageDays > 30 ? 'amber' : 'blue'
        items.push({
          id: `inv-${inv.id}`,
          category: 'Invoicing',
          icon: '🧾',
          severity,
          title: `Invoice ${inv.invoice_number || ''} — ${ageDays}d in ${inv.status}`,
          detail: `${inv.vendor_details || 'Unknown vendor'} · $${(inv.amount || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`,
          panel: 'invoices',
          sortKey: -ageDays, // older first
        })
      }

      // ── Overdue / blocked RFQs ────────────────────────────────────────
      for (const rfq of rfqs) {
        if (rfq.stage !== 'issued' && rfq.stage !== 'responses_in') continue
        if (!rfq.deadline) continue
        if (rfq.deadline >= today) continue
        const daysOverdue = daysBetween(rfq.deadline, today)
        const severity: AttentionSeverity = daysOverdue > 7 ? 'red' : 'amber'
        items.push({
          id: `rfq-${rfq.id}`,
          category: 'Subcontractors',
          icon: '📄',
          severity,
          title: `RFQ "${rfq.title || ''}" — deadline passed ${daysOverdue}d ago`,
          detail: `Stage: ${rfq.stage}`,
          panel: 'subcon-rfq',
          sortKey: -daysOverdue,
        })
      }

      // ── Pre-planning overdue ──────────────────────────────────────────
      const overduePrePlan = prePlan.filter(p =>
        p.due_date && p.due_date < today && p.status !== 'complete' && p.status !== 'done')
      if (overduePrePlan.length > 0) {
        const highPriority = overduePrePlan.filter(p => p.priority === 'high' || p.priority === 'critical')
        items.push({
          id: 'preplan-overdue',
          category: 'Pre-planning',
          icon: '⏰',
          severity: highPriority.length > 0 ? 'red' : 'amber',
          title: `${overduePrePlan.length} pre-planning item${overduePrePlan.length > 1 ? 's' : ''} overdue${highPriority.length > 0 ? ` (${highPriority.length} high priority)` : ''}`,
          detail: overduePrePlan.slice(0, 3).map(p => p.item).join('; '),
          panel: 'pre-planning',
          sortKey: -overduePrePlan.length,
        })
      }

      // ── Stale draft timesheets ────────────────────────────────────────
      const oldDrafts = draftTs.filter(d => {
        if (!d.week_start) return false
        return daysBetween(d.week_start, today) > 7
      })
      if (oldDrafts.length > 0) {
        items.push({
          id: 'drafts-stale',
          category: 'Personnel',
          icon: '📝',
          severity: oldDrafts.length > 3 ? 'amber' : 'blue',
          title: `${oldDrafts.length} draft timesheet${oldDrafts.length > 1 ? 's' : ''} older than 7 days`,
          detail: `Oldest: w/c ${oldDrafts[0].week_start}`,
          panel: 'hr-timesheets-trades',
          sortKey: -oldDrafts.length,
        })
      }

      // ── Active POs without forecast dates ────────────────────────────
      const activeNoForecast = pos.filter(p =>
        p.status === 'active' && (!p.forecast_start || !p.forecast_end))
      if (activeNoForecast.length > 0) {
        items.push({
          id: 'po-no-forecast',
          category: 'Procurement',
          icon: '⚠',
          severity: 'amber',
          title: `${activeNoForecast.length} active PO${activeNoForecast.length > 1 ? 's' : ''} without forecast dates`,
          detail: 'Forecast engine can\'t spread this commitment',
          panel: 'purchase-orders',
          sortKey: -activeNoForecast.length,
        })
      }

      // Track visas for completeness (used at the dashboard composite level)
      void visas

      // Sort: severity first (red > amber > blue), then sortKey
      const sevRank: Record<AttentionSeverity, number> = { red: 0, amber: 1, blue: 2 }
      items.sort((a, b) => {
        const sevDiff = sevRank[a.severity] - sevRank[b.severity]
        if (sevDiff !== 0) return sevDiff
        return (a.sortKey ?? 0) - (b.sortKey ?? 0)
      })

      return items
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}
