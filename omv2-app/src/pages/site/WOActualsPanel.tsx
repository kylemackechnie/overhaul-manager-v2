import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface ActualRow {
  wo_number: string
  person_name: string
  person_role: string
  week_start: string
  date: string
  hours: number
}

interface WOSummary {
  wo_number: string
  description: string
  budget_hours: number | null
  status: string
  total_hours: number
  people: Record<string, number>
  weeks: Record<string, number>
}

export function WOActualsPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [summaries, setSummaries] = useState<WOSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [woRes, actualsRes] = await Promise.all([
      supabase.from('work_orders').select('wo_number,description,status,budget_hours').eq('project_id', pid).order('wo_number'),
      supabase.from('wo_actuals').select('wo_number,person_name,person_role,week_start,date,hours').eq('project_id', pid),
    ])

    const wos = (woRes.data || []) as { wo_number: string; description: string; status: string; budget_hours: number | null }[]
    const actuals = (actualsRes.data || []) as ActualRow[]

    // Group actuals by WO
    const byWo: Record<string, ActualRow[]> = {}
    for (const a of actuals) {
      if (!byWo[a.wo_number]) byWo[a.wo_number] = []
      byWo[a.wo_number].push(a)
    }

    const results: WOSummary[] = wos.map(wo => {
      const rows = byWo[wo.wo_number] || []
      const people: Record<string, number> = {}
      const weeks: Record<string, number> = {}
      let total = 0
      for (const r of rows) {
        people[r.person_name] = (people[r.person_name] || 0) + r.hours
        const wk = r.week_start
        weeks[wk] = (weeks[wk] || 0) + r.hours
        total += r.hours
      }
      return { ...wo, total_hours: total, people, weeks }
    })

    // Include WOs that only exist in actuals (no WO record)
    const knownWoNums = new Set(wos.map(w => w.wo_number))
    for (const [wo_number, rows] of Object.entries(byWo)) {
      if (knownWoNums.has(wo_number)) continue
      const people: Record<string, number> = {}
      const weeks: Record<string, number> = {}
      let total = 0
      for (const r of rows) {
        people[r.person_name] = (people[r.person_name] || 0) + r.hours
        weeks[r.week_start] = (weeks[r.week_start] || 0) + r.hours
        total += r.hours
      }
      results.push({ wo_number, description: '—', status: 'open', budget_hours: null, total_hours: total, people, weeks })
    }

    setSummaries(results.sort((a, b) => a.wo_number.localeCompare(b.wo_number)))
    setLoading(false)
  }

  const totalActual = summaries.reduce((s, w) => s + w.total_hours, 0)
  const totalBudget = summaries.reduce((s, w) => s + (w.budget_hours || 0), 0)
  const pct = totalBudget > 0 ? totalActual / totalBudget * 100 : 0

  const fmtPct = (actual: number, budget: number | null) => {
    if (!budget) return null
    const p = actual / budget * 100
    return { pct: p, color: p > 100 ? 'var(--red)' : p > 80 ? 'var(--amber)' : 'var(--green)' }
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Work Order Actuals</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            Hours allocated from timesheets · {summaries.length} WOs · {totalActual.toFixed(1)}h total
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('work-orders')}>← WO Register</button>
          <button className="btn btn-sm" onClick={() => setActivePanel('wo-dashboard')}>WO Dashboard</button>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Actual Hours', value: totalActual.toFixed(1) + 'h', color: '#7c3aed' },
          { label: 'Budget Hours', value: totalBudget > 0 ? totalBudget.toFixed(0) + 'h' : '—', color: 'var(--text2)' },
          { label: '% Budget Used', value: totalBudget > 0 ? pct.toFixed(1) + '%' : '—', color: pct > 100 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)' },
          { label: 'WOs with Actuals', value: summaries.filter(w => w.total_hours > 0).length, color: '#7c3aed' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {summaries.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>No WO actuals yet</h3>
          <p>Allocate hours to work orders using the 📋 button in timesheet cells, then save the timesheet.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>WO</th>
                <th>Description</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Budget h</th>
                <th style={{ textAlign: 'right' }}>Actual h</th>
                <th style={{ width: '120px' }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(w => {
                const prog = fmtPct(w.total_hours, w.budget_hours)
                const isExp = expanded.has(w.wo_number)
                const hasPeople = Object.keys(w.people).length > 0
                return <>
                  <tr key={w.wo_number}
                    style={{ background: isExp ? 'rgba(124,58,237,0.04)' : 'transparent', cursor: hasPeople ? 'pointer' : 'default' }}
                    onClick={() => hasPeople && setExpanded(s => { const ns = new Set(s); ns.has(w.wo_number) ? ns.delete(w.wo_number) : ns.add(w.wo_number); return ns })}>
                    <td style={{ width: '20px', color: 'var(--text3)', fontSize: '10px' }}>{hasPeople ? (isExp ? '▼' : '▶') : ''}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: '#7c3aed' }}>{w.wo_number}</td>
                    <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description || '—'}</td>
                    <td>
                      <span className="badge" style={w.status === 'complete' ? { bg: '#d1fae5', color: '#065f46' } : w.status === 'in_progress' ? { bg: '#fef3c7', color: '#92400e' } : { bg: '#dbeafe', color: '#1e40af' } as { bg: string; color: string }}>
                        {w.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{w.budget_hours ? w.budget_hours.toFixed(0) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: w.total_hours > 0 ? 600 : 400, color: '#7c3aed' }}>
                      {w.total_hours > 0 ? w.total_hours.toFixed(1) : '—'}
                    </td>
                    <td>
                      {prog ? (
                        <>
                          <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '5px', overflow: 'hidden', marginBottom: '2px' }}>
                            <div style={{ height: '100%', width: Math.min(100, prog.pct) + '%', background: prog.color, borderRadius: '3px' }} />
                          </div>
                          <div style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: prog.color }}>{prog.pct.toFixed(0)}%</div>
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                  {isExp && Object.entries(w.people).sort((a, b) => b[1] - a[1]).map(([name, hrs]) => (
                    <tr key={name} style={{ background: 'rgba(124,58,237,0.02)' }}>
                      <td />
                      <td />
                      <td style={{ fontSize: '11px', color: 'var(--text3)', paddingLeft: '20px' }}>└ {name}</td>
                      <td />
                      <td />
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)' }}>{hrs.toFixed(1)}h</td>
                      <td />
                    </tr>
                  ))}
                </>
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                <td colSpan={4} style={{ padding: '8px 12px' }}>Total</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--text3)' }}>{totalBudget > 0 ? totalBudget.toFixed(0) : '—'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: '#7c3aed' }}>{totalActual.toFixed(1)}h</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
