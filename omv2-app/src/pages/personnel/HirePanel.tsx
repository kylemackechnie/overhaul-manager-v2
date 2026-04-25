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
  linked_po_id: string; notes: string
}

const EMPTY: HireForm = {
  name: '', vendor: '', description: '',
  start_date: '', end_date: '',
  hire_cost: 0, customer_total: 0, gm_pct: 15, daily_rate: 0, weekly_rate: 0, charge_unit: 'daily',
  currency: 'AUD', transport_in: 0, transport_out: 0, standby_rate: 0, qty: 1,
  linked_po_id: '', notes: '',
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

  function openNew() {
    setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 })
    setModal('new')
  }
  function openEdit(h: HireItem) {
    const hi = h as HireItem & { daily_rate?: number; weekly_rate?: number; charge_unit?: string; transport_in?: number; transport_out?: number; standby_rate?: number; qty?: number }
    setForm({
      name: h.name, vendor: h.vendor, description: h.description,
      start_date: h.start_date || '', end_date: h.end_date || '',
      hire_cost: h.hire_cost, customer_total: h.customer_total, gm_pct: h.gm_pct,
      daily_rate: hi.daily_rate || 0, weekly_rate: hi.weekly_rate || 0,
      charge_unit: hi.charge_unit || 'daily',
      currency: h.currency, transport_in: hi.transport_in || 0, transport_out: hi.transport_out || 0,
      standby_rate: hi.standby_rate || 0, qty: hi.qty || 1,
      linked_po_id: h.linked_po_id || '', notes: h.notes,
    })
    setModal(h)
  }

  // When rate/date/transport changes, auto-calc cost
  function setFormAndCalc(updater: (f: HireForm) => HireForm) {
    setForm(prev => {
      const next = updater(prev)
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
    const payload = {
      project_id: activeProject!.id, hire_type: hireType,
      name: form.name.trim(), vendor: form.vendor, description: form.description,
      start_date: form.start_date || null, end_date: form.end_date || null,
      hire_cost: form.hire_cost, customer_total: form.customer_total, gm_pct: form.gm_pct,
      daily_rate: form.daily_rate || null, weekly_rate: form.weekly_rate || null,
      charge_unit: form.charge_unit, qty: form.qty || 1,
      currency: form.currency, transport_in: form.transport_in, transport_out: form.transport_out,
      standby_rate: form.standby_rate || null,
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

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })
  const totalCost = items.reduce((s, h) => s + (h.hire_cost || 0), 0)
  const totalSell = items.reduce((s, h) => s + (h.customer_total || 0), 0)

  // Cost preview for modal
  const days = daysBetween(form.start_date, form.end_date)
  const autoCost = autoCalcHireCost(form)
  const previewPeriods = form.charge_unit === 'weekly' ? Math.ceil(days / 7) : days

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>{TYPE_ICONS[hireType]} {TYPE_LABELS[hireType]}</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {items.length} items · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
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
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
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
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
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

              {/* Rate inputs */}
              <div className="fg-row">
                <div className="fg">
                  <label>Charge Unit</label>
                  <select className="input" value={form.charge_unit}
                    onChange={e => setFormAndCalc(f => ({ ...f, charge_unit: e.target.value }))}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="fixed">Fixed (lump sum)</option>
                  </select>
                </div>
                {form.charge_unit !== 'fixed' && (
                  <div className="fg">
                    <label>Daily Rate</label>
                    <input type="number" className="input" value={form.daily_rate || ''}
                      onChange={e => setFormAndCalc(f => ({ ...f, daily_rate: parseFloat(e.target.value) || 0 }))}
                      placeholder="$/day" />
                  </div>
                )}
                {form.charge_unit === 'weekly' && (
                  <div className="fg">
                    <label>Weekly Rate</label>
                    <input type="number" className="input" value={form.weekly_rate || ''}
                      onChange={e => setFormAndCalc(f => ({ ...f, weekly_rate: parseFloat(e.target.value) || 0 }))}
                      placeholder="Override weekly rate" />
                  </div>
                )}
              </div>

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

              {/* Auto-calculated preview */}
              {autoCost !== null && days > 0 && (
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
    </div>
  )
}
