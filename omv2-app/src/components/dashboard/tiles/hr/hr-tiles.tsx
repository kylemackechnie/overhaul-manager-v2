/**
 * HR dashboard tiles — Phase 2
 * Existing: total-people, on-site-now, hours-to-date, incoming-7d, labour-sell-to-date,
 *           trades/mgmt/seag/subcon-headcount, trades/mgmt-timesheets, cars-bookings, accom-rooms
 * New: allowance-breakdown, day-type-distribution, subcon-without-po,
 *      resources-no-rate-card, draft-timesheets, inductions-overdue, utilisation
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useAppStore } from '../../../../store/appStore'
import { useLabourStats } from '../../../../hooks/useLabourStats'
import { KpiCard, ModCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const todayStr = new Date().toISOString().slice(0, 10)
const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

// ── Shared resources query ────────────────────────────────────────────────────
function useResources(projectId: string | undefined) {
  return useQuery({
    queryKey: ['resources', 'full', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('resources')
        .select('id,name,category,mob_in,mob_out,linked_po_id,role')
        .eq('project_id', projectId!)
      return data || []
    },
    enabled: !!projectId,
  })
}

// ── Headcount tiles ───────────────────────────────────────────────────────────

function TotalPeopleComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useResources(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  return <KpiCard icon="👥" label="Total People" value={(data || []).length}
    color="var(--mod-hr)" accent="var(--mod-hr)" onClick={() => ctx.setActivePanel('hr-resources')} />
}
export const TotalPeopleTile: TileComponent = {
  def: { id: 'total-people', icon: '👥', title: 'Total People', description: 'All resources on the project', category: 'Headcount', defaultSize: 'md', defaultVisible: true },
  Component: TotalPeopleComp,
}

function OnSiteNowComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useResources(ctx.projectId)
  if (isLoading) return <TileLoading />
  const onsite = (data || []).filter(r => r.mob_in && r.mob_in <= todayStr && (!r.mob_out || r.mob_out >= todayStr)).length
  return <KpiCard icon="🏗" label="On Site Now" value={onsite}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('hr-resources')} />
}
export const OnSiteNowTile: TileComponent = {
  def: { id: 'on-site-now', icon: '🏗', title: 'On Site Now', description: 'Resources currently on-site based on mob dates', category: 'Headcount', defaultSize: 'md', defaultVisible: true },
  Component: OnSiteNowComp,
}

function Incoming7dComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useResources(ctx.projectId)
  if (isLoading) return <TileLoading />
  const incoming = (data || []).filter(r => r.mob_in && r.mob_in > todayStr && r.mob_in <= next7).length
  return <KpiCard icon="✈" label="Incoming (7 days)" value={incoming}
    color={incoming > 0 ? 'var(--amber)' : 'var(--text3)'}
    accent={incoming > 0 ? 'var(--amber)' : 'var(--border)'}
    onClick={() => ctx.setActivePanel('hr-resources')} />
}
export const Incoming7dTile: TileComponent = {
  def: { id: 'incoming-7d', icon: '✈', title: 'Incoming (7 days)', description: 'Resources mobbing in the next 7 days', category: 'Headcount', defaultSize: 'md', defaultVisible: true },
  Component: Incoming7dComp,
}

function HoursToDateComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  const total = (data?.tradesHours || 0) + (data?.mgmtHours || 0)
  return <KpiCard icon="⏱" label="Hours to Date" value={total.toFixed(0) + 'h'}
    color="var(--mod-hr)" accent="var(--mod-hr)" onClick={() => ctx.setActivePanel('hr-timesheets-trades')} />
}
export const HoursToDateTile: TileComponent = {
  def: { id: 'hours-to-date', icon: '⏱', title: 'Hours to Date', description: 'Total logged hours across all categories', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: HoursToDateComp,
}

function LabourSellToDateComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  const sell = (data?.tradesSell || 0) + (data?.mgmtSell || 0)
  return <KpiCard icon="💰" label="Labour Sell to Date" value={ctx.fmt(sell)}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('hr-timesheets-trades')} />
}
export const LabourSellToDateTile: TileComponent = {
  def: { id: 'labour-sell-to-date', icon: '💰', title: 'Labour Sell to Date', description: 'Cumulative labour sell value across all timesheets', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: LabourSellToDateComp,
}

// ── Category headcount tiles ───────────────────────────────────────────────────

const CAT_TILES = [
  { id: 'trades-headcount', icon: '🔨', title: 'Trades', cat: 'trades', color: '#0369a1', panel: 'hr-timesheets-trades' },
  { id: 'mgmt-headcount', icon: '💼', title: 'Management', cat: 'management', color: '#065f46', panel: 'hr-timesheets-mgmt' },
  { id: 'seag-headcount', icon: '⚙️', title: 'SE AG', cat: 'seag', color: '#92400e', panel: 'hr-timesheets-seag' },
  { id: 'subcon-headcount', icon: '🤝', title: 'Subcontractors', cat: 'subcontractor', color: '#6b21a8', panel: 'hr-timesheets-subcon' },
]

function makeHeadcountTile(catId: string, icon: string, title: string, cat: string, color: string, panel: string): TileComponent {
  function Comp({ ctx }: { ctx: DashboardContext }) {
    const { data, isLoading } = useResources(ctx.projectId)
    if (isLoading) return <TileLoading />
    const count = (data || []).filter(r => r.category === cat).length
    return <KpiCard icon={icon} label={title} value={count}
      color={color} accent={color} onClick={() => ctx.setActivePanel(panel)} />
  }
  return {
    def: { id: catId, icon, title, description: `${title} headcount on the project`, category: 'Headcount', defaultSize: 'md', defaultVisible: true },
    Component: Comp,
  }
}

export const TradesHeadcountTile = makeHeadcountTile(...Object.values(CAT_TILES[0]) as [string, string, string, string, string, string])
export const MgmtHeadcountTile = makeHeadcountTile(...Object.values(CAT_TILES[1]) as [string, string, string, string, string, string])
export const SeagHeadcountTile = makeHeadcountTile(...Object.values(CAT_TILES[2]) as [string, string, string, string, string, string])
export const SubconHeadcountTile = makeHeadcountTile(...Object.values(CAT_TILES[3]) as [string, string, string, string, string, string])

// ── Timesheet summary tiles ────────────────────────────────────────────────────

function TradesTimesheetsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <ModCard icon="📋" title="Trades Timesheets" sub="Hours logged and sell value"
    accent="var(--mod-hr)" onClick={() => ctx.setActivePanel('hr-timesheets-trades')}
    stats={[
      { val: (data?.tradesHours || 0).toFixed(0) + 'h', lbl: 'Hours', color: 'var(--mod-hr)' },
      { val: ctx.fmt(data?.tradesSell || 0), lbl: 'Sell', color: 'var(--green)' },
      { val: (data?.tradesWeeks || 0), lbl: 'Weeks', color: 'var(--text3)' },
    ]} />
}
export const TradesTimesheetsTile: TileComponent = {
  def: { id: 'trades-timesheets', icon: '📋', title: 'Trades Timesheets', description: 'Trades hours, sell value and weeks logged', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: TradesTimesheetsComp,
}

function MgmtTimesheetsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <ModCard icon="📋" title="Mgmt Timesheets" sub="Hours logged and sell value"
    accent="#7c3aed" onClick={() => ctx.setActivePanel('hr-timesheets-mgmt')}
    stats={[
      { val: (data?.mgmtHours || 0).toFixed(0) + 'h', lbl: 'Hours', color: '#7c3aed' },
      { val: ctx.fmt(data?.mgmtSell || 0), lbl: 'Sell', color: 'var(--green)' },
      { val: (data?.mgmtWeeks || 0), lbl: 'Weeks', color: 'var(--text3)' },
    ]} />
}
export const MgmtTimesheetsTile: TileComponent = {
  def: { id: 'mgmt-timesheets', icon: '📋', title: 'Mgmt Timesheets', description: 'Management and SE AG hours, sell value and weeks', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: MgmtTimesheetsComp,
}

// ── Support tiles (cars, accom) ────────────────────────────────────────────────

function CarsBookingsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cars', 'count', ctx.projectId],
    queryFn: async () => { const { data } = await supabase.from('cars').select('id').eq('project_id', ctx.projectId!); return data || [] },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  return <KpiCard icon="🚗" label="Car Bookings" value={(data || []).length}
    color="var(--mod-hire)" accent="var(--mod-hire)" onClick={() => ctx.setActivePanel('hr-cars')} />
}
export const CarsBookingsTile: TileComponent = {
  def: { id: 'cars-bookings', icon: '🚗', title: 'Car Bookings', description: 'Total car hire bookings', category: 'Support', defaultSize: 'md', defaultVisible: true },
  Component: CarsBookingsComp,
}

function AccomRoomsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['accommodation', 'count', ctx.projectId],
    queryFn: async () => { const { data } = await supabase.from('accommodation').select('id').eq('project_id', ctx.projectId!); return data || [] },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  return <KpiCard icon="🏨" label="Accommodation Rooms" value={(data || []).length}
    color="var(--mod-hr)" accent="var(--mod-hr)" onClick={() => ctx.setActivePanel('hr-accommodation')} />
}
export const AccomRoomsTile: TileComponent = {
  def: { id: 'accom-rooms', icon: '🏨', title: 'Accommodation Rooms', description: 'Total accommodation room bookings', category: 'Support', defaultSize: 'md', defaultVisible: true },
  Component: AccomRoomsComp,
}

// ── New tiles ────────────────────────────────────────────────────────────────

function AllowanceBreakdownComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <ModCard icon="🧾" title="Allowance Breakdown" sub="LAHA, Meal and FSA day counts"
    accent="var(--mod-hr)" onClick={() => ctx.setActivePanel('hr-timesheets-trades')}
    stats={[
      { val: data?.lahaCount || 0, lbl: 'LAHA', color: 'var(--mod-hr)' },
      { val: data?.mealCount || 0, lbl: 'Meal', color: '#6366f1' },
      { val: data?.fsaCount || 0, lbl: 'FSA Days', color: '#92400e' },
    ]} />
}
export const AllowanceBreakdownTile: TileComponent = {
  def: { id: 'allowance-breakdown', icon: '🧾', title: 'Allowance Breakdown', description: 'LAHA, Meal allowance and FSA day counts from timesheets', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: AllowanceBreakdownComp,
}

function SubconWithoutPOComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useResources(ctx.projectId)
  if (isLoading) return <TileLoading />
  const subcons = (data || []).filter(r => r.category === 'subcontractor')
  const withoutPO = subcons.filter(r => !r.linked_po_id).length
  if (withoutPO === 0) return <TileEmpty icon="✅" label="All subcontractors have a linked PO" />
  return <KpiCard icon="⚠" label="Subcon Without PO"
    value={withoutPO}
    sub={`of ${subcons.length} subcontractors`}
    color="var(--red)" accent="var(--red)"
    onClick={() => ctx.setActivePanel('hr-resources')} />
}
export const SubconWithoutPOTile: TileComponent = {
  def: { id: 'subcon-without-po', icon: '⚠', title: 'Subcon Without PO', description: 'Subcontractor resources missing a linked purchase order', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: SubconWithoutPOComp,
}

function ResourcesNoRateCardComp({ ctx }: { ctx: DashboardContext }) {
  const { data: resources, isLoading: l1 } = useResources(ctx.projectId)
  const { data: rcs, isLoading: l2 } = useQuery({
    queryKey: ['rate_cards', 'roles', ctx.projectId],
    queryFn: async () => { const { data } = await supabase.from('rate_cards').select('role').eq('project_id', ctx.projectId!); return (data || []).map(r => (r.role as string).toLowerCase()) },
    enabled: !!ctx.projectId,
  })
  if (l1 || l2) return <TileLoading />
  const rcSet = new Set(rcs || [])
  const missing = (resources || []).filter(r => r.role && !rcSet.has((r.role as string).toLowerCase())).length
  if (missing === 0) return <TileEmpty icon="✅" label="All roles have rate cards" />
  return <KpiCard icon="⚠" label="Missing Rate Cards" value={missing}
    sub="Roles without a matching rate card"
    color="var(--amber)" accent="var(--amber)"
    onClick={() => ctx.setActivePanel('hr-resources')} />
}
export const ResourcesNoRateCardTile: TileComponent = {
  def: { id: 'resources-no-rate-card', icon: '⚠', title: 'Missing Rate Cards', description: 'Resources whose role has no matching rate card', category: 'Alerts', defaultSize: 'md', defaultVisible: false },
  Component: ResourcesNoRateCardComp,
}

function InductionsOverdueComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const inductions = (activeProject?.induction_data as { date?: string }[] | null) || []
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const overdue = inductions.filter(p => p.date && p.date < cutoff).length
  return <KpiCard icon="🔄" label="Re-inductions Overdue" value={overdue}
    sub={overdue > 0 ? 'Inducted > 365 days ago' : 'All inductions current'}
    color={overdue > 0 ? 'var(--red)' : 'var(--green)'}
    accent={overdue > 0 ? 'var(--red)' : 'var(--green)'}
    onClick={() => ctx.setActivePanel('hr-inductions')} />
}
export const HRInductionsOverdueTile: TileComponent = {
  def: { id: 'inductions-overdue', icon: '🔄', title: 'Re-inductions Overdue', description: 'People inducted more than 365 days ago', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: InductionsOverdueComp,
}

function UtilisationComp({ ctx }: { ctx: DashboardContext }) {
  const { data: cars, isLoading: l1 } = useQuery({
    queryKey: ['cars', 'utilisation', ctx.projectId],
    queryFn: async () => { const { data } = await supabase.from('cars').select('start_date,end_date').eq('project_id', ctx.projectId!); return data || [] },
    enabled: !!ctx.projectId,
  })
  const { data: accom, isLoading: l2 } = useQuery({
    queryKey: ['accommodation', 'utilisation', ctx.projectId],
    queryFn: async () => { const { data } = await supabase.from('accommodation').select('check_in,check_out').eq('project_id', ctx.projectId!); return data || [] },
    enabled: !!ctx.projectId,
  })
  if (l1 || l2) return <TileLoading />
  const activeCars = (cars || []).filter(c => c.start_date && c.start_date <= todayStr && (!c.end_date || c.end_date >= todayStr)).length
  const activeAccom = (accom || []).filter(a => a.check_in && a.check_in <= todayStr && (!a.check_out || a.check_out >= todayStr)).length
  return <ModCard icon="📊" title="Utilisation Today" sub="Active cars and rooms right now"
    accent="var(--mod-hire)"
    stats={[
      { val: activeCars, lbl: 'Cars Active', color: 'var(--mod-hire)' },
      { val: activeAccom, lbl: 'Rooms Occupied', color: 'var(--mod-hr)' },
    ]} />
}
export const UtilisationTile: TileComponent = {
  def: { id: 'utilisation', icon: '📊', title: 'Utilisation', description: 'Cars and accommodation currently active today', category: 'Support', defaultSize: 'md', defaultVisible: false },
  Component: UtilisationComp,
}

function DraftTimesheetsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['weekly_timesheets', 'draft', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('weekly_timesheets').select('week_start,status').eq('project_id', ctx.projectId!).eq('status', 'draft').order('week_start')
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="✅" label="No draft timesheets outstanding" />
  const oldest = data[0]?.week_start
  return <KpiCard icon="📝" label="Draft Timesheets" value={(data || []).length}
    sub={oldest ? `Oldest: w/c ${oldest}` : undefined}
    color="var(--amber)" accent="var(--amber)"
    onClick={() => ctx.setActivePanel('hr-timesheets-trades')} />
}
export const DraftTimesheetsTile: TileComponent = {
  def: { id: 'draft-timesheets', icon: '📝', title: 'Draft Timesheets', description: 'Timesheets in draft status awaiting submission', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: DraftTimesheetsComp,
}
