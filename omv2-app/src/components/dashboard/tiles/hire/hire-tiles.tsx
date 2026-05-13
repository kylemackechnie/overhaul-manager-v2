/**
 * Hire dashboard tiles — Phase 4
 * Existing: total-items, currently-active, total-cost, customer-charge,
 *           dry-summary, wet-summary, local-summary, gm-bar, active-table
 * New: vendor-exposure, no-po-alert, offhire-14d
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { KpiCard, ModCard, ProgressBarCard, TileLoading, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const COLOR = '#f97316'
const today = new Date().toISOString().slice(0, 10)

interface HireItem {
  id: string; hire_type: string; name: string; vendor: string
  hire_cost: number; customer_total: number
  start_date: string | null; end_date: string | null
  linked_po_id?: string | null
}

function useHireItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ['hire_items', 'full', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('hire_items')
        .select('id,hire_type,name,vendor,hire_cost,customer_total,start_date,end_date,linked_po_id')
        .eq('project_id', projectId!)
        .order('start_date')
      return (data || []) as HireItem[]
    },
    enabled: !!projectId,
  })
}

// ── KPI tiles ─────────────────────────────────────────────────────────────────

function TotalItemsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  return <KpiCard icon="🚜" label="Total Hire Items" value={(data || []).length}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const TotalItemsTile: TileComponent = {
  def: { id: 'total-items', icon: '🚜', title: 'Total Hire Items', description: 'All hire items across dry, wet and local', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: TotalItemsComp,
}

function CurrentlyActiveComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  const active = (data || []).filter(i => !i.end_date || i.end_date >= today).length
  return <KpiCard icon="✅" label="Currently Active" value={active}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const CurrentlyActiveTile: TileComponent = {
  def: { id: 'currently-active', icon: '✅', title: 'Currently Active', description: 'Hire items currently on-hire', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: CurrentlyActiveComp,
}

function TotalCostHireComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  const total = (data || []).reduce((s, i) => s + (i.hire_cost || 0), 0)
  return <KpiCard icon="💵" label="Total Cost" value={ctx.fmt(total)}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const TotalCostHireTile: TileComponent = {
  def: { id: 'total-cost', icon: '💵', title: 'Total Cost', description: 'Total hire cost across all items', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: TotalCostHireComp,
}

function CustomerChargeComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  const total = (data || []).reduce((s, i) => s + (i.customer_total || 0), 0)
  return <KpiCard icon="💰" label="Customer Charge" value={ctx.fmt(total)}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const CustomerChargeTile: TileComponent = {
  def: { id: 'customer-charge', icon: '💰', title: 'Customer Charge', description: 'Total customer-charged value across all hire items', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: CustomerChargeComp,
}

// ── Type summary tiles ─────────────────────────────────────────────────────────

function makeTypeTile(type: string, icon: string, label: string, panel: string): TileComponent {
  function Comp({ ctx }: { ctx: DashboardContext }) {
    const { data, isLoading } = useHireItems(ctx.projectId)
    if (isLoading) return <TileLoading />
    const items = (data || []).filter(i => i.hire_type === type)
    const cost = items.reduce((s, i) => s + (i.hire_cost || 0), 0)
    const cust = items.reduce((s, i) => s + (i.customer_total || 0), 0)
    return <ModCard icon={icon} title={label} sub={`${items.length} item${items.length !== 1 ? 's' : ''}`}
      accent={COLOR} onClick={() => ctx.setActivePanel(panel)}
      stats={[
        { val: items.length, lbl: 'Items', color: COLOR },
        { val: ctx.fmt(cost), lbl: 'Cost', color: 'var(--text2)' },
        { val: ctx.fmt(cust), lbl: 'Customer', color: 'var(--green)' },
      ]} />
  }
  return {
    def: { id: `${type}-summary`, icon, title: label, description: `${label} hire items summary`, category: 'By Type', defaultSize: 'md', defaultVisible: true },
    Component: Comp,
  }
}

export const DrySummaryTile = makeTypeTile('dry', '🚜', 'Dry Hire', 'hire-dry')
export const WetSummaryTile = makeTypeTile('wet', '🏗️', 'Wet Hire', 'hire-wet')
export const LocalSummaryTile = makeTypeTile('local', '🧰', 'SEA Local Tooling', 'hire-local')

// ── GM bar tile ───────────────────────────────────────────────────────────────

function GmBarComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📊" label="No hire items yet" />
  const totalCost = data.reduce((s, i) => s + (i.hire_cost || 0), 0)
  const totalCust = data.reduce((s, i) => s + (i.customer_total || 0), 0)
  const gm = totalCust > 0 ? (totalCust - totalCost) / totalCust * 100 : 0
  const active = data.filter(i => !i.end_date || i.end_date >= today).length
  const returned = data.filter(i => i.end_date && i.end_date < today).length
  return <ProgressBarCard icon="📊" label="Overall Margin"
    pct={Math.min(100, gm)}
    valueText={`${gm.toFixed(1)}% GM · ${active} active · ${returned} returned`}
    color={gm >= 15 ? 'var(--green)' : gm >= 5 ? 'var(--amber)' : 'var(--red)'}
    onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const GmBarTile: TileComponent = {
  def: { id: 'gm-bar', icon: '📊', title: 'Hire Gross Margin', description: 'Overall hire margin with active vs returned count', category: 'Finance', defaultSize: 'lg', defaultVisible: true },
  Component: GmBarComp,
}

// ── Active table tile ─────────────────────────────────────────────────────────

function ActiveTableComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  const active = (data || []).filter(i => !i.end_date || i.end_date >= today)
  if (!active.length) return <TileEmpty icon="🚜" label="No active hire items" />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
        Currently Active ({active.length})
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
        <table style={{ fontSize: '12px' }}>
          <thead><tr><th>Type</th><th>Name</th><th>Vendor</th><th>Start</th><th>End</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Customer</th></tr></thead>
          <tbody>
            {active.slice(0, 15).map((i, idx) => (
              <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => ctx.setActivePanel(`hire-${i.hire_type}`)}>
                <td style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600 }}>{i.hire_type}</td>
                <td style={{ fontWeight: 500, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name || '—'}</td>
                <td style={{ color: 'var(--text3)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.vendor || '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{i.start_date || '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{i.end_date || 'Ongoing'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{ctx.fmt(i.hire_cost || 0)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{ctx.fmt(i.customer_total || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export const ActiveTableTile: TileComponent = {
  def: { id: 'active-table', icon: '📋', title: 'Active Items Table', description: 'Table of currently active hire items', category: 'Detail', defaultSize: 'lg', defaultVisible: true },
  Component: ActiveTableComp,
}

// ── New tiles ─────────────────────────────────────────────────────────────────

function VendorExposureComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🏭" label="No hire items" />

  const byVendor: Record<string, number> = {}
  for (const i of data) {
    const v = i.vendor || 'Unknown'
    byVendor[v] = (byVendor[v] || 0) + (i.hire_cost || 0)
  }
  const sorted = Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box', borderTop: `3px solid ${COLOR}` }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>🏭 Top Vendors by Cost</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {sorted.map(([vendor, cost]) => (
          <div key={vendor} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{vendor}</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: COLOR }}>{ctx.fmt(cost)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const VendorExposureTile: TileComponent = {
  def: { id: 'vendor-exposure', icon: '🏭', title: 'Top Vendors', description: 'Top 5 hire vendors by cost exposure', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: VendorExposureComp,
}

function NoPOAlertComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  const withoutPO = (data || []).filter(i => !i.linked_po_id).length
  if (withoutPO === 0) return <TileEmpty icon="✅" label="All hire items have a linked PO" />
  return <KpiCard icon="⚠" label="Items Without PO" value={withoutPO}
    sub={`of ${(data || []).length} total items`}
    color="var(--amber)" accent="var(--amber)"
    onClick={() => ctx.setActivePanel('hire-dry')} />
}
export const NoPOAlertTile: TileComponent = {
  def: { id: 'no-po-alert', icon: '⚠', title: 'Items Without PO', description: 'Hire items not linked to a purchase order', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: NoPOAlertComp,
}

function Offhire14dComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHireItems(ctx.projectId)
  if (isLoading) return <TileLoading />
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const offhireSoon = (data || []).filter(i => i.end_date && i.end_date >= today && i.end_date <= in14)
  if (!offhireSoon.length) return <TileEmpty icon="📅" label="No items off-hiring in 14 days" />
  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box', borderTop: '3px solid var(--amber)' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>📅 Off-Hire Next 14 Days ({offhireSoon.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {offhireSoon.map((i, idx) => {
          const daysLeft = Math.ceil((new Date(i.end_date!).getTime() - new Date(today).getTime()) / 86400000)
          return (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{i.name || i.vendor || '—'}</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: daysLeft <= 3 ? 'var(--red)' : 'var(--amber)', flexShrink: 0 }}>
                {daysLeft === 0 ? 'Today' : daysLeft === 1 ? '1d' : `${daysLeft}d`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
export const Offhire14dTile: TileComponent = {
  def: { id: 'offhire-14d', icon: '📅', title: 'Off-Hire Next 14 Days', description: 'Hire items due to go off-hire in the next 14 days', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: Offhire14dComp,
}

// Need TileError since it's used in TotalItemsComp
import { TileError } from '../../primitives'
