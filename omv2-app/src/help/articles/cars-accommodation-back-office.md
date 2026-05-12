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

The three modules feed cost reporting differently:

**Back Office Hours and SE Support Costs are immediate actuals.** Once you log a back office entry or an SE Support charge, it flows directly into PTD Actuals on MIKA and into the Cost Summary Report. Back Office Hours show under the `backoffice` module; SE Support shows under `se_support`. Both are date-stamped and filtered to the current week when the Cost Summary has a week filter set.

**Cars and Accommodation are bookings, not actuals.** Adding a car or accommodation booking creates a planning record only — the cost lives on the Forecast page until the supplier invoices through. When the matching supplier invoice is approved (under Cost Tracking → Invoices), the cost flips to actual and appears under the `invoices` bucket on MIKA and the Cost Summary.

This is consistent with how MIKA tracks SAP-side spend — bookings are intent, invoices are spend. If you want to see what's committed but not yet invoiced (i.e. the booking value), look at the Forecast panel or the Cost Register; if you want to see what's actually been spent, look at MIKA's PTD Actuals or the Cost Summary.

**SE Support** charges remain in EUR for SE AG-supplied work. The Customer Report's currency mode controls whether they're displayed as EUR or converted to base currency.
