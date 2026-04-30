import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { aggregateAllCostsByWbs, type WbsAggregateRow, type SeSupportEntry } from '../../engines/wbsAggregator'
import type { Resource, RateCard, WeeklyTimesheet, ToolingCosting, GlobalTV, GlobalDepartment,
  HireItem, Car, Accommodation, Expense, BackOfficeHour, Variation, VariationLine } from '../../types'

interface ReportRow extends WbsAggregateRow {
  code: string
  name: string
}

interface CostLineLite {
  category: string; wbs: string
  cost_labour: number; sell_labour: number
  cost_allowances: number; sell_allowances: number
  person_name?: string; work_date?: string
}

interface ReportInputs {
  wbsList: { code: string; name: string }[]
  resources: Resource[]
  rateCards: RateCard[]
  timesheets: WeeklyTimesheet[]
  costLines: CostLineLite[]
  toolingOwn: ToolingCosting[]
  toolingCross: ToolingCosting[]
  tvs: GlobalTV[]
  depts: GlobalDepartment[]
  hire: HireItem[]
  cars: Car[]
  accom: Accommodation[]
  expenses: Expense[]
  bo: BackOfficeHour[]
  seSupport: SeSupportEntry[]
  variations: Variation[]
  variationLines: VariationLine[]
  publicHolidays: string[]
}

const fmt = (n: number) => n ? '$' + n.toLocaleString('en-AU', { minimumFractionDigits:0, maximumFractionDigits:0 }) : '—'
const fmtPct = (n: number|null) => n != null ? n.toFixed(1) + '%' : '—'
const mgCol = (m: number|null) => m == null ? 'var(--text3)' : m >= 20 ? 'var(--green)' : m >= 10 ? 'var(--amber)' : 'var(--red)'

// Column definitions — single source of truth used by the table, CSV, and print.
const COLUMNS: { key: keyof WbsAggregateRow; label: string; short: string }[] = [
  { key: 'labourTrades', label: 'Trades Labour',     short: 'Trades' },
  { key: 'labourMgmt',   label: 'Management Labour', short: 'Mgmt' },
  { key: 'labourSeag',   label: 'SE AG Labour',      short: 'SE AG' },
  { key: 'labourSubcon', label: 'Subcon Labour',     short: 'Subcon' },
  { key: 'backoffice',   label: 'Back Office Hours', short: 'Back Office' },
  { key: 'hire',         label: 'Equipment Hire',    short: 'Hire' },
  { key: 'cars',         label: 'Car Hire',          short: 'Cars' },
  { key: 'accom',        label: 'Accommodation',     short: 'Accom' },
  { key: 'tooling',      label: 'Rental Tooling',    short: 'Tooling' },
  { key: 'expenses',     label: 'Expenses',          short: 'Expenses' },
  { key: 'variations',   label: 'Variations',        short: 'Variations' },
]

// ── Date-window helpers ───────────────────────────────────────────────────
function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0
  const d1 = new Date(a + 'T00:00:00').getTime()
  const d2 = new Date(b + 'T00:00:00').getTime()
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1)
}

function clampWindow(itemStart: string | null, itemEnd: string | null, weekStart: string, weekEnd: string): { from: string; to: string; ratio: number } | null {
  if (!itemStart) return null
  const end = itemEnd || itemStart
  const from = itemStart > weekStart ? itemStart : weekStart
  const to   = end < weekEnd ? end : weekEnd
  if (from > to) return null
  const totalDays = daysBetween(itemStart, end)
  const windowDays = daysBetween(from, to)
  if (totalDays <= 0) return null
  return { from, to, ratio: windowDays / totalDays }
}

/** Pro-rate a project-wide aggregator input set to a given Mon-Sun window.
 *  Date-stamped records (cost lines, expenses, BO, variations) are filtered
 *  to the window. Date-range records (hire, cars, accom, tooling) are
 *  scaled by days-in-window. Metadata (wbs_list, rate_cards, resources,
 *  timesheets) is passed through untouched. */
