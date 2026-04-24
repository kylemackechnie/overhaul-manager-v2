import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { HireItem, PurchaseOrder } from '../../types'

type HireType = 'dry' | 'wet' | 'local'

const TYPE_LABELS: Record<HireType, string> = { dry: 'Dry Hire', wet: 'Wet Hire', local: 'Local Hire' }
const TYPE_ICONS: Record<HireType, string> = { dry: '🚜', wet: '🏗️', local: '🧰' }

type HireForm = {
  name: string; vendor: string; description: string
  start_date: string; end_date: string
  hire_cost: number; customer_total: number; gm_pct: number
  daily_rate: number; weekly_rate: number
  currency: string; transport_in: number; transport_out: number
  linked_po_id: string; notes: string
}

const EMPTY: HireForm = {
  name: '', vendor: '', description: '',
  start_date: '', end_date: '',
  hire_cost: 0, customer_total: 0, gm_pct: 15, daily_rate: 0, weekly_rate: 0,
  currency: 'AUD', transport_in: 0, transport_out: 0,
  linked_po_id: '', notes: '',
}

function calcCustomerPrice(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}

export function HirePanel({ hireType }: { hireType: HireType }) {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<HireItem[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|HireItem>(null)
  const [form, setForm] = useState<HireForm>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, hireType])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [hireData, poData] = await Promise.all([
      supabase.from('hire_items').select('*').eq('project_id', pid).eq('hire_type', hireType).order('created_at'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status', 'cancelled').order('po_number'),
    ])
    setItems((hireData.data || []) as HireItem[])
    setPos((poData.data || []) as PurchaseOrder[])
    setLoading(false)
  }

  function openNew() { setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 }); setModal('new') }
  function openEdit(h: HireItem) {
    setForm({
      name: h.name, vendor: h.vendor, description: h.description,
      start_date: h.start_date || '', end_date: h.end_date || '',
      hire_cost: h.hire_cost, customer_total: h.customer_total, gm_pct: h.gm_pct,
      currency: h.currency, transport_in: h.transport_in, transport_out: h.transport_out,
      linked_po_id: h.linked_po_id || '', notes: h.notes,
      daily_rate: (h as {daily_rate?:number|null}).daily_rate || 0, weekly_rate: (h as {weekly_rate?:number|null}).weekly_rate || 0,
    })
    setModal(h)
  }

  function updateCost(cost: number) {
    setForm(f => ({ ...f, hire_cost: cost, customer_total: calcCustomerPrice(cost, f.gm_pct) }))
  }

  function updateGm(gm: number) {
    setForm(f => ({ ...f, gm_pct: gm, customer_total: calcCustomerPrice(f.hire_cost, gm) }))
  }

  async function save() {
    if (!form.name.trim()) return toast('Name required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, hire_type: hireType,
      name: form.name.trim(), vendor: form.vendor, description: form.description,
      start_date: form.start_date || null, end_date: form.end_date || null,
      hire_cost: form.hire_cost, customer_total: form.customer_total, gm_pct: form.gm_pct,
      daily_rate: form.daily_rate || null, weekly_rate: form.weekly_rate || null,
      currency: form.currency, transport_in: form.transport_in, transport_out: form.transport_out,
      linked_po_id: form.linked_po_id || null, notes: form.notes,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('hire_items').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast(`${TYPE_LABELS[hireType]} item added`, 'success')
    } else {
      const { error } = await supabase.from('hire_items').update(payload).eq('id', (modal as HireItem).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(h: HireItem) {
    if (!confirm(`Delete "${h.name}"?`)) return
    await supabase.from('hire_items').delete().eq('id', h.id)
    toast('Deleted', 'info'); load()
  }

  function exportCSV() {
    const rows = [['Name','Vendor','Start','End','Daily Rate','Weekly Rate','Cost','Sell','GM%']]
    items.forEach(h => rows.push([h.name, h.vendor||'', h.start_date||'', h.end_date||'',
      String(h.daily_rate||''), String(h.weekly_rate||''), String(h.hire_cost||0), String(h.customer_total||0), String(h.gm_pct||0)]))
    const csv = rows.map(r => r.map(c => c.includes(',') ? '+c+' : c).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = TYPE_LABELS[hireType].toLowerCase().replace(' ','-')+'_'+activeProject?.name+'.csv'; a.click()
  }

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })
  const totalCost = items.reduce((s, h) => s + (h.hire_cost || 0), 0)
  const totalSell = items.reduce((s, h) => s + (h.customer_total || 0), 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>{TYPE_ICONS[hireType]} {TYPE_LABELS[hireType]}</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {items.length} items · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Item</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : items.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{TYPE_ICONS[hireType]}</div>
            <h3>No {TYPE_LABELS[hireType].toLowerCase()} items</h3>
            <p>Add equipment hire records for this project.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Vendor</th><th>Start</th><th>End</th><th style={{textAlign:'right'}}>Daily</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th>PO</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(h => {
                  const po = pos.find(p => p.id === h.linked_po_id)
                  return (
                    <tr key={h.id}>
                      <td style={{ fontWeight: 500 }}>{h.name}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{h.vendor || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{h.start_date || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{h.end_date || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{(h as {daily_rate?:number|null}).daily_rate ? fmt((h as {daily_rate?:number|null}).daily_rate as number) : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(h.hire_cost || 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{fmt(h.customer_total || 0)}</td>
                      <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{po ? po.po_number || po.vendor : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(h)}>Edit</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(h)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? `Add ${TYPE_LABELS[hireType]}` : `Edit: ${(modal as HireItem).name}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Item Name</label>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={hireType === 'dry' ? 'e.g. 25T Crawler Crane' : hireType === 'wet' ? 'e.g. 50T Mobile Crane + Operator' : 'e.g. Forklift'} autoFocus />
                </div>
                <div className="fg">
                  <label>Vendor</label>
                  <input className="input" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
                </div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description of scope" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Start Date</label>
                  <input type="date" className="input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>End Date</label>
                  <input type="date" className="input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              {hireType === 'dry' && (
                <div className="fg-row">
                  <div className="fg"><label>Daily Rate</label><input type="number" className="input" value={form.daily_rate||''} onChange={e=>setForm(f=>({...f,daily_rate:parseFloat(e.target.value)||0}))} placeholder="$/day" /></div>
                  <div className="fg"><label>Weekly Rate</label><input type="number" className="input" value={form.weekly_rate||''} onChange={e=>setForm(f=>({...f,weekly_rate:parseFloat(e.target.value)||0}))} placeholder="$/week" /></div>
                </div>
              )}
              <div className="fg-row">
                <div className="fg">
                  <label>Hire Cost</label>
                  <input type="number" className="input" value={form.hire_cost || ''} onChange={e => updateCost(parseFloat(e.target.value) || 0)} placeholder="0" />
                </div>
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={form.gm_pct} onChange={e => updateGm(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg">
                  <label>Sell Price</label>
                  <input type="number" className="input" value={form.customer_total || ''} onChange={e => setForm(f => ({ ...f, customer_total: parseFloat(e.target.value) || 0 }))} placeholder="0" />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {['AUD', 'EUR', 'USD', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Transport In</label>
                  <input type="number" className="input" value={form.transport_in || ''} onChange={e => setForm(f => ({ ...f, transport_in: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="fg">
                  <label>Transport Out</label>
                  <input type="number" className="input" value={form.transport_out || ''} onChange={e => setForm(f => ({ ...f, transport_out: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="fg">
                <label>Linked PO</label>
                <select className="input" value={form.linked_po_id} onChange={e => setForm(f => ({ ...f, linked_po_id: e.target.value }))}>
                  <option value="">— No PO —</option>
                  {pos.map(po => <option key={po.id} value={po.id}>{po.po_number || '—'} {po.vendor}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as HireItem);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
