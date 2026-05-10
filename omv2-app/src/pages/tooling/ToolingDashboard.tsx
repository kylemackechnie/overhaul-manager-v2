import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { TOOLING_REGISTRY, TOOLING_TILE_MAP, TOOLING_CATEGORIES } from '../../components/dashboard/tiles/tooling'

const QUICK_LINKS = [
  { label: '📋 TV Register',   panel: 'tooling-tvs' },
  { label: '📦 Kollos',        panel: 'tooling-kollos' },
  { label: '💶 Costings',      panel: 'tooling-costings' },
  { label: '🏢 Departments',   panel: 'tooling-departments' },
]

export function ToolingDashboard() {
  return (
    <CustomisableDashboard
      dashboardId="tooling"
      registry={TOOLING_REGISTRY}
      categories={TOOLING_CATEGORIES}
      tileComponents={TOOLING_TILE_MAP}
      quickLinks={QUICK_LINKS}
      maxWidth={1100}
    />
  )
}
