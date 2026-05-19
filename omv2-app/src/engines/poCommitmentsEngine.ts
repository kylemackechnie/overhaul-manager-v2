/**
 * poCommitmentsEngine.ts
 *
 * PO Committed = total approved PO value, attributed to WBS via line items.
 * Deducts approved invoices (already actuals, not committed).
 *
 * Simple rule: for each active/raised PO, committed = PO value - invoiced.
 * Split across WBS via line items (proportional by value).
 */

import type { PurchaseOrder, HireItem, Car, Accommodation, Invoice } from '../types'
import { fxRate } from '../lib/currency'

export interface PoCommitmentResource {
  id: string
  linked_po_id: string | null
  mob_in: string | null
  mob_out: string | null
  category: string | null
  rate_card?: unknown
  wbs?: string | null
}

export interface PoCommitmentProject {
  start_date?: string | null
  end_date?: string | null
  currency_rates?: unknown
}

interface PoLineItem {
  wbs?: string | null
  value?: number | string | null
  description?: string | null
}

export interface PoCommitmentWarning {
  type: 'no_wbs' | 'no_forecast_dates' | 'no_po_link' | 'no_rate_card_assumed_po'
  poId: string
  poNumber: string
  resourceName?: string
  message: string
}

export interface PoCommitmentsResult {
  byWbs: Record<string, number>
  warnings: PoCommitmentWarning[]
}

// Build invoiced totals per PO from approved invoices
function buildInvoicedByPo(invoices: Invoice[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const inv of invoices) {
    if (!inv.po_id) continue
    if (inv.status !== 'approved') continue
    result[inv.po_id] = (result[inv.po_id] || 0) + (Number(inv.amount) || 0)
  }
  return result
}

function resolvePoWbs(po: PurchaseOrder): string | null {
  const lineItems = ((po as unknown as { line_items?: unknown[] }).line_items || []) as PoLineItem[]
  for (const l of lineItems) {
    if (l.wbs) return l.wbs
  }
  return (po as unknown as { wbs?: string }).wbs || null
}

export function buildPoCommitments(
  purchaseOrders: PurchaseOrder[],
  invoices: Invoice[],
  _hireItems: HireItem[],
  _cars: Car[],
  _accommodation: Accommodation[],
  resources: PoCommitmentResource[],
  project: PoCommitmentProject,
): PoCommitmentsResult {
  const byWbs: Record<string, number> = {}
  const warnings: PoCommitmentWarning[] = []

  const invoicedTotalByPo = buildInvoicedByPo(invoices)

  // POs that are driven by subcon resources with mob dates — forecastEngine spreads
  // their full value day-by-day, so they must NOT appear in committed (would double-count in EAC).
  const posWithSubconResources = new Set<string>()
  for (const r of resources) {
    if (!r.linked_po_id || r.category !== 'subcontractor') continue
    const hasRateCard = !!r.rate_card
    if (hasRateCard) continue  // rate-card subcon is already in labour forecast
    posWithSubconResources.add(r.linked_po_id)
  }

  function addCommitment(wbs: string | null | undefined, amount: number) {
    if (!wbs || !amount) return
    byWbs[wbs] = (byWbs[wbs] || 0) + amount
  }

  for (const po of purchaseOrders) {
    if (!['raised', 'active'].includes(po.status)) continue
    const poValue = Number(po.po_value) || 0
    if (!poValue) continue

    // Skip POs driven by subcon resources — forecastEngine covers them via mob-date spread.
    // Including them in committed would double-count in EAC (actuals + committed + forecast).
    if (posWithSubconResources.has(po.id)) continue

    // FX conversion
    const poCurrency = po.currency || 'AUD'
    const fx = poCurrency !== 'AUD' ? fxRate(project as unknown as Parameters<typeof fxRate>[0], poCurrency) : 1
    const poValueAud = poValue * fx

    // Committed = PO value minus already-invoiced (those are actuals, not committed)
    const invoicedTotal = invoicedTotalByPo[po.id] || 0
    const committed = Math.max(0, poValueAud - invoicedTotal)
    if (!committed) continue

    // Attribute to WBS via line items
    const lineItems = ((po as unknown as { line_items?: unknown[] }).line_items || []) as PoLineItem[]
    const totalLineValue = lineItems.reduce((s, l) => s + (Number(l.value) || 0), 0)

    if (lineItems.length > 0 && totalLineValue > 0) {
      for (const line of lineItems) {
        const lineValue = Number(line.value) || 0
        if (!lineValue) continue
        const lineShare = lineValue / totalLineValue
        const wbs = line.wbs || resolvePoWbs(po)
        if (!wbs) {
          warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, message: `PO ${po.po_number} line "${line.description}": no WBS code` })
        }
        addCommitment(wbs, committed * lineShare)
      }
    } else {
      const wbs = resolvePoWbs(po)
      if (!wbs) {
        warnings.push({ type: 'no_wbs', poId: po.id, poNumber: po.po_number, message: `PO ${po.po_number}: no WBS on PO or any line item` })
      }
      addCommitment(wbs, committed)
    }
  }

  return { byWbs, warnings }
}
