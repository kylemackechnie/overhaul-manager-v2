/**
 * HeroTiles — the signal-tier tiles for the Main dashboard.
 *
 * Replaces the wall of "module navigation" tiles. Each hero tile:
 *   - Answers a question a PM asks daily
 *   - Uses MetricCard (R/A/G driven by dashboardThresholds)
 *   - Pulls from useProjectHealth so numbers are consistent across tiles
 *
 * Tiles in this file:
 *   1. ProjectHealthTile     — composite R/A/G score with reasons
 *   2. CostSnapshotTile      — PM100 → AC → EAC → VAC at a glance
 *   3. DayCountTile          — outage day / days-to-start / next milestone
 *   4. HeadcountPlanTile     — forecast headcount today vs on-site today
 *   5. CashPositionTile      — invoiced / approved / paid pipeline
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useProjectHealth } from '../../../../hooks/useProjectHealth'
import { TileLoading, TileError } from '../../primitives'
import { toneFor, TONE_COLOR } from '../../../../lib/dashboardThresholds'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

// ─── 1. PROJECT HEALTH COMPOSITE ─────────────────────────────────────────────

function ProjectHealthComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error } = useProjectHealth(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error || !data) return <TileError />

  // If there's no budget loaded (MIKA never imported), the index calculations
  // are meaningless — show a soft empty state instead of a fake "100" score.
  if (data.bac < 1) {
    return (
      <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid var(--text3)', height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
        onClick={() => ctx.setActivePanel('cost-mika')}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '6px' }}>PROJECT HEALTH</div>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>No budget loaded</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4 }}>
          Import a MIKA workbook to enable CPI / SPI / EAC tracking.
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--accent)' }}>Open MIKA →</div>
      </div>
    )
  }

  const score = data.healthScore
  const tone = score >= 85 ? 'green' : score >= 65 ? 'amber' : 'red'
  const accent = TONE_COLOR[tone]
  const topIssues = data.healthIssues.slice(0, 3)
  const ringSize = 64
  const ringR = 28
  const ringC = 2 * Math.PI * ringR
  const ringPct = score / 100

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${accent}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('cost-dashboard')}>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
        {/* Ring */}
        <svg width={ringSize} height={ringSize} style={{ flexShrink: 0 }} aria-hidden>
          <circle cx={ringSize / 2} cy={ringSize / 2} r={ringR} fill="none" stroke="var(--border2)" strokeWidth={6} />
          <circle cx={ringSize / 2} cy={ringSize / 2} r={ringR} fill="none" stroke={accent} strokeWidth={6}
            strokeDasharray={`${(ringC * ringPct).toFixed(1)} ${ringC.toFixed(1)}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`} />
          <text x={ringSize / 2} y={ringSize / 2 + 5} textAnchor="middle" fontSize="16" fontWeight={800} fill={accent} fontFamily="var(--mono)">{score}</text>
        </svg>
        {/* Reasons */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '2px' }}>PROJECT HEALTH</div>
          <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
            {score >= 85 ? 'On track' : score >= 65 ? 'Watch closely' : 'Needs attention'}
          </div>
          {topIssues.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>No concerns flagged</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {topIssues.map((iss, i) => (
                <div key={i} style={{ fontSize: '10px', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: iss.severity === 'red' ? 'var(--red)' : 'var(--amber)' }}>●</span> {iss.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export const ProjectHealthTile: TileComponent = {
  def: { id: 'project-health', icon: '🩺', title: 'Project Health', description: 'Composite R/A/G score from CPI, SPI, EAC, and invoice ageing', category: 'Health', defaultSize: 'lg', defaultVisible: true },
  Component: ProjectHealthComp,
}

// ─── 2. COST SNAPSHOT ────────────────────────────────────────────────────────

function CostSnapshotComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useProjectHealth(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data) return <TileError />

  if (data.bac < 1) {
    return (
      <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid var(--text3)', height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
        onClick={() => ctx.setActivePanel('cost-mika')}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '6px' }}>COST SNAPSHOT</div>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>No PM100 budget</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4 }}>
          Import a MIKA workbook to populate BAC / EAC / variance figures.
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--accent)' }}>Open MIKA →</div>
      </div>
    )
  }

  const eacTone = toneFor(data.vacPct, 'vacPct')
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
  const fmtK = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'm'
    if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'k'
    return '$' + Math.round(n).toString()
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[eacTone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('cost-dashboard')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>COST SNAPSHOT</div>
        {data.vacPct != null && (
          <div style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: TONE_COLOR[eacTone], fontWeight: 700 }}>
            {data.vacPct >= 0 ? '▲' : '▼'} {Math.abs(data.vacPct).toFixed(1)}% vs BAC
          </div>
        )}
      </div>

      {/* 4-up mini grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 12px' }}>
        <Stat label="BAC" value={fmtK(data.bac)} color="var(--text)" />
        <Stat label="Actuals" value={fmtK(data.ac)} color="var(--mod-hr)" />
        <Stat label="Committed" value={fmtK(data.poCommitted)} color="#0284c7" />
        <Stat label="EAC" value={data.eac != null ? fmtK(data.eac) : '—'} color={TONE_COLOR[eacTone]} />
      </div>

      {/* Burn bar */}
      <div style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text3)', marginBottom: '3px' }}>
          <span>{data.progressPct.toFixed(0)}% earned · {data.burnPct.toFixed(0)}% burned</span>
          <span title={`BAC ${fmt(data.bac)}`} style={{ fontFamily: 'var(--mono)' }}>of {fmtK(data.bac)}</span>
        </div>
        <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '6px', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, data.burnPct)}%`, background: TONE_COLOR[eacTone], opacity: 0.35 }} />
          <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, data.progressPct)}%`, background: 'var(--green)' }} />
        </div>
      </div>
    </div>
  )
}
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--mono)', color }}>{value}</div>
      <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{label}</div>
    </div>
  )
}
export const CostSnapshotTile: TileComponent = {
  def: { id: 'cost-snapshot', icon: '💰', title: 'Cost Snapshot', description: 'BAC, actuals, committed, EAC at a glance — replaces "Procurement" tile', category: 'Finance', defaultSize: 'lg', defaultVisible: true },
  Component: CostSnapshotComp,
}

