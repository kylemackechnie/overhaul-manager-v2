---
slug: subcon-cost-modelling
title: Vendor Cost Modelling
category: Subcontractors
order: 20
summary: Project each vendor's RFQ response over a date range and compare total expected cost. Vendor ranking, weekly breakdowns, cumulative chart, and a printable comparison report.
relatedPanels: [subcon-rfq]
---

# Vendor Cost Modelling

Once you've logged vendor responses against an RFQ, the **Cost Model** projects each response over a date range so you can compare total expected cost — not just headline quotes. Quoted totals often mask differences in rate structure, shift patterns, LAHA assumptions, or scope interpretation; the model reveals what the project actually costs with each vendor.

Open via **Subcontractors → Cost Model**.

## Selecting an RFQ

The picker shows all RFQs **eligible for cost modelling** — i.e. those with at least one logged vendor response. For each eligible RFQ:

- RFQ title
- Labour role count
- Equipment item count
- Vendor response count

Click to load it for modelling.

If no RFQs are eligible yet, the panel directs you to the RFQ Register to log a response first.

## Modelling parameters

Three inputs control the projection:

- **Start Date** *(required)*
- **End Date** *(required)*
- **Shift Pattern** — picks how working days are calculated:
  - **Project named patterns** (defined under Project Settings → Shift Patterns) appear first
  - **Mon–Fri (generic)** — fallback weekday pattern
  - **7-Day (generic)** — fallback continuous pattern

Public holidays are applied automatically from the project's Australian PH calendar — public holiday days count for PH-rate labour where applicable. Roles are costed **within their date windows only** (a role defined as "weeks 3-5 only" doesn't cost anything outside that window).

## Headcount overrides

The RFQ document specifies a quantity per role. The headcount override panel lets you change that quantity for the cost model **without editing the RFQ** — useful for what-if analysis:

- "What if we ran two scaffolders instead of three?"
- "What does the night shift look like if we double it?"

Each override input is per-role, with the original RFQ qty as the default.

## Vendor ranking

Once dates are set, vendors are ranked **cheapest first**:

- Card per vendor with rank number (#1, #2, …)
- Cheapest vendor highlighted in green with a "CHEAPEST" badge
- Projected total cost prominent on the right
- Each non-cheapest vendor shows the cost saving vs cheapest (e.g. "+$12,400 (+5.2%) vs cheapest")
- Quoted vs projected variance — if the vendor's headline quote differs from what the model projects (different shift assumptions, missing items, etc.), the variance shows in green or orange

### Weekly cost pills

Below each vendor card, a row of weekly cost pills showing labour + equipment per week. Public-holiday-affected weeks are flagged with `PH` count.

This is the headline view — a single screen showing how the vendors stack up over the engagement.

## Cost Component Breakdown

A table breaking down each vendor's cost into:

- **Shift Labour** — base labour cost summed over the engagement
- **LAHA** — Living Away From Home Allowance totals
- **Equipment** — total equipment cost including transport

Multi-vendor projections also show a **Saving** column comparing each vendor against the cheapest.

## Cumulative chart

For projections covering 2+ weeks, a cumulative cost chart appears showing each vendor's running total over the engagement. Useful for visual comparison and for spotting when one vendor is cheaper early but more expensive at peak.

## Weekly cost table

Detailed per-week table:

- **Week** — week starting Monday
- **Days** — working days in the week
- **PH** — public holidays in the week
- **One column per vendor** — labour cost that week
- **Saving** — diff between cheapest and most expensive vendor that week

Best-vendor cells highlighted green per row.

## Cost by Role

For RFQs with labour rows, a table showing cost per role across all vendors:

- Total shift count per role
- Cost per vendor per role
- Useful for spotting "vendor A is cheap overall but ridiculously expensive for night-shift fitters" type patterns

### Day-by-day breakdown

A collapsible **Day-by-Day Cost Breakdown** section shows every working day in the engagement with the cost per vendor — the most granular view. Useful when troubleshooting a discrepancy or auditing a specific week.

## Analysis notes

A free-text **Analysis Notes** field captures the reasoning behind your model:

- Rate discrepancies between vendors
- Vendor-specific assumptions (e.g. "Vendor B assumes 12-hour shifts where the RFQ specified 10")
- Scope interpretation differences

Notes are saved against the RFQ document and are **included in the printed comparison report**.

## Print report

The **🖨 Print** button generates a full vendor cost comparison report:

- Cover page with RFQ title and date
- Vendor ranking summary
- Cost component breakdown
- Weekly cost table
- Cost by role
- Analysis notes

Use it for internal scope reviews, client-facing comparisons, or as audit documentation for the award decision.
