---
slug: cars-accommodation-back-office
title: Cars, Accommodation & Back Office
category: Personnel
order: 50
summary: People-related logistics — car hire, accommodation bookings, and back-office or SE Support hours that aren't on regular timesheets. All flow into the WBS aggregator alongside labour.
relatedPanels: [hr-cars, hr-accommodation, hr-backoffice]
---

# Cars, Accommodation & Back Office

Three panels cover the people-related logistics that aren't covered by timesheets:

- **Cars** — vehicle hire for the project crew
- **Accommodation** — rooms and properties booked for crew
- **Back Office & SE Support** — office hours and SE AG support costs

All three contribute to the cost model — they flow through the WBS aggregator into the Cost Summary and the EAC on MIKA.

## Cars

Open via **Personnel → Cars** or **Hire → Cars**. Manages vehicles hired for the project crew.

### What's tracked

Per vehicle:

- Type (Sedan / Wagon / Ute / etc.)
- Rego
- Vendor
- Person assigned (optional — pick from project resources)
- Start / End dates
- Cost and Sell totals

### Quick actions

- **+ Add Vehicle** — modal to create
- **⬇ CSV** — export the list

Header strip shows count, total cost, total sell at a glance.

## Accommodation

Open via **Personnel → Accommodation** or **Hire → Accommodation**. Tracks rooms and properties booked for the crew.

### What's tracked

Per room:

- Property name
- Room number / name
- **Occupants** — supports multi-person rooms (the Occupants column shows who's in each room)
- Check In / Check Out dates
- Nights (auto-computed)
- Cost and Sell totals
- Optional **PO linkage** to attach the booking to a specific PO

### Bulk operations

The accommodation panel has more bulk tooling than Cars because rooms are usually booked in large batches:

- **👥 Bookings** — bulk add multiple rooms in one operation
- **Select rows → ✏ Edit Dates** — bulk update check-in/out dates and nightly rate
- **Select rows → 🗑 Delete Selected** — bulk delete
- **🖨 Vendor** — printable vendor summary (totals per property)
- **🖨 Conf** — printable booking confirmation for sending to the property

### Property creation shortcut

When creating a new property, you can specify a number of rooms and the system auto-creates Room 1, Room 2, etc. Edit the nightly rate and assign occupants per room after.

## Back Office & SE Support

Open via **Personnel → Back Office** or **HR → Back Office**. The panel has **two tabs**:

### 🏢 Back Office Hours

Office-based hours for project management and support staff that aren't tracked on the regular timesheets — typically PM/PA/back-office time logged manually.

Per entry: date, person, hours, optional cost rate, description, notes.

The panel shows a per-person summary card row at the top, with each person's total hours and sell value. Filter by month. Export CSV.

This data feeds the SAP Reconciliation panel's "Import BO Hours" flow — SAP labour totals can be imported here so they match what finance sees.

### ✈️ SE Support Costs

Separate from Back Office Hours. Tracks SE AG support charges that come from the wider organisation — typically EUR-priced.

Per entry: date, description, amount, currency, sell value.

Used for charging back SE AG involvement (engineering support, specialist consultancy) that wouldn't go on a regular timesheet.

## How these feed cost reports

All three modules flow into the WBS aggregator (the engine behind Cost Summary, MIKA EAC, and the Cost Register):

- **Cars** and **Accommodation** are **date-range items** — when the Cost Report's week filter is set, they're pro-rated by the number of days the booking covers within the window
- **Back Office Hours** are **date-stamped** — they're filtered to the week window, not pro-rated
- **SE Support Costs** are date-stamped, billed in EUR — the Customer Report's currency mode controls how they're displayed

Pro-rating matters for accurate per-week reporting. A 4-week accommodation booking spanning weeks 1-4 will show 25% of the cost in each week's snapshot, even though the booking record is a single row.
