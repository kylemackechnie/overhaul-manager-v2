/**
 * NRG Actuals Panel
 * Reads from timesheet_cost_lines (single source of truth).
 * Non-labour actuals: invoices + expenses + approved variations tagged to item_id.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'
import { nrgInvoiceActual, nrgInvoiceActualForWeek, type NrgInvoiceMin, type NrgExpenseMin, type NrgVariationMin } from '../../engines/costEngine'
import { writeTimesheetCostLines } from '../../engines/timesheetCostEngine'
import type { RateCard, WeeklyTimesheet } from '../../types'
import type { NrgTceLine } from '../../types'

function statusBadge(pct: number | null, hasActuals: boolean) {
  if (!hasActuals) return { bg: '#f3f4f6', color: '#9ca3af', label: 'No actuals' }
  if (pct === null) return { bg: '#f3f4f6', color: '#9ca3af', label: 'No TCE' }
  if (pct > 100) return { bg: '#fee2e2', color: '#991b1b', label: '⚠ Over TCE' }
  if (pct > 80) return { bg: '#fef3c7', color: '#92400e', label: 'Near limit' }
  return { bg: '#d1fae5', color: '#065f46', label: 'On track' }
}

interface CostLineRow {
  tce_item_id: string | null
  work_order: string | null
  work_date: string | null
  cost_labour: number
  sell_labour: number
  cost_allowances: number
  sell_allowances: number
}

export function NrgActualsPanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  // Pre-aggregated labour cost per tce_item_id from timesheet_cost_lines (project total).
  const [labourByItem, setLabourByItem] = useState<Record<string, { cost: number; sell: number }>>({})
  // Raw cost-line rows kept for the per-week aggregation in the "this week" column.
  const [costLines, setCostLines] = useState<CostLineRow[]>([])
  const [invoices, setInvoices] = useState<NrgInvoiceMin[]>([])
  const [expenses, setExpenses] = useState<NrgExpenseMin[]>([])
  const [variations, setVariations] = useState<NrgVariationMin[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  // Selected week for the "this week" column. Empty = no filter (column hidden).
  // Stored as Monday's ISO date.
  const [weekFilter, setWeekFilter] = useState<string>('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    // Load TCE lines up front — both for the backfill writer (so WO-only allocs
    // get resolved to item_ids on legacy timesheets) and for the main render below.
    const { data: tceLinesData } = await supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('item_id')
    const tceLines = (tceLinesData || []) as NrgTceLine[]

    // Backfill: if no cost lines exist for this project, write them from approved timesheets
    const { count } = await supabase.from('timesheet_cost_lines').select('id', { count: 'exact', head: true }).eq('project_id', pid)
    if ((count || 0) === 0) {
      const [tsRes, rcRes, resRes] = await Promise.all([
        supabase.from('weekly_timesheets').select('*').eq('project_id', pid).eq('status', 'approved'),
        supabase.from('rate_cards').select('*').eq('project_id', pid),
        supabase.from('resources').select('id,wbs').eq('project_id', pid),
      ])
      const rcs = (rcRes.data || []) as RateCard[]
      const resources = (resRes.data || []) as { id: string; wbs?: string | null }[]
      for (const ts of (tsRes.data || []) as WeeklyTimesheet[]) {
        await writeTimesheetCostLines(ts, pid, rcs, tceLines, resources, activeProject)
      }
    }

    const [clRes, invRes, expRes, varRes] = await Promise.all([
      // Read from the pre-calculated cost lines table (approved only).
      // Include work_date so we can aggregate by week for the "this week" column.
      supabase.from('timesheet_cost_lines')
        .select('tce_item_id,work_order,work_date,cost_labour,sell_labour,cost_allowances,sell_allowances')
        .eq('project_id', pid)
        .eq('timesheet_status', 'approved'),
      supabase.from('invoices').select('tce_item_id,amount,status,period_from,period_to').eq('project_id', pid),
      supabase.from('expenses').select('tce_item_id,cost_ex_gst,amount,date').eq('project_id', pid),
      supabase.from('variations').select('status,tce_link,sell_total,approved_date').eq('project_id', pid),
    ])
    setLines(tceLines)

    // Aggregate labour cost by tce_item_id from the cost lines table — full project total
    const agg: Record<string, { cost: number; sell: number }> = {}
    // Also keep cost lines for per-week filtering
    const clRows = (clRes.data || []) as { tce_item_id: string | null; work_order: string | null; work_date: string | null; cost_labour: number; sell_labour: number; cost_allowances: number; sell_allowances: number }[]
    for (const row of clRows) {
      const key = row.tce_item_id || ''
      if (!key) continue
      if (!agg[key]) agg[key] = { cost: 0, sell: 0 }
      agg[key].cost += (row.cost_labour || 0) + (row.cost_allowances || 0)
      agg[key].sell += (row.sell_labour || 0) + (row.sell_allowances || 0)
    }
    setLabourByItem(agg)
    setCostLines(clRows)
    setInvoices((invRes.data || []) as NrgInvoiceMin[])
    setExpenses((expRes.data || []) as NrgExpenseMin[])
    setVariations((varRes.data || []) as NrgVariationMin[])
    setLoading(false)
  }

  // Skip group headers (3-segment IDs)
  const isGroupHeader = (id: string | null) => !!id && /^\d+\.\d+\.\d+$/.test(id)

  // ─── Weekly slice ────────────────────────────────────────────────────────
  // Build the list of weeks we have any data in — Monday-anchored.
  // Week selector picks one of these; defaults to "no filter" (column hidden).
  const monday = (d: string): string => {
    const dt = new Date(d + 'T00:00:00')
    const dow = dt.getUTCDay()
    const offset = dow === 0 ? 6 : dow - 1  // shift Sunday back to previous Monday
    dt.setUTCDate(dt.getUTCDate() - offset)
    return dt.toISOString().slice(0, 10)
  }
  const availableWeeks = (() => {
    const set = new Set<string>()
    costLines.forEach(r => { if (r.work_date) set.add(monday(r.work_date)) })
    invoices.forEach(i => { if (i.period_from) set.add(monday(i.period_from)) })
    expenses.forEach(e => { if (e.date) set.add(monday(e.date)) })
    return [...set].sort().reverse()
  })()

  // Weekly window: Monday to Sunday (inclusive) of the selected week.
  const weekStart = weekFilter
  const weekEnd = (() => {
    if (!weekFilter) return ''
    const dt = new Date(weekFilter + 'T00:00:00')
    dt.setUTCDate(dt.getUTCDate() + 6)
    return dt.toISOString().slice(0, 10)
  })()

  // Per-item labour aggregation filtered to the selected week.
  const labourByItemWeekly = (() => {
    const agg: Record<string, { cost: number; sell: number }> = {}
    if (!weekFilter) return agg
    for (const row of costLines) {
      if (!row.tce_item_id || !row.work_date) continue
      if (row.work_date < weekStart || row.work_date > weekEnd) continue
      if (!agg[row.tce_item_id]) agg[row.tce_item_id] = { cost: 0, sell: 0 }
      agg[row.tce_item_id].cost += (row.cost_labour || 0) + (row.cost_allowances || 0)
      agg[row.tce_item_id].sell += (row.sell_labour || 0) + (row.sell_allowances || 0)
    }
    return agg
  })()

  const withActuals = lines
    .filter(l => !isGroupHeader(l.item_id))
    .map(l => {
      const tce = l.tce_total || 0
      // Fixed Price scopes: TCE only tracks sell, planned figure flows
      // straight through as the actuals figure. Skip labour/invoice/expense
      // aggregation — these lines aren't rate-driven.
      if (l.line_type === 'Fixed Price') {
        // For Fixed Price lines the weekly figure is also the planned amount —
        // there's no time-based attribution, so we display the same value.
        // The user can interpret this as "100% of the cost is recognised".
        return { line: l, actuals: tce, tce, pct: tce > 0 ? 100 : null, weekActuals: weekFilter ? tce : 0 }
      }
      const labour = (l.item_id ? labourByItem[l.item_id]?.sell || 0 : 0)
      const nonLabour = nrgInvoiceActual(l.item_id, invoices, expenses, variations)
      const actuals = labour + nonLabour
      const pct = tce > 0 ? (actuals / tce) * 100 : null
      // Weekly slice
      const weekLabour = weekFilter && l.item_id ? (labourByItemWeekly[l.item_id]?.sell || 0) : 0
      const weekNonLabour = weekFilter
        ? nrgInvoiceActualForWeek(l.item_id, invoices, expenses, variations, weekStart, weekEnd)
        : 0
      const weekActuals = weekLabour + weekNonLabour
      return { line: l, actuals, tce, pct, weekActuals }
    })

  let displayed = withActuals
  if (sourceFilter === 'overhead') displayed = displayed.filter(x => x.line.source === 'overhead')
  if (sourceFilter === 'skilled') displayed = displayed.filter(x => x.line.source === 'skilled')
  if (filter === 'over') displayed = displayed.filter(x => x.pct !== null && x.pct > 100)
  else if (filter === 'near') displayed = displayed.filter(x => x.pct !== null && x.pct > 80 && x.pct <= 100)
  else if (filter === 'no_actuals') displayed = displayed.filter(x => x.actuals === 0)
  else if (filter === 'with_actuals') displayed = displayed.filter(x => x.actuals > 0)

  const totTce = withActuals.reduce((s, x) => s + x.tce, 0)
  const totAct = withActuals.reduce((s, x) => s + x.actuals, 0)
  const totPct = totTce > 0 ? (totAct / totTce) * 100 : null
  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

  function exportCSV() {
    const header = ['Item ID', 'Source', 'Description', 'Work Order', 'Contract Scope', 'TCE Value', 'Actuals']
    if (weekFilter) header.push(`Week ${weekStart}`)
    header.push('Remaining', '% Used')
    const rows: (string|number)[][] = [header]
    displayed.forEach(({ line, actuals, tce, pct, weekActuals }) => {
      const row: (string|number)[] = [
        line.item_id || '', line.source, line.description, line.work_order || '',
        line.contract_scope || '', String(tce), String(actuals),
      ]
      if (weekFilter) row.push(String(weekActuals || 0))
      row.push(String(tce - actuals), pct !== null ? pct.toFixed(1) + '%' : '—')
      rows.push(row)
    })
    const suffix = weekFilter ? `_week_${weekStart}` : ''
    downloadCSV(rows, `nrg_actuals_${activeProject?.name || 'project'}${suffix}`)
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG Actuals</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {withActuals.length} TCE lines · {fmt(totAct)} actual of {fmt(totTce)} TCE
            {totPct !== null && <span style={{ marginLeft: '8px', color: totPct > 100 ? 'var(--red)' : totPct > 80 ? 'var(--amber)' : 'var(--green)' }}>({totPct.toFixed(0)}%)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" title="Recalculate cost lines from timesheets (run after re-saving timesheets)" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: weekFilter ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {([
          { label: 'TCE Value', value: fmt(totTce), color: '#0284c7' },
          { label: 'Actuals to Date', value: fmt(totAct), color: 'var(--green)' },
          weekFilter
            ? { label: `This Week (${weekStart})`, value: fmt(withActuals.reduce((s, x) => s + (x.weekActuals || 0), 0)), color: '#1e40af' }
            : null,
          { label: 'Remaining', value: fmt(totTce - totAct), color: totTce - totAct < 0 ? 'var(--red)' : 'var(--text2)' },
          { label: '% Used', value: totPct !== null ? totPct.toFixed(1) + '%' : '—', color: totPct && totPct > 100 ? 'var(--red)' : totPct && totPct > 80 ? 'var(--amber)' : 'var(--green)' },
        ].filter(Boolean) as { label: string; value: string; color: string }[]).map(t => (
          <div key={t.label} className="card" style={{ padding: '12px 16px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '12px', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {totTce > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600 }}>Total Progress</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmt(totAct)} / {fmt(totTce)}</span>
          </div>
          <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: Math.min(100, totPct || 0) + '%', background: (totPct || 0) > 100 ? 'var(--red)' : (totPct || 0) > 80 ? 'var(--amber)' : 'var(--green)', borderRadius: '4px', transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { key: 'all', label: `All (${withActuals.length})` },
          { key: 'with_actuals', label: `Has Actuals (${withActuals.filter(x => x.actuals > 0).length})` },
          { key: 'over', label: `Over TCE (${withActuals.filter(x => x.pct !== null && x.pct > 100).length})` },
          { key: 'near', label: `Near Limit (${withActuals.filter(x => x.pct !== null && x.pct > 80 && x.pct <= 100).length})` },
          { key: 'no_actuals', label: `No Actuals (${withActuals.filter(x => x.actuals === 0).length})` },
        ].map(f => (
          <button key={f.key} className="btn btn-sm"
            style={{ background: filter === f.key ? 'var(--accent)' : '', color: filter === f.key ? '#fff' : '' }}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
        <div style={{ borderLeft: '1px solid var(--border)', margin: '0 4px' }} />
        {['all', 'overhead', 'skilled'].map(s => (
          <button key={s} className="btn btn-sm"
            style={{ background: sourceFilter === s ? '#6366f1' : '', color: sourceFilter === s ? '#fff' : '' }}
            onClick={() => setSourceFilter(s)}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
        ))}
        <div style={{ borderLeft: '1px solid var(--border)', margin: '0 4px' }} />
        {/* Week filter — adds a "This Week" column showing labour + invoice/expense/variation
            actuals that fall in the selected Mon-Sun window. Empty option = no column. */}
        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>This week:</span>
        <select className="input" style={{ fontSize: '12px', padding: '3px 6px', height: '28px' }}
          value={weekFilter} onChange={e => setWeekFilter(e.target.value)}>
          <option value="">— Project to date —</option>
          {availableWeeks.map(w => {
            const dt = new Date(w + 'T00:00:00')
            const sun = new Date(dt); sun.setUTCDate(dt.getUTCDate() + 6)
            const lbl = `${dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })} – ${sun.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}`
            return <option key={w} value={w}>{lbl}</option>
          })}
        </select>
      </div>

      {lines.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📊</div>
          <h3>No TCE lines</h3>
          <p>Import the NRG TCE spreadsheet on the TCE Register tab first.</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state"><div className="icon">✅</div><h3>No lines match this filter</h3></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>Item ID</th>
                  <th style={{ width: '70px' }}>Source</th>
                  <th>Description</th>
                  <th style={{ width: '90px' }}>Work Order</th>
                  <th style={{ width: '100px' }}>Contract</th>
                  <th style={{ textAlign: 'right', width: '90px' }}>TCE Value</th>
                  <th style={{ textAlign: 'right', width: '90px' }}>Actuals</th>
                  {weekFilter && <th style={{ textAlign: 'right', width: '95px', background: '#eff6ff' }} title="Labour + invoices/expenses/variations falling in this week">This Week</th>}
                  <th style={{ textAlign: 'right', width: '90px' }}>Remaining</th>
                  <th style={{ width: '120px' }}>Progress</th>
                  <th style={{ width: '90px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(({ line, actuals, tce, pct, weekActuals }) => {
                  const rem = tce - actuals
                  const pctNum = pct !== null ? Math.round(pct) : null
                  const barColor = pctNum === null ? 'var(--text3)' : pctNum > 100 ? 'var(--red)' : pctNum > 80 ? 'var(--amber)' : 'var(--green)'
                  const badge = statusBadge(pct, actuals > 0)
                  return (
                    <tr key={line.id}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{line.item_id || '—'}</td>
                      <td>
                        {line.line_type === 'Fixed Price' ? (
                          <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                            background: '#ede9fe', color: '#6b21a8',
                            fontWeight: 600, textTransform: 'uppercase' as const }}
                            title="Fixed Price — TCE planned cost is the actuals">
                            FIXED
                          </span>
                        ) : (
                          <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                            background: line.source === 'skilled' ? '#dbeafe' : '#f3f4f6',
                            color: line.source === 'skilled' ? '#1e40af' : '#64748b',
                            fontWeight: 600, textTransform: 'uppercase' as const }}>
                            {line.source}
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={line.description}>
                        {line.description || '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{line.work_order || '—'}</td>
                      <td style={{ fontSize: '10px' }}>
                        {line.contract_scope
                          ? <span style={{ background: '#ede9fe', color: '#6b21a8', padding: '1px 4px', borderRadius: '3px' }}>{line.contract_scope}</span>
                          : <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmt(tce)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: actuals > 0 ? 'var(--text)' : 'var(--text3)' }}>{fmt(actuals)}</td>
                      {weekFilter && (
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', background: '#eff6ff', color: weekActuals > 0 ? '#1e40af' : 'var(--text3)' }}>
                          {fmt(weekActuals)}
                        </td>
                      )}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: rem < 0 ? 'var(--red)' : 'var(--text2)' }}>{fmt(rem)}</td>
                      <td>
                        {pctNum !== null ? (
                          <div>
                            <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: Math.min(100, pctNum) + '%', background: barColor, borderRadius: '3px' }} />
                            </div>
                            <div style={{ fontSize: '10px', color: barColor, fontFamily: 'var(--mono)', marginTop: '2px', fontWeight: 600 }}>{pctNum}%</div>
                          </div>
                        ) : <span style={{ fontSize: '11px', color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td><span className="badge" style={badge}>{badge.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ padding: '8px 12px' }}>TOTAL ({displayed.length} lines)</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(displayed.reduce((s, x) => s + x.tce, 0))}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(displayed.reduce((s, x) => s + x.actuals, 0))}</td>
                  {weekFilter && (
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', background: '#dbeafe', color: '#1e40af' }}>
                      {fmt(displayed.reduce((s, x) => s + (x.weekActuals || 0), 0))}
                    </td>
                  )}
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: displayed.reduce((s, x) => s + x.tce - x.actuals, 0) < 0 ? 'var(--red)' : 'var(--text)' }}>
                    {fmt(displayed.reduce((s, x) => s + x.tce - x.actuals, 0))}
                  </td>
                  <td colSpan={2} style={{ fontSize: '12px', color: 'var(--text2)', padding: '8px 12px' }}>
                    {totTce > 0 ? Math.round(totAct / totTce * 100) + '% of total TCE used' : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
