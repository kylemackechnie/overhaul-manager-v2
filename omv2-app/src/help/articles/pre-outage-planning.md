---
slug: pre-outage-planning
title: Pre-Outage Planning
category: Getting Started
order: 50
summary: A checklist of readiness items grouped by category, with smart context that pulls live data from resources, POs, and bookings to auto-update items where possible.
relatedPanels: [pre-planning, pre-planning-report]
---

# Pre-Outage Planning

Pre-Outage Planning is the **readiness checklist** for a project. It tracks all the things that need to be in place before the outage starts — mobilisations, inductions, parts on site, contracts signed, accommodation booked — and surfaces what's outstanding.

The panel lives under **Project → Pre-Planning** in the ribbon.

## How it works

The checklist is a flat list of items, each with:

- **Category** — grouping (e.g. Personnel, Logistics, Contracts, HSE) — free-form, set per item
- **Item** — the actual readiness check ("All trades inducted", "Long-lead parts received on site", etc.)
- **Owner** — who's responsible (free text)
- **Status** — Pending (○) / In Progress (◑) / Complete (●) / N/A (–)
- **Priority** — Critical (🔴) / Standard / Optional
- **Notes** — free text for context

The header shows progress as `complete / total` and a percentage. Critical items that are still outstanding are flagged separately.

## Readiness progress

The card under the header shows:

- Overall readiness percentage as a progress bar (green at 100%, amber at 70%+, red below)
- Count of items in each status
- Critical outstanding count if any remain

This is the at-a-glance metric — if it's not green, the project isn't ready.

## View filters

Three filter pills control what's shown:

- **All items** — everything
- **🔴 Critical only** — just the must-haves
- **○ Incomplete** — anything not yet Complete or N/A

Use Critical-only as the final go/no-go review before an outage starts.

## Adding items

Two ways to add to the checklist:

- **+ Add from Library** — opens a picker with pre-defined standard items, grouped by category. Tick the ones you want and add them in bulk. This is the fast path for a new project — the library covers most outages.
- **+ Custom item** — adds a blank row for project-specific things not in the library.

## Smart context

The **↻ Refresh data** button at the top pulls live data from across the app — resources with mobilisation dates, POs raised, accommodation bookings, inductions completed — and updates checklist items where it can match them. For example, an item like "Crew mobilised on site" can auto-tick when resources have a `mob_in` date in the past.

The refresh is opt-in (not automatic on every load) because some checks are expensive to compute.

## Pre-Planning Report

The separate **Pre-Planning Report** panel (also under Project) is a printable summary for distribution. Pick which sections to include using checkboxes, or use one of the presets:

- **📋 Internal Full** — everything, for internal kickoff meetings
- **👤 External** — the client-friendly cut
- **🗂 Scope Only** — just the scope sections

Hit **🖨 Print / Share** to generate the PDF-ready output. Use it for status reports to the client or for pre-outage stakeholder meetings.
