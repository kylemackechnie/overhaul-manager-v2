import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#0891b2'

interface CrateGroup { key: string; total: number; received: number; issued: number }
interface IssuedEntry { id: string; material_no: string; description: string; qty: number; issued_to: string; work_order: string; issued_at: string }

export function PartsDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ total: 0, received: 0, issued: 0, required: 0, notRequired: 0 })
  const [crateGroups, setCrateGroups] = useState<CrateGroup[]>([])
  const [recentIssues, setRecentIssues] = useState<IssuedEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [partsRes, logRes] = await Promise.all([
      supabase.from('wosit_lines').select('id,tv_no,vb_no,location,status,qty_required,qty_received,qty_issued').eq('project_id', pid),
      supabase.from('issued_log').select('id,material_no,description,qty,issued_to,work_order,issued_at').eq('project_id', pid).order('issued_at', { ascending: false }).limit(10),
    ])

    const parts = (partsRes.data || []) as { id: string; tv_no: string; vb_no: string; location: string; status: string; qty_required: number; qty_received: number; qty_issued: number }[]

    // Aggregate stats
    setStats({
      total: parts.length,
      received: parts.filter(p => p.status === 'received' || p.status === 'issued').length,
      issued: parts.reduce((s, p) => s + (p.qty_issued || 0), 0),
      required: parts.filter(p => p.status === 'required' || p.status === 'ordered').length,
      notRequired: parts.filter(p => p.status === 'not_required').length,
    })

    // Group by TV + Crate
    const crateMap: Record<string, CrateGroup> = {}
    for (const p of parts) {
      const key = `TV${p.tv_no}${p.vb_no ? ` — ${p.vb_no}` : ''}${p.location ? ` / ${p.location}` : ''}`
      if (!crateMap[key]) crateMap[key] = { key, total: 0, received: 0, issued: 0 }
      crateMap[key].total++
      if (p.status === 'received' || p.status === 'issued') crateMap[key].received++
      if (p.status === 'issued') crateMap[key].issued++
    }
    setCrateGroups(Object.values(crateMap).sort((a, b) => a.key.localeCompare(b.key)))
    setRecentIssues((logRes.data || []) as IssuedEntry[])
    setLoading(false)
  }

  const pct = stats.total > 0 ? Math.round(stats.received / stats.total * 100) : 0
  const pctColor = (p: number) => p >= 100 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--text3)'

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Spare Parts</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{stats.total} parts tracked</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('parts-import')}>📥 Import WOSIT</button>
          <button className="btn btn-primary" onClick={() => setActivePanel('parts-list')}>View Parts List →</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Parts', value: stats.total, color: COLOR, panel: 'parts-list' },
          { label: 'Received', value: stats.received, color: 'var(--green)', panel: 'parts-receiving' },
          { label: 'Required', value: stats.required, color: 'var(--amber)', panel: 'parts-list' },
          { label: 'Issued (qty)', value: stats.issued, color: '#7c3aed', panel: 'parts-issue' },
          { label: 'Not Required', value: stats.notRequired, color: 'var(--text3)', panel: 'parts-list' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }}
            onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Overall progress */}
      {stats.total > 0 && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600 }}>Overall Receiving Progress</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: pctColor(pct) }}>{pct}%</span>
          </div>
          <div style={{ background: 'var(--border2)', borderRadius: '5px', height: '10px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: pctColor(pct), borderRadius: '5px', transition: 'width .4s' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: crateGroups.length > 0 ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* TV/Crate breakdown */}
        {crateGroups.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
              By TV / Crate
            </div>
            <table style={{ fontSize: '12px' }}>
              <thead><tr><th>TV / Crate</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Rcvd</th><th style={{ textAlign: 'right' }}>Pend</th><th style={{ width: '80px' }}>Progress</th></tr></thead>
              <tbody>
                {crateGroups.map(g => {
                  const p = g.total > 0 ? Math.round(g.received / g.total * 100) : 0
                  return (
                    <tr key={g.key}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.key}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{g.total}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{g.received}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{g.total - g.received}</td>
                      <td>
                        <div style={{ background: 'var(--border2)', borderRadius: '3px', height: '5px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: p + '%', background: pctColor(p), borderRadius: '3px' }} />
                        </div>
                        <div style={{ fontSize: '9px', color: pctColor(p), fontFamily: 'var(--mono)', marginTop: '2px' }}>{p}%</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent issues */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Recent Issues</span>
            <button className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 8px' }} onClick={() => setActivePanel('parts-issue')}>View all →</button>
          </div>
          {recentIssues.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>No parts issued yet</div>
          ) : (
            <table style={{ fontSize: '12px' }}>
              <thead><tr><th>Material No</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th>To</th><th>When</th></tr></thead>
              <tbody>
                {recentIssues.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: COLOR }}>{e.material_no || '—'}</td>
                    <td style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: '#7c3aed' }}>{e.qty}</td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{e.issued_to || e.work_order || '—'}</td>
                    <td style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                      {e.issued_at ? new Date(e.issued_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
