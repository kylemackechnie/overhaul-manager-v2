import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#7c3aed'
const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

interface RfqStat { id: string; stage: string; title: string }
interface POStat { id: string; vendor: string; po_value: number | null; status: string; quote_source: { type?: string } | null }

export function SubconDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [rfqs, setRfqs] = useState<RfqStat[]>([])
  const [pos, setPos] = useState<POStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [rfqRes, poRes] = await Promise.all([
      supabase.from('rfq_documents').select('id,stage,title').eq('project_id', pid),
      supabase.from('purchase_orders').select('id,vendor,po_value,status,quote_source').eq('project_id', pid),
    ])
    setRfqs((rfqRes.data || []) as RfqStat[])
    setPos((poRes.data || []) as POStat[])
    setLoading(false)
  }

  const awarded = rfqs.filter(r => r.stage === 'awarded' || r.stage === 'contracted').length
  const issued  = rfqs.filter(r => r.stage === 'issued').length
  // POs that came from an RFQ
  const rfqPos  = pos.filter(p => p.quote_source?.type === 'rfq')
  const totalPoValue = rfqPos.reduce((s, p) => s + (p.po_value || 0), 0)
  const activePOs = rfqPos.filter(p => p.status === 'active' || p.status === 'raised').length

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Subcontractors</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('subcon-rfq-register')}>RFQ Register →</button>
          <button className="btn btn-primary" onClick={() => setActivePanel('subcon-rfq-doc')}>+ New RFQ</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total RFQs',    value: rfqs.length,  color: COLOR,            panel: 'subcon-rfq-register' },
          { label: 'Issued',        value: issued,        color: '#3b82f6',        panel: 'subcon-rfq-register' },
          { label: 'Awarded',       value: awarded,       color: 'var(--green)',   panel: 'subcon-rfq-register' },
          { label: 'Active POs',    value: activePOs,     color: '#1e40af',        panel: 'purchase-orders' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '14px', borderTop: `3px solid ${t.color}`, cursor: 'pointer' }}
            onClick={() => setActivePanel(t.panel)}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* PO value summary */}
      {totalPoValue > 0 && (
        <div className="card" style={{ padding: '14px', borderTop: `3px solid #1e40af`, marginBottom: '16px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#1e40af' }}>{fmt(totalPoValue)}</div>
          <div style={{ fontSize: '11px', marginTop: '3px' }}>Total Subcontract PO Value (from RFQs)</div>
        </div>
      )}

      {/* Recent RFQs */}
      {rfqs.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            RFQ Documents
            <button className="btn btn-sm" style={{ fontSize: '10px' }} onClick={() => setActivePanel('subcon-rfq-register')}>View All →</button>
          </div>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>Title</th><th>Stage</th></tr></thead>
            <tbody>
              {rfqs.slice(0, 6).map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setActivePanel('subcon-rfq-register')}>
                  <td style={{ fontWeight: 500 }}>{r.title || 'Untitled'}</td>
                  <td>
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px',
                      background: r.stage === 'awarded' || r.stage === 'contracted' ? '#d1fae5' : r.stage === 'issued' ? '#dbeafe' : '#f1f5f9',
                      color: r.stage === 'awarded' || r.stage === 'contracted' ? '#065f46' : r.stage === 'issued' ? '#1e40af' : '#64748b',
                      fontWeight: 600, textTransform: 'capitalize' }}>
                      {r.stage?.replace('_', ' ') || 'draft'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <div className="icon">🤝</div>
          <h3>No RFQs yet</h3>
          <p>Create an RFQ document, send it to vendors, and track responses through to PO award.</p>
          <button className="btn btn-sm" style={{ background: COLOR, color: '#fff', marginTop: '12px' }} onClick={() => setActivePanel('subcon-rfq-doc')}>
            Create First RFQ
          </button>
        </div>
      )}
    </div>
  )
}
