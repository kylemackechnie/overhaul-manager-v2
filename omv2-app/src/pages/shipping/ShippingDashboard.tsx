import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', booked: 'Booked', in_transit: 'In Transit',
  customs: 'Customs', delivered: 'Delivered', collected: 'Collected',
}
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending: { bg: '#f1f5f9', color: '#64748b' }, booked: { bg: '#dbeafe', color: '#1e40af' },
  in_transit: { bg: '#fef3c7', color: '#92400e' }, customs: { bg: '#fee2e2', color: '#991b1b' },
  delivered: { bg: '#d1fae5', color: '#065f46' }, collected: { bg: '#d1fae5', color: '#065f46' },
}

export function ShippingDashboard() {
  const { activeProject, setActivePanel } = useAppStore()
  const [shipments, setShipments] = useState<{ id: string; direction: string; reference: string; description: string; status: string; eta: string | null; carrier: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('shipments').select('id,direction,reference,description,status,eta,carrier').eq('project_id', activeProject!.id).order('created_at', { ascending: false })
    setShipments(data || [])
    setLoading(false)
  }

  const imports = shipments.filter(s => s.direction === 'import')
  const exports = shipments.filter(s => s.direction === 'export')
  const inTransit = shipments.filter(s => s.status === 'in_transit').length
  const inCustoms = shipments.filter(s => s.status === 'customs').length
  const delivered = shipments.filter(s => s.status === 'delivered' || s.status === 'collected').length
  const recent = shipments.slice(0, 10)
  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Shipping</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Shipments', value: shipments.length, color: '#0284c7' },
          { label: 'In Transit', value: inTransit, color: 'var(--amber)' },
          { label: 'In Customs', value: inCustoms, color: 'var(--red)' },
          { label: 'Delivered', value: delivered, color: 'var(--green)' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '16px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>{t.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        <div className="card" style={{ cursor: 'pointer', padding: '16px', borderTop: '3px solid #0284c7' }} onClick={() => setActivePanel('shipping-inbound')}>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#0284c7' }}>{imports.length}</div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>📥 Inbound Shipments</div>
        </div>
        <div className="card" style={{ cursor: 'pointer', padding: '16px', borderTop: '3px solid #d97706' }} onClick={() => setActivePanel('shipping-outbound')}>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#d97706' }}>{exports.length}</div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>📤 Outbound Shipments</div>
        </div>
      </div>
      {recent.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: '13px', borderBottom: '1px solid var(--border)' }}>Recent Shipments</div>
          <table>
            <thead><tr><th></th><th>Reference</th><th>Description</th><th>Carrier</th><th>ETA</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map(s => {
                const ss = STATUS_STYLE[s.status] || STATUS_STYLE.pending
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setActivePanel(s.direction === 'export' ? 'shipping-outbound' : 'shipping-inbound')}>
                    <td style={{ fontSize: '16px' }}>{s.direction === 'export' ? '📤' : '📥'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>{s.reference || '—'}</td>
                    <td style={{ color: 'var(--text2)', fontSize: '12px' }}>{s.description || '—'}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text3)' }}>{s.carrier || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{s.eta || 'TBC'}</td>
                    <td><span className="badge" style={ss}>{STATUS_LABELS[s.status] || s.status}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {recent.length === 0 && <div className="empty-state"><div className="icon">📦</div><h3>No shipments yet</h3><p>Add inbound or outbound shipments to track them here.</p></div>}
    </div>
  )
}
