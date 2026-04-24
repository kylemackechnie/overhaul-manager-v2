import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Accommodation, Resource, PurchaseOrder } from '../../types'

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
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Accommodation>(null)
  const [form, setForm] = useState<AccomForm>(EMPTY)
  const [saving, setSaving] = useState(false)

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
  const totalCost = accomList.reduce((s, a) => s + (a.total_cost || 0), 0)
  const totalSell = accomList.reduce((s, a) => s + (a.customer_total || 0), 0)
  const resMap = Object.fromEntries(resources.map(r => [r.id, r.name]))
  const nightlyRate = form.nights > 0 ? form.total_cost / form.nights : 0

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
    </div>
  )
}
