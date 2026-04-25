import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#f97316'
const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

interface HireItem { hire_type: string; name: string; vendor: string; hire_cost: number; customer_total: number; start_date: string | null; end_date: string | null }

export function HireDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [items, setItems] = useState<HireItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('hire_items')
      .select('hire_type,name,vendor,hire_cost,customer_total,start_date,end_date')
      .eq('project_id', activeProject!.id)
      .order('start_date')
    setItems((data || []) as HireItem[])
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const dry = items.filter(i => i.hire_type === 'dry')
  const wet = items.filter(i => i.hire_type === 'wet')
  const local = items.filter(i => i.hire_type === 'local')
  const active = items.filter(i => !i.end_date || i.end_date >= today)
  const returned = items.filter(i => i.end_date && i.end_date < today)
  const totalCost = items.reduce((s, i) => s + (i.hire_cost || 0), 0)
  const totalCustomer = items.reduce((s, i) => s + (i.customer_total || 0), 0)
  const gm = totalCustomer > 0 ? ((totalCustomer - totalCost) / totalCustomer * 100) : 0

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>Equipment Hire</h1>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Items', value: items.length, color: COLOR },
          { label: 'Currently Active', value: active.length, color: 'var(--green)' },
          { label: 'Total Cost', value: fmt(totalCost), color: COLOR },
          { label: 'Customer Charge', value: fmt(totalCustomer), color: 'var(--green)' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* By type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Dry Hire', icon: '🚜', items: dry, panel: 'hire-dry' },
          { label: 'Wet Hire', icon: '🏗️', items: wet, panel: 'hire-wet' },
          { label: 'Local Equipment', icon: '🧰', items: local, panel: 'hire-local' },
        ].map(t => {
          const cost = t.items.reduce((s, i) => s + (i.hire_cost || 0), 0)
          const cust = t.items.reduce((s, i) => s + (i.customer_total || 0), 0)
          return (
            <div key={t.label} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${COLOR}`, padding: '14px' }}
              onClick={() => setActivePanel(t.panel)}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>{t.icon}</div>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>{t.label}</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{t.items.length}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Items</div>
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmt(cost)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Cost</div>
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(cust)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Customer</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* GM summary */}
      {totalCustomer > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '24px', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: gm >= 15 ? 'var(--green)' : gm >= 5 ? 'var(--amber)' : 'var(--red)' }}>{gm.toFixed(1)}%</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Overall Margin</div>
          </div>
          <div style={{ flex: 1, background: 'var(--border2)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: Math.min(100, gm) + '%', background: gm >= 15 ? 'var(--green)' : 'var(--amber)', borderRadius: '4px' }} />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
            {active.length} active · {returned.length} returned
          </div>
        </div>
      )}

      {/* Active items */}
      {active.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
            Currently Active ({active.length})
          </div>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>Type</th><th>Name</th><th>Vendor</th><th>Start</th><th>End</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Customer</th></tr></thead>
            <tbody>
              {active.slice(0, 12).map((i, idx) => (
                <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => setActivePanel(`hire-${i.hire_type}`)}>
                  <td style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600 }}>{i.hire_type}</td>
                  <td style={{ fontWeight: 500 }}>{i.name || '—'}</td>
                  <td style={{ color: 'var(--text3)' }}>{i.vendor || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{i.start_date || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{i.end_date || 'Ongoing'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(i.hire_cost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(i.customer_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty-state">
          <div className="icon">🚜</div>
          <h3>No hire items yet</h3>
          <p>Add dry hire, wet hire, or local equipment to track here.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
            <button className="btn btn-sm" onClick={() => setActivePanel('hire-dry')}>+ Dry Hire</button>
            <button className="btn btn-sm" onClick={() => setActivePanel('hire-wet')}>+ Wet Hire</button>
            <button className="btn btn-sm" onClick={() => setActivePanel('hire-local')}>+ Local Equipment</button>
          </div>
        </div>
      )}
    </div>
  )
}
