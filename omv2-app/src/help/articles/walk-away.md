---
slug: walk-away
title: Walk-Away Analysis
category: Sandbox
order: 10
relatedPanels: [sandbox-walkaway]
summary: If we stopped the project on a chosen date, what's the bill? The Walk-Away panel classifies the project's entire EAC into Sunk, Locked, Avoidable, and Discretionary based on a date you pick — across all 15 cost sources the project tracks.
---

# Walk-Away Analysis

Open via **Sandbox → Walk-Away**.

The Walk-Away panel answers a single question: *if we stopped the project on a chosen date, what's the bill?* Every dollar of the project's current EAC is classified into one of four buckets relative to that date, across every cost source the project tracks.

This is useful for cost-to-terminate scenarios, end-of-project commitment tracking, and pre-mob "if we walked away now" sense-checks during planning. It is **not** the same view as the Cost Report or the MIKA EAC — those tell you what has been spent. Walk-Away tells you what you'd still owe if you stopped.

## The four buckets

| Bucket | Meaning |
|---|---|
| **Sunk** | Already spent on or before the chosen date. Cannot be recovered. |
| **Locked** | Inside the demob-notice window. Cancelling now still incurs this cost. |
| **Avoidable** | Beyond the notice window. Can be cancelled or de-mobilised; saved if we stop. |
| **Discretionary** | No commitment yet — proposed variations, draft scope items. Easiest to drop. |

Sunk + Locked = the bill if we stop on the chosen date. Avoidable + Discretionary = what we save by stopping. The two halves add up to total EAC.

As you move the walk-away date forward, money flows left: Avoidable shrinks (less escape room) and Sunk grows (more spent). The shape of that shift is what the panel shows.

## What feeds the engine

Fifteen cost sources, classified by their own rules:

- **Flights** — per leg. A booked leg with a flight number is at minimum Locked; legs linked to an approved expense use the actual amount as Sunk.
- **Expenses** — date-driven. Flight-linked expenses are skipped to avoid double-counting against the flights row.
- **Cars, Accommodation, Dry Hire, Local Hire** — booking period split three ways: days before the walk-away date are Sunk, days inside the notice window are Locked, the rest is Avoidable.
- **Wet Hire** — flat hire cost split by the same date logic (approximate; doesn't walk the shift calendar).
- **Tooling** — charge period from `tooling_costings`, FX-converted EUR → AUD. Multi-project splits not yet supported.
- **Labour (Trades / Mgmt / SE AG / Subcon)** — see the labour section below.
- **Back Office** — per-row date. In practice almost always Sunk because the rows are only entered for past work.
- **SE AG Support** — per-row date, FX-converted. Same "almost always Sunk" pattern as Back Office.
- **Variations** — status-driven (see below).

## Labour: timesheet actuals override forecast

Labour is the only source where the engine has two competing inputs: the **forecast** (predicted cost per day per category, from resources × shift patterns × rate cards) and the **timesheet actuals** (what's actually been logged via the Timesheets panel).

For each past day × category:

- If a timesheet entry exists → use the timesheet cost as Sunk
- If no timesheet entry exists → fall back to forecast cost as Sunk

For future days, forecast is always used.

**All timesheet statuses count** — draft, submitted, and approved. Once anyone has logged hours for a day, the cost has been incurred and Walk-Away treats it as real. This is different from the Cost Report and MIKA EAC, which only show actuals from *approved* timesheets.

The descriptions on emitted Sunk lines show whether the bucket was built from actuals or forecast, so you can see at a glance which side of the merge dominates.

## Variations: status, not date

Variations are the one source that ignores the walk-away date — they classify by status:

| Status | Bucket | Why |
|---|---|---|
| Draft / Submitted | **Discretionary** | Proposed but not committed; we could withdraw. |
| Approved | **Locked** | Customer-approved scope addition; contractually owed delivery. |
| Rejected | excluded | Not happening; contributes \$0. |

The variations notice-period setting has no effect today — status overrides date for this source.

There's a known limitation: an approved variation may already be flowing through labour timesheet actuals (the variation work is happening now). Walk-Away doesn't net that out, so an approved variation can double-count against the labour rows. Acceptable when variations are small relative to total EAC; flag if a project's variation total starts to dominate.

## Notice periods

Each cost source has its own notice-period setting, in whole days. The default is **1 day** for every source — meaning "we can cancel up to and including today; tomorrow's cost is Locked".

Edit them via the **⚙️ Notice periods** button. Settings are saved per-project in `projects.walk_away_settings.notice_days` and persist between sessions.

Sensible values depend on your cost structure:

- **Flights** — usually 1 (most airline tickets are non-refundable from the day of booking, so notice doesn't help much; the existing flight number is what makes them Locked).
- **Accommodation** — 1 to 7 depending on the property's cancellation policy.
- **Cars** — 1 to 3 for major hire vendors.
- **Hire equipment** — 7 to 14 is typical for off-hire notice with major suppliers; longer for specialist tooling.
- **Subcon labour** — often the longest, 14 to 28 days depending on the contract. The default 1 day will significantly understate Locked subcon cost.

There's no "correct" answer here. The notice settings are the place to encode whatever your real cancellation reality looks like.

## Compare two dates

The **⇄ Compare two dates** toggle runs the engine for a second date and shows the result side-by-side. Every cell in the breakdown table grows a `→ B` line; the totals row also includes the bucket-level delta.

The second date defaults to the **project end date** — the most useful "between now and finish, how much is locked in?" view. Both dates are independently editable.

Compare mode does not change Total EAC — it's the same cost in both columns, just classified into different buckets at the two points in time. What it reveals is the **rate at which Avoidable drains to Sunk** as the project progresses. A row where Sunk swings up by a large amount between A and B is a row where most of the cost is going to land within that window regardless of any decision you make in between.

## Known limitations

These are real but acceptable for the current build — flagged here so the numbers aren't misread:

- **PO-actuals override not yet wired.** Cars, accom, hire, and tooling classify off the booking period, not off PO-drawn amounts. If a PO has already been partially invoiced for cost less than the booking implies, Sunk is slightly overstated.
- **Tooling multi-project splits not yet supported.** If a tooling line is split across two projects via `tooling_splits`, the full booking cost lands on the owning project.
- **Wet hire walks flat hire_cost, not the shift calendar.** Approximate. Most wet hire is short-duration enough that this doesn't matter; revisit if you start seeing major wet-hire over many weeks.
- **Labour WBS attribution is summary-only.** The bucket totals are correct, but the per-WBS breakdown rolls labour into `(unallocated)` rather than spreading it by job. Timesheet lines do carry real WBS — improving this is on the roadmap.
- **Approved variations may double-count with timesheet actuals** (see Variations section above).

## How this is different from other views

The MIKA EAC and the Cost Report tell you *what's been spent*. They run on approved-only data and answer historical questions: how much of the budget has been consumed, what's the current EAC, where are we vs plan.

The Walk-Away panel is a forward-looking decision tool. It runs on all-status data (so you see commitments before they're formalised) and answers: *what do we owe if we pull the cord today?* The total ends up equal to the EAC at end-of-project (everything goes Sunk), but the shape between now and then is the actionable part.
