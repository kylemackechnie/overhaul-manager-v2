import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { uploadReceipt, deleteReceipt, getSignedUrl, fileIcon, fileName } from '../../lib/receiptStorage'
import { buildForecast } from '../../engines/forecastEngine'
import type { PoBucket } from '../../engines/forecastEngine'
import type { PurchaseOrder, Resource, RateCard, HireItem, Car, Accommodation, Invoice, Project } from '../../types'

const PO_STATUS: Record<string, { label: string; color: string; bg: string; desc: string }> = {
  draft:     { label: 'Draft',     color: '#64748b', bg: '#f1f5f9',  desc: 'Scope identified, quote not yet received' },
  quoted:    { label: 'Quoted',    color: '#d97706', bg: '#fef3c7',  desc: 'Quote received, PO not yet raised' },
  raised:    { label: 'Raised',    color: '#0369a1', bg: '#dbeafe',  desc: 'PO raised in SAP, work not yet started' },
  active:    { label: 'Active',    color: '#059669', bg: '#d1fae5',  desc: 'Work in progress, invoices being received' },
  closed:    { label: 'Closed',    color: '#6b7280', bg: '#e5e7eb',  desc: 'All invoicing reconciled, PO closed' },
  cancelled: { label: 'Cancelled', color: '#dc2626', bg: '#fee2e2',  desc: 'Cancelled' },
}
const PO_TYPE: Record<string, string> = { fixed: 'Fixed Price', rates: 'Time & Materials', estimate: 'Estimate' }
const PO_NEXT: Record<string, string> = { draft: 'quoted', quoted: 'raised', raised: 'active', active: 'closed' }
const STATUS_ORDER = ['active', 'raised', 'quoted', 'draft', 'closed', 'cancelled']
const CURRENCIES = ['AUD', 'EUR', 'USD', 'GBP', 'NZD']

const fmt = (v: number, cur = 'AUD') => {
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? 'US$' : '$'
  if (!v && v !== 0) return '—'
  if (Math.abs(v) >= 1e6) return sym + (v / 1e6).toFixed(2) + 'M'
  if (Math.abs(v) >= 1000) return sym + (v / 1000).toFixed(2) + 'k'
  return sym + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtFull = (v: number) => '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s?: string | null) => s ? s.split('-').reverse().join('/') : '—'
const pctOf = (v: number, t: number) => t > 0 ? Math.min(100, Math.round(v / t * 100)) : 0

function prorateToDate(total: number, start?: string | null, end?: string | null): number {
  if (!start || !total) return 0
  const s = new Date(start + 'T12:00:00'), e = end ? new Date(end + 'T12:00:00') : new Date(), today = new Date()
  const totalDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000))
  const elapsed = Math.max(0, Math.min(totalDays, Math.round((today.getTime() - s.getTime()) / 86400000)))
  return (total / totalDays) * elapsed
}

interface PoLine { id: string; description: string; wbs: string; value: number; notes: string; tce_item_id?: string }
const mkLine = (): PoLine => ({ id: Math.random().toString(36).slice(2), description: '', wbs: '', value: 0, notes: '' })
type PoForm = { po_number: string; internal_ref: string; vendor: string; description: string; status: string; currency: string; po_type: string; notes: string; effective_start: string; effective_end: string; raised_date: string; tce_item_id: string | null; lines: PoLine[] }
const EMPTY_FORM: PoForm = { po_number: '', internal_ref: '', vendor: '', description: '', status: 'draft', currency: 'AUD', po_type: 'fixed', notes: '', effective_start: '', effective_end: '', tce_item_id: null, raised_date: '', lines: [mkLine()] }
type DetailTab = 'overview' | 'labour' | 'equipment' | 'invoices'
interface ActualsRow { person_name: string; role: string; work_date: string; week_start: string; allocated_hours: number; cost_labour: number; cost_allowances: number; po_id?: string }

