import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Expense, Resource, WbsItem } from '../../types'
import { downloadCSV } from '../../lib/csv'

const CATEGORIES = ['Travel','Meals','Accommodation','Equipment','Tools','Freight','Consumables','PPE','Other']

type ExpenseForm = {
  resource_id: string; category: string; description: string; date: string
  amount: number; cost_ex_gst: number; sell_price: number; gm_pct: number
  currency: string; wbs: string; notes: string; chargeable: boolean
}

const EMPTY: ExpenseForm = {
  resource_id:'', category:'', description:'', date: new Date().toISOString().slice(0,10),
  amount:0, cost_ex_gst:0, sell_price:0, gm_pct:15,
  currency:'AUD', wbs:'', notes:'', chargeable:true,
}

function calcSell(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}

export function ExpensesPanel() {
  const { activeProject } = useAppStore()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Expense>(null)
  const [form, setForm] = useState<ExpenseForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [expData, resData, wbsData] = await Promise.all([
      supabase.from('expenses').select('*').eq('project_id', pid).order('date', { ascending: false }),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
    ])
    setExpenses((expData.data || []) as Expense[])
    setResources((resData.data || []) as Resource[])
    setWbsList((wbsData.data || []) as WbsItem[])
    setLoading(false)
  }

  function openNew() {
    setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 })
    setModal('new')
  }

  function openEdit(e: Expense) {
    setForm({
      resource_id: e.resource_id || '', category: e.category,
      description: e.description, date: e.date || '',
      amount: e.amount, cost_ex_gst: e.cost_ex_gst, sell_price: e.sell_price,
      gm_pct: e.gm_pct, currency: e.currency, wbs: e.wbs, notes: e.notes,
      chargeable: e.sell_price > 0,
    })
    setModal(e)
  }

  function updateCost(cost: number) {
    setForm(f => ({ ...f, cost_ex_gst: cost, sell_price: f.chargeable ? calcSell(cost, f.gm_pct) : 0 }))
  }

  function updateGm(gm: number) {
    setForm(f => ({ ...f, gm_pct: gm, sell_price: f.chargeable ? calcSell(f.cost_ex_gst, gm) : 0 }))
  }

  function toggleChargeable(ch: boolean) {
    setForm(f => ({ ...f, chargeable: ch, sell_price: ch ? calcSell(f.cost_ex_gst, f.gm_pct) : 0 }))
  }

  async function save() {
    if (!form.description.trim()) return toast('Description required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      resource_id: form.resource_id || null,
      category: form.category, description: form.description.trim(),
      date: form.date || null, amount: form.amount,
      cost_ex_gst: form.cost_ex_gst, sell_price: form.sell_price,
      gm_pct: form.gm_pct, currency: form.currency, wbs: form.wbs, notes: form.notes,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('expenses').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Expense added', 'success')
    } else {
      const { error } = await supabase.from('expenses').update(payload).eq('id', (modal as Expense).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(e: Expense) {
    if (!confirm(`Delete expense "${e.description}"?`)) return
    await supabase.from('expenses').delete().eq('id', e.id)
    toast('Deleted', 'info'); load()
  }


  function exportCSV() {
    downloadCSV(
      [
        ['Date', 'Category', 'Description', 'Amount', 'Cost ex GST', 'Sell', 'Currency', 'WBS', 'Notes'],
        ...expenses.map(e => [e.date||'', e.category||'', e.description||'', e.amount||0, e.cost_ex_gst||0, e.sell_price||0, e.currency||'AUD', e.wbs||'', e.notes||''])
      ],
      'expenses_' + (activeProject?.name || 'project')
    )
  }
  const filtered = expenses.filter(e =>
    !search || [e.description, e.category, e.wbs].some(f => (f||'').toLowerCase().includes(search.toLowerCase()))
  )
  const totalCost = expenses.reduce((s, e) => s + (e.cost_ex_gst || 0), 0)
  const totalSell = expenses.reduce((s, e) => s + (e.sell_price || 0), 0)
  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Expenses</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {expenses.length} items · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Expense</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      <input className="input" style={{ maxWidth: '280px', marginBottom: '16px' }}
        placeholder="Search description, category..." value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🧾</div>
            <h3>No expenses</h3>
            <p>Add receipts and expenses for this project.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Category</th>
                  <th style={{ textAlign: 'right' }}>Cost (ex GST)</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th>WBS</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{e.date || '—'}</td>
                    <td style={{ fontWeight: 500 }}>{e.description}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text3)' }}>{e.category || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(e.cost_ex_gst || 0)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: e.sell_price > 0 ? 'var(--green)' : 'var(--text3)' }}>
                      {e.sell_price > 0 ? fmt(e.sell_price) : '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{e.wbs || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(e)}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(e)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add Expense' : 'Edit Expense'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Description</label>
                  <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What was purchased" autoFocus />
                </div>
                <div className="fg">
                  <label>Date</label>
                  <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Category</label>
                  <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">— Select —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Person</label>
                  <select className="input" value={form.resource_id} onChange={e => setForm(f => ({ ...f, resource_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {resources.map(r => <option key={r.id} value={r.id}>{r.name} {r.role ? `— ${r.role}` : ''}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Receipt Amount (inc GST)</label>
                  <input type="number" className="input" value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
                </div>
                <div className="fg">
                  <label>Cost (ex GST)</label>
                  <input type="number" className="input" value={form.cost_ex_gst || ''} onChange={e => updateCost(parseFloat(e.target.value) || 0)} placeholder="0.00" />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {['AUD', 'EUR', 'USD', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row" style={{ alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.chargeable} onChange={e => toggleChargeable(e.target.checked)} />
                  Chargeable to customer
                </label>
                {form.chargeable && (
                  <>
                    <div className="fg">
                      <label>GM %</label>
                      <input type="number" className="input" value={form.gm_pct} onChange={e => updateGm(parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="fg">
                      <label>Sell Price</label>
                      <input type="number" className="input" value={form.sell_price || ''} onChange={e => setForm(f => ({ ...f, sell_price: parseFloat(e.target.value) || 0 }))} />
                    </div>
                  </>
                )}
              </div>
              <div className="fg">
                <label>WBS Code</label>
                <select className="input" value={form.wbs} onChange={e => setForm(f => ({ ...f, wbs: e.target.value }))}>
                  <option value="">— No WBS —</option>
                  {wbsList.map(w => <option key={w.id} value={w.code}>{w.code} {w.name ? `— ${w.name}` : ''}</option>)}
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
