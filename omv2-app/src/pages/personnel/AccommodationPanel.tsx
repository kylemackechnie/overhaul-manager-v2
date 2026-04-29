import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useResizableColumns, resizerStyle } from '../../hooks/useResizableColumns'
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
  const [bulkAddModal, setBulkAddModal] = useState(false)
  const [selAccom, setSelAccom] = useState<Set<string>>(new Set())
  const [bulkEditModal, setBulkEditModal] = useState(false)
  const [bulkEditForm, setBulkEditForm] = useState({ check_in:'', check_out:'', nightly_rate:0, applyRate:false })
  const [bulkForm, setBulkForm] = useState({ property:'', vendor:'', check_in:'', check_out:'', gm_pct:15, n:1, wbs:'' })
  const [form, setForm] = useState<AccomForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [acData, resData, poData] = await Promise.all([
      supabase.from('accommodation').select('*').eq('project_id', pid).order('check_in'),
      supabase.from('resources').select('id,name,role,mob_in,mob_out').eq('project_id', pid).order('name'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status','cancelled').order('po_number'),
    ])
    setAccomList((acData.data || []) as Accommodation[])
    setResources((resData.data || []) as Resource[])
    setPos((poData.data || []) as PurchaseOrder[])
    const wbsRes = await supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order')
    setWbsList((wbsRes.data||[]) as {id:string,code:string,name:string}[])
    setLoading(false)
  }


  async function bulkAddRooms() {
    if (!bulkForm.property.trim() || !bulkForm.n) return
    const pid = activeProject!.id
    const days = bulkForm.check_in && bulkForm.check_out
      ? Math.max(1, Math.round((new Date(bulkForm.check_out).getTime() - new Date(bulkForm.check_in).getTime()) / 86400000))
      : 0
    const rows = Array.from({length: bulkForm.n}, (_, i) => ({
      project_id: pid,
      property: bulkForm.property.trim(),
      room: `Room ${i+1}`,
      vendor: bulkForm.vendor.trim(),
      check_in: bulkForm.check_in || null,
      check_out: bulkForm.check_out || null,
      nights: days,
      total_cost: 0,
      customer_total: 0,
      gm_pct: bulkForm.gm_pct,
      wbs: bulkForm.wbs,
      occupants: [],
      inclusive: false,
    }))
    const { error } = await supabase.from('accommodation').insert(rows)
    if (error) { toast(error.message, 'error'); return }
    toast(`Added ${bulkForm.n} rooms at ${bulkForm.property}`, 'success')
    setBulkAddModal(false)
    setBulkForm({ property:'', vendor:'', check_in:'', check_out:'', gm_pct:15, n:1, wbs:'' })
    load()
  }


  async function applyBulkEdit() {
    const ids = [...selAccom]
    const updates: Record<string,unknown> = {}
    if (bulkEditForm.check_in) updates.check_in = bulkEditForm.check_in
    if (bulkEditForm.check_out) updates.check_out = bulkEditForm.check_out
    if (bulkEditForm.applyRate && bulkEditForm.nightly_rate > 0) {
      // Calc total_cost from nights × rate for each room — update individually
      for (const id of ids) {
        const a = accomList.find(x=>x.id===id)
        if (!a) continue
        const nights = a.nights || 0
        const total_cost = parseFloat((bulkEditForm.nightly_rate * nights).toFixed(2))
        const customer_total = total_cost > 0 ? parseFloat((total_cost/(1-Math.min(a.gm_pct||15,99)/100)).toFixed(2)) : 0
        await supabase.from('accommodation').update({...updates, total_cost, customer_total}).eq('id',id)
      }
    } else {
      await supabase.from('accommodation').update(updates).in('id', ids)
    }
    toast(`Updated ${ids.length} bookings`, 'success')
    setSelAccom(new Set()); setBulkEditModal(false); load()
  }

  async function bulkDeleteAccom() {
    if (!selAccom.size || !confirm(`Delete ${selAccom.size} booking${selAccom.size>1?'s':''}? This cannot be undone.`)) return
    const { error } = await supabase.from('accommodation').delete().in('id', [...selAccom])
    if (error) { toast(error.message, 'error'); return }
    toast(`Deleted ${selAccom.size} booking${selAccom.size>1?'s':''}`, 'info')
    setSelAccom(new Set()); load()
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
    const formExt = bulkForm as typeof bulkForm & { nightly_rate?: number; room_type?: string }
    const rate = formExt.nightly_rate || 0
    const gm = bulkForm.gm_pct || 0
    const insertions = [...bulkSelected].map(resId => {
      const res = resources.find(r => r.id === resId)
      const nights = res?.mob_in && res?.mob_out
        ? Math.max(1, Math.round((new Date(res.mob_out+'T12:00:00').getTime() - new Date(res.mob_in+'T12:00:00').getTime()) / 86400000))
        : 0
      const totalCost = rate * nights
      const customerTotal = gm > 0 ? parseFloat((totalCost / (1 - gm / 100)).toFixed(2)) : totalCost
      return {
        project_id: pid,
        property: bulkForm.property.trim(),
        room: formExt.room_type || '',
        vendor: bulkForm.vendor,
        check_in: res?.mob_in || null,
        check_out: res?.mob_out || null,
        nights,
        nightly_rate: rate,
        total_cost: totalCost,
        customer_total: customerTotal,
        gm_pct: gm,
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
          <button className="btn btn-sm" onClick={() => setBulkModal(true)}>👥 Bookings</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={printVendorSummary}>🖨 Vendor</button>
          <button className="btn btn-sm" onClick={printBookingConfirmation}>🖨 Conf</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : accomList.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏨</div>
            <h3>No accommodation</h3>
            <p>Add accommodation bookings for this project.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            {selAccom.size > 0 && (
              <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'8px 12px',background:'rgba(15,118,110,.08)',border:'1px solid rgba(15,118,110,.2)',flexWrap:'wrap'}}>
                <span style={{fontSize:'12px',fontWeight:600,color:'var(--mod-hr)'}}>{selAccom.size} selected</span>
                <button className="btn btn-sm" onClick={()=>{setBulkEditForm({check_in:'',check_out:'',nightly_rate:0,applyRate:false});setBulkEditModal(true)}}>✏ Edit Dates</button>
                <button className="btn btn-sm" style={{color:'var(--red)',borderColor:'var(--red)'}} onClick={bulkDeleteAccom}>🗑 Delete Selected</button>
                <button className="btn btn-sm" style={{color:'var(--text3)'}} onClick={()=>setSelAccom(new Set())}>✕ Clear</button>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th style={{width:'32px',textAlign:'center',padding:'8px 6px'}}>
                    <input type="checkbox"
                      checked={accomList.length > 0 && accomList.every(a => selAccom.has(a.id))}
                      ref={el => { if (el) el.indeterminate = selAccom.size > 0 && !accomList.every(a => selAccom.has(a.id)) }}
                      onChange={e => setSelAccom(e.target.checked ? new Set(accomList.map(a=>a.id)) : new Set())} />
                  </th>
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
                    <tr key={a.id} style={{background:selAccom.has(a.id)?'rgba(15,118,110,.04)':undefined}}>
                      <td style={{textAlign:'center',padding:'5px 6px'}}>
                        <input type="checkbox" checked={selAccom.has(a.id)} style={{accentColor:'var(--mod-hr)',cursor:'pointer'}}
                          onChange={e=>setSelAccom(s=>{const n=new Set(s);e.target.checked?n.add(a.id):n.delete(a.id);return n})} />
                      </td>
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
        <div className="modal-overlay">
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
                  {form.occupant_ids.length > 0 && (() => {
                    const firstOcc = resources.find(r => r.id === form.occupant_ids[0])
                    return firstOcc?.mob_in ? (
                      <button className="btn btn-sm" style={{marginTop:'4px',fontSize:'11px'}} onClick={() => {
                        if (firstOcc.mob_in && firstOcc.mob_out) updateDates(firstOcc.mob_in, firstOcc.mob_out)
                      }} title={`Use ${firstOcc.name}'s mob dates`}>
                        ↕ Use {firstOcc.name.split(' ')[0]}'s dates
                      </button>
                    ) : null
                  })()}
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
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'560px',maxHeight:'90vh'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>⊞ Bulk Add Rooms</h3>
              <button className="btn btn-sm" onClick={()=>setBulkModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{overflowY:'auto',maxHeight:'65vh'}}>
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>
                Set room details below. Select people to create <b>one booking per person</b> — dates default to their mob in/out dates.
              </p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'14px'}}>
                <div className="fg" style={{margin:0,gridColumn:'1/-1'}}>
                  <label>Property Name *</label>
                  <input className="input" value={bulkForm.property} onChange={e=>setBulkForm(f=>({...f,property:e.target.value}))} placeholder="e.g. Quest Gladstone, Ibis Styles..." autoFocus />
                </div>
                <div className="fg" style={{margin:0}}>
                  <label>Room Type / Label</label>
                  <input className="input" value={(bulkForm as typeof bulkForm & {room_type?:string}).room_type||''} onChange={e=>setBulkForm(f=>({...f,room_type:e.target.value}))} placeholder="Standard Queen, Studio..." />
                </div>
                <div className="fg" style={{margin:0}}>
                  <label>Vendor / Platform</label>
                  <input className="input" value={bulkForm.vendor} onChange={e=>setBulkForm(f=>({...f,vendor:e.target.value}))} placeholder="Direct, Booking.com..." />
                </div>
                <div className="fg" style={{margin:0}}>
                  <label>Nightly Rate (incl GST)</label>
                  <input type="number" className="input" value={(bulkForm as typeof bulkForm & {rate_incl?:number}).rate_incl||''} min={0} step={0.01} placeholder="0.00"
                    onChange={e => { const incl = parseFloat(e.target.value)||0; const ex = incl > 0 ? parseFloat((incl/1.1).toFixed(2)) : 0; setBulkForm(f=>({...f,rate_incl:incl,nightly_rate:ex})) }} />
                </div>
                <div className="fg" style={{margin:0}}>
                  <label>Nightly Rate (excl GST)</label>
                  <input type="number" className="input" style={{background:'var(--bg3)'}} value={(bulkForm as typeof bulkForm & {nightly_rate?:number}).nightly_rate||''} min={0} step={0.01} placeholder="auto"
                    onChange={e => { const ex = parseFloat(e.target.value)||0; const incl = ex > 0 ? parseFloat((ex*1.1).toFixed(2)) : 0; setBulkForm(f=>({...f,nightly_rate:ex,rate_incl:incl})) }} />
                </div>
                <div className="fg" style={{margin:0}}>
                  <label>GM%</label>
                  <input type="number" className="input" value={bulkForm.gm_pct||''} min={0} max={99} step={0.5} onChange={e=>setBulkForm(f=>({...f,gm_pct:parseFloat(e.target.value)||0}))} />
                </div>
                <div className="fg" style={{margin:0,gridColumn:'1/-1'}}>
                  <label>WBS</label>
                  <select className="input" value={bulkForm.wbs} onChange={e=>setBulkForm(f=>({...f,wbs:e.target.value}))}>
                    <option value="">— Select WBS —</option>
                    {wbsList.map(w=><option key={w.id} value={w.code}>{w.code} — {w.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{fontSize:'12px',fontWeight:600,marginBottom:'8px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span>Select People <span style={{fontWeight:400,color:'var(--text3)'}}>— one room created per person using their mob dates</span></span>
                <button className="btn btn-sm" style={{fontSize:'11px'}} onClick={()=>setBulkSelected(new Set(resources.map(r=>r.id)))}>All</button>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                {resources.map(r => (
                  <label key={r.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',background:bulkSelected.has(r.id)?'rgba(16,185,129,0.06)':'var(--bg3)'}}>
                    <input type="checkbox" checked={bulkSelected.has(r.id)} onChange={e=>setBulkSelected(s=>{const n=new Set(s);e.target.checked?n.add(r.id):n.delete(r.id);return n})} style={{accentColor:'var(--mod-hr)'}} />
                    <div style={{flex:1}}>
                      <div style={{fontSize:'13px',fontWeight:600}}>{r.name}</div>
                      <div style={{fontSize:'11px',color:'var(--text3)'}}>
                        {r.role||'—'}
                        {r.mob_in ? <span style={{marginLeft:'6px',color:r.mob_out?'var(--green)':'var(--amber)'}}> · {r.mob_in} → {r.mob_out||'?'}</span> : <span style={{marginLeft:'6px',color:'var(--red)'}}> · no mob dates</span>}
                      </div>
                    </div>
                    {r.mob_in && r.mob_out && (
                      <div style={{fontSize:'10px',fontFamily:'var(--mono)',color:'var(--text3)'}}>
                        {Math.max(1, Math.round((new Date(r.mob_out+'T12:00').getTime()-new Date(r.mob_in+'T12:00').getTime())/86400000))}n
                      </div>
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <span style={{fontSize:'12px',color:'var(--text3)'}}>{bulkSelected.size} selected · {bulkSelected.size} room{bulkSelected.size!==1?'s':''} will be created</span>
              <button className="btn" onClick={()=>setBulkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBulkRooms} disabled={saving||!bulkSelected.size}>{saving?'Saving…':`Add ${bulkSelected.size} Room${bulkSelected.size!==1?'s':''}`}</button>
            </div>
          </div>
        </div>
      )}

      {bulkEditModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'360px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Edit {selAccom.size} Bookings</h3><button className="btn btn-sm" onClick={()=>setBulkEditModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'10px'}}>Leave blank to keep existing. Or pick a resource to copy their mob dates.</p>
              <div className="fg"><label>Check In</label><input type="date" className="input" value={bulkEditForm.check_in} onChange={e=>setBulkEditForm(f=>({...f,check_in:e.target.value}))} /></div>
              <div className="fg"><label>Check Out</label><input type="date" className="input" value={bulkEditForm.check_out} onChange={e=>setBulkEditForm(f=>({...f,check_out:e.target.value}))} /></div>
              {resources.filter(r=>r.mob_in||r.mob_out).length > 0 && (
                <div style={{marginTop:'8px'}}>
                  <div style={{fontSize:'11px',fontWeight:600,color:'var(--text2)',marginBottom:'6px'}}>Use resource mob dates:</div>
                  <div style={{display:'flex',flexDirection:'column',gap:'4px',maxHeight:'160px',overflowY:'auto'}}>
                    {resources.filter(r=>r.mob_in||r.mob_out).map(r => (
                      <button key={r.id} style={{padding:'5px 10px',border:'1px solid var(--border)',borderRadius:'5px',background:'var(--bg3)',cursor:'pointer',textAlign:'left',fontSize:'12px'}}
                        onClick={()=>setBulkEditForm(f=>({...f,check_in:r.mob_in||'',check_out:r.mob_out||''}))}>
                        <span style={{fontWeight:600}}>{r.name}</span>
                        <span style={{color:'var(--text3)',marginLeft:'8px'}}>{r.mob_in||'?'} → {r.mob_out||'?'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{marginTop:'10px',paddingTop:'10px',borderTop:'1px solid var(--border)'}}>
                <label style={{display:'flex',gap:'8px',alignItems:'center',fontSize:'12px',marginBottom:'6px'}}>
                  <input type="checkbox" checked={bulkEditForm.applyRate} onChange={e=>setBulkEditForm(f=>({...f,applyRate:e.target.checked}))} />
                  Update nightly rate
                </label>
                {bulkEditForm.applyRate && <div className="fg"><label>Nightly Rate ($)</label><input type="number" className="input" min={0} step={0.5} value={bulkEditForm.nightly_rate||''} onChange={e=>setBulkEditForm(f=>({...f,nightly_rate:parseFloat(e.target.value)||0}))} /></div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkEditModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyBulkEdit}>Apply</button>
            </div>
          </div>
        </div>
      )}
      {bulkAddModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'380px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>⊞ Bulk Add Rooms</h3><button className="btn btn-sm" onClick={()=>setBulkAddModal(false)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Property *</label><input className="input" value={bulkForm.property} onChange={e=>setBulkForm(f=>({...f,property:e.target.value}))} placeholder="e.g. Quest Gladstone" autoFocus /></div>
              <div className="fg"><label>Vendor</label><input className="input" value={bulkForm.vendor} onChange={e=>setBulkForm(f=>({...f,vendor:e.target.value}))} placeholder="Hotel / booking agent" /></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <div className="fg"><label>Check In</label><input type="date" className="input" value={bulkForm.check_in} onChange={e=>setBulkForm(f=>({...f,check_in:e.target.value}))} /></div>
                <div className="fg"><label>Check Out</label><input type="date" className="input" value={bulkForm.check_out} onChange={e=>setBulkForm(f=>({...f,check_out:e.target.value}))} /></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <div className="fg"><label>Number of Rooms</label><input type="number" className="input" min={1} max={50} value={bulkForm.n} onChange={e=>setBulkForm(f=>({...f,n:parseInt(e.target.value)||1}))} /></div>
                <div className="fg"><label>GM%</label><input type="number" className="input" min={0} max={99} step={0.5} value={bulkForm.gm_pct} onChange={e=>setBulkForm(f=>({...f,gm_pct:parseFloat(e.target.value)||0}))} /></div>
              </div>
              <p style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px'}}>Rooms will be named Room 1, Room 2, etc. Edit nightly rate and assign occupants after creation.</p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={bulkAddRooms} disabled={!bulkForm.property.trim()}>Add {bulkForm.n} Room{bulkForm.n!==1?'s':''}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
