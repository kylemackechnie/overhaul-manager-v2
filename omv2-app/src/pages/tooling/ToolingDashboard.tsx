import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { calcRentalCost } from '../../lib/calculations'

const COLOR = '#0891b2'
const fmtEUR = (n: number) => n > 0 ? '€' + Math.round(n).toLocaleString('en-AU') : '—'

interface TV { tv_no: string; header_name: string | null; department_id: string | null; replacement_value_eur: number | null }
interface Costing {
  tv_no: string
  charge_start: string | null; charge_end: string | null
  cost_eur: number | null; sell_eur: number | null   // legacy snapshot — only used as fallback
  sell_override_eur: number | null
  notes: string | null
}
interface Dept { id: string; name: string; rates: Record<string, unknown> }

function tourStatus(c: Costing | undefined) {
  if (!c) return { label: 'No costing', icon: '⚪', tag: 'gray' }
  if (c.charge_start && c.charge_end) return { label: 'Charge set', icon: '✅', tag: 'green' }
  if (c.charge_start) return { label: 'Start only', icon: '🟡', tag: 'amber' }
  return { label: 'Dates needed', icon: '🔴', tag: 'red' }
}

export function ToolingDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [tvs, setTvs] = useState<TV[]>([])
  const [costings, setCostings] = useState<Costing[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [kolloCount, setKolloCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [tvRes, costRes, deptRes, kolloRes] = await Promise.all([
      supabase.from('global_tvs').select('tv_no,header_name,department_id,replacement_value_eur')
        .in('tv_no', (await supabase.from('project_tvs').select('tv_no').eq('project_id', pid).eq('tv_type','tooling')).data?.map(r => r.tv_no) || [])
        .order('tv_no'),
      supabase.from('tooling_costings').select('tv_no,charge_start,charge_end,cost_eur,sell_eur,sell_override_eur,notes').eq('project_id', pid),
      supabase.from('global_departments').select('id,name,rates'),
      supabase.from('project_kollos').select('id', { count: 'exact', head: true }).eq('project_id', pid),
    ])
    setTvs((tvRes.data || []) as TV[])
    setCostings((costRes.data || []) as Costing[])
    setDepts((deptRes.data || []) as Dept[])
    setKolloCount(kolloRes.count || 0)
    setLoading(false)
  }

  // Live recompute — costings.cost_eur / sell_eur are no longer the source of truth.
  // Fall back to the snapshot only when the costing isn't fully configured (no dates, no replVal).
  const liveByTv = (() => {
    const map: Record<string, { cost: number; sell: number }> = {}
    for (const c of costings) {
      const tv = tvs.find(t => t.tv_no === c.tv_no)
      const dept = tv?.department_id ? depts.find(d => d.id === tv.department_id) : null
      const replVal = Number(tv?.replacement_value_eur || 0)
      if (dept && c.charge_start && c.charge_end && replVal > 0) {
        const rates = dept.rates || {}
        const calc = calcRentalCost(replVal, {
          charge_start: c.charge_start,
          charge_end: c.charge_end,
          sell_override_eur: c.sell_override_eur ?? null,
        }, {
          rental_pct: Number(rates.rentalPct || 0),
          rate_unit: ((rates.rateUnit as string) || 'weekly') as 'weekly'|'daily'|'monthly',
          gm_pct: Number(rates.gmPct || 0),
        })
        if (calc) {
          map[c.tv_no] = { cost: calc.cost, sell: calc.sell }
          continue
        }
      }
      map[c.tv_no] = { cost: c.cost_eur || 0, sell: c.sell_eur || 0 }
    }
    return map
  })()

  const totalCost = Object.values(liveByTv).reduce((s, v) => s + v.cost, 0)
  const totalSell = Object.values(liveByTv).reduce((s, v) => s + v.sell, 0)
  const tvDays = costings.reduce((s, c) => {
    if (!c.charge_start || !c.charge_end) return s
    return s + Math.max(0, Math.ceil((new Date(c.charge_end).getTime() - new Date(c.charge_start).getTime()) / 86400000) + 1)
  }, 0)
  const awaitingDates = tvs.filter(tv => {
    const c = costings.find(c => c.tv_no === tv.tv_no)
    return !c?.charge_start || !c?.charge_end
  }).length
  const gm = totalSell > 0 ? ((totalSell - totalCost) / totalSell * 100) : 0

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 707, marginBottom: '16px' }}>SE Rental Tooling</h1>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'TVs on Project', value: tvs.length, color: COLOR, panel: 'tooling-tvs' },
          { label: 'Kollos / Packages', value: kolloCount, color: '#7c3aed', panel: 'tooling-kollos' },
          { label: 'Total TV Days', value: tvDays > 0 ? tvDays + 'd' : '—', color: COLOR, panel: 'tooling-costings' },
          { label: 'Awaiting Dates', value: awaitingDates, color: awaitingDates > 0 ? 'var(--amber)' : 'var(--green)', panel: 'tooling-costings' },
          { label: 'Gross Margin', value: gm > 0 ? gm.toFixed(1) + '%' : '—', color: gm >= 15 ? 'var(--green)' : gm > 0 ? 'var(--amber)' : 'var(--text3)', panel: 'tooling-costings' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }} onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Cost / Sell summary */}
      {totalCost > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="card" style={{ padding: '14px', borderTop: `3px solid ${COLOR}` }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{fmtEUR(totalCost)}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Cost (EUR)</div>
          </div>
          <div className="card" style={{ padding: '14px', borderTop: '3px solid var(--green)' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmtEUR(totalSell)}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Sell (EUR)</div>
          </div>
          <div className="card" style={{ padding: '14px', borderTop: `3px solid ${gm >= 15 ? 'var(--green)' : 'var(--amber)'}` }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: gm >= 15 ? 'var(--green)' : 'var(--amber)' }}>{gm > 0 ? gm.toFixed(1) + '%' : '—'}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>Gross Margin</div>
          </div>
        </div>
      )}

      {/* TV table — matching HTML */}
      {tvs.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
            Project TV Register
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th>TV No.</th><th>Header Name</th><th>Department</th>
                  <th style={{ textAlign: 'right' }}>Repl. Value</th>
                  <th>Kollos</th>
                  <th>Charge Start</th><th>Charge End</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                </tr>
              </thead>
              <tbody>
                {tvs.map(tv => {
                  const c = costings.find(x => x.tv_no === tv.tv_no)
                  const dept = depts.find(d => d.id === tv.department_id)
                  const ts = tourStatus(c)
                  const tsColors: Record<string, string> = { green: '#d1fae5', amber: '#fef3c7', red: '#fee2e2', gray: '#f1f5f9' }
                  const tsTextColors: Record<string, string> = { green: '#065f46', amber: '#92400e', red: '#991b1b', gray: '#64748b' }
                  return (
                    <tr key={tv.tv_no} style={{ cursor: 'pointer' }} onClick={() => setActivePanel('tooling-tvs')}>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: COLOR }}>TV{tv.tv_no}</td>
                      <td style={{ color: 'var(--text)' }}>{tv.header_name || <em style={{ color: 'var(--text3)' }}>unnamed</em>}</td>
                      <td>{dept ? <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: '#e0e7ff', color: '#3730a3', fontWeight: 600 }}>{dept.name}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{tv.replacement_value_eur ? fmtEUR(tv.replacement_value_eur) : '—'}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text3)' }}>—</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c?.charge_start || <span style={{ color: 'var(--amber)' }}>not set</span>}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c?.charge_end || <span style={{ color: 'var(--amber)' }}>not set</span>}</td>
                      <td>
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', background: tsColors[ts.tag], color: tsTextColors[ts.tag], fontWeight: 600 }}>
                          {ts.icon} {ts.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{liveByTv[c?.tv_no || '']?.cost ? fmtEUR(liveByTv[c!.tv_no].cost) : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{liveByTv[c?.tv_no || '']?.sell ? fmtEUR(liveByTv[c!.tv_no].sell) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[
          { label: '📋 TV Register', panel: 'tooling-tvs' },
          { label: '📦 Kollos', panel: 'tooling-kollos' },
          { label: '💶 Costings', panel: 'tooling-costings' },
          { label: '🏢 Departments', panel: 'tooling-departments' },
          { label: '📊 Reports', panel: 'tooling-reports' },
        ].map(b => <button key={b.panel} className="btn btn-sm" onClick={() => setActivePanel(b.panel)}>{b.label}</button>)}
      </div>

      {tvs.length === 0 && (
        <div className="empty-state" style={{ marginTop: '24px' }}>
          <div className="icon">🔩</div>
          <h3>No tooling assigned yet</h3>
          <p>Add TVs from the global register, import WOSIT/Kollo sheets, and enter charge dates for costing.</p>
        </div>
      )}
    </div>
  )
}
