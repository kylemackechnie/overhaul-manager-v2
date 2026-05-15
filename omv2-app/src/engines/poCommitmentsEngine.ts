/**
 * poCommitmentsEngine.ts
 *
 * Calculates committed PO costs by WBS for the EAC model.
 *
 * Three PO types:
 *
 *  Type B — PO has linked bookings (hire_items, cars, accommodation)
 *    Cost estimate = sum of booking costs for that PO
 *    When approved invoice covers a period → invoice amount replaces booking sum
 *
 *  Subcon — PO has linked resources (no rate card) via resource.linked_po_id
 *    Cost estimate = PO value spread across resource mob_in → mob_out
 *    Invoice override same as Type B
 *
 *  Type C — Standalone PO (no bookings, no resources)
 *    Cost estimate = PO value spread across forecast_start → forecast_end
 *    (fallback: raised_date → closed_date, or project span)
 *    Split by WBS via PO line items
 *    Invoice override same as Type B
 *
 * Returns: { byWbs: Record<string, number> } — committed cost per WBS code.
 * Only includes the uninvoiced portion (remaining commitment).
 */

import type { PurchaseOrder, HireItem, Car, Accommodation, Invoice } from '../types'
import { fxRate } from '../lib/currency'

export interface PoCommitmentResource {
  id: string
  linked_po_id: string | null
  mob_in: string | null
  mob_out: string | null
  wbs: string
  category: string
  rate_card?: unknown // if rate_card exists, labour is already in forecast — skip
}

export interface PoCommitmentProject {
  start_date?: string | null
  end_date?: string | null
  currency_rates?: unknown
  [key: string]: unknown
}

interface PoLineItem {
  id?: string
  description?: string
  wbs?: string
  value?: number
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000
  ))
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Approved invoice totals per PO ────────────────────────────────────────────

function buildInvoicedByPo(invoices: Invoice[]): Record<string, number> {
  const byPo: Record<string, number> = {}
  for (const inv of invoices) {
    if (!inv.po_id) continue
    if (inv.status !== 'approved') continue
    byPo[inv.po_id] = (byPo[inv.po_id] || 0) + (Number(inv.amount) || 0)
  }
  return byPo
}

// How much of an invoice's amount overlaps a given period [start, end]?
function invoiceOverlapAmount(inv: Invoice, periodStart: string, periodEnd: string): number {
  if (!inv.period_from || !inv.period_to) return 0
  const iStart = inv.period_from
  const iEnd   = inv.period_to
  // No overlap
  if (iEnd < periodStart || iStart > periodEnd) return 0
  // Full overlap
  if (iStart <= periodStart && iEnd >= periodEnd) return Number(inv.amount) || 0
  // Partial overlap — prorate by days
  const invDays    = daysBetween(iStart, iEnd) + 1
  const overlapStart = iStart > periodStart ? iStart : periodStart
  const overlapEnd   = iEnd < periodEnd ? iEnd : periodEnd
  const overlapDays  = daysBetween(overlapStart, overlapEnd) + 1
  return ((Number(inv.amount) || 0) * overlapDays) / invDays
}

