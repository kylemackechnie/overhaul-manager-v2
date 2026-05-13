import { CustomisableDashboard } from '../../components/dashboard/CustomisableDashboard'
import { SUBCON_REGISTRY, SUBCON_TILE_MAP, SUBCON_CATEGORIES } from '../../components/dashboard/tiles/subcon'

const QUICK_LINKS = [
  { label: '📄 RFQ Register', panel: 'subcon-rfq-register' },
  { label: '+ New RFQ',       panel: 'subcon-rfq-doc' },
  { label: '📋 POs',          panel: 'purchase-orders' },
]

export function SubconDashboard() {
  return (
    <CustomisableDashboard
      dashboardId="subcon"
      registry={SUBCON_REGISTRY}
      categories={SUBCON_CATEGORIES}
      tileComponents={SUBCON_TILE_MAP}
      quickLinks={QUICK_LINKS}
    />
  )
}
