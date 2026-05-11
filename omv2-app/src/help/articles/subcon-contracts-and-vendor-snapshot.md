---
slug: subcon-contracts-and-vendor-snapshot
title: Subcontractor Contracts & Vendor Snapshot
category: Subcontractors
order: 30
summary: Awarded RFQs become POs through the regular Purchase Orders panel filtered to subcontractor scope. The Vendor Snapshot rolls up total spend per vendor across all cost categories.
relatedPanels: [subcon-contracts, subcon-vendor-snapshot, subcon-dashboard]
---

# Subcontractor Contracts & Vendor Snapshot

After an RFQ is awarded, three things happen: the awarded vendor gets a PO, their crew gets timesheets, and their invoices flow through. None of those are subcontractor-specific panels — they reuse the same panels everyone uses, just filtered or scoped to subcontractor data.

Three smaller things live in dedicated subcontractor panels: the **Contracts** view, the **Vendor Snapshot**, and the **Subcon Dashboard**.

## From awarded RFQ to contract

Once an RFQ is awarded, the next step is to raise a PO against the awarded vendor:

1. Open **Subcontractors → Contracts** (or use **Cost Tracking → POs** — both routes hit the same panel)
2. **+ New PO** with the awarded vendor's details
3. Use the vendor's quoted labour/equipment rates from the RFQ response
4. Once raised, link the RFQ document to the PO so the audit trail is complete (the RFQ stage advances to **Contracted**)

The full PO lifecycle — statuses, line items, currency, invoicing — is covered in [POs, Invoices & Variations](pos-invoices-variations). The Contracts view *is* the Purchase Orders panel; there's no separate workflow.

## Linking subcontractor resources to POs

Subcontractor *people* (the individuals working under the contract) should be linked to the PO via `linked_po_id` on each resource. This is covered in [Resources & Roles](resources-and-roles). Unlinked subcontractors show in red on the Resources panel — they're effectively orphaned cost that won't reconcile properly against committed PO spend.

## Subcontractor Timesheets

The **Subcontractor Timesheets** panel (Personnel → Timesheets → Subcon) handles hours for subcontractor crew. Same workflow as the other timesheet variants — see [Timesheets](timesheets) — with one difference: the timesheet header has a **vendor + PO** field so each weekly sheet is tied to a specific subcontractor contract.

## Subcontractor Invoices

Vendor invoices for subcontractor work flow through the regular **Invoices** panel — see [POs, Invoices & Variations](pos-invoices-variations). Each invoice links to the subcontractor PO, status flows the same way (Received → Checked → Approved), and once Approved it flows into PTD Actuals on MIKA.

## Vendor Snapshot

Open via **Subcontractors → Vendor Snapshot**. A cost summary across **all vendors** on the project — not just subcontractors.

### What it shows

Per vendor:

| Column | Source |
|---|---|
| **Vendor** | Vendor name |
| **Contracts** | Count of POs |
| **Contract Value** | Sum of `po_value` across all POs |
| **Invoiced** | Sum of invoice amounts (matched by `vendor_ref`) |
| **Hire Cost** | Sum of hire item costs |
| **Car Cost** | Sum of car hire costs |
| **Accom Cost** | Sum of accommodation costs |
| **Total** | Sum of all the above |

Rows are sorted by total spend descending — biggest vendors at the top. Grand total at the top right.

### When to use it

- Quick check of "who are we spending the most with on this project?"
- Vendor performance reviews — which vendors actually got invoiced after the PO was raised
- Tax or compliance reporting where you need a per-vendor breakdown across all cost categories

The view is read-only; data flows in from the source panels (POs, Invoices, Hire, Cars, Accommodation).

## Subcon Dashboard

Open via **Subcontractors → Dashboard**. Tile-based overview of subcontractor activity, using the same dashboard framework as the main project Dashboard.

Quick links across the top jump to:

- **📄 RFQ Register**
- **+ New RFQ**
- **📋 POs**

Tile customisation works the same way — drag to reorder, gear icons for tile settings, layout saved per user.
