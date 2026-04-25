import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#7c3aed'
const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

interface Contract { id: string; vendor: string; status: string; value: number | null; quoted_amount: number | null; awarded: boolean; description: string }

export function SubconDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [rfqCount, setRfqCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [cRes, rfqRes] = await Promise.all([
      supabase.from('subcon_contracts').select('id,vendor,status,value,quoted_amount,awarded,description').eq('project_id', pid).order('created_at'),
      supabase.from('rfq_documents').select('id', { count: 'exact', head: true }).eq('project_id', pid),
    ])
    setContracts((cRes.data || []) as Contract[])
    setRfqCount(rfqRes.count || 0)
    setLoading(false)
  }

  const active = contracts.filter(c => c.status === 'active' || c.status === 'approved')
  const pending = contracts.filter(c => c.status === 'draft' || c.status === 'submitted')
  const awarded = contracts.filter(c => c.awarded)
  const totalValue = contracts.reduce((s, c) => s + (c.value || 0), 0)
  const totalQuoted = contracts.reduce((s, c) => s + (c.quoted_amount || 0), 0)

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Subcontractors</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('subcon-rfq')}>📋 RFQ Register</button>
          <button className="btn btn-primary" onClick={() => setActivePanel('subcon-contracts')}>Contracts →</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Contracts', value: contracts.length, color: COLOR, panel: 'subcon-contracts' },
          { label: 'Active', value: active.length, color: 'var(--green)', panel: 'subcon-contracts' },
          { label: 'Awarded', value: awarded.length, color: 'var(--amber)', panel: 'subcon-contracts' },
          { label: 'RFQs', value: rfqCount, color: '#0891b2', panel: 'subcon-rfq' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }}
            onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Value summary */}
      {(totalValue > 0 || totalQuoted > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="card" style={{ padding: '14px', borderTop: `3px solid ${COLOR}` }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: COLOR }}>{fmt(totalValue)}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Contract Value</div>
          </div>
          {totalQuoted > 0 && (
            <div className="card" style={{ padding: '14px', borderTop: '3px solid var(--text3)' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmt(totalQuoted)}</div>
              <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Quoted (from vendors)</div>
            </div>
          )}
        </div>
      )}

      {/* Contracts list */}
      {contracts.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
            All Contracts
          </div>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>Vendor</th><th>Description</th><th>Status</th><th style={{ textAlign: 'right' }}>Contract Value</th><th style={{ textAlign: 'right' }}>Quoted</th><th>Awarded</th></tr></thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setActivePanel('subcon-contracts')}>
                  <td style={{ fontWeight: 500 }}>{c.vendor || '—'}</td>
                  <td style={{ color: 'var(--text2)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || '—'}</td>
                  <td>
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: c.status === 'active' ? '#d1fae5' : c.status === 'approved' ? '#d1fae5' : '#f1f5f9', color: c.status === 'active' || c.status === 'approved' ? '#065f46' : '#64748b', fontWeight: 600 }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: COLOR }}>{fmt(c.value || 0)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmt(c.quoted_amount || 0)}</td>
                  <td style={{ textAlign: 'center' }}>{c.awarded ? '✅' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <div className="icon">🤝</div>
          <h3>No subcontractors yet</h3>
          <p>Add contracts and RFQs to track subcontractor scope and pricing.</p>
        </div>
      )}

      {/* Pending contracts alert */}
      {pending.length > 0 && (
        <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fef3c7', borderLeft: '4px solid var(--amber)', borderRadius: '6px', fontSize: '13px' }}>
          ⚠ {pending.length} contract{pending.length > 1 ? 's' : ''} still in draft/submitted — not yet active
        </div>
      )}
    </div>
  )
}
