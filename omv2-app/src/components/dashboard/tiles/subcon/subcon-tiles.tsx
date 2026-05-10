/**
 * Subcon dashboard tiles — Phase 4
 * Existing: total-rfqs, issued-rfqs, awarded-rfqs, active-pos, total-po-value, recent-rfqs
 * New: responses-overdue, vendor-shortlist, active-contracts
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { KpiCard, ModCard, TileLoading, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const COLOR = '#7c3aed'

interface RfqDoc { id: string; stage: string; title: string; due_date?: string | null; vendors_sent?: number | null; responses_received?: number | null }
interface SubconPO { id: string; vendor: string; po_value: number | null; status: string; quote_source: { type?: string } | null }

function useRFQs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['rfq_documents', 'full', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('rfq_documents')
        .select('id,stage,title,due_date,vendors_sent,responses_received')
        .eq('project_id', projectId!)
      return (data || []) as RfqDoc[]
    },
    enabled: !!projectId,
  })
}

function useSubconPOs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['purchase_orders', 'subcon', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('purchase_orders')
        .select('id,vendor,po_value,status,quote_source')
        .eq('project_id', projectId!)
      return (data || []) as SubconPO[]
    },
    enabled: !!projectId,
  })
}

// ── Existing tiles ─────────────────────────────────────────────────────────────

function TotalRFQsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useRFQs(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <KpiCard icon="📄" label="Total RFQs" value={(data || []).length}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('subcon-rfq-register')} />
}
export const TotalRFQsTile: TileComponent = {
  def: { id: 'total-rfqs', icon: '📄', title: 'Total RFQs', description: 'All RFQ documents on this project', category: 'RFQs', defaultSize: 'md', defaultVisible: true },
  Component: TotalRFQsComp,
}

function IssuedRFQsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useRFQs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(r => r.stage === 'issued').length
  return <KpiCard icon="📤" label="Issued RFQs" value={count}
    color="#3b82f6" accent="#3b82f6" onClick={() => ctx.setActivePanel('subcon-rfq-register')} />
}
export const IssuedRFQsTile: TileComponent = {
  def: { id: 'issued-rfqs', icon: '📤', title: 'Issued RFQs', description: 'RFQs currently sent to vendors awaiting response', category: 'RFQs', defaultSize: 'md', defaultVisible: true },
  Component: IssuedRFQsComp,
}

function AwardedRFQsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useRFQs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(r => r.stage === 'awarded' || r.stage === 'contracted').length
  return <KpiCard icon="🏆" label="Awarded / Contracted" value={count}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('subcon-rfq-register')} />
}
export const AwardedRFQsTile: TileComponent = {
  def: { id: 'awarded-rfqs', icon: '🏆', title: 'Awarded / Contracted', description: 'RFQs that have been awarded or contracted', category: 'RFQs', defaultSize: 'md', defaultVisible: true },
  Component: AwardedRFQsComp,
}

function ActivePOsSubconComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useSubconPOs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const rfqPos = (data || []).filter(p => p.quote_source?.type === 'rfq')
  const active = rfqPos.filter(p => p.status === 'active' || p.status === 'raised').length
  return <KpiCard icon="📋" label="Active POs" value={active}
    color="#1e40af" accent="#1e40af" onClick={() => ctx.setActivePanel('purchase-orders')} />
}
export const SubconActivePOsTile: TileComponent = {
  def: { id: 'active-pos', icon: '📋', title: 'Active POs', description: 'Active purchase orders linked to subcontract RFQs', category: 'POs', defaultSize: 'md', defaultVisible: true },
  Component: ActivePOsSubconComp,
}

function TotalPOValueComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useSubconPOs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const rfqPos = (data || []).filter(p => p.quote_source?.type === 'rfq')
  const total = rfqPos.reduce((s, p) => s + (p.po_value || 0), 0)
  return <KpiCard icon="💰" label="Total PO Value" value={ctx.fmt(total)}
    sub="From RFQ-linked POs" color="#1e40af" accent="#1e40af"
    onClick={() => ctx.setActivePanel('purchase-orders')} />
}
export const TotalPOValueTile: TileComponent = {
  def: { id: 'total-po-value', icon: '💰', title: 'Total PO Value', description: 'Total value of subcontract purchase orders from RFQs', category: 'POs', defaultSize: 'md', defaultVisible: true },
  Component: TotalPOValueComp,
}

function RecentRFQsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useRFQs(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.length) return <TileEmpty icon="🤝" label="No RFQs yet" ctaLabel="Create First RFQ" onCta={() => ctx.setActivePanel('subcon-rfq-doc')} />

  const stageStyle = (stage: string): React.CSSProperties => ({
    fontSize: '10px', padding: '1px 6px', borderRadius: '3px', fontWeight: 600, textTransform: 'capitalize',
    background: stage === 'awarded' || stage === 'contracted' ? '#d1fae5' : stage === 'issued' ? '#dbeafe' : '#f1f5f9',
    color: stage === 'awarded' || stage === 'contracted' ? '#065f46' : stage === 'issued' ? '#1e40af' : '#64748b',
  })

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>RFQ Documents</span>
        <button className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 8px' }} onClick={() => ctx.setActivePanel('subcon-rfq-register')}>View All →</button>
      </div>
      <table style={{ fontSize: '12px' }}>
        <thead><tr><th>Title</th><th>Stage</th></tr></thead>
        <tbody>
          {data.slice(0, 8).map(r => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => ctx.setActivePanel('subcon-rfq-register')}>
              <td style={{ fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || 'Untitled'}</td>
              <td><span style={stageStyle(r.stage || 'draft')}>{(r.stage || 'draft').replace('_', ' ')}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export const RecentRFQsTile: TileComponent = {
  def: { id: 'recent-rfqs', icon: '📄', title: 'RFQ Documents', description: 'Recent RFQ documents and their stages', category: 'RFQs', defaultSize: 'lg', defaultVisible: true },
  Component: RecentRFQsComp,
}

// ── New tiles ─────────────────────────────────────────────────────────────────

function ResponsesOverdueComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useRFQs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const today = new Date().toISOString().slice(0, 10)
  const overdue = (data || []).filter(r =>
    r.stage === 'issued' && r.due_date && r.due_date < today
  ).length
  if (overdue === 0) return <TileEmpty icon="✅" label="No RFQ responses overdue" />
  return <KpiCard icon="⚠" label="Responses Overdue" value={overdue}
    sub="Issued RFQs past their due date"
    color="var(--red)" accent="var(--red)"
    onClick={() => ctx.setActivePanel('subcon-rfq-register')} />
}
export const ResponsesOverdueTile: TileComponent = {
  def: { id: 'responses-overdue', icon: '⚠', title: 'Responses Overdue', description: 'Issued RFQs where the response due date has passed', category: 'RFQs', defaultSize: 'md', defaultVisible: true },
  Component: ResponsesOverdueComp,
}

function VendorShortlistComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useRFQs(ctx.projectId)
  if (isLoading) return <TileLoading />
  const issued = (data || []).filter(r => r.stage === 'issued' || r.stage === 'responses_in')
  if (!issued.length) return <TileEmpty icon="📊" label="No active RFQs" />
  const sent = issued.reduce((s, r) => s + (r.vendors_sent || 0), 0)
  const received = issued.reduce((s, r) => s + (r.responses_received || 0), 0)
  return <ModCard icon="📊" title="Vendor Responses"
    sub={`${issued.length} active RFQ${issued.length > 1 ? 's' : ''}`}
    accent={COLOR}
    onClick={() => ctx.setActivePanel('subcon-rfq-register')}
    stats={[
      { val: sent, lbl: 'Sent', color: COLOR },
      { val: received, lbl: 'Received', color: 'var(--green)' },
      { val: sent > 0 ? Math.round(received / sent * 100) + '%' : '—', lbl: 'Response %', color: 'var(--text3)' },
    ]} />
}
export const VendorShortlistTile: TileComponent = {
  def: { id: 'vendor-shortlist', icon: '📊', title: 'Vendor Responses', description: 'Vendors sent vs responses received across active RFQs', category: 'RFQs', defaultSize: 'md', defaultVisible: true },
  Component: VendorShortlistComp,
}
