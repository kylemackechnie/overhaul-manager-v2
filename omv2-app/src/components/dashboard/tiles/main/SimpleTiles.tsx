/**
 * Simple module tiles for the main dashboard.
 * These tiles fetch a single table and render a ModCard or KpiCard.
 * Grouped into one file to reduce boilerplate — each is exported as a TileComponent.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { ModCard, KpiCard, TileLoading, TileError } from '../../primitives'
import { useAppStore } from '../../../../store/appStore'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

// ── Cars ─────────────────────────────────────────────────────────────────────
function CarsTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cars', 'count', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('cars').select('id').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  if (error) return <TileError />
  return (
    <ModCard icon="🚗" title="Cars" sub="Car hire bookings & costs" accent="var(--mod-hr)"
      onClick={() => ctx.setActivePanel('hr-cars')}
      stats={[{ val: data?.length ?? '—', lbl: 'Bookings', color: 'var(--mod-hr)' }]} />
  )
}
export const CarsTile: TileComponent = {
  def: { id: 'cars', icon: '🚗', title: 'Cars', description: 'Car hire bookings and costs', category: 'People', defaultSize: 'md', defaultVisible: false },
  Component: CarsTileComp,
}

// ── Accommodation ─────────────────────────────────────────────────────────────
function AccomTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['accommodation', 'count', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('accommodation').select('id').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  if (error) return <TileError />
  return (
    <ModCard icon="🏨" title="Accommodation" sub="Room bookings & occupants" accent="var(--mod-hr)"
      onClick={() => ctx.setActivePanel('hr-accommodation')}
      stats={[{ val: data?.length ?? '—', lbl: 'Rooms', color: 'var(--mod-hr)' }]} />
  )
}
export const AccommodationTile: TileComponent = {
  def: { id: 'accommodation', icon: '🏨', title: 'Accommodation', description: 'Room bookings and occupants', category: 'People', defaultSize: 'md', defaultVisible: false },
  Component: AccomTileComp,
}

// ── Procurement ────────────────────────────────────────────────────────────────
function ProcurementTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data: inv, isLoading: l1 } = useQuery({
    queryKey: ['invoices', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('invoices').select('amount,status').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  const { data: pos, isLoading: l2 } = useQuery({
    queryKey: ['purchase_orders', 'count', ctx.projectId],
    queryFn: async () => {
      const { count } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('project_id', ctx.projectId!)
      return count || 0
    },
    enabled: !!ctx.projectId,
  })
  if (l1 || l2) return <TileLoading />
  const total = (inv || []).reduce((s, i) => s + (i.amount || 0), 0)
  return (
    <ModCard icon="🧾" title="Procurement" sub="POs, invoices & vendor payments" accent="#0284c7"
      onClick={() => ctx.setActivePanel('invoices')}
      stats={[
        { val: pos ?? '—', lbl: 'POs', color: '#0284c7' },
        { val: (inv || []).length, lbl: 'Invoices', color: '#0284c7' },
        { val: total > 0 ? ctx.fmt(total) : '—', lbl: 'Total', color: 'var(--text2)' },
      ]} />
  )
}
export const ProcurementTile: TileComponent = {
  def: { id: 'procurement', icon: '🧾', title: 'Procurement', description: 'Purchase orders, invoices and vendor payments', category: 'Finance', defaultSize: 'md', defaultVisible: false },
  Component: ProcurementTileComp,
}

// ── Variations ─────────────────────────────────────────────────────────────────
function VariationsTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['variations', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('variations').select('status,value').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const approved = (data || []).filter(v => v.status === 'approved')
  const approvedVal = approved.reduce((s, v) => s + (v.value || 0), 0)
  return (
    <ModCard icon="🔀" title="Variations" sub="Scope changes, cost lines, client approvals" accent="var(--amber)"
      onClick={() => ctx.setActivePanel('variations')}
      stats={[
        { val: (data || []).length, lbl: 'Total VNs', color: 'var(--amber)' },
        { val: approved.length, lbl: 'Approved', color: 'var(--green)' },
        { val: approvedVal > 0 ? ctx.fmt(approvedVal) : '—', lbl: 'Approved $', color: 'var(--green)' },
      ]} />
  )
}
export const VariationsTile: TileComponent = {
  def: { id: 'variations', icon: '🔀', title: 'Variations', description: 'Scope changes, cost lines and client approvals', category: 'Finance', defaultSize: 'md', defaultVisible: false },
  Component: VariationsTileComp,
}

// ── Spare Parts ────────────────────────────────────────────────────────────────
function SparePartsTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data: parts, isLoading: l1 } = useQuery({
    queryKey: ['wosit_lines', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('wosit_lines').select('status').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  const { data: issued, isLoading: l2 } = useQuery({
    queryKey: ['issued_log', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('issued_log').select('qty').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (l1 || l2) return <TileLoading />
  const pending = (parts || []).filter(p => !p.status || p.status === 'pending').length
  const issuedQty = (issued || []).reduce((s, e) => s + ((e as { qty?: number }).qty || 0), 0)
  return (
    <ModCard icon="📦" title="Spare Parts" sub="WOSIT export, receiving, inventory & kit issuing" accent="var(--mod-parts)"
      onClick={() => ctx.setActivePanel('parts-list')}
      stats={[
        { val: (parts || []).length, lbl: 'WOSIT Lines', color: 'var(--mod-parts)' },
        { val: pending, lbl: 'Pending', color: 'var(--amber)' },
        { val: issuedQty, lbl: 'Issued', color: 'var(--red)' },
      ]} />
  )
}
export const SparePartsTile: TileComponent = {
  def: { id: 'spare-parts', icon: '📦', title: 'Spare Parts', description: 'WOSIT export, receiving, inventory and kit issuing', category: 'Field', defaultSize: 'md', defaultVisible: false },
  Component: SparePartsTileComp,
}

// ── Work Orders ────────────────────────────────────────────────────────────────
function WorkOrdersTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['work_orders', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('work_orders').select('status').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const inProg = (data || []).filter(w => w.status === 'in_progress').length
  return (
    <ModCard icon="🔩" title="Work Orders" sub="WO tracking & actuals allocation" accent="var(--mod-wo)"
      onClick={() => ctx.setActivePanel('work-orders')}
      stats={[
        { val: (data || []).length || '—', lbl: 'Total WOs', color: 'var(--mod-wo)' },
        { val: inProg || '—', lbl: 'In Progress', color: 'var(--amber)' },
      ]} />
  )
}
export const WorkOrdersTile: TileComponent = {
  def: { id: 'work-orders', icon: '🔩', title: 'Work Orders', description: 'WO tracking and actuals allocation', category: 'Field', defaultSize: 'md', defaultVisible: false },
  Component: WorkOrdersTileComp,
}

// ── Equipment Hire ─────────────────────────────────────────────────────────────
function HireTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['hire_items', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('hire_items').select('hire_type').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const dry = (data || []).filter(h => h.hire_type === 'dry').length
  const wet = (data || []).filter(h => h.hire_type === 'wet').length
  const local = (data || []).filter(h => h.hire_type === 'local').length
  return (
    <ModCard icon="🚜" title="Equipment Hire" sub="Dry, wet & local hire — rates, calendars, costs" accent="var(--mod-hire)"
      onClick={() => ctx.setActivePanel('hire-dry')}
      stats={[
        { val: dry, lbl: 'Dry', color: 'var(--mod-hire)' },
        { val: wet, lbl: 'Wet', color: 'var(--mod-hire)' },
        { val: local, lbl: 'Local', color: 'var(--text2)' },
      ]} />
  )
}
export const HireTile: TileComponent = {
  def: { id: 'hire', icon: '🚜', title: 'Equipment Hire', description: 'Dry, wet and local hire — rates, calendars and costs', category: 'Field', defaultSize: 'md', defaultVisible: false },
  Component: HireTileComp,
}

// ── SE Rental Tooling ─────────────────────────────────────────────────────────
function ToolingTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tooling_costings', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('tooling_costings').select('tv_no').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  return (
    <ModCard icon="🔧" title="SE Rental Tooling" sub="TV register, packages, costing & project splits" accent="var(--mod-tooling)"
      onClick={() => ctx.setActivePanel('tooling-tvs')}
      stats={[
        { val: (data || []).length || '—', lbl: 'TVs', color: 'var(--mod-tooling)' },
        { val: '—', lbl: 'EUR Cost', color: 'var(--green)' },
      ]} />
  )
}
export const ToolingTile: TileComponent = {
  def: { id: 'tooling', icon: '🔧', title: 'SE Rental Tooling', description: 'TV register, packages, costing and project splits', category: 'Field', defaultSize: 'md', defaultVisible: false },
  Component: ToolingTileComp,
}

// ── Subcontractors ─────────────────────────────────────────────────────────────
function SubconTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rfq_documents', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('rfq_documents').select('stage').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const open = (data || []).filter(r => r.stage === 'issued' || r.stage === 'responses_in').length
  const awarded = (data || []).filter(r => r.stage === 'awarded' || r.stage === 'contracted').length
  return (
    <ModCard icon="🏗" title="Subcontractors" sub="RFQs, contracts & subcon timesheets" accent="#4f46e5"
      onClick={() => ctx.setActivePanel('subcon-rfq')}
      stats={[
        { val: open || '—', lbl: 'Issued RFQs', color: '#4f46e5' },
        { val: awarded || '—', lbl: 'Awarded', color: 'var(--green)' },
      ]} />
  )
}
export const SubcontractorsTile: TileComponent = {
  def: { id: 'subcontractors', icon: '🏗', title: 'Subcontractors', description: 'RFQs, contracts and subcon timesheets', category: 'Field', defaultSize: 'md', defaultVisible: false },
  Component: SubconTileComp,
}

// ── Logistics ─────────────────────────────────────────────────────────────────
function LogisticsTileComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['shipments', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('shipments').select('direction,status').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const imports = (data || []).filter(s => s.direction === 'import').length
  const exports = (data || []).filter(s => s.direction === 'export').length
  const pending = (data || []).filter(s => s.status === 'pending' || s.status === 'in_transit').length
  return (
    <ModCard icon="🚢" title="Logistics" sub="Import & export shipments tracking" accent="#0891b2"
      onClick={() => ctx.setActivePanel('shipping-dashboard')}
      stats={[
        { val: imports || '—', lbl: 'Imports', color: '#0284c7' },
        { val: exports || '—', lbl: 'Exports', color: '#d97706' },
        { val: pending || '—', lbl: 'Pending', color: 'var(--amber)' },
      ]} />
  )
}
export const LogisticsTile: TileComponent = {
  def: { id: 'logistics', icon: '🚢', title: 'Logistics', description: 'Import and export shipments tracking', category: 'Field', defaultSize: 'md', defaultVisible: false },
  Component: LogisticsTileComp,
}

// ── Hardware ──────────────────────────────────────────────────────────────────
function HardwareTileComp({ ctx }: { ctx: DashboardContext }) {
  return (
    <ModCard icon="💰" title="Hardware Pricing" sub="Contract lines, escalation & customer offers" accent="#0891b2"
      onClick={() => ctx.setActivePanel('hardware-dashboard')}
      stats={[
        { val: '—', lbl: 'Lines', color: '#0891b2' },
        { val: '—', lbl: 'Value', color: 'var(--green)' },
        { val: '—', lbl: 'Carts', color: 'var(--text2)' },
      ]} />
  )
}
export const HardwareTile: TileComponent = {
  def: { id: 'hardware', icon: '💰', title: 'Hardware Pricing', description: 'Contract lines, escalation and customer offers', category: 'Commercial', defaultSize: 'md', defaultVisible: false },
  Component: HardwareTileComp,
}

// ── Project Status ─────────────────────────────────────────────────────────────
function ProjectStatusTileComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const todayStr = new Date().toISOString().slice(0, 10)
  const start = activeProject?.start_date
  const end = activeProject?.end_date
  const isLive = start && start <= todayStr && (!end || end >= todayStr)
  const daysToStart = start && start > todayStr
    ? Math.ceil((new Date(start + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000)
    : null
  const dayNum = isLive && start
    ? Math.floor((new Date(todayStr).getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000) + 1
    : null

  let value: string = '—'
  let sub: string = activeProject?.name || 'No project selected'
  let color = '#8b5cf6'

  if (dayNum != null) {
    value = `Day ${dayNum}`
  } else if (daysToStart != null) {
    value = `${daysToStart}d`
    sub = `until mob · ${start}`
    color = 'var(--amber)'
  } else if (start && end && end < todayStr) {
    value = 'Closeout'
    sub = `Ended ${end}`
    color = 'var(--text3)'
  }

  return (
    <KpiCard
      icon={def2.icon}
      label="Project Status"
      value={value}
      sub={sub}
      color={color}
      accent={color}
      onClick={() => ctx.setActivePanel('project-settings')}
    />
  )
}
const def2 = { id: 'project-status', icon: '🗓', title: 'Project Status', description: 'Outage day counter, start/end dates, project WBS', category: 'Project', defaultSize: 'md' as const, defaultVisible: false }
export const ProjectStatusTile: TileComponent = { def: def2, Component: ProjectStatusTileComp }
