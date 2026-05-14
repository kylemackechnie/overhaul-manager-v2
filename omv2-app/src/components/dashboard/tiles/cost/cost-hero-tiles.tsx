/**
 * Cost dashboard hero tiles — EVM signal tier.
 *
 * Five hero tiles that go at the top of the Cost dashboard:
 *   1. CPITile               — Cost Performance Index, EV/AC
 *   2. SPITile               — Schedule Performance Index, EV/PV
 *   3. EACTile               — Estimate At Completion vs BAC
 *   4. TCPITile              — To-Complete Performance Index
 *   5. CashConversionTile    — pipeline + average ageing days
 *
 * Plus detail tier:
 *   6. WbsHeatStripTile      — top 10 WBS lines by overspend %
 *   7. InvoiceAgeingTile     — 0-30 / 31-60 / 61-90 / 90+ buckets
 *   8. SpendVelocityTile     — weekly $ trend with weeks-to-completion
 *   9. VariationImpactTile   — VN uplift on BAC, by status
 *
 * All read from useProjectHealth + useWbsActuals so figures are consistent.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useProjectHealth } from '../../../../hooks/useProjectHealth'
import { TileLoading, TileEmpty } from '../../primitives'
import { toneFor, TONE_COLOR } from '../../../../lib/dashboardThresholds'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const fmtK = (n: number) => {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'm'
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'k'
  return '$' + Math.round(n).toString()
}

// ─── Shared "ratio gauge" — used by CPI, SPI, TCPI ──────────────────────────

interface GaugeProps {
  value: number | null
  label: string
  sub: string
  thresholdKey: 'cpi' | 'spi' | 'tcpi'
  /** Description text shown beneath */
  desc?: string
  onClick?: () => void
}

function RatioGauge({ value, label, sub, thresholdKey, desc, onClick }: GaugeProps) {
  const tone = toneFor(value, thresholdKey)
  const accent = TONE_COLOR[tone]
  const display = value != null && Number.isFinite(value) ? value.toFixed(2) : '—'
  // Normalise gauge fill to 0–1 around the "1.0" centreline. We use a clamped
  // visualisation: 0 → empty, 1 → half, 2 → full.
  const fill = value != null && Number.isFinite(value) ? Math.max(0, Math.min(1, value / 2)) : 0

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderTop: `3px solid ${accent}`,
        height: '100%',
        boxSizing: 'border-box',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--mono)', color: accent, lineHeight: 1 }}>{display}</div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{sub}</div>

      {/* Horizontal gauge with 1.0 centreline marker */}
      <div style={{ marginTop: '10px', position: 'relative', height: '6px', background: 'var(--border2)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${fill * 100}%`, background: accent, transition: 'width .3s' }} />
        {/* 1.0 marker */}
        <div style={{ position: 'absolute', left: '50%', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--text2)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text3)', marginTop: '2px', fontFamily: 'var(--mono)' }}>
        <span>0</span><span>1.0</span><span>2.0</span>
      </div>

      {desc && <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '6px', lineHeight: 1.4 }}>{desc}</div>}
    </div>
  )
}

// ─── 1. CPI ─────────────────────────────────────────────────────────────────

function CPIComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useProjectHealth(ctx.projectId)
  if (isLoading || !data) return <TileLoading />
  if (data.ac < 1) return <TileEmpty icon="📊" label="Need approved cost data" />

  const desc = data.cpi == null
    ? 'No actual cost yet'
    : data.cpi >= 1
      ? `Earning $${data.cpi.toFixed(2)} of value for every $1 spent — under budget`
      : `Earning only $${data.cpi.toFixed(2)} of value for every $1 spent — over budget`

  return (
    <RatioGauge
      value={data.cpi}
      label="CPI · Cost Performance"
      sub={`EV ${fmtK(data.ev)} ÷ AC ${fmtK(data.ac)}`}
      thresholdKey="cpi"
      desc={desc}
      onClick={() => ctx.setActivePanel('cost-mika')}
    />
  )
}
export const CPITile: TileComponent = {
  def: { id: 'cpi', icon: '📊', title: 'CPI', description: 'Cost Performance Index — earned value vs actual cost', category: 'Earned Value', defaultSize: 'md', defaultVisible: true },
  Component: CPIComp,
}

