---
slug: projects-and-switching
title: Projects & Switching
category: Getting Started
order: 40
summary: Every cost line, timesheet, and resource belongs to one project. Switch via the header pill, manage details in Project Settings, and group projects under Sites.
relatedPanels: [project-settings]
---

# Projects & Switching

Everything in Overhaul Manager is **project-scoped**. Costs, timesheets, resources, POs, invoices, hire, accommodation — all of it belongs to exactly one project. The active project is shown in the header pill at the top right.

## Switching projects

There are three ways to open the Project Picker:

- Click the **project pill** in the header (right-hand side)
- Click the **SE logo** in the top left
- If no project is selected yet, the picker opens automatically and stays open until you pick one

If a project is already active, press **Escape** or click the "← Back to *(project name)*" button to dismiss the picker without switching. On cold start the picker shows a loading spinner while it fetches your projects.

## The Project Picker

The picker is a full-screen overlay split into two parts.

**Sidebar (left):** sites grouped by country, plus an "All Sites" view and an "Unassigned" bucket for projects with no site. Each site shows a colour dot and the number of projects under it.

**Main area (right):** a card grid of projects under the selected site, with:

- A status chip — `ACTIVE`, `PLANNED`, or `CLOSED` (derived from the project's start and end dates)
- Project name, WBS code, and date range
- A coloured accent strip matching the site
- A search box at the top to filter by name across all visible projects

Click a card to switch. The "All Sites" view shows site tiles with project counts and active counts instead of individual project cards — click a site tile to drill into it.

## Creating a new project

Hit **+ New Project** (top right of the main area), **+ New Project** in the sidebar, or the **+ Add project** card at the end of the grid. The modal needs a name; site is optional but recommended. When you create a project:

- You become the project's `owner` automatically (recorded in `project_members`)
- The project becomes the active project immediately
- Dates, WBS, currency, and other details are added later in Project Settings

## Project Settings

Open it via the **⚙ gear icon** on the header project pill, or via the **Project** ribbon tab → **Settings**. The panel has these sections:

- **Project Details** — name, WBS code, site, unit/machine (e.g. GT11), client, project manager (free text), start/end dates, notes
- **Site Contact** — site address and phone for the live project
- **Project Roles** — Project Manager and Project Administrator. The PM can approve and unlock timesheets; the PA can enter and submit timesheets for PM approval. Only a system admin can change the PM. Without a PM assigned, timesheets cannot be approved.
- **Commercial Settings** — Default GM % and base currency (AUD, USD, EUR, etc.)
- **Exchange Rates** — FX rates for converting foreign-currency hire, tooling, and subcon costs to the project's base currency. Add as many as needed.
- **Scope Tracking** — controls the allocation button on timesheet cells. Three modes: **None** (no scope tracking), **Work Orders** (allocate hours to WOs), or **NRG TCE** (allocate hours to TCE scopes).
- **Standard Hours Per Day** — pre-fills timesheet cells when a person is added to a week. Set 0 for rest days. Quick presets for common patterns (e.g. 10h weekdays).
- **Shift Patterns — RFQ Cost Model** — labour shift patterns used by the subcontractor cost model engine
- **Wet Hire Shift Patterns** — for wet hire calendars

Project-level WBS is the project root code; the broader WBS structure (sub-codes for each cost line) lives in the **WBS panel** under Cost Tracking.

## Project lifecycle

Status is derived from the project's dates, not stored as a separate field:

- **Planned** — no start date set, or start date is in the future
- **Active** — start date has passed, no end date or end date is in the future
- **Closed** — end date has passed

Status updates automatically as time progresses — there's no "close project" button. To mark a project closed, set its end date to a past date.

## A note on roles

Project Settings has two role fields (PM and PA) that control what people can do *on that specific project*. These are different from the **system roles** (admin / member / viewer) set in User Management, which control what features users can access across the whole app. A user can be a system `member` and still be the Project Manager on a project — the two role systems work independently.