function applyWeekWindow(input: ReportInputs, weekStart: string, weekEnd: string): ReportInputs {
  const inWindow = (d: string | null | undefined): boolean =>
    !!d && d >= weekStart && d <= weekEnd

  // Hire / cars / accom: pro-rate cost & sell by overlap ratio
  const scaledHire = input.hire.flatMap(h => {
    const w = clampWindow(h.start_date || null, h.end_date || null, weekStart, weekEnd)
    if (!w) return []
    return [{ ...h,
      hire_cost: (h.hire_cost || 0) * w.ratio,
      customer_total: (h.customer_total || 0) * w.ratio,
    }]
  })
  const scaledCars = input.cars.flatMap(c => {
    const w = clampWindow(c.start_date || null, c.end_date || null, weekStart, weekEnd)
    if (!w) return []
    return [{ ...c,
      total_cost: (c.total_cost || 0) * w.ratio,
      customer_total: (c.customer_total || 0) * w.ratio,
    }]
  })
  const scaledAccom = input.accom.flatMap(a => {
    const w = clampWindow(a.check_in || null, a.check_out || null, weekStart, weekEnd)
    if (!w) return []
    return [{ ...a,
      total_cost: (a.total_cost || 0) * w.ratio,
      customer_total: (a.customer_total || 0) * w.ratio,
    }]
  })
  // Tooling: clamp charge_start / charge_end so calcRentalCost gives the slice
  const scaledTooling = (tcs: ToolingCosting[]): ToolingCosting[] =>
    tcs.flatMap(tc => {
      if (!tc.charge_start || !tc.charge_end) return []
      const w = clampWindow(tc.charge_start, tc.charge_end, weekStart, weekEnd)
      if (!w) return []
      return [{ ...tc, charge_start: w.from, charge_end: w.to }]
    })

  return {
    ...input,
    costLines: input.costLines.filter(cl => inWindow(cl.work_date)),
    expenses: input.expenses.filter(e => inWindow(e.date)),
    bo: input.bo.filter(b => inWindow(b.date)),
    seSupport: input.seSupport.filter(s => inWindow(s.date)),
    // Variations are point-in-time; only include those approved within the window.
    variations: input.variations.filter(v => v.status === 'approved' && inWindow(v.approved_date)),
    hire: scaledHire,
    cars: scaledCars,
    accom: scaledAccom,
    toolingOwn: scaledTooling(input.toolingOwn),
    toolingCross: scaledTooling(input.toolingCross),
  }
}

