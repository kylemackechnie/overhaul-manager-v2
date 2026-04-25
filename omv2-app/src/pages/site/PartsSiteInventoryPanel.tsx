import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const COLOR = '#0891b2'

interface Part {
  id: string; material_no: string; description: string
  tv_no: string; vb_no: string; location: string; box_no: string
  qty_required: number; qty_received: number; qty_issued: number
  status: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  received: { bg: '#d1fae5', color: '#065f46' },
  issued: { bg: '#e0e7ff', color: '#3730a3' },
  ordered: { bg: '#fef3c7', color: '#92400e' },
  required: { bg: '#f1f5f9', color: '#64748b' },
  not_required: { bg: '#f1f5f9', color: '#94a3b8' },
  partial: { bg: '#fef3c7', color: '#d97706' },
}

export function PartsSiteInventoryPanel() {
  const { activeProject } = useAppStore()
  const [parts, setParts] = useState<Part[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('wosit_lines')
      .select('id,material_no,description,tv_no,vb_no,location,box_no,qty_required,qty_received,qty_issued,status')
      .eq('project_id', activeProject!.id)
      .order('tv_no').order('vb_no').order('material_no')
    setParts((data || []) as Part[])
    setLoading(false)
  }

  async function recoverIssuedQtys() {
    if (!confirm('Rebuild qty_issued from the issue log? Use this if issued quantities appear incorrect.')) return
    // Re-sum issued quantities from issued_log for each wosit_line
    const { data: log } = await supabase.from('issued_log')
      .select('wosit_line_id,qty').eq('project_id', activeProject!.id)
    if (!log) return
    const sumByLine: Record<string, number> = {}
    for (const e of log) {
      if (e.wosit_line_id) sumByLine[e.wosit_line_id] = (sumByLine[e.wosit_line_id] || 0) + (e.qty || 0)
    }
    for (const [lineId, qty] of Object.entries(sumByLine)) {
      const part = parts.find(p => p.id === lineId)
      const newStatus = qty > 0 ? (qty >= (part?.qty_received || 0) ? 'issued' : 'partial') : undefined
      await supabase.from('wosit_lines').update({ qty_issued: qty, ...(newStatus ? { status: newStatus } : {}) }).eq('id', lineId)
    }
    load()
  }

  const q = search.toLowerCase()
  const filtered = parts.filter(p => {
    const matchSearch = !q || p.material_no?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q)
    const matchStatus = !statusFilter || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const totalReceived = parts.reduce((s, p) => s + (p.qty_received || 0), 0)
  const totalRemaining = parts.reduce((s, p) => s + Math.max(0, (p.qty_received || 0) - (p.qty_issued || 0)), 0)

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Site Inventory</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>All parts at this site — received stock and remaining quantities</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" style={{ color: 'var(--amber)' }} onClick={recoverIssuedQtys}>🔧 Recover Issued Qtys</button>
          <button className="btn btn-sm" onClick={() => {
            const csv = ['Location,TV,Crate,Material No,Description,Qty Received,Qty Issued,Qty Remaining,Status']
            filtered.forEach(p => csv.push([p.location, `TV${p.tv_no}`, p.vb_no, p.material_no, `"${p.description}"`, p.qty_received, p.qty_issued, Math.max(0, p.qty_received - p.qty_issued), p.status].join(',')))
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv.join('\n')], { type: 'text/csv' }))
            a.download = 'site_inventory.csv'; a.click()
          }}>⬇ Export CSV</button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Parts', value: parts.length, color: COLOR },
          { label: 'Total Received', value: totalReceived, color: 'var(--green)' },
          { label: 'Remaining in Stock', value: totalRemaining, color: 'var(--amber)' },
          { label: 'Fully Issued', value: parts.filter(p => p.status === 'issued').length, color: '#7c3aed' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <input className="input" style={{ width: '280px' }} placeholder="Search material, location, description..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: '160px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="received">In Stock</option>
          <option value="issued">Fully Issued</option>
          <option value="partial">Partially Issued</option>
          <option value="required">Required</option>
          <option value="not_required">Not Required</option>
        </select>
        <span style={{ fontSize: '12px', color: 'var(--text3)', alignSelf: 'center' }}>{filtered.length} items</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: '12px' }}>
            <thead>
              <tr>
                <th>Location</th><th>TV</th><th>Crate</th><th>Material No.</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Qty Rcvd</th>
                <th style={{ textAlign: 'right' }}>Qty Issued</th>
                <th style={{ textAlign: 'right' }}>Remaining</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const remaining = Math.max(0, (p.qty_received || 0) - (p.qty_issued || 0))
                const ss = STATUS_COLORS[p.status] || STATUS_COLORS.required
                return (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{p.location || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: COLOR }}>TV{p.tv_no}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{p.vb_no || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: COLOR, fontWeight: 600 }}>{p.material_no || '—'}</td>
                    <td style={{ color: 'var(--text)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{p.qty_received || 0}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed' }}>{p.qty_issued || 0}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: remaining === 0 ? 'var(--text3)' : 'var(--amber)' }}>{remaining}</td>
                    <td><span style={{ ...ss, fontSize: '10px', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>{p.status || 'required'}</span></td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--text3)' }}>No parts match your filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
