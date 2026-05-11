---
slug: forecast-and-eac
title: Forecast & EAC
category: Cost Tracking
order: 20
summary: Two views of the same engine — the Forecast panel projects day-by-day cost forward from planned resources and hire; the MIKA panel rolls that into the integrated Estimate At Completion alongside actuals and committed costs.
relatedPanels: [cost-forecast, cost-mika]
---

# Forecast & EAC

The Forecast and the EAC (Estimate At Completion) are two views of the same model. The **Forecast panel** answers *"how is cost going to land day by day if nothing changes?"*. The **MIKA panel** rolls that into the integrated EAC alongside actuals and committed costs — *"what's the total going to be when this is all done?"*.

Both panels share the same forecast engine. Importing or editing planned resources, hire, tooling, accommodation, cars, and expenses flows into both immediately.

## The Forecast panel

Open it via **Cost Tracking → Forecast**. The panel shows day-by-day projected cost from now to project end, grouped into weekly or monthly buckets.

### KPIs

Four cards across the top:

- **Total Cost** — what the project will cost from now to end
- **Total Sell** — revenue (cost × markup, factoring rate cards)
- **Margin %** — derived
- **Days Remaining** — calendar countdown

### Period and mode toggles

- **Weekly / Monthly** — how the day-by-day data rolls up. Weekly is the default for active projects; Monthly is useful for long-running ones.
- **View: Cost / Sell** — toggles every figure between cost and sell side.

### ⚙ Configure

The Configure button opens a panel of category checkboxes. Each toggles whether that category contributes to the forecast:

- 👷 Labour
- 🚜 Dry Hire
- 🏗 Wet Hire
- 🧰 Local Equipment
- 🔧 Tooling
- 🚗 Cars
- 🏨 Accommodation
- 🧾 Expenses

Useful for what-if analysis (e.g. "what if we cut accommodation in half?") or to focus a report on one cost type.

### Baselines

The **📸 Baseline** button snapshots the current forecast as a reference point.

- **Set Baseline** — captures the current grand cost, grand sell, and full breakdown
- **Show Baseline Comparison** — overlays the baseline on the forecast so you can see what's moved
- **Replace** — overwrites with a new snapshot
- **Clear** — removes the baseline

Baselines are useful for tracking forecast drift over the life of the project — set one at project start and compare weekly. The strip under the toolbar shows when the current baseline was captured and its grand totals.

### CSV export

Once data is loaded, **⬇ CSV** exports the period-bucketed forecast for further analysis in Excel.

## The EAC view (MIKA panel)

The EAC lives on the **MIKA panel** because it integrates the forecast with everything else. Once a MIKA cost plan is imported (see [MIKA Cost Plan & WBS](mika-cost-plan-and-wbs)), the panel shows the full picture per WBS line:

| Column | What it is |
|---|---|
| PM80 Budget | Baseline budget from MIKA |
| PM100 Budget | Approved budget from MIKA |
| Approved VNs | Sum of approved variations on this WBS |
| Pending VNs | Sum of submitted-but-not-yet-approved variations |
| Revised Budget | PM100 + Approved VNs |
| PTD Actuals | What's been spent so far (from MIKA + live cost lines) |
| PO Committed | Open commitments from active POs |
| Forecast TC | Forecast To Complete from the forecast engine |
| EAC (calc) | **Actuals + PO Committed + Forecast TC** |
| Variance | Revised Budget − EAC |
| % Spent | Actuals ÷ Revised Budget |

### The EAC formula

```
EAC = PTD Actuals + PO Committed + Forecast To Complete
```

This is what the project is *projected to cost in total* — money already spent, money committed to be spent (POs), plus the remaining forward forecast.

Compare EAC against the **Revised Budget** (PM100 plus approved variations) to get the variance. A red variance means you're projected to over-run; green means you're under.

### KPI summary

Six KPI cards above the table give the project-level rollup:

- PM80 Baseline
- PM100 Budget
- PTD Actuals
- PO Committed
- EAC (calc)
- Variance

This is the headline view for steering committee or client status meetings.

### Filtering

Search by WBS code or description; filter by level (L2 Top / L3 Summary / L4 Detail / L5 Full) to drill down or zoom out. Most reporting is done at L3 or L4.

## Data quality

If a PO is missing its WBS code or forecast start/end dates, it's **excluded** from EAC commitments — there's nowhere for it to spread to. The MIKA panel surfaces a yellow warning strip listing the first three problems with a count of the rest. Fix the POs (Cost Tracking → POs) and the EAC updates automatically.

Similarly, if rate cards aren't set up for roles used in timesheets, labour cost will read as $0 in the forecast and EAC. The Cost Summary Report flags this too.
