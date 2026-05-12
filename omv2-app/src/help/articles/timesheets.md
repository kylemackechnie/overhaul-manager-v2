---
slug: timesheets
title: Timesheets
category: Personnel
order: 30
summary: Four timesheet variants (Trades / Mgmt / SE AG / Subcon), same workflow. Weekly Monday-start sheets with per-person per-day hours, Draft → Submitted → Approved status flow, payroll import from TasTK or UKG, and approved sheets write to timesheet_cost_lines as the source of truth for labour actuals.
relatedPanels: [hr-timesheets-trades, hr-timesheets-mgmt, hr-timesheets-seag, hr-timesheets-subcon]
relatedTour: timesheets-tour
---

# Timesheets

Timesheets are how labour hours become labour cost. The app has **four variants** — Trades, Management, SE AG, and Subcontractor — but they all share the same shape and workflow.

Each timesheet is a **Monday-start week** with a crew of people and their per-day hours. Approved timesheets write rows to `timesheet_cost_lines`, which is the source of truth for labour actuals read by the Cost Report, NRG Actuals, and the MIKA EAC.

Open via **Personnel → Timesheets (Trades / Mgmt / SE AG / Subcon)**.

## Why four variants

The four panels look identical and behave the same way — they just scope to a different category of resource:

| Panel | Resources shown |
|---|---|
| **Trades** | Resources with category = trades |
| **Management** | Resources with category = management |
| **SE AG** | Resources with category = seag (typically EUR-rated) |
| **Subcontractor** | Resources with category = subcontractor |

Splitting them keeps each panel focused — a PA only sees the crew that's actually theirs — and avoids accidentally mixing categories on one sheet.

## The weekly model

A timesheet has:

- **week_start** — the Monday date
- **type** — trades / mgmt / seag / subcon
- **regime** — hours model (e.g. lt12, gt12 — affects bucket splits)
- **status** — draft / submitted / approved
- **crew** — list of `{ personId, role, wbs, days }` with day-by-day entries
- **vendor** — for subcontractor sheets, the company name
- **po_id** — for subcontractor sheets, the linked PO

## Day types

Each day cell on each person has a **day type** that controls how hours are interpreted:

- Weekday / Saturday / Sunday / Public Holiday
- Rest / Fatigue / Standby
- Direct Travel / SEA Travel
- Direct Travel + Work / SEA Travel + Work

The day type combines with the resource's shift (Day / Night) and the regime to split hours across the seven rate buckets on the matching rate card.

## Status workflow

Three statuses with a strict forward path:

```
Draft → Submitted → Approved
```

- **Draft** — being filled in; anyone with personnel write access can edit
- **Submitted** — Project Administrator has flagged it ready for review
- **Approved** — Project Manager has signed off; writes to `timesheet_cost_lines`

Only the **PM** can approve and unlock; the **PA** can submit for approval. (System admins can do both.) Both roles are set in Project Settings → Project Roles.

Approval is what makes labour actuals appear in cost reports. A draft timesheet shows the hours but doesn't yet feed actuals through to the EAC.

## Creating a week

**+ New Week** modal asks for:

- Week start (Monday)
- Type (trades / mgmt / seag / subcon — usually pre-set by which panel you're on)
- Regime (lt12 / gt12)
- Vendor + PO (subcontractor only)

The new week starts empty — add crew next.

## Adding people to a week

The **Bulk Add** modal picks from the resource list, scoped to the current category. Options:

- **On-site only** — filters to people whose mob dates cover the week. The fast path for an active outage.
- **All** — every resource in this category, regardless of mob dates.

Selected people are added with empty days. Their default shift, WBS, and allowance flags come from the resource record.

## Entering hours

Per-person per-day cells. For each cell:

- **Hours** — the number of hours worked
- **Day type** — Weekday / Saturday / etc.
- **Shift type** — Day / Night (defaults to person's shift)
- **Allowance flags** — LAHA, Meal (per day, defaults from resource)

Daily totals visible at the bottom of each day column. Week total per person on the right.

## Allowances

- The resource has default flags (LAHA / Meal / FSA)
- Each day cell can override per-day
- **🏷 Allowances** button applies the resource defaults across all cells in the current week — the fast path when entering a fresh week

## Payroll import

**📥 Import Payroll** opens a modal supporting two sources:

### TasTK / TimeCloud

CSV export from TasTK or TimeCloud. Required columns: Full Name, Timesheet Date, Quantity, Operation, Work Order Custom Code.

People are matched by **fuzzy name match** at a 65% threshold — exact matches are preferred but minor name variations (initials, middle names) are handled. The Custom ID from the CSV is written to the crew member for future re-imports.

### UKG / Kronos

CSV payroll export with Employee Id / First Name / Last Name rows. A template is available via the **⬇ Template** button — download it, fill in, re-upload.

Both imports respect the week start — only entries for the active week are imported.

## Next Week shortcut

**⏭ Next Week** saves the current week and creates the next one with the same crew (but no hours). Fast way to roll a stable crew forward week after week. If a week already exists for that date and type, it switches to that one instead.

## Duplicate Week

The **⧉ Duplicate** button on a sheet row opens a modal with three fill modes:

- **Copy hours from previous week** — same hours, day types, shifts, and allowances. Dates shift forward 7 days. The default.
- **Use standard hours from Project Settings** — each person gets the configured shift pattern. Only enabled when Project Settings → Standard Hours has values.
- **Blank — zero hours** — keep the crew list but start empty.

On NRG projects with TCE scope tracking, a **Copy TCE scope allocations** checkbox appears below the fill modes. When ticked, the new week carries forward which TCE scope each person's hours are tagged to. Useful when the work continues on the same scope week-over-week.

## Sync Crew

The **🔄 Sync Crew** button (per-sheet on the list view) refreshes the crew on a sheet from the current resource list. It updates each crew member's name, role, WBS, and meal break adjustment to match what's on the resource record now.

Useful after:

- A bulk role rename or WBS update on Resources
- Importing a roster that changed someone's company or role

Hours and allowance entries are preserved — only the metadata fields are refreshed.

## Recalculate

If the MIKA / WBS / Cost Report view is showing missing labour actuals — a known symptom of partial deploys or schema changes — the **↺ Recalculate** button rebuilds `timesheet_cost_lines` for all approved timesheets on the project. Only shows when there's at least one approved sheet to rebuild.

## CSV export

**⬇ CSV** exports the active week's data as CSV for further analysis or sharing with payroll.

## TCE mismatch warning

On NRG projects with TCE scope tracking enabled, the **Save & Close** button checks that scope allocations sum to the hours per person per day. If there's a mismatch, a confirmation dialog appears before saving — typically you've allocated 8 hours to scope X but only entered 7.5 in the day cell, or vice versa. Fix the allocation or the hours before committing.
