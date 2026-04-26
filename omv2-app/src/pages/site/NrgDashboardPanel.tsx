import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const NRG = '#ea580c'
const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const pctColor = (p: number) => p > 100 ? 'var(--red)' : p > 85 ? 'var(--amber)' : 'var(--green)'

export function NrgDashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [s, setS] = useState({ tce: 0, oh: 0, sl: 0, ohTotal: 0, slTotal: 0, tceTotal: 0, actuals: 0, pending: 0, wos: 0, complete: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [tceRes, invRes, expRes, varRes, woRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('tce_total,source').eq('project_id', pid),
      supabase.from('invoices').select('amount,status,tce_item_id').eq('project_id', pid),
      supabase.from('expenses').select('cost_ex_gst,amount,tce_item_id').eq('project_id', pid),
      supabase.from('variations').select('status,sell_total').eq('project_id', pid),
      supabase.from('work_orders').select('status').eq('project_id', pid),
    ])
    const tce = (tceRes.data || []) as { tce_total: number; source: string }[]
    const inv = (invRes.data || []) as { amount: number; status: string; tce_item_id: string | null }[]
    const exp = (expRes.data || []) as { cost_ex_gst: number; amount: number; tce_item_id: string | null }[]
    const vars = (varRes.data || []) as { status: string; sell_total: number }[]
    const wos = (woRes.data || []) as { status: string }[]
    const oh = tce.filter(l => l.source === 'overhead')
    const sl = tce.filter(l => l.source === 'skilled')
    const invActuals = inv.filter(i => i.tce_item_id && i.status !== 'rejected').reduce((a, i) => a + (i.amount || 0), 0)
    const expActuals = exp.filter(e => e.tce_item_id).reduce((a, e) => a + (e.cost_ex_gst || e.amount || 0), 0)
    const vnActuals = vars.filter(v => v.status === 'approved').reduce((a, v) => a + (v.sell_total || 0), 0)
    setS({
      tce: tce.length, oh: oh.length, sl: sl.length,
      ohTotal: oh.reduce((a, l) => a + (l.tce_total || 0), 0),
      slTotal: sl.reduce((a, l) => a + (l.tce_total || 0), 0),
      tceTotal: tce.reduce((a, l) => a + (l.tce_total || 0), 0),
      actuals: invActuals + expActuals + vnActuals,
      pending: inv.filter(i => i.status === 'received' || i.status === 'checked').length,
      wos: wos.length,
      complete: wos.filter(w => w.status === 'complete').length,
    })
    setLoading(false)
  }

  const pct = s.tceTotal > 0 ? s.actuals / s.tceTotal * 100 : 0

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG Gladstone</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>TCE · Invoicing · KPI tracking</p>
      </div>

      {s.pending > 0 && (
        <div style={{ padding: '10px 14px', background: '#fff7ed', borderLeft: `4px solid ${NRG}`, borderRadius: '6px', marginBottom: '14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>🧾 <strong>{s.pending} invoice{s.pending > 1 ? 's' : ''}</strong> awaiting approval</span>
          <button className="btn btn-sm" onClick={() => setActivePanel('invoices')}>Review →</button>
        </div>
      )}

      {/* TCE KPI tiles */}
      <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>TCE Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '14px' }}>
        {[
          { label: 'TCE Lines', value: s.tce, color: NRG },
          { label: 'Total TCE', value: fmt(s.tceTotal), color: NRG },
          { label: 'Actuals (invoiced)', value: fmt(s.actuals), color: 'var(--green)' },
          { label: '% TCE Used', value: pct.toFixed(1) + '%', color: pctColor(pct) },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }} onClick={() => setActivePanel('nrg-kpi')}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {s.tceTotal > 0 && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600 }}>TCE Consumption</span>
            <span style={{ fontFamily: 'var(--mono)', color: pctColor(pct), fontWeight: 600 }}>{pct.toFixed(1)}% — {fmt(s.actuals)} of {fmt(s.tceTotal)}</span>
          </div>
          <div style={{ background: 'var(--border2)', borderRadius: '5px', height: '10px', overflow: 'hidden', marginBottom: '10px' }}>
            <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: pctColor(pct), borderRadius: '5px', transition: 'width .4s' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '12px' }}>
            <div>
              <span style={{ color: 'var(--text3)' }}>Overheads ({s.oh} lines) — </span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: NRG }}>{fmt(s.ohTotal)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text3)' }}>Skilled Labour ({s.sl} lines) — </span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)' }}>{fmt(s.slTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Work Orders */}
      {s.wos > 0 && (
        <>
          <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Work Orders</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'Total WOs', value: s.wos, color: NRG, panel: 'work-orders' },
              { label: 'Complete', value: s.complete, color: 'var(--green)', panel: 'wo-dashboard' },
              { label: 'Remaining', value: s.wos - s.complete, color: 'var(--text2)', panel: 'wo-dashboard' },
            ].map(t => (
              <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }} onClick={() => setActivePanel(t.panel)}>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
                <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Quick links */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[
          { label: '📋 TCE Register', panel: 'nrg-tce' },
          { label: '🏆 KPI Model', panel: 'nrg-kpi' },
          { label: '📊 Actuals', panel: 'nrg-actuals' },
          { label: '📈 OH Forecast', panel: 'nrg-ohf' },
          { label: '🧾 Invoicing', panel: 'nrg-invoicing' },
          { label: '📥 Import TCE', panel: 'nrg-tce' },
          { label: '📋 Work Orders', panel: 'work-orders' },
        ].map(b => (
          <button key={b.panel} className="btn btn-sm" onClick={() => setActivePanel(b.panel)}>{b.label}</button>
        ))}
      </div>
    </div>
  )
}
