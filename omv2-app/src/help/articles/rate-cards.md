---
slug: rate-cards
title: Rate Cards
category: Personnel
order: 20
summary: Labour rates per role drive how timesheets convert hours to cost and sell. Seven pay buckets per card (Day NT through Night 2.5x), plus allowances and a regime model. Global Rate Defaults seed new projects.
relatedPanels: [hr-ratecards, rate-defaults]
---

# Rate Cards

Rate Cards define **labour rates per role** for the project. They're the bridge between timesheet hours and cost reports — without a matching rate card, labour reads as $0 on the Cost Summary.

Open via **Personnel → Rate Cards**.

## What a rate card is

Each rate card has:

- **Role** — e.g. "Fitter", "Site Supervisor". Matches the role string on resources.
- **Category** — Trades / Management / SE AG / Subcontractor. Determines defaults (e.g. SE AG defaults to EUR currency).
- **Vendor** — for subcontractor rate cards
- **Currency** — AUD, USD, EUR, GBP, NZD. SE AG cards default to EUR; others default to the project's base currency.
- **Seven pay buckets** — cost and sell rates for each pay multiplier
- **LAHA / FSA, Meal** — allowance rates (cost and sell)
- **Regime** — hours-per-day model controlling how regular vs overtime splits work

The Rate Cards table shows all roles at a glance with their key rates side by side.

## The seven pay buckets

Every rate card has seven rate buckets covering different pay scenarios:

| Bucket | Label | When applied |
|---|---|---|
| **dnt** | Day NT | Day shift normal hours |
| **dt15** | Day 1.5x | Day shift overtime at 1.5x |
| **ddt** | Day 2x | Day shift double time |
| **ddt15** | Day 2.5x | Day shift 2.5x |
| **nnt** | Night NT | Night shift normal hours |
| **ndt** | Night 2x | Night shift double time |
| **ndt15** | Night 2.5x | Night shift 2.5x |

Each bucket has its own **cost rate** (what we pay) and **sell rate** (what we charge). You can enter rates directly per bucket, or set a base rate and multipliers and let the system compute the buckets.

## Regime — hours-per-day model

The regime controls how hours per day split between buckets. Standard regime:

- **wdNT** — weekday normal hours (default 7.2h)
- **wdT15** — weekday at 1.5x (default 3.3h)
- **satT15** — Saturday at 1.5x (default 3.0h)
- **nightNT** — night shift NT (default 7.2h)
- **restNT** — rest day NT (default 7.2h)

SE AG uses a different default regime (8h NT + 16h at 1.5x, no Saturday weighting).

The regime is set per rate card so different roles can have different splits — e.g. management on flat day rates vs trades on a graduated weekday/overtime model.

## Allowances

Each rate card carries allowance rates:

- **LAHA** (Living Away From Home Allowance) — for trades and subcon
- **FSA** — for management
- **Meal** allowance

Both have separate cost and sell amounts. Timesheets pick these up via the resource's allowance flags (LAHA / Meal / FSA on the resource).

## Category-specific defaults

- **SE AG** rate cards default to **EUR currency** and the SE AG regime
- **Subcontractor** rate cards expose a **vendor** field for tracking which company the rate applies to
- **Trades** and **Management** default to the project's base currency

## Why labour reads $0

If a resource's role doesn't match any rate card on the project, labour cost reads as **$0**. The Cost Summary Report flags this with a warning strip:

> ⚠ Timesheets exist but no rate cards are configured for this project. Labour costs will show as $0 until rate cards are set up under Personnel → Rate Cards.

The fix is to add a rate card whose role string matches the resource's role exactly. Role matching is case-sensitive.

## Global Rate Defaults

Open via **File menu → Global Rate Defaults** (or under settings). This is the **system-wide template** — the rate cards that get auto-copied into every new project.

- **Admin-only** writes — only system admins can change defaults
- Edits to defaults **do not affect existing projects** — they keep their own copies
- **New projects** automatically receive a copy of the defaults at creation
- For an annual rate review: update the defaults here, then projects pick up the new rates only when they're started after the update

Use the Global Rate Defaults panel to set up your "standard rate book" — the rates you'd want most projects to start from. Project-specific tweaks (a different vendor, a special-deal rate) get edited on the project's own Rate Cards page.
