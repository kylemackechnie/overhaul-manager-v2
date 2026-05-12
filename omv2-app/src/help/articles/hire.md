---
slug: hire
title: Hire (Dry / Wet / Local)
category: Logistics & Hardware
order: 10
summary: Three hire types share one panel — Dry (equipment only), Wet (equipment + crew with shift calendar), Local (intermittent use with active days). Bookings are plan; invoices flip them to actual.
relatedPanels: [hire-dashboard, hire-dry, hire-wet, hire-local, hire-reports]
---

# Hire (Dry / Wet / Local)

Equipment hire splits into three types — Dry, Wet, and Local Equipment — each with its own panel route but all running through the same `HirePanel` component. Same UI shape, different rules.

Hire bookings are **planning data** under the current cost model. They appear on the Forecast page and in the Cost Register, but **do not** flow into PTD Actuals on MIKA until an approved invoice posts against the linked PO. See [POs, Invoices & Variations](pos-invoices-variations) for the invoice-to-actual flow.

## The three types

| Type | Icon | Best for | Distinguishing features |
|---|---|---|---|
| **Dry Hire** | 🚜 | Equipment only | Simple cost/sell, no operator |
| **Wet Hire** | 🏗️ | Equipment + operator(s) | Shift rates, daily allowance, calendar, crew |
| **Local Equipment** | 🧰 | Intermittent use | Active days field — calculates cost from days actually used, not full duration |

The Personnel ribbon has separate entries for each. The Hire ribbon mirrors them, plus a Dashboard and Reports.

## Common fields

All three types share:

- **Name / Description** — what it is
- **Vendor** — who supplies it
- **Start / End dates** — booking window
- **Cost / Sell totals** — what we pay, what we charge
- **GM%** — derived margin
- **Currency** — AUD / EUR / USD / GBP / NZD
- **Transport In / Transport Out** — separate from hire cost
- **PO link** — the audit trail to the supplier contract
- **Notes** — free text

## Dry Hire

The simplest form. One vehicle, one excavator, one generator — equipment with no operator. Cost and sell totals are entered directly.

## Wet Hire

Equipment plus operator(s). The panel adds:

### Shift rates

Six rate buckets covering different shift / day combinations:

- **DS** — Day Shift
- **NS** — Night Shift
- **WDS** — Weekend Day Shift
- **WNS** — Weekend Night Shift
- **SDD** — Standdown DS (equipment idle but charged at the daytime standdown rate)
- **SDN** — Standdown NS (equipment idle but charged at the night standdown rate)

Each bucket is a rate (per crew, per shift). The system uses these alongside the shift calendar to compute cost.

### DAA rate

Daily Available Allowance — the standing daily rate applied regardless of whether the equipment was used. Some wet hire contracts charge a minimum per day even on idle days.

### Crew list

For wet hire, the operator names and roles are captured on the hire item itself (not on Resources). Add as many crew rows as the contract requires.

### Shift calendar

Each wet hire item has a per-date shift calendar. For every working day in the range, tick which shift type was worked (DS / NS / WDS / etc.). The system multiplies the appropriate shift rate by the count of each shift type, adds DAA × calendar days, and produces the total cost.

The calendar is stored as JSONB on the hire item, so it persists between sessions and feeds the forecast engine.

### Transport

Separate Transport In and Transport Out values for the equipment mobilisation / demobilisation. Not included in shift rates.

## Local Equipment

For intermittent-use items that don't run every day of the engagement. Two relevant fields:

- **Active days** — how many days the equipment was actually used in the window
- **Daily rate** — rate per active day

Cost is `active_days × daily_rate`. Useful for items that sit idle most of the time (specialised lifting gear, occasional cranes, etc.).

## Bulk Link to PO

Tick the checkbox column on multiple hire items and use the **🔗 Link to PO** button to assign them all to the same PO at once. Faster than editing each item individually when you've raised one PO covering several items from the same vendor.

## Plan vs Actual

This is the most important thing to understand about hire data:

- **Adding a hire item** = creating a plan record. The cost appears on Forecast, on the Cost Register, and contributes to the EAC's Forecast TC.
- **Linking the item to a PO** = converting plan to committed. The cost moves from Forecast TC to PO Committed on MIKA.
- **Approving the supplier invoice** (under Cost Tracking → Invoices) = converting committed to actual. The cost flows into PTD Actuals on MIKA and shows on the Cost Summary Report.

If you want to see what's been booked but not yet invoiced, look at the Forecast page or Cost Register. If you want to see what's actually been spent, look at MIKA's PTD Actuals or the Cost Summary.

This change was introduced in the Phase 2 actuals refactor — previously hire bookings counted as actuals on entry, which didn't match what finance saw in SAP. The current model aligns with SAP-side spend.

## Hire Reports

Open via **Hire → Reports**. Four report types as selectable tiles:

- **📊 Weekly Cost Summary** — all hire items listed with duration and costs. The default.
- **📅 Monthly Breakdown** — costs by item broken down by month. Useful for cash-flow forecasting.
- **🏢 Vendor Spend** — totals grouped by vendor. Useful when reviewing which suppliers got the most spend.
- **💵 Customer Charge Report** — customer pricing for all hire items — what the client sees.

Each report has CSV export. Header KPIs show item count, total cost, total sell, and GM%.

## Hire Dashboard

Open via **Hire → Dashboard**. Same tile-based framework as the main Dashboard, scoped to hire-focused tiles. Use the gear icons on each tile for tile-level settings; the layout is saved per user.
