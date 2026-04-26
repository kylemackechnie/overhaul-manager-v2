import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface WositLine {
  id: string; project_id: string; item_no: string; description: string
  part_no: string; material_no: string; tv_no: string; vb_no: string
  install_location: string; location: string; delivery_package: string; unit: string
  qty_required: number; qty_ordered: number; qty_received: number; qty_issued: number
  vendor: string; status: string; notes: string; created_at: string
}
interface IssuedLog {
  id: string; wosit_line_id: string | null; material_no: string; description: string
  qty: number; issued_to: string; work_order: string; issued_by: string
  issued_at: string; notes: string
}

const STATUSES = ['required','ordered','partial','received','not_required','issued'] as const
const STATUS_STYLE: Record<string,{bg:string,color:string,label:string}> = {
  required:    {bg:'#dbeafe',color:'#1e40af',label:'Required'},
  ordered:     {bg:'#fef3c7',color:'#92400e',label:'Ordered'},
  received:    {bg:'#d1fae5',color:'#065f46',label:'Received'},
  partial:     {bg:'#fef3c7',color:'#d97706',label:'Partial'},
  issued:      {bg:'#f3e8ff',color:'#6b21a8',label:'Issued'},
  not_required:{bg:'#e5e7eb',color:'#374151',label:'Not Required'},
}
const EMPTY = {
  item_no:'', description:'', part_no:'', material_no:'', tv_no:'', vb_no:'',
  install_location:'', location:'', delivery_package:'', unit:'PCE',
  qty_required:1, qty_ordered:0, qty_received:0, qty_issued:0,
  vendor:'', status:'required', notes:''
}

type ViewTab = 'list' | 'receiving' | 'issue' | 'log'

