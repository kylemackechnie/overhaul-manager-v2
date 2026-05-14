/**
 * Cost dashboard tiles — Phase 2
 *
 * Existing tiles extracted from CostDashboardPanel.tsx:
 *   invoice-total, approved-paid, pending-invoices, active-pos
 *   trades-hours, trades-cost, mgmt-hours, back-office-cost
 *   hire-equipment, expenses-total, cars-total, accom-total
 *   variations-approved, wbs-codes
 *
 * New tiles:
 *   disputed-invoices, pending-po-commitment, sap-recon-status
 *   tooling-eur-cost, expense-by-category, currency-split
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useAppStore } from '../../../../store/appStore'
import { useLabourStats } from '../../../../hooks/useLabourStats'
import { KpiCard, ModCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

// ─── Invoice tiles ────────────────────────────────────────────────────────────

function useInvoices(projectId: string | undefined) {
  return useQuery({
    queryKey: ['invoices', 'list', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('invoices').select('amount,status').eq('project_id', projectId!)
      return data || []
    },
    enabled: !!projectId,
  })
}

function InvoiceTotalComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useInvoices(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  const total = (data || []).reduce((s, i) => s + (i.amount || 0), 0)
  return <KpiCard icon="🧾" label="Invoice Total" value={ctx.fmt(total)}
    sub={`${(data || []).length} invoices`} color="#0284c7" accent="#0284c7"
    onClick={() => ctx.setActivePanel('invoices')} />
}
export const InvoiceTotalTile: TileComponent = {
  def: { id: 'invoice-total', icon: '🧾', title: 'Invoice Total', description: 'Total invoiced value across all POs', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: InvoiceTotalComp,
}

function ApprovedPaidComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useInvoices(ctx.projectId)
  if (isLoading) return <TileLoading />
  const total = (data || []).filter(i => ['approved', 'paid'].includes(i.status)).reduce((s, i) => s + (i.amount || 0), 0)
  const count = (data || []).filter(i => ['approved', 'paid'].includes(i.status)).length
  return <KpiCard icon="✅" label="Approved / Paid" value={ctx.fmt(total)}
    sub={`${count} invoices`} color="var(--green)" accent="var(--green)"
    onClick={() => ctx.setActivePanel('invoices')} />
}
export const ApprovedPaidTile: TileComponent = {
  def: { id: 'approved-paid', icon: '✅', title: 'Approved / Paid', description: 'Total value of approved and paid invoices', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: ApprovedPaidComp,
}

function PendingInvoicesComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useInvoices(ctx.projectId)
  if (isLoading) return <TileLoading />
  const pending = (data || []).filter(i => ['received', 'checked'].includes(i.status))
  const total = pending.reduce((s, i) => s + (i.amount || 0), 0)
  return <KpiCard icon="⏳" label="Pending Approval" value={ctx.fmt(total)}
    sub={`${pending.length} invoices`}
    color={pending.length > 0 ? 'var(--amber)' : 'var(--text3)'}
    accent={pending.length > 0 ? 'var(--amber)' : 'var(--border)'}
    onClick={() => ctx.setActivePanel('invoices')} />
}
export const PendingInvoicesTile: TileComponent = {
  def: { id: 'pending-invoices', icon: '⏳', title: 'Pending Invoices', description: 'Invoices received or in review awaiting approval', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: PendingInvoicesComp,
}

function DisputedInvoicesComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useInvoices(ctx.projectId)
  if (isLoading) return <TileLoading />
  const disputed = (data || []).filter(i => i.status === 'disputed')
  const total = disputed.reduce((s, i) => s + (i.amount || 0), 0)
  if (disputed.length === 0) return <TileEmpty icon="🤝" label="No disputed invoices" />
  return <KpiCard icon="⚡" label="Disputed Invoices" value={ctx.fmt(total)}
    sub={`${disputed.length} invoices`} color="var(--red)" accent="var(--red)"
    onClick={() => ctx.setActivePanel('invoices')} />
}
export const DisputedInvoicesTile: TileComponent = {
  def: { id: 'disputed-invoices', icon: '⚡', title: 'Disputed Invoices', description: 'Dollar value at risk from invoices in disputed status', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: DisputedInvoicesComp,
}

// ─── Procurement tiles ────────────────────────────────────────────────────────

function usePOs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['purchase_orders', 'list', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders').select('id,status,total_value').eq('project_id', projectId!)
      return data || []
    },
    enabled: !!projectId,
  })
}

function ActivePOsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = usePOs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const active = (data || []).filter(p => p.status === 'active').length
  const total = (data || []).reduce((s, p) => s + ((p as { total_value?: number }).total_value || 0), 0)
  return <KpiCard icon="📋" label="Active POs" value={active}
    sub={`of ${(data || []).length} total · ${ctx.fmt(total)}`}
    color="#7c3aed" accent="#7c3aed"
    onClick={() => ctx.setActivePanel('purchase-orders')} />
}
export const ActivePOsTile: TileComponent = {
  def: { id: 'active-pos', icon: '📋', title: 'Active POs', description: 'Count and value of active purchase orders', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: ActivePOsComp,
}

function PendingPOComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = usePOs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const draft = (data || []).filter(p => p.status === 'draft')
  const total = draft.reduce((s, p) => s + ((p as { total_value?: number }).total_value || 0), 0)
  return <KpiCard icon="📝" label="Draft POs" value={draft.length}
    sub={total > 0 ? ctx.fmt(total) + ' uncommitted' : 'No uncommitted spend'}
    color={draft.length > 0 ? 'var(--amber)' : 'var(--text3)'}
    accent={draft.length > 0 ? 'var(--amber)' : 'var(--border)'}
    onClick={() => ctx.setActivePanel('purchase-orders')} />
}
export const PendingPOCommitmentTile: TileComponent = {
  def: { id: 'pending-po-commitment', icon: '📝', title: 'Draft POs', description: 'POs in draft status representing uncommitted spend', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: PendingPOComp,
}

function WbsCodesComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wbs_list', 'count', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('wbs_list').select('id').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  return <KpiCard icon="🗂" label="WBS Codes" value={(data || []).length}
    sub="Cost allocation elements" color="var(--text3)" accent="var(--border)"
    onClick={() => ctx.setActivePanel('wbs-list')} />
}
export const WbsCodesTile: TileComponent = {
  def: { id: 'wbs-codes', icon: '🗂', title: 'WBS Codes', description: 'Count of WBS cost allocation elements', category: 'Variations', defaultSize: 'md', defaultVisible: false },
  Component: WbsCodesComp,
}

function SapReconComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const recon = activeProject?.sap_reconciliation
  if (!recon || !recon.lastImport) {
    return <TileEmpty icon="⚖" label="No SAP import yet" ctaLabel="Go to SAP Recon" onCta={() => ctx.setActivePanel('sap-recon')} />
  }
  const rows = (recon.rows || []) as { matched?: boolean }[]
  const matched = rows.filter(r => r.matched).length
  const pct = rows.length > 0 ? Math.round(matched / rows.length * 100) : 0
  return (
    <ModCard icon="⚖" title="SAP Recon" sub={`Last import: ${recon.lastImport}`}
      accent={pct === 100 ? 'var(--green)' : 'var(--amber)'}
      onClick={() => ctx.setActivePanel('sap-recon')}
      stats={[
        { val: matched, lbl: 'Matched', color: 'var(--green)' },
        { val: rows.length - matched, lbl: 'Unmatched', color: rows.length - matched > 0 ? 'var(--red)' : 'var(--text3)' },
        { val: `${pct}%`, lbl: 'Recon %', color: pct === 100 ? 'var(--green)' : 'var(--amber)' },
      ]} />
  )
}
export const SapReconStatusTile: TileComponent = {
  def: { id: 'sap-recon-status', icon: '⚖', title: 'SAP Recon Status', description: 'Reconciled vs unmatched rows from last SAP import', category: 'Procurement', defaultSize: 'md', defaultVisible: false },
  Component: SapReconComp,
}

// ─── Labour tiles ──────────────────────────────────────────────────────────────

function TradesHoursComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  const hours = data?.tradesHours || 0
  return <KpiCard icon="🔨" label="Trades Hours" value={hours.toFixed(0) + 'h'}
    sub={`Sell: ${ctx.fmt(data?.tradesSell || 0)}`}
    color="var(--mod-hr)" accent="var(--mod-hr)"
    onClick={() => ctx.setActivePanel('hr-timesheets-trades')} />
}
export const TradesHoursTile: TileComponent = {
  def: { id: 'trades-hours', icon: '🔨', title: 'Trades Hours', description: 'Total trades hours logged to date with sell value', category: 'Labour', defaultSize: 'md', defaultVisible: false },
  Component: TradesHoursComp,
}

function TradesCostComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  const cost = data?.tradesCost || 0
  const sell = data?.tradesSell || 0
  const gm = sell > 0 ? ((sell - cost) / sell * 100).toFixed(0) + '%' : '—'
  return <KpiCard icon="💵" label="Trades Cost" value={ctx.fmt(cost)}
    sub={`GM: ${gm}`} color="var(--mod-hr)" accent="var(--mod-hr)"
    onClick={() => ctx.setActivePanel('hr-timesheets-trades')} />
}
export const TradesCostTile: TileComponent = {
  def: { id: 'trades-cost', icon: '💵', title: 'Trades Cost', description: 'Labour cost for all trades timesheets to date', category: 'Labour', defaultSize: 'md', defaultVisible: false },
  Component: TradesCostComp,
}

function MgmtHoursComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  if (isLoading) return <TileLoading />
  const hours = data?.mgmtHours || 0
  return <KpiCard icon="💼" label="Mgmt / SE AG Hours" value={hours.toFixed(0) + 'h'}
    sub={`Sell: ${ctx.fmt(data?.mgmtSell || 0)}`}
    color="#6366f1" accent="#6366f1"
    onClick={() => ctx.setActivePanel('hr-timesheets-mgmt')} />
}
export const MgmtHoursTile: TileComponent = {
  def: { id: 'mgmt-hours', icon: '💼', title: 'Mgmt Hours', description: 'Management and SE AG hours logged to date', category: 'Labour', defaultSize: 'md', defaultVisible: false },
  Component: MgmtHoursComp,
}

function BackOfficeCostComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['back_office', 'list', ctx.projectId],
    queryFn: async () => {
      const [bo, se] = await Promise.all([
        supabase.from('back_office_hours').select('cost,sell').eq('project_id', ctx.projectId!),
        supabase.from('se_support_costs').select('amount').eq('project_id', ctx.projectId!),
      ])
      return {
        boCost: (bo.data || []).reduce((s, b) => s + (b.cost || 0), 0),
        seTotal: (se.data || []).reduce((s, e) => s + (e.amount || 0), 0),
      }
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  return <KpiCard icon="🏢" label="Back Office Cost" value={ctx.fmt(data?.boCost || 0)}
    sub={`SE Support: ${ctx.fmt(data?.seTotal || 0)}`}
    color="#6366f1" accent="#6366f1"
    onClick={() => ctx.setActivePanel('hr-backoffice')} />
}
export const BackOfficeCostTile: TileComponent = {
  def: { id: 'back-office-cost', icon: '🏢', title: 'Back Office Cost', description: 'Back office hours cost + SE Support costs', category: 'Labour', defaultSize: 'md', defaultVisible: false },
  Component: BackOfficeCostComp,
}

// ─── Other cost tiles ─────────────────────────────────────────────────────────

function HireEquipmentComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const { data, isLoading } = useQuery({
    queryKey: ['hire_items', 'cost', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('hire_items').select('hire_cost,currency').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const total = (data || []).reduce((s, h) => {
    const curr = (h as { hire_cost: number; currency?: string }).currency
    const rate = curr && curr !== (activeProject?.currency || 'AUD')
      ? ((activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || []).find(r => r.code === curr)?.rate || 1
      : 1
    return s + (h.hire_cost || 0) * rate
  }, 0)
  return <KpiCard icon="🚜" label="Equipment Hire" value={ctx.fmt(total)}
    color="var(--mod-hire)" accent="var(--mod-hire)"
    onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const HireEquipmentTile: TileComponent = {
  def: { id: 'hire-equipment', icon: '🚜', title: 'Equipment Hire', description: 'Total equipment hire cost (dry, wet, local) in project currency', category: 'Other Costs', defaultSize: 'md', defaultVisible: false },
  Component: HireEquipmentComp,
}

function ExpensesTotalComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('cost_ex_gst,category').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const total = (data || []).reduce((s, e) => s + (e.cost_ex_gst || 0), 0)
  return <KpiCard icon="🧾" label="Expenses" value={ctx.fmt(total)}
    sub={`${(data || []).length} expense lines`}
    color="#64748b" accent="#64748b"
    onClick={() => ctx.setActivePanel('expenses')} />
}
export const ExpensesTotalTile: TileComponent = {
  def: { id: 'expenses-total', icon: '🧾', title: 'Expenses', description: 'Total project expenses excluding GST', category: 'Other Costs', defaultSize: 'md', defaultVisible: false },
  Component: ExpensesTotalComp,
}

function CarsTotalComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cars', 'cost', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('cars').select('total_cost').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const total = (data || []).reduce((s, c) => s + ((c as { total_cost?: number }).total_cost || 0), 0)
  return <KpiCard icon="🚗" label="Car Hire" value={ctx.fmt(total)}
    color="#64748b" accent="#64748b"
    onClick={() => ctx.setActivePanel('hr-cars')} />
}
export const CarsTotalTile: TileComponent = {
  def: { id: 'cars-total', icon: '🚗', title: 'Car Hire Cost', description: 'Total cost of all car hire bookings', category: 'Other Costs', defaultSize: 'md', defaultVisible: false },
  Component: CarsTotalComp,
}

function AccomTotalComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['accommodation', 'cost', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('accommodation').select('total_cost').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const total = (data || []).reduce((s, a) => s + ((a as { total_cost?: number }).total_cost || 0), 0)
  return <KpiCard icon="🏨" label="Accommodation" value={ctx.fmt(total)}
    color="#64748b" accent="#64748b"
    onClick={() => ctx.setActivePanel('hr-accommodation')} />
}
export const AccomTotalTile: TileComponent = {
  def: { id: 'accom-total', icon: '🏨', title: 'Accommodation Cost', description: 'Total cost of all accommodation bookings', category: 'Other Costs', defaultSize: 'md', defaultVisible: false },
  Component: AccomTotalComp,
}

function VariationsApprovedComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['variations', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('variations').select('value,status').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const approved = (data || []).filter(v => v.status === 'approved')
  const total = approved.reduce((s, v) => s + (v.value || 0), 0)
  return <KpiCard icon="✔" label="Variations Approved" value={ctx.fmt(total)}
    sub={`${approved.length} of ${(data || []).length} approved`}
    color="var(--green)" accent="var(--green)"
    onClick={() => ctx.setActivePanel('variations')} />
}
export const VariationsApprovedTile: TileComponent = {
  def: { id: 'variations-approved', icon: '✔', title: 'Variations Approved', description: 'Total approved variation value', category: 'Variations', defaultSize: 'md', defaultVisible: false },
  Component: VariationsApprovedComp,
}

function ToolingEurCostComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tooling_costings', 'eur_cost', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('tooling_costings').select('tv_no,total_cost_eur,charge_start,charge_end').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  const eurTotal = (data || []).reduce((s, t) => s + ((t as { total_cost_eur?: number }).total_cost_eur || 0), 0)
  const tvCount = (data || []).length
  return <KpiCard icon="🔧" label="SE Tooling (EUR)" value={`€${eurTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`}
    sub={`${tvCount} TV${tvCount !== 1 ? 's' : ''} on project`}
    color="var(--mod-tooling)" accent="var(--mod-tooling)"
    onClick={() => ctx.setActivePanel('tooling-tvs')} />
}
export const ToolingEurCostTile: TileComponent = {
  def: { id: 'tooling-eur-cost', icon: '🔧', title: 'SE Tooling EUR Cost', description: 'Total SE rental tooling cost in EUR', category: 'Other Costs', defaultSize: 'md', defaultVisible: false },
  Component: ToolingEurCostComp,
}

function ExpenseByCategoryComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('cost_ex_gst,category').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🧾" label="No expenses yet" />

  const byCategory: Record<string, number> = {}
  for (const e of data) {
    const cat = (e.category as string) || 'Other'
    byCategory[cat] = (byCategory[cat] || 0) + (e.cost_ex_gst || 0)
  }
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>🧾 Expenses by Category</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {sorted.map(([cat, val]) => (
          <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--text3)' }}>{cat}</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{ctx.fmt(val)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const ExpenseByCategoryTile: TileComponent = {
  def: { id: 'expense-by-category', icon: '🧾', title: 'Expenses by Category', description: 'Top expense categories by spend', category: 'Other Costs', defaultSize: 'md', defaultVisible: false },
  Component: ExpenseByCategoryComp,
}
