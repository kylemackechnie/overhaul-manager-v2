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
  total_km: number
  wbs: string
  linked_po_id: string; notes: string
}

const EMPTY: CarForm = {
  vehicle_type:'', rego:'', vendor:'', person_id:'',
  start_date:'', end_date:'', daily_rate:0, gm_pct:15,
  total_cost:0, customer_total:0,
  location_fee_pct:0, one_way_fee:0,
  pickup_loc:'', return_loc:'', reservation:'',
  collected:false, dropped_off:false, fuel_type:'',
  total_km:0, wbs:'',
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
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [carData, resData, poData, wbsRes] = await Promise.all([
      supabase.from('cars').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('resources').select('id,name,role,mob_in,mob_out').eq('project_id', pid).order('name'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status','cancelled').order('po_number'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
    ])
    setCars((carData.data || []) as Car[])
    setResources((resData.data || []) as Resource[])
    setPos((poData.data || []) as PurchaseOrder[])
    setWbsList((wbsRes.data || []) as { id: string; code: string; name: string }[])
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
      daily_rate: (flags.daily_rate as number) || c.daily_rate || 0,
      gm_pct: c.gm_pct, total_cost: c.total_cost, customer_total: c.customer_total,
      location_fee_pct: c.location_fee_pct || 0,
      one_way_fee: c.one_way_fee || 0,
      pickup_loc: c.pickup_loc || '',
      return_loc: c.return_loc || '',
      reservation: c.reservation || '',
      collected: !!c.collected,
      dropped_off: !!c.dropped_off,
      fuel_type: c.fuel_type || '',
      total_km: c.total_km || 0,
      wbs: c.wbs || '',
      linked_po_id: c.linked_po_id || '', notes: c.notes,
    })
    setModal(c)
  }

  function update(field: keyof CarForm, val: string | number | boolean) {
    setForm(f => {
      const next = { ...f, [field]: val } as CarForm
      // Re-run cost calc whenever any input that feeds it changes.
      if (['daily_rate','gm_pct','start_date','end_date','location_fee_pct','one_way_fee'].includes(field)) {
        return calcCosts(next)
      }
      return next
    })
  }

  async function save() {
    if (!form.vendor.trim()) return toast('Vendor required', 'error')
    if (!form.vehicle_type.trim()) return toast('Vehicle type required', 'error')
    setSaving(true)
    // NOT NULL text columns get '' when empty (matches DB defaults). The
    // `field || null` idiom coerces empty string to null and breaks the
    // constraint — same trap fixed in HirePanel.
    const payload = {
      project_id: activeProject!.id,
      vendor: form.vendor.trim(),
      vehicle_type: form.vehicle_type.trim(),
      rego: form.rego || '',
      person_id: form.person_id || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      daily_rate: form.daily_rate || 0,
      gm_pct: form.gm_pct || 0,
      total_cost: form.total_cost || 0,
      customer_total: form.customer_total || 0,
      location_fee_pct: form.location_fee_pct || 0,
      one_way_fee: form.one_way_fee || 0,
      pickup_loc: form.pickup_loc || '',
      return_loc: form.return_loc || '',
      reservation: form.reservation || '',
      collected: !!form.collected,
      dropped_off: !!form.dropped_off,
      fuel_type: form.fuel_type || '',
      total_km: form.total_km || 0,
      wbs: form.wbs || '',
      linked_po_id: form.linked_po_id || null,
      notes: form.notes || '',
    }
    if (modal === 'new') {
      const { error } = await supabase.from('cars').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Vehicle added', 'success')
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
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '720px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🚗 {modal === 'new' ? 'Add Vehicle' : 'Edit Vehicle'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Vendor / Vehicle Type */}
              <div className="fg-row">
                <div className="fg">
                  <label>Vendor *</label>
                  <input className="input" value={form.vendor} onChange={e => update('vendor', e.target.value)} placeholder="Hertz, Avis, Europcar..." autoFocus />
                </div>
                <div className="fg">
                  <label>Vehicle Type *</label>
                  <input className="input" value={form.vehicle_type} onChange={e => update('vehicle_type', e.target.value)} placeholder="Toyota HiLux, Corolla..." />
                </div>
              </div>

              {/* Rego / Assigned To */}
              <div className="fg-row">
                <div className="fg">
                  <label>Rego / Asset No.</label>
                  <input className="input" value={form.rego} onChange={e => update('rego', e.target.value)} placeholder="ABC123" />
                </div>
                <div className="fg">
                  <label>Assigned To</label>
                  <select className="input" value={form.person_id} onChange={e => setForm(f => ({ ...f, person_id: e.target.value }))}>
                    <option value="">— Unassigned —</option>
                    {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Pickup / Return Date */}
              <div className="fg-row">
                <div className="fg">
                  <label>Pickup Date *</label>
                  <input type="date" className="input" value={form.start_date} onChange={e => update('start_date', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Return Date</label>
                  <input type="date" className="input" value={form.end_date} onChange={e => update('end_date', e.target.value)} />
                  {form.person_id && (() => {
                    const person = resources.find(r => r.id === form.person_id)
                    return person?.mob_in ? (
                      <button className="btn btn-sm" style={{ marginTop: '4px', fontSize: '11px' }}
                        onClick={() => setForm(f => calcCosts({ ...f, start_date: person.mob_in || f.start_date, end_date: person.mob_out || f.end_date }))}
                        title={`Use ${person.name}'s mob dates`}>
                        ↕ Use {person.name.split(' ')[0]}'s dates
                      </button>
                    ) : null
                  })()}
                </div>
              </div>

              {/* Pickup / Return Location */}
              <div className="fg-row">
                <div className="fg">
                  <label>Pickup Location</label>
                  <input className="input" value={form.pickup_loc} onChange={e => setForm(f => ({ ...f, pickup_loc: e.target.value }))} placeholder="Airport, depot address..." />
                </div>
                <div className="fg">
                  <label>Return Location</label>
                  <input className="input" value={form.return_loc} onChange={e => setForm(f => ({ ...f, return_loc: e.target.value }))} placeholder="Same or different" />
                </div>
              </div>

              {/* Daily rate excl/incl + GM */}
              <div className="fg-row">
                <div className="fg">
                  <label>Daily Rate (Incl GST)</label>
                  <input type="number" className="input"
                    value={form.daily_rate ? parseFloat((form.daily_rate * 1.1).toFixed(2)) : ''}
                    placeholder="0.00"
                    onChange={e => update('daily_rate', parseFloat((parseFloat(e.target.value) / 1.1).toFixed(2)) || 0)} />
                </div>
                <div className="fg">
                  <label>Daily Rate (Excl GST)</label>
                  <input type="number" className="input" style={{ background: 'var(--bg3)' }}
                    value={form.daily_rate || ''} placeholder="0.00"
                    onChange={e => update('daily_rate', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={form.gm_pct} min={0} max={99}
                    onChange={e => update('gm_pct', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              {/* PO link */}
              <div className="fg">
                <label>Link to Purchase Order <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>— third-party car hire must have a PO</span></label>
                <select className="input" value={form.linked_po_id} onChange={e => setForm(f => ({ ...f, linked_po_id: e.target.value }))}>
                  <option value="">— No PO linked —</option>
                  {pos.map(po => <option key={po.id} value={po.id}>{po.po_number || '—'} {po.vendor}</option>)}
                </select>
              </div>

              {/* WBS */}
              <div className="fg">
                <label>WBS</label>
                <select className="input" value={form.wbs} onChange={e => setForm(f => ({ ...f, wbs: e.target.value }))}>
                  <option value="">— Select WBS —</option>
                  {wbsList.map(w => <option key={w.id} value={w.code}>{w.code} — {w.name}</option>)}
                </select>
              </div>

              {/* Loc fee + One-way */}
              <div className="fg-row">
                <div className="fg">
                  <label>Location Fee %</label>
                  <input type="number" className="input" value={form.location_fee_pct || ''} placeholder="0" min={0} step={0.1}
                    title="Airport/depot surcharge applied as % on top of base rate"
                    onChange={e => update('location_fee_pct', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg">
                  <label>One-Way Fee ($)</label>
                  <input type="number" className="input" value={form.one_way_fee || ''} placeholder="0" min={0}
                    onChange={e => update('one_way_fee', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              {/* Reservation + Collected/Dropped */}
              <div className="fg-row">
                <div className="fg">
                  <label>Reservation Number</label>
                  <input className="input" value={form.reservation} onChange={e => setForm(f => ({ ...f, reservation: e.target.value }))} placeholder="Booking / confirmation number" />
                </div>
                <div className="fg" style={{ display: 'flex', gap: '14px', alignItems: 'center', paddingTop: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.collected} onChange={e => setForm(f => ({ ...f, collected: e.target.checked }))} /> Collected
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.dropped_off} onChange={e => setForm(f => ({ ...f, dropped_off: e.target.checked }))} /> Dropped Off
                  </label>
                </div>
              </div>

              {/* Cost preview — matches HTML carCostPreview */}
              <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', fontSize: '12px' }}>
                {form.daily_rate > 0 && form.start_date && form.end_date ? (
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>DAYS</span><br /><strong>{previewDays}</strong></div>
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>BASE COST (EX GST)</span><br /><strong>{fmt(form.daily_rate * previewDays)}</strong></div>
                    {form.location_fee_pct > 0 && (
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>LOC FEE ({form.location_fee_pct}%)</span><br /><strong>+{fmt(form.daily_rate * previewDays * form.location_fee_pct / 100)}</strong></div>
                    )}
                    {form.one_way_fee > 0 && (
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>ONE-WAY FEE</span><br /><strong>+{fmt(form.one_way_fee)}</strong></div>
                    )}
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>TOTAL COST (EX GST)</span><br /><strong style={{ color: 'var(--accent)' }}>{fmt(form.total_cost)}</strong></div>
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>CUSTOMER ({form.gm_pct}% GM)</span><br /><strong style={{ color: 'var(--green)' }}>{fmt(form.customer_total)}</strong></div>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text3)' }}>Enter rate and dates to see cost preview.</span>
                )}
              </div>

              {/* Fuel + km (CO2) */}
              <div className="fg-row">
                <div className="fg">
                  <label>Fuel Type <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(CO2)</span></label>
                  <select className="input" value={form.fuel_type} onChange={e => setForm(f => ({ ...f, fuel_type: e.target.value }))}>
                    <option value="">— Unknown —</option>
                    <option value="petrol">Petrol</option>
                    <option value="diesel">Diesel</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="electric">Electric</option>
                  </select>
                </div>
                <div className="fg">
                  <label>Total km <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(CO2 — enter at end)</span></label>
                  <input type="number" className="input" value={form.total_km || ''} placeholder="e.g. 3200" step={1} min={0}
                    onChange={e => setForm(f => ({ ...f, total_km: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>

              {/* Notes */}
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
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
        <div className="modal-overlay">
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
        <div className="modal-overlay">
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
