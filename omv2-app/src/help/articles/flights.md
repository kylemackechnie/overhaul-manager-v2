---
slug: flights
title: Flights & Travel
category: Personnel
order: 55
relatedTour: flights-tour
relatedPanels: [hr-flights, hr-resources, expenses]
summary: Track resource flight legs, link booking receipts to specific legs, and avoid double-counting flight cost in EAC.
---

# Flights & Travel

The **Flights** page tracks every flight leg for every resource on the project — both planned and actual cost. It lives under **HR → Travel & Lodging → Flights**, alongside Cars and Accommodation.

This article walks through the whole flow: how flight legs come into being, how forecast picks them up, and how to reconcile receipts when the bills arrive.

## The shape of the system

Every resource with **Flight Required** ticked gets **two legs** on the Flights page by default:

- **Outbound** — the trip to site
- **Return** — the trip home

These two legs are *canonical*: they feed forecast directly, and they're what the readiness flags check.

You can also add **custom legs** for ad-hoc travel — typically a mid-project home visit. Custom legs are treated as actuals-only: they don't go into forecast, they just need a real expense and a link.

Each leg carries:

- Planned cost (the estimate before booking)
- Currency (AUD for everyone except SEAG — those default to EUR)
- Vendor, flight number, date/time, route, status
- An optional link to the actual expense receipt

The **actual cost** of a flight is *not stored on the leg itself*. It lives on the linked expense (the Webjet/Qantas receipt entered in the normal Expenses panel). The flight leg just *points* at that expense. This means everything you already know about expense WBS attribution, currency, FX, GST, chargeable flagging — all of that just keeps working.

## Adding a resource that flies

Open the **Resources** panel and add or edit a person. Tick **✈️ Flight Required** under Logistics Requirements.

When you save, the system creates two pending flight legs at the category default:

- **SEAG** category → €5,000 per leg (€10,000 return)
- All other categories → $500 AUD per leg ($1,000 return)

These defaults flow straight into forecast and EAC. If the planned cost is wrong, edit the leg on the Flights page — not on the resource record. The Flights page is the source of truth.

If you change the category later (e.g. someone gets reclassified from management to SEAG), the legs refresh to the new default — **but only if you haven't touched them yet**. Once you've edited a leg's vendor, flight number, planned cost, or anything else, the system treats it as yours and leaves it alone.

Unticking Flight Required does *not* delete existing legs. They stay on the Flights page with a yellow warning banner so you can decide whether to keep them as historical record or delete them.

## Booking a flight

Flights aren't booked through OMV2 — admin books on the airline or via Webjet/Flight Centre. What OMV2 needs to know:

1. Open **Flights**, expand the person, click **Edit** on the relevant leg
2. Fill in **Vendor**, **Flight #**, **Date/Time**, **From**/**To**
3. If the planned cost was wrong, update it
4. Status → **Booked**
5. Save

That's it. Forecast already had the planned cost in it (since the leg was created with the default), so saving doesn't change EAC.

**The single source of "is the flight on the books"** is the **flight number** field. Entering a flight number is what:

- Clears the mob-readiness warning ("flight ok" on the readiness tile)
- Drops the resource off the attention items list
- Flips the Resources page cell colour from amber to green

You don't need to flip the status dropdown for any of that. Status is just a manual marker if you want to track cancellations or pending bookings separately.

## When the receipt arrives — reconciliation

Once the flight is paid for, admin enters a normal expense in the **Expenses** panel:

- **Category**: **Flight** (this category is what enables the link-to-flight workflow)
- **Person**: pick the resource the flight is for
- **WBS**: same WBS as the resource (so plan and actuals attribute to the same code)
- Everything else as you normally would — receipt upload, amount, currency, GST

When you save, the expense appears on the Expenses panel with a **red left border** and **light pink background**. A red banner appears at the top:

> ⚠ 1 flight expense is not linked to a flight leg. These are flagged in red below — open the Flights page and use "🔗 Link expense" on the matching leg to reconcile.

This is the system telling you it knows you've entered the cost but doesn't yet know which leg it pays for. Until you link it, EAC is *double-counting* — the actual is in actuals AND the original $500 forecast is still in Forecast TC.