export function SparePartsPanel() {
  const { activeProject, currentUser } = useAppStore()
  const [parts, setParts] = useState<WositLine[]>([])
  const [issuedLog, setIssuedLog] = useState<IssuedLog[]>([])
  const [wos, setWos] = useState<{wo_number:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<ViewTab>('list')
  const [modal, setModal] = useState<null|'new'|WositLine>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Receiving state
  const [recvSearch, setRecvSearch] = useState('')
  const [recvQty, setRecvQty] = useState<Record<string,number>>({})
  const [recvLocation, setRecvLocation] = useState<Record<string,string>>({})
  const [recvSaving, setRecvSaving] = useState(false)

  // Issue state
  const [issueSearch, setIssueSearch] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [issueQty, setIssueQty] = useState<Record<string,number>>({})
  const [basket, setBasket] = useState<{materialNo:string;description:string;qty:number}[]>([])
  const [kits, setKits] = useState<{id:string;name:string;parts:{materialNo:string;description:string;qty:number}[]}[]>([])
  const [showBasket, setShowBasket] = useState(false)
  const [issueWO, setIssueWO] = useState('')
  const [issueTo, setIssueTo] = useState('')
  const [issueSaving, setIssueSaving] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  async function applyBulkStatus() {
    if (!bulkStatus || selected.size === 0) return
    setBulkSaving(true)
    const { error } = await supabase.from('wosit_lines').update({ status: bulkStatus }).in('id', [...selected])
    if (error) { toast(error.message, 'error'); setBulkSaving(false); return }
    toast(`Updated ${selected.size} parts to ${bulkStatus}`, 'success')
    setSelected(new Set()); setBulkStatus(''); setBulkSaving(false); load()
  }

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useEffect(() => {
    supabase.from('global_kits').select('id,name,parts').then(r => setKits((r.data||[]) as typeof kits))
  }, [])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [partsData, logData, woData] = await Promise.all([
      supabase.from('wosit_lines').select('*').eq('project_id', pid).order('tv_no').order('item_no'),
      supabase.from('issued_log').select('*').eq('project_id', pid).order('issued_at', {ascending:false}).limit(100),
      supabase.from('work_orders').select('wo_number').eq('project_id', pid).order('wo_number'),
    ])
    setParts((partsData.data||[]) as WositLine[])
    setIssuedLog((logData.data||[]) as IssuedLog[])
    setWos((woData.data||[]) as {wo_number:string}[])
    setLoading(false)
  }

  // ── CRUD ──
  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(p: WositLine) {
    setForm({ item_no:p.item_no, description:p.description, part_no:p.part_no,
      material_no:p.material_no, tv_no:p.tv_no, vb_no:p.vb_no,
      install_location:p.install_location, location:p.location,
      delivery_package:p.delivery_package, unit:p.unit||'PCE',
      qty_required:p.qty_required, qty_ordered:p.qty_ordered, qty_received:p.qty_received,
      qty_issued:p.qty_issued||0, vendor:p.vendor, status:p.status, notes:p.notes })
    setModal(p)
  }
  async function save() {
    if (!form.description.trim()) return toast('Description required','error')
    setSaving(true)
    const payload = { project_id:activeProject!.id, ...form,
      item_no:form.item_no.trim(), description:form.description.trim(),
      part_no:form.part_no.trim(), material_no:form.material_no.trim() }
    const isNew = modal==='new'
    const {error} = isNew
      ? await supabase.from('wosit_lines').insert(payload)
      : await supabase.from('wosit_lines').update(payload).eq('id',(modal as WositLine).id)
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast(isNew?'Part added':'Saved','success'); setSaving(false); setModal(null); load()
  }
  async function del(p: WositLine) {
    if (!confirm(`Delete "${p.description}"?`)) return
    await supabase.from('wosit_lines').delete().eq('id',p.id)
    toast('Deleted','info'); load()
  }

  // ── RECEIVING ──
  const receivable = parts.filter(p => p.status !== 'not_required' && (p.qty_received < p.qty_required || p.qty_ordered > 0))
    .filter(p => !recvSearch || p.description.toLowerCase().includes(recvSearch.toLowerCase()) || p.material_no.includes(recvSearch) || p.tv_no.includes(recvSearch))

  async function confirmReceiving() {
    const toUpdate = Object.entries(recvQty).filter(([,q]) => q > 0)
    if (!toUpdate.length) return toast('Enter quantities to receive','error')
    setRecvSaving(true)
    for (const [id, qty] of toUpdate) {
      const part = parts.find(p => p.id === id)
      if (!part) continue
      const newQty = (part.qty_received||0) + qty
      const newStatus = newQty >= part.qty_required ? 'received' : 'ordered'
      const loc = recvLocation[id] || part.location
      await supabase.from('wosit_lines').update({ qty_received:newQty, status:newStatus, location:loc }).eq('id',id)
    }
    toast(`Received ${toUpdate.length} items`,'success')
    setRecvQty({}); setRecvLocation({})
    setRecvSaving(false); load()
  }

  // ── ISSUE ──
  const issuable = parts.filter(p => (p.qty_received - (p.qty_issued||0)) > 0)
    .filter(p => !issueSearch || p.description.toLowerCase().includes(issueSearch.toLowerCase()) || p.material_no.includes(issueSearch))


  async function processBulkIssue() {
    if (!issueTo.trim()) { toast('Enter who parts are issued to', 'error'); return }
    const lines = bulkText.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) { setBulkError('Enter at least one line (MATERIAL_NO QTY)'); return }

    const requests: {materialNo:string;qty:number}[] = []
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/)
      const mat = parts[0]?.trim().toUpperCase()
      const qty = parseInt(parts[1])
      if (!mat) continue
      if (!qty || qty < 1) { setBulkError(`Line ${i+1}: invalid quantity — format is MATERIAL_NO QTY`); return }
      const existing = requests.find(r => r.materialNo === mat)
      if (existing) existing.qty += qty
      else requests.push({ materialNo: mat, qty })
    }
    if (!requests.length) { setBulkError('No valid parts found'); return }
    setBulkError('')

    // Match requests against received inventory
    const logEntries: {project_id:string;material_no:string;description:string;qty:number;issued_to:string;work_order:string|null;issued_at:string;notes:string}[] = []
    const updates: {id:string;qty_issued:number}[] = []
    const errors: string[] = []

    for (const req of requests) {
      const matching = parts.filter(p =>
        (p.material_no || '').toUpperCase() === req.materialNo &&
        (p.qty_received || 0) - (p.qty_issued || 0) > 0
      )
      let remaining = req.qty
      for (const p of matching) {
        if (remaining <= 0) break
        const avail = (p.qty_received || 0) - (p.qty_issued || 0)
        const take = Math.min(remaining, avail)
        updates.push({ id: p.id, qty_issued: (p.qty_issued || 0) + take })
        logEntries.push({ project_id: activeProject!.id, material_no: req.materialNo, description: p.description || '', qty: take, issued_to: issueTo, work_order: issueWO || null, issued_at: new Date().toISOString(), notes: '' })
        remaining -= take
      }
      if (remaining > 0) errors.push(`${req.materialNo}: only ${req.qty - remaining} available (requested ${req.qty})`)
    }

    if (!updates.length) { setBulkError('No matching parts found in inventory'); return }

    setIssueSaving(true)
    for (const u of updates) await supabase.from('wosit_lines').update({ qty_issued: u.qty_issued }).eq('id', u.id)
    if (logEntries.length) await supabase.from('issued_log').insert(logEntries)
    setBulkText(''); setBulkMode(false)
    toast(`Issued ${logEntries.reduce((s,e)=>s+e.qty,0)} parts` + (errors.length ? ` (${errors.length} warnings)` : ''), 'success')
    if (errors.length) errors.forEach(e => toast(e, 'error'))
    setIssueSaving(false); load()
  }

  async function confirmIssue() {
    const toIssue = Object.entries(issueQty).filter(([,q]) => q > 0)
    if (!toIssue.length) return toast('Enter quantities to issue','error')
    if (!issueTo.trim()) return toast('Enter who items are being issued to','error')
    setIssueSaving(true)
    for (const [id, qty] of toIssue) {
      const part = parts.find(p => p.id === id)
      if (!part) continue
      const newIssued = (part.qty_issued||0) + qty
      await supabase.from('wosit_lines').update({ qty_issued:newIssued, status:'issued' }).eq('id',id)
      await supabase.from('issued_log').insert({
        project_id:activeProject!.id, wosit_line_id:id,
        material_no:part.material_no, description:part.description,
        qty, issued_to:issueTo, work_order:issueWO,
        issued_by:currentUser?.name||currentUser?.email||'',
      })
    }
    toast(`Issued ${toIssue.length} items to ${issueTo}`,'success')
    setIssueQty({}); setIssueTo(''); setIssueWO('')
    setIssueSaving(false); load()
  }

  // ── CSV export ──
  function exportCSV() {
    const rows = [['Item No','Description','Material No','Part No','TV','VB','Install Location','Location','Qty Req','Qty Ordered','Qty Received','Qty Issued','Status','Vendor']]
    parts.forEach(p => rows.push([p.item_no,p.description,p.material_no,p.part_no,p.tv_no,p.vb_no,p.install_location,p.location,
      String(p.qty_required),String(p.qty_ordered),String(p.qty_received),String(p.qty_issued||0),p.status,p.vendor]))
    const csv = rows.map(r=>r.map(c=>c.includes(',')?`"${c}"`:c).join(',')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download=`parts_${activeProject?.name||'project'}.csv`; a.click()
  }

  // ── Stats ──
  const total = parts.length
  const received = parts.filter(p=>p.status==='received'||p.status==='issued').length
  const pending = parts.filter(p=>p.status==='required'||p.status==='ordered').length
  const issued = parts.filter(p=>p.status==='issued').length

  // ── List filter ──
  const filtered = parts
    .filter(p => statusFilter==='all'||p.status===statusFilter)
    .filter(p => !search || [p.description,p.material_no,p.part_no,p.tv_no,p.item_no].some(f=>f.toLowerCase().includes(search.toLowerCase())))

  const fmt = (n:number) => n.toLocaleString()

  const TAB_BTN = (key: ViewTab, label: string, count?: number) => (
    <button key={key} className="btn btn-sm" style={{background:tab===key?'var(--accent)':'',color:tab===key?'#fff':''}} onClick={()=>setTab(key)}>
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  )

  if (loading) return <div style={{padding:'24px'}}><div className="loading-center"><span className="spinner"/></div></div>


  async function returnPart(logId: string, materialNo: string, description: string, maxQty: number) {
    const qtyStr = window.prompt(`Return how many units of ${description} (${materialNo}) to store?
Max available: ${maxQty}`, '1')
    if (qtyStr === null) return
    const qty = parseInt(qtyStr)
    if (!qty || qty < 1 || qty > maxQty) { toast(`Enter a number between 1 and ${maxQty}`, 'error'); return }

    // Restore qty to wosit_line
    const log = issuedLog.find(l => l.id === logId)
    if (!log?.wosit_line_id) { toast('Cannot find original part record', 'error'); return }
    const part = parts.find(p => p.id === log.wosit_line_id)
    if (!part) { toast('Part not found', 'error'); return }

    const newIssued = Math.max(0, (part.qty_issued || 0) - qty)
    const newStatus = newIssued === 0 ? 'received' : newIssued < (part.qty_received || 0) ? 'partial' : part.status

    const [r1, r2] = await Promise.all([
      supabase.from('wosit_lines').update({ qty_issued: newIssued, status: newStatus }).eq('id', part.id),
      supabase.from('issued_log').delete().eq('id', logId),
    ])
    if (r1.error || r2.error) { toast((r1.error||r2.error)?.message||'Error', 'error'); return }
    toast(`Returned ${qty} unit${qty>1?'s':''} to store`, 'success'); load()
  }

  return (
    <div style={{padding:'24px',maxWidth:'1100px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Spare Parts / WOSIT</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {total} parts · {received} received · {pending} pending · {issued} issued
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Part</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'16px'}}>
        {[
          {label:'Total Parts',value:fmt(total),color:'var(--accent)'},
          {label:'Received',value:fmt(received),color:'var(--green)'},
          {label:'Pending',value:fmt(pending),color:'var(--amber)'},
          {label:'Issued',value:fmt(issued),color:'#7c3aed'},
        ].map(t=>(
          <div key={t.label} className="card" style={{padding:'12px 16px',borderTop:`3px solid ${t.color}`}}>
            <div style={{fontSize:'20px',fontWeight:700,fontFamily:'var(--mono)',color:t.color}}>{t.value}</div>
            <div style={{fontSize:'12px',marginTop:'2px'}}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div style={{display:'flex',gap:'6px',marginBottom:'16px'}}>
        {TAB_BTN('list','📋 Parts List',total)}
        {TAB_BTN('receiving','📥 Receiving',pending)}
        {TAB_BTN('issue','📤 Issue Parts',received-issued)}
        {TAB_BTN('log','📜 Issue Log',issuedLog.length)}
      </div>

      {/* ── LIST TAB ── */}
      {tab==='list' && <>
        <div style={{marginBottom:'10px',display:'flex',gap:'8px',justifyContent:'flex-end'}}>
          <button className="btn btn-sm" onClick={() => {
            const rows = [['Material No','Description','TV','Crate','Box','Location','Qty Received','Qty Issued','Qty Remaining','Status'],
              ...parts.map(p => [p.material_no||'',p.description||'',
                (p as typeof p & {tv?:string}).tv||'',(p as typeof p & {crate?:string}).crate||'',(p as typeof p & {box?:string}).box||'',
                p.location||'', p.qty_received||0, p.qty_issued||0,
                (p.qty_received||0)-(p.qty_issued||0), p.status||''])]
            const csv = rows.map(r=>r.map(x=>String(x).includes(',')?`"${x}"`:x).join(',')).join('\n')
            const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='parts-inventory.csv';a.click()
          }} disabled={parts.length===0}>⬇ Inventory CSV</button>
          <button className="btn btn-sm" onClick={() => {
            const pending = parts.filter(p => !p.status || p.status==='pending')
            if (!pending.length) { alert('No pending parts to pick'); return }
            const rows = [['Material No','Description','Location','TV','Crate','Box','Qty'],
              ...pending.map(p => [p.material_no||'',p.description||'',p.location||'',
                (p as typeof p & {tv?:string}).tv||'',(p as typeof p & {crate?:string}).crate||'',(p as typeof p & {box?:string}).box||'',p.qty_received||0])]
            const csv = rows.map(r=>r.join(',')).join('\n')
            const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='pick-list.csv';a.click()
          }} disabled={parts.length===0}>🖨 Pick List</button>
        </div>
        <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
          <input className="input" style={{maxWidth:'260px'}} placeholder="Search description, material no, TV..." value={search} onChange={e=>setSearch(e.target.value)} />
          <select className="input" style={{width:'150px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {STATUSES.map(s=><option key={s} value={s}>{STATUS_STYLE[s]?.label||s}</option>)}
          </select>
        </div>
        {selected.size > 0 && (
                  <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'8px 10px',background:'var(--bg3)',borderBottom:'1px solid var(--border)',marginBottom:'8px',borderRadius:'6px'}}>
                    <span style={{fontSize:'12px',fontWeight:600,color:'var(--accent)'}}>{selected.size} selected</span>
                    <select className="input" style={{width:'160px',fontSize:'12px'}} value={bulkStatus} onChange={e=>setBulkStatus(e.target.value)}>
                      <option value="">Set status...</option>
                      {STATUSES.map(s=><option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
                    </select>
                    <button className="btn btn-sm btn-primary" onClick={applyBulkStatus} disabled={bulkSaving||!bulkStatus}>{bulkSaving?<span className="spinner" style={{width:'12px',height:'12px'}}/>:null} Apply</button>
                    <button className="btn btn-sm" onClick={()=>{setSelected(new Set());setBulkStatus('')}}>Clear</button>
                  </div>
                )}
   {filtered.length===0 ? (
          <div className="empty-state"><div className="icon">📦</div><h3>No parts</h3><p>Add parts manually or use the TV/Kollo/WOSIT import (coming soon).</p></div>
        ) : (
          <div className="card" style={{padding:0,overflow:'auto'}}>
            <table style={{minWidth:'900px'}}>
              <thead><tr>
                <th>Item No</th><th>Description</th><th>Material No</th>
                <th>TV</th><th>Location</th>
                <th style={{textAlign:'right'}}>Req</th>
                <th style={{textAlign:'right'}}>Rcvd</th>
                <th style={{textAlign:'right'}}>Issued</th>
                <th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map(p=>{
                  const ss=STATUS_STYLE[p.status]||STATUS_STYLE.required
                  const needsAttn = p.qty_received < p.qty_required && p.status!=='not_required'
                  return (
                    <tr key={p.id} style={{background:selected.has(p.id)?'rgba(59,130,246,0.06)':needsAttn?'rgba(251,191,36,0.04)':''}}>
                      <td><input type="checkbox" checked={selected.has(p.id)} onChange={e=>{const ns=new Set(selected);e.target.checked?ns.add(p.id):ns.delete(p.id);setSelected(ns)}}/></td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{p.item_no||'—'}</td>
                      <td style={{fontWeight:500,maxWidth:'220px'}}><div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.description}</div>
                        {p.install_location&&<div style={{fontSize:'10px',color:'var(--text3)'}}>{p.install_location}</div>}
                      </td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px'}}>{p.material_no||p.part_no||'—'}</td>
                      <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.tv_no||'—'}</td>
                      <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.location||'—'}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{p.qty_required}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:p.qty_received>=p.qty_required?'var(--green)':'var(--amber)'}}>{p.qty_received}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'#7c3aed'}}>{p.qty_issued||0}</td>
                      <td><span className="badge" style={ss}>{ss.label}</span></td>
                      <td style={{whiteSpace:'nowrap'}}>
                        <button className="btn btn-sm" onClick={()=>openEdit(p)}>Edit</button>
                        <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>del(p)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </>}

      {/* ── RECEIVING TAB ── */}
      {tab==='receiving' && <>
        <div className="card" style={{marginBottom:'12px',padding:'12px 16px',background:'#fffbeb',borderLeft:'4px solid var(--amber)'}}>
          <p style={{fontSize:'13px',margin:0}}>Enter quantities received for each part. Location is optional — enter where the part has been stored on site (e.g. TV482, Crate 3, Workshop).</p>
        </div>
        <div style={{display:'flex',gap:'8px',marginBottom:'12px',alignItems:'center'}}>
          <input className="input" style={{maxWidth:'280px'}} placeholder="Search parts to receive..." value={recvSearch} onChange={e=>setRecvSearch(e.target.value)} />
          <button className="btn btn-sm" onClick={() => {
            const all: Record<string,number> = {}
            parts.filter(p => p.qty_received < p.qty_required && p.status !== 'not_required')
              .forEach(p => { all[p.id] = Math.max(0, p.qty_required - p.qty_received) })
            setRecvQty(all)
          }}>✓ Fill All Qtys</button>
        </div>
        {receivable.length===0 ? (
          <div className="empty-state"><div className="icon">✅</div><h3>All parts received</h3><p>No parts pending receipt.</p></div>
        ) : (
          <div className="card" style={{padding:0,overflow:'auto',marginBottom:'12px'}}>
            <table style={{minWidth:'700px'}}>
              <thead><tr><th>Description</th><th>Material No</th><th>TV</th><th style={{textAlign:'right'}}>Req</th><th style={{textAlign:'right'}}>Already Rcvd</th><th style={{textAlign:'right'}}>Qty Receiving</th><th>Location</th></tr></thead>
              <tbody>
                {receivable.map(p=>(
                  <tr key={p.id}>
                    <td style={{fontWeight:500}}>{p.description}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px'}}>{p.material_no||p.part_no||'—'}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.tv_no||'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{p.qty_required}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--text3)'}}>{p.qty_received}</td>
                    <td style={{textAlign:'right',width:'100px'}}>
                      <input type="number" min="0" max={p.qty_required-p.qty_received} className="input"
                        style={{width:'80px',textAlign:'right',padding:'4px 6px',fontSize:'13px',fontFamily:'var(--mono)'}}
                        value={recvQty[p.id]||''} placeholder="0"
                        onChange={e=>setRecvQty(q=>({...q,[p.id]:parseInt(e.target.value)||0}))} />
                    </td>
                    <td style={{width:'160px'}}>
                      <input className="input" style={{padding:'4px 6px',fontSize:'12px'}} placeholder="e.g. TV482 / Crate 3"
                        value={recvLocation[p.id]||''} onChange={e=>setRecvLocation(l=>({...l,[p.id]:e.target.value}))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {receivable.length>0 && (
          <button className="btn btn-primary" onClick={confirmReceiving} disabled={recvSaving}>
            {recvSaving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} ✓ Confirm Receipt
          </button>
        )}
      </>}

      {/* ── ISSUE TAB ── */}
      {tab==='issue' && <>
        <div className="card" style={{marginBottom:'12px',padding:'12px 16px'}}>
          <div className="fg-row" style={{alignItems:'flex-end'}}>
            <div className="fg" style={{flex:2}}><label>Issued To *</label><input className="input" value={issueTo} onChange={e=>setIssueTo(e.target.value)} placeholder="Name or team receiving parts" /></div>
            <div className="fg"><label>Work Order</label>
              <select className="input" value={issueWO} onChange={e=>setIssueWO(e.target.value)}>
                <option value="">— No WO —</option>
                {wos.map(w=><option key={w.wo_number} value={w.wo_number}>{w.wo_number}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:'8px',marginBottom:'12px',alignItems:'center'}}>
          <input className="input" style={{flex:1,maxWidth:'280px'}} placeholder="Search available parts..." value={issueSearch} onChange={e=>setIssueSearch(e.target.value)} />
          <button className="btn btn-sm" onClick={()=>{setBulkMode(m=>!m);setBulkError('')}}>
            {bulkMode ? '📋 List mode' : '📝 Bulk text mode'}
          </button>
          {kits.length > 0 && (
            <select className="input" style={{maxWidth:'200px'}} value="" onChange={e=>{
              const kit = kits.find(k=>k.id===e.target.value)
              if (!kit) return
              const newItems = (kit.parts||[]).map((p:{materialNo:string;description:string;qty:number})=>({materialNo:p.materialNo||'',description:p.description||'',qty:p.qty||1}))
              setBasket(b=>{
                const merged=[...b]
                newItems.forEach(item=>{const existing=merged.find(x=>x.materialNo===item.materialNo);if(existing)existing.qty+=item.qty;else merged.push({...item})})
                return merged
              })
              setShowBasket(true)
              ;(e.target as HTMLSelectElement).value=''
            }}>
              <option value="">🧰 Add from kit...</option>
              {kits.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          )}
          {basket.length > 0 && (
            <button className="btn btn-sm" style={{background:'var(--accent)',color:'#fff'}} onClick={()=>setShowBasket(b=>!b)}>
              🧺 Basket ({basket.reduce((s,i)=>s+i.qty,0)})
            </button>
          )}
        </div>
        {bulkMode && (
          <div className="card" style={{padding:'14px 16px',marginBottom:'12px'}}>
            <div style={{fontSize:'12px',fontWeight:600,marginBottom:'6px'}}>Bulk Issue — one line per part: <code>MATERIAL_NO QTY</code></div>
            <div style={{fontSize:'11px',color:'var(--text3)',marginBottom:'8px'}}>e.g. "1234567890 2" — duplicates are merged, stock is depleted from oldest box first</div>
            <textarea className="input" style={{width:'100%',fontFamily:'var(--mono)',fontSize:'12px',minHeight:'120px',resize:'vertical'}}
              placeholder="1234567890 2&#10;9876543210 1&#10;..."
              value={bulkText} onChange={e=>setBulkText(e.target.value)} />
            {bulkError && <div style={{color:'var(--red)',fontSize:'12px',marginTop:'6px'}}>⚠ {bulkError}</div>}
            <button className="btn btn-primary" style={{marginTop:'10px'}} onClick={processBulkIssue} disabled={issueSaving}>
              {issueSaving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} 📤 Process Bulk Issue
            </button>
          </div>
        )}
        {showBasket && basket.length > 0 && (
          <div className="card" style={{padding:'12px 16px',marginBottom:'12px',border:'1px solid var(--accent)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
              <div style={{fontWeight:600,fontSize:'13px'}}>🧺 Issue Basket</div>
              <button className="btn btn-sm" style={{color:'var(--text3)'}} onClick={()=>setBasket([])}>Clear</button>
            </div>
            {basket.map((item,i)=>(
              <div key={i} style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'4px',fontSize:'12px'}}>
                <span style={{flex:1,fontFamily:'var(--mono)'}}>{item.materialNo}</span>
                <span style={{flex:2,color:'var(--text2)'}}>{item.description}</span>
                <input type="number" className="input" style={{width:'60px',textAlign:'right',padding:'2px 6px',fontSize:'12px'}}
                  value={item.qty} min={1} onChange={e=>setBasket(b=>b.map((x,j)=>j===i?{...x,qty:parseInt(e.target.value)||1}:x))} />
                <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:'14px'}} onClick={()=>setBasket(b=>b.filter((_,j)=>j!==i))}>✕</button>
              </div>
            ))}
            <button className="btn btn-primary btn-sm" style={{marginTop:'8px'}} onClick={()=>{
              // Transfer basket to issueQty by matching material numbers
              const newQty = {...issueQty}
              basket.forEach(item=>{
                const part = parts.find(p=>p.material_no===item.materialNo)
                if (part) newQty[part.id] = (newQty[part.id]||0) + item.qty
              })
              setIssueQty(newQty); setBasket([]); setShowBasket(false)
              toast('Basket applied to issue quantities', 'success')
            }}>↓ Apply to Issue List</button>
          </div>
        )}
        {issuable.length===0 ? (
          <div className="empty-state"><div className="icon">📦</div><h3>No parts available to issue</h3><p>Parts must be received before they can be issued.</p></div>
        ) : (
          <div className="card" style={{padding:0,overflow:'auto',marginBottom:'12px'}}>
            <table style={{minWidth:'600px'}}>
              <thead><tr><th>Description</th><th>Material No</th><th>Location</th><th style={{textAlign:'right'}}>Available</th><th style={{textAlign:'right'}}>Qty to Issue</th></tr></thead>
              <tbody>
                {issuable.map(p=>{
                  const avail = (p.qty_received||0)-(p.qty_issued||0)
                  return (
                    <tr key={p.id}>
                      <td style={{fontWeight:500}}>{p.description}</td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px'}}>{p.material_no||p.part_no||'—'}</td>
                      <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.location||'—'}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>{avail}</td>
                      <td style={{textAlign:'right',width:'100px'}}>
                        <input type="number" min="0" max={avail} className="input"
                          style={{width:'80px',textAlign:'right',padding:'4px 6px',fontSize:'13px',fontFamily:'var(--mono)'}}
                          value={issueQty[p.id]||''} placeholder="0"
                          onChange={e=>setIssueQty(q=>({...q,[p.id]:Math.min(avail,parseInt(e.target.value)||0)}))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {issuable.length>0 && (
          <button className="btn btn-primary" onClick={confirmIssue} disabled={issueSaving}>
            {issueSaving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} 📤 Confirm Issue
          </button>
        )}
      </>}

      {/* ── ISSUE LOG TAB ── */}
      {tab==='log' && issuedLog.length > 0 && (
        <div style={{marginBottom:'10px'}}>
          <button className="btn btn-sm" onClick={() => {
            const rows = [['Date','Part No','Description','Qty','Issued To','Work Order'],
              ...issuedLog.map(l => [l.issued_at?.slice(0,10)||'',l.material_no||'',l.description||'',l.qty||0,l.issued_to||'',l.work_order||''])]
            const csv = rows.map(r=>r.join(',')).join('\n')
            const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='parts-issue-log.csv';a.click()
          }}>⬇ Export Issue Log CSV</button>
        </div>
      )}
      {tab==='log' && (
        issuedLog.length===0 ? (
          <div className="empty-state"><div className="icon">📜</div><h3>No issues recorded</h3><p>Issue parts using the Issue Parts tab to populate this log.</p></div>
        ) : (
          <div className="card" style={{padding:0,overflow:'auto'}}>
            <table>
              <thead><tr><th>Date/Time</th><th>Description</th><th>Material No</th><th style={{textAlign:'right'}}>Qty</th><th>Issued To</th><th>Work Order</th><th>Issued By</th></tr></thead>
              <tbody>
                {issuedLog.map(l=>(
                  <tr key={l.id}>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',whiteSpace:'nowrap'}}>{new Date(l.issued_at).toLocaleDateString('en-AU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{fontWeight:500,fontSize:'13px'}}>{l.description}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.material_no||'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:'#7c3aed'}}>{l.qty}</td>
                    <td style={{fontSize:'12px'}}>{l.issued_to||'—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.work_order||'—'}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)'}}>{l.issued_by||'—'}</td>
                    <td><button className="btn btn-sm" style={{fontSize:'10px',padding:'2px 6px'}} onClick={()=>returnPart(l.id,l.material_no||'',l.description||l.material_no||'',l.qty||1)}>↩ Return</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── MODAL ── */}
      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'640px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add Part':'Edit Part'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg"><label>Description *</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} autoFocus /></div>
              <div className="fg-row">
                <div className="fg"><label>Material No</label><input className="input" value={form.material_no} onChange={e=>setForm(f=>({...f,material_no:e.target.value}))} placeholder="SAP material number" style={{fontFamily:'var(--mono)'}} /></div>
                <div className="fg"><label>Part No</label><input className="input" value={form.part_no} onChange={e=>setForm(f=>({...f,part_no:e.target.value}))} style={{fontFamily:'var(--mono)'}} /></div>
                <div className="fg"><label>Item No</label><input className="input" value={form.item_no} onChange={e=>setForm(f=>({...f,item_no:e.target.value}))} style={{fontFamily:'var(--mono)'}} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>TV No</label><input className="input" value={form.tv_no} onChange={e=>setForm(f=>({...f,tv_no:e.target.value}))} placeholder="e.g. TV482" /></div>
                <div className="fg"><label>VB No</label><input className="input" value={form.vb_no} onChange={e=>setForm(f=>({...f,vb_no:e.target.value}))} placeholder="e.g. VB-001" /></div>
                <div className="fg"><label>Delivery Package</label><input className="input" value={form.delivery_package} onChange={e=>setForm(f=>({...f,delivery_package:e.target.value}))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}><label>Install Location</label><input className="input" value={form.install_location} onChange={e=>setForm(f=>({...f,install_location:e.target.value}))} placeholder="Where this part is installed" /></div>
                <div className="fg"><label>On-site Location</label><input className="input" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Where stored on site" /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Qty Required</label><input type="number" className="input" value={form.qty_required} onChange={e=>setForm(f=>({...f,qty_required:parseInt(e.target.value)||1}))} min={1} /></div>
                <div className="fg"><label>Qty Ordered</label><input type="number" className="input" value={form.qty_ordered} onChange={e=>setForm(f=>({...f,qty_ordered:parseInt(e.target.value)||0}))} min={0} /></div>
                <div className="fg"><label>Qty Received</label><input type="number" className="input" value={form.qty_received} onChange={e=>setForm(f=>({...f,qty_received:parseInt(e.target.value)||0}))} min={0} /></div>
                <div className="fg"><label>Unit</label><select className="input" value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}>
                  {['PCE','SET','M','L','KG','BOX','EA'].map(u=><option key={u} value={u}>{u}</option>)}</select></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{STATUS_STYLE[s]?.label||s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Vendor</label><input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} /></div>
              </div>
              <div className="fg"><label>Notes</label><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-footer">
              {modal!=='new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as WositLine);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
