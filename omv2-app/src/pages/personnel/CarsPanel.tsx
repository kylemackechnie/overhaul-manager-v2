import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Car, Resource, PurchaseOrder } from '../../types'
import { downloadCSV } from '../../lib/csv'

type CarForm = {
  vehicle_type: string; rego: string; vendor: string
  person_id: string; start_date: string; end_date: string
  daily_rate: number; gm_pct: number; total_cost: number; customer_total: number
  location_fee_pct: number; one_way_fee: number
  pickup_loc: string; return_loc: string; reservation: string
  collected: boolean; dropped_off: boolean; fuel_type: string
  linked_po_id: string; notes: string
}

const EMPTY: CarForm = {
  vehicle_type:'', rego:'', vendor:'', person_id:'',
  start_date:'', end_date:'', daily_rate:0, gm_pct:15,
  total_cost:0, customer_total:0,
  location_fee_pct:0, one_way_fee:0,
  pickup_loc:'', return_loc:'', reservation:'',
  collected:false, dropped_off:false, fuel_type:'',
  linked_po_id:'', notes:'',
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0
  const d1 = new Date(a), d2 = new Date(b)
  return Math.max(0, Math.ceil((d2.getTime() - d1.getTime()) / 86400000))
}

function calcCustomerPrice(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}

