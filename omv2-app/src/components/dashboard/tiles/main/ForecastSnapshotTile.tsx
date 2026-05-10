import { TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const def = {
  id: 'forecast-snapshot',
  icon: '📈',
  title: 'Forecast Snapshot',
  description: 'Next 5 weeks of cost, sell, headcount and margin',
  category: 'Project',
  defaultSize: 'md' as const,
  defaultVisible: true,
}

function ForecastSnapshotTileComp({ ctx }: { ctx: DashboardContext }) {
  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px' }}>Forecast Snapshot</div>
        <button className="btn btn-sm" onClick={() => ctx.setActivePanel('cost-forecast')}>Full Forecast →</button>
      </div>
      <TileEmpty icon="📈" label="Open the full forecast to generate a snapshot." ctaLabel="View Forecast" onCta={() => ctx.setActivePanel('cost-forecast')} />
    </div>
  )
}

export const ForecastSnapshotTile: TileComponent = { def, Component: ForecastSnapshotTileComp }