export function POsPanel() {
  const { activeProject, activePOManagerId, setActivePOManagerId } = useAppStore()
  const { canWrite } = usePermissions()
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [hireItems, setHireItems] = useState<HireItem[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [accom, setAccom] = useState<Accommodation[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [actuals, setActuals] = useState<ActualsRow[]>([])
  const [holidays, setHolidays] = useState<{ date: string }[]>([])
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])
  const [tceLines, setTceLines] = useState<{ item_id: string; description: string; line_type: string | null; source: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [activePO, setActivePO] = useState<PurchaseOrder | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterVendor, setFilterVendor] = useState('')
  const [form, setForm] = useState<PoForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useEffect(() => {
    if (activePOManagerId && pos.length > 0) {
      const po = pos.find(p => p.id === activePOManagerId)
      if (po) { openDetail(po); setActivePOManagerId(null) }
    }
  }, [activePOManagerId, pos])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [poR, rcR, resR, hireR, carR, acR, invR, phR, actR, wbsR, tceR] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('invoices').select('*').eq('project_id', pid),
      supabase.from('public_holidays').select('date').eq('project_id', pid),
      supabase.from('timesheet_cost_lines').select('person_name,role,work_date,week_start,allocated_hours,cost_labour,cost_allowances,po_id').eq('project_id', pid).eq('timesheet_status', 'approved'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('nrg_tce_lines').select('item_id,description,line_type,source').eq('project_id', pid).order('source').order('sort_order').order('item_id'),
    ])
    setPos((poR.data || []) as PurchaseOrder[])
    setRateCards((rcR.data || []) as RateCard[])
    setResources((resR.data || []) as Resource[])
    setHireItems((hireR.data || []) as HireItem[])
    setCars((carR.data || []) as Car[])
    setAccom((acR.data || []) as Accommodation[])
    setInvoices((invR.data || []) as Invoice[])
    setHolidays((phR.data || []) as { date: string }[])
    setActuals((actR.data || []) as ActualsRow[])
    setWbsList((wbsR.data || []) as { id: string; code: string; name: string }[])
    setTceLines((tceR.data || []) as { item_id: string; description: string; line_type: string | null; source: string }[])
    setLoading(false)
  }

  const forecast = useMemo(() => {
    if (!resources.length && !hireItems.length) return null
    const proj = activeProject as Project
    const ph = proj as Project & { std_hours?: { day: Record<string,number>; night: Record<string,number> } }
    const stdHours = ph?.std_hours || { day: { mon:10,tue:10,wed:10,thu:10,fri:10,sat:10,sun:0 }, night: {} }
    const ps = proj as Project & { start_date?: string; end_date?: string }
    return buildForecast(resources, rateCards, [], hireItems, cars, accom, [], stdHours, holidays, ps?.start_date || null, ps?.end_date || null, [], [], 0, [], [])
  }, [resources, rateCards, hireItems, cars, accom, holidays, activeProject])

  function poValue(po: PurchaseOrder): number {
    const lines = (po as PurchaseOrder & { line_items?: PoLine[] }).line_items || []
    return lines.reduce((s, l) => s + (l.value || 0), 0) || (po as unknown as { po_value?: number }).po_value || 0
  }
  function getBucket(id: string): PoBucket | null { return forecast?.byPo[id] ?? null }
  function getLabAct(id: string) { return actuals.filter(a => a.po_id === id) }
  function getHireAct(id: string) {
    return hireItems.filter(h => (h as HireItem & { linked_po_id?: string }).linked_po_id === id).map(h => ({
      ...h, name: (h as HireItem & { name?: string }).name || 'Hire item',
      start_date: (h as HireItem & { start_date?: string }).start_date,
      end_date: (h as HireItem & { end_date?: string }).end_date,
      actualToDate: prorateToDate(h.hire_cost || 0, (h as HireItem & { start_date?: string }).start_date, (h as HireItem & { end_date?: string }).end_date),
    }))
  }
  function getCarAct(id: string) {
    return cars.filter(c => (c as Car & { linked_po_id?: string }).linked_po_id === id).map(c => ({
      ...c, label: (c as Car & { description?: string }).description || (c as Car & { vehicle_type?: string }).vehicle_type || 'Car',
      start_date: (c as Car & { start_date?: string }).start_date,
      end_date: (c as Car & { end_date?: string }).end_date,
      actualToDate: prorateToDate(c.total_cost || 0, (c as Car & { start_date?: string }).start_date, (c as Car & { end_date?: string }).end_date),
    }))
  }
  function getAccomAct(id: string) {
    return accom.filter(a => (a as Accommodation & { linked_po_id?: string }).linked_po_id === id).map(a => ({
      ...a, property: (a as Accommodation & { property?: string }).property || 'Accommodation',
      room: (a as Accommodation & { room?: string }).room || '',
      check_in: (a as Accommodation & { check_in?: string }).check_in,
      check_out: (a as Accommodation & { check_out?: string }).check_out,
      actualToDate: prorateToDate(a.total_cost || 0, (a as Accommodation & { check_in?: string }).check_in, (a as Accommodation & { check_out?: string }).check_out),
    }))
  }
  function getInvoiced(id: string) {
    const inv = invoices.filter(i => (i as Invoice & { po_id?: string }).po_id === id)
    return { total: inv.reduce((s, i) => s + (i.amount || 0), 0), list: inv }
  }
  function getTotals(id: string) {
    const b = getBucket(id)
    const la = getLabAct(id).reduce((s, r) => s + (r.cost_labour || 0) + (r.cost_allowances || 0), 0)
    const ha = getHireAct(id).reduce((s, h) => s + h.actualToDate, 0)
    const ca = getCarAct(id).reduce((s, c) => s + c.actualToDate, 0)
    const aa = getAccomAct(id).reduce((s, a) => s + a.actualToDate, 0)
    return { actTotal: la+ha+ca+aa, planned: b?.total ?? 0, labAct: la, hireAct: ha, carAct: ca, accomAct: aa, budget: poValue(pos.find(p => p.id === id)!) }
  }

  function openDetail(po: PurchaseOrder) {
    setActivePO(po); setDetailTab('overview'); openEditForm(po); setEditOpen(false)
  }
  function openEditForm(po: PurchaseOrder) {
    const p = po as PurchaseOrder & { line_items?: PoLine[]; po_type?: string; effective_start?: string; effective_end?: string }
    setForm({ po_number: po.po_number||'', internal_ref: po.internal_ref||'', vendor: po.vendor||'', description: po.description||'', status: po.status||'draft', currency: po.currency||'AUD', po_type: p.po_type||'fixed', notes: po.notes||'', effective_start: p.effective_start||'', effective_end: p.effective_end||'', tce_item_id: po.tce_item_id||null, raised_date: po.raised_date||'', lines: p.line_items?.length ? p.line_items : [mkLine()] })
  }
  function openNew() { setForm({ ...EMPTY_FORM, lines: [mkLine()] }); setActivePO(null); setEditOpen(true) }
  const formValue = form.lines.reduce((s, l) => s + (l.value || 0), 0)

  async function save() {
    if (!form.vendor.trim()) { toast('Vendor required', 'error'); return }
    setSaving(true)
    const payload = { project_id: activeProject!.id, po_number: form.po_number, internal_ref: form.internal_ref, vendor: form.vendor.trim(), description: form.description, status: form.status, currency: form.currency, po_type: form.po_type, tce_item_id: form.tce_item_id||null, po_value: formValue||null, effective_start: form.effective_start||null, effective_end: form.effective_end||null, raised_date: form.raised_date||null, notes: form.notes, line_items: form.lines }
    const { error } = activePO ? await supabase.from('purchase_orders').update(payload).eq('id', activePO.id) : await supabase.from('purchase_orders').insert(payload)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(activePO ? 'PO saved' : 'PO created', 'success'); setSaving(false); setEditOpen(false); await load()
  }
  async function deletePO(po: PurchaseOrder) {
    if (!confirm(`Delete PO "${po.po_number || po.vendor}"?`)) return
    await supabase.from('purchase_orders').delete().eq('id', po.id)
    toast('Deleted', 'info'); setActivePO(null); load()
  }
  async function advanceStatus(po: PurchaseOrder) {
    const next = PO_NEXT[po.status]; if (!next) return
    if (next === 'raised' && !po.po_number) { toast('Enter a PO number first', 'error'); return }
    if (!confirm(`Advance "${po.vendor}" → ${PO_STATUS[next].label}?`)) return
    await supabase.from('purchase_orders').update({ status: next }).eq('id', po.id)
    toast(`Status → ${PO_STATUS[next].label}`, 'success'); load()
  }
  async function handleUpload(file: File) {
    if (!activePO || file.size > 10 * 1024 * 1024) { if (!activePO) return; toast('Max 10MB', 'error'); return }
    setUploadingId(activePO.id)
    const { path, error } = await uploadReceipt(activeProject!.id, activePO.id, file)
    if (error) { toast('Upload failed: ' + error, 'error'); setUploadingId(null); return }
    const newPaths = [...(activePO.receipt_paths || []), path]
    await supabase.from('purchase_orders').update({ receipt_paths: newPaths }).eq('id', activePO.id)
    setPos(prev => prev.map(p => p.id === activePO.id ? { ...p, receipt_paths: newPaths } : p))
    setActivePO(prev => prev ? { ...prev, receipt_paths: newPaths } : prev)
    toast('Attached', 'success'); setUploadingId(null)
  }
  async function removeReceipt(path: string) {
    if (!activePO || !confirm('Remove attachment?')) return
    await deleteReceipt(path)
    const newPaths = (activePO.receipt_paths || []).filter(p => p !== path)
    await supabase.from('purchase_orders').update({ receipt_paths: newPaths }).eq('id', activePO.id)
    setPos(prev => prev.map(p => p.id === activePO.id ? { ...p, receipt_paths: newPaths } : p))
    setActivePO(prev => prev ? { ...prev, receipt_paths: newPaths } : prev)
  }
  async function openReceipt(path: string) { const url = await getSignedUrl(path); if (url) window.open(url, '_blank') }

  function exportCSV() {
    const rows = [['PO Number','Vendor','Description','Status','Type','Budget','Invoiced','Currency','Start','End']]
    pos.forEach(p => { const { total } = getInvoiced(p.id); rows.push([p.po_number||'',p.vendor||'',p.description||'',p.status,(p as PurchaseOrder & { po_type?: string }).po_type||'',String(poValue(p)),String(total),p.currency||'AUD',(p as PurchaseOrder & { effective_start?: string }).effective_start||'',(p as PurchaseOrder & { effective_end?: string }).effective_end||'']) })
    downloadCSV(rows, `POs_${activeProject?.name}_${new Date().toISOString().slice(0,10)}`)
  }

  const vendors = [...new Set(pos.map(p => p.vendor).filter(Boolean))].sort()
  const filtered = pos.filter(p => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false
    if (filterVendor && p.vendor !== filterVendor) return false
    if (search) { const lines = (p as PurchaseOrder & { line_items?: PoLine[] }).line_items || []; const hay = [p.po_number,p.internal_ref,p.vendor,p.description,...lines.map(l=>l.wbs+' '+l.description)].join(' ').toLowerCase(); if (!hay.includes(search.toLowerCase())) return false }
    return true
  })

  const TH = { padding:'7px 10px', fontSize:'10px', fontWeight:600 as const, textTransform:'uppercase' as const, letterSpacing:'0.06em', color:'var(--text3)', borderBottom:'1px solid var(--border)', background:'var(--bg2)', whiteSpace:'nowrap' as const }
  const TD = { padding:'9px 10px', fontSize:'12px', borderBottom:'1px solid var(--border)' }
  const TDR = { padding:'9px 10px', fontSize:'12px', textAlign:'right' as const, fontFamily:'var(--mono)', borderBottom:'1px solid var(--border)' }
  const SH = { fontSize:'10px', color:'var(--text3)', fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'0.05em', marginBottom:'3px' }

  if (loading) return <div className="loading-center"><span className="spinner"/> Loading…</div>

  // ── DETAIL VIEW ─────────────────────────────────────────────────────────────
  if (activePO) {
    const po = activePO
    const bucket = getBucket(po.id)
    const budget = poValue(po)
    const labActuals = getLabAct(po.id)
    const hireActuals = getHireAct(po.id)
    const carActuals = getCarAct(po.id)
    const accomActuals = getAccomAct(po.id)
    const labActTotal = labActuals.reduce((s,r)=>s+(r.cost_labour||0)+(r.cost_allowances||0),0)
    const hireActTotal = hireActuals.reduce((s,h)=>s+h.actualToDate,0)
    const carActTotal = carActuals.reduce((s,c)=>s+c.actualToDate,0)
    const accomActTotal = accomActuals.reduce((s,a)=>s+a.actualToDate,0)
    const totalActuals = labActTotal+hireActTotal+carActTotal+accomActTotal
    const planned = bucket?.total ?? 0
    const { total: invoiced, list: poInvoices } = getInvoiced(po.id)
    const varianceToDate = budget - totalActuals
    const forecastVariance = budget - planned
    const sm = PO_STATUS[po.status] || PO_STATUS.draft
    const linkedResources = resources.filter(r => (r as Resource & { linked_po_id?: string }).linked_po_id === po.id)
    const byPerson: Record<string,{hours:number;cost:number}> = {}
    for (const r of labActuals) {
      if (!byPerson[r.person_name]) byPerson[r.person_name] = { hours:0, cost:0 }
      byPerson[r.person_name].hours += r.allocated_hours||0
      byPerson[r.person_name].cost += (r.cost_labour||0)+(r.cost_allowances||0)
    }

    return (
      <div style={{display:'flex',height:'100%',overflow:'hidden'}}>
        {/* Left sidebar */}
        <div style={{width:'260px',flexShrink:0,borderRight:'1px solid var(--border)',overflowY:'auto',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'10px 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'8px',background:'var(--bg2)',flexShrink:0}}>
            <button className="btn btn-sm" onClick={()=>setActivePO(null)}>← Back</button>
            <span style={{fontSize:'11px',fontWeight:600,color:'var(--text2)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{po.po_number||po.vendor}</span>
            <span style={{padding:'1px 6px',borderRadius:'10px',fontSize:'10px',fontWeight:600,background:sm.bg,color:sm.color}}>{sm.label}</span>
          </div>
          <div style={{padding:'12px',flex:1,overflowY:'auto'}}>
            <div style={{marginBottom:'12px'}}>
              <div style={{...SH,marginBottom:'6px'}}>Status</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
                {Object.entries(PO_STATUS).map(([k,v])=>(
                  <span key={k} onClick={()=>setForm(f=>({...f,status:k}))} style={{padding:'3px 8px',borderRadius:'10px',fontSize:'10px',fontWeight:600,cursor:'pointer',background:form.status===k?v.bg:'transparent',color:form.status===k?v.color:'var(--text3)',border:`1px solid ${form.status===k?v.color:'var(--border)'}`}}>{v.label}</span>
                ))}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              {[['SAP PO Number','po_number','4500123456'],['Internal Ref','internal_ref','SSOP-00176'],['Vendor *','vendor','Vendor name'],['Description','description','Scope / description']].map(([lbl,key,ph])=>(
                <div key={key}><div style={SH}>{lbl}</div>
                  <input className="input" style={{width:'100%',fontSize:'12px'}} value={(form as unknown as Record<string,string>)[key]||''} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph}/>
                </div>
              ))}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                <div><div style={SH}>Type</div>
                  <select className="input" style={{width:'100%',fontSize:'12px'}} value={form.po_type} onChange={e=>setForm(f=>({...f,po_type:e.target.value}))}>
                    {Object.entries(PO_TYPE).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><div style={SH}>Currency</div>
                  <select className="input" style={{width:'100%',fontSize:'12px'}} value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                <div><div style={SH}>Start</div><input type="date" className="input" style={{width:'100%',fontSize:'12px'}} value={form.effective_start} onChange={e=>setForm(f=>({...f,effective_start:e.target.value}))}/></div>
                <div><div style={SH}>End</div><input type="date" className="input" style={{width:'100%',fontSize:'12px'}} value={form.effective_end} onChange={e=>setForm(f=>({...f,effective_end:e.target.value}))}/></div>
              </div>
              <div><div style={SH}>Raised Date</div><input type="date" className="input" style={{width:'100%',fontSize:'12px'}} value={form.raised_date} onChange={e=>setForm(f=>({...f,raised_date:e.target.value}))}/></div>
            </div>
            {/* Line items */}
            <div style={{marginTop:'12px'}}>
              <div style={{...SH,display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                Line Items <button className="btn btn-sm" style={{fontSize:'10px',padding:'1px 6px'}} onClick={()=>setForm(f=>({...f,lines:[...f.lines,mkLine()]}))}>+ Add</button>
              </div>
              {form.lines.map((line,i)=>(
                <div key={line.id} style={{borderBottom:'1px solid var(--border)',paddingBottom:'8px',marginBottom:'8px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'4px',marginBottom:'4px'}}>
                    <input className="input" style={{fontSize:'11px'}} value={line.description} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,description:e.target.value}:l)}))} placeholder="Description"/>
                    <button className="btn btn-sm" style={{color:'var(--red)',padding:'2px 5px'}} onClick={()=>setForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))}>✕</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px'}}>
                    <select className="input" style={{fontSize:'11px'}} value={line.wbs} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,wbs:e.target.value}:l)}))}>
                      <option value="">— WBS —</option>{wbsList.map(w=><option key={w.id} value={w.code}>{w.code}</option>)}
                    </select>
                    <input type="number" className="input" style={{fontSize:'11px'}} value={line.value||''} min={0} placeholder="Value" onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,value:parseFloat(e.target.value)||0}:l)}))}/>
                  </div>
                </div>
              ))}
              {formValue>0&&<div style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:700,color:'#1e40af'}}>Total: {fmt(formValue,form.currency)}</div>}
            </div>
            <div style={{marginTop:'8px'}}><div style={SH}>Notes</div>
              <textarea className="input" rows={2} style={{width:'100%',fontSize:'12px',resize:'vertical'}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
            </div>
            {/* Attachments */}
            <div style={{marginTop:'12px'}}>
              <div style={{...SH,marginBottom:'6px'}}>Attachments</div>
              {(activePO.receipt_paths||[]).map(path=>(
                <div key={path} style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px',padding:'4px 6px',background:'var(--bg2)',borderRadius:'4px'}}>
                  <span style={{fontSize:'14px'}}>{fileIcon(path)}</span>
                  <span style={{flex:1,fontSize:'11px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text2)',cursor:'pointer'}} onClick={()=>openReceipt(path)}>{fileName(path)}</span>
                  <button className="btn btn-sm" style={{color:'var(--red)',padding:'1px 4px',fontSize:'10px'}} onClick={()=>removeReceipt(path)}>✕</button>
                </div>
              ))}
              <label style={{display:'block',border:'1px dashed var(--border)',borderRadius:'6px',padding:'8px',textAlign:'center',fontSize:'11px',color:'var(--text3)',cursor:'pointer',background:dragOver?'var(--bg2)':undefined}}
                onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)}
                onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f)handleUpload(f)}}>
                {uploadingId?<span className="spinner" style={{width:'12px',height:'12px'}}/>:'+ Drop or click to attach'}
                <input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)handleUpload(f)}}/>
              </label>
            </div>
          </div>
          <div style={{padding:'10px 12px',borderTop:'1px solid var(--border)',display:'flex',gap:'6px',flexShrink:0}}>
            <button className="btn btn-sm" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>deletePO(po)}>Delete</button>
            {PO_NEXT[po.status]&&<button className="btn btn-sm" style={{fontSize:'11px'}} onClick={()=>advanceStatus(po)}>→ {PO_STATUS[PO_NEXT[po.status]]?.label}</button>}
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving} style={{fontSize:'11px'}}>{saving?<span className="spinner" style={{width:'12px',height:'12px'}}/>:'Save'}</button>
          </div>
        </div>

        {/* Centre panel */}
        <div style={{flex:1,minWidth:0,overflowY:'auto',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
            <div style={{fontSize:'14px',fontWeight:700}}>{po.po_number?`${po.po_number} — `:''}{po.vendor||'—'}</div>
            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'1px'}}>{po.description||''}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',padding:'12px 16px 0'}}>
            {[
              {label:'Budget (PO value)',value:fmt(budget),color:'var(--text)'},
              {label:'Planned cost',value:fmt(planned),color:'var(--text2)'},
              {label:'Actuals to date',value:fmt(totalActuals),color:totalActuals>budget?'var(--red)':'var(--green)'},
              {label:'Invoiced to date',value:fmt(invoiced),color:'var(--text2)'},
              {label:'Variance to date',value:(varianceToDate>=0?'+':'')+fmt(varianceToDate),color:varianceToDate<0?'var(--red)':'var(--green)'},
              {label:'Forecast variance',value:(forecastVariance>=0?'+':'')+fmt(forecastVariance),color:forecastVariance<0?'var(--red)':'var(--text2)'},
            ].map(k=>(
              <div key={k.label} className="card" style={{padding:'10px 12px'}}>
                <div style={{fontSize:'10px',color:'var(--text3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'3px'}}>{k.label}</div>
                <div style={{fontSize:'15px',fontWeight:700,fontFamily:'var(--mono)',color:k.color}}>{k.value}</div>
              </div>
            ))}
          </div>
          {budget>0&&(
            <div style={{padding:'8px 16px 0'}}>
              <div style={{height:'6px',background:'var(--border)',borderRadius:'3px',overflow:'hidden',position:'relative'}}>
                <div style={{position:'absolute',left:0,top:0,height:'100%',width:pctOf(planned,budget)+'%',background:'var(--border2)',borderRadius:'3px'}}/>
                <div style={{position:'absolute',left:0,top:0,height:'100%',width:pctOf(totalActuals,budget)+'%',background:totalActuals>budget?'var(--red)':'var(--accent)',borderRadius:'3px'}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'var(--text3)',marginTop:'3px'}}>
                <span>Actuals {pctOf(totalActuals,budget)}% of budget</span>
                <span>Invoiced {pctOf(invoiced,budget)}% · Planned {pctOf(planned,budget)}%</span>
              </div>
            </div>
          )}
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginTop:'12px',paddingLeft:'16px',flexShrink:0}}>
            {(['overview','labour','equipment','invoices'] as DetailTab[]).map(t=>(
              <button key={t} onClick={()=>setDetailTab(t)} style={{padding:'6px 14px',fontSize:'12px',fontWeight:detailTab===t?600:400,border:'none',background:'none',borderBottom:detailTab===t?'2px solid var(--accent)':'2px solid transparent',color:detailTab===t?'var(--accent)':'var(--text2)',cursor:'pointer',marginBottom:'-1px',textTransform:'capitalize'}}>{t}</button>
            ))}
          </div>
          <div style={{padding:'12px 16px',flex:1}}>
            {detailTab==='overview'&&(
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                  <thead><tr>
                    <th style={{...TH,textAlign:'left'}}>Category</th>
                    <th style={{...TH,textAlign:'right'}}>Planned</th>
                    <th style={{...TH,textAlign:'right'}}>Actuals to date</th>
                    <th style={{...TH,textAlign:'right'}}>Variance</th>
                  </tr></thead>
                  <tbody>
                    {[
                      {label:'👷 Labour',planned:bucket?.labour.cost??0,actual:labActTotal},
                      {label:'🚜 Dry Hire',planned:bucket?.dryHire.cost??0,actual:hireActuals.filter(h=>h.hire_type==='dry').reduce((s,h)=>s+h.actualToDate,0)},
                      {label:'🏗️ Wet Hire',planned:bucket?.wetHire.cost??0,actual:hireActuals.filter(h=>h.hire_type==='wet').reduce((s,h)=>s+h.actualToDate,0)},
                      {label:'🧰 Local Hire',planned:bucket?.localHire.cost??0,actual:hireActuals.filter(h=>h.hire_type==='local').reduce((s,h)=>s+h.actualToDate,0)},
                      {label:'🚗 Cars',planned:bucket?.cars.cost??0,actual:carActTotal},
                      {label:'🏠 Accommodation',planned:bucket?.accom.cost??0,actual:accomActTotal},
                    ].filter(r=>r.planned>0||r.actual>0).map(row=>{
                      const v=row.planned-row.actual
                      return <tr key={row.label} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={TD}>{row.label}</td>
                        <td style={TDR}>{fmt(row.planned)}</td>
                        <td style={TDR}>{fmt(row.actual)}</td>
                        <td style={{...TDR,color:v<0?'var(--red)':'var(--green)',fontWeight:600}}>{v>=0?'+':''}{fmt(v)}</td>
                      </tr>
                    })}
                    <tr style={{background:'var(--bg2)',fontWeight:700}}>
                      <td style={TD}>Total</td><td style={TDR}>{fmt(planned)}</td><td style={TDR}>{fmt(totalActuals)}</td>
                      <td style={{...TDR,color:varianceToDate<0?'var(--red)':'var(--green)'}}>{varianceToDate>=0?'+':''}{fmt(varianceToDate)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {detailTab==='labour'&&(
              <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                <div className="card" style={{padding:0,overflow:'hidden'}}>
                  <div style={{padding:'8px 12px',background:'var(--bg2)',fontSize:'11px',fontWeight:600,borderBottom:'1px solid var(--border)'}}>Linked resources ({linkedResources.length})</div>
                  {linkedResources.length===0?(
                    <div style={{padding:'16px',fontSize:'12px',color:'var(--text3)',textAlign:'center'}}>No resources linked — assign via Personnel → Resources</div>
                  ):(
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead><tr>{['Name','Role','Mob In','Mob Out','Planned','Actual','Hours'].map(h=><th key={h} style={{...TH,textAlign:['Planned','Actual','Hours'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                      <tbody>{linkedResources.map(r=>{
                        const pb=bucket?.labour.people.find(p=>p.resourceId===r.id)
                        const pa=byPerson[r.name]
                        return <tr key={r.id} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={{...TD,fontWeight:600}}>{r.name}</td><td style={TD}>{r.role}</td>
                          <td style={TD}>{fmtDate((r as Resource & {mob_in?:string}).mob_in)}</td>
                          <td style={TD}>{fmtDate((r as Resource & {mob_out?:string}).mob_out)}</td>
                          <td style={TDR}>{fmt(pb?.totalCost??0)}</td>
                          <td style={TDR}>{pa?fmt(pa.cost):'—'}</td>
                          <td style={TDR}>{pa?pa.hours.toFixed(2)+'h':'—'}</td>
                        </tr>
                      })}</tbody>
                    </table>
                  )}
                </div>
                {labActuals.length>0&&(
                  <div className="card" style={{padding:0,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'var(--bg2)',fontSize:'11px',fontWeight:600,borderBottom:'1px solid var(--border)'}}>Timesheet actuals (approved)</div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead><tr>{['Date','Person','Role','Hours','Labour','Allowances','Total'].map(h=><th key={h} style={{...TH,textAlign:['Hours','Labour','Allowances','Total'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {labActuals.sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.person_name.localeCompare(b.person_name)).map((r,i)=>(
                          <tr key={i} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={{...TD,fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{new Date(r.work_date+'T12:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short'})}</td>
                            <td style={TD}>{r.person_name}</td><td style={{...TD,color:'var(--text3)'}}>{r.role}</td>
                            <td style={TDR}>{(r.allocated_hours||0).toFixed(2)}h</td>
                            <td style={TDR}>{fmtFull(r.cost_labour||0)}</td>
                            <td style={TDR}>{r.cost_allowances>0?fmtFull(r.cost_allowances):'—'}</td>
                            <td style={{...TDR,fontWeight:600}}>{fmtFull((r.cost_labour||0)+(r.cost_allowances||0))}</td>
                          </tr>
                        ))}
                        <tr style={{background:'var(--bg2)',fontWeight:700}}>
                          <td colSpan={3} style={TD}>Total</td>
                          <td style={TDR}>{labActuals.reduce((s,r)=>s+(r.allocated_hours||0),0).toFixed(2)}h</td>
                          <td style={TDR}>{fmtFull(labActuals.reduce((s,r)=>s+(r.cost_labour||0),0))}</td>
                          <td style={TDR}>{fmtFull(labActuals.reduce((s,r)=>s+(r.cost_allowances||0),0))}</td>
                          <td style={TDR}>{fmtFull(labActTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {detailTab==='equipment'&&(
              <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                {hireActuals.length===0&&carActuals.length===0&&accomActuals.length===0?(
                  <div style={{padding:'24px',textAlign:'center',color:'var(--text3)',fontSize:'12px'}}>No hire, cars, or accommodation linked to this PO.</div>
                ):(
                  <>
                    {hireActuals.length>0&&(
                      <div className="card" style={{padding:0,overflow:'hidden'}}>
                        <div style={{padding:'8px 12px',background:'var(--bg2)',fontSize:'11px',fontWeight:600,borderBottom:'1px solid var(--border)'}}>Hire items</div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                          <thead><tr>{['Item','Type','Start','End','Contract','Actual to date'].map(h=><th key={h} style={{...TH,textAlign:['Contract','Actual to date'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                          <tbody>{hireActuals.map(h=>(
                            <tr key={h.id} style={{borderBottom:'1px solid var(--border)'}}>
                              <td style={TD}>{h.name}</td>
                              <td style={TD}><span style={{fontSize:'10px',padding:'1px 5px',borderRadius:'3px',background:'var(--bg2)'}}>{h.hire_type}</span></td>
                              <td style={TD}>{fmtDate(h.start_date)}</td><td style={TD}>{fmtDate(h.end_date)}</td>
                              <td style={TDR}>{fmtFull(h.hire_cost||0)}</td>
                              <td style={{...TDR,color:'var(--mod-hr)'}}>{fmtFull(h.actualToDate)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    {carActuals.length>0&&(
                      <div className="card" style={{padding:0,overflow:'hidden'}}>
                        <div style={{padding:'8px 12px',background:'var(--bg2)',fontSize:'11px',fontWeight:600,borderBottom:'1px solid var(--border)'}}>Cars</div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                          <thead><tr>{['Description','Start','End','Contract','Actual to date'].map(h=><th key={h} style={{...TH,textAlign:['Contract','Actual to date'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                          <tbody>{carActuals.map(c=>(
                            <tr key={c.id} style={{borderBottom:'1px solid var(--border)'}}>
                              <td style={TD}>{c.label}</td><td style={TD}>{fmtDate(c.start_date)}</td><td style={TD}>{fmtDate(c.end_date)}</td>
                              <td style={TDR}>{fmtFull(c.total_cost||0)}</td>
                              <td style={{...TDR,color:'var(--mod-hr)'}}>{fmtFull(c.actualToDate)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    {accomActuals.length>0&&(
                      <div className="card" style={{padding:0,overflow:'hidden'}}>
                        <div style={{padding:'8px 12px',background:'var(--bg2)',fontSize:'11px',fontWeight:600,borderBottom:'1px solid var(--border)'}}>Accommodation</div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                          <thead><tr>{['Property','Room','Check in','Check out','Contract','Actual to date'].map(h=><th key={h} style={{...TH,textAlign:['Contract','Actual to date'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                          <tbody>{accomActuals.map(a=>(
                            <tr key={a.id} style={{borderBottom:'1px solid var(--border)'}}>
                              <td style={TD}>{a.property}</td><td style={TD}>{a.room}</td>
                              <td style={TD}>{fmtDate(a.check_in)}</td><td style={TD}>{fmtDate(a.check_out)}</td>
                              <td style={TDR}>{fmtFull(a.total_cost||0)}</td>
                              <td style={{...TDR,color:'var(--mod-hr)'}}>{fmtFull(a.actualToDate)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {detailTab==='invoices'&&(
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                {poInvoices.length===0?(
                  <div style={{padding:'24px',textAlign:'center',color:'var(--text3)',fontSize:'12px'}}>No invoices linked. Link via Cost Tracking → Invoices.</div>
                ):(
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                    <thead><tr>{['Reference','Date','Amount','Status','% of budget'].map(h=><th key={h} style={{...TH,textAlign:['Amount','% of budget'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {poInvoices.map((inv,i)=>{
                        const ia=inv as Invoice & {invoice_ref?:string;invoice_date?:string}
                        return <tr key={inv.id} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={TD}>{ia.invoice_ref||`Invoice ${i+1}`}</td>
                          <td style={TD}>{fmtDate(ia.invoice_date)}</td>
                          <td style={TDR}>{fmtFull(inv.amount||0)}</td>
                          <td style={TD}><span style={{fontSize:'10px',padding:'2px 6px',borderRadius:'10px',background:inv.status==='approved'?'#d1fae5':inv.status==='paid'?'#dbeafe':'#fef3c7',color:inv.status==='approved'?'#065f46':inv.status==='paid'?'#1e40af':'#92400e',fontWeight:600}}>{inv.status}</span></td>
                          <td style={TDR}>{budget>0?((inv.amount||0)/budget*100).toFixed(1)+'%':'—'}</td>
                        </tr>
                      })}
                      <tr style={{background:'var(--bg2)',fontWeight:700}}>
                        <td colSpan={2} style={TD}>Total invoiced</td>
                        <td style={TDR}>{fmtFull(invoiced)}</td><td style={TD}/>
                        <td style={TDR}>{budget>0?(invoiced/budget*100).toFixed(1)+'%':'—'}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div style={{width:'200px',flexShrink:0,borderLeft:'1px solid var(--border)',overflowY:'auto'}}>
          <div style={{padding:'8px 10px',fontSize:'10px',fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:'1px solid var(--border)',background:'var(--bg2)'}}>All POs ({pos.length})</div>
          {STATUS_ORDER.filter(s=>pos.some(p=>p.status===s)).map(s=>(
            <div key={s}>
              <div style={{padding:'4px 10px',fontSize:'10px',fontWeight:600,color:PO_STATUS[s].color,background:PO_STATUS[s].bg,borderBottom:'1px solid var(--border)'}}>{PO_STATUS[s].label}</div>
              {pos.filter(p=>p.status===s).map(p=>(
                <div key={p.id} onClick={()=>{setActivePO(p);openEditForm(p);setDetailTab('overview')}}
                  style={{padding:'7px 10px',borderBottom:'1px solid var(--border)',cursor:'pointer',background:p.id===po.id?'var(--bg2)':undefined,borderLeft:p.id===po.id?'3px solid var(--accent)':'3px solid transparent'}}>
                  <div style={{fontSize:'11px',fontWeight:600,fontFamily:'var(--mono)',color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.po_number||'—'}</div>
                  <div style={{fontSize:'11px',color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.vendor}</div>
                  <div style={{fontSize:'10px',fontFamily:'var(--mono)',color:'var(--text3)',marginTop:'1px'}}>{fmt(poValue(p))}</div>
                </div>
              ))}
            </div>
          ))}
          <div style={{padding:'8px 10px'}}><button className="btn btn-sm" style={{width:'100%',fontSize:'11px'}} onClick={openNew}>+ New PO</button></div>
        </div>
      </div>
    )
  }

  // ── NEW PO FORM ──────────────────────────────────────────────────────────────
  if (editOpen) {
    return (
      <div style={{padding:'24px',maxWidth:'640px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'20px'}}>
          <button className="btn btn-sm" onClick={()=>setEditOpen(false)}>← Back</button>
          <h2 style={{fontSize:'16px',fontWeight:700}}>New Purchase Order</h2>
        </div>
        <div className="card" style={{padding:'20px'}}>
          <div className="fg-row">
            <div className="fg" style={{flex:2}}><label>SAP PO Number</label><input className="input" value={form.po_number} onChange={e=>setForm(f=>({...f,po_number:e.target.value}))} placeholder="4500123456" autoFocus/></div>
            <div className="fg"><label>Internal Ref</label><input className="input" value={form.internal_ref} onChange={e=>setForm(f=>({...f,internal_ref:e.target.value}))} placeholder="SSOP-00176"/></div>
          </div>
          <div className="fg-row">
            <div className="fg" style={{flex:2}}><label>Vendor *</label><input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} placeholder="Vendor name"/></div>
            <div className="fg"><label>Status</label><select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{Object.entries(PO_STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
          </div>
          <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Scope / description"/></div>
          <div className="fg-row">
            <div className="fg"><label>Type</label><select className="input" value={form.po_type} onChange={e=>setForm(f=>({...f,po_type:e.target.value}))}>{Object.entries(PO_TYPE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
            <div className="fg"><label>Currency</label><select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
            <div className="fg"><label>Raised Date</label><input type="date" className="input" value={form.raised_date} onChange={e=>setForm(f=>({...f,raised_date:e.target.value}))}/></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Effective Start</label><input type="date" className="input" value={form.effective_start} onChange={e=>setForm(f=>({...f,effective_start:e.target.value}))}/></div>
            <div className="fg"><label>Effective End</label><input type="date" className="input" value={form.effective_end} onChange={e=>setForm(f=>({...f,effective_end:e.target.value}))}/></div>
          </div>
          <div style={{marginTop:'12px'}}>
            <div style={{fontWeight:600,fontSize:'13px',marginBottom:'8px',display:'flex',justifyContent:'space-between'}}>
              Line Items <button className="btn btn-sm" onClick={()=>setForm(f=>({...f,lines:[...f.lines,mkLine()]}))}>+ Add Line</button>
            </div>
            {form.lines.map((line,i)=>(
              <div key={line.id} style={{display:'grid',gridTemplateColumns:tceLines.length>0?'1fr 100px 140px 120px 32px':'1fr 100px 120px 32px',gap:'6px',marginBottom:'6px',alignItems:'flex-end'}}>
                <div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>Description</label>}
                  <input className="input" value={line.description} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,description:e.target.value}:l)}))} placeholder="Description"/></div>
                <div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>WBS</label>}
                  <select className="input" value={line.wbs} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,wbs:e.target.value}:l)}))}>
                    <option value="">— WBS —</option>{wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}</select></div>
                {tceLines.length>0&&<div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>TCE Item</label>}
                  <select className="input" value={line.tce_item_id||''} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,tce_item_id:e.target.value}:l)}))}>
                    <option value="">— No TCE —</option>
                    {(['overhead','skilled'] as const).map(src=>{const sl=tceLines.filter(l=>l.source===src&&l.line_type!=='group');if(!sl.length)return null;return <optgroup key={src} label={src==='overhead'?'Overhead':'Skilled'}>{sl.map(l=><option key={l.item_id} value={l.item_id||''}>{l.item_id} — {l.description}</option>)}</optgroup>})}
                  </select></div>}
                <div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>Value</label>}
                  <input type="number" className="input" value={line.value||''} min={0} placeholder="0.00" onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,value:parseFloat(e.target.value)||0}:l)}))}/></div>
                <button className="btn btn-sm" style={{color:'var(--red)',padding:'4px 6px'}} onClick={()=>setForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))}>✕</button>
              </div>
            ))}
            {formValue>0&&<div style={{textAlign:'right',fontWeight:700,fontFamily:'var(--mono)',fontSize:'13px',color:'#1e40af'}}>Total: {fmt(formValue,form.currency)}</div>}
          </div>
          <div className="fg" style={{marginTop:'8px'}}><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}}/></div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'16px'}}>
            <button className="btn" onClick={()=>setEditOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save PO</button>
          </div>
        </div>
      </div>
    )
  }

  // ── LIST VIEW ───────────────────────────────────────────────────────────────
  const committedAUD = pos.filter(p=>p.status==='raised'||p.status==='active').reduce((s,p)=>s+poValue(p),0)
  const totalInvoicedAUD = invoices.filter(i=>i.status!=='disputed').reduce((s,i)=>s+(i.amount||0),0)

  return (
    <div style={{padding:'20px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'16px'}}>
        {[
          {label:'Active POs',value:String(pos.filter(p=>p.status==='active'||p.status==='raised').length),color:'var(--accent)'},
          {label:'Committed (AUD)',value:fmt(committedAUD),color:'#1e40af'},
          {label:'Total invoiced',value:fmt(totalInvoicedAUD),color:'#059669'},
          {label:'Draft / quoted',value:String(pos.filter(p=>p.status==='draft'||p.status==='quoted').length),color:'#d97706'},
        ].map(k=>(
          <div key={k.label} className="card" style={{padding:'12px 14px',borderTop:`3px solid ${k.color}`}}>
            <div style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'18px',color:k.color}}>{k.value}</div>
            <div style={{fontSize:'10px',color:'var(--text3)',marginTop:'2px',textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px',flexWrap:'wrap'}}>
        <div style={{position:'relative',flex:'0 0 220px'}}>
          <span style={{position:'absolute',left:'7px',top:'50%',transform:'translateY(-50%)',fontSize:'13px',color:'var(--text3)',pointerEvents:'none'}}>⌕</span>
          <input className="input" style={{paddingLeft:'24px',height:'28px',fontSize:'12px',width:'100%'}} placeholder="PO, vendor, description…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="input" style={{height:'28px',fontSize:'12px',width:'auto'}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>{Object.entries(PO_STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input" style={{height:'28px',fontSize:'12px',width:'auto'}} value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}>
          <option value="">All vendors</option>{vendors.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <div style={{flex:1}}/>
        <button className="btn btn-sm" onClick={exportCSV} style={{height:'28px',padding:'0 10px'}}>↓ CSV</button>
        <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('cost_tracking')} style={{height:'28px',padding:'0 12px',fontSize:'12px'}}>+ New PO</button>
      </div>
      {filtered.length===0?(
        <div className="card" style={{padding:'48px',textAlign:'center'}}>
          <div style={{fontSize:'32px',marginBottom:'12px'}}>💼</div>
          <div style={{fontSize:'15px',fontWeight:600,marginBottom:'4px'}}>No purchase orders</div>
          <div style={{fontSize:'12px',color:'var(--text3)',marginBottom:'16px'}}>{search||filterStatus!=='all'?'No matches.':'Create your first PO to start tracking committed costs.'}</div>
          <button className="btn btn-primary" onClick={openNew}>+ New PO</button>
        </div>
      ):(
        <div className="card" style={{padding:0,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px',tableLayout:'fixed'}}>
            <colgroup><col style={{width:'110px'}}/><col style={{width:'130px'}}/><col/><col style={{width:'70px'}}/><col style={{width:'80px'}}/><col style={{width:'80px'}}/><col style={{width:'80px'}}/><col style={{width:'80px'}}/><col style={{width:'90px'}}/><col style={{width:'70px'}}/></colgroup>
            <thead><tr>{['PO number','Vendor','Description','Status','Budget','Planned','Actuals','Invoiced','Variance',''].map(h=>(
              <th key={h} style={{...TH,textAlign:['Budget','Planned','Actuals','Invoiced','Variance'].includes(h)?'right':'left'}}>{h}</th>
            ))}</tr></thead>
            <tbody>{filtered.map(po=>{
              const {actTotal,planned,budget}=getTotals(po.id)
              const {total:invoiced}=getInvoiced(po.id)
              const variance=budget-actTotal
              const meta=PO_STATUS[po.status]||PO_STATUS.draft
              return <tr key={po.id} style={{borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>openDetail(po)}>
                <td style={{...TD,fontFamily:'var(--mono)',fontSize:'11px',fontWeight:600}}>{po.po_number||'—'}</td>
                <td style={{...TD,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{po.vendor||'—'}</td>
                <td style={{...TD,color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{po.description||'—'}</td>
                <td style={TD}><span style={{padding:'2px 7px',borderRadius:'10px',fontSize:'10px',fontWeight:600,background:meta.bg,color:meta.color}}>{meta.label}</span></td>
                <td style={TDR}>{fmt(budget)}</td>
                <td style={{...TDR,color:'var(--text3)'}}>{planned>0?fmt(planned):'—'}</td>
                <td style={TDR}>{actTotal>0?fmt(actTotal):'—'}</td>
                <td style={{...TDR,color:'var(--text3)'}}>{invoiced>0?fmt(invoiced):'—'}</td>
                <td style={{...TDR,fontWeight:600,color:variance<0?'var(--red)':'var(--green)'}}>{budget>0?(variance>=0?'+':'')+fmt(variance):'—'}</td>
                <td style={{...TD,textAlign:'right'}}><button className="btn btn-sm" style={{fontSize:'10px'}} onClick={e=>{e.stopPropagation();openDetail(po)}}>Open →</button></td>
              </tr>
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
