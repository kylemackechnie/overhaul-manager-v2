/**
 * Resources panel walkthrough.
 *
 * Anchors used (all in src/pages/personnel/ResourcesPanel.tsx):
 *   - [data-tour="resources-title"]
 *   - [data-tour="resources-search"]
 *   - [data-tour="resources-category-pills"]
 *   - [data-tour="resources-status-filter"]
 *   - [data-tour="resources-import"]
 *   - [data-tour="resources-columns"]
 *   - [data-tour="resources-add-person"]
 *   - [data-tour="resources-table"]
 *   - [data-tour="resources-calendar"]
 */

import type { Tour } from './_types'

const tour: Tour = {
  id: 'resources-panel-tour',
  title: 'Resources Panel',
  description: 'Tour the resource list — adding people, filtering, importing, and the Gantt calendar',
  module: 'Personnel',
  estimatedSeconds: 120,
  requiresPanel: 'hr-resources',
  steps: [
    {
      title: '👥 Resources — the people on the job',
      body: "This is where everyone working on the project lives. Every timesheet, cost report, accommodation booking, and PO link traces back to a resource here. Let's look at how to find your way around.",
    },
    {
      target: '[data-tour="resources-title"]',
      title: 'Title and headcount',
      body: 'The total headcount is shown right under the title. As you filter the table below, the headcount stays static — it always reflects the whole project, not the current filter.',
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="resources-category-pills"]',
      title: 'Filter by category',
      body: 'Four categories: Trades (frontline workers), Mgmt (PMs, supervisors), SE AG (Siemens Energy specialists), Subcon (subcontractor labour). Click a pill to filter the table — the count next to each label shows how many people are in that category.',
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="resources-status-filter"]',
      title: 'Filter by status',
      body: "Status is auto-computed from mobilisation dates: On-site, Incoming (mob soon), Upcoming, Departed, Future, or No dates. Use this to find who's currently on site, or anticipate the next wave coming in.",
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="resources-search"]',
      title: 'Search across name, role, company',
      body: "Type to filter by name, role, or company. Combines with the category and status filters — handy for things like 'show me all the Welders currently on-site'.",
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="resources-add-person"]',
      title: 'Add a person',
      body: 'Opens the resource modal. Name is the only required field — everything else (role, dates, shift, allowances) can be filled in over time as you learn more about the engagement.',
      side: 'bottom',
      align: 'end',
    },
    {
      target: '[data-tour="resources-import"]',
      title: 'Bulk import',
      body: 'For larger crews, paste a CSV (Name, Role, Company, Email, Phone, Mob In, Mob Out) — or paste an NRG roster directly. The import auto-detects which format you used.',
      side: 'bottom',
      align: 'end',
    },
    {
      target: '[data-tour="resources-columns"]',
      title: 'Column visibility',
      body: 'Show or hide table columns to suit how you work. A badge appears here when columns are hidden. Your selection is saved per user, so the layout sticks across sessions.',
      side: 'bottom',
      align: 'end',
    },
    {
      target: '[data-tour="resources-table"]',
      title: 'The resource table',
      body: 'Click any column header to sort. The checkbox column lets you select multiple rows for bulk edits — change role, shift, mob dates, or allowances across many people in one go. Click a person to edit them individually.',
      side: 'top',
      align: 'center',
    },
    {
      target: '[data-tour="resources-calendar"]',
      title: 'On-site Gantt calendar',
      body: 'Below the table, a Gantt-style timeline shows who is on site when. View presets (2 weeks, 4 weeks, 8 weeks, full project span) let you zoom in or out. Drag the edges of a bar to adjust mob dates directly — no modal needed.',
      side: 'top',
      align: 'center',
    },
    {
      title: '🎉 You know the Resources panel',
      body: "For more depth — categories, shift phases, allowances, the Utilisation cross-project view — open the Resources & Roles article from the Reference tab. Subcontractor resources have an extra step: link them to a PO so cost reconciles, covered in that article too.",
    },
  ],
}

export default tour
