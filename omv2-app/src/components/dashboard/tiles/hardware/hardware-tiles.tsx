/**
 * Hardware dashboard tiles — Phase 5
 * Existing (4): contracts-total, contracts-active, carts-count, total-contract-value
 * New (8): contracts-by-status, currency-exposure, top-contracts,
 *          escalation-table, customer-offers, contract-aging,
 *          po-line-counts, total-transfer-value
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useAppStore } from '../../../../store/appStore'
import { KpiCard, ModCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const COLOR = '#7c3aed'

interface ContractLine {
  part_no?: string; description?: string; qty?: number
  transfer_price?: number; customer_price?: number
}
interface HardwareContract {
  id: string; vendor: string; status: string
  value: number; currency: string; line_items: ContractLine[] | null
  created_at: string
}
interface EscalationYear {
  id: string; year: number; factor: number; yoy_change?: number | null; notes?: string
}

// ── Shared queries ─────────────────────────────────────────────────────────────

function useContracts(projectId: string | undefined) {
  return useQuery({
    queryKey: ['hardware_contracts', 'full', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('hardware_contracts')
        .select('id,vendor,status,value,currency,line_items,created_at')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false })
      return (data || []) as HardwareContract[]
    },
    enabled: !!projectId,
  })
}

function useEscalation(projectId: string | undefined) {
  return useQuery({
    queryKey: ['hardware_escalation', 'list', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('hardware_escalation')
        .select('id,year,factor,yoy_change,notes')
        .eq('project_id', projectId!)
        .order('year')
      return (data || []) as EscalationYear[]
    },
    enabled: !!projectId,
  })
}

// ── Existing tiles ─────────────────────────────────────────────────────────────

function ContractsTotalComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  return <KpiCard icon="📄" label="Contracts" value={(data || []).length}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('hardware-contract')} />
}
export const ContractsTotalTile: TileComponent = {
  def: { id: 'contracts-total', icon: '📄', title: 'Contracts', description: 'Total hardware contracts on this project', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: ContractsTotalComp,
}

function ContractsActiveComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  const active = (data || []).filter(c => c.status === 'active').length
  return <KpiCard icon="✅" label="Active Contracts" value={active}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('hardware-contract')} />
}
export const ContractsActiveTile: TileComponent = {
  def: { id: 'contracts-active', icon: '✅', title: 'Active Contracts', description: 'Hardware contracts in active status', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: ContractsActiveComp,
}

function CartsCountComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['hardware_carts', 'count', ctx.projectId],
    queryFn: async () => {
      const { count } = await supabase
        .from('hardware_carts')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', ctx.projectId!)
      return count || 0
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  return <KpiCard icon="🛒" label="Carts" value={data ?? 0}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('hardware-carts')} />
}
export const CartsCountTile: TileComponent = {
  def: { id: 'carts-count', icon: '🛒', title: 'Carts', description: 'Hardware pricing carts (customer offers)', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: CartsCountComp,
}

function TotalContractValueComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  // Most hardware is EUR
  const eurContracts = (data || []).filter(c => c.currency === 'EUR' || !c.currency)
  const audContracts = (data || []).filter(c => c.currency === 'AUD')
  const eurTotal = eurContracts.reduce((s, c) => s + (c.value || 0), 0)
  const audTotal = audContracts.reduce((s, c) => s + (c.value || 0), 0)

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${COLOR}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('hardware-contract')}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>💰 Total Contract Value</div>
      {eurTotal > 0 && <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>€{eurTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</div>}
      {audTotal > 0 && <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text2)', marginTop: '4px' }}>{ctx.fmt(audTotal)}</div>}
      {!eurTotal && !audTotal && <div style={{ color: 'var(--text3)', fontSize: '13px' }}>No contracts yet</div>}
    </div>
  )
}
export const TotalContractValueTile: TileComponent = {
  def: { id: 'total-contract-value', icon: '💰', title: 'Total Contract Value', description: 'Combined value of all hardware contracts', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: TotalContractValueComp,
}

// ── New tiles ─────────────────────────────────────────────────────────────────

function ContractsByStatusComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📄" label="No contracts yet" />

  const byStatus: Record<string, number> = {}
  for (const c of data) { byStatus[c.status || 'unknown'] = (byStatus[c.status || 'unknown'] || 0) + 1 }

  const statusColor: Record<string, string> = {
    active: 'var(--green)', draft: 'var(--text3)', expired: 'var(--red)',
    pending: 'var(--amber)', cancelled: 'var(--text3)',
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${COLOR}`, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>📊 By Status</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
          <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
            <span style={{ color: statusColor[status] || 'var(--text3)', textTransform: 'capitalize', fontWeight: 600 }}>{status}</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: statusColor[status] || 'var(--text3)' }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const ContractsByStatusTile: TileComponent = {
  def: { id: 'contracts-by-status', icon: '📊', title: 'Contracts by Status', description: 'Contract count grouped by status', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: ContractsByStatusComp,
}

function CurrencyExposureComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="💱" label="No contracts yet" />

  const eurTotal = (data).filter(c => c.currency === 'EUR' || !c.currency).reduce((s, c) => s + (c.value || 0), 0)
  const audTotal = (data).filter(c => c.currency === 'AUD').reduce((s, c) => s + (c.value || 0), 0)
  const eurRate = ((activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || [])
    .find(r => r.code === 'EUR')?.rate || 0
  const eurAsAud = eurRate > 0 ? eurTotal * eurRate : 0

  return <ModCard icon="💱" title="Currency Exposure" sub="EUR and AUD contract values"
    accent={COLOR} onClick={() => ctx.setActivePanel('hardware-contract')}
    stats={[
      { val: `€${eurTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`, lbl: 'EUR', color: COLOR },
      { val: audTotal > 0 ? ctx.fmt(audTotal) : '—', lbl: 'AUD', color: 'var(--text2)' },
      { val: eurAsAud > 0 ? ctx.fmt(eurAsAud) : 'No rate', lbl: 'EUR→AUD', color: 'var(--green)' },
    ]} />
}
export const CurrencyExposureTile: TileComponent = {
  def: { id: 'currency-exposure', icon: '💱', title: 'Currency Exposure', description: 'EUR vs AUD contract values with conversion', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: CurrencyExposureComp,
}

function TopContractsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📄" label="No contracts yet" />

  const sorted = [...data].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5)
  const fmtVal = (c: HardwareContract) => c.currency === 'AUD'
    ? ctx.fmt(c.value || 0)
    : `€${(c.value || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${COLOR}`, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>🏆 Top Contracts by Value</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {sorted.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>{c.vendor || 'Unknown vendor'}</div>
              <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'capitalize' }}>{c.status}</div>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: COLOR, flexShrink: 0 }}>{fmtVal(c)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const TopContractsTile: TileComponent = {
  def: { id: 'top-contracts', icon: '🏆', title: 'Top Contracts', description: 'Top 5 contracts by value', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: TopContractsComp,
}

function TotalTransferValueComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📦" label="No line items yet" />

  const allLines = data.flatMap(c => (c.line_items || []).map(l => ({ ...l, currency: c.currency })))
  const transferEur = allLines.filter(l => l.currency !== 'AUD').reduce((s, l) => s + (l.transfer_price || 0) * (l.qty || 1), 0)
  const customerEur = allLines.filter(l => l.currency !== 'AUD').reduce((s, l) => s + ((l.customer_price || l.transfer_price || 0)) * (l.qty || 1), 0)
  const lineCount = allLines.length

  return <ModCard icon="📦" title="Line Item Totals" sub={`${lineCount} line${lineCount !== 1 ? 's' : ''} across all contracts`}
    accent={COLOR} onClick={() => ctx.setActivePanel('hardware-contract')}
    stats={[
      { val: `€${transferEur.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`, lbl: 'Transfer (EUR)', color: COLOR },
      { val: `€${customerEur.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`, lbl: 'Customer (EUR)', color: 'var(--green)' },
      { val: lineCount, lbl: 'Lines', color: 'var(--text3)' },
    ]} />
}
export const TotalTransferValueTile: TileComponent = {
  def: { id: 'po-line-counts', icon: '📦', title: 'Line Item Totals', description: 'Transfer price and customer price totals across all contract line items', category: 'Finance', defaultSize: 'md', defaultVisible: false },
  Component: TotalTransferValueComp,
}

// Escalation table tile — shows YoY escalation factors
function EscalationTableComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useEscalation(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return (
    <TileEmpty icon="📈" label="No escalation data yet"
      ctaLabel="Add Escalation" onCta={() => ctx.setActivePanel('hardware-escalation')} />
  )

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📈 Escalation Factors</span>
        <button className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 8px' }} onClick={() => ctx.setActivePanel('hardware-escalation')}>Edit →</button>
      </div>
      <table style={{ fontSize: '12px' }}>
        <thead>
          <tr>
            <th>Year</th>
            <th style={{ textAlign: 'right' }}>Factor</th>
            <th style={{ textAlign: 'right' }}>YoY Δ</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {data.map(e => {
            const yoy = e.yoy_change
            const yoyColor = yoy == null ? 'var(--text3)' : yoy > 0 ? 'var(--red)' : 'var(--green)'
            return (
              <tr key={e.id}>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: COLOR }}>{e.year}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{(e.factor * 100).toFixed(2)}%</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: yoyColor }}>
                  {yoy != null ? `${yoy > 0 ? '+' : ''}${(yoy * 100).toFixed(2)}%` : '—'}
                </td>
                <td style={{ color: 'var(--text3)', fontSize: '10px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.notes || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
export const EscalationTableTile: TileComponent = {
  def: { id: 'escalation-yoy-chart', icon: '📈', title: 'Escalation Factors', description: 'Year-on-year hardware price escalation factors', category: 'Finance', defaultSize: 'lg', defaultVisible: true },
  Component: EscalationTableComp,
}

function ContractAgingComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useContracts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📄" label="No contracts yet" />

  const todayTs = Date.now()
  const buckets = { '< 30d': 0, '30–90d': 0, '90–180d': 0, '> 180d': 0 }
  for (const c of data) {
    const age = Math.floor((todayTs - new Date(c.created_at).getTime()) / 86400000)
    if (age < 30) buckets['< 30d']++
    else if (age < 90) buckets['30–90d']++
    else if (age < 180) buckets['90–180d']++
    else buckets['> 180d']++
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${COLOR}`, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>🕐 Contract Age</div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {Object.entries(buckets).map(([label, count]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: count > 0 ? COLOR : 'var(--text3)' }}>{count}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
export const ContractAgingTile: TileComponent = {
  def: { id: 'contract-aging', icon: '🕐', title: 'Contract Aging', description: 'Contracts grouped by age since creation', category: 'Summary', defaultSize: 'md', defaultVisible: false },
  Component: ContractAgingComp,
}