// ─── 2. SPI ─────────────────────────────────────────────────────────────────

function SPIComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useProjectHealth(ctx.projectId)
  if (isLoading || !data) return <TileLoading />
  if (data.pv < 1) return <TileEmpty icon="📈" label="No planned value yet" />

  const desc = data.spi == null
    ? 'No earned value yet'
    : data.spi >= 1
      ? `Earned ${data.spi.toFixed(2)}× planned to date — ahead of schedule`
      : `Earned ${data.spi.toFixed(2)}× planned to date — behind schedule`

  return (
    <RatioGauge
      value={data.spi}
      label="SPI · Schedule Performance"
      sub={`EV ${fmtK(data.ev)} ÷ PV ${fmtK(data.pv)}`}
      thresholdKey="spi"
      desc={desc}
      onClick={() => ctx.setActivePanel('cost-forecast')}
    />
  )
}
export const SPITile: TileComponent = {
  def: { id: 'spi', icon: '📈', title: 'SPI', description: 'Schedule Performance Index — earned value vs planned value', category: 'Earned Value', defaultSize: 'md', defaultVisible: true },
  Component: SPIComp,
}

// ─── 3. EAC ────────────────────────────────────────────────────────────────

function EACComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useProjectHealth(ctx.projectId)
  if (isLoading || !data) return <TileLoading />
  if (data.bac < 1) return <TileEmpty icon="💰" label="Import MIKA to enable" />
  if (data.eac == null) return <TileEmpty icon="💰" label="Insufficient actuals for EAC forecast" />

  const tone = toneFor(data.vacPct, 'vacPct')
  const accent = TONE_COLOR[tone]
  const overrunRisk = data.vacPct != null && data.vacPct < 0

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${accent}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('cost-mika')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>EAC · Forecast at Completion</div>
      <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--mono)', color: accent, lineHeight: 1, marginTop: '2px' }}>
        {fmtK(data.eac)}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>vs BAC {fmtK(data.bac)}</div>

      {/* VAC delta */}
      {data.vac != null && data.vacPct != null && (
        <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '5px', background: 'var(--bg3)' }}>
          <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600 }}>VAC · Variance at Completion</div>
          <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--mono)', color: accent, marginTop: '2px' }}>
            {data.vac >= 0 ? '+' : ''}{fmtK(data.vac)} · {data.vacPct.toFixed(1)}%
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '4px', lineHeight: 1.4 }}>
            {overrunRisk
              ? `Projected to overrun BAC by ${Math.abs(data.vacPct).toFixed(1)}% if CPI holds`
              : `On track to come in ${data.vacPct.toFixed(1)}% under BAC`}
          </div>
        </div>
      )}
    </div>
  )
}
export const EACTile: TileComponent = {
  def: { id: 'eac', icon: '💰', title: 'EAC + VAC', description: 'Forecast cost at completion vs Budget at Completion, with variance', category: 'Earned Value', defaultSize: 'md', defaultVisible: true },
  Component: EACComp,
}

// ─── 4. TCPI ───────────────────────────────────────────────────────────────

function TCPIComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useProjectHealth(ctx.projectId)
  if (isLoading || !data) return <TileLoading />
  if (data.bac < 1) return <TileEmpty icon="🎯" label="Import MIKA to enable" />
  if (data.tcpi == null) return <TileEmpty icon="🎯" label="Need progress data for TCPI" />

  const desc = data.tcpi <= 1.0
    ? 'Easier than current pace — coast to finish'
    : data.tcpi <= 1.05
      ? 'Close to current pace — achievable'
      : data.tcpi <= 1.10
        ? `Need ${((data.tcpi - 1) * 100).toFixed(1)}% more efficient on remaining work`
        : `Stretch target — need ${((data.tcpi - 1) * 100).toFixed(1)}% improvement to hit BAC`

  return (
    <RatioGauge
      value={data.tcpi}
      label="TCPI · To-Complete Index"
      sub="Efficiency required to hit BAC"
      thresholdKey="tcpi"
      desc={desc}
      onClick={() => ctx.setActivePanel('cost-forecast')}
    />
  )
}
export const TCPITile: TileComponent = {
  def: { id: 'tcpi', icon: '🎯', title: 'TCPI', description: 'To-Complete Performance Index — cost efficiency required to finish within BAC', category: 'Earned Value', defaultSize: 'md', defaultVisible: true },
  Component: TCPIComp,
}

// ─── 5. CASH CONVERSION ────────────────────────────────────────────────────

