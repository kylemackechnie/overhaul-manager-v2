import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Shipment {
  id: string; direction: 'import' | 'export'
  reference: string; description: string
  status: string; ship_type: string
  hawb?: string; mawb?: string; eta?: string; actual_date?: string
  origin?: string; destination?: string
  agent?: string; packages?: number; weight?: number
  has_dg?: boolean; created_at: string
}

const STATUS_LABELS: Record<string, string> = {
  booked: 'Booked', in_transit: 'In Transit', customs: 'Customs',
  delivered: 'Delivered', collected: 'Collected', cancelled: 'Cancelled',
}
const STATUS_COLORS: Record<string, string> = {
  booked: 'var(--text3)', in_transit: 'var(--amber)', customs: 'var(--red)',
  delivered: 'var(--green)', collected: 'var(--green)', cancelled: 'var(--text3)',
}

export function ShippingDashboard() {
  const { activeProject } = useAppStore()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (!activeProject) return
    setLoading(true)
    supabase.from('shipments').select('*').eq('project_id', activeProject.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setShipments((data || []) as Shipment[]); setLoading(false) })
  }, [activeProject?.id])

  const imports    = shipments.filter(s => s.direction === 'import')
  const exports    = shipments.filter(s => s.direction === 'export')
  const inTransit  = shipments.filter(s => s.status === 'in_transit').length
  const inCustoms  = shipments.filter(s => s.status === 'customs').length
  const delivered  = shipments.filter(s => s.status === 'delivered' || s.status === 'collected').length
  const hasDg      = shipments.filter(s => s.has_dg).length

  const recent = [...shipments]
    .sort((a, b) => (b.eta || b.created_at || '').localeCompare(a.eta || a.created_at || ''))
    .slice(0, 10)

  if (loading) return <div className="loading-center"><span className="spinner"/> Loading shipments...</div>

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>🚢 Shipping Dashboard</h1>
      <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px' }}>Overview of all imports and exports</p>

      {/* KPIs */}
      <div className="kpi-grid" style={{ marginBottom: '20px' }}>
        {[
          { label: 'Total Shipments', val: shipments.length, color: '#0284c7' },
          { label: 'Imports',         val: imports.length,   color: '#0284c7' },
          { label: 'Exports',         val: exports.length,   color: '#d97706' },
          { label: 'In Transit',      val: inTransit,        color: 'var(--amber)' },
          { label: 'In Customs',      val: inCustoms,        color: 'var(--red)' },
          { label: 'Delivered',       val: delivered,        color: 'var(--green)' },
          { label: 'DG Shipments',    val: hasDg,            color: 'var(--red)' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTopColor: k.color }}>
            <div className="kpi-val" style={{ color: k.color }}>{k.val}</div>
            <div className="kpi-lbl">{k.label}</div>
          </div>
        ))}
      </div>

      {shipments.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🚢</div>
          <h3>No shipments yet</h3>
          <p>Add shipments via Imports or Exports in the ribbon.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: '13px', borderBottom: '1px solid var(--border)' }}>
            Recent Shipments
          </div>
          {recent.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '18px' }}>{s.direction === 'export' ? '📤' : '📥'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{s.reference || '—'} — {s.description || '—'}</span>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: s.direction === 'export' ? '#d97706' : '#0284c7', textTransform: 'uppercase' }}>
                    {s.direction}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
                  {s.hawb || s.mawb || 'No AWB'} · {s.agent || 'No agent'} · ETA {s.eta || 'TBC'}
                </div>
              </div>
              <span className="badge" style={{ fontSize: '9px', background: 'var(--bg3)', color: STATUS_COLORS[s.status] || 'var(--text3)' }}>
                {STATUS_LABELS[s.status] || s.status}
              </span>
              {s.has_dg && <span className="badge" style={{ fontSize: '9px', background: 'rgba(239,68,68,.15)', color: 'var(--red)' }}>⚠ DG</span>}
              {s.ship_type === 'tooling' && <span className="badge" style={{ fontSize: '9px', background: 'rgba(99,102,241,.15)', color: '#6366f1' }}>Tooling</span>}
              {s.ship_type === 'hardware' && <span className="badge" style={{ fontSize: '9px', background: 'rgba(6,182,212,.15)', color: '#0891b2' }}>Hardware</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
