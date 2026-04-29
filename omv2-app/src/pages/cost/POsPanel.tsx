import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import type { PurchaseOrder } from '../../types'

// ── Status metadata (matches HTML PO_STATUS) ──────────────────────────────────
const PO_STATUS: Record<string,{label:string;color:string;bg:string;desc:string}> = {
  draft:     { label:'Draft',     color:'#94a3b8', bg:'#f1f5f9',  desc:'Scope identified, quote not yet received' },
  quoted:    { label:'Quoted',    color:'#d97706', bg:'#fef3c7',  desc:'Quote received, PO not yet raised' },
  raised:    { label:'Raised',    color:'#0369a1', bg:'#dbeafe',  desc:'PO raised in SAP, work not yet started' },
  active:    { label:'Active',    color:'#059669', bg:'#d1fae5',  desc:'Work in progress, invoices being received' },
  closed:    { label:'Closed',    color:'#6b7280', bg:'#e5e7eb',  desc:'All invoicing reconciled, PO closed' },
  cancelled: { label:'Cancelled', color:'#dc2626', bg:'#fee2e2',  desc:'Cancelled — no further activity' },
}
const PO_TYPE: Record<string,string> = { fixed:'Fixed Price', rates:'Time & Materials', estimate:'Estimate' }
const PO_NEXT: Record<string,string> = { draft:'quoted', quoted:'raised', raised:'active', active:'closed' }
const STATUS_ORDER = ['quoted','raised','active','draft','closed','cancelled']
const CURRENCIES = ['AUD','EUR','USD','GBP','NZD']

