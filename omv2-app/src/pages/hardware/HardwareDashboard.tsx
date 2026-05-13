import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { HARDWARE_REGISTRY, HARDWARE_TILE_MAP, HARDWARE_CATEGORIES } from '../../components/dashboard/tiles/hardware'

const QUICK_LINKS = [
  { label: '📄 Contracts',   panel: 'hardware-contract' },
  { label: '🛒 Carts',       panel: 'hardware-carts' },
  { label: '📈 Escalation',  panel: 'hardware-escalation' },
  { label: '📊 Reports',     panel: 'hardware-reports' },
]

export function HardwareDashboard() {
  return (
    <CustomisableDashboard
      dashboardId="hardware"
      registry={HARDWARE_REGISTRY}
      categories={HARDWARE_CATEGORIES}
      tileComponents={HARDWARE_TILE_MAP}
      quickLinks={QUICK_LINKS}
    />
  )
}