// Approved invoices for a PO that overlap a given period
function invoicedAmountForPeriod(
  poId: string,
  periodStart: string,
  periodEnd: string,
  invoicesByPo: Record<string, Invoice[]>,
): number {
  const invs = invoicesByPo[poId] || []
  return invs.reduce((sum, inv) => sum + invoiceOverlapAmount(inv, periodStart, periodEnd), 0)
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PoCommitmentsResult {
  byWbs: Record<string, number>   // committed cost per WBS (excluding invoiced portions)
  warnings: PoCommitmentWarning[]
}

export interface PoCommitmentWarning {
  type: 'no_wbs' | 'no_forecast_dates' | 'no_po_link' | 'no_rate_card_assumed_po'
  poId?: string
  poNumber?: string
  resourceName?: string
  message: string
}

export function buildPoCommitments(
  purchaseOrders: PurchaseOrder[],
  invoices: Invoice[],
  hireItems: HireItem[],
  cars: Car[],
  accommodation: Accommodation[],
  resources: PoCommitmentResource[],
  project: PoCommitmentProject,
): PoCommitmentsResult {
  const byWbs: Record<string, number> = {}
  const warnings: PoCommitmentWarning[] = []

  // Build lookup maps
  const invoicesByPo: Record<string, Invoice[]> = {}
  for (const inv of invoices) {
    if (!inv.po_id) continue
    if (inv.status !== 'approved') continue
    if (!invoicesByPo[inv.po_id]) invoicesByPo[inv.po_id] = []
    invoicesByPo[inv.po_id].push(inv)
  }
  const invoicedTotalByPo = buildInvoicedByPo(invoices)

  // Which POs have linked bookings?
  const poHasBookings = new Set<string>()
  for (const h of hireItems) {
    if ((h as HireItem & { linked_po_id?: string | null }).linked_po_id)
      poHasBookings.add((h as HireItem & { linked_po_id?: string | null }).linked_po_id!)
  }
  for (const c of cars) {
    if ((c as Car & { linked_po_id?: string | null }).linked_po_id)
      poHasBookings.add((c as Car & { linked_po_id?: string | null }).linked_po_id!)
  }
  for (const a of accommodation) {
    if ((a as Accommodation & { linked_po_id?: string | null }).linked_po_id)
      poHasBookings.add((a as Accommodation & { linked_po_id?: string | null }).linked_po_id!)
  }

  // Which POs have linked subcon resources (no rate card)?
  const subconResourcesByPo: Record<string, PoCommitmentResource[]> = {}
  for (const r of resources) {
    if (!r.linked_po_id) continue
    if (r.category !== 'subcontractor') continue
    if (r.rate_card) continue  // has rate card → already in labour forecast
    if (!subconResourcesByPo[r.linked_po_id]) subconResourcesByPo[r.linked_po_id] = []
    subconResourcesByPo[r.linked_po_id].push(r)
  }
  const poHasSubconResources = new Set(Object.keys(subconResourcesByPo))

  function addCommitment(wbs: string | null | undefined, amount: number) {
    if (!wbs || !amount) return
    byWbs[wbs] = (byWbs[wbs] || 0) + amount
  }

  // Project fallback dates
  const projStart = (project.start_date as string | null) || new Date().toISOString().slice(0, 10)
  const projEnd   = (project.end_date as string | null)   || addDays(projStart, 90)

  for (const po of purchaseOrders) {
    if (!['raised', 'active'].includes(po.status)) continue
    const poValue  = Number(po.po_value) || 0
    if (!poValue) continue

    // FX conversion: if PO is in a foreign currency, convert to AUD
    const poCurrency = po.currency || 'AUD'
    const fx = poCurrency !== 'AUD' ? fxRate(project as unknown as Parameters<typeof fxRate>[0], poCurrency) : 1
    const poValueAud = poValue * fx

    const invoicedTotal = (invoicedTotalByPo[po.id] || 0)
    const remainingCommitment = Math.max(0, poValueAud - invoicedTotal)

    // ── Type B: PO has linked bookings ──────────────────────────────────────
    if (poHasBookings.has(po.id)) {
      // Collect all bookings for this PO and their period/cost
      type BookingPeriod = { start: string; end: string; cost: number; wbs: string }
      const bookingPeriods: BookingPeriod[] = []

      for (const h of hireItems) {
        const hAny = h as HireItem & { linked_po_id?: string | null; wbs?: string }
        if (hAny.linked_po_id !== po.id) continue
        if (!h.start_date || !h.end_date) continue
        const hireCost = Number(h.hire_cost) || 0
        if (!hireCost) continue
        bookingPeriods.push({
          start: h.start_date,
          end:   h.end_date,
          cost:  hireCost * fx,
          wbs:   hAny.wbs || '',
        })
      }
      for (const c of cars) {
        const cAny = c as Car & { linked_po_id?: string | null; wbs?: string }
        if (cAny.linked_po_id !== po.id) continue
        if (!c.start_date || !c.end_date) continue
        const carCost = Number(c.total_cost) || 0
        if (!carCost) continue
        bookingPeriods.push({
          start: c.start_date,
          end:   c.end_date,
          cost:  carCost * fx,
          wbs:   cAny.wbs || '',
        })
      }
      for (const a of accommodation) {
        const aAny = a as Accommodation & { linked_po_id?: string | null; wbs?: string }
        if (aAny.linked_po_id !== po.id) continue
        if (!a.check_in || !a.check_out) continue
        const accomCost = Number(a.total_cost) || 0
        if (!accomCost) continue
        bookingPeriods.push({
          start: a.check_in,
          end:   a.check_out,
          cost:  accomCost * fx,
          wbs:   aAny.wbs || '',
        })
      }

      if (!bookingPeriods.length) continue

      // Total booking cost for this PO
      const totalBookingCost = bookingPeriods.reduce((s, b) => s + b.cost, 0)

      for (const bp of bookingPeriods) {
        // How much of this booking period is covered by approved invoices?
        const invoicedForPeriod = invoicedAmountForPeriod(po.id, bp.start, bp.end, invoicesByPo)
        // This booking's share of any invoice coverage (proportional by cost)
        const bookingShare = totalBookingCost > 0 ? bp.cost / totalBookingCost : 0
        const invoicedShare = invoicedForPeriod * bookingShare
        const committed = Math.max(0, bp.cost - invoicedShare)
        const wbs = bp.wbs || resolvePoWbs(po)
        if (!wbs) {
          warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, message: `PO ${po.po_number}: booking has no WBS code` })
        }
        addCommitment(wbs, committed)
      }

      // Also process subcon resources linked to same PO (e.g. rates PO with both dry hire and labour)
      if (poHasSubconResources.has(po.id)) {
        const subconRes = subconResourcesByPo[po.id]
        const totalMobDays = subconRes.reduce((sum, r) => {
          if (!r.mob_in || !r.mob_out) return sum
          return sum + daysBetween(r.mob_in, r.mob_out)
        }, 0)
        for (const r of subconRes) {
          if (!r.mob_in || !r.mob_out) continue
          const mobDays = daysBetween(r.mob_in, r.mob_out)
          const resourceShare = totalMobDays > 0 ? mobDays / totalMobDays : 1 / subconRes.length
          // Use the remaining PO value minus bookings already accounted for
          const bookingTotal = bookingPeriods.reduce((s, b) => s + b.cost, 0)
          const remainingAfterBookings = Math.max(0, poValueAud - invoicedTotal - bookingTotal)
          const committed = remainingAfterBookings * resourceShare
          const wbs = r.wbs || resolvePoWbs(po)
          if (!wbs) {
            warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, resourceName: r.id, message: `PO ${po.po_number}: subcon resource has no WBS` })
          }
          addCommitment(wbs, committed)
        }
      }

      continue
    }

    // ── Subcon resources (no rate card, linked to PO) ────────────────────────
    if (poHasSubconResources.has(po.id)) {
      const subconRes = subconResourcesByPo[po.id]
      // Total planned mob days across all resources on this PO
      const totalMobDays = subconRes.reduce((sum, r) => {
        if (!r.mob_in || !r.mob_out) return sum
        return sum + daysBetween(r.mob_in, r.mob_out) + 1
      }, 0)
      if (!totalMobDays) continue

      const dailyRate = poValueAud / totalMobDays

      for (const r of subconRes) {
        if (!r.mob_in || !r.mob_out) continue
        const mobDays = daysBetween(r.mob_in, r.mob_out) + 1
        const resourceCost = dailyRate * mobDays
        // Invoice override: how much of this resource's period is invoiced?
        const invoicedForPeriod = invoicedAmountForPeriod(po.id, r.mob_in, r.mob_out, invoicesByPo)
        const resourceShare = poValueAud > 0 ? resourceCost / poValueAud : 0
        const invoicedShare = invoicedForPeriod * resourceShare
        const committed = Math.max(0, resourceCost - invoicedShare)
        const wbs = r.wbs || resolvePoWbs(po)
        if (!wbs) {
          warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, resourceName: r.id, message: `PO ${po.po_number}: subcon resource has no WBS` })
        }
        addCommitment(wbs, committed)
      }
      continue
    }

    // ── Type C: Standalone PO ────────────────────────────────────────────────
    // Resolve spread window
    const spreadStart = po.forecast_start || po.raised_date || projStart
    const spreadEnd   = po.forecast_end   || po.closed_date  || projEnd

    if (!po.forecast_start && !po.raised_date) {
      warnings.push({ type: 'no_forecast_dates', poId: po.id, poNumber: po.po_number, message: `PO ${po.po_number}: no forecast dates or raised date — cannot spread cost` })
    }

    // Resolve WBS from line items or top-level WBS
    const lineItems = ((po as unknown as { line_items?: unknown[] }).line_items || []) as PoLineItem[]
    const totalLineValue = lineItems.reduce((s, l) => s + (Number(l.value) || 0), 0)

    if (lineItems.length > 0 && totalLineValue > 0) {
      // Split by line item WBS
      for (const line of lineItems) {
        const lineValue = Number(line.value) || 0
        if (!lineValue) continue
        const lineShare = lineValue / totalLineValue
        const lineValueAud = poValueAud * lineShare
        const invoicedShare = invoicedTotal * lineShare
        const committed = Math.max(0, lineValueAud - invoicedShare)
        const wbs = line.wbs || resolvePoWbs(po)
        if (!wbs) {
          warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, message: `PO ${po.po_number} line "${line.description}": no WBS code` })
        }
        addCommitment(wbs, committed)
      }
    } else {
      // No line items — use full PO value against top-level WBS
      const committed = remainingCommitment
      const wbs = resolvePoWbs(po)
      if (!wbs) {
        warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, message: `PO ${po.po_number}: no WBS on PO or any line item` })
      }
      addCommitment(wbs, committed)
    }

    void spreadStart; void spreadEnd // used for future time-series breakdown
  }

  return { byWbs, warnings }
}

// ── WBS resolution for a PO ───────────────────────────────────────────────────

function resolvePoWbs(po: PurchaseOrder): string | null {
  // Check line items first
  const lineItems = ((po as unknown as { line_items?: unknown[] }).line_items || []) as PoLineItem[]
  for (const l of lineItems) {
    if (l.wbs) return l.wbs
  }
  // Fall back to a wbs field on the PO itself if it exists
  return (po as PurchaseOrder & { wbs?: string }).wbs || null
}
