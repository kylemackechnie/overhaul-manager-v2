import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import { SavedViewsBar } from '../../components/ui/SavedViewsBar'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { uploadReceipt, deleteReceipt, getSignedUrl, fileIcon, fileName } from '../../lib/receiptStorage'

// ── Invoice column registry ───────────────────────────────────────────────────
const INV_COLS = [
  { id: 'invoice',      label: 'Invoice #',      defaultVisible: true,  group: 'Core' },
  { id: 'po_vendor',    label: 'PO / Vendor',    defaultVisible: true,  group: 'Core' },
  { id: 'inv_date',     label: 'Inv Date',       defaultVisible: true,  group: 'Dates' },
  { id: 'due_date',     label: 'Due Date',       defaultVisible: true,  group: 'Dates' },
  { id: 'expected',     label: 'Expected',       defaultVisible: true,  group: 'Financials' },
  { id: 'amount',       label: 'Amount',         defaultVisible: true,  group: 'Financials' },
  { id: 'status',       label: 'Status',         defaultVisible: true,  group: 'Workflow' },
  { id: 'last_action',  label: 'Last Action',    defaultVisible: true,  group: 'Workflow' },
  { id: 'dtp',          label: 'DTP',            defaultVisible: true,  group: 'Workflow' },
  { id: 'actions',      label: 'Actions',        defaultVisible: true,  group: 'Workflow' },
  // Optional — hidden by default
  { id: 'vendor_ref',   label: 'Vendor Ref',     defaultVisible: false, group: 'Core' },
  { id: 'vendor_details', label: 'Vendor Details', defaultVisible: false, group: 'Core' },
  { id: 'currency',     label: 'Currency',       defaultVisible: false, group: 'Financials' },
  { id: 'period_from',  label: 'Period From',    defaultVisible: false, group: 'Dates' },
  { id: 'period_to',    label: 'Period To',      defaultVisible: false, group: 'Dates' },
  { id: 'tce_item',     label: 'TCE Item',       defaultVisible: false, group: 'Financials' },
  { id: 'sap_doc',      label: 'SAP Doc #',      defaultVisible: false, group: 'Core' },
  { id: 'notes',        label: 'Notes',          defaultVisible: false, group: 'Workflow' },
] as const

type InvColId = typeof INV_COLS[number]['id']
const INV_COL_GROUPS = ['Core', 'Dates', 'Financials', 'Workflow'] as const

// ── Status workflow (mirrors HTML INV_STATUS / INV_TRANSITIONS) ───────────────
const INV_STATUS: Record<string,{label:string;color:string;bg:string}> = {
  received: { label:'Received', color:'#d97706', bg:'#fef3c7' },
  checked:  { label:'Checked',  color:'#7c3aed', bg:'#ede9fe' },
  approved: { label:'Approved', color:'#0369a1', bg:'#dbeafe' },
  paid:     { label:'Paid',     color:'#059669', bg:'#d1fae5' },
  disputed: { label:'Disputed', color:'#dc2626', bg:'#fee2e2' },
}
const INV_TRANSITIONS: Record<string,string[]> = {
  received: ['checked', 'disputed'],
  checked:  ['approved', 'disputed'],
  approved: ['paid', 'disputed'],
  paid:     ['disputed'],
  disputed: ['checked'],
}
const BTN_STYLE: Record<string,string> = {
  checked:  'background:#7c3aed;color:#fff;border:none',
  approved: 'background:#0369a1;color:#fff;border:none',
  paid:     'background:#059669;color:#fff;border:none',
  disputed: 'background:#dc2626;color:#fff;border:none',
}
const BTN_LABEL: Record<string,string> = {
  checked:'Check ✓', approved:'Approve ✓', paid:'Mark Paid', disputed:'Dispute',
}
const STATUS_ORDER_NUM: Record<string,number> = { received:0, checked:1, disputed:2, approved:3, paid:4 }

const fmt = (v: number|null|undefined, sym = '$') => v ? sym + Number(v).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'
const fmtK = (v: number) => '$' + Math.round(v).toLocaleString()
const fmtDate = (s?: string|null) => s ? s.split('-').reverse().join('/') : '—'
const fmtDateTime = (iso?: string|null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false})
}
const fmtUser = (email?: string|null) => {
  if (!email || email === 'local') return 'Local user'
  return email.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase())
}

interface StatusHistoryEntry { status: string; setBy: string; setAt: string; note?: string }

interface Invoice {
  id: string; project_id: string; po_id: string|null; invoice_number: string|null
  vendor_ref: string|null; vendor_details: string|null; status: string; amount: number|null
  expected_amount: number|null; currency: string|null; invoice_date: string|null
  due_date: string|null; paid_date: string|null; received_date: string|null
  period_from: string|null; period_to: string|null; source: string|null
  sap_doc_number: string|null; sap_wbs: string|null; tce_item_id: string|null
  status_history: StatusHistoryEntry[]; notes: string|null; dispute_note: string|null
  receipt_paths: string[]
  created_at: string
}

interface PO { id: string; po_number: string|null; internal_ref: string|null; vendor: string|null; currency: string|null }

type SortCol = 'invoice'|'po'|'date'|'due'|'expected'|'amount'|'status'|'lastaction'
type SortDir = 'asc'|'desc'

type InvForm = {
  invoice_number: string; vendor_ref: string; vendor_details: string
  po_id: string; tce_item_id: string; status: string; currency: string
  amount: string; expected_amount: string
  invoice_date: string; due_date: string; period_from: string; period_to: string
  notes: string
}
const EMPTY_FORM: InvForm = {
  invoice_number:'', vendor_ref:'', vendor_details:'', po_id:'', tce_item_id:'',
  status:'received', currency:'AUD', amount:'', expected_amount:'',
  invoice_date:'', due_date:'', period_from:'', period_to:'', notes:'',
}

// ── SAP Invoice Import ────────────────────────────────────────────────────────
interface SapInvRow {
  invoiceNumber: string; vendorDetails: string; vendorNumber: string
  poNumber: string; matchedPOId: string|null
  invoiceDate: string; dueDate: string; currency: string; amount: number
  isDup: boolean; include: boolean
}

