import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Expense, ExpenseLine, Resource, WbsItem } from '../../types'
import { downloadCSV } from '../../lib/csv'
import { uploadReceipt, deleteReceipt, getSignedUrl, fileIcon, fileName } from '../../lib/receiptStorage'

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
  const [lines, setLines] = useState<ExpenseLine[]>([])  // lines for the currently open modal
  const [showLines, setShowLines] = useState(false)  // whether lines section is expanded
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState<null|'wbs'|'gm'|'vendor'|'person'>(null)
  const [bulkVal, setBulkVal] = useState('')
  const [dragOverId, setDragOverId] = useState<string|null>(null)
  const [uploadingId, setUploadingId] = useState<string|null>(null)

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
    setLines([])
    setShowLines(false)
    setModal('new')
  }

  async function openEdit(e: Expense) {
    setForm({
      resource_id: e.resource_id || '', category: e.category,
      vendor: e.vendor || '', description: e.description, date: e.date || '',
      amount: e.amount, cost_ex_gst: e.cost_ex_gst, sell_price: e.sell_price,
      gm_pct: e.gm_pct, currency: e.currency, wbs: e.wbs, notes: e.notes,
      chargeable: e.sell_price > 0, tce_item_id: e.tce_item_id || '',
    })
    // Load existing lines for this expense
    const { data } = await supabase.from('expense_lines').select('*').eq('expense_id', e.id).order('sort_order')
    const existingLines = (data || []) as ExpenseLine[]
    setLines(existingLines)
    setShowLines(existingLines.length > 0)
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


  async function handleReceiptUpload(expense: Expense, file: File) {
    if (file.size > 10 * 1024 * 1024) { toast('File too large — max 10MB', 'error'); return }
    setUploadingId(expense.id)
    const { path, error } = await uploadReceipt(activeProject!.id, expense.id, file)
    if (error) { toast('Upload failed: ' + error, 'error'); setUploadingId(null); return }
    const newPaths = [...(expense.receipt_paths || []), path]
    await supabase.from('expenses').update({ receipt_paths: newPaths }).eq('id', expense.id)
    setExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, receipt_paths: newPaths } : e))
    toast('Receipt attached', 'success')
    setUploadingId(null)
  }

  async function removeReceipt(expense: Expense, path: string) {
    if (!confirm('Remove this receipt?')) return
    await deleteReceipt(path)
    const newPaths = (expense.receipt_paths || []).filter(p => p !== path)
    await supabase.from('expenses').update({ receipt_paths: newPaths }).eq('id', expense.id)
    setExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, receipt_paths: newPaths } : e))
    toast('Receipt removed', 'info')
  }

  async function openReceipt(path: string) {
    const url = await getSignedUrl(path)
    if (!url) { toast('Could not open receipt', 'error'); return }
    window.open(url, '_blank')
  }


  function addLine() {
    const newLine: ExpenseLine = {
      id: 'new_' + Date.now(), expense_id: '',
      description: '', cost_ex_gst: 0, amount: 0, sell_price: 0,
      gm_pct: form.gm_pct, chargeable: true, tce_item_id: form.tce_item_id || null,
      sort_order: lines.length, created_at: '',
    }
    setLines(prev => [...prev, newLine])
  }

  function updateLine(id: string, field: keyof ExpenseLine, value: unknown) {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      // Auto-calc sell when cost or chargeable or gm changes
      if (field === 'cost_ex_gst' || field === 'chargeable' || field === 'gm_pct') {
        const cost = field === 'cost_ex_gst' ? (value as number) : l.cost_ex_gst
        const ch = field === 'chargeable' ? (value as boolean) : l.chargeable
        const gm = field === 'gm_pct' ? (value as number) : l.gm_pct
        updated.sell_price = ch && cost > 0 && gm > 0 && gm < 100 ? parseFloat((cost / (1 - gm/100)).toFixed(2)) : 0
        if (field === 'cost_ex_gst') updated.amount = parseFloat(((value as number) * 1.1).toFixed(2))
      }
      return updated
    }))
  }

  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.id !== id))
  }

  // Computed rollup when lines are present
  const linesTotalCost = lines.reduce((s, l) => s + (l.cost_ex_gst || 0), 0)
  const linesTotalSell = lines.reduce((s, l) => s + (l.sell_price || 0), 0)
  const hasLines = lines.length > 0

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
    // If lines present, override top-level cost/sell with rollup
    if (hasLines) {
      payload.cost_ex_gst = linesTotalCost
      payload.amount = parseFloat((linesTotalCost * 1.1).toFixed(2))
      payload.sell_price = linesTotalSell
    }

    let expenseId: string
    if (modal === 'new') {
      const { data, error } = await supabase.from('expenses').insert(payload).select('id').single()
      if (error || !data) { toast(error?.message || 'Insert failed', 'error'); setSaving(false); return }
      expenseId = data.id
      toast('Expense added', 'success')
    } else {
      expenseId = (modal as Expense).id
      const { error } = await supabase.from('expenses').update(payload).eq('id', expenseId)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }

    // Save lines: delete existing then re-insert
    if (lines.length > 0) {
      await supabase.from('expense_lines').delete().eq('expense_id', expenseId)
      const linePayloads = lines.map((l, i) => ({
        expense_id: expenseId, description: l.description, cost_ex_gst: l.cost_ex_gst,
        amount: l.amount, sell_price: l.sell_price, gm_pct: l.gm_pct,
        chargeable: l.chargeable, tce_item_id: l.tce_item_id || null, sort_order: i,
      }))
      await supabase.from('expense_lines').insert(linePayloads)
    } else if (modal !== 'new') {
      // Lines cleared — delete any existing
      await supabase.from('expense_lines').delete().eq('expense_id', expenseId)
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
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
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
                  <th>Receipts</th><th>WBS</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}
                    onDragOver={ev=>{ev.preventDefault();setDragOverId(e.id)}}
                    onDragLeave={()=>setDragOverId(null)}
                    onDrop={async ev=>{ev.preventDefault();setDragOverId(null);const f=ev.dataTransfer.files[0];if(f)await handleReceiptUpload(e,f)}}
                    style={{background: dragOverId===e.id ? 'rgba(16,185,129,0.08)' : undefined, outline: dragOverId===e.id ? '2px dashed var(--accent)' : undefined, transition:'background 0.1s'}}>
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
                    <td>
                      <div style={{display:'flex',gap:'4px',flexWrap:'wrap',alignItems:'center'}}>
                        {(e.receipt_paths||[]).map(p => (
                          <span key={p} style={{display:'inline-flex',alignItems:'center',gap:'2px',fontSize:'10px',padding:'1px 5px',borderRadius:'3px',background:'var(--bg3)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--text2)'}}
                            title={fileName(p)} onClick={()=>openReceipt(p)}>
                            {fileIcon(p)} {fileName(p).slice(0,12)}{fileName(p).length>12?'…':''}
                            <span style={{marginLeft:'2px',color:'var(--text3)',cursor:'pointer'}}
                              onClick={ev=>{ev.stopPropagation();removeReceipt(e,p)}}>×</span>
                          </span>
                        ))}
                        {uploadingId === e.id
                          ? <span className="spinner" style={{width:'12px',height:'12px'}} />
                          : <label style={{cursor:'pointer',fontSize:'10px',color:'var(--text3)',padding:'1px 4px',border:'1px dashed var(--border)',borderRadius:'3px'}} title="Attach receipt">
                              📎<input type="file" accept="image/*,.pdf" style={{display:'none'}}
                                onChange={async ev=>{const f=ev.target.files?.[0];if(f)await handleReceiptUpload(e,f);ev.target.value=''}} />
                            </label>
                        }
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.wbs || '—'}</td>
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
          <div className="modal" style={{ maxWidth: hasLines || showLines ? '720px' : '540px' }} onClick={e => e.stopPropagation()}>
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

              {/* ── Line Items (optional split) ── */}
              <div style={{borderTop:'1px solid var(--border)',marginTop:'8px',paddingTop:'8px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px'}}>
                  <button type="button" className="btn btn-sm" style={{fontSize:'11px',background:'none',border:'1px dashed var(--border)',color:'var(--text3)'}}
                    onClick={()=>{ if(!showLines){ setShowLines(true); if(lines.length===0) addLine() } else { if(lines.length===0) setShowLines(false) } }}>
                    {showLines ? '▼ Line Items (split receipt)' : '▶ Split this receipt into line items'}
                  </button>
                  {hasLines && (
                    <span style={{fontSize:'11px',color:'var(--text3)'}}>
                      Cost: <b>{fmt(linesTotalCost)}</b> · Sell: <b style={{color:'var(--green)'}}>{linesTotalSell > 0 ? fmt(linesTotalSell) : '—'}</b>
                    </span>
                  )}
                </div>
                {showLines && (
                  <div>
                    {/* Line items grid */}
                    <div style={{fontSize:'10px',color:'var(--text3)',display:'grid',gridTemplateColumns:'1fr 80px 32px 44px 80px 1fr 24px',gap:'4px',marginBottom:'3px',padding:'0 2px'}}>
                      <span>Description</span><span style={{textAlign:'right'}}>Cost ex GST</span><span style={{textAlign:'center'}}>Ch.</span><span>GM%</span><span style={{textAlign:'right'}}>Sell</span><span>TCE</span><span/>
                    </div>
                    {lines.map(l => (
                      <div key={l.id} style={{display:'grid',gridTemplateColumns:'1fr 80px 32px 44px 80px 1fr 24px',gap:'4px',marginBottom:'4px',alignItems:'center'}}>
                        <input className="input" style={{fontSize:'12px',padding:'3px 6px'}} value={l.description} placeholder="Description"
                          onChange={e=>updateLine(l.id,'description',e.target.value)} />
                        <input type="number" className="input" style={{fontSize:'12px',padding:'3px 6px',textAlign:'right'}} value={l.cost_ex_gst||''} placeholder="0.00"
                          onChange={e=>updateLine(l.id,'cost_ex_gst',parseFloat(e.target.value)||0)} />
                        <div style={{textAlign:'center'}}>
                          <input type="checkbox" checked={l.chargeable} style={{accentColor:'var(--accent)',width:'14px',height:'14px',cursor:'pointer'}}
                            onChange={e=>updateLine(l.id,'chargeable',e.target.checked)} />
                        </div>
                        <input type="number" className="input" style={{fontSize:'12px',padding:'3px 6px'}} value={l.chargeable ? l.gm_pct : ''} placeholder="—" disabled={!l.chargeable}
                          onChange={e=>updateLine(l.id,'gm_pct',parseFloat(e.target.value)||0)} />
                        <input type="number" className="input" style={{fontSize:'12px',padding:'3px 6px',textAlign:'right',color:'var(--green)'}} value={l.sell_price||''} placeholder="—" disabled={!l.chargeable}
                          onChange={e=>updateLine(l.id,'sell_price',parseFloat(e.target.value)||0)} />
                        <select className="input" style={{fontSize:'11px',padding:'3px 4px'}} value={l.tce_item_id||''}
                          onChange={e=>updateLine(l.id,'tce_item_id',e.target.value||null)}>
                          <option value="">— No TCE —</option>
                          {tceLines.map(t=><option key={t.id} value={t.item_id||''}>{t.item_id}</option>)}
                        </select>
                        <button type="button" style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:'14px',lineHeight:1,padding:'0'}}
                          onClick={()=>removeLine(l.id)}>×</button>
                      </div>
                    ))}
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:'6px'}}>
                      <button type="button" className="btn btn-sm" style={{fontSize:'11px'}} onClick={addLine}>+ Add line</button>
                      {hasLines && linesTotalCost !== form.cost_ex_gst && (
                        <span style={{fontSize:'10px',color:'#d97706'}}>⚠ Lines total ({fmt(linesTotalCost)}) differs from receipt total ({fmt(form.cost_ex_gst)})</span>
                      )}
                    </div>
                  </div>
                )}
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
