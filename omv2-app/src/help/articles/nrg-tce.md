---
slug: nrg-tce
title: NRG TCE Method
category: NRG Gladstone
order: 10
summary: The NRG TCE (Total Contract Estimate) method links invoices, expenses, timesheets, and variations to a TCE scope register — enabling customer-facing invoicing, actuals tracking, and evidence reports.
relatedPanels: [nrg-tce, nrg-actuals, nrg-invoicing, nrg-kpi, nrg-reports, nrg-dashboard]
---

# NRG TCE Method

The **NRG TCE method** is a project-level setting that enables a customer-facing cost tracking layer on top of the standard WBS system. It is designed for projects where costs must be reported against a **Total Contract Estimate (TCE)** register and invoiced to the customer by scope item.

## Enabling the TCE method

Go to **Project Settings → Scope Tracking** and set **Cost Method** to **NRG TCE — Total Contract Estimate method**.

Once enabled, the following become visible throughout the system:

- TCE Item ID fields on invoices, expenses, PO lines, and variations
- The NRG Gladstone ribbon group (TCE Register, OH Forecast, WO Actuals, Customer Invoicing, KPI Model, Reports)
- Split line item sections on invoices and expenses
- The NRG TCE scope option in timesheets

Disabling the method hides all of the above but **does not delete any data** — all TCE allocations, line items, and actuals remain intact in the database.

## TCE Register

Open via **Site → TCE Register**.

The TCE Register is the master scope document. Each line represents a deliverable or cost category agreed with the customer. Lines are organised by item ID (e.g. `2.02.4.13`) and include:

- **Description** — scope of work
- **Work Order** — the NRG work order reference
- **Contract Scope** — the contract grouping
- **Unit Type** — rates, fixed price, cost plus
- **Estimated Qty** — scoped quantity
- **TCE Rate** — agreed rate per unit
- **TCE Total** — scoped value (Est Qty × TCE Rate)
- **Committed** — current PO committed value against this line
- **Actual Cost** — what has been spent to date (labour + invoices + expenses + variations)
- **KPI** — whether this line is included in the KPI model

### Actuals calculation

Actual cost for each TCE line aggregates from four sources:

1. **Timesheet cost lines** — approved labour allocated to this item via the NRG TCE scope selector in timesheets
2. **Invoices** — approved/paid invoices with this `tce_item_id` (uses sell price when set, otherwise amount)
3. **Expenses** — chargeable expenses with this `tce_item_id` (uses sell price)
4. **Variations** — approved variations linked to this TCE item

**Split line items:** if an invoice or expense is split into line items, each child line contributes to whichever TCE item it is linked to. The parent invoice/expense with `tce_item_id = null` is excluded — only the lines count.

### Drilldown

Click any **Actual Cost** figure to open a drilldown showing exactly what makes up that number:

- For labour lines: per-person, per-day breakdown with hours and sell value; also shows any invoices or expenses tagged to the same line
- For non-labour lines: invoices and expenses listed with reference, description, date, and amount; plus any linked variations

### Importing the TCE

Use **Import TCE** (top right) to load a TCE register from a CSV or Excel export. This populates the `nrg_tce_lines` table and enables the TCE item dropdowns throughout the system.

## Customer Invoicing panel

Open via **Site → Customer Invoicing**.

This panel maps TCE scope items to NRG customer invoices (the invoices raised to NRG, not from suppliers). Each column represents one customer invoice (identified by week ending date and label). Rows show how much of each scope item falls within that invoice's period.

### Setting up customer invoices

Use the **+ Invoice** button to create a new customer invoice record with:

- **Label** — e.g. "No. 2 Fortnightly Invoice"
- **Week Ending** — the period end date
- **EUR Spot Rate** — if any EUR-denominated labour applies

### Cost breakdown drilldown

Click any period total to see a **Cost Breakdown** modal showing:

- **Timesheet Costs (Approved)** — labour by week
- **Supplier Invoices** — approved invoices in period, showing sell price
- **Expenses** — chargeable expenses in period, showing sell price

Only **approved/paid** supplier invoices and **chargeable** expenses appear here.

### TCE XLSX Export

The **Export TCE** button generates the NRG TCE Excel template pre-filled with actuals. Week column headers show the customer invoice label and week ending date — e.g. `No. 2 Fortnightly Invoice - WE 19/04/2026 - Actual Hours`. This applies to both the Skilled Labour and Overheads sheets.

Select which invoice weeks to include before exporting.

## NRG Expenses Report

Open via **Site → NRG Reports → NRG Expenses Report**.

A customer-facing evidence report showing all chargeable receipts and invoices with their SPOL filing reference, TCE allocation, cost price, sell price, and GM%.

### Filters

- **Date range** — From / To date pickers filter by the expense or invoice date
- **Search** — filter by ref, vendor, or TCE item
- **All Chargeable / Non-chargeable** — default shows only chargeable items; switch to Non-chargeable for internal review

### Columns

| Column | Source |
|---|---|
| Type | Expense or Invoice |
| Date | Expense date or invoice date |
| SPOL / ISO Filing Ref | Auto-assigned reference number |
| TCE Item | Linked TCE scope item |
| TCE Description | Description from the TCE register |
| Vendor / Description | Supplier name and description |
| Cost Price | What was paid (cost ex GST for expenses; amount for invoices) |
| Sell Price | What is charged to the customer |
| GM % | Margin applied |
| Chargeable | Yes/No |

**Only Approved/Paid invoices appear.** Non-chargeable items are hidden by default.

### Export to CSV

The **Export to CSV** button downloads the filtered and visible rows, including all columns above. Respects active date range and chargeable filter.

## NRG Actuals panel

Open via **Site → WO Actuals**.

Shows approved labour actuals by TCE item and week, drawn from `timesheet_cost_lines`. Used to reconcile labour against the TCE register.

## NRG KPI panel

Shows KPI-flagged TCE lines with their scoped vs actual performance. Lines must have `kpi_included = true` in the TCE register to appear here.

## TCE allocation in timesheets

When the NRG TCE method is active and a TCE register has been imported, timesheet cells show a scope allocation selector with an **NRG TCE** option. Selecting this allows hours for that week/person to be allocated to a specific TCE item ID. These allocations are written to `timesheet_cost_lines` on timesheet save and feed into TCE actuals immediately.