export function CostReportPanel() {
  const { activeProject } = useAppStore()
  const [inputs, setInputs] = useState<ReportInputs | null>(null)
  const [loading, setLoading] = useState(true)
  const [missingRateCards, setMissingRateCards] = useState(false)
  /** Selected week (Monday). Empty = "Project to date". */
  const [weekFilter, setWeekFilter] = useState<string>('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [
      wbsR, resourcesR, rateCardsR, timesheetsR,
      tcOwnedR, tcCrossR, tvsR, deptsR,
      hireR, carsR, accomR, expensesR, boR,
      varsR, varLinesR, holsR, costLinesR, seR,
    ] = await Promise.all([
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('weekly_timesheets').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').neq('project_id', pid)
        .filter('splits', 'cs', `[{"projectId":"${pid}"}]`),
      supabase.from('global_tvs').select('*'),
      supabase.from('global_departments').select('*'),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('expenses').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('variations').select('*').eq('project_id', pid),
      supabase.from('variation_lines').select('*').eq('project_id', pid),
      supabase.from('public_holidays').select('date').eq('project_id', pid),
      supabase.from('timesheet_cost_lines')
        .select('category,wbs,cost_labour,sell_labour,cost_allowances,sell_allowances,person_name,work_date')
        .eq('project_id', pid),
      // SE AG support / mob costs
      supabase.from('se_support_costs')
        .select('wbs,amount,sell_price,currency,person,description,date')
        .eq('project_id', pid),
    ])

    const timesheets = (timesheetsR.data || []) as WeeklyTimesheet[]
    const rateCards = (rateCardsR.data || []) as RateCard[]
    setMissingRateCards(timesheets.length > 0 && rateCards.length === 0)

    setInputs({
      wbsList: (wbsR.data || []) as { code: string; name: string }[],
      resources: (resourcesR.data || []) as Resource[],
      rateCards, timesheets,
      costLines: (costLinesR.data || []) as CostLineLite[],
      toolingOwn: (tcOwnedR.data || []) as ToolingCosting[],
      toolingCross: (tcCrossR.data || []) as ToolingCosting[],
      tvs: (tvsR.data || []) as GlobalTV[],
      depts: (deptsR.data || []) as GlobalDepartment[],
      hire: (hireR.data || []) as HireItem[],
      cars: (carsR.data || []) as Car[],
      accom: (accomR.data || []) as Accommodation[],
      expenses: (expensesR.data || []) as Expense[],
      bo: (boR.data || []) as BackOfficeHour[],
      seSupport: (seR.data || []) as SeSupportEntry[],
      variations: (varsR.data || []) as Variation[],
      variationLines: (varLinesR.data || []) as VariationLine[],
      publicHolidays: ((holsR.data || []) as { date: string }[]).map(h => h.date),
    })
    setLoading(false)
  }

  // Available weeks — derived from any cost-line activity, expense dates, BO dates,
  // and date-range items overlapping the project.
  const availableWeeks = useMemo(() => {
    if (!inputs) return [] as string[]
    const monday = (d: string): string => {
      const dt = new Date(d + 'T00:00:00')
      const dow = dt.getUTCDay()
      const offset = dow === 0 ? 6 : dow - 1
      dt.setUTCDate(dt.getUTCDate() - offset)
      return dt.toISOString().slice(0, 10)
    }
    const set = new Set<string>()
    inputs.costLines.forEach(cl => { if (cl.work_date) set.add(monday(cl.work_date)) })
    inputs.expenses.forEach(e => { if (e.date) set.add(monday(e.date)) })
    inputs.bo.forEach(b => { if (b.date) set.add(monday(b.date)) })
    inputs.variations.forEach(v => { if (v.approved_date) set.add(monday(v.approved_date)) })
    return [...set].sort().reverse()
  }, [inputs])

  // Weekly window = selected Monday to following Sunday
  const weekEnd = useMemo(() => {
    if (!weekFilter) return ''
    const dt = new Date(weekFilter + 'T00:00:00')
    dt.setUTCDate(dt.getUTCDate() + 6)
    return dt.toISOString().slice(0, 10)
  }, [weekFilter])

  // Rows derived from inputs + week filter. Pro-rates date-range items and
  // filters date-stamped sources to the window when weekFilter is set.
  const rows = useMemo<ReportRow[]>(() => {
    if (!inputs || !activeProject) return []
    const sliced = weekFilter ? applyWeekWindow(inputs, weekFilter, weekEnd) : inputs
    const agg = aggregateAllCostsByWbs({
      project: activeProject,
      resources: sliced.resources,
      rateCards: sliced.rateCards,
      timesheets: sliced.timesheets,
      timesheetCostLines: sliced.costLines as Parameters<typeof aggregateAllCostsByWbs>[0]['timesheetCostLines'],
      toolingCostings: [...sliced.toolingOwn, ...sliced.toolingCross],
      globalTVs: sliced.tvs,
      globalDepartments: sliced.depts,
      hireItems: sliced.hire,
      cars: sliced.cars,
      accommodation: sliced.accom,
      expenses: sliced.expenses,
      backOfficeHours: sliced.bo,
      seSupport: sliced.seSupport,
      variations: sliced.variations,
      variationLines: sliced.variationLines,
      publicHolidays: sliced.publicHolidays,
      activeProjectId: activeProject.id,
    })
    const knownCodes = new Set(sliced.wbsList.map(w => w.code))
    const unknownCodes = Object.keys(agg).filter(code => !knownCodes.has(code))
    const allRows: ReportRow[] = []
    for (const w of sliced.wbsList) {
      const row = agg[w.code]
      if (!row) continue
      allRows.push({ ...row, code: w.code, name: w.name })
    }
    for (const code of unknownCodes) {
      allRows.push({ ...agg[code], code, name: '⚠ Unknown WBS' })
    }
    return allRows.sort((a, b) => a.code.localeCompare(b.code))
  }, [inputs, weekFilter, weekEnd, activeProject])

  const grandTotal = rows.reduce((s,r) => s + r.total, 0)
  const grandSell = rows.reduce((s,r) => s + r.totalSell, 0)
  const grandMargin = grandSell > 0 ? (grandSell - grandTotal) / grandSell * 100 : null

  function printByModule() {
    const projectName = activeProject?.name || 'Project'
    const sections = COLUMNS.map(c => {
      const rs = rows.filter(r => (r[c.key] as number) > 0)
      if (!rs.length) return ''
      const total = rs.reduce((s, r) => s + (r[c.key] as number), 0)
      return `<div class="section"><div class="section-title">${c.label}</div>
        <table><thead><tr><th>WBS</th><th>Description</th><th style="text-align:right">Cost</th></tr></thead>
        <tbody>${rs.map(r => `<tr><td class="mono">${r.code}</td><td>${r.name}</td><td class="num">${fmt(r[c.key] as number)}</td></tr>`).join('')}
        <tr class="total"><td colspan="2">Total</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`
    }).filter(Boolean).join('')
    const html = `<!DOCTYPE html><html><head><title>${projectName} — Cost by Module</title>
    <style>body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:20px}
    h1{font-size:16px;margin-bottom:4px}p{color:#64748b;font-size:10px;margin-bottom:20px}
    .section{margin-bottom:20px}.section-title{font-size:13px;font-weight:700;padding:6px 0;border-bottom:2px solid #6366f1;margin-bottom:6px;color:#6366f1}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{background:#f8fafc;padding:5px 8px;text-align:left;font-size:10px;border-bottom:1px solid #e2e8f0}
    td{padding:4px 8px;border-bottom:1px solid #f1f5f9}
    .num{text-align:right;font-family:monospace}.mono{font-family:monospace;font-size:10px}
    .total td{font-weight:700;background:#f8fafc;border-top:1px solid #e2e8f0}
    @media print{@page{size:A4;margin:15mm}}</style></head>
    <body><h1>${projectName} — Cost Summary by Module</h1>
    <p>Printed ${new Date().toLocaleDateString('en-AU')} · Total Cost ${fmt(grandTotal)} · Total Sell ${fmt(grandSell)}</p>
    ${sections}<script>setTimeout(()=>window.print(),300)<\/script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function exportCSV() {
    const header = ['WBS Code', 'Description', ...COLUMNS.map(c => c.short), 'Total Cost', 'Total Sell', 'Margin %']
    const lines = [header.join(',')]
    rows.forEach(r => {
      const cells = [
        r.code, r.name,
        ...COLUMNS.map(c => Math.round(r[c.key] as number)),
        Math.round(r.total), Math.round(r.totalSell),
        r.margin != null ? r.margin.toFixed(1) : '',
      ]
      lines.push(cells.join(','))
    })
    lines.push([
      '', 'TOTAL',
      ...COLUMNS.map(c => Math.round(rows.reduce((s, r) => s + (r[c.key] as number), 0))),
      Math.round(grandTotal), Math.round(grandSell),
      grandMargin != null ? grandMargin.toFixed(1) : '',
    ].join(','))
    const blob = new Blob([lines.join('\n')], { type:'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cost-report-${activeProject!.name.replace(/\s+/g,'-')}.csv`
    a.click()
  }

  return (
    <div style={{ padding:'24px', maxWidth:'1400px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>Cost Summary Report</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>
            Cost vs Sell by WBS code
            {weekFilter && (
              <span style={{ marginLeft:'8px', padding:'2px 8px', background:'#dbeafe', color:'#1e40af', borderRadius:'10px', fontSize:'11px', fontWeight:600 }}>
                Week of {weekFilter} → {weekEnd}
              </span>
            )}
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
          {/* Week filter — selects a single Mon-Sun snapshot. Pro-rates date-range
              items (hire/cars/accom/tooling) by days in window; date-stamped
              sources (timesheets, expenses, BO, variations) are filtered. */}
          <span style={{ fontSize:'11px', color:'var(--text3)' }}>View:</span>
          <select className="input" style={{ fontSize:'12px', padding:'3px 6px', height:'30px' }}
            value={weekFilter} onChange={e => setWeekFilter(e.target.value)}>
            <option value="">Project to date</option>
            {availableWeeks.map(w => {
              const dt = new Date(w + 'T00:00:00')
              const sun = new Date(dt); sun.setUTCDate(dt.getUTCDate() + 6)
              const lbl = `${dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })} – ${sun.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}`
              return <option key={w} value={w}>{lbl}</option>
            })}
          </select>
          <button className="btn" onClick={load}>↻ Refresh</button>
          <button className="btn btn-sm" onClick={printByModule} disabled={rows.length===0}>🖨 Print by Module</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print by WBS</button>
          <button className="btn btn-primary" onClick={exportCSV}>⬇ Export CSV</button>
        </div>
      </div>

      {missingRateCards && (
        <div style={{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', borderRadius:'var(--radius)', padding:'10px 14px', marginBottom:'14px', fontSize:'12px', color:'var(--orange)', fontWeight:500 }}>
          ⚠ Timesheets exist but no rate cards are configured for this project. Labour costs will show as $0 until rate cards are set up under Personnel → Rate Cards.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="kpi-grid" style={{ marginBottom:'20px' }}>
          <div className="kpi-card" style={{ borderTopColor:'#f472b6' }}>
            <div className="kpi-val" style={{ color:'#f472b6' }}>{fmt(grandTotal)}</div>
            <div className="kpi-lbl">Total Cost</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor:'var(--green)' }}>
            <div className="kpi-val" style={{ color:'var(--green)' }}>{fmt(grandSell)}</div>
            <div className="kpi-lbl">Total Sell</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor:mgCol(grandMargin) }}>
            <div className="kpi-val" style={{ color:mgCol(grandMargin) }}>{fmt(grandSell-grandTotal)}</div>
            <div className="kpi-lbl">Gross Margin</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor:mgCol(grandMargin) }}>
            <div className="kpi-val" style={{ color:mgCol(grandMargin) }}>{fmtPct(grandMargin)}</div>
            <div className="kpi-lbl">Margin %</div>
          </div>
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner"/> Calculating...</div>
      : rows.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📑</div>
          <h3>No WBS data</h3>
          <p>Add WBS codes and assign them to resources, timesheets, and hire items to generate the report.</p>
        </div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div className="table-scroll-x">
            <table style={{ fontSize:'12px', minWidth:'1200px' }}>
              <thead>
                <tr>
                  <th>WBS Code</th>
                  <th>Description</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} style={{ textAlign:'right' }}>{c.short}</th>
                  ))}
                  <th style={{ textAlign:'right' }}>Total Cost</th>
                  <th style={{ textAlign:'right' }}>Total Sell</th>
                  <th style={{ textAlign:'right' }}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.code}>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'11px', fontWeight:500, whiteSpace:'nowrap' }}>{r.code}</td>
                    <td style={{ color:'var(--text2)', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</td>
                    {COLUMNS.map(c => {
                      const v = r[c.key] as number
                      return (
                        <td key={c.key} style={{ textAlign:'right', fontFamily:'var(--mono)', color: v > 0 ? undefined : 'var(--text3)' }}>{v > 0 ? fmt(v) : '—'}</td>
                      )
                    })}
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600 }}>{fmt(r.total)}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'var(--green)' }}>{fmt(r.totalSell)}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', color:mgCol(r.margin) }}>{fmtPct(r.margin)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg3)' }}>
                  <td colSpan={2} style={{ fontWeight:700, padding:'8px 10px' }}>Grand Total</td>
                  {COLUMNS.map(c => (
                    <td key={c.key} style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, padding:'8px 10px' }}>
                      {fmt(rows.reduce((s, r) => s + (r[c.key] as number), 0))}
                    </td>
                  ))}
                  <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:700, padding:'8px 10px' }}>{fmt(grandTotal)}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:700, color:'var(--green)', padding:'8px 10px' }}>{fmt(grandSell)}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:700, color:mgCol(grandMargin), padding:'8px 10px' }}>{fmtPct(grandMargin)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
