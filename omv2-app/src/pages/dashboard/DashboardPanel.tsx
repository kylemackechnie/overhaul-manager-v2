import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { MAIN_REGISTRY, MAIN_TILE_MAP, MAIN_CATEGORIES } from '../../components/dashboard/tiles/main'
import { MainDashboardHeader, MainDashboardAlerts } from '../../components/dashboard/tiles/main/MainDashboardChrome'

const QUICK_LINKS = [
  { label: '📋 Timesheets',    panel: 'hr-timesheets-trades' },
  { label: '📦 Parts List',    panel: 'parts-list' },
  { label: '📥 Import Parts',  panel: 'parts-import' },
  { label: '💰 Cost Dashboard',panel: 'cost-dashboard' },
  { label: '📈 Forecast',      panel: 'cost-forecast' },
  { label: '📝 Variations',    panel: 'variations' },
  { label: '⚙ Settings',       panel: 'project-settings' },
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
      alerts={<MainDashboardAlerts />}
      quickLinks={QUICK_LINKS}
    />
  )
}