/** Excel serial date → ISO string (mirrors HTML _excelSerialToISO) */
function excelSerialToISO(serial: unknown): string {
  const n = parseFloat(String(serial))
  if (isNaN(n) || n < 1) return ''
  const d = new Date((n - 25569) * 86400 * 1000)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function InvoicesPanel() {
  const { activeProject, currentUser } = useAppStore()
  const { canWrite } = usePermissions()
  const { prefs, setPref } = useUserPrefs()

  // Column visibility
  const [showColPicker, setShowColPicker] = useState(false)
  const invHiddenStored = (prefs.hidden_cols as Record<string, string[]> | undefined)?.['invoices']
  const invHidden = new Set<string>(invHiddenStored ?? INV_COLS.filter(c => !c.defaultVisible).map(c => c.id))
  function isInvVisible(id: InvColId) { return !invHidden.has(id) }
  function setInvHidden(next: Set<string>) {
    const existing = (prefs.hidden_cols as Record<string, string[]> | undefined) ?? {}
    setPref('hidden_cols', { ...existing, invoices: Array.from(next) })
  }
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [pos, setPos] = useState<PO[]>([])
  const [tceLines, setTceLines] = useState<{ id: string; item_id: string; description: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Invoice>(null)
  const [form, setForm] = useState<InvForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, _setFilterStatus] = useState((prefs.inv_filter_status as string) || '')
  const [filterPO, setFilterPO] = useState('')
  const [sortCol, _setSortCol] = useState<SortCol>((prefs.inv_sort_col as SortCol) || 'status')
  const [sortDir, _setSortDir] = useState<SortDir>((prefs.inv_sort_dir as SortDir) || 'asc')

  function setFilterStatus(v: string)  { _setFilterStatus(v); setPref('inv_filter_status', v) }
  function setSortCol(v: SortCol)      { _setSortCol(v);      setPref('inv_sort_col', v) }
  function setSortDir(v: SortDir)      { _setSortDir(v);      setPref('inv_sort_dir', v) }
  const [historyModal, setHistoryModal] = useState<Invoice|null>(null)
  const [disputeModal, setDisputeModal] = useState<{inv:Invoice;note:string}|null>(null)
  const [payDateModal, setPayDateModal] = useState<{inv:Invoice;date:string}|null>(null)
  const [sapModal, setSapModal] = useState(false)
  const [sapRows, setSapRows] = useState<SapInvRow[]>([])
  const [dragOverId, setDragOverId] = useState<string|null>(null)
  const [uploadingId, setUploadingId] = useState<string|null>(null)
  const [sapParsing, setSapParsing] = useState(false)
  const [sapImporting, setSapImporting] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])


  async function handleReceiptUpload(inv: Invoice, file: File) {
    if (file.size > 10 * 1024 * 1024) { toast('File too large — max 10MB', 'error'); return }
    setUploadingId(inv.id)
    const { path, error } = await uploadReceipt(activeProject!.id, inv.id, file)
    if (error) { toast('Upload failed: ' + error, 'error'); setUploadingId(null); return }
    const newPaths = [...(inv.receipt_paths || []), path]
    await supabase.from('invoices').update({ receipt_paths: newPaths }).eq('id', inv.id)
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, receipt_paths: newPaths } : i))
    toast('Receipt attached', 'success')
    setUploadingId(null)
  }

  async function removeInvReceipt(inv: Invoice, path: string) {
    if (!confirm('Remove this receipt?')) return
    await deleteReceipt(path)
    const newPaths = (inv.receipt_paths || []).filter((p: string) => p !== path)
    await supabase.from('invoices').update({ receipt_paths: newPaths }).eq('id', inv.id)
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, receipt_paths: newPaths } : i))
    toast('Receipt removed', 'info')
  }

  async function openInvReceipt(path: string) {
    const url = await getSignedUrl(path)
    if (!url) { toast('Could not open receipt', 'error'); return }
    window.open(url, '_blank')
  }

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [invRes, poRes, tceRes] = await Promise.all([
      supabase.from('invoices').select('*').eq('project_id', pid),
      supabase.from('purchase_orders').select('id,po_number,internal_ref,vendor,currency').eq('project_id', pid),
      supabase.from('nrg_tce_lines').select('id,item_id,description').eq('project_id', pid).order('item_id'),
    ])
    setInvoices((invRes.data||[]) as Invoice[])
    setPos((poRes.data||[]) as PO[])
    setTceLines((tceRes.data||[]) as { id: string; item_id: string; description: string }[])
    setLoading(false)
  }

  const poMap = Object.fromEntries(pos.map(p => [p.id, p]))

  // ── Approval workflow transition ──────────────────────────────────────────
  async function transition(inv: Invoice, toStatus: string) {
    if (toStatus === 'disputed') { setDisputeModal({ inv, note:'' }); return }
    if (toStatus === 'paid') { setPayDateModal({ inv, date: new Date().toISOString().slice(0,10) }); return }
    await doTransition(inv, toStatus, '')
  }

  async function doTransition(inv: Invoice, toStatus: string, note: string, paidDate?: string) {
    const now = new Date().toISOString()
    const setBy = currentUser?.email || currentUser?.name || 'local'
    const entry: StatusHistoryEntry = { status: toStatus, setBy, setAt: now, note }
    const newHistory = [...(inv.status_history || []), entry]
    const updatePayload: Record<string,unknown> = { status: toStatus, status_history: newHistory, updated_at: now }
    if (paidDate) updatePayload.paid_date = paidDate
    const { error } = await supabase.from('invoices').update(updatePayload).eq('id', inv.id)
    if (error) { toast(error.message,'error'); return }
    toast(`Invoice marked ${INV_STATUS[toStatus]?.label || toStatus}`,'success')
    load()
  }

  // ── Save modal ────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      invoice_number: form.invoice_number,
      vendor_ref: form.vendor_ref,
      vendor_details: form.vendor_details,
      po_id: form.po_id || null,
      tce_item_id: form.tce_item_id || null,
      status: form.status,
      currency: form.currency || 'AUD',
      amount: parseFloat(form.amount) || null,
      expected_amount: parseFloat(form.expected_amount) || null,
      invoice_date: form.invoice_date || null,
      due_date: form.due_date || null,
      period_from: form.period_from || null,
      period_to: form.period_to || null,
      notes: form.notes,
    }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('invoices').insert(payload)
      : await supabase.from('invoices').update(payload).eq('id', (modal as Invoice).id)
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast(isNew ? 'Invoice added' : 'Invoice saved','success')
    setSaving(false); setModal(null); load()
  }

  async function deleteInvoice(inv: Invoice) {
    if (!confirm(`Delete invoice ${inv.invoice_number || inv.id.slice(0,8)}?`)) return
    await supabase.from('invoices').delete().eq('id', inv.id)
    toast('Invoice deleted','info'); load()
  }

  // ── SAP Invoice Import ────────────────────────────────────────────────────
  async function parseSapFile(file: File) {
    setSapParsing(true)
    try {
      // SheetJS is loaded globally via CDN in the app shell
      const XLSX = (window as unknown as {XLSX: {read:(d:Uint8Array,o:{type:string})=>unknown}}).XLSX
      if (!XLSX) { toast('SheetJS not available', 'error'); return }
      const buf = await file.arrayBuffer()
      const wb = (XLSX.read(new Uint8Array(buf), { type: 'array' }) as {SheetNames:string[];Sheets:Record<string,unknown>})
      const ws = wb.Sheets[wb.SheetNames[0]] as unknown
      const XLSX2 = XLSX as unknown as {utils:{sheet_to_json:(ws:unknown,o:{header:number;defval:string})=>unknown[][]}}
      const rows = XLSX2.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]
      if (!rows.length) { toast('Empty file', 'error'); return }

      const hdrs = rows[0].map(h => String(h).trim().toLowerCase())
      const ci = (name: string) => hdrs.indexOf(name)

      const colRef  = ci('reference')
      const colVend = ci('vendor details')
      const colSupp = ci('supplier')
      const colPO   = ci('purchasing document')
      const colDate = ci('document date')
      const colCur  = ci('currency')
      const colAmt  = ci('net amount')
      const colDue  = ci('net due date')

      if (colRef < 0 || colAmt < 0) {
        toast('Could not find required columns (Reference, Net amount). Check file format.', 'error')
        return
      }

      // Existing invoice numbers for dup detection
      const existingNums = new Set(invoices.map(i => String(i.invoice_number || '').trim()))

      const parsed: SapInvRow[] = []
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        const invNum = String(row[colRef] ?? '').trim()
        if (!invNum) continue
        const poNum = colPO >= 0 ? String(row[colPO] ?? '').trim() : ''
        const matchedPO = pos.find(p => p.po_number && p.po_number.trim() === poNum) || null
        const isDup = existingNums.has(invNum)
        parsed.push({
          invoiceNumber: invNum,
          vendorDetails: colVend >= 0 ? String(row[colVend] ?? '').trim() : '',
          vendorNumber:  colSupp >= 0 ? String(row[colSupp] ?? '').trim() : '',
          poNumber: poNum,
          matchedPOId: matchedPO ? matchedPO.id : null,
          invoiceDate: colDate >= 0 ? excelSerialToISO(row[colDate]) : '',
          dueDate: colDue >= 0 ? excelSerialToISO(row[colDue]) : '',
          currency: colCur >= 0 ? String(row[colCur] ?? 'AUD').trim() : 'AUD',
          amount: colAmt >= 0 ? parseFloat(String(row[colAmt])) || 0 : 0,
          isDup,
          include: !isDup,
        })
      }
      setSapRows(parsed)
      setSapModal(true)
    } catch (err) {
      toast(`Error reading file: ${err}`, 'error')
    } finally {
      setSapParsing(false)
    }
  }

  function toggleSapRow(idx: number, val: boolean) {
    setSapRows(prev => prev.map((r, i) => i === idx ? { ...r, include: val } : r))
  }

  function toggleAllSapRows(val: boolean) {
    setSapRows(prev => prev.map(r => r.isDup ? r : { ...r, include: val }))
  }

  async function confirmSapImport() {
    const toImport = sapRows.filter(r => r.include)
    if (!toImport.length) { toast('No invoices selected', 'info'); return }
    setSapImporting(true)
    const now = new Date().toISOString()
    const user = currentUser?.email || 'local'
    let imported = 0
    for (const row of toImport) {
      const { error } = await supabase.from('invoices').insert({
        project_id: activeProject!.id,
        po_id: row.matchedPOId || null,
        invoice_number: row.invoiceNumber,
        vendor_ref: row.invoiceNumber,
        vendor_details: row.vendorDetails,
        status: 'received',
        status_history: [{ status: 'received', setBy: user, setAt: now, note: 'SAP bulk import' }],
        source: 'sap_import',
        currency: row.currency,
        amount: row.amount,
        invoice_date: row.invoiceDate || null,
        due_date: row.dueDate || null,
        notes: row.matchedPOId ? '' : `Imported unlinked — PO ${row.poNumber} not found`,
        created_at: now,
      })
      if (!error) imported++
    }
    const unlinked = toImport.filter(r => !r.matchedPOId).length
    toast(`${imported} invoice${imported !== 1 ? 's' : ''} imported${unlinked ? ` (${unlinked} unlinked — link to POs in register)` : ''}`, 'success')
    setSapImporting(false); setSapModal(false); setSapRows([]); load()
  }

  // ── Sorting ───────────────────────────────────────────────────────────────
  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function SortTh({ col, label, align = 'left' }: { col: SortCol; label: string; align?: string }) {
    const active = sortCol === col
    return (
      <th onClick={() => toggleSort(col)} style={{padding:'8px 10px',textAlign:align as 'left'|'right'|'center',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',background:'var(--bg3)',color:active?'var(--accent)':'var(--text2)',fontSize:'11px'}}>
        {label} {active ? (sortDir==='asc'?'↑':'↓') : ''}
      </th>
    )
  }

  // ── Filter + sort ─────────────────────────────────────────────────────────
  let filtered = invoices.filter(inv => {
    if (filterStatus && inv.status !== filterStatus) return false
    if (filterPO && inv.po_id !== filterPO) return false
    if (search) {
      const po = inv.po_id ? poMap[inv.po_id] : null
      const hay = [inv.invoice_number, inv.vendor_ref, inv.vendor_details, po?.po_number, po?.vendor, inv.sap_doc_number].join(' ').toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  })

  filtered = [...filtered].sort((a, b) => {
    const pa = a.po_id ? poMap[a.po_id] : null
    const pb = b.po_id ? poMap[b.po_id] : null
    let va: string|number = '', vb: string|number = ''
    switch (sortCol) {
      case 'invoice':    va = a.invoice_number||''; vb = b.invoice_number||''; break
      case 'po':         va = (pa?.po_number||pa?.vendor||'').toLowerCase(); vb = (pb?.po_number||pb?.vendor||'').toLowerCase(); break
      case 'date':       va = a.invoice_date||''; vb = b.invoice_date||''; break
      case 'due':        va = a.due_date||''; vb = b.due_date||''; break
      case 'expected':   va = a.expected_amount||0; vb = b.expected_amount||0; break
      case 'amount':     va = a.amount||0; vb = b.amount||0; break
      case 'status':     va = STATUS_ORDER_NUM[a.status]??9; vb = STATUS_ORDER_NUM[b.status]??9; break
      case 'lastaction': va = a.status_history?.at(-1)?.setAt||''; vb = b.status_history?.at(-1)?.setAt||''; break
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalAmt  = filtered.reduce((s, i) => s + (i.amount||0), 0)
  const unpaidAmt = filtered.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount||0), 0)
  const statusCounts = Object.fromEntries(Object.keys(INV_STATUS).map(k => [k, invoices.filter(i=>i.status===k).length]))

  if (loading) return <div style={{padding:'24px'}}><div className="loading-center"><span className="spinner"/></div></div>

  return (
    <div style={{padding:'24px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px',flexWrap:'wrap',gap:'8px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:700}}>Invoices</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {invoices.length} invoice{invoices.length!==1?'s':''} · {fmtK(invoices.reduce((s,i)=>s+(i.amount||0),0))} total
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <label className="btn btn-sm" style={{cursor:'pointer',background:'#1e40af',color:'#fff',border:'none',position:'relative'}} title="Import from SAP Excel export">
            {sapParsing ? <span className="spinner" style={{width:'12px',height:'12px'}}/> : '📥 SAP Import'}
            <input type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value=''; parseSapFile(f) } }} disabled={sapParsing} />
          </label>
          <button className="btn btn-sm" onClick={() => {
            const rows = [['Invoice #','Vendor Ref','PO','Status','Amount','Currency','Invoice Date','Due Date']]
            filtered.forEach(i => {
              const po = i.po_id ? poMap[i.po_id] : null
              rows.push([i.invoice_number||'', i.vendor_ref||'', po?.po_number||'', i.status, String(i.amount||0), i.currency||'AUD', i.invoice_date||'', i.due_date||''])
            })
            downloadCSV(rows, `Invoices_${activeProject?.name}_${new Date().toISOString().slice(0,10)}`)
          }}>↓ CSV</button>
          <button className="btn btn-primary" disabled={!canWrite('cost_tracking')} onClick={()=>{setForm(EMPTY_FORM);setModal('new')}}>+ New Invoice</button>
          <button className="btn btn-sm" onClick={() => setShowColPicker(true)} title="Show/hide columns">⚙ Columns{invHidden.size > INV_COLS.filter(c => !c.defaultVisible).length ? ` (${invHidden.size - INV_COLS.filter(c => !c.defaultVisible).length} hidden)` : ''}</button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div style={{display:'flex',gap:'6px',marginBottom:'12px',flexWrap:'wrap'}}>
        {[{k:'',l:`All (${invoices.length})`}, ...Object.entries(INV_STATUS).map(([k,v])=>({k,l:`${v.label} (${statusCounts[k]||0})`}))].map(({k,l}) => (
          <button key={k} onClick={()=>setFilterStatus(k)} style={{padding:'4px 12px',fontSize:'12px',borderRadius:'4px',border:'none',cursor:'pointer',fontWeight:filterStatus===k?700:400,background:filterStatus===k?(k?INV_STATUS[k].bg:'var(--accent)20'):'var(--bg3)',color:filterStatus===k?(k?INV_STATUS[k].color:'var(--accent)'):'var(--text2)'}}>
            {l}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="input" style={{width:'260px'}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Invoice number, vendor ref, PO number..." />
        <select className="input" style={{width:'200px'}} value={filterPO} onChange={e=>setFilterPO(e.target.value)}>
          <option value="">All POs</option>
          {pos.map(p => <option key={p.id} value={p.id}>{p.po_number || p.internal_ref || p.vendor || p.id.slice(0,8)}</option>)}
        </select>
        <SavedViewsBar
          panelId="invoices"
          currentFilters={{ filterStatus, sortCol, sortDir }}
          onLoad={filters => {
            if (typeof filters.filterStatus === 'string') setFilterStatus(filters.filterStatus)
            if (typeof filters.sortCol === 'string') setSortCol(filters.sortCol as typeof sortCol)
            if (typeof filters.sortDir === 'string') setSortDir(filters.sortDir as typeof sortDir)
          }}
        />
      </div>

      {/* Summary bar */}
      {filtered.length > 0 && (
        <div className="card" style={{padding:'10px 16px',marginBottom:'12px',display:'flex',gap:'24px',fontSize:'12px',alignItems:'center',flexWrap:'wrap'}}>
          <span style={{color:'var(--text3)'}}>{filtered.length} invoice{filtered.length!==1?'s':''}</span>
          <span>Total: <b style={{fontFamily:'var(--mono)',color:'#1e40af'}}>{fmtK(totalAmt)} AUD</b></span>
          <span>Unpaid: <b style={{fontFamily:'var(--mono)',color:'var(--orange)'}}>{fmtK(unpaidAmt)} AUD</b></span>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="card" style={{padding:'48px',textAlign:'center'}}>
          <div style={{fontSize:'36px',marginBottom:'12px'}}>🧾</div>
          <div style={{fontSize:'16px',fontWeight:600,marginBottom:'4px'}}>No invoices yet</div>
          <div style={{fontSize:'13px',color:'var(--text3)',marginBottom:'20px'}}>Add invoices against active POs to track what's been billed.</div>
          <button className="btn btn-primary" onClick={()=>{setForm(EMPTY_FORM);setModal('new')}}>+ New Invoice</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{padding:'32px',textAlign:'center',color:'var(--text3)'}}>No invoices match the current filters.</div>
      ) : (
        <div className="card" style={{padding:0,overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px',tableLayout:'fixed',minWidth:'1000px'}}>
            <thead>
              <tr>
                {isInvVisible('invoice') && <SortTh col="invoice" label="Invoice #" />}
                {isInvVisible('po_vendor') && <SortTh col="po" label="PO / Vendor" />}
                {isInvVisible('inv_date') && <SortTh col="date" label="Inv Date" align="center" />}
                {isInvVisible('due_date') && <SortTh col="due" label="Due Date" align="center" />}
                {isInvVisible('expected') && <SortTh col="expected" label="Expected" align="right" />}
                {isInvVisible('amount') && <SortTh col="amount" label="Amount" align="right" />}
                {isInvVisible('status') && <SortTh col="status" label="Status" />}
                {isInvVisible('last_action') && <SortTh col="lastaction" label="Last Action" />}
                {isInvVisible('dtp') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)',textAlign:'center'}}>DTP</th>}
                {isInvVisible('vendor_ref') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)'}}>Vendor Ref</th>}
                {isInvVisible('vendor_details') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)'}}>Vendor Details</th>}
                {isInvVisible('currency') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)',textAlign:'center'}}>Currency</th>}
                {isInvVisible('period_from') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)',textAlign:'center'}}>Period From</th>}
                {isInvVisible('period_to') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)',textAlign:'center'}}>Period To</th>}
                {isInvVisible('tce_item') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)'}}>TCE Item</th>}
                {isInvVisible('sap_doc') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)',fontFamily:'var(--mono)'}}>SAP Doc #</th>}
                {isInvVisible('notes') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)'}}>Notes</th>}
                {isInvVisible('actions') && <th style={{padding:'8px 10px',background:'var(--bg3)',fontSize:'11px',color:'var(--text2)'}}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const po = inv.po_id ? poMap[inv.po_id] : null
                const sc = INV_STATUS[inv.status] || INV_STATUS.received
                const cur = inv.currency || po?.currency || 'AUD'
                const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? 'US$' : '$'
                const lastAction = inv.status_history?.at(-1)
                const transitions = INV_TRANSITIONS[inv.status] || []
                const unlinked = !inv.po_id
                const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid'

                // Days-to-pay calculation
                let dtp: number|null = null
                if (inv.status === 'paid' && inv.paid_date && inv.invoice_date) {
                  dtp = Math.round((new Date(inv.paid_date).getTime() - new Date(inv.invoice_date).getTime()) / 86400000)
                } else if (inv.due_date && inv.invoice_date && inv.status !== 'paid') {
                  dtp = Math.round((new Date(inv.due_date).getTime() - new Date().getTime()) / 86400000)
                }

                // Amount variance
                let varianceEl = null
                if (inv.expected_amount && inv.amount) {
                  const diff = inv.amount - inv.expected_amount
                  if (Math.abs(diff) > 0.01) {
                    varianceEl = <div style={{fontSize:'9px',color:diff>0?'var(--red)':'#059669'}}>{diff>0?'▲ +':'▼ '}{fmt(Math.abs(diff),sym)}</div>
                  } else {
                    varianceEl = <div style={{fontSize:'9px',color:'#059669'}}>✓ matches</div>
                  }
                }

                return (
                  <tr key={inv.id}
                    style={{borderBottom:'1px solid var(--border)',background: dragOverId===inv.id ? 'rgba(16,185,129,0.06)' : unlinked?'#fffbeb':'transparent', outline: dragOverId===inv.id?'2px dashed var(--accent)':undefined, transition:'background 0.1s'}}
                    onDragOver={ev=>{ev.preventDefault();setDragOverId(inv.id)}}
                    onDragLeave={()=>setDragOverId(null)}
                    onDrop={async ev=>{ev.preventDefault();setDragOverId(null);const f=ev.dataTransfer.files[0];if(f)await handleReceiptUpload(inv,f)}}>
                    {/* Invoice # */}
                    {isInvVisible('invoice') && <td style={{padding:'8px 10px',verticalAlign:'top'}}>
                      <div style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'12px'}}>{inv.invoice_number || '—'}</div>
                      {inv.source === 'sap_import' && <div style={{fontSize:'9px',color:'#7c3aed'}}>SAP Import</div>}
                    </td>}
                    {/* PO / Vendor */}
                    {isInvVisible('po_vendor') && <td style={{padding:'8px 10px',verticalAlign:'top',fontSize:'10px'}}>
                      {po ? (
                        <>
                          <div style={{fontFamily:'var(--mono)',fontWeight:600}}>{po.po_number || po.internal_ref || '—'}</div>
                          <div style={{color:'var(--text3)'}}>{po.vendor}</div>
                        </>
                      ) : (
                        <div style={{color:'var(--text3)',fontStyle:'italic'}}>{inv.vendor_details || inv.vendor_ref || '—'}
                          <span style={{fontSize:'9px',fontWeight:700,padding:'1px 5px',borderRadius:'3px',background:'#fef3c7',color:'#d97706',marginLeft:'4px'}}>⚠ No PO</span>
                        </div>
                      )}
                    </td>}
                    {/* Inv Date */}
                    {isInvVisible('inv_date') && <td style={{padding:'8px 10px',textAlign:'center',verticalAlign:'top'}}>{fmtDate(inv.invoice_date)}</td>}
                    {/* Due Date */}
                    {isInvVisible('due_date') && <td style={{padding:'8px 10px',textAlign:'center',verticalAlign:'top',color:isOverdue?'var(--red)':'var(--text2)',fontWeight:isOverdue?600:400}}>
                      {fmtDate(inv.due_date)}{isOverdue?' ⚠':''}
                    </td>}
                    {/* Expected */}
                    {isInvVisible('expected') && <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text3)',verticalAlign:'top'}}>
                      {inv.expected_amount ? fmt(inv.expected_amount, sym) : '—'}
                    </td>}
                    {/* Amount */}
                    {isInvVisible('amount') && <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,color:'#1e40af',verticalAlign:'top'}}>
                      {fmt(inv.amount, sym)}
                      {varianceEl}
                      {cur !== 'AUD' && <div style={{fontSize:'9px',color:'var(--text3)'}}>{cur}</div>}
                    </td>}
                    {/* Status */}
                    {isInvVisible('status') && <td style={{padding:'8px 10px',verticalAlign:'top'}}>
                      <span style={{fontSize:'10px',fontWeight:700,padding:'3px 8px',borderRadius:'3px',background:sc.bg,color:sc.color}}>{sc.label}</span>
                    </td>}
                    {/* Last Action */}
                    {isInvVisible('last_action') && <td style={{padding:'8px 10px',verticalAlign:'top',minWidth:'140px'}}>
                      {lastAction ? (
                        <>
                          <div style={{fontSize:'10px',fontWeight:600,color:INV_STATUS[lastAction.status]?.color||'var(--text2)'}}>{INV_STATUS[lastAction.status]?.label||lastAction.status}</div>
                          <div style={{fontSize:'10px',color:'var(--text3)'}}>{fmtUser(lastAction.setBy)}</div>
                          <div style={{fontSize:'9px',color:'var(--text3)'}}>{fmtDateTime(lastAction.setAt)}</div>
                          {lastAction.note && <div style={{fontSize:'9px',color:'#dc2626',fontStyle:'italic',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={lastAction.note}>{lastAction.note}</div>}
                        </>
                      ) : <span style={{color:'var(--text3)',fontSize:'10px'}}>—</span>}
                    </td>}
                    {/* DTP */}
                    {isInvVisible('dtp') && <td style={{padding:'8px 10px',textAlign:'center',fontFamily:'var(--mono)',verticalAlign:'top',color:inv.status==='paid'?'#059669':dtp!=null&&dtp>30?'var(--red)':dtp!=null&&dtp>14?'var(--orange)':'var(--text3)'}}>
                      {inv.status==='paid'?'✓':dtp!=null?dtp+'d':'—'}
                    </td>}
                    {/* Optional columns */}
                    {isInvVisible('vendor_ref') && <td style={{padding:'8px 10px',verticalAlign:'top',fontSize:'11px',color:'var(--text3)'}}>{inv.vendor_ref || '—'}</td>}
                    {isInvVisible('vendor_details') && <td style={{padding:'8px 10px',verticalAlign:'top',fontSize:'11px',color:'var(--text2)'}}>{inv.vendor_details || '—'}</td>}
                    {isInvVisible('currency') && <td style={{padding:'8px 10px',textAlign:'center',verticalAlign:'top',fontFamily:'var(--mono)',fontSize:'11px'}}>{cur}</td>}
                    {isInvVisible('period_from') && <td style={{padding:'8px 10px',textAlign:'center',verticalAlign:'top',fontFamily:'var(--mono)',fontSize:'11px'}}>{fmtDate(inv.period_from) || '—'}</td>}
                    {isInvVisible('period_to') && <td style={{padding:'8px 10px',textAlign:'center',verticalAlign:'top',fontFamily:'var(--mono)',fontSize:'11px'}}>{fmtDate(inv.period_to) || '—'}</td>}
                    {isInvVisible('tce_item') && <td style={{padding:'8px 10px',verticalAlign:'top',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{inv.tce_item_id || '—'}</td>}
                    {isInvVisible('sap_doc') && <td style={{padding:'8px 10px',verticalAlign:'top',fontFamily:'var(--mono)',fontSize:'11px',color:'#7c3aed'}}>{(inv as typeof inv & {sap_doc_number?:string}).sap_doc_number || '—'}</td>}
                    {isInvVisible('notes') && <td style={{padding:'8px 10px',verticalAlign:'top',fontSize:'11px',color:'var(--text2)',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={inv.notes||undefined}>{inv.notes || '—'}</td>}
                    {/* Actions */}
                    {isInvVisible('actions') && <td style={{padding:'8px 10px',verticalAlign:'top',whiteSpace:'nowrap'}}>
                      <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                        <div style={{display:'flex',gap:'3px'}}>
                          {transitions.map(t => (
                            <button key={t} onClick={()=>transition(inv, t)} style={{fontSize:'10px',padding:'3px 7px',borderRadius:'4px',cursor:'pointer',fontWeight:600,...Object.fromEntries(BTN_STYLE[t].split(';').map(s=>{const [k,v]=s.split(':');return [k?.trim()?.replace(/-([a-z])/g,(_:string,g:string)=>g.toUpperCase()),v?.trim()]}))}}>
                              {BTN_LABEL[t]}
                            </button>
                          ))}
                        </div>
                        {/* Receipt attachments */}
                      <div style={{display:'flex',gap:'3px',flexWrap:'wrap',marginTop:'2px'}}>
                        {(inv.receipt_paths||[]).map((path: string) => (
                          <span key={path} style={{display:'inline-flex',alignItems:'center',gap:'2px',fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'var(--bg3)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--text2)'}} title={fileName(path)} onClick={()=>openInvReceipt(path)}>
                            {fileIcon(path)} {fileName(path).slice(0,14)}{fileName(path).length>14?'…':''}
                            <span style={{marginLeft:'2px',color:'var(--text3)',cursor:'pointer',fontSize:'11px'}} onClick={ev=>{ev.stopPropagation();removeInvReceipt(inv,path)}}>×</span>
                          </span>
                        ))}
                        {uploadingId === inv.id
                          ? <span className="spinner" style={{width:'11px',height:'11px'}} />
                          : <label style={{cursor:'pointer',fontSize:'9px',color:'var(--text3)',padding:'1px 4px',border:'1px dashed var(--border)',borderRadius:'3px'}} title="Attach receipt">📎<input type="file" accept="image/*,.pdf" style={{display:'none'}} onChange={async ev=>{const f=ev.target.files?.[0];if(f)await handleReceiptUpload(inv,f);ev.target.value=''}} /></label>
                        }
                      </div>
                      <div style={{display:'flex',gap:'3px'}}>
                          <button className="btn btn-sm" style={{fontSize:'10px'}} onClick={()=>{
                            setForm({
                              invoice_number: inv.invoice_number||'', vendor_ref: inv.vendor_ref||'',
                              vendor_details: inv.vendor_details||'', po_id: inv.po_id||'',
                              tce_item_id: inv.tce_item_id||'', status: inv.status, currency: inv.currency||'AUD',
                              amount: String(inv.amount||''), expected_amount: String(inv.expected_amount||''),
                              invoice_date: inv.invoice_date||'', due_date: inv.due_date||'',
                              period_from: inv.period_from||'', period_to: inv.period_to||'', notes: inv.notes||'',
                            })
                            setModal(inv)
                          }}>Edit</button>
                          <button className="btn btn-sm" style={{fontSize:'10px'}} onClick={()=>setHistoryModal(inv)}>History</button>
                          <button className="btn btn-sm" style={{fontSize:'10px',color:'var(--red)'}} onClick={()=>deleteInvoice(inv)}>✕</button>
                        </div>
                      </div>
                    </td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Invoice Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'560px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'+ New Invoice':`Edit Invoice — ${(modal as Invoice).invoice_number||'—'}`}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Invoice Number *</label>
                  <input className="input" value={form.invoice_number} onChange={e=>setForm(f=>({...f,invoice_number:e.target.value}))} placeholder="INV-12345" autoFocus />
                </div>
                <div className="fg">
                  <label>Vendor Ref</label>
                  <input className="input" value={form.vendor_ref} onChange={e=>setForm(f=>({...f,vendor_ref:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Linked PO</label>
                  <select className="input" value={form.po_id} onChange={e=>setForm(f=>({...f,po_id:e.target.value}))}>
                    <option value="">— No PO —</option>
                    {pos.map(p=><option key={p.id} value={p.id}>{p.po_number||p.internal_ref||'—'} {p.vendor}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {Object.entries(INV_STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              {!form.po_id && (
                <div className="fg">
                  <label>Vendor Details <span style={{fontWeight:400,color:'var(--text3)',fontSize:'11px'}}>(if no PO)</span></label>
                  <input className="input" value={form.vendor_details} onChange={e=>setForm(f=>({...f,vendor_details:e.target.value}))} placeholder="Vendor name / details" />
                </div>
              )}
              <div className="fg-row">
                <div className="fg">
                  <label>Amount</label>
                  <input type="number" className="input" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" />
                </div>
                <div className="fg">
                  <label>Expected Amount</label>
                  <input type="number" className="input" value={form.expected_amount} onChange={e=>setForm(f=>({...f,expected_amount:e.target.value}))} placeholder="0.00" />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {['AUD','EUR','USD','GBP','NZD'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Invoice Date</label><input type="date" className="input" value={form.invoice_date} onChange={e=>setForm(f=>({...f,invoice_date:e.target.value}))} /></div>
                <div className="fg"><label>Due Date</label><input type="date" className="input" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Period From</label><input type="date" className="input" value={form.period_from} onChange={e=>setForm(f=>({...f,period_from:e.target.value}))} /></div>
                <div className="fg"><label>Period To</label><input type="date" className="input" value={form.period_to} onChange={e=>setForm(f=>({...f,period_to:e.target.value}))} /></div>
              </div>
              <div className="fg">
                <label>TCE Item ID <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '11px' }}>— links invoice to a TCE line for actuals</span></label>
                {tceLines.length === 0 ? (
                  <input className="input" value={form.tce_item_id} onChange={e => setForm(f => ({ ...f, tce_item_id: e.target.value }))} placeholder="No TCE imported — type item_id or import TCE to enable dropdown" />
                ) : (
                  <select className="input" value={form.tce_item_id} onChange={e => setForm(f => ({ ...f, tce_item_id: e.target.value }))}>
                    <option value="">— No TCE Link —</option>
                    {/* Preserve legacy values not in the current TCE list so the
                        save doesn't silently drop them when reopening. */}
                    {form.tce_item_id && !tceLines.some(l => l.item_id === form.tce_item_id) && (
                      <option value={form.tce_item_id}>{form.tce_item_id} (not in TCE)</option>
                    )}
                    {/* Strip group-header rows (3-segment item_ids are headers, not selectable lines) */}
                    {tceLines
                      .filter(l => l.item_id && !/^\d+\.\d+\.\d+$/.test(l.item_id))
                      .map(l => <option key={l.id} value={l.item_id}>{l.item_id} — {l.description}</option>)}
                  </select>
                )}
              </div>
              <div className="fg"><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}}/></div>
            </div>
            <div className="modal-footer">
              {modal!=='new'&&<button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{deleteInvoice(modal as Invoice);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'500px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>🕒 Invoice History — {historyModal.invoice_number||'—'}</h3>
              <button className="btn btn-sm" onClick={()=>setHistoryModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {(historyModal.status_history||[]).length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:'12px'}}>No status history recorded.</div>
              ) : [...(historyModal.status_history||[])].reverse().map((h, i) => {
                const sc = INV_STATUS[h.status] || { label:h.status, color:'var(--text2)', bg:'var(--bg3)' }
                return (
                  <div key={i} style={{padding:'10px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:'10px',alignItems:'flex-start'}}>
                    <span style={{fontSize:'10px',fontWeight:700,padding:'2px 8px',borderRadius:'3px',background:sc.bg,color:sc.color,whiteSpace:'nowrap'}}>{sc.label}</span>
                    <div>
                      <div style={{fontSize:'11px',color:'var(--text2)'}}>{fmtUser(h.setBy)} · {fmtDateTime(h.setAt)}</div>
                      {h.note && <div style={{fontSize:'11px',color:'#dc2626',marginTop:'2px',fontStyle:'italic'}}>{h.note}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="modal-footer"><button className="btn" onClick={()=>setHistoryModal(null)}>Close</button></div>
          </div>
        </div>
      )}

      {/* Dispute Note Modal */}
      {disputeModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'420px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>⚠ Flag as Disputed</h3><button className="btn btn-sm" onClick={()=>setDisputeModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Dispute Reason *</label><textarea className="input" rows={3} value={disputeModal.note} onChange={e=>setDisputeModal(d=>d?{...d,note:e.target.value}:d)} placeholder="Describe the dispute or discrepancy..." style={{resize:'vertical'}} autoFocus /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setDisputeModal(null)}>Cancel</button>
              <button className="btn" style={{background:'#dc2626',color:'#fff',border:'none'}} onClick={async()=>{await doTransition(disputeModal.inv,'disputed',disputeModal.note);setDisputeModal(null)}}>Flag Disputed</button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Date Modal */}
      {payDateModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'360px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✓ Mark as Paid</h3><button className="btn btn-sm" onClick={()=>setPayDateModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Payment Date</label><input type="date" className="input" value={payDateModal.date} onChange={e=>setPayDateModal(d=>d?{...d,date:e.target.value}:d)} autoFocus /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setPayDateModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={async()=>{await doTransition(payDateModal.inv,'paid','',payDateModal.date);setPayDateModal(null)}}>Confirm Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* SAP Invoice Import Modal */}
      {sapModal && (
        <div className="modal-overlay" onClick={()=>{setSapModal(false);setSapRows([])}}>
          <div className="modal" style={{maxWidth:'660px',maxHeight:'80vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>📥 SAP Invoice Import</h3><button className="btn btn-sm" onClick={()=>{setSapModal(false);setSapRows([])}}>✕</button></div>
            <div style={{padding:'0 20px 8px',fontSize:'12px',color:'var(--text3)'}}>
              Review and select invoices to import. Duplicates (matching existing invoice numbers) are pre-deselected.
            </div>
            {/* Summary pills */}
            <div style={{display:'flex',gap:'8px',padding:'0 20px 12px',flexWrap:'wrap'}}>
              {[
                {label:`${sapRows.length} total`,bg:'#dbeafe',color:'#1e40af'},
                {label:`${sapRows.filter(r=>!r.isDup).length} new`,bg:'#d1fae5',color:'#059669'},
                ...(sapRows.filter(r=>r.isDup).length ? [{label:`${sapRows.filter(r=>r.isDup).length} duplicates`,bg:'#fef3c7',color:'#d97706'}] : []),
                ...(sapRows.filter(r=>!r.matchedPOId&&!r.isDup).length ? [{label:`${sapRows.filter(r=>!r.matchedPOId&&!r.isDup).length} no PO match`,bg:'#fee2e2',color:'#dc2626'}] : []),
              ].map((p,i) => (
                <span key={i} style={{padding:'4px 10px',borderRadius:'6px',fontSize:'12px',fontWeight:600,background:p.bg,color:p.color}}>{p.label}</span>
              ))}
            </div>
            <div style={{flex:1,overflow:'auto',padding:'0 20px'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                <thead>
                  <tr style={{background:'var(--bg3)',position:'sticky',top:0}}>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'center'}}>
                      <input type="checkbox" checked={sapRows.filter(r=>!r.isDup).every(r=>r.include)} onChange={e=>toggleAllSapRows(e.target.checked)} />
                    </th>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'left'}}>Invoice #</th>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'left'}}>Vendor</th>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'left'}}>PO #</th>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'left'}}>Date</th>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'right'}}>Amount</th>
                    <th style={{padding:'6px 8px',border:'1px solid var(--border2)',textAlign:'left'}}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sapRows.map((row, i) => {
                    const sym = row.currency === 'EUR' ? '€' : row.currency === 'USD' ? 'US$' : '$'
                    const fmtD = (s: string) => s ? s.split('-').reverse().join('/') : '—'
                    const statusEl = row.isDup
                      ? <span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'3px',background:'#fef3c7',color:'#d97706',fontWeight:700}}>Duplicate</span>
                      : row.matchedPOId
                        ? <span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'3px',background:'#d1fae5',color:'#059669',fontWeight:700}}>PO Matched</span>
                        : <span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'3px',background:'#fee2e2',color:'#dc2626',fontWeight:700}}>No PO Match</span>
                    return (
                      <tr key={i} style={{opacity: row.isDup ? 0.6 : 1, background: row.isDup ? '#fffbeb' : undefined}}>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)',textAlign:'center'}}>
                          <input type="checkbox" checked={row.include} disabled={row.isDup} onChange={e=>toggleSapRow(i,e.target.checked)} />
                        </td>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)',fontFamily:'var(--mono)',fontWeight:600}}>{row.invoiceNumber}</td>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={row.vendorDetails}>{row.vendorDetails.slice(0,40)}</td>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)',fontFamily:'var(--mono)'}}>{row.poNumber || '—'}</td>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)'}}>{fmtD(row.invoiceDate)}</td>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>{sym}{Number(row.amount).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})} {row.currency}</td>
                        <td style={{padding:'5px 8px',border:'1px solid var(--border2)'}}>{statusEl}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-footer" style={{marginTop:'12px'}}>
              <button className="btn" onClick={()=>{setSapModal(false);setSapRows([])}}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#1e40af',color:'#fff',border:'none'}} onClick={confirmSapImport} disabled={sapImporting || !sapRows.some(r=>r.include)}>
                {sapImporting ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : `Import ${sapRows.filter(r=>r.include).length} Invoice${sapRows.filter(r=>r.include).length!==1?'s':''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column picker modal ───────────────────────────────────────────── */}
      {showColPicker && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1200,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)'}}
          onClick={()=>setShowColPicker(false)}>
          <div style={{background:'var(--bg2)',borderRadius:'12px',width:'440px',maxWidth:'95vw',maxHeight:'80vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 50px rgba(0,0,0,0.35)',border:'1px solid var(--border)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{padding:'16px 20px 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:700,fontSize:'15px'}}>Invoice Columns</div>
                <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'2px'}}>Columns marked † are hidden by default</div>
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button className="btn btn-sm" onClick={()=>{setInvHidden(new Set());setShowColPicker(false)}}>Show All</button>
                <button className="btn btn-sm" onClick={()=>setShowColPicker(false)}>Done</button>
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'12px 20px'}}>
              {INV_COL_GROUPS.map(group => {
                const cols = INV_COLS.filter(c => c.group === group)
                return (
                  <div key={group} style={{marginBottom:'16px'}}>
                    <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)',marginBottom:'8px'}}>{group}</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                      {cols.map(col => {
                        const visible = isInvVisible(col.id)
                        return (
                          <label key={col.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 10px',borderRadius:'6px',background:visible?'rgba(99,102,241,0.1)':'var(--bg3)',border:`1px solid ${visible?'var(--accent)':'var(--border)'}`,cursor:'pointer',userSelect:'none'}}>
                            <input type="checkbox" checked={visible}
                              onChange={e=>{
                                const next = new Set(invHidden)
                                if (e.target.checked) next.delete(col.id)
                                else next.add(col.id)
                                setInvHidden(next)
                              }}
                              style={{accentColor:'var(--accent)',width:'14px',height:'14px',flexShrink:0}}
                            />
                            <span style={{fontSize:'13px',fontWeight:visible?600:400,color:visible?'var(--text)':'var(--text3)'}}>
                              {col.label}{!col.defaultVisible?' †':''}
                            </span>
                            {visible && <span style={{marginLeft:'auto',fontSize:'10px',color:'var(--accent)'}}>✓</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
