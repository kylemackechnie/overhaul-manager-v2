import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { HireItem, PurchaseOrder } from '../../types'

type HireType = 'dry' | 'wet' | 'local'
const TYPE_LABELS: Record<HireType, string> = { dry: 'Dry Hire', wet: 'Wet Hire', local: 'Local Equipment' }
const TYPE_ICONS: Record<HireType, string> = { dry: '🚜', wet: '🏗️', local: '🧰' }

type HireForm = {
  name: string; vendor: string; description: string
  start_date: string; end_date: string
  hire_cost: number; customer_total: number; gm_pct: number
  daily_rate: number; weekly_rate: number; charge_unit: string
  currency: string; transport_in: number; transport_out: number
  standby_rate: number; qty: number
  linked_po_id: string; notes: string; wbs: string
  // Wet hire specific
  rate_ds: number; rate_ns: number; rate_wds: number; rate_wns: number
  rate_sdd: number; rate_sdn: number; daa_rate: number
  crew: { name: string; role: string }[]
  // Local hire specific
  active_days: number | null
}

const EMPTY: HireForm = {
  name: '', vendor: '', description: '',
  start_date: '', end_date: '',
  hire_cost: 0, customer_total: 0, gm_pct: 15, daily_rate: 0, weekly_rate: 0, charge_unit: 'daily',
  currency: 'AUD', transport_in: 0, transport_out: 0, standby_rate: 0, qty: 1,
  linked_po_id: '', notes: '', wbs: '',
  rate_ds: 0, rate_ns: 0, rate_wds: 0, rate_wns: 0, rate_sdd: 0, rate_sdn: 0, daa_rate: 0,
  crew: [], active_days: null,
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0
  const da = new Date(a), db = new Date(b)
  return Math.max(0, Math.ceil((db.getTime() - da.getTime()) / 86400000))
}
function calcCustomerPrice(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}
function autoCalcHireCost(f: HireForm): number | null {
  const days = daysBetween(f.start_date, f.end_date)
  if (!days) return null
  if (f.charge_unit === 'weekly' && (f.weekly_rate || f.daily_rate)) {
    const rate = f.weekly_rate || f.daily_rate * 7
    return rate * Math.ceil(days / 7) + (f.transport_in || 0) + (f.transport_out || 0)
  }
  if (f.daily_rate) {
    return f.daily_rate * (f.qty || 1) * days + (f.transport_in || 0) + (f.transport_out || 0)
  }
  return null
}

