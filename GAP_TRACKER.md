# Overhaul Manager V2 — Gap Tracker
<!-- Status: ✅ Done | 🔄 In Progress | ❌ Not Started | ⏸ Deferred -->

## Sprint 1 — Calculation Errors (fix before real data entry)

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 1.1 ✅ | splitHours: weekday NT/T1.5 use rc.regime thresholds (not hardcoded 7.6/2.4) | ✅ | Affects every timesheet |
| 1.2 ✅ | splitHours: Saturday T1.5 from rc.regime.satT15 (default 3h, not 2h) | ✅ | |
| 1.3 ✅ | splitHours: rest day → flat NT rate | ✅ | |
| 1.4 ✅ | splitHours: travel day → flat NT rate | ✅ | |
| 1.5 ✅ | splitHours: mob/demob day → flat NT rate | ✅ | |
| 1.6 ✅ | splitHours: standby → configurable | ✅ | |
| 1.7 ✅ | splitHours: public holiday NIGHT → ndt15 (not ddt) | ✅ | |
| 1.8 ✅ | splitHours: ddt15 bucket for Sunday day shift | ✅ | |
| 1.9 ✅ | mealBreakAdj: add +0.5h to calc in calcPersonTotals | ✅ | Stored but never applied |
| 1.10 ✅ | forecastEngine: tooling use project FX rate not hardcoded 1.65 | ✅ | Lines 271, 409 |
| 1.11 ✅ | forecastEngine: LAHA only applied if resource.allow_laha=true | ✅ | |
| 1.12 ✅ | forecastEngine: cars spread over person mob dates (not booking dates) | ✅ | |
| 1.13 ✅ | forecastEngine: accommodation spread over occupant mob dates | ✅ | |
| 1.14 ✅ | forecastEngine: accommodation out-of-window warnings | ✅ | |
| 1.15 | forecastEngine: expenses daily estimate fill | ✅ | |
| 1.16 ✅ | CO2: hire item fuelType/fuelConsumptionPerDay not read | ✅ | |

## Sprint 2 — Missing Modal Fields (schema + forms)

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 2.1 | Variation: cause dropdown (Client Instruction / Design Change / etc) | ✅ | |
| 2.2 | Variation: raised_date field (separate from submitted_date) | ✅ | |
| 2.3 | Variation: assumptions text block | ✅ | |
| 2.4 | Variation: exclusions text block | ✅ | |
| 2.5 | Variation line: category dropdown (Trades Labour / Materials / Equipment / etc) | ✅ | |
| 2.6 | Variation line: labour auto-calc from role + hours + dayType | ✅ | |
| 2.7 | Resource: homeCity field | ✅ | |
| 2.8 | Resource: transportMode (fly/drive/bus) | ✅ | |
| 2.9 | Resource: driveKmOneWay | ✅ | |
| 2.10 | Car: locationFeePct | ✅ | |
| 2.11 | Car: onewayFee | ✅ | |
| 2.12 | Car: pickupLoc / returnLoc | ✅ | |
| 2.13 | Car: reservation number | ✅ | |
| 2.14 | Car: collected / droppedOff status booleans | ✅ | |
| 2.15 | Car: fuelType | ✅ | feeds CO2 calc |
| 2.16 | Shipment: hawb, mawb, flight number | ✅ | |
| 2.17 | Shipment: origin, destination | ✅ | |
| 2.18 | Shipment: packages count, weight kg, dimensions, agent | ✅ | |
| 2.19 | Global TV: replacement_value (EUR) | ✅ | needed for calcRentalCost |
| 2.20 | Expense: tceItemId linkage to NRG TCE line | ✅ | |

