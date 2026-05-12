---
slug: hardware
title: Hardware
category: Logistics & Hardware
order: 30
summary: Track SE Germany hardware contracts (OPSA / SPASS), group line items into quotation carts, apply year-on-year price escalation, and report on transfer vs customer pricing.
relatedPanels: [hardware-dashboard, hardware-contract, hardware-carts, hardware-escalation, hardware-import, hardware-reports]
---

# Hardware

The Hardware module tracks **physical hardware deliverables from SE Germany** — typically supplied under OPSA or SPASS contracts. It's distinct from tooling (project-loan equipment) and spare parts (consumables for the outage).

Data lives in two places:

- **`hardware_contracts`** — one row per contract from SE Germany, with line items as JSONB
- **`projects.hardware`** — project-level blob storing carts and other hardware metadata

## Hardware Contract

Open via **Hardware → Contract**.

A contract captures:

- **Vendor** — typically Siemens Energy Germany
- **Contract Ref** — the OPSA/SPASS reference number
- **Description** — what the contract covers
- **Value** — total contract value
- **Currency** — defaults to **EUR** (SE Germany invoices in EUR)
- **Status** — Active / Pending / Complete / Cancelled
- **Valid From / Valid Until** — contract validity window
- **PO link** — link to the local PO once raised
- **Line items** — the parts list

### Line items

Each line item has:

- **Part Number** — Siemens material number
- **Description**
- **Qty**
- **Transfer Price** — what SE Germany charges us
- **Customer Price** — what we charge the client (after markup)

The margin per line is implicit — Customer Price minus Transfer Price.

Multiple contracts can exist per project (e.g. one OPSA for the gas turbine, another for the generator). Each is a separate row in `hardware_contracts`.

## Hardware Import (OPSA / SPASS XLSX)

Open via **Hardware → Import**. The fast way to create a contract — drop the Excel file from SE Germany.

### Expected file format

The contract Excel must have a **"Master" sheet** with:

- Metadata in header rows (debitor, contract type, valid dates, escalation factor, EPA number)
- A `Material Number` column header near row 17
- Line items starting from row 19

The panel parses these and shows a preview before committing. Metadata fields extracted:

- **Project / Debitor** — the SE customer code
- **Contract Type** — OPSA / SPASS / etc.
- **Valid From / Valid Until** — contract dates
- **Escalation Factor** — year-on-year price index (e.g. 1.0350)
- **EPA Number** — EPA reference

Once previewed, **Commit Import** creates a new contract record with all the line items pre-populated. You can then edit individual lines or the metadata if needed.

If parsing fails (wrong file format, missing Master sheet, no Material Number column), the panel surfaces the specific error.

## Hardware Carts

Open via **Hardware → Carts**. Carts are **groupings of line items for quotation tracking** — typically used when responding to a client RFQ that spans multiple hardware items.

A cart has:

- **Name** — e.g. "GT12 Combustion Parts"
- **Description** — free text
- **Status** — pending / quoted / approved / ordered / delivered
- **Items** — line items copied in from contracts (part no, description, qty, unit cost, escalated price, transfer price, discounted price, qty ordered)

Carts are stored as JSONB on `projects.hardware` (not a separate table), so they're scoped to the project and follow the project through duplication and migration.

Use the 5-stage status to track each cart through the client process — pending while you're building it, quoted when sent to client, approved when they sign off, ordered when raised in SAP, delivered when shipped.

## Hardware Escalation

Open via **Hardware → Escalation**.

OPSA contracts have year-on-year price escalation built in — SE Germany contracts allow for annual inflation adjustments to transfer prices. The escalation panel tracks the factor for each year so future projections use current pricing.

### Adding an escalation year

For each year, capture:

- **Year** — e.g. 2026
- **Factor** — multiplier (1.0350 = +3.5%)
- **Notes** — typically the contract update reference (e.g. "OPSA 2026 contract update")

The panel shows year-over-year change automatically and applies the factor to the project's contract value for what-if projections.

### Why this matters

When forecasting hardware spend that won't be ordered until next year (or the year after), the current transfer prices need to be inflated by the escalation factor to give a realistic forecast. Without this, hardware forecast would be systematically too low.

The escalation values are stored in the `hardware_escalation` table per project.

## Hardware Reports

Open via **Hardware → Reports**. Two report types:

- **Full Contract** — all line items across all contracts, with transfer vs customer pricing and totals
- **Price Comparison** — comparison view useful for justifying the markup or for client transparency

Both have CSV export. Header KPIs show total transfer value, total customer value, and the gap.

## Hardware Dashboard

Open via **Hardware → Dashboard**. Tile-based overview using the same dashboard framework as the main Dashboard. Quick links jump to the main hardware panels.

## Plan vs Actual

Like hire and accommodation, hardware contract values are **planning data** until invoiced. When SE Germany issues an invoice against a hardware PO and that invoice gets approved (under Cost Tracking → Invoices), the cost flips to actual on MIKA and the Cost Summary Report. Before invoicing, the contract value contributes to PO Committed (if a PO is linked) and Forecast TC (via the line items spread).

For more on the invoice → actual flow, see [POs, Invoices & Variations](pos-invoices-variations).
