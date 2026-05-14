/**
 * Extra signal tiles — each one is a high-value addition motivated by the
 * dashboard research:
 *   - PreplanProgressTile  → completion % + R/A/G + overdue count (main dashboard)
 *   - VendorConcentrationTile → top 3 vendors' share of project spend (cost dashboard)
 *   - ProductivityIndexTile → actual vs planned labour hours (HR dashboard)
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { TileLoading, TileEmpty } from '../primitives'
import { TONE_COLOR, toneFor } from '../../../lib/dashboardThresholds'
import { useProjectHealth } from '../../../hooks/useProjectHealth'
import type { TileComponent, DashboardContext } from '../../../types/dashboard'

const todayStr = new Date().toISOString().slice(0, 10)
const fmtK = (n: number) => {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'm'
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'k'
  return '$' + Math.round(n).toString()
}

// ─── PRE-PLAN PROGRESS ──────────────────────────────────────────────────────

function PreplanProgressComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pre_planning', 'progress', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('pre_planning')
        .select('id,status,due_date,priority,category')
        .eq('project_id', ctx.projectId!)
      return (data || []) as { id: string; status: string | null; due_date: string | null; priority: string | null; category: string | null }[]
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading) return <TileLoading />
  if (!data || data.length === 0) return <TileEmpty icon="✅" label="No pre-planning items" />

  const isComplete = (s: string | null | undefined) => s === 'complete' || s === 'done'
  const total = data.length
  const done = data.filter(p => isComplete(p.status)).length
  const overdue = data.filter(p =>
    !isComplete(p.status) && p.due_date && p.due_date < todayStr).length
  const completePct = total > 0 ? (done / total) * 100 : 0
  const tone = toneFor(completePct, 'preplanCompletePct')

  // Category breakdown of incomplete items
  const incomplete = data.filter(p => !isComplete(p.status))
  const byCategory: Record<string, number> = {}
  for (const p of incomplete) {
    const k = p.category || 'Other'
    byCategory[k] = (byCategory[k] || 0) + 1
  }
  const topCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[tone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('pre-planning')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>PRE-PLANNING</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px' }}>
        <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--mono)', color: TONE_COLOR[tone], lineHeight: 1 }}>
          {completePct.toFixed(0)}%
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{done} of {total} done</div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: '10px', background: 'var(--border2)', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${completePct}%`, background: TONE_COLOR[tone], transition: 'width .3s' }} />
      </div>

      {/* Overdue + top categories */}
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)', color: overdue > 0 ? 'var(--red)' : 'var(--green)' }}>
            {overdue}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>overdue</div>
        </div>
        <div style={{ textAlign: 'right', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Top categories pending:</div>
          {topCats.length === 0
            ? <div style={{ fontSize: '11px', color: 'var(--green)' }}>All clear</div>
            : topCats.map(([cat, count]) => (
              <div key={cat} style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text2)' }}>{count}</span>{' '}
                <span style={{ color: 'var(--text3)' }}>{cat}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
export const PreplanProgressTile: TileComponent = {
  def: { id: 'preplan-progress', icon: '✅', title: 'Pre-Planning Progress', description: 'Pre-planning completion % with overdue count and top pending categories', category: 'Schedule', defaultSize: 'md', defaultVisible: true },
  Component: PreplanProgressComp,
}

// ─── VENDOR CONCENTRATION ──────────────────────────────────────────────────

function VendorConcentrationComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['vendor_concentration', ctx.projectId],
    queryFn: async () => {
      const [poR, invR] = await Promise.all([
        supabase.from('purchase_orders')
          .select('vendor,po_value,status')
          .eq('project_id', ctx.projectId!),
        supabase.from('invoices')
          .select('amount,po_id,vendor_details,status')
          .eq('project_id', ctx.projectId!),
      ])
      return {
        pos: (poR.data || []) as { vendor: string | null; po_value: number | null; status: string }[],
        invoices: (invR.data || []) as { amount: number | null; po_id: string | null; vendor_details: string | null; status: string }[],
      }
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading) return <TileLoading />
  if (!data) return <TileEmpty icon="🏢" label="No vendor data" />

  // Sum exposure by vendor (PO value + un-PO'd invoices)
  const byVendor: Record<string, number> = {}
  for (const p of data.pos) {
    if (p.status === 'cancelled') continue
    const v = (p.vendor || 'Unknown').trim()
    byVendor[v] = (byVendor[v] || 0) + (p.po_value || 0)
  }
  // Invoices without PO link: add vendor exposure from invoice
  for (const i of data.invoices) {
    if (i.po_id) continue
    const v = (i.vendor_details || 'Unknown').trim()
    byVendor[v] = (byVendor[v] || 0) + (i.amount || 0)
  }

  const total = Object.values(byVendor).reduce((s, v) => s + v, 0)
  if (total < 1) return <TileEmpty icon="🏢" label="No vendor exposure recorded" />

  const sorted = Object.entries(byVendor).sort((a, b) => b[1] - a[1])
  const top3 = sorted.slice(0, 3)
  const top3Total = top3.reduce((s, [, v]) => s + v, 0)
  const concentrationPct = (top3Total / total) * 100

  // Concentration risk: >70% in top 3 = risky
  const tone = concentrationPct > 80 ? 'red' : concentrationPct > 65 ? 'amber' : 'green'

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[tone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('purchase-orders')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>VENDOR CONCENTRATION</div>
        <div style={{ fontSize: '10px', color: TONE_COLOR[tone], fontWeight: 700, fontFamily: 'var(--mono)' }}>
          Top 3 = {concentrationPct.toFixed(0)}%
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
        {top3.map(([vendor, val]) => {
          const pct = (val / total) * 100
          return (
            <div key={vendor}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                  {vendor}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtK(val)}</span>
              </div>
              <div style={{ background: 'var(--border2)', borderRadius: '2px', height: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: TONE_COLOR[tone] }} />
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '8px', lineHeight: 1.4 }}>
        {sorted.length} vendor{sorted.length === 1 ? '' : 's'} total · {fmtK(total)} committed
      </div>
    </div>
  )
}
export const VendorConcentrationTile: TileComponent = {
  def: { id: 'vendor-concentration', icon: '🏢', title: 'Vendor Concentration', description: 'Top 3 vendors\' share of total committed spend — surfaces concentration risk', category: 'Procurement', defaultSize: 'md', defaultVisible: true },
  Component: VendorConcentrationComp,
}

// ─── PRODUCTIVITY INDEX (actual vs planned hours) ──────────────────────────

function ProductivityIndexComp({ ctx }: { ctx: DashboardContext }) {
  const { data: health } = useProjectHealth(ctx.projectId)
  const { data, isLoading } = useQuery({
    queryKey: ['productivity_index', ctx.projectId],
    queryFn: async () => {
      const [tclR, woR] = await Promise.all([
        supabase.from('timesheet_cost_lines')
          .select('allocated_hours,timesheet_status,work_date,category')
          .eq('project_id', ctx.projectId!)
          .eq('timesheet_status', 'approved'),
        supabase.from('work_orders')
          .select('budget_hours,actual_hours,status')
          .eq('project_id', ctx.projectId!),
      ])
      return {
        tcl: (tclR.data || []) as { allocated_hours: number | null; work_date: string | null; category: string | null }[],
        wos: (woR.data || []) as { budget_hours: number | null; actual_hours: number | null; status: string }[],
      }
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading || !data || !health) return <TileLoading />

  // Actual hours from timesheets
  const actualHours = data.tcl.reduce((s, l) => s + (l.allocated_hours || 0), 0)
  // Planned hours: prefer WO budget if available
  const woBudget = data.wos.reduce((s, w) => s + (w.budget_hours || 0), 0)
  const woActual = data.wos.reduce((s, w) => s + (w.actual_hours || 0), 0)

  // If we have WO budget data, that's the planned reference
  let planned: number | null = null
  let actualForCompare = actualHours
  let basis = 'timesheets'

  if (woBudget > 1) {
    planned = woBudget
    actualForCompare = woActual > 0 ? woActual : actualHours
    basis = 'work orders'
  } else if (health.bac > 0 && health.timeElapsedPct > 0) {
    // Fall back to time-elapsed pro-rata of total expected hours (rough)
    // Skip if we have no signal
  }

  if (planned == null || planned < 1) {
    return <TileEmpty icon="⏱" label="No planned hours yet — load WO budgets to enable" />
  }

  const idx = actualForCompare / planned
  // Productivity index — actual / planned. >1 = behind (overrun on hours)
  const tone = idx > 1.1 ? 'red' : idx > 1.0 ? 'amber' : 'green'

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[tone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('work-orders')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>PRODUCTIVITY</div>
      <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--mono)', color: TONE_COLOR[tone], lineHeight: 1, marginTop: '2px' }}>
        {idx.toFixed(2)}×
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
        actual / planned ({basis})
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
            {actualForCompare.toFixed(0)}h
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>actual</div>
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
            {planned.toFixed(0)}h
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>planned</div>
        </div>
      </div>

      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '8px', lineHeight: 1.4 }}>
        {idx <= 0.95
          ? <>Tracking <strong style={{ color: 'var(--green)' }}>{((1 - idx) * 100).toFixed(0)}%</strong> better than plan</>
          : idx <= 1.05
            ? 'On plan'
            : <>Tracking <strong style={{ color: 'var(--red)' }}>{((idx - 1) * 100).toFixed(0)}%</strong> over plan</>}
      </div>
    </div>
  )
}
export const ProductivityIndexTile: TileComponent = {
  def: { id: 'productivity-index', icon: '⏱', title: 'Productivity Index', description: 'Actual vs planned labour hours (WO budgets where available)', category: 'Labour', defaultSize: 'md', defaultVisible: true },
  Component: ProductivityIndexComp,
}
