---
slug: pos-invoices-variations
title: POs, Invoices & Variations
category: Cost Tracking
order: 40
summary: POs commit cost ahead of work; Invoices realise cost as work happens; Variations adjust the budget itself. All three feed the EAC on the MIKA panel.
relatedPanels: [purchase-orders, po-manager, invoices, variations]
---

# POs, Invoices & Variations

These three panels handle the **committed-cost workflow** — the actual money movements over the life of a project. They're distinct concepts that feed the EAC on the MIKA panel in different ways:

- **Purchase Orders** commit cost ahead of work being done. They show up as **PO Committed** in the EAC.
- **Invoices** realise cost as work happens and money is owed. They contribute to **PTD Actuals**.
- **Variations** adjust the budget itself when scope changes. Approved variations add to the **Revised Budget**.

## Purchase Orders

Open via **Cost Tracking → POs** (also reachable as "PO Manager" from the same routing — same panel).

### Status workflow

A PO moves through these statuses:

| Status | Meaning |
|---|---|
| **Draft** | Scope identified, quote not yet received |
| **Quoted** | Quote received, PO not yet raised in SAP |
| **Raised** | PO raised in SAP, work not yet started |
| **Active** | Work in progress, invoices being received |
| **Closed** | All invoicing reconciled, PO closed |
| **Cancelled** | Cancelled (dead end — no further transitions) |

The normal forward path is Draft → Quoted → Raised → Active → Closed. Active is the longest-lived state for most POs.

### PO types

- **Fixed Price** — single agreed value
- **Time & Materials** — billed against rates as work happens
- **Estimate** — placeholder for budgeting; not a firm commitment

### Multi-currency

POs can be raised in AUD, EUR, USD, GBP, or NZD. The base currency comes from Project Settings; FX rates set there convert foreign POs into base currency on cost reports.

### Per-line WBS

Each PO has a header (number, vendor, status, dates, currency, type) and one or more **lines**. Each line has its own WBS code, so a single PO can split cost across multiple WBS lines. This matters for accurate EAC commitment spread.

### Forecast date range

POs have an optional **Forecast Start** and **Forecast End**. These tell the forecast engine where in time to spread the uninvoiced PO value. Without them, the PO contributes a flat commitment but doesn't show in the day-by-day forecast.

### NRG TCE allocation

POs targeting NRG TCE scopes have an optional `tce_item_id` field that links the PO to a specific TCE scope item. This is used by the NRG TCE Register to show committed cost by scope rather than just by WBS.

## Invoices

Open via **Cost Tracking → Invoices**.

### Status workflow

Invoices follow a different lifecycle to POs:

| Status | Meaning |
|---|---|
| **Received** | Invoice arrived but not yet checked |
| **Checked** | Reviewed and matches the work delivered |
| **Approved** | Approved for payment |
| **Disputed** | Side-channel — issue raised, payment held |

Transitions: Received → Checked → Approved. Disputed can be entered from Received or Checked, and goes back to Checked when resolved. Approved is generally terminal (no forward transition).

### Status filter pills

Tabs across the top filter the table by status, with live counts per status. "All" shows everything. Useful for "show me everything Disputed right now" or "what's waiting to be checked".

### Per-PO linking

Each invoice can be linked to a PO (via PO ID), which lets the system compute invoiced-against-PO totals for the PO Manager view (planned vs actuals vs invoiced vs variance).

### SAP Import

**📥 SAP Import** button (top right) reads a SAP Excel export (.xlsx) and creates or updates invoice records in bulk. The matching logic finds existing invoices by vendor reference number and updates them; new ones are created. Useful for end-of-week reconciliation when finance has issued a batch.

### Columns

Default columns: Invoice #, Vendor Ref, PO, Status, Amount, Currency, Invoice Date, Due Date. The **⚙ Columns** button shows or hides additional columns. Column preferences are saved per user.

## Variations

Open via **Cost Tracking → Variations**.

### Status workflow

Variations move through a tighter set of states:

| Status | Meaning |
|---|---|
| **Draft** | Being prepared |
| **Submitted** | Sent to the client for approval |
| **Approved** | Client signed off — adds to Revised Budget |
| **Rejected** | Client declined |

Transitions: Draft → Submitted → Approved/Rejected. Rejected can go back to Draft for revision. Approved is terminal.

### Categories

Each variation is tagged with a cost category:

- Trades Labour
- Management Labour
- Subcon Labour
- Materials
- Equipment Hire
- Third Party Services
- Other

### Causes

Each variation also has a **cause** to document why it was needed:

- Client Instruction
- Design Change
- Latent Condition (something found on site that wasn't in scope)
- Scope Omission (something missed in the original quote)

### Per-line WBS and rate cards

Variation lines have their own WBS code and pull from the project's rate cards. The line totals roll up to a header sell and cost total. The header shows totals at a glance: approved $ and pending $.

### Credits and givebacks

Variation lines accept **negative hours and quantities** for credits or givebacks — when scope is removed, a deliverable is descoped, or a credit is owed to the client. Enter the hours or quantity as a negative number and the line totals (cost and sell) come out negative too. The variation header sums correctly, so a mixed-sign variation (some additions, some credits) gives you the net effect in one document.

Use this for client-initiated descopes or any case where a previously approved variation needs to be partially reversed without raising a separate credit note.

### Outputs

- **🖨 Print Register** — prints all variations as a summary report for client meetings
- Individual **Print Variation Notice** — a formal one-page document for each variation, ready to send

### How they feed the EAC

On the MIKA panel:

- **Approved VNs** column sums all approved variations per WBS line
- **Pending VNs** column shows submitted-but-not-approved (visibility only — doesn't affect calcs)
- **Revised Budget** = PM100 + Approved VNs

So an approved variation increases the budget the project is working to, and is therefore reflected in the EAC variance.

## How the three connect

A worked example:

1. New scope item identified mid-outage → raise a **Variation** (Draft → Submitted to client)
2. Client approves → Variation becomes Approved, Revised Budget on MIKA goes up
3. Quote received for the new work → raise a **PO** (Quoted → Raised → Active), now showing as PO Committed
4. Vendor invoices for completed work → record an **Invoice**, link to the PO, status flows Received → Checked → Approved
5. Invoice flows through to PTD Actuals on MIKA; PO Committed drops by the invoiced amount

End result: Revised Budget went up by the variation, EAC went up by what's been invoiced + remaining PO commitment + forecast. The variance shows how close to plan the change is being delivered.
