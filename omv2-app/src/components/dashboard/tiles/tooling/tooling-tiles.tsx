/**
 * Tooling dashboard tiles — Phase 4
 * Existing: tvs-on-project, kollos-packages, total-tv-days, awaiting-dates,
 *           gross-margin, total-cost-eur, total-sell-eur, tv-register-table
 * New: tvs-no-dept, eur-aud-impact, charge-timeline
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useAppStore } from '../../../../store/appStore'
import { calcRentalCost } from '../../../../lib/calculations'
import { KpiCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const COLOR = '#0891b2'
const fmtEUR = (n: number) => n > 0 ? '€' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'

interface TV { tv_no: string; header_name: string | null; department_id: string | null; replacement_value_eur: number | null }
interface TvCosting { tv_no: string; charge_start: string | null; charge_end: string | null; cost_eur: number | null; sell_eur: number | null; sell_override_eur: number | null; notes: string | null }
interface Dept { id: string; name: string; rates: Record<string, unknown> }

// ── Shared tooling query ───────────────────────────────────────────────────────

function useToolingData(projectId: string | undefined) {
  return useQuery({
    queryKey: ['tooling', 'full', projectId],
    queryFn: async () => {
      const pid = projectId!
      const tvNos = await supabase.from('project_tvs').select('tv_no').eq('project_id', pid).eq('tv_type', 'tooling')
      const nos = tvNos.data?.map(r => r.tv_no) || []

      const [tvRes, costRes, deptRes, kolloRes] = await Promise.all([
        nos.length > 0
          ? supabase.from('global_tvs').select('tv_no,header_name,department_id,replacement_value_eur').in('tv_no', nos).order('tv_no')
          : Promise.resolve({ data: [] }),
        supabase.from('tooling_costings').select('tv_no,charge_start,charge_end,cost_eur,sell_eur,sell_override_eur,notes').eq('project_id', pid),
        supabase.from('global_departments').select('id,name,rates'),
        supabase.from('project_kollos').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      ])

      const tvs = (tvRes.data || []) as TV[]
      const costings = (costRes.data || []) as TvCosting[]
      const depts = (deptRes.data || []) as Dept[]
      const kolloCount = kolloRes.count || 0

      // Compute live costs (mirrors ToolingDashboard logic)
      const liveByTv: Record<string, { cost: number; sell: number }> = {}
      for (const c of costings) {
        const tv = tvs.find(t => t.tv_no === c.tv_no)
        const dept = tv?.department_id ? depts.find(d => d.id === tv.department_id) : null
        const replVal = Number(tv?.replacement_value_eur || 0)
        if (dept && c.charge_start && c.charge_end && replVal > 0) {
          const rates = dept.rates || {}
          const calc = calcRentalCost(replVal, {
            charge_start: c.charge_start,
            charge_end: c.charge_end,
            sell_override_eur: c.sell_override_eur ?? null,
          }, {
            rental_pct: Number(rates.rentalPct || 0),
            rate_unit: ((rates.rateUnit as string) || 'weekly') as 'weekly' | 'daily' | 'monthly',
            gm_pct: Number(rates.gmPct || 0),
          })
          if (calc) { liveByTv[c.tv_no] = { cost: calc.cost, sell: calc.sell }; continue }
        }
        liveByTv[c.tv_no] = { cost: c.cost_eur || 0, sell: c.sell_eur || 0 }
      }

      const totalCost = Object.values(liveByTv).reduce((s, v) => s + v.cost, 0)
      const totalSell = Object.values(liveByTv).reduce((s, v) => s + v.sell, 0)
      const tvDays = costings.reduce((s, c) => {
        if (!c.charge_start || !c.charge_end) return s
        return s + Math.max(0, Math.ceil((new Date(c.charge_end).getTime() - new Date(c.charge_start).getTime()) / 86400000) + 1)
      }, 0)
      const awaitingDates = tvs.filter(tv => {
        const c = costings.find(c => c.tv_no === tv.tv_no)
        return !c?.charge_start || !c?.charge_end
      }).length
      const gm = totalSell > 0 ? ((totalSell - totalCost) / totalSell * 100) : 0

      return { tvs, costings, depts, liveByTv, totalCost, totalSell, tvDays, awaitingDates, gm, kolloCount }
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

// ── KPI tiles ─────────────────────────────────────────────────────────────────

function TVsOnProjectComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error, refetch } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError onRetry={refetch} />
  return <KpiCard icon="🔧" label="TVs on Project" value={(data?.tvs || []).length}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('tooling-tvs')} />
}
export const TVsOnProjectTile: TileComponent = {
  def: { id: 'tvs-on-project', icon: '🔧', title: 'TVs on Project', description: 'Number of tooling TVs assigned to this project', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: TVsOnProjectComp,
}

function KollosPackagesComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <KpiCard icon="📦" label="Kollos / Packages" value={data?.kolloCount || 0}
    color="#7c3aed" accent="#7c3aed" onClick={() => ctx.setActivePanel('tooling-kollos')} />
}
export const KollosPackagesTile: TileComponent = {
  def: { id: 'kollos-packages', icon: '📦', title: 'Kollos / Packages', description: 'Kollo packages assigned to this project', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: KollosPackagesComp,
}

function TotalTVDaysComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <KpiCard icon="📅" label="Total TV Days" value={data?.tvDays ? data.tvDays + 'd' : '—'}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('tooling-costings')} />
}
export const TotalTVDaysTile: TileComponent = {
  def: { id: 'total-tv-days', icon: '📅', title: 'Total TV Days', description: 'Sum of all charge period days across TVs', category: 'Summary', defaultSize: 'md', defaultVisible: true },
  Component: TotalTVDaysComp,
}

function AwaitingDatesComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  const n = data?.awaitingDates || 0
  return <KpiCard icon={n > 0 ? '🟡' : '✅'} label="Awaiting Dates" value={n}
    color={n > 0 ? 'var(--amber)' : 'var(--green)'}
    accent={n > 0 ? 'var(--amber)' : 'var(--green)'}
    onClick={() => ctx.setActivePanel('tooling-costings')} />
}
export const AwaitingDatesTile: TileComponent = {
  def: { id: 'awaiting-dates', icon: '🟡', title: 'Awaiting Dates', description: 'TVs missing charge start or end dates', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: AwaitingDatesComp,
}

function GrossMarginToolingComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  const gm = data?.gm || 0
  return <KpiCard icon="📈" label="Gross Margin" value={gm > 0 ? gm.toFixed(1) + '%' : '—'}
    color={gm >= 15 ? 'var(--green)' : gm > 0 ? 'var(--amber)' : 'var(--text3)'}
    accent={gm >= 15 ? 'var(--green)' : gm > 0 ? 'var(--amber)' : 'var(--border)'}
    onClick={() => ctx.setActivePanel('tooling-costings')} />
}
export const GrossMarginToolingTile: TileComponent = {
  def: { id: 'gross-margin', icon: '📈', title: 'Gross Margin', description: 'Overall tooling gross margin %', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: GrossMarginToolingComp,
}

function TotalCostEURComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <KpiCard icon="💶" label="Total Cost (EUR)" value={fmtEUR(data?.totalCost || 0)}
    color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('tooling-costings')} />
}
export const TotalCostEURTile: TileComponent = {
  def: { id: 'total-cost-eur', icon: '💶', title: 'Total Cost (EUR)', description: 'Total SE rental tooling cost in EUR', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: TotalCostEURComp,
}

function TotalSellEURComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  return <KpiCard icon="💰" label="Total Sell (EUR)" value={fmtEUR(data?.totalSell || 0)}
    color="var(--green)" accent="var(--green)" onClick={() => ctx.setActivePanel('tooling-costings')} />
}
export const TotalSellEURTile: TileComponent = {
  def: { id: 'total-sell-eur', icon: '💰', title: 'Total Sell (EUR)', description: 'Total SE rental tooling sell price in EUR', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: TotalSellEURComp,
}

// ── TV register table tile ─────────────────────────────────────────────────────

function TVRegisterTableComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (!data?.tvs.length) return <TileEmpty icon="🔧" label="No TVs assigned yet" ctaLabel="Add TVs" onCta={() => ctx.setActivePanel('tooling-tvs')} />

  const { tvs, costings, depts, liveByTv } = data

  const tsColors: Record<string, string> = { green: '#d1fae5', amber: '#fef3c7', red: '#fee2e2', gray: '#f1f5f9' }
  const tsTextColors: Record<string, string> = { green: '#065f46', amber: '#92400e', red: '#991b1b', gray: '#64748b' }

  function tourStatus(tv_no: string) {
    const c = costings.find(x => x.tv_no === tv_no)
    if (!c) return { label: 'No costing', icon: '⚪', tag: 'gray' }
    if (c.charge_start && c.charge_end) return { label: 'Charge set', icon: '✅', tag: 'green' }
    if (c.charge_start) return { label: 'Start only', icon: '🟡', tag: 'amber' }
    return { label: 'Dates needed', icon: '🔴', tag: 'red' }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
        Project TV Register
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '12px', minWidth: '780px' }}>
          <thead>
            <tr>
              <th>TV No.</th><th>Name</th><th>Dept</th>
              <th style={{ textAlign: 'right' }}>Repl. Value</th>
              <th>Charge Start</th><th>Charge End</th><th>Status</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
              <th style={{ textAlign: 'right' }}>Sell</th>
            </tr>
          </thead>
          <tbody>
            {tvs.map(tv => {
              const ts = tourStatus(tv.tv_no)
              const dept = depts.find(d => d.id === tv.department_id)
              const c = costings.find(x => x.tv_no === tv.tv_no)
              const live = liveByTv[tv.tv_no]
              return (
                <tr key={tv.tv_no} style={{ cursor: 'pointer' }} onClick={() => ctx.setActivePanel('tooling-tvs')}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: COLOR }}>TV{tv.tv_no}</td>
                  <td>{tv.header_name || <em style={{ color: 'var(--text3)' }}>unnamed</em>}</td>
                  <td>{dept ? <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: '#e0e7ff', color: '#3730a3', fontWeight: 600 }}>{dept.name}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{tv.replacement_value_eur ? fmtEUR(tv.replacement_value_eur) : '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c?.charge_start || <span style={{ color: 'var(--amber)' }}>not set</span>}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c?.charge_end || <span style={{ color: 'var(--amber)' }}>not set</span>}</td>
                  <td><span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', background: tsColors[ts.tag], color: tsTextColors[ts.tag], fontWeight: 600 }}>{ts.icon} {ts.label}</span></td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{live?.cost ? fmtEUR(live.cost) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{live?.sell ? fmtEUR(live.sell) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export const TVRegisterTableTile: TileComponent = {
  def: { id: 'tv-register-table', icon: '🔧', title: 'TV Register', description: 'Full project TV register with charge dates and live costs', category: 'Detail', defaultSize: 'lg', defaultVisible: true },
  Component: TVRegisterTableComp,
}

// ── New tiles ─────────────────────────────────────────────────────────────────

function TVsNoDeptComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />
  const noDept = (data?.tvs || []).filter(tv => !tv.department_id).length
  if (noDept === 0) return <TileEmpty icon="✅" label="All TVs have a department assigned" />
  return <KpiCard icon="⚠" label="TVs Without Department" value={noDept}
    sub="Department required for live cost calc"
    color="var(--amber)" accent="var(--amber)"
    onClick={() => ctx.setActivePanel('tooling-tvs')} />
}
export const TVsNoDeptTile: TileComponent = {
  def: { id: 'tvs-no-dept', icon: '⚠', title: 'TVs Without Dept', description: 'TVs missing a department — blocks live cost calculation', category: 'Alerts', defaultSize: 'md', defaultVisible: true },
  Component: TVsNoDeptComp,
}

function EurAudImpactComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />

  const eurRate = ((activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || [])
    .find(r => r.code === 'EUR')?.rate || 0
  const totalEur = data?.totalSell || 0
  const audEquiv = eurRate > 0 ? totalEur * eurRate : 0

  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${COLOR}`, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>💱 EUR → AUD Impact</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <span style={{ color: 'var(--text3)' }}>Total Sell (EUR)</span>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtEUR(totalEur)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <span style={{ color: 'var(--text3)' }}>Rate</span>
          <span style={{ fontFamily: 'var(--mono)' }}>{eurRate > 0 ? `1 EUR = ${eurRate.toFixed(4)} AUD` : 'No rate set'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '2px' }}>
          <span>AUD Equivalent</span>
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{audEquiv > 0 ? ctx.fmt(audEquiv) : 'Rate not set'}</span>
        </div>
      </div>
    </div>
  )
}
export const EurAudImpactTile: TileComponent = {
  def: { id: 'eur-aud-impact', icon: '💱', title: 'EUR → AUD Impact', description: 'Total tooling sell converted to AUD at project exchange rate', category: 'Finance', defaultSize: 'md', defaultVisible: true },
  Component: EurAudImpactComp,
}

// Charge timeline — Gantt strip of TV charge windows
function ChargeTimelineComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useToolingData(ctx.projectId)
  if (isLoading) return <TileLoading />

  const costings = (data?.costings || []).filter(c => c.charge_start && c.charge_end)
  if (!costings.length) return <TileEmpty icon="📅" label="No charge dates set yet" ctaLabel="Set Dates" onCta={() => ctx.setActivePanel('tooling-costings')} />

  const allDates = costings.flatMap(c => [c.charge_start!, c.charge_end!])
  const minDate = allDates.reduce((a, b) => a < b ? a : b)
  const maxDate = allDates.reduce((a, b) => a > b ? a : b)
  const totalDays = Math.max(1, Math.ceil((new Date(maxDate).getTime() - new Date(minDate).getTime()) / 86400000) + 1)

  const pct = (d: string) => ((new Date(d).getTime() - new Date(minDate).getTime()) / 86400000) / totalDays * 100

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>📅 Charge Timeline</div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '12px' }}>
        {minDate} — {maxDate}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {costings.map(c => {
          const tv = data?.tvs.find(t => t.tv_no === c.tv_no)
          const left = pct(c.charge_start!)
          const width = Math.max(1, pct(c.charge_end!) - left)
          return (
            <div key={c.tv_no} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '40px', fontSize: '10px', fontFamily: 'var(--mono)', fontWeight: 700, color: COLOR, flexShrink: 0 }}>TV{c.tv_no}</div>
              <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: '3px', height: '14px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: left + '%', width: width + '%', height: '100%', background: COLOR, borderRadius: '3px', minWidth: '4px' }} />
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text3)', flexShrink: 0, width: '80px', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tv?.header_name || ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
export const ChargeTimelineTile: TileComponent = {
  def: { id: 'charge-timeline', icon: '📅', title: 'Charge Timeline', description: 'Gantt strip of TV charge periods', category: 'Detail', defaultSize: 'lg', defaultVisible: true },
  Component: ChargeTimelineComp,
}
