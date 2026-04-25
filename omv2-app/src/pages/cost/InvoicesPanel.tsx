import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import type { Invoice, PurchaseOrder, InvoiceStatus } from '../../types'

declare const XLSX: {
  read: (data: Uint8Array, opts: { type: string }) => { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json: (sheet: unknown, opts?: { header?: number; defval?: unknown }) => unknown[][] }
}

const STATUS_FLOW: InvoiceStatus[] = ['received','checked','approved','paid']
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  received:{bg:'#dbeafe',color:'#1e40af'}, checked:{bg:'#fef3c7',color:'#92400e'},
  approved:{bg:'#d1fae5',color:'#065f46'}, paid:{bg:'#e5e7eb',color:'#374151'},
  disputed:{bg:'#fee2e2',color:'#7f1d1d'},
}

const EMPTY = { po_id:'', invoice_number:'', vendor_ref:'', amount:'', currency:'AUD', invoice_date:'', period_from:'', period_to:'', notes:'', tce_item_id:'' }

export function InvoicesPanel() {
  const { activeProject, currentUser } = useAppStore()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [tceLines, setTceLines] = useState<{id:string;item_id:string|null;description:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Invoice>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [sapImporting, setSapImporting] = useState(false)
  const [sapRows, setSapRows] = useState<{invNum:string;vendor:string;poNum:string;poId:string|null;date:string;due:string;currency:string;amount:number;isDup:boolean;include:boolean}[]>([])
  const [showSap, setShowSap] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [historyModal, setHistoryModal] = useState<Invoice|null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [invData, poData] = await Promise.all([
      supabase.from('invoices').select('*,po:purchase_orders(id,po_number,vendor)').eq('project_id',pid).order('invoice_date',{ascending:false}),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id',pid).order('po_number'),
    ])
    setInvoices((invData.data || []) as Invoice[])
    setPos((poData.data || []) as PurchaseOrder[])
    const tceRes = await supabase.from('nrg_tce_lines').select('id,item_id,description').eq('project_id',pid).order('item_id')
    setTceLines((tceRes.data||[]) as {id:string;item_id:string|null;description:string}[])
    setLoading(false)
  }

  async function cycleStatus(inv: Invoice) {
    const order = ['received','checked','approved','paid','disputed']
    const cur = order.indexOf(inv.status)
    const next = order[(cur + 1) % order.length]
    const historyEntry = { to: next, by: currentUser?.name || '', byEmail: currentUser?.email || '', at: new Date().toISOString() }
    const history = [...(inv.status_history as typeof historyEntry[] || []), historyEntry]
    await supabase.from('invoices').update({ status: next, status_history: history }).eq('id', inv.id)
    load()
  }

  function openNew() {
    const maxNum = invoices.reduce((m, i) => {
      const n = parseInt(String(i.invoice_number || '').replace(/\D/g, '')) || 0
      return Math.max(m, n)
    }, 0)
    const today = new Date().toISOString().slice(0, 10)
    setForm({ ...EMPTY, invoice_number: String(maxNum + 1).padStart(4, '0'), invoice_date: today })
    setModal('new')
  }
  function openEdit(inv: Invoice) {
    setForm({
      po_id: inv.po_id || '', invoice_number: inv.invoice_number,
      vendor_ref: inv.vendor_ref, amount: inv.amount.toString(),
      currency: inv.currency, invoice_date: inv.invoice_date || '',
      period_from: inv.period_from || '', period_to: inv.period_to || '',
      notes: inv.notes, tce_item_id: inv.tce_item_id || '',
    })
    setModal(inv)
  }

  async function save() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      po_id: form.po_id || null,
      invoice_number: form.invoice_number.trim(),
      vendor_ref: form.vendor_ref.trim(),
      amount: parseFloat(form.amount) || 0,
      currency: form.currency,
      invoice_date: form.invoice_date || null,
      period_from: form.period_from || null,
      period_to: form.period_to || null,
      notes: form.notes,
      tce_item_id: form.tce_item_id || null,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('invoices').insert({
        ...payload, status: 'received',
        status_history: [{ to:'received', by: currentUser?.name||'', byEmail: currentUser?.email||'', at: new Date().toISOString() }]
      })
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Invoice added','success')
    } else {
      const { error } = await supabase.from('invoices').update(payload).eq('id',(modal as Invoice).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Invoice saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function transition(inv: Invoice, to: InvoiceStatus) {
    const history = [...(inv.status_history || []), {
      from: inv.status, to, by: currentUser?.name||'', byEmail: currentUser?.email||'',
      at: new Date().toISOString()
    }]
    const { error } = await supabase.from('invoices').update({ status: to, status_history: history }).eq('id', inv.id)
    if (error) { toast(error.message,'error'); return }
    toast(`Moved to ${to}`, 'success'); load()
  }

  async function del(inv: Invoice) {
    if (!confirm(`Delete invoice ${inv.invoice_number || inv.id.slice(0,8)}?`)) return
    await supabase.from('invoices').delete().eq('id', inv.id)
    toast('Deleted','info'); load()
  }

  const filtered = invoices.filter(i => statusFilter === 'all' || i.status === statusFilter)
  const totalValue = filtered.reduce((s, i) => s + (i.amount || 0), 0)
  function excelDateToISO(v: unknown): string {
    if (!v) return ''
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000))
      return d.toISOString().slice(0, 10)
    }
    const s = String(v).trim()
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`
    return ''
  }

  async function handleSapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setSapImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      if (!rows.length) { toast('File appears empty', 'error'); setSapImporting(false); return }
      const hdrs = (rows[0] as string[]).map(h => String(h || '').trim().toLowerCase())
      const col = (...names: string[]) => names.map(n => hdrs.indexOf(n.toLowerCase())).find(i => i >= 0) ?? -1
      const refI = col('reference'); const amtI = col('net amount', 'amount')
      if (refI < 0 || amtI < 0) { toast('Missing required columns (Reference, Net Amount)', 'error'); setSapImporting(false); return }
      const vendI = col('vendor details', 'vendor'); const poI = col('purchasing document', 'po number')
      const dateI = col('document date', 'invoice date'); const dueI = col('net due date', 'due date')
      const curI = col('currency')
      const existNums = new Set(invoices.map(i => i.invoice_number.trim()))
      const parsed = rows.slice(1).filter(r => (r as unknown[])[refI]).map(row => {
        const r = row as unknown[]
        const invNum = String(r[refI] || '').trim()
        const poNum = poI >= 0 ? String(r[poI] || '').trim() : ''
        const matchedPO = pos.find(p => p.po_number && p.po_number.trim() === poNum)
        return {
          invNum, vendor: vendI >= 0 ? String(r[vendI] || '').trim() : '',
          poNum, poId: matchedPO ? matchedPO.id : null,
          date: dateI >= 0 ? excelDateToISO(r[dateI]) : '',
          due: dueI >= 0 ? excelDateToISO(r[dueI]) : '',
          currency: curI >= 0 ? String(r[curI] || 'AUD').trim() : 'AUD',
          amount: parseFloat(String(r[amtI] || '0')) || 0,
          isDup: existNums.has(invNum), include: !existNums.has(invNum),
        }
      }).filter(r => r.invNum)
      setSapRows(parsed); setShowSap(true)
    } catch (e2) { toast((e2 as Error).message, 'error') }
    setSapImporting(false)
    e.target.value = ''
  }

  async function confirmSapImport() {
    const toImport = sapRows.filter(r => r.include && !r.isDup)
    if (!toImport.length) { toast('No invoices to import', 'error'); return }
    setSapImporting(true)
    let imported = 0
    for (const row of toImport) {
      const payload = {
        project_id: activeProject!.id,
        invoice_number: row.invNum, vendor_ref: row.vendor,
        po_id: row.poId || null, amount: row.amount, currency: row.currency,
        invoice_date: row.date || null, due_date: row.due || null,
        status: 'received', source: 'sap_import', notes: row.poNum ? `SAP PO: ${row.poNum}` : '',
      }
      const { error } = await supabase.from('invoices').insert(payload)
      if (!error) imported++
    }
    toast(`Imported ${imported} invoices`, 'success')
    setShowSap(false); setSapRows([]); setSapImporting(false); load()
  }

    function exportCSV() {
    downloadCSV(
      [
        ['Invoice #','Vendor','Date','Due Date','Amount','Currency','Status','Notes'],
        ...invoices.map(i => [i.invoice_number||'', i.vendor_ref||'', i.invoice_date||'', i.due_date||'', i.amount||0, i.currency||'AUD', i.status||'', i.notes||''])
      ],
      'invoices_'+(activeProject?.name||'project')
    )
  }

  const fmtMoney = (n: number) => '$' + n.toLocaleString('en-AU', {minimumFractionDigits:0,maximumFractionDigits:0})

  function nextStatus(status: InvoiceStatus): InvoiceStatus|null {
    const idx = STATUS_FLOW.indexOf(status)
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx+1] : null
  }


  // Keyboard shortcut: N = New
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !(e.target as Element)?.closest('input,textarea,select')) {
        openNew()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div style={{padding:'24px',maxWidth:'1200px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Invoices</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{invoices.length} invoices · {fmtMoney(invoices.reduce((s,i)=>s+(i.amount||0),0))} total</p>
        </div>
        <div style={{display:"flex",gap:"8px"}}><button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button><label className="btn btn-sm" style={{cursor:"pointer"}}>{sapImporting?<span className="spinner" style={{width:"14px",height:"14px"}}/>:"📥"} SAP Import<input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleSapFile}/></label><button className="btn btn-primary" onClick={openNew}>+ New Invoice</button></div>
      </div>

      {/* Status filter + summary */}
      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
        {(['all','received','checked','approved','paid','disputed'] as string[]).map(s => {
          const count = s === 'all' ? invoices.length : invoices.filter(i=>i.status===s).length
          return (
            <button key={s} className="btn btn-sm"
              style={{background:statusFilter===s?'var(--accent)':'var(--bg)',color:statusFilter===s?'#fff':'var(--text)'}}
              onClick={() => setStatusFilter(s)}>
              {s.charAt(0).toUpperCase()+s.slice(1)} ({count})
            </button>
          )
        })}
        {statusFilter !== 'all' && <span style={{fontSize:'12px',color:'var(--text3)',marginLeft:'8px'}}>{fmtMoney(totalValue)}</span>}
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">💳</div>
          <h3>No invoices</h3>
          <p>Add invoices to track costs against this project.</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr>
                <th>Invoice #</th><th>PO</th><th>Status</th>
                <th style={{textAlign:'right'}}>Amount</th>
                <th>Date</th><th>Period</th><th>Actions</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.received
                const next = nextStatus(inv.status as InvoiceStatus)
                const po = inv.po as unknown as {po_number:string,vendor:string}|null
                return (
                  <tr key={inv.id}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:'12px'}}>{inv.invoice_number || '—'}</td>
                    <td style={{fontSize:'12px',color:'var(--text2)'}}>{po ? `${po.po_number||''} ${po.vendor||''}`.trim() : '—'}</td>
                    <td><span className="badge" style={{...sc,cursor:'pointer'}} title="Click to advance status" onClick={()=>cycleStatus(inv)}>{inv.status}</span></td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:600}}>{fmtMoney(inv.amount)}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{inv.invoice_date || '—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>
                      {inv.period_from && inv.period_to ? `${inv.period_from} → ${inv.period_to}` : '—'}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {next && inv.status !== 'disputed' && (
                        <button className="btn btn-sm btn-primary" style={{fontSize:'11px',padding:'3px 8px'}} onClick={() => transition(inv, next)}>
                          → {next}
                        </button>
                      )}
                      {inv.status !== 'disputed' && inv.status !== 'paid' && (
                        <button className="btn btn-sm" style={{fontSize:'11px',padding:'3px 8px',marginLeft:'4px',color:'var(--red)'}}
                          onClick={() => transition(inv, 'disputed')}>Dispute</button>
                      )}
                      <button className="btn btn-sm" style={{fontSize:'11px',padding:'3px 8px',marginLeft:'4px'}}
                        onClick={() => setHistoryModal(inv)}>History</button>
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={() => openEdit(inv)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(inv)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      {showSap && sapRows.length > 0 && (
        <div className="modal-overlay" onClick={() => setShowSap(false)}>
          <div className="modal" style={{maxWidth:'800px',maxHeight:'90vh',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>SAP Invoice Import — {sapRows.length} rows found</h3>
              <button className="btn btn-sm" onClick={() => setShowSap(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{display:'flex',gap:'10px',marginBottom:'12px',flexWrap:'wrap'}}>
                {[
                  {label:'New', value: sapRows.filter(r=>!r.isDup).length, color:'var(--green)'},
                  {label:'Duplicates (skipped)', value: sapRows.filter(r=>r.isDup).length, color:'var(--amber)'},
                  {label:'PO Matched', value: sapRows.filter(r=>r.poId).length, color:'var(--accent)'},
                ].map(t=>(
                  <div key={t.label} style={{padding:'6px 12px',borderRadius:'6px',background:'var(--bg3)',fontSize:'12px'}}>
                    <span style={{fontWeight:700,color:t.color,fontFamily:'var(--mono)'}}>{t.value}</span> {t.label}
                  </div>
                ))}
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{fontSize:'11px',width:'100%'}}>
                  <thead><tr style={{background:'var(--bg3)'}}>
                    <th style={{padding:'6px 8px'}}><input type="checkbox" onChange={e => setSapRows(rows => rows.map(r => ({...r, include: r.isDup ? false : e.target.checked})))} /></th>
                    <th>Invoice #</th><th>Vendor</th><th>PO #</th><th>Date</th><th style={{textAlign:'right'}}>Amount</th><th>Cur</th><th>Status</th>
                  </tr></thead>
                  <tbody>
                    {sapRows.map((r,i) => (
                      <tr key={i} style={{opacity: r.isDup ? 0.5 : 1, background: r.isDup ? 'var(--bg3)' : ''}}>
                        <td style={{padding:'4px 8px'}}><input type="checkbox" checked={r.include} disabled={r.isDup} onChange={e => setSapRows(rows => rows.map((row,j) => j===i?{...row,include:e.target.checked}:row))} /></td>
                        <td style={{fontFamily:'var(--mono)',fontWeight:600}}>{r.invNum}</td>
                        <td style={{maxWidth:'150px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.vendor||'—'}</td>
                        <td style={{fontFamily:'var(--mono)',color:r.poId?'var(--green)':'var(--amber)'}}>{r.poNum||'—'}</td>
                        <td style={{fontFamily:'var(--mono)'}}>{r.date||'—'}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>{r.amount.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                        <td style={{fontSize:'10px',color:'var(--text3)'}}>{r.currency}</td>
                        <td>{r.isDup?<span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'3px',background:'#fef3c7',color:'#d97706'}}>Duplicate</span>:r.poId?<span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'3px',background:'#d1fae5',color:'#065f46'}}>PO Matched</span>:<span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'3px',background:'#fee2e2',color:'#991b1b'}}>No PO</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowSap(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmSapImport} disabled={sapImporting}>
                {sapImporting?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Import {sapRows.filter(r=>r.include&&!r.isDup).length} Invoices
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{maxWidth:'580px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'New Invoice' : 'Edit Invoice'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Invoice Number</label>
                  <input className="input" value={form.invoice_number} onChange={e=>setForm(f=>({...f,invoice_number:e.target.value}))} placeholder="e.g. INV-2026-001" autoFocus />
                </div>
                <div className="fg">
                  <label>Vendor Ref</label>
                  <input className="input" value={form.vendor_ref} onChange={e=>setForm(f=>({...f,vendor_ref:e.target.value}))} />
                </div>
              </div>
              <div className="fg">
                <label>Linked PO</label>
                <select className="input" value={form.po_id} onChange={e=>setForm(f=>({...f,po_id:e.target.value}))}>
                  <option value="">— No PO —</option>
                  {pos.map(po=><option key={po.id} value={po.id}>{po.po_number||'No PO#'} — {po.vendor}</option>)}
                </select>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Amount</label>
                  <input type="number" className="input" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {['AUD','EUR','USD','GBP'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Invoice Date</label>
                  <input type="date" className="input" value={form.invoice_date} onChange={e=>setForm(f=>({...f,invoice_date:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Period From</label>
                  <input type="date" className="input" value={form.period_from} onChange={e=>setForm(f=>({...f,period_from:e.target.value}))} />
                </div>
                <div className="fg">
                  <label>Period To</label>
                  <input type="date" className="input" value={form.period_to} onChange={e=>setForm(f=>({...f,period_to:e.target.value}))} />
                </div>
              </div>
              {tceLines.length > 0 && (
                <div className="fg">
                  <label>NRG TCE Line <span style={{fontWeight:400,color:'var(--text3)',fontSize:'11px'}}>— optional, counts as actuals in KPI/Actuals</span></label>
                  <select className="input" value={form.tce_item_id} onChange={e=>setForm(f=>({...f,tce_item_id:e.target.value}))}>
                    <option value="">— No TCE Link —</option>
                    {tceLines.map(l=><option key={l.id} value={l.id}>{l.item_id||''} — {l.description}</option>)}
                  </select>
                </div>
              )}
              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyModal && (
        <div className="modal-overlay" onClick={() => setHistoryModal(null)}>
          <div className="modal" style={{maxWidth:'480px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Invoice History: {historyModal.invoice_number}</h3>
              <button className="btn btn-sm" onClick={() => setHistoryModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {(historyModal.status_history || []).length === 0 ? (
                <p style={{color:'var(--text3)',fontSize:'13px'}}>No history recorded.</p>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {[...(historyModal.status_history || [])].reverse().map((h, i) => (
                    <div key={i} style={{display:'flex',gap:'12px',alignItems:'flex-start',padding:'8px',background:'var(--bg2)',borderRadius:'6px'}}>
                      <span className="badge" style={STATUS_COLORS[h.to] || STATUS_COLORS.received}>{h.to}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'12px',fontWeight:500}}>{h.by || h.byEmail || 'System'}</div>
                        <div style={{fontSize:'11px',color:'var(--text3)'}}>{h.at ? new Date(h.at).toLocaleString() : ''}</div>
                        {h.note && <div style={{fontSize:'12px',color:'var(--text2)',marginTop:'2px'}}>{h.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
