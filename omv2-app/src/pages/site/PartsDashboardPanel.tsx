import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { PARTS_REGISTRY, PARTS_TILE_MAP, PARTS_CATEGORIES } from '../../components/dashboard/tiles/parts'

const QUICK_LINKS = [
  { label: '📋 Parts List',    panel: 'parts-list' },
  { label: '📥 Import WOSIT', panel: 'parts-import' },
  { label: '✅ Receiving',     panel: 'parts-receiving' },
  { label: '🔩 Issue Parts',   panel: 'parts-issue' },
]

export function PartsDashboardPanel() {
  return (
    <CustomisableDashboard
      dashboardId="parts"
      registry={PARTS_REGISTRY}
      categories={PARTS_CATEGORIES}
      tileComponents={PARTS_TILE_MAP}
      quickLinks={QUICK_LINKS}
      maxWidth={960}
    />
  )
}