export function HirePanel({ hireType }: { hireType: HireType }) {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<HireItem[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | HireItem>(null)
  const [form, setForm] = useState<HireForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [hireSelected, setHireSelected] = useState<Set<string>>(new Set())
  const [bulkPoModal, setBulkPoModal] = useState(false)
  const [bulkEditModal, setBulkEditModal] = useState(false)
  const [bulkEditForm, setBulkEditForm] = useState({ start_date:'', end_date:'' })
  const [resources, setResources] = useState<{id:string;name:string;mob_in:string|null;mob_out:string|null}[]>([])
  // Wet hire shift calendar
  const [calendarItem, setCalendarItem] = useState<HireItem | null>(null)
  const [calendarData, setCalendarData] = useState<Record<string, Record<string, boolean>>>({}) // date → {ds,ns,...}

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, hireType])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [hireData, poData, resData] = await Promise.all([
      supabase.from('hire_items').select('*').eq('project_id', pid).eq('hire_type', hireType).order('created_at'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status', 'cancelled').order('po_number'),
      supabase.from('resources').select('id,name,mob_in,mob_out').eq('project_id', pid).order('name'),
    ])
    setItems((hireData.data || []) as HireItem[])
    setPos((poData.data || []) as PurchaseOrder[])
    setResources((resData.data || []) as {id:string;name:string;mob_in:string|null;mob_out:string|null}[])
    setLoading(false)
  }

  function openNew() {
    setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 })
    setModal('new')
  }
  function openEdit(h: HireItem) {
    const hi = h as HireItem & { daily_rate?: number; weekly_rate?: number; charge_unit?: string; transport_in?: number; transport_out?: number; standby_rate?: number; qty?: number; active_days?: number; daa_rate?: number; crew?: {name:string;role:string}[]; rates?: Record<string,number> }
    setForm({
      name: h.name, vendor: h.vendor, description: h.description,
      start_date: h.start_date || '', end_date: h.end_date || '',
      hire_cost: h.hire_cost, customer_total: h.customer_total, gm_pct: h.gm_pct,
      daily_rate: hi.daily_rate || 0, weekly_rate: hi.weekly_rate || 0,
      charge_unit: hi.charge_unit || 'daily',
      currency: h.currency, transport_in: hi.transport_in || 0, transport_out: hi.transport_out || 0,
      standby_rate: hi.standby_rate || 0, qty: hi.qty || 1,
      linked_po_id: h.linked_po_id || '', notes: h.notes || '', wbs: (h as HireItem & {wbs?:string}).wbs || '',
      // Wet hire rates
      rate_ds: hi.rates?.ds || 0, rate_ns: hi.rates?.ns || 0,
      rate_wds: hi.rates?.wds || 0, rate_wns: hi.rates?.wns || 0,
      rate_sdd: hi.rates?.sdd || 0, rate_sdn: hi.rates?.sdn || 0,
      daa_rate: hi.daa_rate || 0, crew: hi.crew || [],
      active_days: hi.active_days ?? null,
    })
    setModal(h)
  }

  // When rate/date/transport changes, auto-calc cost
  function setFormAndCalc(updater: (f: HireForm) => HireForm) {
    setForm(prev => {
      const next = updater(prev)
      if (hireType === 'local') {
        // Local hire uses usage/standby split — calc inline
        const d = daysBetween(next.start_date, next.end_date)
        if (d > 0 && next.daily_rate) {
          const qty = next.qty || 1
          const activeDays = next.active_days !== null && next.standby_rate > 0
            ? Math.min(next.active_days ?? d, d) : d
          const standbyDays = next.standby_rate > 0 ? d - activeDays : 0
          const unit = next.charge_unit
          const ap = unit === 'weekly' ? Math.ceil(activeDays / 7) : activeDays
          const sp = unit === 'weekly' ? Math.ceil(standbyDays / 7) : standbyDays
          const cost = (next.daily_rate * ap + (next.standby_rate || 0) * sp) * qty + (next.transport_in || 0) + (next.transport_out || 0)
          return { ...next, hire_cost: cost, customer_total: calcCustomerPrice(cost, next.gm_pct) }
        }
        return next
      }
      const auto = autoCalcHireCost(next)
      if (auto !== null) {
        return { ...next, hire_cost: auto, customer_total: calcCustomerPrice(auto, next.gm_pct) }
      }
      return next
    })
  }

  function updateGm(gm: number) {
    setForm(f => ({ ...f, gm_pct: gm, customer_total: calcCustomerPrice(f.hire_cost, gm) }))
  }

  async function save() {
    if (!form.name.trim()) return toast('Name required', 'error')
    setSaving(true)
    // Required text fields default to '' (matches DB column defaults).
    // `... || null` would coerce empty strings to null and break the NOT NULL
    // constraint on description/vendor/notes/wbs. Only fields that are
    // actually nullable in the schema are allowed to be null.
    const payload = {
      project_id: activeProject!.id, hire_type: hireType,
      name: form.name.trim(),
      vendor: form.vendor || '',
      description: form.description || '',
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      hire_cost: form.hire_cost || 0,
      customer_total: form.customer_total || 0,
      gm_pct: form.gm_pct || 0,
      daily_rate: form.daily_rate || null,
      weekly_rate: form.weekly_rate || null,
      charge_unit: form.charge_unit || 'daily',
      qty: form.qty || 1,
      currency: form.currency || 'AUD',
      transport_in: form.transport_in || 0,
      transport_out: form.transport_out || 0,
      standby_rate: form.standby_rate || null,
      wbs: form.wbs || '',
      linked_po_id: form.linked_po_id || null,
      notes: form.notes || '',
      // Wet hire specific
      rates: hireType === 'wet' ? { ds: form.rate_ds, ns: form.rate_ns, wds: form.rate_wds, wns: form.rate_wns, sdd: form.rate_sdd, sdn: form.rate_sdn } : null,
      daa_rate: hireType === 'wet' ? (form.daa_rate || 0) : 0,
      crew: hireType === 'wet' ? form.crew : [],
      // Local hire specific
      active_days: hireType === 'local' ? (form.active_days ?? null) : null,
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

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })
  const totalCost = items.reduce((s, h) => s + (h.hire_cost || 0), 0)
  const totalSell = items.reduce((s, h) => s + (h.customer_total || 0), 0)

  // Cost preview for modal
  const days = daysBetween(form.start_date, form.end_date)
  const autoCost = autoCalcHireCost(form)
  const previewPeriods = form.charge_unit === 'weekly' ? Math.ceil(days / 7) : days

  // Local hire: cost split between active (usage) and standby days
  function calcLocalHireCost() {
    if (!days) return null
    const qty = form.qty || 1
    const activeDays = form.active_days !== null && form.standby_rate > 0
      ? Math.min(form.active_days ?? days, days) : days
    const standbyDays = form.standby_rate > 0 ? days - activeDays : 0
    const unit = form.charge_unit
    const activePeriods = unit === 'weekly' ? Math.ceil(activeDays / 7) : activeDays
    const standbyPeriods = unit === 'weekly' ? Math.ceil(standbyDays / 7) : standbyDays
    const hireCost = (form.daily_rate * activePeriods + (form.standby_rate || 0) * standbyPeriods) * qty
    return hireCost + (form.transport_in || 0) + (form.transport_out || 0)
  }

  // Wet hire: calc from calendar (for display in shift calendar modal)
  const SHIFT_KEYS = ['ds','ns','wds','wns','sdd','sdn'] as const
  type ShiftKey = typeof SHIFT_KEYS[number]
  const SHIFT_LABELS: Record<ShiftKey, string> = { ds:'Day Shift', ns:'Night Shift', wds:'Weekend Day', wns:'Weekend Night', sdd:'Standdown DS', sdn:'Standdown NS' }
  const SHIFT_COLORS: Record<ShiftKey, string> = { ds:'var(--accent)', ns:'#8b5cf6', wds:'var(--orange)', wns:'var(--red)', sdd:'#92400e', sdn:'#6b4c1e' }

  function calcWetCostFromCalendar(cal: typeof calendarData, ratesOverride?: Partial<typeof form>): { shiftCost: number; daaCost: number; total: number } {
    const r = ratesOverride || form
    const rateMap: Record<string, number> = { ds: r.rate_ds||0, ns: r.rate_ns||0, wds: r.rate_wds||0, wns: r.rate_wns||0, sdd: r.rate_sdd||0, sdn: r.rate_sdn||0 }
    let shiftCost = 0
    let activeDays = 0
    for (const shifts of Object.values(cal)) {
      let dayHasShift = false
      for (const k of SHIFT_KEYS) {
        if (shifts[k]) { shiftCost += rateMap[k] || 0; dayHasShift = true }
      }
      if (dayHasShift) activeDays++
    }
    const crewCount = Math.max(1, (form.crew || []).length)
    const daaCost = (r.daa_rate || 0) * crewCount * activeDays
    const transCost = (r.transport_in || 0) + (r.transport_out || 0)
    return { shiftCost, daaCost, total: shiftCost + daaCost + transCost }
  }

  function openCalendar(item: HireItem) {
    setCalendarItem(item)
    const cal: Record<string, Record<string, boolean>> = {}
    const calendar = (item as HireItem & { calendar?: {date:string;shifts:Record<string,boolean>}[] }).calendar || []
    for (const entry of calendar) { cal[entry.date] = { ...entry.shifts } }
    setCalendarData(cal)
  }

  async function saveCalendar() {
    if (!calendarItem) return
    const calArray = Object.entries(calendarData)
      .filter(([, shifts]) => SHIFT_KEYS.some(k => shifts[k]))
      .map(([date, shifts]) => ({ date, shifts }))
    const wetItem = calendarItem as HireItem & { calendar?: unknown[]; rates?: Record<string,number>; daa_rate?: number; crew?: {name:string;role:string}[]; transport_in?: number; transport_out?: number }
    const ratesFromItem = { rate_ds: wetItem.rates?.ds||0, rate_ns: wetItem.rates?.ns||0, rate_wds: wetItem.rates?.wds||0, rate_wns: wetItem.rates?.wns||0, rate_sdd: wetItem.rates?.sdd||0, rate_sdn: wetItem.rates?.sdn||0, daa_rate: wetItem.daa_rate||0, transport_in: wetItem.transport_in||0, transport_out: wetItem.transport_out||0, crew: wetItem.crew||[] }
    const { total } = calcWetCostFromCalendar(calendarData, ratesFromItem)
    const customerTotal = calcCustomerPrice(total, calendarItem.gm_pct)
    const { error } = await supabase.from('hire_items').update({
      calendar: calArray, hire_cost: total, customer_total: customerTotal,
    }).eq('id', calendarItem.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Shift calendar saved — costs updated', 'success')
    setCalendarItem(null); load()
  }

  function toggleShift(date: string, key: ShiftKey, checked: boolean) {
    setCalendarData(prev => {
      const updated = { ...prev, [date]: { ...(prev[date] || {}), [key]: checked } }
      if (!SHIFT_KEYS.some(k => updated[date][k])) { const { [date]: _, ...rest } = updated; return rest }
      return updated
    })
  }


  async function bulkLinkPO(poId: string) {
    if (!hireSelected.size) return
    setSaving(true)
    const { error } = await supabase.from('hire_items').update({ linked_po_id: poId || null }).in('id', [...hireSelected])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Linked ${hireSelected.size} item${hireSelected.size>1?'s':''} to PO`, 'success')
    setBulkPoModal(false); setHireSelected(new Set()); load()
  }

  async function applyBulkDates() {
    if (!hireSelected.size) return
    const updates: Record<string,unknown> = {}
    if (bulkEditForm.start_date) updates.start_date = bulkEditForm.start_date
    if (bulkEditForm.end_date)   updates.end_date   = bulkEditForm.end_date
    if (!Object.keys(updates).length) { toast('Enter at least one date', 'info'); return }
    const { error } = await supabase.from('hire_items').update(updates).in('id', [...hireSelected])
    if (error) { toast(error.message, 'error'); return }
    toast(`Updated ${hireSelected.size} item${hireSelected.size>1?'s':''}`, 'success')
    setHireSelected(new Set()); setBulkEditModal(false); setBulkEditForm({start_date:'',end_date:''}); load()
  }

  async function duplicateItem(h: HireItem) {
    if (!activeProject) return
    const copy = { ...h, id: undefined, name: h.name + ' (copy)', created_at: undefined, updated_at: undefined }
    delete (copy as Record<string,unknown>).id
    delete (copy as Record<string,unknown>).created_at
    delete (copy as Record<string,unknown>).updated_at
    const { error } = await supabase.from('hire_items').insert({ ...copy, project_id: activeProject.id })
    if (error) { toast(error.message, 'error'); return }
    toast(`Duplicated "${h.name}"`, 'success'); load()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>{TYPE_ICONS[hireType]} {TYPE_LABELS[hireType]}</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {items.length} items · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
{hireSelected.size>0 && <button className="btn btn-sm" style={{background:'#1e40af',color:'#fff'}} onClick={()=>setBulkPoModal(true)}>🔗 Link to PO ({hireSelected.size})</button>}
        <button className="btn btn-primary" onClick={openNew}>+ Add Item</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : items.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{TYPE_ICONS[hireType]}</div>
            <h3>No {TYPE_LABELS[hireType].toLowerCase()} items</h3>
            <p>Add equipment hire records for this project.</p>
          </div>
        ) : (
          <>
          {hireSelected.size>0 && (
            <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'8px 12px',background:'rgba(15,118,110,.08)',border:'1px solid rgba(15,118,110,.2)',borderRadius:'6px',marginBottom:'10px',flexWrap:'wrap'}}>
              <span style={{fontSize:'12px',fontWeight:600,color:'var(--mod-hr)'}}>{hireSelected.size} selected</span>
              <button className="btn btn-sm" onClick={()=>{setBulkEditForm({start_date:'',end_date:''});setBulkEditModal(true)}}>✏ Edit Dates</button>
              <button className="btn btn-sm" style={{background:'#1e40af',color:'#fff'}} onClick={()=>setBulkPoModal(true)}>🔗 Link to PO</button>
              <button className="btn btn-sm" style={{color:'var(--text3)'}} onClick={()=>setHireSelected(new Set())}>✕ Clear</button>
            </div>
          )}
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr><th style={{width:'32px',textAlign:'center'}}>
                  <input type="checkbox"
                    checked={items.length > 0 && items.every(h => hireSelected.has(h.id))}
                    ref={el => { if (el) el.indeterminate = hireSelected.size > 0 && !items.every(h => hireSelected.has(h.id)) }}
                    onChange={e => setHireSelected(e.target.checked ? new Set(items.map(h=>h.id)) : new Set())} />
                </th>
                  <th>Name</th><th>Vendor</th><th>Start</th><th>End</th><th>Days</th>
                  <th style={{ textAlign: 'right' }}>Rate</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(h => {
                  const hi = h as HireItem & { daily_rate?: number; charge_unit?: string }
                  const d = daysBetween(h.start_date || '', h.end_date || '')
                  return (
                    <tr key={h.id}>
                      <td><input type="checkbox" checked={hireSelected.has(h.id)} onChange={e=>setHireSelected(s=>{const n=new Set(s);e.target.checked?n.add(h.id):n.delete(h.id);return n})} /></td>
                      <td style={{ fontWeight: 500 }}>{h.name}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{h.vendor || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{h.start_date || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{h.end_date || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{d > 0 ? d : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>
                        {hi.daily_rate ? `${fmt(hi.daily_rate)}/${hi.charge_unit === 'weekly' ? 'wk' : 'day'}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(h.hire_cost || 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{fmt(h.customer_total || 0)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(h)}>Edit</button>
                        {hireType === 'wet' && (
                          <button className="btn btn-sm" style={{ marginLeft: '4px', background: 'var(--amber)', color: '#fff', border: 'none' }} onClick={() => openCalendar(h)}>📅 Calendar</button>
                        )}
                        <button className="btn btn-sm" style={{ marginLeft: '4px' }} title="Duplicate" onClick={() => duplicateItem(h)}>⧉</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(h)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                  <td colSpan={6} style={{ padding: '8px 12px' }}>Total</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(totalCost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--green)' }}>{fmt(totalSell)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? `Add ${TYPE_LABELS[hireType]}` : `Edit: ${(modal as HireItem).name}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Item Name *</label>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={hireType === 'dry' ? '25T Crawler Crane' : hireType === 'wet' ? '50T Mobile Crane + Operator' : 'Forklift'} autoFocus />
                </div>
                <div className="fg">
                  <label>Vendor</label>
                  <input className="input" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
                </div>
              </div>

              <div className="fg-row">
                <div className="fg">
                  <label>Start Date</label>
                  <input type="date" className="input" value={form.start_date}
                    onChange={e => setFormAndCalc(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>End Date</label>
                  <input type="date" className="input" value={form.end_date}
                    onChange={e => setFormAndCalc(f => ({ ...f, end_date: e.target.value }))} />
                </div>
                {hireType === 'local' && (
                  <div className="fg">
                    <label>Qty</label>
                    <input type="number" className="input" value={form.qty || 1} min={1}
                      onChange={e => setFormAndCalc(f => ({ ...f, qty: parseInt(e.target.value) || 1 }))} />
                  </div>
                )}
              </div>

              {/* ── WET HIRE SPECIFIC ── */}
              {hireType === 'wet' && (<>
                <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '11px', color: '#92400e', marginBottom: '4px' }}>
                  💡 Wet hire is billed by shift. Enter rates below, then use <b>Shift Calendar</b> to assign days and auto-calculate costs.
                </div>
                <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>Shift Rates ($/shift)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '8px' }}>
                  {(['ds','ns','wds','wns','sdd','sdn'] as ShiftKey[]).map(k => (
                    <div key={k}>
                      <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px', color: SHIFT_COLORS[k] }}>{SHIFT_LABELS[k]}</label>
                      <input type="number" className="input" min={0} value={(form[`rate_${k}` as keyof HireForm] as number) || ''}
                        onChange={e => setForm(f => ({ ...f, [`rate_${k}`]: parseFloat(e.target.value)||0 }))}
                        placeholder="$/shift" />
                    </div>
                  ))}
                </div>
                <div className="fg-row">
                  <div className="fg">
                    <label>DAA per person per day ($)</label>
                    <input type="number" className="input" min={0} value={form.daa_rate || ''}
                      onChange={e => setForm(f => ({ ...f, daa_rate: parseFloat(e.target.value)||0 }))} placeholder="0" />
                  </div>
                  <div className="fg">
                    <label>GM %</label>
                    <input type="number" className="input" value={form.gm_pct} onChange={e => updateGm(parseFloat(e.target.value)||0)} />
                  </div>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    Crew <button className="btn btn-sm" onClick={() => setForm(f => ({ ...f, crew: [...f.crew, { name:'', role:'' }] }))}>+ Add</button>
                  </div>
                  {form.crew.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                      <input className="input" placeholder="Name" value={c.name} onChange={e => setForm(f => ({ ...f, crew: f.crew.map((cr,j)=>j===i?{...cr,name:e.target.value}:cr) }))} />
                      <input className="input" placeholder="Role (Operator, Dogman...)" value={c.role} onChange={e => setForm(f => ({ ...f, crew: f.crew.map((cr,j)=>j===i?{...cr,role:e.target.value}:cr) }))} />
                      <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => setForm(f => ({ ...f, crew: f.crew.filter((_,j)=>j!==i) }))}>✕</button>
                    </div>
                  ))}
                  {form.crew.length === 0 && <div style={{ fontSize: '11px', color: 'var(--text3)' }}>No crew — DAA charged for 1 person</div>}
                </div>
              </>)}

              {/* ── DRY HIRE RATE FIELDS ── */}
              {hireType === 'dry' && (
                <div className="fg-row">
                  <div className="fg">
                    <label>Charge Unit</label>
                    <select className="input" value={form.charge_unit} onChange={e => setFormAndCalc(f => ({ ...f, charge_unit: e.target.value }))}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="fixed">Fixed (lump sum)</option>
                    </select>
                  </div>
                  {form.charge_unit !== 'fixed' && (
                    <div className="fg">
                      <label>Daily Rate</label>
                      <input type="number" className="input" value={form.daily_rate || ''} onChange={e => setFormAndCalc(f => ({ ...f, daily_rate: parseFloat(e.target.value)||0 }))} placeholder="$/day" />
                    </div>
                  )}
                  {form.charge_unit === 'weekly' && (
                    <div className="fg">
                      <label>Weekly Rate</label>
                      <input type="number" className="input" value={form.weekly_rate || ''} onChange={e => setFormAndCalc(f => ({ ...f, weekly_rate: parseFloat(e.target.value)||0 }))} placeholder="Override" />
                    </div>
                  )}
                </div>
              )}

              {/* ── LOCAL HIRE RATE FIELDS ── */}
              {hireType === 'local' && (<>
                <div className="fg-row">
                  <div className="fg">
                    <label>Charge Unit</label>
                    <select className="input" value={form.charge_unit} onChange={e => setFormAndCalc(f => ({ ...f, charge_unit: e.target.value }))}>
                      <option value="daily">Daily</option><option value="weekly">Weekly</option>
                    </select>
                  </div>
                  <div className="fg">
                    <label>Usage Rate ($/day when active)</label>
                    <input type="number" className="input" value={form.daily_rate || ''} onChange={e => setFormAndCalc(f => ({ ...f, daily_rate: parseFloat(e.target.value)||0 }))} placeholder="$/day" />
                  </div>
                  <div className="fg">
                    <label>Standby Rate <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>($/day when idle)</span></label>
                    <input type="number" className="input" value={form.standby_rate || ''} onChange={e => setFormAndCalc(f => ({ ...f, standby_rate: parseFloat(e.target.value)||0 }))} placeholder="0" />
                  </div>
                </div>
                {form.standby_rate > 0 && (
                  <div className="fg-row">
                    <div className="fg">
                      <label>Days Used (active) <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>of {days || '?'} total</span></label>
                      <input type="number" className="input" min={0} max={days || undefined} value={form.active_days ?? ''}
                        onChange={e => setFormAndCalc(f => ({ ...f, active_days: e.target.value===''?null:parseInt(e.target.value)||0 }))} placeholder={`All ${days||''} days`} />
                    </div>
                    <div className="fg" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Standby days: <b>{form.active_days!==null&&days>0?Math.max(0,days-(form.active_days??days)):0}</b></div>
                    </div>
                  </div>
                )}
                {/* Local cost preview */}
                {days > 0 && form.daily_rate > 0 && (() => {
                  const c = calcLocalHireCost()
                  if (!c) return null
                  const activeDays = form.active_days !== null && form.standby_rate > 0 ? Math.min(form.active_days??days, days) : days
                  const standbyDays = form.standby_rate > 0 ? days - activeDays : 0
                  return (
                    <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '11px', marginTop: '4px' }}>
                      <div style={{ fontWeight: 600, color: '#15803d', marginBottom: '4px' }}>📐 Auto-calculated cost</div>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontFamily: 'var(--mono)' }}>
                        <span>Active: {activeDays}d × ${form.daily_rate}/d = ${(activeDays * form.daily_rate * (form.qty||1)).toLocaleString()}</span>
                        {standbyDays > 0 && <span>Standby: {standbyDays}d × ${form.standby_rate}/d = ${(standbyDays * form.standby_rate * (form.qty||1)).toLocaleString()}</span>}
                        <span style={{ fontWeight: 700 }}>Total: ${c.toLocaleString()}</span>
                      </div>
                    </div>
                  )
                })()}
              </>)}

              <div className="fg-row">
                <div className="fg">
                  <label>Transport In</label>
                  <input type="number" className="input" value={form.transport_in || ''}
                    onChange={e => setFormAndCalc(f => ({ ...f, transport_in: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="fg">
                  <label>Transport Out</label>
                  <input type="number" className="input" value={form.transport_out || ''}
                    onChange={e => setFormAndCalc(f => ({ ...f, transport_out: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {['AUD', 'EUR', 'USD', 'GBP', 'NZD'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Auto-calculated preview — dry hire only */}
              {hireType === 'dry' && autoCost !== null && days > 0 && (
                <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', marginBottom: '10px' }}>
                  <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 600, marginBottom: '6px' }}>📐 Auto-calculated from rates & dates</div>
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: '#15803d', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>Duration</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '14px' }}>
                        {days}d{form.charge_unit === 'weekly' ? ` (${previewPeriods} wks)` : ''}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: '#15803d', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>Hire Cost</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '14px', color: '#f97316' }}>
                        {fmt(autoCost - (form.transport_in || 0) - (form.transport_out || 0))}
                      </div>
                    </div>
                    {(form.transport_in || form.transport_out) > 0 && (
                      <div>
                        <div style={{ fontSize: '10px', color: '#15803d', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>Transport</div>
                        <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '14px' }}>{fmt((form.transport_in || 0) + (form.transport_out || 0))}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: '10px', color: '#15803d', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>Total Cost</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '14px', color: '#f97316' }}>{fmt(autoCost)}</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="fg-row">
                <div className="fg">
                  <label>Hire Cost (total)</label>
                  <input type="number" className="input" value={form.hire_cost || ''}
                    onChange={e => { const c = parseFloat(e.target.value) || 0; setForm(f => ({ ...f, hire_cost: c, customer_total: calcCustomerPrice(c, f.gm_pct) })) }} />
                </div>
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={form.gm_pct} onChange={e => updateGm(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg">
                  <label>Sell Price</label>
                  <input type="number" className="input" value={form.customer_total || ''}
                    onChange={e => setForm(f => ({ ...f, customer_total: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>

              <div className="fg-row">
                <div className="fg">
                  <label>Linked PO</label>
                  <select className="input" value={form.linked_po_id} onChange={e => setForm(f => ({ ...f, linked_po_id: e.target.value }))}>
                    <option value="">— No PO —</option>
                    {pos.map(po => <option key={po.id} value={po.id}>{po.po_number || '—'} {po.vendor}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && <button className="btn" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={() => { del(modal as HireItem); setModal(null) }}>Delete</button>}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkEditModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'420px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Edit Dates — {hireSelected.size} Item{hireSelected.size>1?'s':''}</h3><button className="btn btn-sm" onClick={()=>setBulkEditModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>Leave a date blank to keep existing. Or pick a resource to copy their mob dates.</p>
              <div className="fg"><label>Start Date</label><input type="date" className="input" value={bulkEditForm.start_date} onChange={e=>setBulkEditForm(f=>({...f,start_date:e.target.value}))} /></div>
              <div className="fg"><label>End Date</label><input type="date" className="input" value={bulkEditForm.end_date} onChange={e=>setBulkEditForm(f=>({...f,end_date:e.target.value}))} /></div>
              {resources.filter(r=>r.mob_in||r.mob_out).length > 0 && (
                <div style={{marginTop:'10px'}}>
                  <div style={{fontSize:'11px',fontWeight:600,color:'var(--text2)',marginBottom:'6px'}}>Use resource mob dates:</div>
                  <div style={{display:'flex',flexDirection:'column',gap:'4px',maxHeight:'180px',overflowY:'auto'}}>
                    {resources.filter(r=>r.mob_in||r.mob_out).map(r => (
                      <button key={r.id} style={{padding:'6px 10px',border:'1px solid var(--border)',borderRadius:'5px',background:'var(--bg3)',cursor:'pointer',textAlign:'left',fontSize:'12px'}}
                        onClick={()=>setBulkEditForm({start_date:r.mob_in||'',end_date:r.mob_out||''})}>
                        <span style={{fontWeight:600}}>{r.name}</span>
                        <span style={{color:'var(--text3)',marginLeft:'8px'}}>{r.mob_in||'?'} → {r.mob_out||'?'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkEditModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyBulkDates}>Apply to Selected</button>
            </div>
          </div>
        </div>
      )}

      {bulkPoModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'460px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>🔗 Link {hireSelected.size} Item{hireSelected.size>1?'s':''} to PO</h3><button className="btn btn-sm" onClick={()=>setBulkPoModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'14px'}}>Choose a PO to link all selected hire items to:</p>
              <div style={{display:'flex',flexDirection:'column',gap:'6px',maxHeight:'340px',overflowY:'auto'}}>
                <button style={{padding:'12px',border:'1px solid var(--border)',borderRadius:'6px',background:'var(--bg2)',cursor:'pointer',textAlign:'left'}} onClick={()=>bulkLinkPO('')}>
                  <div style={{fontWeight:600,fontSize:'12px',color:'var(--red)'}}>✕ Remove PO link</div>
                </button>
                {pos.filter(p=>!['cancelled','closed'].includes(p.status)).map(po=>(
                  <button key={po.id} style={{padding:'12px',border:'1px solid var(--border)',borderRadius:'6px',background:'var(--bg2)',cursor:'pointer',textAlign:'left'}} onClick={()=>bulkLinkPO(po.id)}>
                    <div style={{fontWeight:700,fontSize:'12px',fontFamily:'var(--mono)'}}>{po.po_number||po.internal_ref||'—'}</div>
                    <div style={{fontSize:'11px',color:'var(--text3)'}}>{po.vendor} · {po.status}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer"><button className="btn" onClick={()=>setBulkPoModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* ── WET HIRE SHIFT CALENDAR MODAL ── */}
      {calendarItem && (() => {
        const item = calendarItem as HireItem & { rates?: Record<string,number>; daa_rate?: number; crew?: {name:string;role:string}[]; start_date?: string; end_date?: string; transport_in?: number; transport_out?: number }
        const start = item.start_date ? new Date(item.start_date + 'T00:00:00') : new Date()
        const end   = item.end_date   ? new Date(item.end_date   + 'T00:00:00') : new Date(start.getTime() + 30*86400000)
        const dates: Date[] = []
        const cur = new Date(start)
        while (cur <= end) { dates.push(new Date(cur)); cur.setDate(cur.getDate()+1) }
        const rateMap: Record<string,number> = { ds: item.rates?.ds||0, ns: item.rates?.ns||0, wds: item.rates?.wds||0, wns: item.rates?.wns||0, sdd: item.rates?.sdd||0, sdn: item.rates?.sdn||0 }
        const { shiftCost, daaCost, total } = calcWetCostFromCalendar(calendarData, { rate_ds: item.rates?.ds||0, rate_ns: item.rates?.ns||0, rate_wds: item.rates?.wds||0, rate_wns: item.rates?.wns||0, rate_sdd: item.rates?.sdd||0, rate_sdn: item.rates?.sdn||0, daa_rate: item.daa_rate||0, transport_in: item.transport_in||0, transport_out: item.transport_out||0, crew: item.crew||[] })
        const customerTotal = calcCustomerPrice(total, calendarItem.gm_pct)
        const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        return (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: '760px', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>📅 Shift Calendar — {item.name}</h3>
                <button className="btn btn-sm" onClick={() => setCalendarItem(null)}>✕</button>
              </div>
              <div className="modal-body">
                {/* Pattern shortcuts */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text3)', alignSelf: 'center' }}>Apply pattern:</span>
                  {/* Saved project patterns */}
                  {((activeProject as typeof activeProject & { shift_patterns?: {name:string;days:Record<number,Record<string,boolean>>}[] })?.shift_patterns as unknown as {name:string;days:Record<number,Record<string,boolean>>}[] || []).map((p, pi) => (
                    <button key={`saved-${pi}`} className="btn btn-sm" style={{ fontSize: '11px', background: 'var(--mod-hire,#f97316)', color: '#fff', border: 'none' }} onClick={() => {
                      const d: typeof calendarData = {}
                      dates.forEach(dt => {
                        const dow = dt.getDay()
                        const ds = dt.toISOString().slice(0,10)
                        const dayShifts = p.days?.[dow] || {}
                        if (Object.values(dayShifts).some(Boolean)) d[ds] = { ...dayShifts } as Record<string,boolean>
                      })
                      setCalendarData(d)
                    }}>{p.name}</button>
                  ))}
                  {/* Built-in presets */}
                  {[
                    { label: 'Standard (DS weekdays)', fn: () => { const d: typeof calendarData = {}; dates.forEach(dt => { const dow = dt.getDay(); const ds = dt.toISOString().slice(0,10); if (dow>0&&dow<6) d[ds]={ds:true,ns:false,wds:false,wns:false,sdd:false,sdn:false}; else if(dow===6) d[ds]={ds:false,ns:false,wds:true,wns:false,sdd:false,sdn:false} }); setCalendarData(d) }},
                    { label: 'DS Only', fn: () => { const d: typeof calendarData = {}; dates.forEach(dt => { const dow=dt.getDay(); const ds=dt.toISOString().slice(0,10); d[ds]={ds:dow>0&&dow<6,ns:false,wds:dow===6,wns:false,sdd:false,sdn:false} }); setCalendarData(d) }},
                    { label: 'DS+NS (24hr)', fn: () => { const d: typeof calendarData = {}; dates.forEach(dt => { const dow=dt.getDay(); const ds=dt.toISOString().slice(0,10); d[ds]={ds:dow>0&&dow<6,ns:dow>0&&dow<6,wds:dow===6,wns:dow===6,sdd:false,sdn:false} }); setCalendarData(d) }},
                    { label: 'Clear All', fn: () => setCalendarData({}) },
                  ].map(p => (
                    <button key={p.label} className="btn btn-sm" onClick={p.fn} style={{ fontSize: '11px' }}>{p.label}</button>
                  ))}
                </div>

                {/* Calendar table */}
                <div className="table-scroll-x" style={{ border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '12px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg3)' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontFamily: 'var(--mono)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>Date</th>
                        {SHIFT_KEYS.map(k => (
                          <th key={k} style={{ padding: '6px 8px', textAlign: 'center', fontSize: '10px', fontFamily: 'var(--mono)', color: SHIFT_COLORS[k], whiteSpace: 'nowrap' }}>
                            {SHIFT_LABELS[k].split(' ')[0]}<br/><span style={{ fontSize: '9px' }}>${rateMap[k]||0}</span>
                          </th>
                        ))}
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '10px', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>Day Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dates.map(dt => {
                        const dateStr = dt.toISOString().slice(0,10)
                        const dow = dt.getDay()
                        const isWknd = dow===0||dow===6
                        const shifts = calendarData[dateStr] || {}
                        const dayCost = SHIFT_KEYS.reduce((s,k) => s + (shifts[k] ? (rateMap[k]||0) : 0), 0)
                        return (
                          <tr key={dateStr} style={{ background: isWknd ? 'rgba(234,179,8,0.05)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: dow===0 ? 'var(--red)' : isWknd ? 'var(--amber)' : 'var(--text2)', fontWeight: isWknd ? 600 : 400 }}>{DAY_NAMES[dow]}</span>
                              <span style={{ color: 'var(--text3)', marginLeft: '6px' }}>{dt.toLocaleDateString('en-AU', { day:'2-digit', month:'2-digit' })}</span>
                            </td>
                            {SHIFT_KEYS.map(k => (
                              <td key={k} style={{ padding: '4px 8px', textAlign: 'center' }}>
                                <input type="checkbox" checked={!!shifts[k]} style={{ accentColor: SHIFT_COLORS[k], width: '15px', height: '15px', cursor: 'pointer' }}
                                  onChange={e => toggleShift(dateStr, k, e.target.checked)} />
                              </td>
                            ))}
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: dayCost ? 'var(--mod-hire,#f97316)' : 'var(--text3)', fontWeight: dayCost ? 600 : 400 }}>
                              {dayCost ? `$${dayCost.toLocaleString()}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Calendar cost summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', padding: '12px', background: 'var(--bg3)', borderRadius: '6px' }}>
                  {[
                    { label: 'Shift Cost', val: shiftCost, color: '#f97316' },
                    { label: `DAA Cost (${Math.max(1,(item.crew||[]).length)} crew)`, val: daaCost, color: 'var(--text2)' },
                    { label: 'Total Cost', val: total, color: '#f97316' },
                    { label: 'Customer Price', val: customerTotal, color: 'var(--green)' },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', marginBottom: '2px' }}>{s.label}</div>
                      <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'var(--mono)', color: s.color }}>${Math.round(s.val).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setCalendarItem(null)}>Close</button>
                <button className="btn btn-primary" onClick={saveCalendar}>Save Calendar &amp; Update Costs</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
