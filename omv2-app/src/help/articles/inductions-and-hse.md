---
slug: inductions-and-hse
title: Inductions & HSE
category: Personnel
order: 40
summary: Match SE Learning induction exports against the project crew, log HSE hours by category, and track project carbon emissions. Three panels under one umbrella plus an HSE Dashboard.
relatedPanels: [hr-inductions, hse-dashboard, hse-hours, hse-co2]
---

# Inductions & HSE

Four panels cover the Health, Safety, and Environment side of the project:

- **Inductions** — match SE Learning induction completion data against project resources
- **HSE Hours** — log time spent on safety activities
- **CO₂ Tracking** — track project carbon emissions
- **HSE Dashboard** — tile-based overview

## Inductions

Open via **Personnel → Inductions** or **HSE → Inductions**. The panel matches SE Learning exports against the project's resource list, telling you who is and isn't compliant for required training.

### Two SE Learning exports

The panel takes two `.xlsx` exports from SE Learning:

- **📂 Courses** — course completion data
- **📂 Lessons** — lesson completion data

Both contribute to the matching. Upload one or both, depending on what's required.

### Reference date

The **Ref date** at the top defaults to today. Change it to assess compliance at a specific point — past or future. Your selection is saved per project, so you can keep a future date set for the upcoming mobilisation week and have it stay there between sessions. Useful for:

- Checking if your incoming crew will be ready for mobilisation week
- Auditing what compliance looked like at a past milestone

### Matching to resources

Names from the SE Learning exports are fuzzy-matched against the resource list. Mismatches are flagged so you can spot:

- People in the export who aren't on the project (extra training data)
- People on the project who aren't in the export (potentially unqualified)

### Printable reports

Two print modes:

- **🖨 Wall Sheet** — landscape format for noticeboards. Shows everyone's status at a glance.
- **🖨 HSE Report** — full compliance report for the HSE officer. More detail per person.

## HSE Hours

Open via **Personnel → HSE Hours** or **HSE → HSE Hours**. Logs time spent on safety activities — separate from regular labour timesheets.

### Categories

Eleven activity categories:

- Toolbox Talk
- Safety Observation
- Incident Investigation
- Risk Assessment (JSA / SWMS)
- Safety Walk
- Induction
- Emergency Drill
- First Aid
- HSE Meeting
- Environmental Check
- Other

### Entries

Each entry has a date, person (picked from project resources), category, hours, description, and notes. Filter by month or category. Export to CSV.

This data feeds HSE reporting metrics on the HSE Dashboard.

## CO₂ Tracking

Open via **Personnel → CO₂ Tracking** or **HSE → CO₂ Tracking**. Tracks project carbon emissions across travel, transport, and energy use.

### Default emission factors

Built-in factors (kg CO₂ per unit):

- **Air travel < 3h (economy)** — 180 kg / flight
- **Air travel > 3h (economy)** — 520 kg / flight
- **Petrol car** — 0.192 kg / km
- **Diesel car** — 0.171 kg / km
- **Hotel night** — 31.5 kg / night
- **Grid electricity (QLD)** — 0.81 kg / kWh

Add a quantity for any of these and the kg CO₂ is computed automatically. The cumulative total for the project is shown at the top.

CO₂ data is stored in `projects.co2_config` as a project-level configuration blob — no separate table.

## HSE Dashboard

Open via **HSE → Dashboard**. Tile-based overview using the same dashboard framework as the main project Dashboard, but with HSE-focused tiles.

Quick links jump straight to HSE Hours, Inductions, and CO₂ Tracking. Tile-level customisation works the same way — drag to reorder, gear icons for tile settings, layout saved per user.
