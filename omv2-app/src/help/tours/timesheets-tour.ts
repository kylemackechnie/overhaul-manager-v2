/**
 * Timesheets panel walkthrough.
 *
 * Stays on the list view (activeWeek === null) because anchoring across
 * the list/edit transition is fragile. The edit-mode features are
 * described in the wrap-up step with a pointer to the article.
 *
 * Anchors used (all in src/pages/personnel/TimesheetsPanel.tsx):
 *   - [data-tour="timesheets-title"]
 *   - [data-tour="timesheets-new-week"]
 *   - [data-tour="timesheets-kpis"]
 *   - [data-tour="timesheets-list"]
 *
 * If the user has no sheets yet, the KPI strip and list aren't rendered.
 * driver.js degrades gracefully to centered popovers for those steps.
 */

import type { Tour } from './_types'

const tour: Tour = {
  id: 'timesheets-tour',
  title: 'Timesheets',
  description: "Trades / Mgmt / SE AG / Subcon — the weekly hour-tracking workflow, status flow, and what happens inside a sheet",
  module: 'Personnel',
  estimatedSeconds: 150,
  requiresPanel: 'hr-timesheets-trades',
  steps: [
    {
      title: '⏱ Timesheets — turning hours into cost',
      body: "Approved timesheets are the source of truth for labour actuals. They feed the Cost Report, NRG Actuals, and the EAC on MIKA. Let's walk through how they work.",
    },
    {
      target: '[data-tour="timesheets-title"]',
      title: 'Four variants, same workflow',
      body: 'This is the Trades panel. There are three more — Management, SE AG, and Subcontractor — all using the same component, just scoped to a different category of resource. A subcontractor sheet has extra fields for vendor and PO so each week is tied to a contract.',
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="timesheets-new-week"]',
      title: 'Starting a new week',
      body: "Each timesheet is a Monday-start week. The modal asks for week start, regime (lt12 / gt12 — affects how hours split into overtime buckets), and for subcontractor sheets, the vendor and PO. A new week starts empty — you'll add crew next.",
      side: 'left',
      align: 'start',
    },
    {
      target: '[data-tour="timesheets-kpis"]',
      title: 'Project totals at a glance',
      body: 'Across all weeks of this type: how many weeks exist, how many are approved, total hours logged, and total sell value. SE AG totals are in EUR; everything else in the project base currency.',
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="timesheets-list"]',
      title: 'Each row is a week',
      body: "Each sheet shows the week range, headcount, hours, sell, and a status pill. Status moves Draft → Submitted → Approved. PA submits for approval; PM approves and can unlock. Click a sheet to open it.",
      side: 'top',
      align: 'center',
    },
    {
      title: 'Inside a sheet',
      body: "When you open a week you get the editor view. From there you can: Bulk Add crew (filtered to On-site only if you tick the box), enter per-day hours with day type and shift, run 'Allowances' to apply LAHA/Meal defaults, Import Payroll from TasTK or UKG, hit Next Week to roll the crew forward, and Save & Close when done. Approving the sheet writes timesheet_cost_lines — the source of truth for labour actuals everywhere else.",
    },
    {
      title: 'Recalculate — when actuals look wrong',
      body: "If the MIKA / Cost Report view shows missing labour actuals (after a deploy or schema change), the ↺ Recalculate button inside a sheet rebuilds timesheet_cost_lines for all approved sheets on the project. It only shows when there's at least one approved sheet to rebuild.",
    },
    {
      title: '🎉 You know Timesheets',
      body: "For more detail — day types, the regime model, payroll import formats, the TCE mismatch warning on NRG projects — open the Timesheets article from the Reference tab. The four panel variants share this article.",
    },
  ],
}

export default tour
