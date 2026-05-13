import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { SHIPPING_REGISTRY, SHIPPING_TILE_MAP, SHIPPING_CATEGORIES } from '../../components/dashboard/tiles/shipping'

const QUICK_LINKS = [
  { label: '📥 Imports',  panel: 'shipping-imports' },
  { label: '📤 Exports',  panel: 'shipping-exports' },
]

export function ShippingDashboard() {
  return (
    <CustomisableDashboard
      dashboardId="shipping"
      registry={SHIPPING_REGISTRY}
      categories={SHIPPING_CATEGORIES}
      tileComponents={SHIPPING_TILE_MAP}
      quickLinks={QUICK_LINKS}
    />
  )
}
