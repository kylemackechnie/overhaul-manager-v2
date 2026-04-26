/**
 * NRG Actuals Panel
 * Shows actual cost vs TCE budget per line.
 * Labour actuals: from approved TCE-mode timesheets via _nrgMatchAllocForLine.
 * Non-labour actuals: invoices + expenses + approved variations tagged to item_id.
 * 
 * CRITICAL: all matching uses item_id (text, stable), never line.id (UUID, regenerates).
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'
import { nrgLineActual, type NrgTimesheet, type NrgInvoiceMin, type NrgExpenseMin, type NrgVariationMin } from '../../engines/costEngine'
import type { NrgTceLine, RateCard } from '../../types'

function statusBadge(pct: number | null, hasActuals: boolean) {
  if (!hasActuals) return { bg: '#f3f4f6', color: '#9ca3af', label: 'No actuals' }
  if (pct === null) return { bg: '#f3f4f6', color: '#9ca3af', label: 'No TCE' }
  if (pct > 100) return { bg: '#fee2e2', color: '#991b1b', label: '⚠ Over TCE' }
  if (pct > 80) return { bg: '#fef3c7', color: '#92400e', label: 'Near limit' }
  return { bg: '#d1fae5', color: '#065f46', label: 'On track' }
}

export function NrgActualsPanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  const [timesheets, setTimesheets] = useState<NrgTimesheet[]>([])
  const [invoices, setInvoices] = useState<NrgInvoiceMin[]>([])
  const [expenses, setExpenses] = useState<NrgExpenseMin[]>([])
  const [variations, setVariations] = useState<NrgVariationMin[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [linesRes, tsRes, invRes, expRes, varRes, rcRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('item_id'),
      // Load all approved timesheets with crew (for labour actuals)
      supabase.from('weekly_timesheets').select('id,week_start,type,status,scope_tracking,regime,crew')
        .eq('project_id', pid).eq('status', 'approved'),
      // Invoices tagged to TCE lines (tce_item_id is now text item_id)
      supabase.from('invoices').select('tce_item_id,amount,status').eq('project_id', pid),
      // Expenses tagged to TCE lines
      supabase.from('expenses').select('tce_item_id,cost_ex_gst,amount').eq('project_id', pid),
      // Approved variations with tce_link
      supabase.from('variations').select('status,tce_link,sell_total').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
    ])
    setLines((linesRes.data || []) as NrgTceLine[])
    setTimesheets((tsRes.data || []) as NrgTimesheet[])
    setInvoices((invRes.data || []) as NrgInvoiceMin[])
    setExpenses((expRes.data || []) as NrgExpenseMin[])
    setVariations((varRes.data || []) as NrgVariationMin[])
    setRateCards((rcRes.data || []) as RateCard[])
    setLoading(false)
  }

  // Rate lookup — sell rate DNT for a role
  function getRateForRole(role: string): number {
    const rc = rateCards.find(r => r.role.toLowerCase() === role.toLowerCase())
    if (!rc) return 0
    const rates = rc.rates as Record<string, number>
    return rates?.sell_dnt || rates?.dnt || 0
  }

  // Skip group headers (3-segment IDs)
  const isGroupHeader = (id: string | null) => !!id && /^\d+\.\d+\.\d+$/.test(id)

  const withActuals = lines
    .filter(l => !isGroupHeader(l.item_id))
    .map(l => {
      const actuals = nrgLineActual(
        { item_id: l.item_id, source: l.source, work_order: l.work_order, line_type: l.line_type },
        timesheets, invoices, expenses, variations, getRateForRole
      )
      const tce = l.tce_total || 0
      const pct = tce > 0 ? (actuals / tce) * 100 : null
      return { line: l, actuals, tce, pct }
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
    const rows = [['Item ID', 'Source', 'Description', 'Work Order', 'Contract Scope', 'TCE Value', 'Actuals', 'Remaining', '% Used']]
    displayed.forEach(({ line, actuals, tce, pct }) => rows.push([
      line.item_id || '', line.source, line.description, line.work_order || '',
      line.contract_scope || '', String(tce), String(actuals),
      String(tce - actuals), pct !== null ? pct.toFixed(1) + '%' : '—',
    ]))
    downloadCSV(rows, `nrg_actuals_${activeProject?.name || 'project'}`)
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
            {timesheets.length > 0 && <span style={{ marginLeft: '8px', color: 'var(--text3)' }}>· {timesheets.length} approved timesheets</span>}
          </p>
        </div>
        <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'TCE Value', value: fmt(totTce), color: '#0284c7' },
          { label: 'Actuals to Date', value: fmt(totAct), color: 'var(--green)' },
          { label: 'Remaining', value: fmt(totTce - totAct), color: totTce - totAct < 0 ? 'var(--red)' : 'var(--text2)' },
          { label: '% Used', value: totPct !== null ? totPct.toFixed(1) + '%' : '—', color: totPct && totPct > 100 ? 'var(--red)' : totPct && totPct > 80 ? 'var(--amber)' : 'var(--green)' },
        ].map(t => (
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
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
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
                  <th style={{ textAlign: 'right', width: '90px' }}>Remaining</th>
                  <th style={{ width: '120px' }}>Progress</th>
                  <th style={{ width: '90px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(({ line, actuals, tce, pct }) => {
                  const rem = tce - actuals
                  const pctNum = pct !== null ? Math.round(pct) : null
                  const barColor = pctNum === null ? 'var(--text3)' : pctNum > 100 ? 'var(--red)' : pctNum > 80 ? 'var(--amber)' : 'var(--green)'
                  const badge = statusBadge(pct, actuals > 0)
                  return (
                    <tr key={line.id}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{line.item_id || '—'}</td>
                      <td>
                        <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                          background: line.source === 'skilled' ? '#dbeafe' : '#f3f4f6',
                          color: line.source === 'skilled' ? '#1e40af' : '#64748b',
                          fontWeight: 600, textTransform: 'uppercase' as const }}>
                          {line.source}
                        </span>
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