function CashConversionComp({ ctx }: { ctx: DashboardContext }) {
  const { data: health, isLoading: l1 } = useProjectHealth(ctx.projectId)
  const { data: rawInv, isLoading: l2 } = useQuery({
    queryKey: ['invoices', 'ageing', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('invoices')
        .select('amount,status,received_date,paid_date,status_history')
        .eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (l1 || l2 || !health) return <TileLoading />

  const invoices = (rawInv || []) as { amount: number | null; status: string; received_date: string | null; paid_date: string | null; status_history: unknown }[]
  if (invoices.length === 0) return <TileEmpty icon="💵" label="No invoices yet" />

  const today = new Date().toISOString().slice(0, 10)
  const daysBetween = (a: string, b: string) =>
    Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

  // Average ageing: days from received → approved/paid for closed invoices; days
  // from received → today for still-open ones.
  let openAgeDaySum = 0, openCount = 0
  let approvedAgeDaySum = 0, approvedCount = 0
  for (const i of invoices) {
    if (!i.received_date) continue
    if (i.status === 'received' || i.status === 'checked') {
      openAgeDaySum += daysBetween(i.received_date, today)
      openCount++
    } else if (i.status === 'approved' || i.status === 'paid') {
      // Look in status_history for the timestamp at which it became approved
      const hist = Array.isArray(i.status_history) ? (i.status_history as { status: string; setAt?: string }[]) : []
      const approvedEvent = hist.find(h => h.status === 'approved')
      const closeDate = approvedEvent?.setAt ? approvedEvent.setAt.slice(0, 10) : i.paid_date
      if (closeDate) {
        approvedAgeDaySum += daysBetween(i.received_date, closeDate)
        approvedCount++
      }
    }
  }
  const avgOpenAge = openCount > 0 ? Math.round(openAgeDaySum / openCount) : null
  const avgClosedAge = approvedCount > 0 ? Math.round(approvedAgeDaySum / approvedCount) : null

  const tone = avgOpenAge != null && avgOpenAge > 30 ? 'red' : avgOpenAge != null && avgOpenAge > 14 ? 'amber' : 'green'
  const accent = TONE_COLOR[tone]

  const total = health.invoiced
  const approvedPct = total > 0 ? (health.invoicedApproved / total) * 100 : 0
  const pendingPct = total > 0 ? (health.invoicedPending / total) * 100 : 0
  const otherPct = Math.max(0, 100 - approvedPct - pendingPct)

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${accent}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('invoices')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>CASH CONVERSION</div>
        {avgOpenAge != null && (
          <div style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: accent, fontWeight: 700 }}>
            {avgOpenAge}d avg open
          </div>
        )}
      </div>

      {/* Pipeline bar */}
      <div style={{ marginTop: '10px', background: 'var(--border2)', borderRadius: '3px', height: '12px', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${approvedPct}%`, background: 'var(--green)' }} title={`Approved/paid: ${fmtK(health.invoicedApproved)}`} />
        <div style={{ width: `${pendingPct}%`, background: 'var(--amber)' }} title={`Pending: ${fmtK(health.invoicedPending)}`} />
        <div style={{ width: `${otherPct}%`, background: 'var(--border)' }} title="Disputed/other" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmtK(health.invoicedApproved)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Approved + paid · {approvedPct.toFixed(0)}%</div>
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmtK(health.invoicedPending)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Pending approval · {pendingPct.toFixed(0)}%</div>
        </div>
      </div>

      <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text3)', lineHeight: 1.4 }}>
        {avgClosedAge != null && <>Closed invoices took <strong>{avgClosedAge}d</strong> received→approved on average.</>}
        {avgClosedAge == null && avgOpenAge != null && <>{openCount} invoice{openCount === 1 ? '' : 's'} open, averaging <strong>{avgOpenAge}d</strong> since received.</>}
      </div>
    </div>
  )
}
export const CashConversionTile: TileComponent = {
  def: { id: 'cash-conversion', icon: '💵', title: 'Cash Conversion', description: 'Invoice pipeline with average ageing — how long invoices sit before approval', category: 'Cashflow', defaultSize: 'lg', defaultVisible: true },
  Component: CashConversionComp,
}

// ─── 6. WBS HEAT STRIP ─────────────────────────────────────────────────────

function WbsHeatStripComp({ ctx }: { ctx: DashboardContext }) {
  const { data: mika, isLoading: l1 } = useQuery({
    queryKey: ['mika_wbs_lines', 'rows', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('mika_wbs_lines')
        .select('wbs,description,pm100,level')
        .eq('project_id', ctx.projectId!)
      return (data || []) as { wbs: string; description: string | null; pm100: number | null; level: number | null }[]
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })
  const { data: health, isLoading: l2 } = useProjectHealth(ctx.projectId)

  if (l1 || l2 || !mika || !health) return <TileLoading />
  if (mika.length === 0) return <TileEmpty icon="🗂" label="No MIKA imported yet" />

  // Build per-WBS heat rows from canonical wbsActuals (matches MIKA exactly).
  // Only consider WBS codes that have BOTH a PM100 and some actual spend,
  // ranked by used%.
  type Row = { wbs: string; desc: string; pm100: number; actuals: number; pct: number }
  const rows: Row[] = []
  for (const m of mika) {
    if ((m.pm100 || 0) < 1) continue
    const act = health.wbsActuals[m.wbs]?.actuals || 0
    if (act < 1) continue
    rows.push({
      wbs: m.wbs,
      desc: m.description || '',
      pm100: m.pm100 || 0,
      actuals: act,
      pct: ((m.pm100 || 0) > 0 ? (act / (m.pm100 || 0)) * 100 : 0),
    })
  }
  rows.sort((a, b) => b.pct - a.pct)
  const top = rows.slice(0, 10)

  if (top.length === 0) return <TileEmpty icon="🗂" label="No WBS-tagged actuals yet" />

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px' }}>🗂 WBS Heat — Top 10 by % Used</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
            Click any line to open the MIKA Cost Plan
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => ctx.setActivePanel('cost-mika')}>Full MIKA →</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {top.map(r => {
          const pct = r.pct
          const tone = toneFor(pct, 'budgetUsedPct')
          const accent = TONE_COLOR[tone]
          return (
            <div key={r.wbs} onClick={() => ctx.setActivePanel('cost-mika')}
              style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: '8px', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 700, color: 'var(--text2)', minWidth: '80px' }}>{r.wbs}</div>
              <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.desc}</div>
              <div style={{ position: 'relative', width: '100px', height: '12px', background: 'var(--border2)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, pct)}%`, background: accent, transition: 'width .3s' }} />
                {pct > 100 && (
                  <div style={{ position: 'absolute', inset: 0, width: '100%', background: 'var(--red)', opacity: 0.3 }} />
                )}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, color: accent, minWidth: '48px', textAlign: 'right' }}>
                {pct.toFixed(0)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
export const WbsHeatStripTile: TileComponent = {
  def: { id: 'wbs-heat-strip', icon: '🗂', title: 'WBS Heat Strip', description: 'Top 10 WBS lines by % of PM100 consumed — spot overspend hotspots', category: 'Earned Value', defaultSize: 'full', defaultVisible: true },
  Component: WbsHeatStripComp,
}

// ─── 7. INVOICE AGEING BUCKETS ─────────────────────────────────────────────

function InvoiceAgeingComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'buckets', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('invoices')
        .select('amount,status,received_date')
        .eq('project_id', ctx.projectId!)
        .in('status', ['received', 'checked'])
      return (data || []) as { amount: number | null; status: string; received_date: string | null }[]
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })
  if (isLoading) return <TileLoading />
  if (!data || data.length === 0) return <TileEmpty icon="✅" label="No invoices awaiting approval" />

  const today = new Date().toISOString().slice(0, 10)
  const daysBetween = (a: string, b: string) =>
    Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

  const buckets = {
    '0-30': { count: 0, amount: 0, color: 'var(--green)' },
    '31-60': { count: 0, amount: 0, color: 'var(--amber)' },
    '61-90': { count: 0, amount: 0, color: '#f97316' },
    '90+': { count: 0, amount: 0, color: 'var(--red)' },
  }
  for (const i of data) {
    if (!i.received_date) continue
    const age = daysBetween(i.received_date, today)
    const amt = i.amount || 0
    if (age <= 30) { buckets['0-30'].count++; buckets['0-30'].amount += amt }
    else if (age <= 60) { buckets['31-60'].count++; buckets['31-60'].amount += amt }
    else if (age <= 90) { buckets['61-90'].count++; buckets['61-90'].amount += amt }
    else { buckets['90+'].count++; buckets['90+'].amount += amt }
  }
  const total = Object.values(buckets).reduce((s, b) => s + b.amount, 0)
  const overdue = buckets['31-60'].amount + buckets['61-90'].amount + buckets['90+'].amount
  const tone = buckets['90+'].count > 0 ? 'red' : buckets['61-90'].count > 0 ? 'amber' : 'green'

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[tone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('invoices')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>INVOICE AGEING</div>
        <div style={{ fontSize: '10px', color: 'var(--text3)' }}>
          {fmtK(overdue)} <span style={{ fontWeight: 700, color: TONE_COLOR[tone] }}>over 30d</span>
        </div>
      </div>

      {/* Stacked bar */}
      <div style={{ marginTop: '10px', height: '10px', borderRadius: '3px', overflow: 'hidden', display: 'flex', background: 'var(--border2)' }}>
        {Object.entries(buckets).map(([k, b]) => {
          const pct = total > 0 ? (b.amount / total) * 100 : 0
          if (pct === 0) return null
          return <div key={k} style={{ width: `${pct}%`, background: b.color }} title={`${k}: ${fmtK(b.amount)}`} />
        })}
      </div>

      {/* Bucket detail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginTop: '10px' }}>
        {Object.entries(buckets).map(([k, b]) => (
          <div key={k}>
            <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: b.color }}>
              {b.count}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text3)' }}>{k}d</div>
            <div style={{ fontSize: '9px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
              {b.amount > 0 ? fmtK(b.amount) : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
export const InvoiceAgeingTile: TileComponent = {
  def: { id: 'invoice-ageing', icon: '⏳', title: 'Invoice Ageing', description: 'Pending invoices bucketed by 0–30 / 31–60 / 61–90 / 90+ days since received', category: 'Cashflow', defaultSize: 'md', defaultVisible: true },
  Component: InvoiceAgeingComp,
}

// ─── 8. SPEND VELOCITY ─────────────────────────────────────────────────────

function SpendVelocityComp({ ctx }: { ctx: DashboardContext }) {
  const { data: health } = useProjectHealth(ctx.projectId)
  const { data: weekly, isLoading } = useQuery({
    queryKey: ['spend_velocity', ctx.projectId],
    queryFn: async () => {
      const [tclR, invR] = await Promise.all([
        supabase.from('timesheet_cost_lines')
          .select('cost_labour,cost_allowances,work_date,timesheet_status')
          .eq('project_id', ctx.projectId!)
          .eq('timesheet_status', 'approved'),
        supabase.from('invoices')
          .select('amount,status,invoice_date')
          .eq('project_id', ctx.projectId!)
          .in('status', ['approved', 'paid']),
      ])
      const tcl = (tclR.data || []) as { cost_labour: number | null; cost_allowances: number | null; work_date: string | null }[]
      const inv = (invR.data || []) as { amount: number | null; invoice_date: string | null }[]

      // Bucket by ISO week
      const weekKey = (iso: string) => {
        const d = new Date(iso + 'T00:00:00')
        const day = d.getUTCDay()
        const monday = new Date(d)
        monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
        return monday.toISOString().slice(0, 10)
      }
      const byWeek: Record<string, number> = {}
      for (const l of tcl) {
        if (!l.work_date) continue
        const k = weekKey(l.work_date)
        byWeek[k] = (byWeek[k] || 0) + (l.cost_labour || 0) + (l.cost_allowances || 0)
      }
      for (const i of inv) {
        if (!i.invoice_date) continue
        const k = weekKey(i.invoice_date)
        byWeek[k] = (byWeek[k] || 0) + (i.amount || 0)
      }
      return Object.entries(byWeek).sort().map(([week, cost]) => ({ week, cost }))
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading || !weekly || !health) return <TileLoading />
  if (weekly.length === 0) return <TileEmpty icon="⚡" label="No actuals yet" />

  // Last 4 weeks average rate
  const recent = weekly.slice(-4)
  const avgWeekly = recent.length > 0 ? recent.reduce((s, w) => s + w.cost, 0) / recent.length : 0
  const remaining = Math.max(0, (health.bac - health.ac))
  const weeksToBac = avgWeekly > 0 ? remaining / avgWeekly : null

  // Sparkline
  const values = weekly.slice(-16).map(w => w.cost)
  const max = Math.max(...values, 1)
  const W = 220
  const H = 36
  const path = values.length > 1
    ? values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 4)).toFixed(1)}`).join(' ')
    : null

  // Tone: are we burning faster than the remaining time permits?
  const weeksLeftInProject = health.daysToEnd != null && health.daysToEnd > 0 ? health.daysToEnd / 7 : null
  let tone: 'green' | 'amber' | 'red' = 'green'
  if (weeksToBac != null && weeksLeftInProject != null) {
    if (weeksToBac > weeksLeftInProject * 1.1) tone = 'red'
    else if (weeksToBac > weeksLeftInProject * 0.95) tone = 'amber'
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${TONE_COLOR[tone]}`, height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('cost-forecast')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>SPEND VELOCITY</div>
      <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--mono)', color: TONE_COLOR[tone], lineHeight: 1, marginTop: '2px' }}>
        {fmtK(avgWeekly)} <span style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>/wk</span>
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>4-week average actual spend</div>

      {path && (
        <svg width={W} height={H} style={{ marginTop: '8px', display: 'block', maxWidth: '100%' }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={path} stroke={TONE_COLOR[tone]} strokeWidth={1.5} fill="none" />
        </svg>
      )}

      {weeksToBac != null && weeksLeftInProject != null && (
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '8px', lineHeight: 1.4 }}>
          {weeksToBac > weeksLeftInProject
            ? <>At this rate, BAC exhausts in <strong style={{ color: 'var(--red)' }}>{weeksToBac.toFixed(1)}w</strong> but {weeksLeftInProject.toFixed(1)}w remain on schedule.</>
            : <>At this rate, BAC lasts <strong style={{ color: 'var(--green)' }}>{weeksToBac.toFixed(1)}w</strong> — schedule needs {weeksLeftInProject.toFixed(1)}w.</>}
        </div>
      )}
    </div>
  )
}
export const SpendVelocityTile: TileComponent = {
  def: { id: 'spend-velocity', icon: '⚡', title: 'Spend Velocity', description: 'Average $/week actual spend with sparkline and weeks-to-BAC estimate', category: 'Earned Value', defaultSize: 'md', defaultVisible: true },
  Component: SpendVelocityComp,
}

// ─── 9. VARIATION IMPACT ──────────────────────────────────────────────────

function VariationImpactComp({ ctx }: { ctx: DashboardContext }) {
  const { data: health } = useProjectHealth(ctx.projectId)
  const { data: vns, isLoading } = useQuery({
    queryKey: ['variations', 'impact', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('variations')
        .select('number,title,status,value,sell_total,cost_total,raised_date')
        .eq('project_id', ctx.projectId!)
        .order('raised_date', { ascending: false })
      return (data || []) as { number: string | null; title: string | null; status: string; value: number | null; sell_total: number | null; cost_total: number | null; raised_date: string | null }[]
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading || !vns || !health) return <TileLoading />
  if (vns.length === 0) return <TileEmpty icon="🔀" label="No variations raised" />

  const byStatus: Record<string, { count: number; sell: number }> = {}
  for (const v of vns) {
    const k = v.status || 'draft'
    if (!byStatus[k]) byStatus[k] = { count: 0, sell: 0 }
    byStatus[k].count++
    byStatus[k].sell += v.sell_total || v.value || 0
  }
  const approvedSell = byStatus['approved']?.sell || 0
  const pendingSell = (byStatus['submitted']?.sell || 0) + (byStatus['draft']?.sell || 0)
  const rejected = (byStatus['rejected']?.count || 0) + (byStatus['cancelled']?.count || 0)

  const totalSell = Object.values(byStatus).reduce((s, b) => s + b.sell, 0)
  const upliftPct = health.pm100 > 0 ? (approvedSell / health.pm100) * 100 : 0
  const exposure = pendingSell  // unapproved but still potential adds

  const STATUS_COLORS: Record<string, string> = {
    approved: 'var(--green)',
    submitted: 'var(--amber)',
    draft: 'var(--text3)',
    rejected: 'var(--red)',
    cancelled: 'var(--text3)',
  }

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: '3px solid var(--amber)', height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
      onClick={() => ctx.setActivePanel('variations')}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>VARIATIONS</div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '2px' }}>
        <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--green)' }}>+{fmtK(approvedSell)}</div>
        <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{upliftPct.toFixed(1)}% PM100 uplift</div>
      </div>

      {/* Status mix bar */}
      {totalSell > 0 && (
        <div style={{ marginTop: '10px', height: '6px', borderRadius: '3px', background: 'var(--border2)', overflow: 'hidden', display: 'flex' }}>
          {Object.entries(byStatus).map(([k, b]) => {
            const pct = (b.sell / totalSell) * 100
            if (pct === 0) return null
            return <div key={k} style={{ width: `${pct}%`, background: STATUS_COLORS[k] || 'var(--text3)' }} title={`${k}: ${fmtK(b.sell)}`} />
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '10px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>
            {byStatus['approved']?.count || 0}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text3)' }}>Approved</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--amber)' }}>
            {(byStatus['submitted']?.count || 0) + (byStatus['draft']?.count || 0)}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text3)' }}>Pending</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
            {rejected}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text3)' }}>Rejected</div>
        </div>
      </div>

      {exposure > 0 && (
        <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text3)', lineHeight: 1.4 }}>
          {fmtK(exposure)} pending — potential additional uplift if approved.
        </div>
      )}
    </div>
  )
}
export const VariationImpactTile: TileComponent = {
  def: { id: 'variation-impact', icon: '🔀', title: 'Variation Impact', description: 'Approved variation uplift on PM100 + pending exposure breakdown by status', category: 'Variations', defaultSize: 'md', defaultVisible: true },
  Component: VariationImpactComp,
}
