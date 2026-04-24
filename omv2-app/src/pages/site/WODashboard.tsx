import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = 'var(--mod-wo, #7c3aed)'
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open: { bg: '#dbeafe', color: '#1e40af' },
  in_progress: { bg: '#fef3c7', color: '#92400e' },
  complete: { bg: '#d1fae5', color: '#065f46' },
  on_hold: { bg: '#f3e8ff', color: '#6b21a8' },
  cancelled: { bg: '#f1f5f9', color: '#64748b' },
}

export function WODashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [wos, setWos] = useState<{ wo_number: string; description: string; status: string; budget_hours: number | null; actual_hours: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('work_orders').select('wo_number,description,status,budget_hours,actual_hours').eq('project_id', activeProject!.id).order('wo_number')
    setWos(data || [])
    setLoading(false)
  }

  const totalPlanned = wos.reduce((s, w) => s + (w.budget_hours || 0), 0)
  const totalActual = wos.reduce((s, w) => s + (w.actual_hours || 0), 0)
  const inProgress = wos.filter(w => w.status === 'in_progress').length
  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Work Orders</h1>
        <button className="btn btn-primary" onClick={() => setActivePanel('work-orders')}>View Register →</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total WOs', value: wos.length },
          { label: 'In Progress', value: inProgress },
          { label: 'Planned Hours', value: totalPlanned.toFixed(0) + 'h' },
          { label: 'Actual Hours', value: totalActual.toFixed(1) + 'h' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '16px', borderTop: `3px solid ${COLOR}` }}>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>
      {wos.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>WO Number</th><th>Description</th><th>Status</th><th style={{ textAlign: 'right' }}>Planned</th><th style={{ textAlign: 'right' }}>Actual</th><th style={{ textAlign: 'right' }}>Variance</th><th>Progress</th></tr></thead>
            <tbody>
              {wos.map(w => {
                const planned = w.budget_hours || 0
                const actual = w.actual_hours || 0
                const pct = planned > 0 ? Math.min(100, actual / planned * 100) : 0
                const variance = actual - planned
                const ss = STATUS_STYLE[w.status] || STATUS_STYLE.open
                return (
                  <tr key={w.wo_number}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: COLOR }}>{w.wo_number}</td>
                    <td style={{ color: 'var(--text2)' }}>{w.description}</td>
                    <td><span className="badge" style={ss}>{w.status.replace('_', ' ')}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{planned.toFixed(1)}h</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--mod-hr)' }}>{actual.toFixed(1)}h</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: variance > 0 ? 'var(--amber)' : variance < 0 ? 'var(--green)' : 'var(--text3)' }}>
                      {variance === 0 ? '—' : (variance > 0 ? '+' : '') + variance.toFixed(1) + 'h'}
                    </td>
                    <td style={{ minWidth: '100px' }}>
                      <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: pct + '%', background: pct >= 100 ? 'var(--amber)' : COLOR, borderRadius: '4px', transition: 'width .3s' }} />
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: '2px' }}>{pct.toFixed(0)}%</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {wos.length === 0 && (
        <div className="empty-state"><div className="icon">📋</div><h3>No work orders yet</h3><p>Add work orders in the register to track planned vs actual hours.</p></div>
      )}
    </div>
  )
}