const fmt = (v: number, cur = 'AUD') => {
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? 'US$' : '$'
  if (!v) return '—'
  if (Math.abs(v) >= 1e6) return sym + (v/1e6).toFixed(2) + 'M'
  if (Math.abs(v) >= 1000) return sym + (v/1000).toFixed(1) + 'k'
  return sym + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pct = (v: number, total: number) => total > 0 ? Math.round(v/total*100) + '%' : '0%'
const fmtDate = (s?: string|null) => s ? s.split('-').reverse().join('/') : '—'

interface PoLine { id: string; description: string; wbs: string; value: number; notes: string }
const mkLine = (): PoLine => ({ id: Math.random().toString(36).slice(2), description:'', wbs:'', value:0, notes:'' })

type PoForm = {
  po_number: string; internal_ref: string; vendor: string; description: string
  status: string; currency: string; po_type: string; notes: string
  effective_start: string; effective_end: string; raised_date: string
  lines: PoLine[]
}
const EMPTY_FORM: PoForm = {
  po_number:'', internal_ref:'', vendor:'', description:'', status:'draft',
  currency:'AUD', po_type:'fixed', notes:'', effective_start:'', effective_end:'',
  raised_date:'', lines:[mkLine()],
}

type InvRow = { id: string; po_id: string|null; amount: number; status: string }
type HireRow = { id: string; linked_po_id: string|null; hire_cost: number }
type CarRow  = { id: string; linked_po_id: string|null; total_cost: number }
type AcRow   = { id: string; linked_po_id: string|null; total_cost: number }

export function POsPanel() {
  const { activeProject, setActivePanel, pendingPoId, setPendingPoId } = useAppStore()
  const { canWrite } = usePermissions()
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [invoices, setInvoices] = useState<InvRow[]>([])
  const [hire, setHire] = useState<HireRow[]>([])
  const [cars, setCars] = useState<CarRow[]>([])
  const [accom, setAccom] = useState<AcRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|PurchaseOrder>(null)
  const [form, setForm] = useState<PoForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterVendor, setFilterVendor] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [wbsList, setWbsList] = useState<{id:string;code:string;name:string}[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  // Auto-open edit modal for a PO created from RFQ award flow
  useEffect(() => {
    if (!pendingPoId || pos.length === 0) return
    const po = pos.find(p => p.id === pendingPoId)
    if (po) { openEdit(po); setPendingPoId(null) }
  }, [pendingPoId, pos])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [poRes, invRes, hireRes, carRes, acRes, wbsRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id,po_id,amount,status').eq('project_id', pid),
      supabase.from('hire_items').select('id,linked_po_id,hire_cost').eq('project_id', pid),
      supabase.from('cars').select('id,linked_po_id,total_cost').eq('project_id', pid),
      supabase.from('accommodation').select('id,linked_po_id,total_cost').eq('project_id', pid),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
    ])
    setPos((poRes.data||[]) as PurchaseOrder[])
    setInvoices((invRes.data||[]) as InvRow[])
    setHire((hireRes.data||[]) as HireRow[])
    setCars((carRes.data||[]) as CarRow[])
    setAccom((acRes.data||[]) as AcRow[])
    setWbsList((wbsRes.data||[]) as {id:string;code:string;name:string}[])
    setLoading(false)
  }

  // ── Value calculations (mirrors HTML poTotalValue / poForecastValue) ───────
  function poValue(po: PurchaseOrder): number {
    const lines = (po as PurchaseOrder & {line_items?: PoLine[]}).line_items || []
    const linesTotal = lines.reduce((s, l) => s + (l.value || 0), 0)
    return linesTotal || (po.po_value as unknown as number) || 0
  }

  function poForecast(poId: string): number | null {
    let total = 0; let hasAny = false
    hire.filter(h => h.linked_po_id === poId).forEach(h => { total += h.hire_cost || 0; hasAny = true })
    cars.filter(c => c.linked_po_id === poId).forEach(c => { total += c.total_cost || 0; hasAny = true })
    accom.filter(a => a.linked_po_id === poId).forEach(a => { total += a.total_cost || 0; hasAny = true })
    return hasAny ? total : null
  }

  function poInvoiced(poId: string) {
    const inv = invoices.filter(i => i.po_id === poId)
    const total = inv.reduce((s, i) => s + (i.amount || 0), 0)
    const approved = inv.filter(i => i.status === 'approved' || i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0)
    return { total, approved, count: inv.length }
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const activeCount = pos.filter(p => p.status === 'raised' || p.status === 'active').length
  const draftCount  = pos.filter(p => p.status === 'draft' || p.status === 'quoted').length
  const closedCount = pos.filter(p => p.status === 'closed' || p.status === 'cancelled').length
  const committedAUD = pos.filter(p => p.status === 'raised' || p.status === 'active').reduce((s, p) => s + (poValue(p) || 0), 0)
  const totalInvoicedAUD = invoices.filter(i => i.status !== 'disputed').reduce((s, i) => s + (i.amount || 0), 0)

  // ── Filtering ─────────────────────────────────────────────────────────────
  const vendors = [...new Set(pos.map(p => p.vendor).filter(Boolean))].sort()
  const filtered = pos.filter(p => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false
    if (filterVendor && p.vendor !== filterVendor) return false
    if (search) {
      const lines = (p as PurchaseOrder & {line_items?: PoLine[]}).line_items || []
      const hay = [p.po_number, p.internal_ref, p.vendor, p.description,
        ...lines.map(l => l.wbs + ' ' + l.description)].join(' ').toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  })

  // Group by status
  const groups: Record<string, PurchaseOrder[]> = {}
  STATUS_ORDER.forEach(s => { groups[s] = [] })
  filtered.forEach(p => { (groups[p.status] || groups.draft).push(p) })

  // ── Status advance ────────────────────────────────────────────────────────
  async function advanceStatus(po: PurchaseOrder) {
    const next = PO_NEXT[po.status]
    if (!next) { toast('No further status changes', 'info'); return }
    if (next === 'raised' && !po.po_number) { toast('Enter a PO number before marking as Raised', 'error'); return }
    if (!confirm(`Advance "${po.vendor}" from ${PO_STATUS[po.status].label} → ${PO_STATUS[next].label}?`)) return
    const { error } = await supabase.from('purchase_orders').update({ status: next }).eq('id', po.id)
    if (error) { toast(error.message, 'error'); return }
    toast(`Status → ${PO_STATUS[next].label}`, 'success')
    load()
  }

  // ── Open / save modal ─────────────────────────────────────────────────────
  function openEdit(po: PurchaseOrder) {
    const p = po as PurchaseOrder & { line_items?: PoLine[]; po_type?: string; effective_start?: string; effective_end?: string }
    setForm({
      po_number: po.po_number || '', internal_ref: po.internal_ref || '',
      vendor: po.vendor || '', description: po.description || '',
      status: po.status || 'draft', currency: po.currency || 'AUD',
      po_type: p.po_type || 'fixed', notes: po.notes || '',
      effective_start: p.effective_start || '', effective_end: p.effective_end || '',
      raised_date: po.raised_date || '',
      lines: p.line_items?.length ? p.line_items : [mkLine()],
    })
    setModal(po)
  }

  function openNew() { setForm({ ...EMPTY_FORM, lines:[mkLine()] }); setModal('new') }

  const formValue = form.lines.reduce((s, l) => s + (l.value || 0), 0)

  async function save() {
    if (!form.vendor.trim()) { toast('Vendor required', 'error'); return }
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      po_number: form.po_number,
      internal_ref: form.internal_ref,
      vendor: form.vendor.trim(),
      description: form.description,
      status: form.status,
      currency: form.currency,
      po_type: form.po_type,
      po_value: formValue || null,
      effective_start: form.effective_start || null,
      effective_end: form.effective_end || null,
      raised_date: form.raised_date || null,
      notes: form.notes,
      line_items: form.lines,
    }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('purchase_orders').insert(payload)
      : await supabase.from('purchase_orders').update(payload).eq('id', (modal as PurchaseOrder).id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(isNew ? 'PO created' : 'PO saved', 'success')
    setSaving(false); setModal(null); load()
  }

  async function deletePO(po: PurchaseOrder) {
    if (!confirm(`Delete PO "${po.po_number || po.vendor}"? This cannot be undone.`)) return
    await supabase.from('purchase_orders').delete().eq('id', po.id)
    toast('PO deleted', 'info'); load()
  }

  function exportCSV() {
    const rows = [['PO Number','Vendor','Description','Status','Type','PO Value','Invoiced','Approved','Currency','Start','End']]
    pos.forEach(p => {
      const { total, approved } = poInvoiced(p.id)
      rows.push([p.po_number||'', p.vendor||'', p.description||'', p.status, (p as PurchaseOrder & {po_type?:string}).po_type||'', String(poValue(p)), String(total), String(approved), p.currency||'AUD', (p as PurchaseOrder & {effective_start?:string}).effective_start||'', (p as PurchaseOrder & {effective_end?:string}).effective_end||''])
    })
    downloadCSV(rows, `POs_${activeProject?.name}_${new Date().toISOString().slice(0,10)}`)
  }

  if (loading) return <div style={{padding:'24px'}}><div className="loading-center"><span className="spinner"/></div></div>

  return (
    <div style={{padding:'24px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:'16px',gap:'8px',flexWrap:'wrap'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:700,color:'var(--text)'}}>POs &amp; Invoices</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>Purchase orders from quote to completion — track committed costs and invoices</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={exportCSV}>↓ Export CSV</button>
          <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('cost_tracking')}>+ New PO</button>
        </div>
      </div>

      {/* KPI bar */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginBottom:'16px'}}>
        {[
          { label:'Active POs', value: activeCount || '—', color:'var(--accent)' },
          { label:'Committed (AUD)', value: committedAUD ? '$' + Math.round(committedAUD).toLocaleString() : '—', color:'#1e40af' },
          { label:'Total Invoiced', value: totalInvoicedAUD ? '$' + Math.round(totalInvoicedAUD).toLocaleString() : '—', color:'#059669' },
          { label:'Draft / Quoted', value: draftCount || '—', color:'#d97706' },
          { label:'Closed', value: closedCount || '—', color:'#6b7280' },
        ].map(k => (
          <div key={k.label} className="card" style={{padding:'12px 14px',borderTop:`3px solid ${k.color}`}}>
            <div style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'18px',color:k.color}}>{k.value}</div>
            <div style={{fontSize:'10px',color:'var(--text3)',marginTop:'2px',textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="input" style={{width:'260px'}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="PO number, vendor, description, WBS..." />
        <select className="input" style={{width:'140px'}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="all">All</option>
          {Object.entries(PO_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input" style={{width:'160px'}} value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}>
          <option value="">All Vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* PO groups */}
      {pos.length === 0 ? (
        <div className="card" style={{padding:'48px',textAlign:'center'}}>
          <div style={{fontSize:'36px',marginBottom:'12px'}}>💼</div>
          <div style={{fontSize:'16px',fontWeight:600,marginBottom:'4px'}}>No purchase orders yet</div>
          <div style={{fontSize:'13px',color:'var(--text3)',marginBottom:'20px'}}>Create a new PO to start tracking committed costs and invoices.</div>
          <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('cost_tracking')}>+ New PO</button>
        </div>
      ) : (
        STATUS_ORDER.map(status => {
          const items = groups[status]
          if (!items.length) return null
          const meta = PO_STATUS[status]
          return (
            <div key={status} className="card" style={{padding:0,marginBottom:'14px',overflow:'hidden'}}>
              <div style={{padding:'10px 16px',borderBottom:'1px solid var(--border)',background:meta.bg,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontWeight:700,fontSize:'12px',color:meta.color,textTransform:'uppercase',letterSpacing:'.06em'}}>
                  {meta.label} · {items.length} PO{items.length!==1?'s':''}
                </div>
                <div style={{fontSize:'11px',color:meta.color}}>{meta.desc}</div>
              </div>
              {items.map(po => <PORow key={po.id} po={po} meta={meta} poValue={poValue} poForecast={poForecast} poInvoiced={poInvoiced} invoices={invoices.filter(i=>i.po_id===po.id)} expanded={expanded} setExpanded={setExpanded} openEdit={openEdit} advanceStatus={advanceStatus} setActivePanel={setActivePanel} />)}
            </div>
          )
        })
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'680px',maxHeight:'92vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new' ? '+ New Purchase Order' : `Edit PO — ${(modal as PurchaseOrder).po_number || (modal as PurchaseOrder).vendor}`}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>SAP PO Number</label>
                  <input className="input" value={form.po_number} onChange={e=>setForm(f=>({...f,po_number:e.target.value}))} placeholder="e.g. 4500123456" />
                </div>
                <div className="fg">
                  <label>Internal Ref</label>
                  <input className="input" value={form.internal_ref} onChange={e=>setForm(f=>({...f,internal_ref:e.target.value}))} placeholder="SSOP-00176..." />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Vendor *</label>
                  <input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} placeholder="Vendor name" autoFocus />
                </div>
                <div className="fg">
                  <label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {Object.entries(PO_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Scope / description" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Type</label>
                  <select className="input" value={form.po_type} onChange={e=>setForm(f=>({...f,po_type:e.target.value}))}>
                    {Object.entries(PO_TYPE).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Raised Date</label>
                  <input type="date" className="input" value={form.raised_date} onChange={e=>setForm(f=>({...f,raised_date:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Effective Start</label>
                  <input type="date" className="input" value={form.effective_start} onChange={e=>setForm(f=>({...f,effective_start:e.target.value}))} />
                </div>
                <div className="fg">
                  <label>Effective End</label>
                  <input type="date" className="input" value={form.effective_end} onChange={e=>setForm(f=>({...f,effective_end:e.target.value}))} />
                </div>
              </div>

              {/* Line items */}
              <div style={{marginTop:'12px'}}>
                <div style={{fontWeight:600,fontSize:'13px',marginBottom:'8px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  Line Items
                  <button className="btn btn-sm" onClick={()=>setForm(f=>({...f,lines:[...f.lines,mkLine()]}))}>+ Add Line</button>
                </div>
                {form.lines.map((line, i) => (
                  <div key={line.id} style={{display:'grid',gridTemplateColumns:'1fr 100px 120px 32px',gap:'6px',marginBottom:'6px',alignItems:'flex-end'}}>
                    <div>
                      {i===0 && <label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>Description</label>}
                      <input className="input" value={line.description} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,description:e.target.value}:l)}))} placeholder="Description / scope" />
                    </div>
                    <div>
                      {i===0 && <label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>WBS</label>}
                      <select className="input" value={line.wbs} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,wbs:e.target.value}:l)}))}>
                        <option value="">— WBS —</option>
                        {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
                      </select>
                    </div>
                    <div>
                      {i===0 && <label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>Value</label>}
                      <input type="number" className="input" value={line.value||''} min={0} placeholder="0.00"
                        onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,value:parseFloat(e.target.value)||0}:l)}))} />
                    </div>
                    <button className="btn btn-sm" style={{color:'var(--red)',padding:'4px 6px'}} onClick={()=>setForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))}>✕</button>
                  </div>
                ))}
                {formValue > 0 && (
                  <div style={{textAlign:'right',padding:'6px 0',fontWeight:700,fontFamily:'var(--mono)',fontSize:'13px',color:'#1e40af'}}>
                    Total: {fmt(formValue, form.currency)}
                  </div>
                )}
              </div>

              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} />
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{deletePO(modal as PurchaseOrder);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save PO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PO Row component ──────────────────────────────────────────────────────────
function PORow({ po, meta, poValue, poForecast, poInvoiced, invoices, expanded, setExpanded, openEdit, advanceStatus, setActivePanel }: {
  po: PurchaseOrder; meta: typeof PO_STATUS[string]
  poValue: (po: PurchaseOrder) => number
  poForecast: (id: string) => number | null
  poInvoiced: (id: string) => {total:number;approved:number;count:number}
  invoices: {id:string;po_id:string|null;amount:number;status:string}[]
  expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  openEdit: (po: PurchaseOrder) => void
  advanceStatus: (po: PurchaseOrder) => void
  setActivePanel: (panel: string) => void
}) {
  const val = poValue(po)
  const forecast = poForecast(po.id)
  const { total: invoiced, approved, count: invCount } = poInvoiced(po.id)
  const p = po as PurchaseOrder & { line_items?: {wbs:string;description:string}[]; po_type?: string; effective_start?: string; effective_end?: string }
  const lines = p.line_items || []
  const cur = po.currency || 'AUD'
  const wbsCodes = [...new Set(lines.map(l=>l.wbs).filter(Boolean))]
  const wbsDisplay = wbsCodes.length > 1 ? `${wbsCodes.length} WBS codes` : (wbsCodes[0] || '—')
  const poRef = po.po_number || po.internal_ref || 'No PO#'
  const invoicedPct = val > 0 ? Math.min(100, invoiced/val*100) : 0
  const approvedPct = val > 0 ? Math.min(100, approved/val*100) : 0
  const isExpanded = expanded.has(po.id)
  const nextStatus = PO_NEXT[po.status]

  const INV_STATUS_COLOR: Record<string,string> = { received:'#d97706', checked:'#7c3aed', approved:'#059669', paid:'#059669', disputed:'#dc2626' }

  return (
    <>
      <div style={{borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr auto auto',alignItems:'stretch'}}>
          {/* LEFT: identity */}
          <div style={{padding:'12px 16px',borderRight:'1px solid var(--border)'}}>
            <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'3px',flexWrap:'wrap'}}>
              <span style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'13px'}}>{poRef}</span>
              <span style={{fontSize:'9px',fontWeight:700,padding:'2px 6px',borderRadius:'3px',background:meta.bg,color:meta.color}}>{meta.label.toUpperCase()}</span>
              {p.po_type && <span style={{fontSize:'10px',color:'var(--text3)'}}>· {PO_TYPE[p.po_type] || p.po_type}</span>}
              {po.po_number && po.internal_ref && <span style={{fontSize:'10px',color:'var(--text3)'}}>· {po.internal_ref}</span>}
            </div>
            <div style={{fontWeight:600,fontSize:'14px',marginBottom:'2px'}}>{po.vendor || 'No vendor'}</div>
            <div style={{fontSize:'12px',color:'var(--text2)',marginBottom:'6px'}}>{po.description || '—'}</div>
            {po.quote_source?.type === 'rfq' && po.quote_source?.docTitle && (
              <div style={{fontSize:'10px',color:'#059669',fontWeight:600,marginBottom:'4px'}}>
                🔗 RFQ: {po.quote_source.docTitle}
              </div>
            )}
            <div style={{display:'flex',gap:'14px',fontSize:'11px',color:'var(--text3)',flexWrap:'wrap',alignItems:'center'}}>
              <span title={wbsCodes.join(', ')}>📋 <span style={{fontFamily:'var(--mono)',color:'var(--text2)'}}>{wbsDisplay}</span></span>
              {(p.effective_start || p.effective_end) && (
                <span>📅 {fmtDate(p.effective_start)} → {fmtDate(p.effective_end)}</span>
              )}
              {lines.length > 1 && <span>🔢 {lines.length} lines</span>}
            </div>
          </div>

          {/* CENTRE: four value columns */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,130px)',borderRight:'1px solid var(--border)'}}>
            {[
              { label:'PO Value', value: fmt(val,cur), sub: `${cur} · ${lines.length||1} line${(lines.length||1)!==1?'s':''}`, color:'#1e40af' },
              { label:'Forecast', value: forecast !== null ? fmt(forecast,cur) : '—', sub: forecast !== null ? (forecast > val && val > 0 ? '⚠ over PO' : pct(forecast,val) + ' of PO') : 'No linked costs', color:'#7c3aed' },
              { label:'Invoiced', value: fmt(invoiced,cur), sub: `${invCount} invoice${invCount!==1?'s':''} · ${pct(invoiced,val)}`, color: invoiced > val && val > 0 ? 'var(--red)' : '#059669' },
              { label:'Approved', value: fmt(approved,cur), sub: pct(approved,val) + ' of PO', color:'#0369a1' },
            ].map((col, ci) => (
              <div key={ci} style={{padding:'12px 14px',borderRight: ci<3?'1px solid var(--border)':'none',display:'flex',flexDirection:'column',justifyContent:'center'}}>
                <div style={{fontSize:'10px',fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'4px'}}>{col.label}</div>
                <div style={{fontSize:'17px',fontWeight:700,fontFamily:'var(--mono)',color:col.color,lineHeight:1}}>{col.value}</div>
                <div style={{fontSize:'10px',color:'var(--text3)',marginTop:'3px'}}>{col.sub}</div>
              </div>
            ))}
          </div>

          {/* RIGHT: actions + progress bar */}
          <div style={{padding:'12px',display:'flex',flexDirection:'column',gap:'6px',justifyContent:'center',alignItems:'flex-end',minWidth:'140px'}}>
            <div style={{display:'flex',gap:'4px'}}>
              <button className="btn btn-sm" style={{fontSize:'11px'}} onClick={()=>setExpanded(s=>{const n=new Set(s);isExpanded?n.delete(po.id):n.add(po.id);return n})}>
                🧾 Invoices {invCount > 0 ? `(${invCount})` : ''}
              </button>
              <button className="btn btn-sm" style={{fontSize:'11px'}} onClick={()=>openEdit(po)}>Edit</button>
              {nextStatus && (
                <button className="btn btn-sm" style={{fontSize:'11px'}} title={`Advance to ${PO_STATUS[nextStatus].label}`} onClick={()=>advanceStatus(po)}>→</button>
              )}
            </div>
            {val > 0 && (
              <div style={{width:'148px'}}>
                <div style={{height:'5px',background:'var(--border)',borderRadius:'3px',overflow:'hidden',position:'relative'}}>
                  <div style={{position:'absolute',top:0,left:0,height:'100%',width:`${invoicedPct}%`,background:'#059669',borderRadius:'3px'}} />
                  <div style={{position:'absolute',top:0,left:0,height:'100%',width:`${approvedPct}%`,background:'#0369a1',borderRadius:'3px',opacity:0.8}} />
                </div>
                <div style={{display:'flex',gap:'8px',fontSize:'9px',color:'var(--text3)',marginTop:'3px'}}>
                  <span style={{color:'#059669'}}>■ Invoiced</span>
                  <span style={{color:'#0369a1'}}>■ Approved</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inline invoice list */}
        {isExpanded && (
          <div style={{borderTop:'1px solid var(--border)',padding:'12px 16px',background:'var(--bg3)'}}>
            {invoices.length === 0 ? (
              <div style={{fontSize:'12px',color:'var(--text3)',display:'flex',alignItems:'center',gap:'12px'}}>
                <span>No invoices linked to this PO.</span>
                <button className="btn btn-sm" style={{fontSize:'11px'}} onClick={()=>setActivePanel('invoices')}>+ Add Invoice</button>
              </div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                <thead>
                  <tr style={{color:'var(--text3)',fontSize:'10px',textTransform:'uppercase'}}>
                    <th style={{padding:'4px 8px',textAlign:'left'}}>Invoice #</th>
                    <th style={{padding:'4px 8px',textAlign:'right'}}>Amount</th>
                    <th style={{padding:'4px 8px',textAlign:'left'}}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} style={{borderTop:'1px solid var(--border)'}}>
                      <td style={{padding:'5px 8px',fontFamily:'var(--mono)'}}>{inv.id.slice(0,8)}…</td>
                      <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>{fmt(inv.amount||0, cur)}</td>
                      <td style={{padding:'5px 8px'}}>
                        <span style={{fontSize:'10px',padding:'2px 8px',borderRadius:'3px',background: INV_STATUS_COLOR[inv.status]+'20',color:INV_STATUS_COLOR[inv.status]||'var(--text3)',fontWeight:600}}>{inv.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  )
}
