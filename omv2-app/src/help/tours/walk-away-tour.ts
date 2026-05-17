/**
 * Walk-Away walkthrough.
 *
 * Anchors used (all on the Walk-Away panel, src/pages/sandbox/WalkAwayPanel.tsx):
 *   - [data-tour="walkaway-title"]
 *   - [data-tour="walkaway-date"]
 *   - [data-tour="walkaway-compare"]
 *   - [data-tour="walkaway-notice"]
 *   - [data-tour="walkaway-kpis"]
 *   - [data-tour="walkaway-headline"]
 *   - [data-tour="walkaway-breakdown"]
 *
 * The tour assumes the panel loads with default state (compare off, notice
 * editor collapsed). The bucket meaning and source-by-source classification
 * rules live in the Walk-Away article rather than being narrated here — the
 * tour orients on the panel; the article explains the model.
 */

import type { Tour } from './_types'

const tour: Tour = {
  id: 'walk-away-tour',
  title: 'Walk-Away Analysis',
  description: 'Cost-to-stop on a chosen date. Four buckets across all 15 cost sources, plus compare-two-dates for "what gets locked between now and finish".',
  module: 'Sandbox',
  estimatedSeconds: 100,
  requiresPanel: 'sandbox-walkaway',
  steps: [
    {
      title: '🚪 Walk-Away — what would it cost to stop?',
      body: "This panel answers a single question: if we stopped on a chosen date, what's the bill? Every dollar of the project's EAC is sorted into Sunk, Locked, Avoidable, or Discretionary based on where each commitment sits relative to that date. Different from the Cost Report and MIKA — those show what's been spent; Walk-Away shows what you'd still owe.",
    },
    {
      target: '[data-tour="walkaway-title"]',
      title: 'Decision-support, not actuals',
      body: "The article behind the question-mark icon explains the four buckets, the per-source classification rules, and the known limitations. Worth reading once — the panel is light-touch but the model behind it has some sharp corners (variations classify by status not date; labour merges timesheet entries over forecast; tooling FX'd EUR → AUD).",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="walkaway-date"]',
      title: 'The central control',
      body: "Pick any date. The engine re-runs and every number on the page shifts. Today is the default. Try jumping forward a few weeks — Avoidable will shrink as more cost lands inside the consumed-by-then window. Jumping to end of project: everything goes Sunk, because at that point the work is done either way.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="walkaway-compare"]',
      title: 'Compare two dates',
      body: "Toggle this on to run the engine against a second date as well. Every cell in the table gains a → B line, and the totals row picks up a delta column. Date B defaults to your project end date — answers 'between now and finish, how much locks in?'. Total EAC won't change between A and B; it's the same project. The reveal is in the bucket shift.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="walkaway-notice"]',
      title: 'Notice periods per source',
      body: "Each of the 15 cost sources has its own notice-period setting in days — how far ahead of the walk-away date a commitment counts as Locked rather than Avoidable. Defaults are all 1 day. Subcon contracts often have much longer notice (14–28 days); accommodation 1–7 depending on the property. Edit them here; saved per-project. The defaults are deliberately tight — bumping them out reflects real-world cancellation reality.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="walkaway-kpis"]',
      title: 'The four buckets at a glance',
      body: "Sunk: already spent. Locked: in the demob-notice window, can't avoid. Avoidable: beyond notice, would save if you cancel. Discretionary: no commitment yet (proposed variations, draft scope). Sunk + Locked = the bill if you stop. Avoidable + Discretionary = what you save by stopping. The percentages underneath show how much of total EAC each bucket holds.",
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="walkaway-headline"]',
      title: 'The two numbers that matter',
      body: "If we stop on the chosen date = Sunk + Locked. We'd save = Avoidable + Discretionary. They sum to total EAC, so the trade-off is always visible. In compare mode this row shows both dates inline — the cost-to-stop on A vs B side by side.",
      side: 'top',
      align: 'center',
    },
    {
      target: '[data-tour="walkaway-breakdown"]',
      title: 'By cost source',
      body: "All 15 sources broken out by bucket. Each row shows where its cost lands at the chosen date. Variations always classify by status not date — approved goes to Locked regardless of when. Labour rows merge timesheet entries (when present) over forecast cost for past days, so the Sunk amount reflects what was actually logged rather than what was predicted. Empty rows mean the project doesn't use that source.",
      side: 'top',
      align: 'center',
    },
    {
      title: '🎉 You know the panel',
      body: "Pick a date → engine classifies every commitment → Sunk + Locked is your stop-now bill → Avoidable + Discretionary is your saving. Compare mode shows the shape between any two points. Notice periods encode cancellation reality. Read the Walk-Away article (Reference tab) for the per-source rules and the known limitations — particularly that approved variations can double-count with labour actuals, and PO-drawn override isn't wired yet for cars/accom/hire.",
    },
  ],
}

export default tour
