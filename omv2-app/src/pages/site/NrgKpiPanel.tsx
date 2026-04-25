import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'
import type { NrgTceLine } from '../../types'

interface InvoiceRow { tce_item_id: string | null; amount: number; status: string }

function pctColor(pct: number) {
  return pct > 100 ? 'var(--red)' : pct > 85 ? 'var(--amber)' : 'var(--green)'
}

export function NrgKpiPanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<'contract_scope' | 'source' | 'work_order'>('contract_scope')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [lData, iData] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('item_id'),
      supabase.from('invoices').select('tce_item_id,amount,status').eq('project_id', pid),
    ])
    setLines((lData.data || []) as NrgTceLine[])
    setInvoices((iData.data || []) as InvoiceRow[])
    setLoading(false)
  }

  // Calculate actuals per line from invoices
  const actualsById = invoices.reduce((acc, inv) => {
    if (!inv.tce_item_id || inv.status === 'rejected') return acc
    acc[inv.tce_item_id] = (acc[inv.tce_item_id] || 0) + inv.amount
    return acc
  }, {} as Record<string, number>)

  // Filter leaf lines (not group headers)
  const leafLines = lines.filter(l => l.description && !/^\d+\.\d+\.\d+$/.test(l.item_id || ''))

  // Group lines
  function getGroupKey(line: NrgTceLine): string {
    if (groupBy === 'source') return line.source === 'skilled' ? '🔧 Skilled Labour' : '⚙️ Overheads'
    if (groupBy === 'work_order') return (line as NrgTceLine & { work_order?: string }).work_order || 'No Work Order'
    return (line as NrgTceLine & { contract_scope?: string }).contract_scope || 'Unassigned'
  }

  const groups = leafLines.reduce((acc, line) => {
    const key = getGroupKey(line)
    if (!acc[key]) acc[key] = []
    acc[key].push(line)
    return acc
  }, {} as Record<string, NrgTceLine[]>)

  const sortedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))

  // Totals
  const totalTce = leafLines.reduce((s, l) => s + (l.tce_total || 0), 0)
  const totalActuals = leafLines.reduce((s, l) => s + (actualsById[l.id] || 0), 0)
  const totalPct = totalTce > 0 ? totalActuals / totalTce * 100 : 0

  const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'
  const fmtPct = (n: number) => n.toFixed(1) + '%'

  function exportCSV() {
    const rows: (string | number)[][] = [['Group', 'Item ID', 'Description', 'Source', 'TCE Value', 'Actuals', 'Remaining', '% Used']]
    sortedGroups.forEach(([group, gLines]) => {
      gLines.forEach(l => {
        const act = actualsById[l.id] || 0
        const pct = l.tce_total > 0 ? act / l.tce_total * 100 : 0
        rows.push([group, l.item_id || '', l.description, l.source, l.tce_total || 0, act, (l.tce_total || 0) - act, pct.toFixed(1) + '%'])
      })
    })
    downloadCSV(rows, `nrg_kpi_${activeProject?.name || 'project'}`)
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1050px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG KPI Model</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {leafLines.length} TCE lines · {fmt(totalActuals)} used of {fmt(totalTce)} ({fmtPct(totalPct)})
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select className="input" style={{ width: '170px', fontSize: '12px' }} value={groupBy} onChange={e => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="contract_scope">Group by Contract Scope</option>
            <option value="source">Group by Source</option>
            <option value="work_order">Group by Work Order</option>
          </select>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
        </div>
      </div>

      {/* Overall KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'TCE Scopes', value: leafLines.length, color: 'var(--accent)' },
          { label: 'Total TCE Value', value: fmt(totalTce), color: 'var(--accent)' },
          { label: 'Actuals to Date', value: fmt(totalActuals), color: 'var(--green)' },
          { label: '% of TCE Used', value: fmtPct(totalPct), color: pctColor(totalPct) },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px 16px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '12px', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Overall progress */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 600 }}>Overall TCE Progress</span>
          <span style={{ fontFamily: 'var(--mono)', color: pctColor(totalPct) }}>{fmtPct(totalPct)}</span>
        </div>
        <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: Math.min(100, totalPct) + '%', background: pctColor(totalPct), borderRadius: '4px', transition: 'width .4s' }} />
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🏆</div>
          <h3>No TCE lines</h3>
          <p>Import the NRG TCE spreadsheet from the TCE Register tab first.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {sortedGroups.map(([group, gLines]) => {
            const gTce = gLines.reduce((s, l) => s + (l.tce_total || 0), 0)
            const gAct = gLines.reduce((s, l) => s + (actualsById[l.id] || 0), 0)
            const gPct = gTce > 0 ? gAct / gTce * 100 : 0
            const overLines = gLines.filter(l => actualsById[l.id] > (l.tce_total || 0) && l.tce_total > 0)
            return (
              <div key={group} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Group header */}
                <div style={{ padding: '10px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                    <div style={{ flex: 1, fontWeight: 700, fontSize: '13px' }}>{group}</div>
                    {overLines.length > 0 && (
                      <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '3px', background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>
                        ⚠ {overLines.length} line{overLines.length > 1 ? 's' : ''} over TCE
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: pctColor(gPct), fontWeight: 600 }}>{fmtPct(gPct)}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{fmt(gAct)} / {fmt(gTce)}</span>
                  </div>
                  <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.min(100, gPct) + '%', background: pctColor(gPct), borderRadius: '3px', transition: 'width .4s' }} />
                  </div>
                </div>
                {/* Line items */}
                <table style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '90px' }}>Item ID</th>
                      <th>Description</th>
                      <th style={{ width: '70px' }}>Source</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>TCE Value</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Actuals</th>
                      <th style={{ textAlign: 'right', width: '90px' }}>Remaining</th>
                      <th style={{ width: '120px' }}>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gLines.map(line => {
                      const act = actualsById[line.id] || 0
                      const tce = line.tce_total || 0
                      const pct = tce > 0 ? act / tce * 100 : null
                      const rem = tce - act
                      const isOver = pct !== null && pct > 100
                      return (
                        <tr key={line.id} style={{ background: isOver ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{line.item_id || '—'}</td>
                          <td style={{ fontWeight: 500, maxWidth: '220px' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.description}</div>
                          </td>
                          <td>
                            <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', background: line.source === 'skilled' ? '#dbeafe' : '#f3f4f6', color: line.source === 'skilled' ? '#1e40af' : '#64748b' }}>
                              {line.source}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmt(tce)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: act > 0 ? 'var(--text)' : 'var(--text3)' }}>{fmt(act)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: rem < 0 ? 'var(--red)' : rem === 0 ? 'var(--text3)' : 'var(--text2)' }}>
                            {tce > 0 ? fmt(rem) : '—'}
                          </td>
                          <td>
                            {pct !== null ? (
                              <div>
                                <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '5px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: pctColor(pct), borderRadius: '3px' }} />
                                </div>
                                <div style={{ fontSize: '10px', color: pctColor(pct), fontFamily: 'var(--mono)', marginTop: '2px', fontWeight: isOver ? 700 : 400 }}>
                                  {pct.toFixed(0)}%{isOver ? ' ⚠' : ''}
                                </div>
                              </div>
                            ) : <span style={{ fontSize: '11px', color: 'var(--text3)' }}>No actuals</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                      <td colSpan={3} style={{ padding: '6px 12px', fontSize: '12px' }}>Group total ({gLines.length})</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '6px 12px' }}>{fmt(gTce)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '6px 12px', color: 'var(--green)' }}>{fmt(gAct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '6px 12px', color: gTce - gAct < 0 ? 'var(--red)' : 'var(--text)' }}>{fmt(gTce - gAct)}</td>
                      <td style={{ padding: '6px 12px', fontSize: '11px', color: pctColor(gPct), fontFamily: 'var(--mono)' }}>{fmtPct(gPct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
