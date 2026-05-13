import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { COST_REGISTRY, COST_TILE_MAP, COST_CATEGORIES } from '../../components/dashboard/tiles/cost'

const QUICK_LINKS = [
  { label: '🧾 Invoices',      panel: 'invoices' },
  { label: '📋 Purchase Orders', panel: 'purchase-orders' },
  { label: '📈 Forecast',      panel: 'cost-forecast' },
  { label: '📊 SAP Recon',     panel: 'sap-recon' },
  { label: '🔀 Variations',    panel: 'variations' },
  { label: '💸 Expenses',      panel: 'expenses' },
]

export function CostDashboardPanel() {
  return (
    <CustomisableDashboard
      dashboardId="cost"
      registry={COST_REGISTRY}
      categories={COST_CATEGORIES}
      tileComponents={COST_TILE_MAP}
      quickLinks={QUICK_LINKS}
    />
  )
}
