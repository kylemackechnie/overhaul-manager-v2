import { useAppStore } from '../../../../store/appStore'
import { useForecast, getUpcomingWeeks } from '../../../../hooks/useForecast'
import { TileLoading, TileError } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

export const def = {
  id: 'forecast-snapshot',
  icon: '📈',
  title: 'Forecast Snapshot',
  description: 'Next 5 weeks of cost, sell, headcount and margin',
  category: 'Project',
  defaultSize: 'md' as const,
  defaultVisible: true,
}

function ForecastSnapshotTileComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const { data, isLoading, error, refetch } = useForecast(ctx.projectId)

  const eurRate = ((activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || [])
    .find(r => r.code === 'EUR')?.rate ?? 1.65

  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />

  const weeks = data ? getUpcomingWeeks(data, eurRate, 5) : []

  const fmt = (n: number) =>
    n >= 1_000_000
      ? '$' + (n / 1_000_000).toFixed(1) + 'M'
      : n >= 1_000
      ? '$' + (n / 1_000).toFixed(0) + 'k'
      : ctx.fmt(n)

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px' }}>Forecast Snapshot</div>
        <button className="btn btn-sm" onClick={() => ctx.setActivePanel('cost-forecast')}>
          Full Forecast →
        </button>
      </div>

      {weeks.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: '12px', padding: '8px 0' }}>
          {!activeProject?.start_date
            ? 'Set a project start date to generate a forecast.'
            : 'No upcoming forecast activity — check resource mob dates.'}
          <br /><br />
          <button className="btn btn-sm" onClick={() => ctx.setActivePanel('cost-forecast')}>
            Open Forecast
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 72px 44px 36px', gap: '4px', padding: '3px 0', marginBottom: '2px' }}>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', fontWeight: 700 }}>Week</div>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', fontWeight: 700, textAlign: 'right' }}>Cost</div>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', fontWeight: 700, textAlign: 'right' }}>Sell</div>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', fontWeight: 700, textAlign: 'right' }}>HC</div>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', fontWeight: 700, textAlign: 'right' }}>GM</div>
          </div>

          {/* Week rows */}
          {weeks.map((w, i) => (
            <div
              key={w.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 72px 72px 44px 36px',
                gap: '4px',
                padding: '5px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
              onClick={() => ctx.setActivePanel('cost-forecast')}
            >
              <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{w.label}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--mono)', textAlign: 'right' }}>{fmt(w.cost)}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--green)', textAlign: 'right' }}>{fmt(w.sell)}</div>
              <div style={{ fontSize: '12px', fontFamily: 'var(--mono)', color: 'var(--mod-hr)', textAlign: 'right' }}>{w.headcount || '—'}</div>
              <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: w.gm >= 15 ? 'var(--green)' : w.gm > 0 ? 'var(--amber)' : 'var(--text3)', textAlign: 'right' }}>
                {w.gm > 0 ? w.gm.toFixed(0) + '%' : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const ForecastSnapshotTile: TileComponent = { def, Component: ForecastSnapshotTileComp }
