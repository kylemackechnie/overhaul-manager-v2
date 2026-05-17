---
slug: project-settings
title: Project Settings
category: Getting Started
order: 15
summary: Configure project details, currency, rate structure, shift patterns, and cost method. Settings apply project-wide and affect forecasts, rate cards, and which modules are visible.
relatedPanels: [project-settings]
---

# Project Settings

Open via **Project → Project Settings** (or ⚙ in the ribbon).

Project Settings is the single source of truth for project-wide configuration. Changes here flow through to rate cards, forecasts, timesheets, and cost reports.

## Cost Method

The **Cost Method** dropdown (under Scope Tracking) controls which cost tracking approach is active for this project:

| Option | Description |
|---|---|
| **Standard — WBS tracking only** | Uses the standard WBS-based cost register. No TCE fields or NRG-specific panels are shown. |
| **NRG TCE — Total Contract Estimate method** | Enables TCE item ID fields on invoices, expenses, POs, and variations; unlocks all NRG Gladstone panels (TCE Register, Customer Invoicing, Reports, KPI, Actuals). |

Switching cost method is non-destructive — all data is preserved. Switching from NRG TCE back to Standard simply hides the TCE-related UI; all TCE allocations and actuals remain in the database and are restored immediately if the method is switched back.

## Scope Tracking Mode

Controls the allocation selector in timesheet cells:

| Option | Description |
|---|---|
| **None** | No scope allocation in timesheets |
| **Work Orders** | Timesheet hours allocated to Work Order numbers |
| **NRG TCE** | Timesheet hours allocated to NRG TCE item IDs (requires NRG TCE cost method and an imported TCE register) |

## Other settings

| Section | Key fields |
|---|---|
| **Project Details** | Name, WBS prefix, start/end dates, notes |
| **Contract Details** | Siemens Project No., Contract No., CPM name — used on printed Variation Notices |
| **Commercial** | Default GM%, unit (MW, unit, etc.), PM and PA names |
| **Currency** | Base currency, FX rates for foreign-currency POs |
| **Shift Patterns** | Standard hours per day/night by day of week — used by the forecast engine and timesheet validation |
| **Labour Patterns** | Named shift patterns for RFQ cost modelling |
| **Public Holidays** | State-based holiday calendar for the project location |
| **Rate Cards** | Labour rates by role — used for timesheet cost calculations and RFQ modelling |
