import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#0891b2'

interface InventoryItem {
  id: string
  wosit_line_id: string | null
  tv_no: string | null
  crate_no: string | null
  vb_no: string | null
  box_no: string | null
  location: string | null
  material_no: string | null
  install_location: string | null
  description: string | null
  qty_delivered: number
  qty_remaining: number
  qty_issued: number
  received_at: string
}

export function PartsSiteInventoryPanel() {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('site_inventory')
      .select('*')
      .eq('project_id', activeProject!.id)
      .order('tv_no').order('material_no')
    if (error) console.error('site_inventory load error:', error)
    setItems((data || []) as InventoryItem[])
    setLoading(false)
  }

  const getStatus = (item: InventoryItem) => {
    if (item.qty_issued >= item.qty_delivered) return 'issued'
    if (item.qty_issued > 0) return 'partial'
    return 'in_stock'
  }

  const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
    in_stock: { bg: '#d1fae5', color: '#065f46', label: 'In Stock' },
    partial:  { bg: '#fef3c7', color: '#d97706', label: 'Partial' },
    issued:   { bg: '#e0e7ff', color: '#3730a3', label: 'Issued' },
  }

  const q = search.toLowerCase()
  const filtered = items.filter(p => {
    const matchSearch = !q
      || (p.material_no || '').toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
      || (p.location || '').toLowerCase().includes(q)
      || (p.tv_no || '').toLowerCase().includes(q)
    const st = getStatus(p)
    const matchStatus = !statusFilter || st === statusFilter
    return matchSearch && matchStatus
  })

  const totalDelivered  = items.reduce((s, p) => s + (p.qty_delivered || 0), 0)
  const totalRemaining  = items.reduce((s, p) => s + (p.qty_remaining || 0), 0)
  const totalIssued     = items.filter(p => getStatus(p) === 'issued').length

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Site Inventory</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>All parts at this site — received stock and remaining quantities</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" style={{ color: 'var(--amber)' }} onClick={load}>↻ Refresh</button>
          <button className="btn btn-sm" onClick={() => {
            const csv = ['Location,TV,Crate,Box,Material No,Description,Qty Received,Qty Issued,Remaining,Received At']
            filtered.forEach(p => csv.push([
              `"${p.location||''}"`, `TV${p.tv_no||''}`, p.crate_no||'', p.box_no||'',
              p.material_no||'', `"${p.description||''}"`,
              p.qty_delivered, p.qty_issued, p.qty_remaining,
              p.received_at?.slice(0,10) || '',
            ].join(',')))
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([csv.join('\n')], { type: 'text/csv' }))
            a.download = 'site_inventory.csv'; a.click()
          }}>⬇ Export CSV</button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Parts', value: items.length, color: COLOR },
          { label: 'Total Received', value: totalDelivered, color: 'var(--green)' },
          { label: 'Remaining in Stock', value: totalRemaining, color: 'var(--amber)' },
          { label: 'Fully Issued', value: totalIssued, color: '#7c3aed' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <input className="input" style={{ width: '280px' }} placeholder="Search material, location, description..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: '160px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="in_stock">In Stock</option>
          <option value="partial">Partially Issued</option>
          <option value="issued">Fully Issued</option>
        </select>
        <span style={{ fontSize: '12px', color: 'var(--text3)', alignSelf: 'center' }}>{filtered.length} items</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-scroll-x">
          <table style={{ fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>Location</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>TV</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Crate</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Box</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Material No.</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Description</th>
                <th style={{ padding: '8px', textAlign: 'right', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Qty Rcvd</th>
                <th style={{ padding: '8px', textAlign: 'right', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Qty Issued</th>
                <th style={{ padding: '8px', textAlign: 'right', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Remaining</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', letterSpacing: '.05em' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const st = getStatus(p)
                const sc = STATUS_COLORS[st]
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--accent)' }}>{p.location || '—'}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--mono)', fontSize: '11px', color: COLOR }}>TV{p.tv_no}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.crate_no || '—'}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center' }}>{p.box_no || '—'}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--mono)', fontSize: '11px', color: COLOR, fontWeight: 600 }}>{p.material_no || '—'}</td>
                    <td style={{ padding: '7px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{p.qty_delivered}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed' }}>{p.qty_issued || 0}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: p.qty_remaining === 0 ? 'var(--text3)' : 'var(--amber)' }}>{p.qty_remaining}</td>
                    <td style={{ padding: '7px 8px' }}>
                      <span style={{ ...sc, fontSize: '10px', padding: '2px 6px', borderRadius: '3px', fontWeight: 600 }}>{sc.label}</span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: 'var(--text3)' }}>
                  {items.length === 0
                    ? 'No parts received yet — use Parts Receiving to receive WOSIT parts into inventory.'
                    : 'No parts match your filter'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