Click **Open Flights →** from the banner, expand the resource, and click **🔗 Link expense** on the matching leg (outbound or return). A picker shows your Flight-category expenses for that person. Pick the right one.

After linking:

- The leg displays the actual cost, variance vs planned, and a ✓ Linked indicator
- The orphan styling on the expense disappears
- Forecast TC drops by the leg's planned amount (since the expense path now covers that cost)
- Actuals goes up by the expense amount
- Net EAC: typically a small variance saving or overrun

## Custom legs (home visits, ad-hoc travel)

For mid-project flights that weren't planned:

1. Expand the resource on the Flights page
2. Click **+ Add leg for [name]**
3. Leg type → **Custom**, give it a label like "Home visit return"
4. Fill in vendor, flight, route, planned cost
5. Save

Custom legs are deliberately **not** added to forecast. The assumption is: by the time you're adding one, you already know the cost, and you'll enter the expense within a day or two. So the planned cost on a custom leg is just for your reference — it doesn't move EAC.

When the receipt comes in, enter the expense and link it exactly as you would for an outbound/return. Same workflow, same modal.

## Unlinking and editing

If you link the wrong expense, click **Unlink** on the leg. The expense itself isn't deleted — it just goes back to being orphaned (red row, banner re-appears) so you can link it to the correct leg.

If you delete the expense entirely from the Expenses panel, the link is automatically cleared — the leg returns to its pre-link state, ready for a new link.

## How forecast picks up flight cost

For each resource with Flight Required ticked:

- If there are canonical legs (outbound or return) in the Flights table for that resource: forecast reads each leg's planned cost on its scheduled date. If a leg has a linked expense, its forecast estimate is skipped (the expense takes over).
- If there are no canonical legs yet: forecast falls back to `2 × $500` (or the SEAG equivalent) on the resource's mob_in/mob_out dates. This only applies to brand-new flight_required resources who haven't been processed through auto-create yet.

Custom legs are never in forecast.

Currency conversion: EUR amounts get converted to AUD at the project FX rate before being added to byWbs / byDay totals.

## Where flight cost shows up

| Surface | Includes flight cost? |
|---|---|
| Forecast page → Expenses row | Yes (rolled into Expenses) |
| MIKA → Forecast TC column | Yes |
| MIKA → Actuals column | Only once an expense is entered and linked |
| Dashboard Forecast Snapshot tile | Yes |
| Resources page cell | Yes (counter + next-flight info) |

The Forecast page doesn't have a dedicated "Flights" column — it rolls flights into the Expenses bucket. This is a deliberate trade-off to avoid changes across ~50 consumer references. If you need to know exactly how much of the Expenses bucket is flights vs other expenses, the Flights page footer totals show it.

## Resources page cell — what the colour means

The cell shows `✈ X/Y · <next flight info>` where:

- **X** = legs with a flight number entered
- **Y** = total active (non-cancelled) legs

Cell colour rule:

- **Amber** — next-upcoming flight is within 14 days AND no flight number entered → chase a booking
- **Green** — next flight is more than 14 days away, OR a flight number is entered, OR no upcoming flights
- **Grey** — Flight Required not ticked

Click the cell to jump to the Flights page.

## Common scenarios

**A new project starts.** You add 12 trades + 6 management with Flight Required. Each person gets 2 legs auto-created at $500. Forecast shows $1,000 × 18 = $18,000 in Expenses. As bookings come in, you update flight #s on the legs (no EAC change). As receipts arrive, you enter expenses and link them (each link drops forecast by $500 and adds the actual to actuals — typically saving a few dozen dollars per leg vs the $500 estimate).

**Someone cancels.** Either change their status to Cancelled (the leg fades to grey, drops out of forecast and out of the counter) or untick Flight Required on the resource (legs stay, banner appears).

**A flight gets rebooked at a higher price.** Edit the planned cost on the leg before the receipt arrives. Forecast updates. When the receipt comes in and you link it, the new actual replaces the higher estimate.

**Someone takes an unexpected home visit.** Add a custom leg with the actual flight info + planned cost. Enter the receipt as a Flight-category expense for that person, link it to the custom leg. Forecast unaffected; actuals + EAC go up by the expense amount.

**You enter a flight expense but forget to link it.** The red orphan banner reminds you on the Expenses page. EAC is temporarily inflated by the un-displaced leg estimate. Link to fix.
