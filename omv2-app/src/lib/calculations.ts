/**
 * Core calculation functions matching HTML app logic exactly.
 * All functions here are pure — no side effects, no DB calls.
 */

// ─── Hire / Cost helpers ───────────────────────────────────────────────────

export function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  return Math.max(0, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

export function calcCustomerPrice(cost: number, gmPct: number): number {
  if (gmPct >= 100 || gmPct <= 0) return cost
  return parseFloat((cost / (1 - gmPct / 100)).toFixed(2))
}

// ─── calcHireCostForPeriod ─────────────────────────────────────────────────
// Pro-rates hire items linked to a PO across a given date window.
// Returns total cost that falls within [fromDate, toDate].

export interface HireItemForPeriod {
  id: string
  linked_po_id: string | null
  start_date: string | null
  end_date: string | null
  hire_cost: number
  daily_rate: number | null
  weekly_rate: number | null
  charge_unit: string | null
  qty: number | null
  transport_in: number | null
  transport_out: number | null
}

export function calcHireCostForPeriod(
  items: HireItemForPeriod[],
  poId: string,
  fromDate: string,
  toDate: string
): { total: number; breakdown: { name?: string; days: number; cost: number }[] } {
  const linked = items.filter(h => h.linked_po_id === poId && h.start_date)
  if (!linked.length) return { total: 0, breakdown: [] }

  const periodStart = new Date(fromDate)
  const periodEnd = new Date(toDate)
  let total = 0
  const breakdown: { name?: string; days: number; cost: number }[] = []

  for (const h of linked) {
    const hStart = new Date(h.start_date!)
    const hEnd = h.end_date ? new Date(h.end_date) : new Date(toDate)

    // Overlap of hire period with PO period
    const overlapStart = hStart > periodStart ? hStart : periodStart
    const overlapEnd = hEnd < periodEnd ? hEnd : periodEnd

    if (overlapStart > overlapEnd) continue

    const totalDays = daysBetween(h.start_date, h.end_date || toDate) || 1
    const overlapDays = daysBetween(
      overlapStart.toISOString().slice(0, 10),
      overlapEnd.toISOString().slice(0, 10)
    ) || 1

    // Pro-rate transport separately (not per day)
    const transport = ((h.transport_in || 0) + (h.transport_out || 0))
    const hireCostOnly = h.hire_cost - transport

    const proratedCost = (hireCostOnly * overlapDays / totalDays) +
      (overlapDays === totalDays ? transport : 0) // Only include transport if full period covered

    total += proratedCost
    breakdown.push({ days: overlapDays, cost: proratedCost })
  }

  return { total, breakdown }
}

// ─── calcApprovedSubconCost ────────────────────────────────────────────────
// Sum of approved subcontractor timesheet weeks linked to a PO.

export interface SubconWeek {
  id: string
  po_id: string | null
  status: string
  type: string
  week_start: string
  crew: { name: string; role: string; days: Record<string, unknown> }[]
  regime: string
}

export function calcApprovedSubconCost(
  weeks: SubconWeek[],
  poId: string,
  fromDate: string,
  toDate: string,
  rateCards: { role: string; rates: { cost: Record<string, number> }; regime: { ge12?: boolean } | null }[]
): { total: number; hours: number } {
  const linked = weeks.filter(w => {
    if (w.type !== 'subcon' || w.status !== 'approved' || w.po_id !== poId) return false
    const wEnd = new Date(w.week_start)
    wEnd.setDate(wEnd.getDate() + 6)
    return w.week_start <= toDate && wEnd.toISOString().slice(0, 10) >= fromDate
  })

  let total = 0, hours = 0
  for (const w of linked) {
    for (const m of w.crew || []) {
      for (const [, day] of Object.entries(m.days || {})) {
        const de = day as Record<string, unknown>
        hours += (de.hours as number) || 0
        // Simple cost: hours × DNT rate from rate card
        const rc = rateCards.find(r => r.role === m.role)
        const dntRate = rc?.rates?.cost?.dnt || 0
        total += ((de.hours as number) || 0) * dntRate
      }
    }
  }
  return { total, hours }
}

// ─── calcRentalCost ────────────────────────────────────────────────────────
// TV rental cost based on replacement value × rental% × duration.
// Mirrors the HTML calcRentalCost exactly.

export interface TvCosting {
  charge_start: string | null
  charge_end: string | null
  sell_override?: number | null
}

export interface ToolingDept {
  rental_pct: number      // % of replacement value per week
  rate_unit: 'weekly' | 'daily' | 'monthly'
  gm_pct: number
  rates?: { costPerDay?: number; sellPerDay?: number }
}

export function calcRentalCost(
  replacementValue: number,
  costing: TvCosting,
  dept: ToolingDept
): { days: number; weeklyRate: number; cost: number; sell: number } | null {
  if (!costing.charge_start || !costing.charge_end) return null

  const days = daysBetween(costing.charge_start, costing.charge_end)
  if (!days) return null

  const factor = (dept.rental_pct || 0) / 100
  const weeklyRate = replacementValue * factor
  let cost = 0

  if (dept.rate_unit === 'weekly') cost = (days / 7) * weeklyRate
  else if (dept.rate_unit === 'daily') cost = days * (weeklyRate / 7)
  else if (dept.rate_unit === 'monthly') cost = (days / 30.44) * (weeklyRate * 4.33)

  const gm = dept.gm_pct || 0
  let sell = gm > 0 ? cost / (1 - gm / 100) : cost

  if (costing.sell_override) {
    const r = costing.sell_override
    if (dept.rate_unit === 'weekly') sell = (days / 7) * r
    else if (dept.rate_unit === 'daily') sell = days * r
    else if (dept.rate_unit === 'monthly') sell = (days / 30.44) * r
  }

  return { days, weeklyRate, cost, sell }
}

// ─── calcCartTotal ─────────────────────────────────────────────────────────
// Hardware cart total from line items with escalation.

export interface CartLine {
  escalated_price: number | null
  transfer_price: number | null
  discounted_price: number | null
  qty_ordered: number | null
  qty: number | null
  list_price: number | null
}

export function calcCartTotal(lines: CartLine[]): {
  escalated: number
  transfer: number
  customer: number
} {
  return {
    escalated: lines.reduce((s, l) => s + (l.escalated_price || 0) * (l.qty_ordered || l.qty || 0), 0),
    transfer:  lines.reduce((s, l) => s + (l.transfer_price || 0) * (l.qty_ordered || l.qty || 0), 0),
    customer:  lines.reduce((s, l) => s + (l.discounted_price || l.escalated_price || 0) * (l.qty_ordered || l.qty || 0), 0),
  }
}

// ─── applyEscalation ──────────────────────────────────────────────────────
// Apply escalation factor to a base price.

export function applyEscalationFactor(basePrice: number, factor: number): number {
  return parseFloat((basePrice * factor).toFixed(2))
}

export function calcYoyChange(current: number, previous: number | null): number | null {
  if (!previous || previous === 0) return null
  return parseFloat(((current / previous - 1) * 100).toFixed(2))
}

// ─── PO spend tracking ─────────────────────────────────────────────────────

export function calcPoSpend(invoices: { amount: number; status: string; po_id: string }[], poId: string): {
  invoiced: number
  approved: number
  pending: number
} {
  const linked = invoices.filter(i => i.po_id === poId)
  const invoiced = linked.reduce((s, i) => s + (i.amount || 0), 0)
  const approved = linked
    .filter(i => i.status === 'approved' || i.status === 'paid')
    .reduce((s, i) => s + (i.amount || 0), 0)
  return { invoiced, approved, pending: invoiced - approved }
}
