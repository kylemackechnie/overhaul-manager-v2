import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#7c3aed'

interface WO { wo_number: string; description: string; status: string; budget_hours: number | null; wbs_code: string | null }
interface Actual { wo_number: string; hours: number; date: string | null }

const STATUS_ORDER = ['in_progress', 'open', 'on_hold', 'complete', 'cancelled']
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In Progress', on_hold: 'On Hold', complete: 'Complete', cancelled: 'Cancelled' }
const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  open: { bg: '#dbeafe', color: '#1e40af' },
  in_progress: { bg: '#fef3c7', color: '#92400e' },
  on_hold: { bg: '#f3e8ff', color: '#6b21a8' },
  complete: { bg: '#d1fae5', color: '#065f46' },
  cancelled: { bg: '#f1f5f9', color: '#64748b' },
}

export function WOProgressPanel() {
  const { activeProject } = useAppStore()
  const [wos, setWos] = useState<WO[]>([])
  const [actuals, setActuals] = useState<Actual[]>([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<'status' | 'wbs'>('status')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const [woRes, actRes] = await Promise.all([
      supabase.from('work_orders').select('wo_number,description,status,budget_hours,wbs_code').eq('project_id', activeProject!.id).order('wo_number'),
      supabase.from('wo_actuals').select('wo_number,hours,date').eq('project_id', activeProject!.id),
    ])
    setWos((woRes.data || []) as WO[])
    setActuals((actRes.data || []) as Actual[])
    setLoading(false)
  }

  const actualsByWo: Record<string, number> = {}
  for (const a of actuals) {
    if (a.wo_number) actualsByWo[a.wo_number] = (actualsByWo[a.wo_number] || 0) + (a.hours || 0)
  }

  const totalBudget = wos.reduce((s, w) => s + (w.budget_hours || 0), 0)
  const totalActual = wos.reduce((s, w) => s + (actualsByWo[w.wo_number] || 0), 0)
  const complete = wos.filter(w => w.status === 'complete').length
  const inProg = wos.filter(w => w.status === 'in_progress').length

  // Group by status or WBS
  const groups: { title: string; wos: WO[] }[] = []
  if (groupBy === 'status') {
    for (const s of STATUS_ORDER) {
      const g = wos.filter(w => w.status === s)
      if (g.length) groups.push({ title: STATUS_LABEL[s] || s, wos: g })
    }
  } else {
    const wbsMap: Record<string, WO[]> = {}
    for (const w of wos) {
      const k = w.wbs_code || 'No WBS'
      if (!wbsMap[k]) wbsMap[k] = []
      wbsMap[k].push(w)
    }
    for (const [k, g] of Object.entries(wbsMap).sort()) {
      groups.push({ title: k, wos: g })
    }
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>WO Progress Report</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select className="input" style={{ width: '140px' }} value={groupBy} onChange={e => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="status">Group by Status</option>
            <option value="wbs">Group by WBS</option>
          </select>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total WOs', value: wos.length, color: COLOR },
          { label: 'In Progress', value: inProg, color: '#d97706' },
          { label: 'Complete', value: complete, color: 'var(--green)' },
          { label: 'Budget Hours', value: totalBudget.toFixed(0) + 'h', color: COLOR },
          { label: 'Actual Hours', value: totalActual.toFixed(1) + 'h', color: totalActual > totalBudget ? 'var(--red)' : 'var(--green)' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Overall progress bar */}
      {totalBudget > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600 }}>Overall Progress</span>
            <span style={{ fontFamily: 'var(--mono)', color: COLOR }}>{totalActual.toFixed(1)}h of {totalBudget.toFixed(0)}h — {totalBudget > 0 ? Math.round(totalActual / totalBudget * 100) : 0}%</span>
          </div>
          <div style={{ background: 'var(--border2)', borderRadius: '5px', height: '10px', overflow: 'hidden', marginBottom: '6px' }}>
            <div style={{ height: '100%', width: Math.min(100, totalBudget > 0 ? totalActual / totalBudget * 100 : 0) + '%', background: totalActual > totalBudget ? 'var(--red)' : COLOR, borderRadius: '5px', transition: 'width .4s' }} />
          </div>
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text3)' }}>
            {[
              { label: 'Complete', count: complete, color: 'var(--green)' },
              { label: 'In Progress', count: inProg, color: '#d97706' },
              { label: 'Open', count: wos.filter(w => w.status === 'open').length, color: '#1e40af' },
              { label: 'On Hold', count: wos.filter(w => w.status === 'on_hold').length, color: '#6b21a8' },
            ].map(s => s.count > 0 && (
              <span key={s.label} style={{ color: s.color, fontWeight: 600 }}>{s.count} {s.label}</span>
            ))}
          </div>
        </div>
      )}

      {/* Grouped WO list */}
      {groups.map(g => (
        <div key={g.title} style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            {g.title} ({g.wos.length})
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ fontSize: '12px' }}>
              <thead>
                <tr>
                  <th>WO Number</th><th>Description</th><th>Status</th>
                  <th style={{ textAlign: 'right' }}>Budget</th>
                  <th style={{ textAlign: 'right' }}>Actual</th>
                  <th style={{ textAlign: 'right' }}>Variance</th>
                  <th style={{ width: '120px' }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {g.wos.map(w => {
                  const budget = w.budget_hours || 0
                  const actual = actualsByWo[w.wo_number] || 0
                  const pct = budget > 0 ? Math.min(100, actual / budget * 100) : 0
                  const variance = actual - budget
                  const ss = STATUS_COLOR[w.status] || STATUS_COLOR.open
                  return (
                    <tr key={w.wo_number}>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: COLOR }}>{w.wo_number}</td>
                      <td style={{ color: 'var(--text2)' }}>{w.description}</td>
                      <td><span className="badge" style={ss}>{STATUS_LABEL[w.status] || w.status}</span></td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{budget > 0 ? budget.toFixed(0) + 'h' : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--mod-hr)' }}>{actual > 0 ? actual.toFixed(1) + 'h' : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: variance > 0 ? 'var(--amber)' : variance < 0 ? 'var(--green)' : 'var(--text3)' }}>
                        {variance !== 0 && budget > 0 ? (variance > 0 ? '+' : '') + variance.toFixed(1) + 'h' : '—'}
                      </td>
                      <td>
                        {budget > 0 ? (
                          <>
                            <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: pct + '%', background: pct >= 100 ? 'var(--amber)' : COLOR, borderRadius: '4px' }} />
                            </div>
                            <div style={{ fontSize: '9px', color: 'var(--text3)', marginTop: '2px', fontFamily: 'var(--mono)' }}>{pct.toFixed(0)}%</div>
                          </>
                        ) : <span style={{ fontSize: '10px', color: 'var(--text3)' }}>No budget</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {wos.length === 0 && (
        <div className="empty-state"><div className="icon">📊</div><h3>No work orders yet</h3><p>Add work orders in the register to track progress here.</p></div>
      )}
    </div>
  )
}
