import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { HSE_REGISTRY, HSE_TILE_MAP, HSE_CATEGORIES } from '../../components/dashboard/tiles/hse'

const QUICK_LINKS = [
  { label: '⏱ Log HSE Hours', panel: 'hse-hours' },
  { label: '📋 Inductions',   panel: 'hr-inductions' },
  { label: '🌿 CO₂ Tracking', panel: 'hse-co2' },
]

export function HSEDashboardPanel() {
  return (
    <CustomisableDashboard
      dashboardId="hse"
      registry={HSE_REGISTRY}
      categories={HSE_CATEGORIES}
      tileComponents={HSE_TILE_MAP}
      quickLinks={QUICK_LINKS}
      maxWidth={900}
    />
  )
}
