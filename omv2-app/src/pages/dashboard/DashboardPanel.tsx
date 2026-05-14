import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { MAIN_REGISTRY, MAIN_TILE_MAP, MAIN_CATEGORIES } from '../../components/dashboard/tiles/main'
import { MainDashboardHeader } from '../../components/dashboard/tiles/main/MainDashboardChrome'

// Quick-link buttons that sit beneath the tile grid. Kept narrow on purpose —
// the dashboard is the destination now, not a launchpad. Heavy navigation lives
// in the ribbon.
const QUICK_LINKS = [
  { label: '📋 Timesheets',    panel: 'hr-timesheets-trades' },
  { label: '📦 Parts List',    panel: 'parts-list' },
  { label: '💰 Cost Dashboard',panel: 'cost-dashboard' },
  { label: '📈 Forecast',      panel: 'cost-forecast' },
  { label: '📝 Variations',    panel: 'variations' },
  { label: '✅ Pre-Planning',   panel: 'pre-planning' },
]

export function DashboardPanel() {
  return (
    <CustomisableDashboard
      dashboardId="main"
      registry={MAIN_REGISTRY}
      categories={MAIN_CATEGORIES}
      tileComponents={MAIN_TILE_MAP}
      header={<MainDashboardHeader />}
      quickLinks={QUICK_LINKS}
    />
  )
}
