---
slug: s-curve
title: S-Curve
category: Cost Tracking
order: 30
summary: Cumulative cost or revenue plotted over time. Forecast vs Actual area chart showing how the project is progressing against plan.
relatedPanels: [cost-scurve]
---

# S-Curve

The S-Curve plots **cumulative** cost or revenue over time. It's called an "S" because the shape is typical of projects — slow ramp-up at start, steep middle when work is in full swing, and a plateau as things wind down.

## What it shows

The chart has two area series overlaid:

- **Forecast (cumulative)** — blue. The sum of all forecasted weekly costs from project start to date.
- **Actual (cumulative)** — green. The sum of all realised costs from project start to date.

A vertical dashed line marks **Today** for reference.

The gap between the two lines at "Today" tells you how the project is tracking — if Actual is below Forecast you're behind plan (or under-spending); if Actual is above you're either ahead of schedule or over-spending. Reading that gap correctly takes a bit of context — labour ramp-up timing, accrued-vs-invoiced lag, etc.

## KPIs

Four cards above the chart:

- **Total Forecast** — grand total cumulative forecast at project end
- **Actual to Date** — cumulative actual through today
- **% Complete (by value)** — Actual ÷ Forecast as a percentage. Note: this is *value* progress, not *physical* progress.
- **Remaining** — Total Forecast − Actual to Date

## Cost vs Sell

The toggle in the top right switches every figure and series between **Cost** (what we spend) and **Sell (Revenue)** (what we invoice). The chart shape is similar but the absolute numbers and any margin movements show through differently.

## Note on baselines

The S-Curve doesn't have its own baseline feature — for baseline comparison, set one on the **Forecast panel** with the 📸 button. Both panels read from the same forecast engine, so a baseline set on Forecast applies to the underlying data here too, even if the S-Curve doesn't overlay it visually.

## Empty state

If there are no resources, hire, or other planned cost items yet, the panel shows an empty state. Set up the basics (Resources, Rate Cards, Hire) and the S-Curve fills in automatically.
