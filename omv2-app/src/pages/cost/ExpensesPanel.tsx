import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Expense, Resource, WbsItem } from '../../types'
import { downloadCSV } from '../../lib/csv'

const CATEGORIES = ['Travel','Meals','Accommodation','Equipment','Tools','Freight','Consumables','PPE','Other']

type ExpenseForm = {
  resource_id: string; category: string; description: string; vendor: string; date: string
  amount: number; cost_ex_gst: number; sell_price: number; gm_pct: number
  currency: string; wbs: string; notes: string; chargeable: boolean; tce_item_id: string
}

const EMPTY: ExpenseForm = {
  resource_id:'', category:'', description:'', vendor:'', date: new Date().toISOString().slice(0,10),
  amount:0, cost_ex_gst:0, sell_price:0, gm_pct:15,
  currency:'AUD', wbs:'', notes:'', chargeable:true, tce_item_id:'',
}

function calcSell(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}

export function ExpensesPanel() {
  const { activeProject } = useAppStore()
  const { canWrite } = usePermissions()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [tceLines, setTceLines] = useState<{id:string;item_id:string|null;description:string;source:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Expense>(null)
  const [form, setForm] = useState<ExpenseForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [expData, resData, wbsData, tceData] = await Promise.all([
      supabase.from('expenses').select('*').eq('project_id', pid).order('date', { ascending: false }),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
      // Only overhead leaf lines — skilled labour is timesheet-driven, not expense-driven
      supabase.from('nrg_tce_lines').select('id,item_id,description,source')
        .eq('project_id', pid).eq('source', 'overhead')
        .not('item_id', 'is', null).order('item_id'),
    ])
    setExpenses((expData.data || []) as Expense[])
    setResources((resData.data || []) as Resource[])
    setWbsList((wbsData.data || []) as WbsItem[])
    // Filter to overhead leaf lines only (3-segment IDs are group headers, exclude them)
    const overheadLeaves = ((tceData.data || []) as {id:string;item_id:string|null;description:string;source:string}[])
      .filter(l => l.item_id && !/^\d+\.\d+\.\d+$/.test(l.item_id))
    setTceLines(overheadLeaves)
    setLoading(false)
  }

  async function handleImportExpenses(text: string) {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) { toast('No data', 'error'); return }
    setImporting(true)
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase())
    const col = (...terms: string[]) => headers.findIndex(h => terms.some(t => h.includes(t)))
    const dateI = col('date'), catI = col('category','cat'), descI = col('description','desc'),
          amtI = col('amount','receipt'), costI = col('cost ex','cost_ex'), sellI = col('sell','sell price'),
          nameI = col('name','employee','person'), wbsI = col('wbs')
    let added = 0
    for (const line of lines.slice(1)) {
      const cols = line.split(',').map(c2 => c2.trim().replace(/^"|"$/g,''))
      const desc = descI >= 0 ? cols[descI] : ''
      if (!desc) continue
      const cost = costI >= 0 ? parseFloat(cols[costI])||0 : (amtI >= 0 ? parseFloat(cols[amtI])||0 : 0)
      const payload = {
        project_id: activeProject!.id,
        date: dateI >= 0 ? cols[dateI] || null : null,
        category: catI >= 0 ? cols[catI] || 'General' : 'General',
        description: desc,
        amount: amtI >= 0 ? parseFloat(cols[amtI])||0 : cost,
        cost_ex_gst: cost,
        sell_price: sellI >= 0 ? parseFloat(cols[sellI])||0 : 0,
        gm_pct: activeProject?.default_gm || 15,
        currency: 'AUD',
        wbs: wbsI >= 0 ? cols[wbsI]||'' : '',
        name: nameI >= 0 ? cols[nameI]||'' : '',
        notes: '',
      }
      const { error } = await supabase.from('expenses').insert(payload)
      if (!error) added++
    }
    toast(`Imported ${added} expenses`, 'success')
    setImporting(false); setShowImport(false); setImportText(''); load()
  }

  function openNew() {
    setForm({ ...EMPTY, gm_pct: activeProject?.default_gm || 15 })
    setModal('new')
  }

  function openEdit(e: Expense) {
    setForm({
      resource_id: e.resource_id || '', category: e.category,
      vendor: e.vendor || '', description: e.description, date: e.date || '',
      amount: e.amount, cost_ex_gst: e.cost_ex_gst, sell_price: e.sell_price,
      gm_pct: e.gm_pct, currency: e.currency, wbs: e.wbs, notes: e.notes,
      chargeable: e.sell_price > 0, tce_item_id: e.tce_item_id || '',
    })
    setModal(e)
  }

  // updateCost replaced by updateAmountInclGst / updateAmountExGst below

  function updateAmountInclGst(incl: number) {
    const exGst = incl > 0 ? parseFloat((incl / 1.1).toFixed(2)) : 0
    setForm(f => ({ ...f, amount: incl, cost_ex_gst: exGst, sell_price: f.chargeable ? calcSell(exGst, f.gm_pct) : 0 }))
  }

  function updateAmountExGst(ex: number) {
    const incl = ex > 0 ? parseFloat((ex * 1.1).toFixed(2)) : 0
    setForm(f => ({ ...f, amount: incl, cost_ex_gst: ex, sell_price: f.chargeable ? calcSell(ex, f.gm_pct) : 0 }))
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
      tce_item_id: form.tce_item_id || null,
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
        <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('cost_tracking')}>+ Add Expense</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      {showImport && (
        <div className="card" style={{marginBottom:'16px'}}>
          <div style={{fontWeight:600,fontSize:'13px',marginBottom:'6px'}}>Bulk Import Expenses</div>
          <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'8px'}}>CSV with columns: <code>Date, Category, Description, Amount, Cost Ex GST, Sell, WBS, Name</code></p>
          <textarea className="input" rows={5} value={importText} onChange={e=>setImportText(e.target.value)}
            placeholder="Date,Category,Description,Amount,Cost Ex GST&#10;2026-04-25,Accommodation,Hotel - 3 nights,330,300" style={{fontFamily:'var(--mono)',fontSize:'12px',resize:'vertical'}} />
          <div style={{display:'flex',gap:'8px',marginTop:'10px'}}>
            <button className="btn btn-primary" onClick={()=>handleImportExpenses(importText)} disabled={importing||!importText.trim()}>
              {importing?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Import
            </button>
            <label className="btn" style={{cursor:'pointer'}}>📂 From File<input type="file" accept=".csv" style={{display:'none'}} onChange={async e=>{const f=e.target.files?.[0];if(f){const t=await f.text();setImportText(t)}}} /></label>
            <button className="btn" onClick={()=>{setShowImport(false);setImportText('')}}>Cancel</button>
          </div>
        </div>
      )}

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
                  <label>Receipt Amount (inc GST) <span style={{fontSize:'10px',color:'var(--text3)'}}>auto-fills ex GST</span></label>
                  <input type="number" className="input" value={form.amount || ''} onChange={e => updateAmountInclGst(parseFloat(e.target.value) || 0)} placeholder="0.00" />
                </div>
                <div className="fg">
                  <label>Cost (ex GST) <span style={{fontSize:'10px',color:'var(--text3)'}}>auto-fills inc GST</span></label>
                  <input type="number" className="input" value={form.cost_ex_gst || ''} onChange={e => updateAmountExGst(parseFloat(e.target.value) || 0)} placeholder="0.00" />
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
                <label>NRG TCE Scope <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '11px' }}>— links expense to a TCE line for actuals</span></label>
                {tceLines.length > 0 ? (
                  <select className="input" value={form.tce_item_id} onChange={e => setForm(f => ({ ...f, tce_item_id: e.target.value }))}>
                    <option value="">— No TCE Link —</option>
                    {/* CRITICAL: value is item_id (stable text), never the UUID id */}
                    {tceLines.map(l => <option key={l.id} value={l.item_id || ''}>{l.item_id} — {l.description}</option>)}
                  </select>
                ) : (
                  <input className="input" value={form.tce_item_id} onChange={e => setForm(f => ({ ...f, tce_item_id: e.target.value }))} placeholder="e.g. 2.02.4.1 (import TCE to enable dropdown)" />
                )}
              </div>
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !canWrite('cost_tracking')}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
