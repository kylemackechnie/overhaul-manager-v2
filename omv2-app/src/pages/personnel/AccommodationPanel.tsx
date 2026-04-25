import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Accommodation, Resource, PurchaseOrder } from '../../types'
import { downloadCSV } from '../../lib/csv'

type AccomForm = {
  property: string; room: string; vendor: string
  check_in: string; check_out: string; nights: number
  total_cost: number; customer_total: number; gm_pct: number
  inclusive: boolean; linked_po_id: string; notes: string
  occupant_ids: string[]
}

const EMPTY: AccomForm = {
  property: '', room: '', vendor: '', check_in: '', check_out: '',
  nights: 0, total_cost: 0, customer_total: 0, gm_pct: 15,
  inclusive: false, linked_po_id: '', notes: '', occupant_ids: [],
}

function nightsBetween(a: string, b: string): number {
  if (!a || !b) return 0
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

function calcCustomerPrice(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}

export function AccommodationPanel() {
  const { activeProject } = useAppStore()
  const [accomList, setAccomList] = useState<Accommodation[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [wbsList, setWbsList] = useState<{id:string,code:string,name:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Accommodation>(null)
  const [form, setForm] = useState<AccomForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkForm, setBulkForm] = useState({ property:'', vendor:'', room_prefix:'Room', rate_per_night:0, gm_pct:0, wbs:'' })
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [acData, resData, poData] = await Promise.all([
      supabase.from('accommodation').select('*').eq('project_id', pid).order('check_in'),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status','cancelled').order('po_number'),
    ])
    setAccomList((acData.data || []) as Accommodation[])
    setResources((resData.data || []) as Resource[])
    setPos((poData.data || []) as PurchaseOrder[])
    const wbsRes = await supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order')
    setWbsList((wbsRes.data||[]) as {id:string,code:string,name:string}[])
    setLoading(false)
  }

  function openNew() { setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 }); setModal('new') }
  function openEdit(a: Accommodation) {
    setForm({
      property: a.property, room: a.room, vendor: a.vendor,
      check_in: a.check_in || '', check_out: a.check_out || '',
      nights: a.nights, total_cost: a.total_cost, customer_total: a.customer_total,
      gm_pct: a.gm_pct, inclusive: a.inclusive, linked_po_id: a.linked_po_id || '',
      notes: a.notes, occupant_ids: (a.occupants as string[]) || [],
    })
    setModal(a)
  }


  function updateDates(ci: string, co: string) {
    const nights = nightsBetween(ci, co)
    setForm(f => {
      const nightly = f.nights > 0 ? f.total_cost / f.nights : 0
      const total_cost = parseFloat((nightly * nights).toFixed(2))
      return { ...f, check_in: ci, check_out: co, nights, total_cost, customer_total: calcCustomerPrice(total_cost, f.gm_pct) }
    })
  }

  function updateNightlyRate(rate: number) {
    setForm(f => {
      const nights = nightsBetween(f.check_in, f.check_out) || 1
      const total_cost = parseFloat((rate * nights).toFixed(2))
      return { ...f, total_cost, customer_total: calcCustomerPrice(total_cost, f.gm_pct) }
    })
  }

  function updateGm(gm: number) {
    setForm(f => ({ ...f, gm_pct: gm, customer_total: calcCustomerPrice(f.total_cost, gm) }))
  }

  function toggleOccupant(id: string) {
    setForm(f => ({
      ...f, occupant_ids: f.occupant_ids.includes(id)
        ? f.occupant_ids.filter(x => x !== id)
        : [...f.occupant_ids, id]
    }))
  }

  async function save() {
    if (!form.property.trim()) return toast('Property name required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      property: form.property, room: form.room, vendor: form.vendor,
      check_in: form.check_in || null, check_out: form.check_out || null,
      nights: form.nights, total_cost: form.total_cost, customer_total: form.customer_total,
      gm_pct: form.gm_pct, inclusive: form.inclusive, linked_po_id: form.linked_po_id || null,
      notes: form.notes, occupants: form.occupant_ids,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('accommodation').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Accommodation added', 'success')
    } else {
      const { error } = await supabase.from('accommodation').update(payload).eq('id', (modal as Accommodation).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(a: Accommodation) {
    if (!confirm(`Delete accommodation "${a.property} — ${a.room}"?`)) return
    await supabase.from('accommodation').delete().eq('id', a.id)
    toast('Deleted', 'info'); load()
  }

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })

  function exportCSV() {
    downloadCSV(
      [
        ['Property', 'Room', 'Vendor', 'Check In', 'Check Out', 'Nights', 'Cost', 'Sell', 'WBS', 'Notes'],
        ...accomList.map(a => [a.property||'', a.room||'', a.vendor||'', a.check_in||'', a.check_out||'', a.nights||0, a.total_cost||0, a.customer_total||0, '', a.notes||''])
      ],
      'accommodation_' + (activeProject?.name || 'project')
    )
  }
  const totalCost = accomList.reduce((s, a) => s + (a.total_cost || 0), 0)
  const totalSell = accomList.reduce((s, a) => s + (a.customer_total || 0), 0)
  const resMap = Object.fromEntries(resources.map(r => [r.id, r.name]))
  const nightlyRate = form.nights > 0 ? form.total_cost / form.nights : 0



  function printBookingConfirmation() {
    const rows = accomList.map(a => {
      const occ = (a.occupants as string[] | undefined || []).join(', ')
      return `<tr><td>${a.property||a.room||'—'}</td><td>${a.vendor||'—'}</td><td>${a.room||'—'}</td><td>${a.check_in||'—'}</td><td>${a.check_out||'—'}</td><td>${a.nights||0}</td><td>${occ||'—'}</td><td>$${(a.total_cost||0).toFixed(0)}</td></tr>`
    }).join('')
    const total = accomList.reduce((s,a) => s + (a.total_cost || 0), 0)
    const html = `<html><head><title>Accommodation — ${activeProject?.name}</title>
    <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ccc;padding:5px 8px}th{background:#f0f0f0}h1{font-size:16px}@media print{@page{size:landscape}}</style>
    </head><body>
    <h1>Accommodation Register — ${activeProject?.name || ''}</h1>
    <p style="font-size:11px;color:#666">Printed: ${new Date().toLocaleDateString('en-AU')}</p>
    <table><thead><tr><th>Property</th><th>Vendor</th><th>Room</th><th>Check In</th><th>Check Out</th><th>Nights</th><th>Occupants</th><th>Cost</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="font-weight:bold"><td colspan="7">Total (${accomList.length} bookings)</td><td>$${total.toFixed(0)}</td></tr></tfoot>
    </table></body></html>`
    const w = window.open(); if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  function printVendorSummary() {
    const vendors = [...new Set(accomList.map(a => a.vendor || a.property || 'Unknown'))]
    const pages = vendors.map(vendor => {
      const items = accomList.filter(a => (a.vendor || a.property) === vendor)
      const total = items.reduce((s, a) => s + (a.total_cost || 0), 0)
      const rows = items.map(a => {
        const occ = (a.occupants as string[] | undefined || []).join(', ')
        return `<tr><td>${a.room||a.property||'—'}</td><td>${a.check_in||'—'}</td><td>${a.check_out||'—'}</td><td>${a.nights||'—'}</td><td>${occ||'—'}</td><td>$${(a.total_cost||0).toFixed(0)}</td></tr>`
      }).join('')
      return `<h2 style="margin:0 0 8px">${vendor}</h2>
        <table border="1" cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
          <thead><tr style="background:#eee"><th>Room</th><th>Check In</th><th>Check Out</th><th>Nights</th><th>Occupants</th><th>Cost</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr style="font-weight:bold"><td colspan="5">Total</td><td>$${total.toFixed(0)}</td></tr></tfoot>
        </table>`
    }).join('<hr/>')
    const html = `<html><head><title>Vendor Summary — Accommodation</title><style>body{font-family:sans-serif;padding:20px}@media print{@page{size:landscape}}</style></head><body>${pages}</body></html>`
    const w = window.open()
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }


  async function saveBulkRooms() {
    if (!bulkSelected.size || !activeProject) return
    if (!bulkForm.property.trim()) { toast('Property name required', 'error'); return }
    setSaving(true)
    const pid = activeProject.id
    const insertions = [...bulkSelected].map((resId, i) => {
      const res = resources.find(r => r.id === resId)
      const nights = res?.mob_in && res?.mob_out
        ? Math.max(1, Math.round((new Date(res.mob_out+'T12:00:00').getTime() - new Date(res.mob_in+'T12:00:00').getTime()) / 86400000))
        : 0
      const totalCost = (bulkForm.rate_per_night || 0) * nights
      const customerTotal = bulkForm.gm_pct > 0 ? parseFloat((totalCost / (1 - bulkForm.gm_pct / 100)).toFixed(2)) : totalCost
      return {
        project_id: pid,
        property: bulkForm.property.trim(),
        room: `${bulkForm.room_prefix || 'Room'} ${i + 1}`,
        vendor: bulkForm.vendor,
        check_in: res?.mob_in || null,
        check_out: res?.mob_out || null,
        nights,
        total_cost: totalCost,
        customer_total: customerTotal,
        gm_pct: bulkForm.gm_pct,
        wbs: bulkForm.wbs,
        occupants: [resId],
      }
    })
    const { error } = await supabase.from('accommodation').insert(insertions)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Added ${insertions.length} room booking${insertions.length > 1 ? 's' : ''}`, 'success')
    setBulkModal(false); setBulkSelected(new Set()); load()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Accommodation</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {accomList.length} rooms · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Room</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={printVendorSummary}>🖨 Vendor</button>
          <button className="btn btn-sm" onClick={printBookingConfirmation}>🖨 Bookings</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : accomList.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏨</div>
            <h3>No accommodation</h3>
            <p>Add accommodation bookings for this project.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Property</th><th>Room</th><th>Occupants</th>
                  <th>Check In</th><th>Check Out</th><th>Nights</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accomList.map(a => {
                  const occ = (a.occupants as string[]) || []
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.property}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{a.room || '—'}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text3)' }}>
                        {occ.length > 0 ? occ.map(id => resMap[id] || id).join(', ') : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{a.check_in || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{a.check_out || '—'}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px' }}>{a.nights || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(a.total_cost || 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{fmt(a.customer_total || 0)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(a)}>Edit</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(a)}>✕</button>
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
          <div className="modal" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add Accommodation' : 'Edit Accommodation'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Property</label>
                  <input className="input" value={form.property} onChange={e => setForm(f => ({ ...f, property: e.target.value }))} placeholder="e.g. Nesuto Docklands" autoFocus />
                </div>
                <div className="fg">
                  <label>Room / Unit</label>
                  <input className="input" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g. 1BR Apartment 5" />
                </div>
              </div>
              <div className="fg">
                <label>Vendor</label>
                <input className="input" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Booking agent or property name" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Check In</label>
                  <input type="date" className="input" value={form.check_in} onChange={e => updateDates(e.target.value, form.check_out)} />
                </div>
                <div className="fg">
                  <label>Check Out</label>
                  <input type="date" className="input" value={form.check_out} onChange={e => updateDates(form.check_in, e.target.value)} />
                </div>
                <div className="fg">
                  <label>Nightly Rate (ex GST)</label>
                  <input type="number" className="input" value={nightlyRate || ''} onChange={e => updateNightlyRate(parseFloat(e.target.value) || 0)} placeholder="0" />
                </div>
              </div>

              {/* Cost preview */}
              {form.total_cost > 0 && (
                <div style={{ background: 'var(--bg3)', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div><span style={{ color: 'var(--text3)' }}>Nights</span><br /><strong>{form.nights}</strong></div>
                  <div><span style={{ color: 'var(--text3)' }}>Cost</span><br /><strong>{fmt(form.total_cost)}</strong></div>
                  <div><span style={{ color: 'var(--text3)' }}>Sell ({form.gm_pct}% GM)</span><br /><strong style={{ color: 'var(--green)' }}>{fmt(form.customer_total)}</strong></div>
                </div>
              )}

              <div className="fg-row">
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={form.gm_pct} onChange={e => updateGm(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg">
                  <label>Total Cost (override)</label>
                  <input type="number" className="input" value={form.total_cost || ''} onChange={e => setForm(f => ({ ...f, total_cost: parseFloat(e.target.value) || 0, customer_total: calcCustomerPrice(parseFloat(e.target.value) || 0, f.gm_pct) }))} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap', paddingTop: '18px' }}>
                  <input type="checkbox" checked={form.inclusive} onChange={e => setForm(f => ({ ...f, inclusive: e.target.checked }))} />
                  Inclusive
                </label>
              </div>

              {/* Occupants */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Occupants</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {resources.map(r => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px', padding: '3px 8px', background: form.occupant_ids.includes(r.id) ? 'var(--accent)' : 'var(--bg3)', color: form.occupant_ids.includes(r.id) ? '#fff' : 'var(--text)', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      <input type="checkbox" style={{ display: 'none' }} checked={form.occupant_ids.includes(r.id)} onChange={() => toggleOccupant(r.id)} />
                      {r.name}
                    </label>
                  ))}
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

      {bulkModal && (
        <div className="modal-overlay" onClick={()=>setBulkModal(false)}>
          <div className="modal" style={{maxWidth:'520px',maxHeight:'90vh'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>⊞ Bulk Add Rooms</h3>
              <button className="btn btn-sm" onClick={()=>setBulkModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{overflowY:'auto',maxHeight:'60vh'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'14px'}}>
                <div className="fg" style={{margin:0,gridColumn:'1/-1'}}><label>Property Name *</label><input className="input" value={bulkForm.property} onChange={e=>setBulkForm(f=>({...f,property:e.target.value}))} placeholder="e.g. Quest Gladstone" /></div>
                <div className="fg" style={{margin:0}}><label>Vendor</label><input className="input" value={bulkForm.vendor} onChange={e=>setBulkForm(f=>({...f,vendor:e.target.value}))} placeholder="Hotel / owner" /></div>
                <div className="fg" style={{margin:0}}><label>Room Prefix</label><input className="input" value={bulkForm.room_prefix} onChange={e=>setBulkForm(f=>({...f,room_prefix:e.target.value}))} placeholder="Room" /></div>
                <div className="fg" style={{margin:0}}><label>Rate per Night ($)</label><input type="number" className="input" value={bulkForm.rate_per_night||''} min={0} step={1} onChange={e=>setBulkForm(f=>({...f,rate_per_night:parseFloat(e.target.value)||0}))} /></div>
                <div className="fg" style={{margin:0}}><label>GM%</label><input type="number" className="input" value={bulkForm.gm_pct||''} min={0} max={99} step={0.5} onChange={e=>setBulkForm(f=>({...f,gm_pct:parseFloat(e.target.value)||0}))} /></div>
                <div className="fg" style={{margin:0,gridColumn:'1/-1'}}><label>WBS</label>
                  <select className="input" value={bulkForm.wbs} onChange={e=>setBulkForm(f=>({...f,wbs:e.target.value}))}>
                    <option value="">— Select WBS —</option>
                    {wbsList.map(w=><option key={w.id} value={w.code}>{w.code} — {w.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{fontSize:'12px',fontWeight:600,marginBottom:'8px',color:'var(--text)'}}>Assign one room per person:</div>
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                {resources.map(r => (
                  <label key={r.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',background:'var(--bg3)'}}>
                    <input type="checkbox" checked={bulkSelected.has(r.id)} onChange={e=>setBulkSelected(s=>{const n=new Set(s);e.target.checked?n.add(r.id):n.delete(r.id);return n})} style={{accentColor:'var(--mod-hr)'}} />
                    <div>
                      <div style={{fontSize:'13px',fontWeight:600}}>{r.name}</div>
                      <div style={{fontSize:'11px',color:'var(--text3)'}}>{r.role||'—'}{r.mob_in?` · ${r.mob_in} → ${r.mob_out||'?'}`:''}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <span style={{fontSize:'12px',color:'var(--text3)'}}>{bulkSelected.size} selected</span>
              <button className="btn" onClick={()=>setBulkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBulkRooms} disabled={saving||!bulkSelected.size}>{saving?'Saving…':`Add ${bulkSelected.size} Room${bulkSelected.size!==1?'s':''}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
