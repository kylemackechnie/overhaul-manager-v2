/**
 * MIKA Cost Plan walkthrough.
 *
 * Anchors used (all in src/pages/cost/MikaPanel.tsx):
 *   - [data-tour="mika-title"]
 *   - [data-tour="mika-import"]
 *   - [data-tour="mika-kpis"]
 *   - [data-tour="mika-filters"]
 *   - [data-tour="mika-table"]
 *
 * The KPI strip, filters, and table only render once MIKA data has been
 * imported on the project. driver.js degrades gracefully to a centered
 * popover when a target doesn't exist, so a user on an empty project still
 * gets the explanatory text — they just don't see anything highlighted on
 * those steps. The intro step calls this out so it's not confusing.
 */

import type { Tour } from './_types'

const tour: Tour = {
  id: 'mika-tour',
  title: 'MIKA Cost Plan',
  description: 'The financial backbone — WBS hierarchy, PM80/PM100 budgets, PTD actuals, and the EAC roll-up that every other cost panel reads from',
  module: 'Cost Tracking',
  estimatedSeconds: 150,
  requiresPanel: 'cost-mika',
  steps: [
    {
      title: '📊 MIKA — the financial backbone',
      body: "Every project's cost structure starts here. Importing MIKA populates the WBS hierarchy, PM80 and PM100 budgets, and PTD actuals — and every other cost panel (WBS list, Cost Report, Forecast, EAC, Dashboard) reads from this data. If your project has no MIKA imported yet, some steps in this tour will show as centered popovers — the highlighted UI only appears after import.",
    },
    {
      target: '[data-tour="mika-title"]',
      title: 'Top of the panel',
      body: "The header has two actions on the right: ✕ Clear (wipes the current MIKA data — use with care, it doesn't delete the underlying timesheets/invoices but you'll lose the WBS structure) and ⬇ Export CSV (dumps every WBS line with PM80, PM100, Actuals, Forecast, EAC, and Variance for sharing or archiving).",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="mika-import"]',
      title: 'Importing a MIKA cost plan',
      body: "Drop a MIKA CSV export here, or click to browse. The file comes from the Project Planning main tab in MIKA. Import reads the WBS structure, PM80 (baseline / approved spend authority), PM100 (current budget including approved changes), and PTD actuals. Re-importing replaces existing data — a preview appears alongside so you can sanity-check before committing.",
      side: 'right',
      align: 'start',
    },
    {
      target: '[data-tour="mika-kpis"]',
      title: 'The six top-line numbers',
      body: "Project-wide totals across all WBS lines. PM80 Baseline is the original approved spend authority. PM100 Budget is the current budget (PM80 plus approved changes). PTD Actuals is realised cost from approved timesheets, approved invoices, expenses, back office hours, and approved variation lines. PO Committed is the not-yet-invoiced value of active POs. EAC (calc) is Actuals + Committed + remaining Forecast — the total at completion. Variance is PM100 minus EAC at the top-level total — positive is good (under budget), negative is over. The per-row Variance column in the table further accounts for approved variations on each WBS line.",
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="mika-filters"]',
      title: 'Search and filter',
      body: "Search hits both WBS code and description. The level dropdown filters by WBS depth — L2 is top-level summary, L5 is the deepest detail. Useful when you want to focus on summary roll-ups vs see every leaf line. Row count is shown on the right.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="mika-table"]',
      title: 'The WBS table',
      body: "One row per WBS line, indented by level. PM80 and PM100 cells are editable inline — click a value to override. The Approved VNs and Pending VNs columns roll in variation values per WBS line: approved variations bump Revised Budget (shown in the next column), pending ones are visibility-only and don't affect calcs. Click any number cell to drill into its contributing source data (timesheets, invoices, expenses, etc).",
      side: 'top',
      align: 'center',
    },
    {
      title: 'Data quality warnings',
      body: "If the table is preceded by an amber warning strip, it means one or more cost items are missing WBS codes or forecast dates. Those items are excluded from the EAC calculation — find them in their source panel (Cost Tracking → POs / Invoices, Personnel → Resources, etc) and set the missing field. The strip lists the first few; the warning persists until they're fixed.",
    },
    {
      title: '🎉 You know MIKA',
      body: "For the full picture — the relationship between PM80 and PM100, how Revised Budget interacts with variations, drill-down behaviour, the WBS list panel as a simpler view — open the MIKA Cost Plan & WBS article from the Reference tab.",
    },
  ],
}

export default tour
