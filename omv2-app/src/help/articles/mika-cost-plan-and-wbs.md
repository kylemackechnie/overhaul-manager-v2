---
slug: mika-cost-plan-and-wbs
title: MIKA Cost Plan & WBS
category: Cost Tracking
order: 10
summary: MIKA is the financial backbone — importing it populates PM80/PM100 budgets, the full WBS hierarchy, and PTD actuals that every other cost panel reads from. The WBS list is the simplified view.
relatedPanels: [cost-mika, wbs-list]
relatedTour: mika-tour
---

# MIKA Cost Plan & WBS

Every project's financial structure starts with a **MIKA cost plan import**. The WBS hierarchy, PM80 and PM100 budgets, and PTD actuals all originate from MIKA — other panels (WBS list, Cost Report, Forecast/EAC, Cost Dashboard) read from this data. Get MIKA right and the rest of the cost tracking flows automatically.

## Importing a MIKA cost plan

Go to **Cost Tracking → MIKA**. Drag and drop the CSV export from SAP MIKA's Project Planning main tab, or click to browse. The import auto-detects the WBS Element header row.

Importing **replaces all existing MIKA data** for the project — you can re-import freely as the plan updates. The system shows a preview before committing.

## What gets imported

- **PM80 Baseline** — pessimistic/baseline budget per WBS line
- **PM100 Budget** — approved target budget per WBS line
- **PTD Actuals** — period-to-date spend per SAP
- **Full WBS hierarchy** — levels L2 through L5
- **Monthly forecast spread** — for the EAC calculations

On import, the WBS list (covered below) is wiped and rebuilt from MIKA so the two stay in sync.

## The MIKA panel layout

When MIKA data exists, the panel shows:

- **KPI cards** across the top: PM80 Baseline, PM100 Budget, PTD Actuals, PO Committed, EAC (calc), Variance
- **Project metadata strip** — project number, period, import date, line count
- **Filters** — search by WBS code or description, level filter (L2 Top / L3 Summary / L4 Detail / L5 Full)
- **Full WBS table** with columns for each WBS line: code, description, level, PM80, PM100, Approved VNs, Pending VNs, Revised Budget, PTD Actuals, PO Committed, Forecast TC, EAC (calc), Variance, % Spent

The full EAC formula (`Actuals + PO Committed + Forecast`) and how variations feed the revised budget are covered in the **Forecast & EAC** article.

## Drill-down

Click any cost value in the MIKA table — PTD Actuals, PO Committed, Forecast TC, or EAC — to open a breakdown modal for that WBS line. The modal shows the contributing cost lines grouped by category (labour, hire, cars, accommodation, tooling, expenses, etc.) with each line item listed individually. Useful for tracing back to the source when a number looks off.

## What counts as Actuals

PTD Actuals on MIKA reflects **realised cost only** — money that has actually been spent or is owed:

- Approved timesheets (labour cost from `timesheet_cost_lines`)
- Approved invoices for hire, cars, accommodation, tooling rental, and freight (booking the item is plan, not actual — the invoice flips it to actual)
- Expenses (booked as actuals on entry)
- Approved variation lines that have been delivered
- Back office hours

Bookings for hire, cars, accommodation, and tooling do **not** count as actuals until invoiced. The booking value sits in Plan / Forecast TC until the supplier invoice is approved, then moves into PTD Actuals. This was a deliberate change to align with how SAP tracks spend.

## Data quality warnings

A yellow strip at the top of the MIKA table flags cost items missing a WBS code or forecast dates — these are excluded from EAC calcs. The first three are listed inline; the rest are summarised as "…and N more". Useful for catching incomplete data before reporting on it.

## The WBS list panel

The **WBS list** (Cost Tracking → WBS or Project → WBS) is a simplified flat view of the same data. Columns:

- WBS Code, Description
- PM80 Budget, PM100 Budget (from MIKA)
- Actuals (computed live from the same sources as MIKA — approved timesheets, invoices, expenses, etc. — see "What counts as Actuals" above)
- Variance — green if PM100 > Actuals, red if over

Use it for quick reference or to spot-check budget levels without the full MIKA detail. Same data, less noise.

## Manual WBS additions

The WBS panel has Add / Edit / Delete buttons and a **Bulk Import** textarea (one WBS per line, tab or comma separated). These exist for cases where you need codes that aren't in MIKA, but it's rare — typically MIKA is the source.

Manually added codes coexist with MIKA-sourced ones. The system records the source so MIKA re-syncs don't wipe your manual additions inappropriately.

## Sync from MIKA

If the WBS list drifts out of sync (e.g. someone manually added rows, then MIKA was re-imported), the **↺ Sync from MIKA** button rebuilds the WBS list from current MIKA data. The button is also surfaced on the empty state when no WBS exists but MIKA data does — one click to populate.

The WBS panel also has a **📊 MIKA Import** button at the top — same import as the MIKA panel, surfaced here for convenience. Use whichever panel you're already on.

## PM80 vs PM100 terminology

- **PM80** — the baseline / pessimistic budget. The original commitment.
- **PM100** — the approved target. What the project is actually working to.

Variance = PM100 − Actuals. Green when under, red when over. The Revised Budget on the MIKA panel adds approved variations on top of PM100.
