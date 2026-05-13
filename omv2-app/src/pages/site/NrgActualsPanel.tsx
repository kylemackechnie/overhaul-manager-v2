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
import { NrgTimesheetExportModal } from '../../components/NrgTimesheetExportModal'
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
  sell_labour_eur: number
  cost_allowances: number
  sell_allowances: number
  category: string
}

export function NrgActualsPanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  // Pre-aggregated labour cost per tce_item_id from timesheet_cost_lines (project total).
  const [labourByItem, setLabourByItem] = useState<Record<string, { cost: number; sell: number }>>({})
  // Raw cost-line rows kept for the per-week aggregation in the "this week" column.
  // Actual hours per tce_item_id from timesheet_cost_lines
  const [hoursByItem, setHoursByItem] = useState<Record<string, number>>({})
  const [costLines, setCostLines] = useState<CostLineRow[]>([])
  const [invoices, setInvoices] = useState<NrgInvoiceMin[]>([])
  const [expenses, setExpenses] = useState<NrgExpenseMin[]>([])
  const [variations, setVariations] = useState<NrgVariationMin[]>([])
  const [nrgInvoices, setNrgInvoices] = useState<{id:string;week_ending:string|null;eur_spot_rate:number|null}[]>([])
  const [pos, setPos] = useState<{tce_item_id:string|null;po_value:number;status:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [showExport, setShowExport] = useState(false)
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

    const [clRes, invRes, expRes, varRes, nrgInvRes, poRes] = await Promise.all([
      // Read from the pre-calculated cost lines table (approved only).
      // Include work_date so we can aggregate by week for the "this week" column.
      supabase.from('timesheet_cost_lines')
        .select('tce_item_id,work_order,work_date,cost_labour,sell_labour,sell_labour_eur,cost_allowances,sell_allowances,allocated_hours,category')
        .eq('project_id', pid)
        .eq('timesheet_status', 'approved'),
      supabase.from('invoices').select('tce_item_id,amount,status,period_from,period_to').eq('project_id', pid).in('status', ['approved', 'paid']),
      supabase.from('expenses').select('tce_item_id,cost_ex_gst,amount,sell_price,date').eq('project_id', pid),
      supabase.from('variations').select('status,tce_link,sell_total,approved_date').eq('project_id', pid),
      supabase.from('nrg_customer_invoices').select('id,week_ending,eur_spot_rate').eq('project_id', pid).order('week_ending'),
      supabase.from('purchase_orders').select('tce_item_id,po_value,status').eq('project_id', pid),
    ])
    setLines(tceLines)

    // Aggregate labour cost by tce_item_id from the cost lines table — full project total
    const agg: Record<string, { cost: number; sell: number }> = {}
    // Also keep cost lines for per-week filtering
    const clRows = (clRes.data || []) as { tce_item_id: string | null; work_order: string | null; work_date: string | null; cost_labour: number; sell_labour: number; sell_labour_eur: number; cost_allowances: number; sell_allowances: number; allocated_hours: number; category: string }[]

    // Build spot rate map: week_ending → rate (from covering nrg_customer_invoice)
    const nrgInvsSorted = ((nrgInvRes.data || []) as {id:string;week_ending:string|null;eur_spot_rate:number|null}[])
      .filter(i => i.week_ending).sort((a,b) => (a.week_ending||'').localeCompare(b.week_ending||''))
    setNrgInvoices(nrgInvsSorted)

    const spotRateForWeekActuals = (weekEnding: string): number | null => {
      const covering = nrgInvsSorted.find(i => i.week_ending! >= weekEnding)
      const r = covering?.eur_spot_rate
      return (r != null && !isNaN(Number(r))) ? Number(r) : null
    }

    // Aggregate: for seag rows, apply spot rate if available; gate (exclude) if not
    for (const row of clRows) {
      const key = row.tce_item_id || ''
      if (!key) continue
      if (!agg[key]) agg[key] = { cost: 0, sell: 0 }
      const cost = (row.cost_labour || 0) + (row.cost_allowances || 0)
      let sell: number
      if ((row.sell_labour_eur || 0) > 0 && row.work_date) {
        // seag row — need spot rate for the week_ending of this row's week
        // Derive week_ending from work_date (Sunday of the week)
        const dt = new Date(row.work_date + 'T12:00:00')
        dt.setUTCDate(dt.getUTCDate() + (7 - dt.getUTCDay()) % 7 || 7)  // advance to Sunday
        const we = dt.toISOString().slice(0, 10)
        const rate = spotRateForWeekActuals(we)
        if (rate == null) {
          sell = 0  // gated — no spot rate
        } else {
          sell = row.sell_labour_eur * rate + (row.sell_allowances || 0)
        }
      } else {
        sell = (row.sell_labour || 0) + (row.sell_allowances || 0)
      }
      agg[key].cost += cost
      agg[key].sell += sell
    }
    // Aggregate actual hours by tce_item_id
    const hoursAgg: Record<string, number> = {}
    for (const row of clRows) {
      const key = row.tce_item_id || ''
      if (!key) continue
      if (!hoursAgg[key]) hoursAgg[key] = 0
      hoursAgg[key] += (row.allocated_hours || 0)
    }
    setHoursByItem(hoursAgg)
    setLabourByItem(agg)
    setCostLines(clRows as CostLineRow[])
    setInvoices((invRes.data || []) as NrgInvoiceMin[])
    setExpenses((expRes.data || []) as NrgExpenseMin[])
    setVariations((varRes.data || []) as NrgVariationMin[])
    setPos((poRes.data || []) as {tce_item_id:string|null;po_value:number;status:string}[])
    setLoading(false)
  }

  // Skip group headers (3-segment IDs or line_type === 'group')
  const isGroupHeader = (id: string | null, lineType?: string | null) =>
    (!!id && /^\d+\.\d+\.\d+$/.test(id)) || lineType === 'group'

  function lineCommitted(itemId: string | null): number {
    if (!itemId) return 0
    return pos
      .filter(p => p.tce_item_id === itemId && p.status !== 'cancelled' && p.status !== 'closed')
      .reduce((s, p) => s + (p.po_value || 0), 0)
  }

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
    .filter(l => !isGroupHeader(l.item_id, l.line_type))
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
      const isLabour = (l.line_type || '').includes('Labour') || l.source === 'skilled'
      const labour = (isLabour && l.item_id ? labourByItem[l.item_id]?.sell || 0 : 0)
      const nonLabour = nrgInvoiceActual(l.item_id, invoices, expenses, variations)
      const actuals = labour + nonLabour
      const pct = tce > 0 ? (actuals / tce) * 100 : null
      // Weekly slice
      const weekLabour = (isLabour && weekFilter && l.item_id) ? (labourByItemWeekly[l.item_id]?.sell || 0) : 0
      const weekNonLabour = weekFilter
        ? nrgInvoiceActualForWeek(l.item_id, invoices, expenses, variations, weekStart, weekEnd)
        : 0
      const weekActuals = weekLabour + weekNonLabour
      return { line: l, actuals, tce, pct, weekActuals }
    })

  // All lines go into a single table (FP lines included when they have actuals)
  let displayed = withActuals
  if (sourceFilter === 'overhead') displayed = displayed.filter(x => x.line.source === 'overhead')
  if (sourceFilter === 'skilled') displayed = displayed.filter(x => x.line.source === 'skilled')
  if (filter === 'over') displayed = displayed.filter(x => x.pct !== null && x.pct > 100)
  else if (filter === 'near') displayed = displayed.filter(x => x.pct !== null && x.pct > 80 && x.pct <= 100)
  else if (filter === 'no_actuals') displayed = displayed.filter(x => x.actuals === 0)
  else if (filter === 'with_actuals') displayed = displayed.filter(x => x.actuals !== 0)

  // Build render list: interleave group header rows before their children.
  // A header is only shown if at least one of its children survives the filter.
  type RenderRow =
    | { kind: 'header'; line: NrgTceLine; groupTce: number; groupActuals: number; groupWeekActuals: number }
    | { kind: 'leaf'; line: NrgTceLine; actuals: number; tce: number; pct: number | null; weekActuals: number }

  // Build render list mirroring TCE register's visibleRows approach:
  // walk `lines` in sort_order, keep headers in place, collect subtotals from displayed leaves.
  const displayedSet = new Set(displayed.map(x => x.line.id))

  const tableRows: RenderRow[] = []
  for (const l of lines) {
    if (isGroupHeader(l.item_id, l.line_type)) {
      // Only show header if at least one displayed leaf belongs to it
      const children = displayed.filter(x => {
        if (x.line.parent_id) return x.line.parent_id === l.item_id
        return (x.line.item_id || '').startsWith((l.item_id || '') + '.')
      })
      if (children.length === 0) continue
      tableRows.push({
        kind: 'header',
        line: l,
        groupTce: children.reduce((s, x) => s + x.tce, 0),
        groupActuals: children.reduce((s, x) => s + x.actuals, 0),
        groupWeekActuals: children.reduce((s, x) => s + (x.weekActuals || 0), 0),
      })
    } else if (displayedSet.has(l.id)) {
      const row = displayed.find(x => x.line.id === l.id)
      if (row) tableRows.push({ kind: 'leaf', ...row })
    }
  }

  const totTce = withActuals.reduce((s, x) => s + x.tce, 0)
  const totAct = withActuals.reduce((s, x) => s + x.actuals, 0)
  const totPct = totTce > 0 ? (totAct / totTce) * 100 : null
  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function printReport() {
    const projName = activeProject?.name || 'Project'
    const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
    const weekLabel = weekFilter
      ? (() => { const dt = new Date(weekFilter + 'T00:00:00'); const sun = new Date(dt); sun.setUTCDate(dt.getUTCDate()+6); return dt.toLocaleDateString('en-AU',{day:'2-digit',month:'short'}) + ' – ' + sun.toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) })()
      : 'Project to Date'
    const fmtP = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const TH = (s: string, right = false) =>
      `<th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:5px 8px;font-size:9px;text-transform:uppercase;text-align:${right?'right':'left'};color:#475569;font-weight:700;white-space:nowrap">${s}</th>`
    const TD = (s: string, right = false, bold = false, color = '') =>
      `<td style="border:1px solid #e2e8f0;padding:4px 8px;font-size:10px;vertical-align:middle;${right?'text-align:right;font-family:monospace;':''}${bold?'font-weight:700;':''}${color?`color:${color};`:''}">${s}</td>`

    const pctBar = (pct: number | null) => {
      if (pct === null) return '—'
      const color = pct > 100 ? '#dc2626' : pct > 80 ? '#d97706' : '#16a34a'
      return `<span style="font-family:monospace;font-size:9px;color:${color};font-weight:700">${Math.round(pct)}%</span>`
    }

    const colHeaders = [
      TH('Item ID'), TH('Source'), TH('Description'), TH('Work Order'),
      TH('Est. Hrs', true), TH('Act. Hrs', true), TH('TCE', true),
      TH('Actuals', true),
      ...(weekFilter ? [TH('This Week', true)] : []),
      TH('Remaining', true), TH('% Used'),
    ]

    const rowsHTML = tableRows.map(row => {
      if (row.kind === 'header') {
        const { line, groupTce, groupActuals, groupWeekActuals } = row
        const groupRem = groupTce - groupActuals
        const extraCols = weekFilter ? 1 : 0
        const blankCols = 4 + extraCols  // blank cells after Remaining + % Used
        return `<tr style="background:#e0e7ff;color:#3730a3;border-bottom:2px solid #c7d2fe">
          <td style="font-family:monospace;font-size:11px;font-weight:700;padding:6px 8px;white-space:nowrap;border:1px solid #c7d2fe">▼ ${line.item_id||''}</td>
          <td style="border:1px solid #c7d2fe"></td>
          <td colspan="2" style="font-weight:700;font-size:11px;padding:6px 8px;border:1px solid #c7d2fe">${line.description||''}</td>
          <td colspan="2" style="border:1px solid #c7d2fe"></td>
          <td style="text-align:right;font-family:monospace;font-weight:700;font-size:11px;padding:6px 8px;border:1px solid #c7d2fe">${groupTce ? fmtP(groupTce) : '—'}</td>
          <td style="text-align:right;font-family:monospace;font-weight:700;font-size:11px;padding:6px 8px;color:#4f46e5;border:1px solid #c7d2fe">${groupActuals ? fmtP(groupActuals) : '—'}</td>
          ${weekFilter ? `<td style="text-align:right;font-family:monospace;font-weight:700;font-size:11px;padding:6px 8px;color:#1e40af;border:1px solid #c7d2fe">${groupWeekActuals ? fmtP(groupWeekActuals) : '—'}</td>` : ''}
          <td style="text-align:right;font-family:monospace;font-weight:700;font-size:11px;padding:6px 8px;${groupRem<0?'color:#dc2626;':''}border:1px solid #c7d2fe">${fmtP(groupRem)}</td>
          <td colspan="${blankCols}" style="border:1px solid #c7d2fe"></td>
        </tr>`
      }
      const { line, actuals, tce, pct, weekActuals } = row
      const rem = tce - actuals
      const estHrs = line.estimated_qty ? line.estimated_qty.toLocaleString('en-AU', { maximumFractionDigits: 1 }) : '—'
      const actHrs = line.item_id && hoursByItem[line.item_id] ? hoursByItem[line.item_id].toLocaleString('en-AU', { maximumFractionDigits: 1 }) : '—'
      const srcBg = line.line_type === 'Fixed Price' ? '#ede9fe' : line.source === 'skilled' ? '#dbeafe' : '#f3f4f6'
      const srcCol = line.line_type === 'Fixed Price' ? '#6b21a8' : line.source === 'skilled' ? '#1e40af' : '#64748b'
      const srcLabel = line.line_type === 'Fixed Price' ? 'Fixed Price' : line.source
      return `<tr>
        ${TD(`<span style="font-family:monospace;font-size:10px;color:#64748b;padding-left:16px">${line.item_id||'—'}</span>`)}
        <td style="border:1px solid #e2e8f0;padding:4px 8px"><span style="font-size:9px;padding:1px 4px;border-radius:3px;background:${srcBg};color:${srcCol};font-weight:700;text-transform:uppercase">${srcLabel}</span></td>
        ${TD(line.description||'—', false, true)}
        ${TD(line.work_order||'—')}
        ${TD(estHrs, true)}
        ${TD(actHrs, true)}
        ${TD(fmtP(tce), true, true)}
        ${TD(fmtP(actuals), true, actuals > 0, actuals > 0 ? '' : '#94a3b8')}
        ${weekFilter ? TD(fmtP(weekActuals||0), true, false, weekActuals > 0 ? '#1e40af' : '#94a3b8') : ''}
        ${TD(fmtP(rem), true, false, rem < 0 ? '#dc2626' : '')}
        <td style="border:1px solid #e2e8f0;padding:4px 8px">${pctBar(pct)}</td>
      </tr>`
    }).join('')

    const totAct2 = displayed.reduce((s, x) => s + x.actuals, 0)
    const totTce2 = displayed.reduce((s, x) => s + x.tce, 0)
    const totPct2 = totTce2 > 0 ? (totAct2/totTce2*100) : null
    const totColor = totPct2 && totPct2 > 100 ? '#dc2626' : totPct2 && totPct2 > 80 ? '#d97706' : '#16a34a'
    const footColSpan = weekFilter ? 9 : 8

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>NRG Actuals — ${projName}</title>
<style>body{font-family:-apple-system,Arial,sans-serif;margin:0;padding:24px;color:#0f172a}@media print{button{display:none!important}body{padding:12px}@page{size:A4 landscape;margin:10mm}}.kpi{display:inline-block;border:1px solid #e2e8f0;border-radius:6px;padding:10px 16px;margin-right:10px;margin-bottom:10px;min-width:130px}.kpi-val{font-size:18px;font-weight:700;font-family:monospace}.kpi-lbl{font-size:10px;color:#64748b;margin-top:2px}</style>
</head><body>
<button onclick="window.print()" style="padding:6px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-bottom:16px">🖨 Print / Save PDF</button>
<div style="margin-bottom:6px;font-size:11px;color:#64748b">${projName} · Generated ${dateStr} · Period: ${weekLabel}</div>
<h1 style="font-size:20px;font-weight:800;margin:0 0 16px">NRG Actuals Report</h1>
<div style="margin-bottom:20px">
  <div class="kpi"><div class="kpi-val" style="color:#0284c7">${fmtP(totTce2)}</div><div class="kpi-lbl">TCE Value</div></div>
  <div class="kpi"><div class="kpi-val" style="color:#16a34a">${fmtP(totAct2)}</div><div class="kpi-lbl">Actuals to Date</div></div>
  <div class="kpi"><div class="kpi-val" style="color:${totColor}">${fmtP(totTce2-totAct2)}</div><div class="kpi-lbl">Remaining</div></div>
  ${totPct2 !== null ? `<div class="kpi"><div class="kpi-val" style="color:${totColor}">${Math.round(totPct2)}%</div><div class="kpi-lbl">% TCE Used</div></div>` : ''}
</div>
<table style="width:100%;border-collapse:collapse;font-size:10px">
  <thead><tr>${colHeaders.join('')}</tr></thead>
  <tbody>${rowsHTML}</tbody>
  <tfoot><tr>
    <td colspan="${footColSpan}" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">TOTAL (${displayed.length} lines)</td>
    <td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${fmtP(totAct2)}</td>
    ${weekFilter ? `<td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#dbeafe;color:#1e40af;border-top:2px solid #94a3b8">${fmtP(displayed.reduce((s,x)=>s+(x.weekActuals||0),0))}</td>` : ''}
    <td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8;color:${totColor}">${fmtP(totTce2-totAct2)}</td>
    <td style="border:1px solid #e2e8f0;padding:5px 8px;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8;font-weight:700;color:${totColor}">${totPct2!==null?Math.round(totPct2)+'%':'—'}</td>
  </tr></tfoot>
</table>
</body></html>`

    const win = window.open('', '_blank', 'width=1200,height=820')
    if (!win) { alert('Popup blocked — allow popups for this site'); return }
    win.document.write(html)
    win.document.close()
  }

  function exportCSV() {
    const header = ['Item ID', 'Source', 'Description', 'Work Order', 'Contract Scope', 'Est. Hrs', 'Act. Hrs', 'TCE Value', 'Actuals']
    if (weekFilter) header.push(`Week ${weekStart}`)
    header.push('Remaining', '% Used')
    const rows: (string|number)[][] = [header]
    displayed.forEach(({ line, actuals, tce, pct, weekActuals }) => {
      const row: (string|number)[] = [
        line.item_id || '', line.source, line.description, line.work_order || '',
        line.contract_scope || '',
        String(line.estimated_qty || ''),
        String(line.item_id && hoursByItem[line.item_id] ? hoursByItem[line.item_id].toFixed(2) : ''),
        String(tce), String(actuals),
      ]
      if (weekFilter) row.push(String(weekActuals || 0))
      row.push(String(tce - actuals), pct !== null ? pct.toFixed(1) + '%' : '—')
      rows.push(row)
    })
    const suffix = weekFilter ? `_week_${weekStart}` : ''
    downloadCSV(rows, `nrg_actuals_${activeProject?.name || 'project'}${suffix}`)
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  // Compute ungated EUR for the banner (seag rows with no covering spot rate)
  const actualsEurSummary = (() => {
    let ungatedEur = 0
    const ungatedWeeks = new Set<string>()
    for (const row of costLines) {
      if (!(row.sell_labour_eur > 0) || !row.work_date) continue
      const dt = new Date(row.work_date + 'T12:00:00')
      dt.setUTCDate(dt.getUTCDate() + (7 - dt.getUTCDay()) % 7 || 7)
      const we = dt.toISOString().slice(0, 10)
      const covering = nrgInvoices.find(i => i.week_ending! >= we)
      const r = covering?.eur_spot_rate
      if (r == null || isNaN(Number(r))) { ungatedEur += row.sell_labour_eur; ungatedWeeks.add(we) }
    }
    return { ungatedEur, ungatedWeekCount: ungatedWeeks.size }
  })()

  return (
    <>
    <div style={{ padding: '24px', maxWidth: '1600px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG Actuals</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {withActuals.length} TCE lines · {fmt(totAct)} actual of {fmt(totTce)} TCE
            {totPct !== null && <span style={{ marginLeft: '8px', color: totPct > 100 ? 'var(--red)' : totPct > 80 ? 'var(--amber)' : 'var(--green)' }}>({totPct.toFixed(0)}%)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setShowExport(true)}>📋 NRG Timesheet</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={printReport}>🖨 Print</button>
          <button className="btn btn-sm" title="Recalculate cost lines from timesheets (run after re-saving timesheets)" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {actualsEurSummary.ungatedEur > 0 && (
        <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',display:'flex',alignItems:'center',gap:'10px'}}>
          <span style={{fontSize:'18px'}}>🔴</span>
          <div>
            <div style={{fontWeight:700,fontSize:'13px',color:'#991b1b'}}>EUR costs excluded — spot rate pending</div>
            <div style={{fontSize:'12px',color:'#7f1d1d'}}>
              €{actualsEurSummary.ungatedEur.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})} SE AG labour across {actualsEurSummary.ungatedWeekCount} week{actualsEurSummary.ungatedWeekCount!==1?'s':''} is excluded from actuals. Enter the EUR spot rate on the covering invoice in the Invoicing panel to include these costs.
            </div>
          </div>
        </div>
      )}

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
          <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '10px', overflow: 'auto' }}>
            <div style={{ height: '100%', width: Math.min(100, totPct || 0) + '%', background: (totPct || 0) > 100 ? 'var(--red)' : (totPct || 0) > 80 ? 'var(--amber)' : 'var(--green)', borderRadius: '4px', transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📊</div>
          <h3>No TCE lines</h3>
          <p>Import the NRG TCE spreadsheet on the TCE Register tab first.</p>
        </div>
      ) : (
        <div>

          {/* ── Left card: Rate-driven lines ─────────────────────────────── */}
          <div className="card" style={{ padding: 0, overflow: 'auto', flex: 1 }}>
            {/* Card header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '13px' }}>Actuals</div>
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                  {withActuals.length} lines · {fmt(withActuals.reduce((s,x)=>s+x.actuals,0))} of {fmt(withActuals.reduce((s,x)=>s+x.tce,0))} TCE
                </div>
              </div>
              {/* Filters */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { key: 'all',          label: `All (${withActuals.length})` },
                  { key: 'with_actuals', label: `Has Actuals (${withActuals.filter(x=>x.actuals>0).length})` },
                  { key: 'over',         label: `Over TCE (${withActuals.filter(x=>x.pct!==null&&x.pct>100).length})` },
                  { key: 'near',         label: `Near Limit (${withActuals.filter(x=>x.pct!==null&&x.pct>80&&x.pct<=100).length})` },
                  { key: 'no_actuals',   label: `No Actuals (${withActuals.filter(x=>x.actuals===0).length})` },
                ].map(f => (
                  <button key={f.key} className="btn btn-sm"
                    style={{ fontSize: '10px', padding: '2px 6px', background: filter===f.key?'var(--accent)':'', color: filter===f.key?'#fff':'' }}
                    onClick={() => setFilter(f.key)}>{f.label}</button>
                ))}
                <div style={{ borderLeft: '1px solid var(--border)', margin: '0 2px' }} />
                {['all','overhead','skilled'].map(s => (
                  <button key={s} className="btn btn-sm"
                    style={{ fontSize: '10px', padding: '2px 6px', background: sourceFilter===s?'#6366f1':'', color: sourceFilter===s?'#fff':'' }}
                    onClick={() => setSourceFilter(s)}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
                ))}
              </div>
            </div>
            {/* Week filter row */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg3)' }}>
              <span style={{ fontSize: '11px', color: 'var(--text3)' }}>This week:</span>
              <select className="input" style={{ fontSize: '11px', padding: '2px 6px', height: '26px' }}
                value={weekFilter} onChange={e => setWeekFilter(e.target.value)}>
                <option value="">— Project to date —</option>
                {availableWeeks.map(w => {
                  const dt = new Date(w + 'T00:00:00')
                  const sun = new Date(dt); sun.setUTCDate(dt.getUTCDate()+6)
                  return <option key={w} value={w}>{dt.toLocaleDateString('en-AU',{day:'2-digit',month:'short'})} – {sun.toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'})}</option>
                })}
              </select>
            </div>
            {displayed.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>✅ No lines match this filter</div>
            ) : (
              <table style={{ fontSize: '12px', tableLayout: 'fixed', minWidth: '900px', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '80px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Item ID</th>
                      <th style={{ width: '70px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Source</th>
                      <th style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Description</th>
                      <th style={{ width: '90px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Work Order</th>
                      <th style={{ width: '90px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Contract Sc.</th>
                      <th style={{ width: '72px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Unit</th>
                      <th style={{ textAlign: 'right', width: '72px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Est. Hrs</th>
                      <th style={{ textAlign: 'right', width: '72px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Act. Hrs</th>
                      <th style={{ textAlign: 'right', width: '66px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>TCE Rate</th>
                      <th style={{ textAlign: 'right', width: '90px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>TCE</th>
                      <th style={{ textAlign: 'right', width: '80px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Committed</th>
                      <th style={{ textAlign: 'right', width: '90px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Actuals</th>
                      {weekFilter && <th style={{ textAlign: 'right', width: '80px', background: '#eff6ff', position: 'sticky', top: 0, zIndex: 10 }}>This Wk</th>}
                      <th style={{ textAlign: 'right', width: '80px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Rem.</th>
                      <th style={{ width: '28px', textAlign: 'center', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>KPI</th>
                      <th style={{ width: '110px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Progress</th>
                      <th style={{ width: '85px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Status</th>
                      <th style={{ width: '80px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>Type</th>
                      <th style={{ width: '80px', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>WBS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => {
                      if (row.kind === 'header') {
                        const { line, groupTce, groupActuals, groupWeekActuals } = row
                        const groupRem = groupTce - groupActuals
                        const TOTAL_COLS = 19 + (weekFilter ? 1 : 0)
                        return (
                          <tr key={line.id || i} style={{ background: '#e0e7ff', color: '#3730a3', borderBottom: '1px solid #c7d2fe' }}>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, paddingLeft: '10px', whiteSpace: 'nowrap' }}>
                              ▼ {line.item_id}
                            </td>
                            <td />
                            <td colSpan={2} style={{ fontWeight: 700, fontSize: '12px' }}>{line.description}</td>
                            <td colSpan={5} />
                            <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '12px' }}>{groupTce ? fmt(groupTce) : '—'}</td>
                            <td />
                            <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '12px', color: '#4f46e5' }}>{groupActuals !== 0 ? fmt(groupActuals) : '—'}</td>
                            {weekFilter && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '12px', background: '#dbeafe', color: '#1e40af' }}>{groupWeekActuals !== 0 ? fmt(groupWeekActuals) : '—'}</td>}
                            <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '12px', color: groupRem < 0 ? 'var(--red)' : '#3730a3' }}>{fmt(groupRem)}</td>
                            <td colSpan={TOTAL_COLS - 13 - (weekFilter ? 1 : 0)} />
                          </tr>
                        )
                      }
                      const { line, actuals, tce, pct, weekActuals } = row
                      const rem = tce - actuals
                      const pctNum = pct !== null ? Math.round(pct) : null
                      const barColor = pctNum === null ? 'var(--text3)' : pctNum > 100 ? 'var(--red)' : pctNum > 80 ? 'var(--amber)' : 'var(--green)'
                      const badge = statusBadge(pct, actuals > 0)
                      return (
                        <tr key={line.id}>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', paddingLeft: '20px' }}>{line.item_id || '—'}</td>
                          <td>
                            <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                              background: line.line_type === 'Fixed Price' ? '#ede9fe' : line.source === 'skilled' ? '#dbeafe' : '#f3f4f6',
                              color: line.line_type === 'Fixed Price' ? '#6b21a8' : line.source === 'skilled' ? '#1e40af' : '#64748b',
                              fontWeight: 600, textTransform: 'uppercase' as const }}>
                              {line.line_type === 'Fixed Price' ? 'Fixed Price' : line.source}
                            </span>
                          </td>
                          <td style={{ fontWeight: 500, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={line.description}>{line.description || '—'}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{line.work_order || '—'}</td>
                          <td style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {line.contract_scope ? <span style={{ background: '#ede9fe', color: '#6b21a8', borderRadius: '3px', padding: '1px 4px', fontSize: '10px' }}>{line.contract_scope}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                          </td>
                          <td style={{ fontSize: '11px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{line.unit_type || '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: '11px' }}>
                            {line.estimated_qty ? line.estimated_qty.toLocaleString('en-AU', { maximumFractionDigits: 1 }) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: line.item_id && hoursByItem[line.item_id] ? 'var(--text)' : 'var(--text3)' }}>
                            {line.item_id && hoursByItem[line.item_id] ? hoursByItem[line.item_id].toLocaleString('en-AU', { maximumFractionDigits: 1 }) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>
                            {line.tce_rate ? fmt(line.tce_rate) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmt(tce)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: lineCommitted(line.item_id) > 0 ? '#d97706' : 'var(--text3)' }}>
                            {lineCommitted(line.item_id) > 0 ? fmt(lineCommitted(line.item_id)) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: actuals > 0 ? 'var(--text)' : actuals < 0 ? 'var(--red)' : 'var(--text3)' }}>{fmt(actuals)}</td>
                          {weekFilter && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', background: '#eff6ff', color: weekActuals > 0 ? '#1e40af' : 'var(--text3)' }}>{fmt(weekActuals)}</td>}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: rem < 0 ? 'var(--red)' : 'var(--text2)' }}>{fmt(rem)}</td>
                          <td style={{ textAlign: 'center' }}>
                            {line.kpi_included ? <span style={{ fontSize: '12px' }}>✓</span> : <span style={{ color: 'var(--text3)', fontSize: '11px' }}>—</span>}
                          </td>
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
                          <td style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{line.line_type || '—'}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{line.wbs_code || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                      <td colSpan={6} style={{ padding: '8px 12px' }}>TOTAL ({displayed.length})</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--text3)', fontSize: '11px' }}>
                        {displayed.reduce((s,x) => s + (x.line.estimated_qty || 0), 0).toLocaleString('en-AU', { maximumFractionDigits: 1 })}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', fontSize: '11px' }}>
                        {displayed.reduce((s,x) => s + (x.line.item_id ? (hoursByItem[x.line.item_id] || 0) : 0), 0).toLocaleString('en-AU', { maximumFractionDigits: 1 })}
                      </td>
                      <td style={{ padding: '8px 12px' }} />
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(displayed.reduce((s,x)=>s+x.tce,0))}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: '#d97706' }}>
                        {fmt(displayed.reduce((s,x)=>s+lineCommitted(x.line.item_id),0))}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(displayed.reduce((s,x)=>s+x.actuals,0))}</td>
                      {weekFilter && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', background: '#dbeafe', color: '#1e40af' }}>{fmt(displayed.reduce((s,x)=>s+(x.weekActuals||0),0))}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: displayed.reduce((s,x)=>s+x.tce-x.actuals,0)<0?'var(--red)':'var(--text)' }}>{fmt(displayed.reduce((s,x)=>s+x.tce-x.actuals,0))}</td>
                      <td style={{ padding: '8px 12px' }} />
                      <td colSpan={3} style={{ fontSize: '11px', color: 'var(--text2)', padding: '8px 12px' }}>
                        {(() => { const t=displayed.reduce((s,x)=>s+x.tce,0); const a=displayed.reduce((s,x)=>s+x.actuals,0); return t>0?Math.round(a/t*100)+'% used':'—' })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
            )}
          </div>


        </div>
      )}
    </div>
    {showExport && <NrgTimesheetExportModal onClose={() => setShowExport(false)} />}
    </>
  )
}
