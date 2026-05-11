---
slug: resources-and-roles
title: Resources & Roles
category: Personnel
order: 10
summary: The people on the job. Each resource has a name, role, category, mobilisation dates, shift, specialisation, and allowance flags. Statuses are auto-derived from dates.
relatedPanels: [hr-resources, hr-utilisation]
relatedTour: resources-panel-tour
---

# Resources & Roles

The **Resources panel** is where everyone working on the project lives. Each resource feeds into timesheets, cost reports, accommodation, cars, and the EAC. Get the resource list right and most other personnel data flows from it.

Open via **Personnel → Resources**.

## What a resource is

Each resource has:

- **Name** — required
- **Role** — free text (e.g. "Fitter", "Site Supervisor", "Boilermaker")
- **Category** — Trades / Management / SE AG / Subcontractor (drives which timesheet panel they appear on)
- **Specialisation** — area of expertise: Turbine, Generator, Valves, Auxiliaries, or custom. Optional, useful for filtering.
- **Company** — employer / contractor name
- **Email, Phone**
- **Mob In / Mob Out** — mobilisation dates. Drive the resource status.
- **Shift** — Day / Night / Roster / etc. Default is Day.
- **WBS** — default WBS the person's labour gets allocated to.
- **Allowances** — LAHA (Living Away From Home), Meal, FSA flags
- **PO link** — for subcontractor resources (see below)

## The four categories

Categories determine which timesheet panel a person shows up on, and how their cost is structured:

| Category | Who | Where they appear |
|---|---|---|
| **Trades** | Frontline workers | Trades Timesheets |
| **Management** | PMs, supervisors, planners | Management Timesheets |
| **SE AG** | Siemens Energy AG specialists | SE AG Timesheets (typically EUR-rated) |
| **Subcontractor** | Vendor-supplied labour | Subcontractor Timesheets |

A person stays in one category for the life of their engagement.

## Status — auto-derived from dates

The system computes status from mobilisation dates against today:

- **🟢 On-site** — Mob In has passed, Mob Out hasn't
- **🟡 Incoming** — Mob In is within the next few days
- **🔵 Upcoming** — Mob In is set but further out
- **⚪ Departed** — Mob Out has passed
- **🟣 Future** — Far-future mob dates
- **No dates** — Mob In or Out not set

Filter by status to find who's currently on site, or anticipate the next wave coming in.

## Specialisation

Specialisation is an area of work — Turbine, Generator, Valves, Auxiliaries. It's free-form so you can add new ones as needed. Useful for filtering "show me all the valve specialists" or generating discipline-specific reports.

The Resources table has a Specialisation column you can show/hide.

## Adding people

**+ Add person** opens a modal. The only required field is Name; everything else can be filled in over time. Reasonable defaults are applied (category=trades, shift=day).

For Subcontractor resources, link to a PO (`linked_po_id`) so their cost flows correctly against committed PO spend. Unlinked subcontractors show in red — they're effectively orphaned cost that won't reconcile.

## Bulk import

The `↑` button reveals a paste box. Two formats are supported:

- **Standard CSV** — header row: `Name, Role, Company, Email, Phone, Mob In, Mob Out`
- **NRG roster format** — multi-row header with Employee / Mobile / Role columns (auto-detected from header pattern)

Useful for rolling a project crew over from previous outages or importing a vendor's roster spreadsheet directly.

## Shift phases

A single resource can have **multiple shift periods** over their time on site — e.g. Day shift for weeks 1-2, then Night shift for week 3, then Day again for weeks 4-5. The Resource modal has a timeline editor for setting these phases per date range.

When timesheets auto-fill from the resource list, they pick up the correct shift for each day based on the phases.

## The Resources table

Sortable columns, with a column visibility picker (the ⊞ button). Default columns cover the essentials; everything else is available behind the picker. Column choices and sort persist per user.

The table also has a checkbox column for bulk edits — select rows, then "✏ Edit Role/Shift" to update multiple resources in one go (role, company, category, mob dates, shift, WBS, specialisation, allowances).

## The Calendar view

A Gantt-style timeline showing who's on site when, with continuous bars per resource. View presets across the top:

- **2w / 4w / 8w** — fixed window
- **Span** — the full project from earliest mob in to latest mob out

Drag the left edge of a bar to adjust Mob In; drag the right edge for Mob Out; drag the body to move both. Click a person's name to open the edit modal.

The Calendar groups by category and includes a headcount summary row at the top — a fast way to see "we'll have 47 trades on site that week".

## Allowances

LAHA, Meal, and FSA flags are set per resource and drive how timesheets calculate allowances. The Timesheets panel has a "🏷 Allowances" button that applies these defaults to the current week's hours — useful when filling in a fresh week.

## Utilisation

The separate **Utilisation panel** (Personnel → Utilisation) is a cross-project monthly heatmap showing where each person was deployed. Useful for resource managers across multiple projects — see at a glance who's been working where, when they were idle, and whether anyone's been double-booked.

- Filter by category (Trades / Management / SE AG / Subcon)
- Filter by project
- Month-by-month navigation (← →)
- One row per person, one column per day; cells coloured by deployment

This panel reads across all projects you have access to, not just the active one.