## Sprint 3 — Critical Workflows

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 3.1 | Duplicate week: modal with copy-hours / standard-hours / blank options | ✅ | |
| 3.2 | Variation print: proper formatted VN document (new window, not window.print()) | ✅ | |
| 3.3 | Timesheet print: formatted weekly printout for site sign-off | ✅ | |
| 3.4 | Timesheet cost report: per-person cost breakdown print | ✅ | |
| 3.5 | PO forecast value: remaining per PO from linked hire/accom/subcon | ✅ | |
| 3.6 | global-parts: fix routing to show cross-site search not SparePartsPanel | ✅ | 1 line fix |
| 3.7 | NRG TCE actuals: match invoices + expenses to TCE lines | ❌ | |
| 3.8 | Rate card: auto-calculate all 7 buckets from base rate + multipliers | ❌ | |
| 3.9 | Variation WBS: dropdown from project WBS list (not free text) | ❌ | |

## Sprint 4 — Features (by daily use frequency)

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 4.1 ✅| Resources: bulk edit (dates, shift, WBS, allowances) | ✅ | |
| 4.2 | Resources: role alias management UI | ✅ | |
| 4.3 ✅| Resources: no-PO badge for subcontractors in row | ✅ | |
| 4.4 ✅| Accommodation: bulk add rooms | ✅ | |
| 4.5 ✅| Accommodation: bulk edit dates/rate | ✅ | |
| 4.6 ✅| Cars: bulk edit dates | ✅ | |
| 4.7 ✅| Hire: bulk link to PO | ✅ | |
| 4.8 ✅| Hire: duplicate hire item | ✅ | |
| 4.9 | Invoice: hire/timesheet breakdown when PO selected | ✅ | |
| 4.10 | Invoice: expected vs actual variance | ✅ | |
| 4.11 | Parts: issue basket (build pick list from kits before issuing) | ✅ | |
| 4.12 ✅| Parts: return/un-issue a part | ✅ | |
| 4.13 | RFQ: award response + create PO from RFQ | ✅ | |
| 4.14 ✅| Inductions: fuzzy name matching for import | ✅ | |

## Sprint 5 — Display Gaps (polish)

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 5.1 | Variation table: add Cause, Raised Date, GM%, Line count columns | ❌ | |
| 5.2 | Calendar: hire on-hire/off-hire events | ❌ | |
| 5.3 | Calendar: TV charge period start/end events | ❌ | |
| 5.4 | Calendar: parts expected delivery per TV ETA | ❌ | |
| 5.5 | Timesheet cell: per-cell $ cost display | ❌ | |
| 5.6 | Timesheet cell: split hours breakdown (NT:7.2 T1.5:2.8) | ❌ | |
| 5.7 | Resources: show linked accommodation room in row | ❌ | |
| 5.8 | Expenses: GST breakdown columns in table | ❌ | |
| 5.9 | Rate card table: all 7 buckets + sell vs cost margin% | ❌ | |
| 5.10 | WBS panel: PM100/PM80 vs actuals comparison table | ❌ | |
| 5.11 | Cost report: add backoffice + subcon labour category columns | ❌ | |
| 5.12 | Audit trail: write events on all save actions (currently reconstructs) | ❌ | |

## Deferred / Lower Priority

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| D.1 | Wet hire: full shift calendar cost model | ⏸ | Architectural change |
| D.2 | Undo system | ⏸ | Complex infrastructure |
| D.3 | Shipping: DHL/SLI document generation | ⏸ | Low frequency |
| D.4 | Shipping: VB file import | ⏸ | |
| D.5 | Shipping: TV linkage | ⏸ | |
| D.6 | CO2: flight tracking with city distances | ⏸ | |
| D.7 | CO2: freight CO2 from shipment weight | ⏸ | |
| D.8 | CO2: personnel commute CO2 | ⏸ | |
| D.9 | NRG: invoice grouping rules | ⏸ | |
| D.10 | Project: duplicate project | ⏸ | |
| D.11 | Project: backup/restore JSON | ⏸ | |
| D.12 | Parts: cross-site parts search | ⏸ | needs multi-project query |
| D.13 | Expenses: receipt attachment (needs Supabase Storage) | ⏸ | |
| D.14 | Variation: auto-create TCE line on approve | ⏸ | |
| D.15 | Parts: deduplicateInventory admin tool | ⏸ | |

---
*Last updated: from full function audit of Overhaul_Manager_v4_47.html (1,024 functions)*
*Audit method: extract all HTML functions → filter business logic → verify React equivalent*
