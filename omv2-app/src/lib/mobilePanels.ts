/**
 * Single source of truth for mobile-optimised panels.
 *
 * Used by:
 * - MobilePanelRouter (App.tsx) — decides whether to render the panel or
 *   show the "Open on desktop" soft-block
 * - MobileNavSheet — hides desktop-only items from the More sheet so field
 *   users aren't presented with dead-end options
 *
 * To add a new mobile-optimised panel:
 * 1. Build the mobile component at src/pages/mobile/<Panel>Mobile.tsx
 * 2. Wire the desktop panel with React.lazy + useIsMobile (see CarsPanel
 *    for the canonical pattern — lazy-loading is mandatory)
 * 3. Add the panel key to MOBILE_OPTIMISED below
 */
export const MOBILE_OPTIMISED: ReadonlySet<string> = new Set([
  // Always-allow: navigation/admin/profile (simple enough to render as-is)
  'dashboard',
  'profile',
  'help',
  'project-settings',
  // Personnel
  'hr-resources',
  'hr-accommodation',
  'hr-cars',
  'hr-inductions',
  // Site / Parts
  'parts-issue',
  'parts-receiving',
])

/**
 * Friendly display names for the desktop-only block screen. Only includes
 * panels likely to appear in MobileDesktopOnly (i.e. panels that are
 * reachable from the mobile shell but blocked).
 */
export const PANEL_FRIENDLY_NAMES: Record<string, string> = {
  // Cost
  'cost-forecast':        'Forecast',
  'cost-mika':            'MIKA',
  'cost-reconcile':       'Forecast vs MIKA',
  'cost-scurve':          'S-Curve',
  'cost-report':          'Cost Report',
  'cost-customer-report': 'Customer Report',
  'cost-dashboard':       'Cost Dashboard',
  'sap-recon':            'SAP Reconciliation',
  'pre-planning-report':  'Pre-Planning Report',
  'reports-db':           'Reports Database',
  // Subcon
  'subcon-rfq-doc':       'RFQ Document Builder',
  'subcon-rfq':           'Subcon Cost Model',
  // NRG
  'nrg-tce':              'NRG TCE Register',
  'nrg-ohf':              'NRG Overhead Forecast',
  'nrg-actuals':          'NRG Actuals',
  'nrg-invoicing':        'NRG Invoicing',
  'nrg-kpi':              'NRG KPI Model',
  // Project
  'gantt':                'Gantt Chart',
  'wbs-list':             'WBS List',
  // Personnel
  'hr-utilisation':       'Utilisation',
  'hr-ratecards':         'Rate Cards',
  // Hardware/Tooling
  'hardware-import':      'Hardware Import',
  'hardware-contract':    'Hardware Contracts',
  'tooling-tvs':          'TV Register',
  'tooling-kollos':       'Kollos',
  'tooling-costings':     'Tooling Costings',
}