export function CarsPanel() {
  const { activeProject } = useAppStore()
  const [cars, setCars] = useState<Car[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Car>(null)
  const [selCars, setSelCars] = useState<Set<string>>(new Set())
  const [bulkCarModal, setBulkCarModal] = useState(false)
  const [bulkCarForm, setBulkCarForm] = useState({ start_date:'', end_date:'' })
  const [form, setForm] = useState<CarForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [carSelected, setCarSelected] = useState<Set<string>>(new Set())
  const [carBulkModal, setCarBulkModal] = useState(false)
  const [carBulkForm, setCarBulkForm] = useState({ start_date:'', end_date:'', daily_rate:'', gm_pct:'' })

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [carData, resData, poData] = await Promise.all([
      supabase.from('cars').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status','cancelled').order('po_number'),
    ])
    setCars((carData.data || []) as Car[])
    setResources((resData.data || []) as Resource[])
    setPos((poData.data || []) as PurchaseOrder[])
    setLoading(false)
  }

  function calcCosts(f: CarForm): CarForm {
    const days = daysBetween(f.start_date, f.end_date) || 1
    const base = f.daily_rate * days
    const withFees = base * (1 + (f.location_fee_pct || 0) / 100) + (f.one_way_fee || 0)
    const total_cost = parseFloat(withFees.toFixed(2))
    const customer_total = calcCustomerPrice(total_cost, f.gm_pct)
    return { ...f, total_cost, customer_total }
  }


  async function applyBulkCarEdit() {
    const ids = [...selCars]
    const updates: Record<string,unknown> = {}
    if (bulkCarForm.start_date) updates.start_date = bulkCarForm.start_date
    if (bulkCarForm.end_date) updates.end_date = bulkCarForm.end_date
    if (!Object.keys(updates).length) return
    const { error } = await supabase.from('cars').update(updates).in('id', ids)
    if (error) { toast(error.message, 'error'); return }
    toast(`Updated ${ids.length} cars`, 'success')
    setSelCars(new Set()); setBulkCarModal(false); load()
  }

  function openNew() { setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 }); setModal('new') }
  function openEdit(c: Car) {
    const flags = ((c as unknown as Record<string, unknown>).flags as Record<string, unknown>) || {}
    setForm({
      vehicle_type: c.vehicle_type, rego: c.rego, vendor: c.vendor,
      person_id: c.person_id || '', start_date: c.start_date || '', end_date: c.end_date || '',
      daily_rate: (flags.daily_rate as number) || (c as Car & {daily_rate?:number}).daily_rate || 0,
      gm_pct: c.gm_pct, total_cost: c.total_cost, customer_total: c.customer_total,
      location_fee_pct: (c as Car & {location_fee_pct?:number}).location_fee_pct || 0,
      one_way_fee: (c as Car & {one_way_fee?:number}).one_way_fee || 0,
      pickup_loc: (c as Car & {pickup_loc?:string}).pickup_loc || '',
      return_loc: (c as Car & {return_loc?:string}).return_loc || '',
      reservation: (c as Car & {reservation?:string}).reservation || '',
      collected: !!(c as Car & {collected?:boolean}).collected,
      dropped_off: !!(c as Car & {dropped_off?:boolean}).dropped_off,
      fuel_type: (c as Car & {fuel_type?:string}).fuel_type || '',
      linked_po_id: c.linked_po_id || '', notes: c.notes,
    })
    setModal(c)
  }

  function update(field: keyof CarForm, val: string | number) {
    setForm(f => {
      const next = { ...f, [field]: val }
      if (['daily_rate','gm_pct','start_date','end_date'].includes(field)) return calcCosts(next)
      return next
    })
  }

  async function save() {
    if (!form.vendor.trim()) return toast('Vendor required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      vehicle_type: form.vehicle_type, rego: form.rego, vendor: form.vendor,
      person_id: form.person_id || null,
      start_date: form.start_date || null, end_date: form.end_date || null,
      total_cost: form.total_cost, customer_total: form.customer_total, gm_pct: form.gm_pct,
      linked_po_id: form.linked_po_id || null,
      notes: form.notes,
      flags: { daily_rate: form.daily_rate, pickup_loc: form.pickup_loc, return_loc: form.return_loc },
    }
    if (modal === 'new') {
      const { error } = await supabase.from('cars').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Car added', 'success')
    } else {
      const { error } = await supabase.from('cars').update(payload).eq('id', (modal as Car).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(c: Car) {
    if (!confirm(`Delete car hire entry?`)) return
    await supabase.from('cars').delete().eq('id', c.id)
    toast('Deleted', 'info'); load()
  }

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  function exportCSV() {
    downloadCSV(
      [
        ['Vehicle Type', 'Rego', 'Vendor', 'Start', 'End', 'Cost', 'Sell', 'Notes'],
        ...cars.map(c => [c.vehicle_type||'', c.rego||'', c.vendor||'', c.start_date||'', c.end_date||'', c.total_cost||0, c.customer_total||0, c.notes||''])
      ],
      'cars_' + (activeProject?.name || 'project')
    )
  }
  const totalCost = cars.reduce((s, c) => s + (c.total_cost || 0), 0)
  const totalSell = cars.reduce((s, c) => s + (c.customer_total || 0), 0)
  const resMap = Object.fromEntries(resources.map(r => [r.id, r.name]))

  const previewDays = daysBetween(form.start_date, form.end_date) || 1


  async function applyCarBulkEdit() {
    if (!carSelected.size) return
    const updates: Record<string,unknown> = {}
    if (carBulkForm.start_date) updates.start_date = carBulkForm.start_date
    if (carBulkForm.end_date) updates.end_date = carBulkForm.end_date
    if (carBulkForm.daily_rate) updates.daily_rate = parseFloat(carBulkForm.daily_rate)
    if (carBulkForm.gm_pct) updates.gm_pct = parseFloat(carBulkForm.gm_pct)
    if (!Object.keys(updates).length) { toast('No fields to update', 'info'); return }
    setSaving(true)
    const { error } = await supabase.from('cars').update(updates).in('id', [...carSelected])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Updated ${carSelected.size} vehicle${carSelected.size>1?'s':''}`, 'success')
    setCarBulkModal(false); setCarSelected(new Set()); setCarBulkForm({ start_date:'', end_date:'', daily_rate:'', gm_pct:'' }); load()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Car Hire</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {cars.length} vehicles · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Vehicle</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : cars.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🚗</div>
            <h3>No vehicles</h3>
            <p>Add car hire records for this project.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr><th style={{width:'32px'}}><input type="checkbox" onChange={e=>setCarSelected(e.target.checked?new Set(cars.map(c=>c.id)):new Set())} /></th>
                  <th>Type</th><th>Rego</th><th>Vendor</th><th>Person</th>
                  <th>Start</th><th>End</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cars.map(c => (
                  <tr key={c.id}>
                    <td><input type="checkbox" checked={carSelected.has(c.id)} onChange={e=>setCarSelected(s=>{const n=new Set(s);e.target.checked?n.add(c.id):n.delete(c.id);return n})} /></td>
                    <td style={{ fontWeight: 500 }}>{c.vehicle_type || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.rego || '—'}</td>
                    <td>{c.vendor || '—'}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{c.person_id ? resMap[c.person_id] || '—' : '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.start_date || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.end_date || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(c.total_cost || 0)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{fmt(c.customer_total || 0)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(c)}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(c)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add Vehicle' : 'Edit Vehicle'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Vendor</label>
                  <input className="input" value={form.vendor} onChange={e => update('vendor', e.target.value)} placeholder="e.g. Hertz, Europcar" autoFocus />
                </div>
                <div className="fg">
                  <label>Vehicle Type</label>
                  <input className="input" value={form.vehicle_type} onChange={e => update('vehicle_type', e.target.value)} placeholder="e.g. Prado, Ranger" />
                </div>
                <div className="fg">
                  <label>Rego</label>
                  <input className="input" value={form.rego} onChange={e => update('rego', e.target.value)} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Start Date</label>
                  <input type="date" className="input" value={form.start_date} onChange={e => update('start_date', e.target.value)} />
                </div>
                <div className="fg">
                  <label>End Date</label>
                  <input type="date" className="input" value={form.end_date} onChange={e => update('end_date', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Daily Rate (ex GST)</label>
                  <input type="number" className="input" value={form.daily_rate || ''} onChange={e => update('daily_rate', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              {/* Cost preview */}
              {form.daily_rate > 0 && (
                <div style={{ background: 'var(--bg3)', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div><span style={{ color: 'var(--text3)' }}>Days</span><br /><strong>{previewDays}</strong></div>
                  <div><span style={{ color: 'var(--text3)' }}>Cost</span><br /><strong>{fmt(form.total_cost)}</strong></div>
                  <div><span style={{ color: 'var(--text3)' }}>GM {form.gm_pct}%</span><br /><strong style={{ color: 'var(--green)' }}>{fmt(form.customer_total)}</strong></div>
                </div>
              )}

              <div className="fg-row">
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={form.gm_pct} onChange={e => update('gm_pct', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg" style={{ flex: 2 }}>
                  <label>Assigned To</label>
                  <select className="input" value={form.person_id} onChange={e => setForm(f => ({ ...f, person_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Pickup Location</label>
                  <input className="input" value={form.pickup_loc} onChange={e => setForm(f => ({ ...f, pickup_loc: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Return Location</label>
                  <input className="input" value={form.return_loc} onChange={e => setForm(f => ({ ...f, return_loc: e.target.value }))} />
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
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {carBulkModal && (
        <div className="modal-overlay" onClick={()=>setCarBulkModal(false)}>
          <div className="modal" style={{maxWidth:'380px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Bulk Edit {carSelected.size} Vehicle{carSelected.size>1?'s':''}</h3><button className="btn btn-sm" onClick={()=>setCarBulkModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>Leave blank to keep existing values.</p>
              <div style={{display:'grid',gap:'10px'}}>
                <div><label style={{fontSize:'11px',fontWeight:600}}>Pickup Date</label><input type="date" className="input" value={carBulkForm.start_date} onChange={e=>setCarBulkForm(f=>({...f,start_date:e.target.value}))} /></div>
                <div><label style={{fontSize:'11px',fontWeight:600}}>Return Date</label><input type="date" className="input" value={carBulkForm.end_date} onChange={e=>setCarBulkForm(f=>({...f,end_date:e.target.value}))} /></div>
                <div><label style={{fontSize:'11px',fontWeight:600}}>Daily Rate ($)</label><input type="number" className="input" value={carBulkForm.daily_rate} min={0} step={1} placeholder="— keep existing —" onChange={e=>setCarBulkForm(f=>({...f,daily_rate:e.target.value}))} /></div>
                <div><label style={{fontSize:'11px',fontWeight:600}}>GM%</label><input type="number" className="input" value={carBulkForm.gm_pct} min={0} max={99} step={0.5} placeholder="— keep existing —" onChange={e=>setCarBulkForm(f=>({...f,gm_pct:e.target.value}))} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setCarBulkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyCarBulkEdit} disabled={saving}>{saving?'Saving…':'Apply'}</button>
            </div>
          </div>
        </div>
      )}
      {bulkCarModal && (
        <div className="modal-overlay" onClick={()=>setBulkCarModal(false)}>
          <div className="modal" style={{maxWidth:'340px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Edit {selCars.size} Car Bookings</h3><button className="btn btn-sm" onClick={()=>setBulkCarModal(false)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Start Date</label><input type="date" className="input" value={bulkCarForm.start_date} onChange={e=>setBulkCarForm(f=>({...f,start_date:e.target.value}))} /></div>
              <div className="fg"><label>End Date</label><input type="date" className="input" value={bulkCarForm.end_date} onChange={e=>setBulkCarForm(f=>({...f,end_date:e.target.value}))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkCarModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyBulkCarEdit}>Apply</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
