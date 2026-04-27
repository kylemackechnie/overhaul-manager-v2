import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { aggregateAllCostsByWbs, type WbsAggregateRow } from '../../engines/wbsAggregator'
import type { Resource, RateCard, WeeklyTimesheet, ToolingCosting, GlobalTV, GlobalDepartment,
  HireItem, Car, Accommodation, Expense, BackOfficeHour, Variation, VariationLine } from '../../types'

interface ReportRow extends WbsAggregateRow {
  code: string
  name: string
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

export function CostReportPanel() {
  const { activeProject } = useAppStore()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [missingRateCards, setMissingRateCards] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [
      wbsR, resourcesR, rateCardsR, timesheetsR,
      tcOwnedR, tcCrossR, tvsR, deptsR,
      hireR, carsR, accomR, expensesR, boR,
      varsR, varLinesR, holsR,
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
    ])

    const wbsList = (wbsR.data || []) as { code: string; name: string }[]
    const resources = (resourcesR.data || []) as Resource[]
    const rateCards = (rateCardsR.data || []) as RateCard[]
    const timesheets = (timesheetsR.data || []) as WeeklyTimesheet[]

    // Surface a warning if there are timesheets but no rate cards — otherwise labour silently
    // shows $0 because every crew member's role lookup fails.
    setMissingRateCards(timesheets.length > 0 && rateCards.length === 0)

    const agg = aggregateAllCostsByWbs({
      project: activeProject,
      resources, rateCards, timesheets,
      toolingCostings: [...(tcOwnedR.data || []), ...(tcCrossR.data || [])] as ToolingCosting[],
      globalTVs: (tvsR.data || []) as GlobalTV[],
      globalDepartments: (deptsR.data || []) as GlobalDepartment[],
      hireItems: (hireR.data || []) as HireItem[],
      cars: (carsR.data || []) as Car[],
      accommodation: (accomR.data || []) as Accommodation[],
      expenses: (expensesR.data || []) as Expense[],
      backOfficeHours: (boR.data || []) as BackOfficeHour[],
      variations: (varsR.data || []) as Variation[],
      variationLines: (varLinesR.data || []) as VariationLine[],
      publicHolidays: ((holsR.data || []) as {date:string}[]).map(h => h.date),
      activeProjectId: pid,
    })

    // Build rows: every WBS in the project list that has activity, plus any
    // unknown codes with cost data so they don't disappear.
    const knownCodes = new Set(wbsList.map(w => w.code))
    const unknownCodes = Object.keys(agg).filter(code => !knownCodes.has(code))
    const allRows: ReportRow[] = []
    for (const w of wbsList) {
      const row = agg[w.code]
      if (!row) continue
      allRows.push({ ...row, code: w.code, name: w.name })
    }
    for (const code of unknownCodes) {
      allRows.push({ ...agg[code], code, name: '⚠ Unknown WBS' })
    }
    setRows(allRows.sort((a, b) => a.code.localeCompare(b.code)))
    setLoading(false)
  }

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
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
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
          <div style={{ overflowX:'auto' }}>
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
