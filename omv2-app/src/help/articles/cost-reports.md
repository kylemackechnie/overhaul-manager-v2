---
slug: cost-reports
title: Cost Reports
category: Cost Tracking
order: 60
summary: Five panels for slicing cost data — the Cost Summary by WBS, the Customer Report for client distribution, the Cost Dashboard for an at-a-glance view, the Cost Register for raw transactions, and the Reports Database for saved snapshots.
relatedPanels: [cost-report, cost-customer-report, cost-dashboard, cost-register, reports-db]
---

# Cost Reports

Five different panels exist for looking at cost data, each tuned for a different purpose. Knowing which one to reach for is half the battle.

| Panel | When to use |
|---|---|
| **Cost Summary Report** | Internal cost-vs-sell view by WBS — for project review meetings |
| **Customer Report** | Sell-side report formatted for the client |
| **Cost Dashboard** | Tile-based at-a-glance view for a quick health check |
| **Cost Register** | Raw ledger — for finding specific transactions |
| **Reports Database** | Saved report snapshots for the historical record |

All five read from the same underlying data; they're different lenses on it.

## Cost Summary Report

Open via **Cost Tracking → Reports** (the summary report). Shows cost-vs-sell by WBS code.

### View options

- **View dropdown** — "Project to date" (default) or a specific Mon–Sun week. Selecting a week pro-rates date-range items (hire, cars, accommodation, tooling) by days in the window; date-stamped sources (timesheets, expenses, back office, variations) are filtered to within the window.
- **↻ Refresh** — re-pulls everything
- **🖨 Print by Module** — printable version grouped by cost module (labour / hire / tooling / etc.)
- **🖨 Print by WBS** — printable version grouped by WBS code
- **⬇ Export CSV** — full data as CSV

### KPIs

Card row above the table shows Total Cost, Total Sell, Margin %, and breakdown by module.

### Warnings

A yellow strip appears at the top if timesheets exist but rate cards aren't configured for the roles used — labour will read $0 until rate cards are set up under **Personnel → Rate Cards**.

## Customer Report

Open via **Cost Tracking → Customer Report**. The sell-side view — what the client sees.

### Per-week or full-period

Same week filter as the Cost Summary, with the same pro-rating semantics.

### Currency display

A toggle controls how foreign costs are shown:

- **Split AUD+EUR** — shows AUD and EUR side by side (useful for SE AG support costs displayed in EUR alongside AUD trades labour)
- **All AUD** — everything converted to base currency for a single-number summary

The conversion uses the FX rates set in Project Settings.

### What's included

The report focuses on the **sell side** — what's invoiceable to the client. It draws from rate cards, hire markups, variations, and any other revenue-side data.

## Cost Dashboard

Open via **Cost Tracking → Dashboard**. Uses the same dashboard framework as the main project Dashboard, but scoped to cost-focused tiles.

Quick links across the top jump straight to Invoices, POs, Forecast, SAP Recon, Variations, and Expenses.

Tile-level customisation works the same way as the main Dashboard — drag to reorder, gear icons on tiles with their own settings, layout saved per user.

## Cost Register

Open via **Cost Tracking → Register**. The **raw ledger** — every cost item expanded to daily rows. Date-range hire items become one row per day, timesheets stay as one row per worked day, etc.

### When to use it

When you need to *find* a specific transaction rather than summarise. "Who worked Tuesday 12 March?", "What did we pay this vendor in week 5?", "Show me every WBS-X cost line."

### Filters

- Search across description, WBS, and reference
- Date range
- WBS filter
- Type filter (labour / hire / tooling / cars / accommodation / expenses / etc.)

Not a reporting tool — a search tool.

## Reports Database

Open via **Cost Tracking → Reports Database** (also in the File menu). Stores **saved snapshots** of reports.

### Why save snapshots

Reports are point-in-time. A Cost Summary printed today shows different numbers from one printed last week, because actuals keep accumulating. Saving a snapshot freezes the report content for the historical record — useful for:

- The monthly client status report (capture the version that was sent)
- A baseline at project mobilisation vs final cost (compare)
- Variation logs at specific decision points

### Report types

When creating a new saved report, pick a type:

- 📊 **Cost Report**
- 📝 **Variation Log**
- ⏱ **Timesheet Summary**
- 📄 **Custom**

The type tags the saved record so you can filter by it later.

### Snapshot Cost

The **📸 Snapshot Cost** button captures the current state of the Cost Summary Report as a saved record in one click — title, content, all baked in. Faster than typing it out.

### Custom reports

For anything that doesn't fit the built-in types, **+ New Report** opens an editor where you can type a title, pick a type, and paste or write content. Useful for meeting notes, manual reconciliation runs, or anything else worth keeping alongside the project record.
