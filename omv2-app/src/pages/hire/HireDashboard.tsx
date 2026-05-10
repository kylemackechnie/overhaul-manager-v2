import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { HIRE_REGISTRY, HIRE_TILE_MAP, HIRE_CATEGORIES } from '../../components/dashboard/tiles/hire'

const QUICK_LINKS = [
  { label: '🚜 Dry Hire',     panel: 'hire-dry' },
  { label: '🏗️ Wet Hire',    panel: 'hire-wet' },
  { label: '🧰 Local Equip',  panel: 'hire-local' },
]

export function HireDashboard() {
  return (
    <CustomisableDashboard
      dashboardId="hire"
      registry={HIRE_REGISTRY}
      categories={HIRE_CATEGORIES}
      tileComponents={HIRE_TILE_MAP}
      quickLinks={QUICK_LINKS}
      maxWidth={900}
    />
  )
}
