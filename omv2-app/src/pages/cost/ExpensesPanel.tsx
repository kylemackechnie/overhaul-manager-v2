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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState<null|'wbs'|'gm'|'vendor'|'person'>(null)
  const [bulkVal, setBulkVal] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [expData, resData, wbsData, tceData] = await Promise.all([
      supabase.from('expenses').select('*').eq('project_id', pid).order('date', { ascending: false }),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
      // All TCE leaf lines — receipts can tag to either overhead OR skilled scope
      // (e.g. a fuel receipt for a skilled-labour scope item is legitimate).
      // Filtering by source='overhead' was hiding tags the user had set, which
      // caused saved tce_item_id values to silently fall off on re-edit when
      // the dropdown option list didn't include the previously-saved value.
      supabase.from('nrg_tce_lines').select('id,item_id,description,source')
        .eq('project_id', pid)
        .not('item_id', 'is', null).order('item_id'),
    ])
    setExpenses((expData.data || []) as Expense[])
    setResources((resData.data || []) as Resource[])
    setWbsList((wbsData.data || []) as WbsItem[])
    // Strip group-header rows (item_ids with exactly 3 numeric segments are headers).
    const leafLines = ((tceData.data || []) as {id:string;item_id:string|null;description:string;source:string}[])
      .filter(l => l.item_id && !/^\d+\.\d+\.\d+$/.test(l.item_id))
    setTceLines(leafLines)
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

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  function toggleAll(check: boolean) {
    setSelected(check ? new Set(filtered.map(e => e.id)) : new Set())
  }

  async function applyBulk() {
    if (!selected.size || !bulkModal) return
    const ids = [...selected]
    const updates: Promise<unknown>[] = []
    for (const id of ids) {
      const exp = expenses.find(e => e.id === id)
      if (!exp) continue
      let payload: Record<string, unknown> = {}
      if (bulkModal === 'wbs')    payload = { wbs: bulkVal }
      if (bulkModal === 'vendor') payload = { vendor: bulkVal }
      if (bulkModal === 'person') payload = { name: bulkVal }
      if (bulkModal === 'gm') {
        const gm = parseFloat(bulkVal) || 0
        const sell = exp.cost_ex_gst > 0 && gm > 0 ? calcSell(exp.cost_ex_gst, gm) : 0
        payload = { gm_pct: gm, sell_price: sell }
      }
      updates.push(Promise.resolve(supabase.from('expenses').update(payload).eq('id', id)))
    }
    await Promise.all(updates)
    toast(`${ids.length} items updated`, 'success')
    setBulkModal(null); setBulkVal(''); setSelected(new Set()); load()
  }

  async function bulkDelete() {
    if (!selected.size || !confirm(`Delete ${selected.size} expense${selected.size !== 1 ? 's' : ''}?`)) return
    await Promise.all([...selected].map(id => Promise.resolve(supabase.from('expenses').delete().eq('id', id))))
    toast(`${selected.size} deleted`, 'info')
    setSelected(new Set()); load()
  }

  async function bulkChargeable(val: boolean) {
    if (!selected.size) return
    const updates = [...selected].map(id => {
      const exp = expenses.find(e => e.id === id)
      if (!exp) return Promise.resolve()
      const sell = val && exp.cost_ex_gst > 0 && exp.gm_pct > 0 ? calcSell(exp.cost_ex_gst, exp.gm_pct) : 0
      return Promise.resolve(supabase.from('expenses').update({ sell_price: sell }).eq('id', id))
    })
    await Promise.all(updates)
    toast(`${selected.size} items set to ${val ? 'chargeable' : 'non-chargeable'}`, 'success')
    setSelected(new Set()); load()
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
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('cost_tracking')}>+ Add Expense</button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="card" style={{marginBottom:'12px',padding:'10px 14px',borderLeft:'3px solid #f472b6',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:'12px',fontWeight:600,color:'#f472b6',marginRight:'4px'}}>{selected.size} selected</span>
          <button className="btn btn-sm" onClick={()=>{setBulkVal('');setBulkModal('wbs')}}>📂 Set WBS</button>
          <button className="btn btn-sm" onClick={()=>{setBulkVal('');setBulkModal('vendor')}}>🏪 Set Vendor</button>
          <button className="btn btn-sm" onClick={()=>{setBulkVal('');setBulkModal('person')}}>👤 Set Person</button>
          <button className="btn btn-sm" onClick={()=>{setBulkVal(String(activeProject?.default_gm||15));setBulkModal('gm')}}>📊 Set GM%</button>
          <button className="btn btn-sm" onClick={()=>bulkChargeable(true)}>✓ Chargeable</button>
          <button className="btn btn-sm" onClick={()=>bulkChargeable(false)}>✗ Non-chargeable</button>
          <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={bulkDelete}>🗑 Delete</button>
          <button className="btn btn-sm" style={{marginLeft:'auto'}} onClick={()=>setSelected(new Set())}>Clear</button>
        </div>
      )}

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
                  <th style={{width:'28px',textAlign:'center',padding:'8px 6px'}}>
                    <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={e=>toggleAll(e.target.checked)} style={{accentColor:'#f472b6'}} />
                  </th>
                  <th>Date</th><th>Description</th><th>Category</th>
                  <th style={{ textAlign: 'right' }}>Cost (ex GST)</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th>WBS</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td style={{textAlign:'center',padding:'5px 6px'}}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={()=>toggleSelect(e.id)} style={{accentColor:'#f472b6'}} />
                    </td>
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
        <div className="modal-overlay">
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
                    {form.tce_item_id && !tceLines.some(l => l.item_id === form.tce_item_id) && (
                      <option value={form.tce_item_id}>{form.tce_item_id} (not in current TCE)</option>
                    )}
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

      {/* Bulk Edit Modal */}
      {bulkModal && (
        <div className="modal-overlay" onClick={()=>setBulkModal(null)}>
          <div className="modal" style={{maxWidth:'380px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>Bulk Set {bulkModal === 'wbs' ? 'WBS Code' : bulkModal === 'gm' ? 'GM%' : bulkModal === 'vendor' ? 'Vendor' : 'Person'} ({selected.size} items)</h3>
              <button className="btn btn-sm" onClick={()=>setBulkModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {bulkModal === 'wbs' ? (
                <div className="fg">
                  <label>WBS Code</label>
                  <select className="input" value={bulkVal} onChange={e=>setBulkVal(e.target.value)}>
                    <option value="">— No WBS —</option>
                    {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
                  </select>
                </div>
              ) : bulkModal === 'gm' ? (
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={bulkVal} onChange={e=>setBulkVal(e.target.value)} step="0.5" min="0" max="99" autoFocus />
                </div>
              ) : bulkModal === 'vendor' ? (
                <div className="fg">
                  <label>Vendor</label>
                  <input className="input" value={bulkVal} onChange={e=>setBulkVal(e.target.value)} placeholder="Enter vendor name" autoFocus />
                </div>
              ) : (
                <div className="fg">
                  <label>Person</label>
                  <select className="input" value={bulkVal} onChange={e=>setBulkVal(e.target.value)}>
                    <option value="">— Select —</option>
                    {resources.map(r=><option key={r.id} value={r.name}>{r.name}{r.role?` — ${r.role}`:''}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#f472b6',border:'none'}} onClick={applyBulk}>Apply to {selected.size} items</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