// ─── 3. DAY COUNTER + NEXT MILESTONE ─────────────────────────────────────────

function DayCountComp({ ctx }: { ctx: DashboardContext }) {
  const { data: health, isLoading } = useProjectHealth(ctx.projectId)
  const { data: milestones } = useQuery({
    queryKey: ['pre_planning', 'milestones', ctx.projectId],
    queryFn: async () => {
      const today = todayStr()
      const { data } = await supabase.from('pre_planning')
        .select('item,due_date,owner,priority,status')
        .eq('project_id', ctx.projectId!)
        .gte('due_date', today)
        .order('due_date')
        .limit(3)
      return (data || []).filter(m => m.status !== 'complete' && m.status !== 'done')
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading || !health) return <TileLoading />

  let bigValue = '—'
  let bigLabel = 'Project Status'
  let accent = 'var(--accent)'
  if (health.outageDay != null) {
    bigValue = `Day ${health.outageDay}`
    bigLabel = `${health.daysToEnd ?? 0}d left of outage`
    accent = '#8b5cf6'
  } else if (health.daysToStart != null && health.daysToStart > 0) {
    bigValue = `${health.daysToStart}d`
    bigLabel = 'until mobilisation'
    accent = 'var(--amber)'
  } else if (health.daysToStart != null && health.daysToEnd != null && health.daysToEnd < 0) {
    bigValue = 'Closeout'
    bigLabel = `${Math.abs(health.daysToEnd)}d past end date`
    accent = 'var(--text3)'
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${accent}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('pre-planning')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '4px' }}>SCHEDULE</div>
      <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--mono)', color: accent, lineHeight: 1 }}>{bigValue}</div>
      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{bigLabel}</div>
      <div style={{ borderTop: '1px solid var(--border2)', marginTop: '10px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, marginBottom: '4px' }}>NEXT MILESTONES</div>
        {(milestones || []).length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--text3)' }}>No upcoming pre-plan items</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {(milestones || []).map((m, i) => {
              const d = daysBetween(todayStr(), m.due_date!)
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', gap: '6px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.item}</span>
                  <span style={{ fontFamily: 'var(--mono)', color: d <= 3 ? 'var(--red)' : d <= 7 ? 'var(--amber)' : 'var(--text3)', flexShrink: 0 }}>
                    {d === 0 ? 'today' : `in ${d}d`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
export const DayCountTile: TileComponent = {
  def: { id: 'day-count', icon: '🗓', title: 'Day Counter', description: 'Outage day, days to start/end, and next 3 pre-planning milestones', category: 'Schedule', defaultSize: 'md', defaultVisible: true },
  Component: DayCountComp,
}

// ─── 4. HEADCOUNT PLAN vs ACTUAL ─────────────────────────────────────────────

function HeadcountPlanComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['resources', 'headcount', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('resources')
        .select('id,name,mob_in,mob_out,category')
        .eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading) return <TileLoading />
  if (!data) return <TileError />

  const today = todayStr()
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const onSite = data.filter(r => r.mob_in && r.mob_in <= today && (!r.mob_out || r.mob_out >= today))
  const arriving = data.filter(r => r.mob_in && r.mob_in > today && r.mob_in <= next7).length
  const departing = data.filter(r => r.mob_out && r.mob_out > today && r.mob_out <= next7).length

  const byCat: Record<string, number> = {}
  for (const r of onSite) {
    const k = r.category || 'other'
    byCat[k] = (byCat[k] || 0) + 1
  }
  const total = onSite.length

  // Forecast peak headcount for next 14 days = max simultaneous on-site
  let peak = total
  for (let i = 0; i <= 14; i++) {
    const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)
    const c = data.filter(r => r.mob_in && r.mob_in <= d && (!r.mob_out || r.mob_out >= d)).length
    if (c > peak) peak = c
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid var(--mod-hr)', height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('hr-resources')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '4px' }}>HEADCOUNT TODAY</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--mod-hr)', lineHeight: 1 }}>{total}</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>on site</div>
        {peak > total && (
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginLeft: 'auto', fontFamily: 'var(--mono)' }}>
            peak {peak} in 14d
          </div>
        )}
      </div>
      {/* Category breakdown */}
      <div style={{ display: 'flex', gap: '4px', marginTop: '8px', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
        {(['trades', 'management', 'seag', 'subcontractor'] as const).map(c => {
          const v = byCat[c] || 0
          if (!v) return null
          const colors: Record<string, string> = { trades: 'var(--mod-hr)', management: '#6366f1', seag: '#92400e', subcontractor: '#7c3aed' }
          return <div key={c} style={{ background: colors[c], flex: v, height: '100%' }} title={`${c}: ${v}`} />
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11px' }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: arriving > 0 ? 'var(--amber)' : 'var(--text3)' }}>+{arriving}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>arriving in 7d</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: departing > 0 ? 'var(--text2)' : 'var(--text3)' }}>−{departing}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>departing in 7d</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text2)' }}>{Object.keys(byCat).length}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>categories</div>
        </div>
      </div>
    </div>
  )
}
export const HeadcountPlanTile: TileComponent = {
  def: { id: 'headcount-plan', icon: '👥', title: 'Headcount Today', description: 'On-site today, peak forecast, arrivals and departures next 7 days', category: 'People', defaultSize: 'md', defaultVisible: true },
  Component: HeadcountPlanComp,
}

// ─── 5. CASH POSITION ────────────────────────────────────────────────────────

function CashPositionComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useProjectHealth(ctx.projectId)
  if (isLoading || !data) return <TileLoading />

  const fmtK = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'm'
    if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'k'
    return '$' + Math.round(n).toString()
  }

  if (data.invoiced < 1) {
    return (
      <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid var(--text3)', height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
        onClick={() => ctx.setActivePanel('invoices')}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '6px' }}>CASH POSITION</div>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>No invoices yet</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4 }}>
          Invoiced / approved / paid pipeline will appear here as vendor invoices arrive.
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--accent)' }}>Open Invoices →</div>
      </div>
    )
  }

  const total = data.invoiced || 1
  const approvedPct = (data.invoicedApproved / total) * 100
  const pendingPct = (data.invoicedPending / total) * 100
  const tone = data.invoicedPending > 0 && (data.invoicedPending / Math.max(1, data.bac)) > 0.05 ? 'amber' : 'green'

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[tone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('invoices')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600, marginBottom: '4px' }}>CASH POSITION</div>
      <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--text)', lineHeight: 1 }}>
        {fmtK(data.invoiced)}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>invoiced to date</div>

      {/* Pipeline bar */}
      <div style={{ marginTop: '10px' }}>
        <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '8px', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${approvedPct}%`, background: 'var(--green)' }} title={`Approved/paid: ${fmtK(data.invoicedApproved)}`} />
          <div style={{ width: `${pendingPct}%`, background: 'var(--amber)' }} title={`Pending: ${fmtK(data.invoicedPending)}`} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '10px' }}>
          <div>
            <span style={{ color: 'var(--green)' }}>●</span>{' '}
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtK(data.invoicedApproved)}</span>{' '}
            <span style={{ color: 'var(--text3)' }}>approved</span>
          </div>
          <div>
            <span style={{ color: 'var(--amber)' }}>●</span>{' '}
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtK(data.invoicedPending)}</span>{' '}
            <span style={{ color: 'var(--text3)' }}>pending</span>
          </div>
        </div>
      </div>
    </div>
  )
}
export const CashPositionTile: TileComponent = {
  def: { id: 'cash-position', icon: '💵', title: 'Cash Position', description: 'Invoiced → approved → paid pipeline with $ at each stage', category: 'Finance', defaultSize: 'lg', defaultVisible: true },
  Component: CashPositionComp,
}
