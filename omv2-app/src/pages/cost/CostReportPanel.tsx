import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { aggregateByWbs } from '../../engines/forecastEngine'
import type { WbsCostRow } from '../../engines/forecastEngine'

const fmt = (n: number) => n ? '$' + n.toLocaleString('en-AU', { minimumFractionDigits:0, maximumFractionDigits:0 }) : '—'
const fmtPct = (n: number|null) => n != null ? n.toFixed(1) + '%' : '—'
const mgCol = (m: number|null) => m == null ? 'var(--text3)' : m >= 20 ? 'var(--green)' : m >= 10 ? 'var(--amber)' : 'var(--red)'

export function CostReportPanel() {
  const { activeProject } = useAppStore()
  const [rows, setRows] = useState<WbsCostRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [wbsData, hireData, carData, acData, tsData, rcData, boData, tcData] = await Promise.all([
      supabase.from('wbs_list').select('*').eq('project_id',pid).order('sort_order'),
      supabase.from('hire_items').select('*').eq('project_id',pid),
      supabase.from('cars').select('*').eq('project_id',pid),
      supabase.from('accommodation').select('*').eq('project_id',pid),
      supabase.from('weekly_timesheets').select('*').eq('project_id',pid),
      supabase.from('rate_cards').select('*').eq('project_id',pid),
      supabase.from('back_office_hours').select('*').eq('project_id',pid),
      supabase.from('tooling_costings').select('*').eq('project_id',pid),
    ])
    const agg = aggregateByWbs(
      wbsData.data||[], hireData.data||[], carData.data||[], acData.data||[],
      tsData.data||[], rcData.data||[], boData.data||[], tcData.data||[]
    )
    setRows(agg)
    setLoading(false)
  }

  const grandTotal = rows.reduce((s,r)=>s+r.total,0)
  const grandSell = rows.reduce((s,r)=>s+r.totalSell,0)
  const grandMargin = grandSell > 0 ? (grandSell-grandTotal)/grandSell*100 : null

  function exportCSV() {
    const lines = ['WBS Code,Description,Labour Trades,Labour Mgmt,Labour SE AG,Hire,Cars,Accommodation,Tooling,Total Cost,Total Sell,Margin %']
    rows.forEach(r => {
      lines.push([r.code,r.name,r.labourTrades,r.labourMgmt,r.labourSeag,(r as typeof r & {labourSubcon?:number}).labourSubcon||0,(r as typeof r & {backoffice?:number}).backoffice||0,r.hire,r.cars,r.accom,r.tooling,r.total,r.totalSell,r.margin?.toFixed(1)||''].join(','))
    })
    lines.push(['','TOTAL','','','','','','','',grandTotal,grandSell,grandMargin?.toFixed(1)||''].join(','))
    const blob = new Blob([lines.join('\n')], { type:'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `cost-report-${activeProject!.name.replace(/\s+/g,'-')}.csv`; a.click()
  }

  return (
    <div style={{ padding:'24px', maxWidth:'1200px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>Cost Summary Report</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>
            Cost vs Sell by WBS code
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button className="btn" onClick={load}>↻ Refresh</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn btn-primary" onClick={exportCSV}>⬇ Export CSV</button>
        </div>
      </div>

      {/* Grand totals KPIs */}
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
            <table style={{ fontSize:'12px', minWidth:'900px' }}>
              <thead>
                <tr>
                  <th>WBS Code</th>
                  <th>Description</th>
                  <th style={{ textAlign:'right' }}>Trades</th>
                  <th style={{ textAlign:'right' }}>Mgmt</th>
                  <th style={{ textAlign:'right' }}>SE AG</th>
                  <th style={{ textAlign:'right' }}>Hire</th>
                  <th style={{ textAlign:'right' }}>Cars</th>
                  <th style={{ textAlign:'right' }}>Accom</th>
                  <th style={{ textAlign:'right' }}>Tooling</th>
                  <th style={{ textAlign:'right' }}>Total Cost</th>
                  <th style={{ textAlign:'right' }}>Total Sell</th>
                  <th style={{ textAlign:'right' }}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.code}>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'11px', fontWeight:500, whiteSpace:'nowrap' }}>{r.code}</td>
                    <td style={{ color:'var(--text2)', maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</td>
                    {[r.labourTrades, r.labourMgmt, r.labourSeag, (r as typeof r & {labourSubcon?:number}).labourSubcon||0, (r as typeof r & {backoffice?:number}).backoffice||0, r.hire, r.cars, r.accom, r.tooling].map((v, i) => (
                      <td key={i} style={{ textAlign:'right', fontFamily:'var(--mono)', color: v > 0 ? undefined : 'var(--text3)' }}>{v > 0 ? fmt(v) : '—'}</td>
                    ))}
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600 }}>{fmt(r.total)}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'var(--green)' }}>{fmt(r.totalSell)}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', color:mgCol(r.margin) }}>{fmtPct(r.margin)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg3)' }}>
                  <td colSpan={2} style={{ fontWeight:700, padding:'8px 10px' }}>Grand Total</td>
                  {[
                    rows.reduce((s,r)=>s+r.labourTrades,0),
                    rows.reduce((s,r)=>s+r.labourMgmt,0),
                    rows.reduce((s,r)=>s+r.labourSeag,0),
                    rows.reduce((s,r)=>s+((r as typeof r & {labourSubcon?:number}).labourSubcon??0),0),
                    rows.reduce((s,r)=>s+((r as typeof r & {backoffice?:number}).backoffice??0),0),
                    rows.reduce((s,r)=>s+r.hire,0),
                    rows.reduce((s,r)=>s+r.cars,0),
                    rows.reduce((s,r)=>s+r.accom,0),
                    rows.reduce((s,r)=>s+r.tooling,0),
                  ].map((v, i) => (
                    <td key={i} style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, padding:'8px 10px' }}>{fmt(v)}</td>
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
