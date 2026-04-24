import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import type { NrgTceLine } from '../../types'

interface Invoice {
  id: string; tce_item_id: string | null; amount: number; status: string
}

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
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [linesData, invData] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('source').order('item_id'),
      supabase.from('invoices').select('id,tce_item_id,amount,status').eq('project_id', pid),
    ])
    setLines((linesData.data || []) as NrgTceLine[])
    setInvoices((invData.data || []) as Invoice[])
    setLoading(false)
  }

  // Calculate actuals per TCE line from linked invoices
  function lineActuals(line: NrgTceLine): number {
    return invoices
      .filter(inv => inv.tce_item_id === line.id && inv.status !== 'rejected')
      .reduce((s, inv) => s + (inv.amount || 0), 0)
  }

  const withActuals = lines.map(l => {
    const actuals = lineActuals(l)
    const tce = l.tce_total || 0
    const pct = tce > 0 ? (actuals / tce) * 100 : null
    return { line: l, actuals, tce, pct }
  })

  const filtered = withActuals.filter(({ actuals, pct }) => {
    if (filter === 'over') return pct !== null && pct > 100
    if (filter === 'near') return pct !== null && pct > 80 && pct <= 100
    if (filter === 'no_actuals') return actuals === 0
    return true
  })

  const totTce = withActuals.reduce((s, { tce }) => s + tce, 0)
  const totAct = withActuals.reduce((s, { actuals }) => s + actuals, 0)
  const totPct = totTce > 0 ? (totAct / totTce) * 100 : null
  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG Actuals</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {lines.length} TCE lines · {fmt(totAct)} actual of {fmt(totTce)} TCE
            {totPct !== null && <span style={{ marginLeft: '8px', color: totPct > 100 ? 'var(--red)' : totPct > 80 ? 'var(--amber)' : 'var(--green)' }}>({totPct.toFixed(0)}%)</span>}
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
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

      {/* Overall progress bar */}
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

      {/* Filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {[
          { key: 'all', label: `All (${lines.length})` },
          { key: 'over', label: `Over TCE (${withActuals.filter(x => x.pct !== null && x.pct > 100).length})` },
          { key: 'near', label: `Near Limit (${withActuals.filter(x => x.pct !== null && x.pct > 80 && x.pct <= 100).length})` },
          { key: 'no_actuals', label: `No Actuals (${withActuals.filter(x => x.actuals === 0).length})` },
        ].map(f => (
          <button key={f.key} className="btn btn-sm"
            style={{ background: filter === f.key ? 'var(--accent)' : '', color: filter === f.key ? '#fff' : '' }}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {lines.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📊</div>
          <h3>No TCE lines</h3>
          <p>Import the NRG TCE spreadsheet on the TCE Register tab first.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div className="icon">✅</div><h3>No lines match this filter</h3></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Item ID</th>
                <th>Description</th>
                <th>Source</th>
                <th style={{ textAlign: 'right' }}>TCE Value</th>
                <th style={{ textAlign: 'right' }}>Actuals</th>
                <th style={{ textAlign: 'right' }}>Remaining</th>
                <th style={{ minWidth: '120px' }}>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ line, actuals, tce, pct }) => {
                const rem = tce - actuals
                const pctNum = pct !== null ? Math.round(pct) : null
                const barColor = pctNum === null ? 'var(--text3)' : pctNum > 100 ? 'var(--red)' : pctNum > 80 ? 'var(--amber)' : 'var(--green)'
                const badge = statusBadge(pct, actuals > 0)
                return (
                  <tr key={line.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{line.item_id || '—'}</td>
                    <td style={{ fontWeight: 500, maxWidth: '220px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.description || '—'}</div>
                    </td>
                    <td>
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: line.source === 'skilled' ? '#dbeafe' : '#f3f4f6', color: line.source === 'skilled' ? '#1e40af' : '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {line.source}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>{fmt(tce)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: actuals > 0 ? 'var(--text)' : 'var(--text3)' }}>{fmt(actuals)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: rem < 0 ? 'var(--red)' : 'var(--text2)' }}>{fmt(rem)}</td>
                    <td>
                      {pctNum !== null ? (
                        <div>
                          <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: Math.min(100, pctNum) + '%', background: barColor, borderRadius: '3px', transition: 'width .3s' }} />
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
                <td colSpan={3} style={{ padding: '8px 12px', fontSize: '12px' }}>TOTAL ({filtered.length} lines)</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(filtered.reduce((s, { tce }) => s + tce, 0))}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(filtered.reduce((s, { actuals }) => s + actuals, 0))}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: filtered.reduce((s, { tce, actuals }) => s + tce - actuals, 0) < 0 ? 'var(--red)' : 'var(--text)' }}>
                  {fmt(filtered.reduce((s, { tce, actuals }) => s + tce - actuals, 0))}
                </td>
                <td colSpan={2} style={{ fontSize: '12px', color: 'var(--text2)', padding: '8px 12px' }}>
                  {totTce > 0 ? Math.round(totAct / totTce * 100) + '% of TCE used' : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
