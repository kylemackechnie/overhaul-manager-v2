/**
 * Shipping dashboard tiles — Phase 5
 * Existing: total-shipments, imports, exports, in-transit, in-customs, delivered,
 *           dg-shipments, recent-list
 * New: eta-overdue, dg-at-risk, customs-delayed, route-breakdown, air-vs-sea
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { KpiCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const todayStr = new Date().toISOString().slice(0, 10)

interface Shipment {
  id: string; direction: 'import' | 'export'
  reference: string; description: string; status: string; ship_type: string
  hawb?: string; mawb?: string; eta?: string; actual_date?: string
  origin?: string; destination?: string
  agent?: string; packages?: number; weight?: number
  has_dg?: boolean; created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  booked: 'var(--text3)', in_transit: 'var(--amber)', customs: 'var(--red)',
  delivered: 'var(--green)', collected: 'var(--green)', cancelled: 'var(--text3)',
}
const STATUS_LABELS: Record<string, string> = {
  booked: 'Booked', in_transit: 'In Transit', customs: 'Customs',
  delivered: 'Delivered', collected: 'Collected', cancelled: 'Cancelled',
}

function useShipments(projectId: string | undefined) {
  return useQuery({
    queryKey: ['shipments', 'full', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('shipments').select('*')
        .eq('project_id', projectId!).order('created_at', { ascending: false })
      return (data || []) as Shipment[]
    },
    enabled: !!projectId,
  })
}

// ── KPI tiles ─────────────────────────────────────────────────────────────────

function makeKpiTile(
  id: string, icon: string, title: string, desc: string,
  filter: (s: Shipment[]) => number,
  color: string, panel: string
): TileComponent {
  function Comp({ ctx }: { ctx: DashboardContext }) {
    const { data, isLoading, error, refetch } = useShipments(ctx.projectId)
    if (isLoading) return <TileLoading />
    if (error) return <TileError onRetry={refetch} />
    return <KpiCard icon={icon} label={title} value={filter(data || [])}
      color={color} accent={color} onClick={() => ctx.setActivePanel(panel)} />
  }
  return { def: { id, icon, title, description: desc, category: 'Overview', defaultSize: 'md', defaultVisible: true }, Component: Comp }
}

export const TotalShipmentsTile = makeKpiTile('total-shipments', '🚢', 'Total Shipments', 'All shipments on this project', s => s.length, '#0284c7', 'shipping-dashboard')
export const ImportsTile = makeKpiTile('imports', '📥', 'Imports', 'Inbound shipments', s => s.filter(x => x.direction === 'import').length, '#0284c7', 'shipping-imports')
export const ExportsTile = makeKpiTile('exports', '📤', 'Exports', 'Outbound shipments', s => s.filter(x => x.direction === 'export').length, '#d97706', 'shipping-exports')
export const InTransitTile = makeKpiTile('in-transit', '✈', 'In Transit', 'Shipments currently in transit', s => s.filter(x => x.status === 'in_transit').length, 'var(--amber)', 'shipping-dashboard')
export const InCustomsTile = makeKpiTile('in-customs', '🛃', 'In Customs', 'Shipments held in customs', s => s.filter(x => x.status === 'customs').length, 'var(--red)', 'shipping-dashboard')
export const DeliveredTile = makeKpiTile('delivered', '✅', 'Delivered', 'Shipments delivered or collected', s => s.filter(x => x.status === 'delivered' || x.status === 'collected').length, 'var(--green)', 'shipping-dashboard')
export const DGShipmentsTile = makeKpiTile('dg-shipments', '⚠', 'DG Shipments', 'Shipments containing dangerous goods', s => s.filter(x => x.has_dg).length, 'var(--red)', 'shipping-dashboard')

// ── Recent list tile (wide) ────────────────────────────────────────────────────

function RecentListComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useShipments(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🚢" label="No shipments yet" />

  const recent = [...data]
    .sort((a, b) => (b.eta || b.created_at).localeCompare(a.eta || a.created_at))
    .slice(0, 10)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
        Recent Shipments
      </div>
      {recent.map(s => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '16px', flexShrink: 0 }}>{s.direction === 'export' ? '📤' : '📥'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.reference || '—'} — {s.description || '—'}</span>
              <span style={{ fontSize: '9px', fontWeight: 700, color: s.direction === 'export' ? '#d97706' : '#0284c7', textTransform: 'uppercase', flexShrink: 0 }}>{s.direction}</span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text3)' }}>
              {s.hawb || s.mawb || 'No AWB'} · {s.agent || 'No agent'} · ETA {s.eta || 'TBC'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '3px', background: 'var(--bg3)', color: STATUS_COLORS[s.status] || 'var(--text3)', fontWeight: 600 }}>
              {STATUS_LABELS[s.status] || s.status}
            </span>
            {s.has_dg && <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '3px', background: 'rgba(239,68,68,.15)', color: 'var(--red)', fontWeight: 600 }}>⚠ DG</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
export const RecentListTile: TileComponent = {
  def: { id: 'recent-list', icon: '📋', title: 'Recent Shipments', description: 'Latest shipments with status and ETA', category: 'Detail', defaultSize: 'lg', defaultVisible: true },
  Component: RecentListComp,
}

// ── New tiles ──────────────────────────────────────────────────────────────────

function EtaOverdueComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useShipments(ctx.projectId)
  if (isLoading) return <TileLoading />
  const overdue = (data || []).filter(s =>
    s.eta && s.eta < todayStr &&
    s.status !== 'delivered' && s.status !== 'collected' && s.status !== 'cancelled'
  )
  if (!overdue.length) return <TileEmpty icon="✅" label="No shipments overdue" />
  return <KpiCard icon="🚨" label="ETA Overdue" value={overdue.length}
    sub="Not delivered past expected arrival"
    color="var(--red)" accent="var(--red)"
    onClick={() => ctx.setActivePanel('shipping-dashboard')} />
}
export const EtaOverdueTile: TileComponent = {
  def: { id: 'eta-overdue', icon: '🚨', title: 'ETA Overdue', description: 'Shipments past their expected arrival date, not yet delivered', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: EtaOverdueComp,
}

function DGAtRiskComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useShipments(ctx.projectId)
  if (isLoading) return <TileLoading />
  const dgDelayed = (data || []).filter(s =>
    s.has_dg && (s.status === 'customs' || s.status === 'in_transit')
  )
  if (!dgDelayed.length) return <TileEmpty icon="✅" label="No DG shipments at risk" />
  return <KpiCard icon="☢" label="DG at Risk" value={dgDelayed.length}
    sub="DG shipments in transit or customs"
    color="var(--red)" accent="var(--red)"
    onClick={() => ctx.setActivePanel('shipping-dashboard')} />
}
export const DGAtRiskTile: TileComponent = {
  def: { id: 'dg-at-risk', icon: '☢', title: 'DG at Risk', description: 'Dangerous goods shipments currently in transit or customs', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: DGAtRiskComp,
}

function CustomsDelayedComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useShipments(ctx.projectId)
  if (isLoading) return <TileLoading />
  // Flag any shipment stuck in customs (status = customs with no recent update is a proxy)
  const inCustoms = (data || []).filter(s => s.status === 'customs')
  if (!inCustoms.length) return <TileEmpty icon="✅" label="Nothing held in customs" />
  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid var(--red)', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>🛃 In Customs ({inCustoms.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {inCustoms.slice(0, 5).map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
              {s.reference || '—'} {s.description ? `— ${s.description}` : ''}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text3)', flexShrink: 0 }}>{s.direction === 'import' ? '📥' : '📤'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const CustomsDelayedTile: TileComponent = {
  def: { id: 'customs-delayed', icon: '🛃', title: 'In Customs', description: 'Shipments currently held in customs clearance', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: CustomsDelayedComp,
}

function RouteBreakdownComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useShipments(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🗺" label="No shipments yet" />

  const routes: Record<string, number> = {}
  for (const s of data) {
    const route = [s.origin, s.destination].filter(Boolean).join(' → ') || 'Unknown route'
    routes[route] = (routes[route] || 0) + 1
  }
  const sorted = Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>🗺 Top Routes</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {sorted.map(([route, count]) => (
          <div key={route} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
            <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{route}</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: '#0284c7', flexShrink: 0 }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const RouteBreakdownTile: TileComponent = {
  def: { id: 'route-breakdown', icon: '🗺', title: 'Route Breakdown', description: 'Top shipping routes by shipment count', category: 'Detail', defaultSize: 'md', defaultVisible: false },
  Component: RouteBreakdownComp,
}

function AirVsSeaComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useShipments(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="✈" label="No shipments yet" />

  const air = data.filter(s => s.ship_type === 'air').length
  const sea = data.filter(s => s.ship_type === 'sea').length
  const road = data.filter(s => s.ship_type === 'road').length
  const other = data.length - air - sea - road

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid #0284c7', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>✈ Transport Mode</div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[
          { label: 'Air', val: air, color: '#0284c7', icon: '✈' },
          { label: 'Sea', val: sea, color: '#0891b2', icon: '🚢' },
          { label: 'Road', val: road, color: '#d97706', icon: '🚛' },
          { label: 'Other', val: other, color: 'var(--text3)', icon: '📦' },
        ].filter(x => x.val > 0).map(x => (
          <div key={x.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: x.color }}>{x.val}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{x.icon} {x.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
export const AirVsSeaTile: TileComponent = {
  def: { id: 'air-vs-sea', icon: '✈', title: 'Transport Mode', description: 'Shipment split by transport mode (air / sea / road)', category: 'Detail', defaultSize: 'md', defaultVisible: false },
  Component: AirVsSeaComp,
}
