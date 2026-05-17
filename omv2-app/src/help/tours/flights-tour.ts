/**
 * Flights walkthrough.
 *
 * Anchors used (all on the Flights page, src/pages/personnel/FlightsPanel.tsx):
 *   - [data-tour="flights-title"]
 *   - [data-tour="flights-search"]
 *   - [data-tour="flights-expand-all"]
 *   - [data-tour="flights-add-leg"]
 *   - [data-tour="flights-link-expense"]   (first unlinked leg, only in DOM
 *                                           when a group is expanded — driver.js
 *                                           falls back to a centered popover if absent)
 *
 * Cross-panel concepts (resource modal's Flight Required checkbox, the
 * Expenses page orphan banner) are documented in the Flights & Travel article
 * rather than animated here — the tour stays on a single panel for simplicity.
 */

import type { Tour } from './_types'

const tour: Tour = {
  id: 'flights-tour',
  title: 'Flights & Travel',
  description: 'Track flight legs, book flights, and reconcile receipts to avoid double-counting in EAC',
  module: 'Personnel',
  estimatedSeconds: 90,
  requiresPanel: 'hr-flights',
  steps: [
    {
      title: '✈️ Flights — where every leg lives',
      body: "This page tracks every flight leg for every flying resource — planned cost up front, actual cost once the receipt is linked. Forecast and EAC both read from here, so what you see here is what flows through to the cost model.",
    },
    {
      target: '[data-tour="flights-title"]',
      title: 'Header summary',
      body: 'People on this project flying, total legs in the system, and how many are actualised (have a linked expense). The actualised count drives the difference between planned and EAC.',
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="flights-search"]',
      title: 'Search by person',
      body: 'Filters the groups below. Handy on bigger projects — type a name to jump straight to who you need.',
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="flights-expand-all"]',
      title: 'Expand / collapse',
      body: "Each resource is a collapsible group with their legs inside. Use these to expand all or collapse all at once. Your expansion choices persist across sessions — what you have open today stays open tomorrow.",
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="flights-add-leg"]',
      title: 'Add a leg',
      body: "Most legs are auto-created when you tick Flight Required on a resource (outbound + return at the category default — €5,000 SEAG, $500 others). Use this button for ad-hoc cases like mid-project home visits, which create a Custom leg.",
      side: 'bottom',
      align: 'end',
    },
    {
      target: '[data-tour="flights-link-expense"]',
      title: 'Link to expense — the key action',
      body: "When a flight is paid, admin enters a normal expense in the Expenses panel with category Flight. Then come back here, expand the resource, and click Link Expense on the matching leg. Forecast drops the leg's planned amount (since the expense now covers it), actuals goes up by the receipt amount, and EAC reconciles. Without the link, the Expenses panel surfaces a red banner — the system telling you EAC is temporarily double-counting.",
      side: 'top',
      align: 'center',
    },
    {
      title: '🎉 You know the Flights page',
      body: "Tick Flight Required on a resource → legs auto-create → admin books the flight (enters the flight number) → receipt arrives, entered as a Flight-category expense → link expense to leg → EAC reconciles. For the deeper rules (pristine refresh on category change, custom-leg semantics, what the cell colours mean) read the Flights & Travel article in the Reference tab.",
    },
  ],
}

export default tour
