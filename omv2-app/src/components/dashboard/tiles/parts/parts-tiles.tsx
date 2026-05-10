/**
 * Parts dashboard tiles — Phase 4
 * Existing: total-parts, received-parts, required-parts, issued-qty, not-required,
 *           receiving-progress, crate-breakdown, recent-issues
 * New: days-to-rfc, parts-by-wo, top-unreceived
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { KpiCard, ProgressBarCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

// ── Shared parts query ────────────────────────────────────────────────────────
interface WositLine {
  id: string; tv_no: string; vb_no: string; location: string
  status: string; qty_required: number; qty_received: number; qty_issued: number
  material_no?: string; description?: string; work_order?: string
  unit_cost?: number
}

function useParts(projectId: string | undefined) {
  return useQuery({
    queryKey: ['wosit_lines', 'full', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('wosit_lines')
        .select('id,tv_no,vb_no,location,status,qty_required,qty_received,qty_issued,material_no,description,work_order,unit_cost')
        .eq('project_id', projectId!)
      return (data || []) as WositLine[]
    },
    enabled: !!projectId,
  })
}

const pctColor = (p: number) => p >= 100 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--text3)'

// ── KPI tiles ─────────────────────────────────────────────────────────────────

function TotalPartsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  return <KpiCard icon="📦" label="Total Parts" value={(data || []).length}
    color="#0891b2" accent="#0891b2" onClick={() => ctx.setActivePanel('parts-list')} />
}
export const TotalPartsTile: TileComponent = {
  def: { id: 'total-parts', icon: '📦', title: 'Total Parts', description: 'Total WOSIT lines tracked on this project', category: 'Status', defaultSize: 'md', defaultVisible: true },
  Component: TotalPartsComp,
}

function ReceivedPartsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(p => p.status === 'received' || p.status === 'issued').length
  return <KpiCard icon="✅" label="Received" value={count}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('parts-receiving')} />
}
export const ReceivedPartsTile: TileComponent = {
  def: { id: 'received-parts', icon: '✅', title: 'Received', description: 'Parts received or issued to site', category: 'Status', defaultSize: 'md', defaultVisible: true },
  Component: ReceivedPartsComp,
}

function RequiredPartsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(p => p.status === 'required' || p.status === 'ordered').length
  return <KpiCard icon="⏳" label="Required / Ordered" value={count}
    color={count > 0 ? 'var(--amber)' : 'var(--text3)'}
    accent={count > 0 ? 'var(--amber)' : 'var(--border)'}
    onClick={() => ctx.setActivePanel('parts-list')} />
}
export const RequiredPartsTile: TileComponent = {
  def: { id: 'required-parts', icon: '⏳', title: 'Required / Ordered', description: 'Parts still required or on order', category: 'Status', defaultSize: 'md', defaultVisible: true },
  Component: RequiredPartsComp,
}

function IssuedQtyComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  const qty = (data || []).reduce((s, p) => s + (p.qty_issued || 0), 0)
  return <KpiCard icon="🔩" label="Issued (qty)" value={qty}
    color="#7c3aed" accent="#7c3aed" onClick={() => ctx.setActivePanel('parts-issue')} />
}
export const IssuedQtyTile: TileComponent = {
  def: { id: 'issued-qty', icon: '🔩', title: 'Issued (qty)', description: 'Total quantity of parts issued to site', category: 'Status', defaultSize: 'md', defaultVisible: true },
  Component: IssuedQtyComp,
}

function NotRequiredComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(p => p.status === 'not_required').length
  return <KpiCard icon="❌" label="Not Required" value={count}
    color="var(--text3)" accent="var(--border)" onClick={() => ctx.setActivePanel('parts-list')} />
}
export const NotRequiredTile: TileComponent = {
  def: { id: 'not-required', icon: '❌', title: 'Not Required', description: 'Parts marked as not required for this outage', category: 'Status', defaultSize: 'md', defaultVisible: true },
  Component: NotRequiredComp,
}

// ── Progress tile ─────────────────────────────────────────────────────────────

function ReceivingProgressComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📦" label="No parts tracked yet" />
  const received = data.filter(p => p.status === 'received' || p.status === 'issued').length
  const pct = Math.round(received / data.length * 100)
  return <ProgressBarCard icon="📦" label="Overall Receiving Progress"
    pct={pct} color={pctColor(pct)}
    onClick={() => ctx.setActivePanel('parts-receiving')} />
}
export const ReceivingProgressTile: TileComponent = {
  def: { id: 'receiving-progress', icon: '📦', title: 'Receiving Progress', description: 'Overall parts receiving progress bar', category: 'Status', defaultSize: 'lg', defaultVisible: true },
  Component: ReceivingProgressComp,
}

// ── Crate breakdown tile ───────────────────────────────────────────────────────

function CrateBreakdownComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="📦" label="No crate data" />

  const crateMap: Record<string, { total: number; received: number }> = {}
  for (const p of data) {
    const key = `TV${p.tv_no}${p.vb_no ? ` — ${p.vb_no}` : ''}${p.location ? ` / ${p.location}` : ''}`
    if (!crateMap[key]) crateMap[key] = { total: 0, received: 0 }
    crateMap[key].total++
    if (p.status === 'received' || p.status === 'issued') crateMap[key].received++
  }
  const groups = Object.entries(crateMap).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
        By TV / Crate
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
        <table style={{ fontSize: '12px' }}>
          <thead><tr><th>TV / Crate</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Rcvd</th><th style={{ width: '70px' }}>Progress</th></tr></thead>
          <tbody>
            {groups.map(([key, g]) => {
              const p = g.total > 0 ? Math.round(g.received / g.total * 100) : 0
              return (
                <tr key={key}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{g.total}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{g.received}</td>
                  <td>
                    <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '5px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: p + '%', background: pctColor(p), borderRadius: '3px' }} />
                    </div>
                    <div style={{ fontSize: '9px', color: pctColor(p), fontFamily: 'var(--mono)', marginTop: '1px' }}>{p}%</div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export const CrateBreakdownTile: TileComponent = {
  def: { id: 'crate-breakdown', icon: '📦', title: 'Crate Breakdown', description: 'Parts receiving progress by TV and crate', category: 'Detail', defaultSize: 'lg', defaultVisible: true },
  Component: CrateBreakdownComp,
}

// ── Recent issues tile ────────────────────────────────────────────────────────

function RecentIssuesComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['issued_log', 'recent', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('issued_log')
        .select('id,material_no,description,qty,issued_to,work_order,issued_at')
        .eq('project_id', ctx.projectId!)
        .order('issued_at', { ascending: false }).limit(8)
      return data || []
    },
    enabled: !!ctx.projectId,
  })
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🔩" label="No parts issued yet" />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Recent Issues</span>
        <button className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 8px' }} onClick={() => ctx.setActivePanel('parts-issue')}>View all →</button>
      </div>
      <table style={{ fontSize: '12px' }}>
        <thead><tr><th>Material</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th>To</th><th>When</th></tr></thead>
        <tbody>
          {data.map((e) => (
            <tr key={e.id}>
              <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: '#0891b2' }}>{(e.material_no as string) || '—'}</td>
              <td style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(e.description as string) || '—'}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: '#7c3aed' }}>{e.qty as number}</td>
              <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{(e.issued_to as string) || (e.work_order as string) || '—'}</td>
              <td style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                {e.issued_at ? new Date(e.issued_at as string).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export const RecentIssuesTile: TileComponent = {
  def: { id: 'recent-issues', icon: '🔩', title: 'Recent Issues', description: 'Last 8 parts issued to site', category: 'Detail', defaultSize: 'lg', defaultVisible: true },
  Component: RecentIssuesComp,
}

// ── New tiles ──────────────────────────────────────────────────────────────────

function DaysToRFCComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  const pending = (data || []).filter(p => p.status === 'required' || p.status === 'ordered')
  if (!pending.length) return <TileEmpty icon="🏆" label="All parts received" />
  return <KpiCard icon="⏰" label="Parts Still Pending"
    value={pending.length}
    sub={`${data?.length || 0} total tracked`}
    color={pending.length > 10 ? 'var(--red)' : 'var(--amber)'}
    accent={pending.length > 10 ? 'var(--red)' : 'var(--amber)'}
    onClick={() => ctx.setActivePanel('parts-list')} />
}
export const DaysToRFCTile: TileComponent = {
  def: { id: 'days-to-rfc', icon: '⏰', title: 'Parts Still Pending', description: 'Parts not yet received that are still required', category: 'Status', defaultSize: 'md', defaultVisible: true },
  Component: DaysToRFCComp,
}

function PartsByWOComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useParts(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🔩" label="No parts data" />

  const byWO: Record<string, number> = {}
  for (const p of data) {
    const wo = p.work_order || 'Unassigned'
    byWO[wo] = (byWO[wo] || 0) + 1
  }
  const sorted = Object.entries(byWO).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>🔩 Parts by WO</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {sorted.map(([wo, count]) => (
          <div key={wo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
            <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{wo}</span>
            <span style={{ fontWeight: 700, color: '#0891b2' }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
export const PartsByWOTile: TileComponent = {
  def: { id: 'parts-by-wo', icon: '🔩', title: 'Parts by WO', description: 'Top work orders by parts count', category: 'Detail', defaultSize: 'md', defaultVisible: true },
  Component: PartsByWOComp,
}
