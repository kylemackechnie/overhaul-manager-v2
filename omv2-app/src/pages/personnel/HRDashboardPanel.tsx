import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { HR_REGISTRY, HR_TILE_MAP, HR_CATEGORIES } from '../../components/dashboard/tiles/hr'

const QUICK_LINKS = [
  { label: '👤 Resources',     panel: 'hr-resources' },
  { label: '📋 Timesheets',    panel: 'hr-timesheets-trades' },
  { label: '🚗 Cars',          panel: 'hr-cars' },
  { label: '🏨 Accommodation', panel: 'hr-accommodation' },
  { label: '📋 Inductions',    panel: 'hr-inductions' },
]

export function HRDashboardPanel() {
  return (
    <CustomisableDashboard
      dashboardId="hr-v2"
      registry={HR_REGISTRY}
      categories={HR_CATEGORIES}
      tileComponents={HR_TILE_MAP}
      quickLinks={QUICK_LINKS}
      gridCols={6}
    />
  )
}
