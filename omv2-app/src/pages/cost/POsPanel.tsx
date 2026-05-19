import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { uploadReceipt, deleteReceipt, getSignedUrl, fileIcon, fileName } from '../../lib/receiptStorage'
import { buildForecast, weekKey, weekLabel } from '../../engines/forecastEngine'
import { HelpButton } from '../../components/HelpButton'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
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
type PoForm = { po_number: string; internal_ref: string; vendor: string; description: string; status: string; currency: string; po_type: string; notes: string; effective_start: string; effective_end: string; raised_date: string; forecast_start: string; forecast_end: string; tce_item_id: string | null; lines: PoLine[] }
const EMPTY_FORM: PoForm = { po_number: '', internal_ref: '', vendor: '', description: '', status: 'draft', currency: 'AUD', po_type: 'fixed', notes: '', effective_start: '', effective_end: '', forecast_start: '', forecast_end: '', tce_item_id: null, raised_date: '', lines: [mkLine()] }
type DetailTab = 'overview' | 'labour' | 'equipment' | 'invoices' | 'eac' | 'fc-vs-act'
interface ActualsRow { person_name: string; role: string; work_date: string; week_start: string; allocated_hours: number; cost_labour: number; cost_allowances: number; po_id?: string }

export function POsPanel() {
  const { activeProject, activePOManagerId, setActivePOManagerId } = useAppStore()
  const isTce = activeProject?.cost_method === 'nrg_tce'
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
    // Cutoff = latest posted timesheet date. Forecast picks up from the day after.
    // Avoids double-counting when timesheets are posted ahead of today (whole-week posting).
    const actualsCutoff = actuals.length ? actuals.reduce((max, a) => a.work_date > max ? a.work_date : max, '') || null : null
    return buildForecast(resources, rateCards, [], hireItems, cars, accom, [], stdHours, holidays, ps?.start_date || null, ps?.end_date || null, [], [], 0, [], [], [], [], [], [], actualsCutoff)
  }, [resources, rateCards, hireItems, cars, accom, holidays, activeProject, actuals])

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
    const bgt = poValue(pos.find(p => p.id === id)!)
    // Fixed price POs with no linked bookings: PO value IS the plan
    const hasBookings = la > 0 || ha > 0 || ca > 0 || aa > 0
      || resources.some(r => (r as Resource & { linked_po_id?: string }).linked_po_id === id)
    const planned = (b?.total ?? 0) === 0 && !hasBookings && bgt > 0 ? bgt : (b?.total ?? 0)
    // ACTUALS = approved timesheet labour only (matches MIKA/accounting).
    // Equipment proration is COMMITTED — moves to actuals only when an invoice posts.
    return { actTotal: la, equipCommitted: ha+ca+aa, planned, labAct: la, hireAct: ha, carAct: ca, accomAct: aa, budget: bgt }
  }

  function openDetail(po: PurchaseOrder) {
    setActivePO(po); setDetailTab('overview'); openEditForm(po); setEditOpen(false)
  }
  function openEditForm(po: PurchaseOrder) {
    const p = po as PurchaseOrder & { line_items?: PoLine[]; po_type?: string; effective_start?: string; effective_end?: string }
    setForm({ po_number: po.po_number||'', internal_ref: po.internal_ref||'', vendor: po.vendor||'', description: po.description||'', status: po.status||'draft', currency: po.currency||'AUD', po_type: p.po_type||'fixed', notes: po.notes||'', effective_start: p.effective_start||'', effective_end: p.effective_end||'', forecast_start: po.forecast_start||'', forecast_end: po.forecast_end||'', tce_item_id: po.tce_item_id||null, raised_date: po.raised_date||'', lines: p.line_items?.length ? p.line_items : [mkLine()] })
  }
  function openNew() { setForm({ ...EMPTY_FORM, lines: [mkLine()] }); setActivePO(null); setEditOpen(true) }
  const formValue = form.lines.reduce((s, l) => s + (l.value || 0), 0)

  async function save() {
    if (!form.vendor.trim()) { toast('Vendor required', 'error'); return }
    setSaving(true)
    const payload = { project_id: activeProject!.id, po_number: form.po_number, internal_ref: form.internal_ref, vendor: form.vendor.trim(), description: form.description, status: form.status, currency: form.currency, po_type: form.po_type, tce_item_id: form.tce_item_id||null, po_value: formValue||null, effective_start: form.effective_start||null, effective_end: form.effective_end||null, raised_date: form.raised_date||null, forecast_start: form.forecast_start||null, forecast_end: form.forecast_end||null, notes: form.notes, line_items: form.lines }
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
    // ACTUALS = approved timesheet labour only. Equipment is committed (will move
    // to actuals when invoiced). This matches MIKA's wbsAggregator and accounting.
    const totalActuals = labActTotal
    const equipCommittedToDate = hireActTotal+carActTotal+accomActTotal
    const planned = (() => {
      // For fixed price POs with no linked resources or bookings, the PO value IS the plan
      if ((bucket?.total ?? 0) === 0) {
        const hasLinkedBookings = labActuals.length > 0 || hireActuals.length > 0 || carActuals.length > 0 || accomActuals.length > 0
          || resources.some(r => (r as Resource & { linked_po_id?: string }).linked_po_id === po.id)
        if (!hasLinkedBookings && budget > 0) return budget
      }
      return bucket?.total ?? 0
    })()
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
              <div><div style={SH}>Forecast Start</div><input type="date" className="input" style={{width:'100%',fontSize:'12px'}} value={form.forecast_start} onChange={e=>setForm(f=>({...f,forecast_start:e.target.value}))} title="When spend begins — used for cost forecasting"/></div>
              <div><div style={SH}>Forecast End</div><input type="date" className="input" style={{width:'100%',fontSize:'12px'}} value={form.forecast_end} onChange={e=>setForm(f=>({...f,forecast_end:e.target.value}))} title="When spend ends — used for cost forecasting"/></div>
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
                      <option value="">— WBS —</option>{wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
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
            {(['overview','labour','equipment','invoices','eac','fc-vs-act'] as DetailTab[]).map(t=>{
              const label = t === 'eac' ? 'EAC' : t === 'fc-vs-act' ? 'Fc vs Act' : t.charAt(0).toUpperCase() + t.slice(1)
              return <button key={t} onClick={()=>setDetailTab(t)} style={{padding:'6px 14px',fontSize:'12px',fontWeight:detailTab===t?600:400,border:'none',background:'none',borderBottom:detailTab===t?'2px solid var(--accent)':'2px solid transparent',color:detailTab===t?'var(--accent)':'var(--text2)',cursor:'pointer',marginBottom:'-1px'}}>{label}</button>
            })}
          </div>
          <div style={{padding:'12px 16px',flex:1}}>
            {detailTab==='overview'&&(
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                  <thead><tr>
                    <th style={{...TH,textAlign:'left'}}>Category</th>
                    <th style={{...TH,textAlign:'right'}}>Planned</th>
                    <th style={{...TH,textAlign:'right'}}>Actuals to date</th>
                    <th style={{...TH,textAlign:'right'}}>Committed to date</th>
                    <th style={{...TH,textAlign:'right'}}>Variance</th>
                  </tr></thead>
                  <tbody>
                    {[
                      {label:'👷 Labour',planned:bucket?.labour.cost??0,actual:labActTotal,committed:0},
                      {label:'🚜 Dry Hire',planned:bucket?.dryHire.cost??0,actual:0,committed:hireActuals.filter(h=>h.hire_type==='dry').reduce((s,h)=>s+h.actualToDate,0)},
                      {label:'🏗️ Wet Hire',planned:bucket?.wetHire.cost??0,actual:0,committed:hireActuals.filter(h=>h.hire_type==='wet').reduce((s,h)=>s+h.actualToDate,0)},
                      {label:'🧰 Local Hire',planned:bucket?.localHire.cost??0,actual:0,committed:hireActuals.filter(h=>h.hire_type==='local').reduce((s,h)=>s+h.actualToDate,0)},
                      {label:'🚗 Cars',planned:bucket?.cars.cost??0,actual:0,committed:carActTotal},
                      {label:'🏠 Accommodation',planned:bucket?.accom.cost??0,actual:0,committed:accomActTotal},
                    ].filter(r=>r.planned>0||r.actual>0||r.committed>0).map(row=>{
                      const v=row.planned-row.actual-row.committed
                      return <tr key={row.label} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={TD}>{row.label}</td>
                        <td style={TDR}>{fmt(row.planned)}</td>
                        <td style={TDR}>{row.actual>0?fmt(row.actual):<span style={{color:'var(--text3)'}}>—</span>}</td>
                        <td style={{...TDR,color:row.committed>0?'#d97706':'var(--text3)'}}>{row.committed>0?fmt(row.committed):'—'}</td>
                        <td style={{...TDR,color:v<0?'var(--red)':'var(--green)',fontWeight:600}}>{v>=0?'+':''}{fmt(v)}</td>
                      </tr>
                    })}
                    <tr style={{background:'var(--bg2)',fontWeight:700}}>
                      <td style={TD}>Total</td>
                      <td style={TDR}>{fmt(planned)}</td>
                      <td style={TDR}>{fmt(totalActuals)}</td>
                      <td style={{...TDR,color:'#d97706'}}>{fmt(equipCommittedToDate)}</td>
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
                          <td style={TD}><span style={{fontSize:'10px',padding:'2px 6px',borderRadius:'10px',background:inv.status==='approved'?'#d1fae5':'#fef3c7',color:inv.status==='approved'?'#065f46':'#92400e',fontWeight:600}}>{inv.status}</span></td>
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
            {detailTab==='eac'&&(() => {
              // EAC = Actuals (labour timesheets) + Forecast Forward (engine days >= forecastStart).
              // Both halves match MIKA's formula exactly — actuals from timesheet_cost_lines,
              // forecast from byWbsFuture / bucket.futureTotal. Equipment proration to today
              // is informational only (shown on Overview as "Committed to date"); it doesn't
              // enter EAC until an invoice posts as a real actual.
              const equipPlanned = (bucket?.dryHire.cost||0)+(bucket?.wetHire.cost||0)+(bucket?.localHire.cost||0)+(bucket?.cars.cost||0)+(bucket?.accom.cost||0)
              const equipFutureFromEngine = (bucket?.dryHire.futureCost||0)+(bucket?.wetHire.futureCost||0)+(bucket?.localHire.futureCost||0)+(bucket?.cars.futureCost||0)+(bucket?.accom.futureCost||0)
              // Fallback for fixed-price POs with no engine bookings: planned - actuals.
              const fwdForecast = (bucket?.futureTotal != null && (bucket.labour.cost > 0 || equipPlanned > 0))
                ? bucket.futureTotal
                : Math.max(0, planned - totalActuals)
              const eac = totalActuals + fwdForecast
              const eacVsBudget = budget - eac
              const hasAnyData = labActuals.length>0 || hireActuals.length>0 || carActuals.length>0 || accomActuals.length>0 || poInvoices.length>0 || linkedResources.length>0 || planned>0
              if (!hasAnyData) {
                return <div className="card" style={{padding:'24px',textAlign:'center',color:'var(--text3)',fontSize:'12px'}}>
                  <div style={{fontSize:'24px',marginBottom:'8px'}}>📊</div>
                  <div>No EAC components yet. Link resources, hire items, cars, accommodation or invoices to see the breakdown.</div>
                </div>
              }

              // ── Forward-portion helper (uses engine's forecastStart, NOT today) ──
              // forecastStart = day after the latest posted timesheet (or today if none).
              // This keeps actuals + forecast tiling cleanly even when timesheets are
              // posted ahead of today.
              const fcStart = forecast?.forecastStart || new Date().toISOString().slice(0,10)
              const fcStartMs = new Date(fcStart+'T12:00:00').getTime()
              const fwd = (start?: string|null, end?: string|null) => {
                if (!start) return { totalDays: 0, fwdDays: 0, fwdPct: 0, fwdFrom: '', isPartial: false }
                const e = end || start
                const sMs = new Date(start+'T12:00:00').getTime()
                const eMs = new Date(e+'T12:00:00').getTime()
                const totalDays = Math.max(1, Math.round((eMs-sMs)/86400000)+1)
                if (eMs < fcStartMs) return { totalDays, fwdDays: 0, fwdPct: 0, fwdFrom: e, isPartial: false }
                const startsInFuture = sMs > fcStartMs
                const fwdFromMs = startsInFuture ? sMs : fcStartMs
                const fwdDays = Math.max(0, Math.round((eMs-fwdFromMs)/86400000)+1)
                const fwdFrom = startsInFuture ? start : fcStart
                return { totalDays, fwdDays, fwdPct: Math.min(1, fwdDays/totalDays), fwdFrom, isPartial: !startsInFuture && sMs < fcStartMs }
              }

              // Per-resource forward — use engine's futureCost directly (exact, not prorated)
              const labourFwdRows = linkedResources.map(r => {
                const pb = bucket?.labour.people.find(p => p.resourceId === r.id)
                const mobIn = (r as Resource & {mob_in?:string}).mob_in
                const mobOut = (r as Resource & {mob_out?:string}).mob_out
                const f = fwd(mobIn, mobOut)
                return { r, pb, mobIn, mobOut, ...f, fwdCost: pb?.futureCost ?? 0, fwdHours: pb?.futureHours ?? 0, plannedCost: pb?.totalCost ?? 0 }
              }).filter(x => x.fwdDays > 0 || x.fwdCost > 0)
              const labourFwdCostSubtotal = labourFwdRows.reduce((s,x)=>s+x.fwdCost,0)
              const labourFwdHoursSubtotal = labourFwdRows.reduce((s,x)=>s+x.fwdHours,0)

              // Equipment forward — equipment is fully committed until invoiced, so
              // each row shows its full contract span (no forecastStart gating).
              // Engine bucket.<cat>.futureCost now also equals full contract cost.
              const fwdFull = (start?: string|null, end?: string|null) => {
                if (!start) return { totalDays: 0, fwdDays: 0, fwdPct: 0, fwdFrom: '', isPartial: false }
                const e = end || start
                const sMs = new Date(start+'T12:00:00').getTime()
                const eMs = new Date(e+'T12:00:00').getTime()
                const totalDays = Math.max(1, Math.round((eMs-sMs)/86400000)+1)
                return { totalDays, fwdDays: totalDays, fwdPct: 1, fwdFrom: start, isPartial: false }
              }
              const hireFwdRows = hireActuals.map(h => {
                const f = fwdFull(h.start_date, h.end_date)
                return { h, ...f, fwdCost: h.hire_cost || 0 }
              }).filter(x => x.fwdDays > 0)
              const carFwdRows = carActuals.map(c => {
                const f = fwdFull(c.start_date, c.end_date)
                return { c, ...f, fwdCost: c.total_cost || 0 }
              }).filter(x => x.fwdDays > 0)
              const accomFwdRows = accomActuals.map(a => {
                const f = fwdFull(a.check_in, a.check_out)
                return { a, ...f, fwdCost: a.total_cost || 0 }
              }).filter(x => x.fwdDays > 0)
              // Reconcile equipment subtotal with engine future (uses engine if available)
              const equipFwdSubtotal = equipFutureFromEngine > 0
                ? equipFutureFromEngine
                : hireFwdRows.reduce((s,x)=>s+x.fwdCost,0) + carFwdRows.reduce((s,x)=>s+x.fwdCost,0) + accomFwdRows.reduce((s,x)=>s+x.fwdCost,0)
              const totalFwdFromRows = labourFwdCostSubtotal + equipFwdSubtotal

              return <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                {/* EAC build-up summary */}
                <div className="card" style={{padding:'10px 14px'}}>
                  <div style={{fontSize:'10px',fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'8px'}}>EAC build-up</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 14px 1fr 14px 1fr 14px 1fr',gap:'8px',alignItems:'center'}}>
                    <div>
                      <div style={{fontSize:'10px',color:'var(--text3)'}}>Actuals to date</div>
                      <div style={{fontSize:'15px',fontWeight:700,fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(totalActuals)}</div>
                    </div>
                    <div style={{textAlign:'center',fontSize:'16px',color:'var(--text3)'}}>+</div>
                    <div>
                      <div style={{fontSize:'10px',color:'var(--text3)'}}>Forecast forward</div>
                      <div style={{fontSize:'15px',fontWeight:700,fontFamily:'var(--mono)',color:'#f97316'}}>{fmt(fwdForecast)}</div>
                    </div>
                    <div style={{textAlign:'center',fontSize:'16px',color:'var(--text3)'}}>=</div>
                    <div>
                      <div style={{fontSize:'10px',color:'var(--text3)'}}>EAC</div>
                      <div style={{fontSize:'15px',fontWeight:700,fontFamily:'var(--mono)',color:'#7c3aed'}}>{fmt(eac)}</div>
                    </div>
                    <div style={{textAlign:'center',fontSize:'16px',color:'var(--text3)'}}>{eacVsBudget>=0?'≤':'>'}</div>
                    <div>
                      <div style={{fontSize:'10px',color:'var(--text3)'}}>vs Budget ({fmt(budget)})</div>
                      <div style={{fontSize:'15px',fontWeight:700,fontFamily:'var(--mono)',color:eacVsBudget<0?'var(--red)':'var(--green)'}}>{(eacVsBudget>=0?'+':'')+fmt(eacVsBudget)}</div>
                    </div>
                  </div>
                </div>

                {/* ═══ FORECAST (from forecast start onwards) ═══ */}
                {(labourFwdRows.length>0||hireFwdRows.length>0||carFwdRows.length>0||accomFwdRows.length>0)&&(
                  <div style={{padding:'6px 12px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'6px',fontSize:'11px',color:'#92400e',display:'flex',alignItems:'center',gap:'8px'}}>
                    <span style={{fontSize:'13px'}}>📅</span>
                    <span>Forecast starts <strong>{fmtDate(fcStart)}</strong> — the day after the latest posted timesheet. Actuals below cover everything up to that point, so the two tile cleanly with no double-counting.</span>
                  </div>
                )}

                {labourFwdRows.length>0&&(
                  <div className="card" style={{padding:0,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'#fef3c7',color:'#92400e',fontSize:'11px',fontWeight:700,borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between'}}>
                      <span>📋 FORECAST — Labour engine calc (forward from forecast start) · {labourFwdRows.length} resource{labourFwdRows.length===1?'':'s'}</span>
                      <span style={{fontFamily:'var(--mono)'}}>{fmt(labourFwdCostSubtotal)}</span>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead><tr>{['Name','Role','From','Mob Out','Fwd Days','Fwd Hours','Fwd Cost','Planned (full)'].map(h=><th key={h} style={{...TH,textAlign:['Fwd Days','Fwd Hours','Fwd Cost','Planned (full)'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {labourFwdRows.map(x=>(
                          <tr key={x.r.id} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={{...TD,fontWeight:600}}>{x.r.name}</td>
                            <td style={{...TD,color:'var(--text3)'}}>{x.r.role}</td>
                            <td style={TD}>{fmtDate(x.fwdFrom)}{x.isPartial&&<span style={{fontSize:'9px',color:'#92400e',marginLeft:'4px',padding:'1px 4px',background:'#fef3c7',borderRadius:'3px',fontWeight:600}}>FORECAST START</span>}</td>
                            <td style={TD}>{fmtDate(x.mobOut)}</td>
                            <td style={TDR}>{x.fwdDays}{x.isPartial&&<span style={{fontSize:'10px',color:'var(--text3)'}}> /{x.totalDays}</span>}</td>
                            <td style={TDR}>{x.fwdHours.toFixed(0)}h</td>
                            <td style={{...TDR,fontWeight:600,color:'#d97706'}}>{fmtFull(x.fwdCost)}</td>
                            <td style={{...TDR,color:'var(--text3)',fontSize:'11px'}}>{fmt(x.plannedCost)}</td>
                          </tr>
                        ))}
                        <tr style={{background:'var(--bg2)',fontWeight:700}}>
                          <td colSpan={5} style={TD}>Subtotal — Labour forecast forward</td>
                          <td style={TDR}>{labourFwdHoursSubtotal.toFixed(0)}h</td>
                          <td style={{...TDR,color:'#d97706'}}>{fmtFull(labourFwdCostSubtotal)}</td>
                          <td style={{...TDR,color:'var(--text3)',fontSize:'11px'}}>{fmt(bucket?.labour.cost??0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {(hireFwdRows.length>0||carFwdRows.length>0||accomFwdRows.length>0)&&(
                  <div className="card" style={{padding:0,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'#fef3c7',color:'#92400e',fontSize:'11px',fontWeight:700,borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between'}}>
                      <span>📋 FORECAST — Equipment (full contract — committed until invoiced)</span>
                      <span style={{fontFamily:'var(--mono)'}}>{fmt(equipFwdSubtotal)}</span>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead><tr>{['Type','Item','From','End','Fwd Days','Fwd Cost','Contract (full)'].map(h=><th key={h} style={{...TH,textAlign:['Fwd Days','Fwd Cost','Contract (full)'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {hireFwdRows.map(x=>(
                          <tr key={x.h.id} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={TD}><span style={{fontSize:'10px',padding:'1px 5px',borderRadius:'3px',background:'var(--bg2)'}}>{x.h.hire_type} hire</span></td>
                            <td style={TD}>{x.h.name}</td>
                            <td style={TD}>{fmtDate(x.fwdFrom)}{x.isPartial&&<span style={{fontSize:'9px',color:'#92400e',marginLeft:'4px',padding:'1px 4px',background:'#fef3c7',borderRadius:'3px',fontWeight:600}}>FORECAST START</span>}</td>
                            <td style={TD}>{fmtDate(x.h.end_date)}</td>
                            <td style={TDR}>{x.fwdDays}{x.isPartial&&<span style={{fontSize:'10px',color:'var(--text3)'}}> /{x.totalDays}</span>}</td>
                            <td style={{...TDR,fontWeight:600,color:'#d97706'}}>{fmtFull(x.fwdCost)}</td>
                            <td style={{...TDR,color:'var(--text3)',fontSize:'11px'}}>{fmt(x.h.hire_cost||0)}</td>
                          </tr>
                        ))}
                        {carFwdRows.map(x=>(
                          <tr key={x.c.id} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={TD}><span style={{fontSize:'10px',padding:'1px 5px',borderRadius:'3px',background:'var(--bg2)'}}>car</span></td>
                            <td style={TD}>{x.c.label}</td>
                            <td style={TD}>{fmtDate(x.fwdFrom)}{x.isPartial&&<span style={{fontSize:'9px',color:'#92400e',marginLeft:'4px',padding:'1px 4px',background:'#fef3c7',borderRadius:'3px',fontWeight:600}}>FORECAST START</span>}</td>
                            <td style={TD}>{fmtDate(x.c.end_date)}</td>
                            <td style={TDR}>{x.fwdDays}{x.isPartial&&<span style={{fontSize:'10px',color:'var(--text3)'}}> /{x.totalDays}</span>}</td>
                            <td style={{...TDR,fontWeight:600,color:'#d97706'}}>{fmtFull(x.fwdCost)}</td>
                            <td style={{...TDR,color:'var(--text3)',fontSize:'11px'}}>{fmt(x.c.total_cost||0)}</td>
                          </tr>
                        ))}
                        {accomFwdRows.map(x=>(
                          <tr key={x.a.id} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={TD}><span style={{fontSize:'10px',padding:'1px 5px',borderRadius:'3px',background:'var(--bg2)'}}>accom</span></td>
                            <td style={TD}>{x.a.property}{x.a.room?` — ${x.a.room}`:''}</td>
                            <td style={TD}>{fmtDate(x.fwdFrom)}{x.isPartial&&<span style={{fontSize:'9px',color:'#92400e',marginLeft:'4px',padding:'1px 4px',background:'#fef3c7',borderRadius:'3px',fontWeight:600}}>FORECAST START</span>}</td>
                            <td style={TD}>{fmtDate(x.a.check_out)}</td>
                            <td style={TDR}>{x.fwdDays}{x.isPartial&&<span style={{fontSize:'10px',color:'var(--text3)'}}> /{x.totalDays}</span>}</td>
                            <td style={{...TDR,fontWeight:600,color:'#d97706'}}>{fmtFull(x.fwdCost)}</td>
                            <td style={{...TDR,color:'var(--text3)',fontSize:'11px'}}>{fmt(x.a.total_cost||0)}</td>
                          </tr>
                        ))}
                        <tr style={{background:'var(--bg2)',fontWeight:700}}>
                          <td colSpan={5} style={TD}>Subtotal — Equipment forecast forward</td>
                          <td style={{...TDR,color:'#d97706'}}>{fmtFull(equipFwdSubtotal)}</td>
                          <td style={{...TDR,color:'var(--text3)',fontSize:'11px'}}>{fmt(equipPlanned)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Total forecast forward */}
                {totalFwdFromRows>0&&(
                  <div style={{padding:'8px 14px',background:'var(--bg2)',borderRadius:'6px',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px',fontWeight:700,border:'1px solid var(--border)'}}>
                    <span style={{color:'#92400e'}}>📋 TOTAL FORECAST FORWARD (from {fmtDate(fcStart)})</span>
                    <span style={{fontFamily:'var(--mono)',color:'#d97706',fontSize:'14px'}}>{fmtFull(totalFwdFromRows)}</span>
                  </div>
                )}

                {/* ═══ ACTUALS TO DATE ═══ */}
                {labActuals.length>0&&(
                  <div className="card" style={{padding:0,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'#d1fae5',color:'#065f46',fontSize:'11px',fontWeight:700,borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between'}}>
                      <span>✓ ACTUALS — Labour timesheets · {labActuals.length} {labActuals.length===1?'entry':'entries'}</span>
                      <span style={{fontFamily:'var(--mono)'}}>{fmt(labActTotal)}</span>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead><tr>{['Date','Person','Role','Hours','Labour','Allow','Total'].map(h=><th key={h} style={{...TH,textAlign:['Hours','Labour','Allow','Total'].includes(h)?'right':'left'}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {labActuals.sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.person_name.localeCompare(b.person_name)).map((r,i)=>(
                          <tr key={i} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={{...TD,fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{new Date(r.work_date+'T12:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short'})}</td>
                            <td style={TD}>{r.person_name}</td>
                            <td style={{...TD,color:'var(--text3)'}}>{r.role}</td>
                            <td style={TDR}>{(r.allocated_hours||0).toFixed(2)}h</td>
                            <td style={TDR}>{fmtFull(r.cost_labour||0)}</td>
                            <td style={TDR}>{r.cost_allowances>0?fmtFull(r.cost_allowances):'—'}</td>
                            <td style={{...TDR,fontWeight:600}}>{fmtFull((r.cost_labour||0)+(r.cost_allowances||0))}</td>
                          </tr>
                        ))}
                        <tr style={{background:'var(--bg2)',fontWeight:700}}>
                          <td colSpan={3} style={TD}>Subtotal — Labour actuals</td>
                          <td style={TDR}>{labActuals.reduce((s,r)=>s+(r.allocated_hours||0),0).toFixed(2)}h</td>
                          <td style={TDR}>{fmtFull(labActuals.reduce((s,r)=>s+(r.cost_labour||0),0))}</td>
                          <td style={TDR}>{fmtFull(labActuals.reduce((s,r)=>s+(r.cost_allowances||0),0))}</td>
                          <td style={{...TDR,color:'var(--green)'}}>{fmtFull(labActTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {poInvoices.length>0&&(
                  <div className="card" style={{padding:0,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'#d1fae5',color:'#065f46',fontSize:'11px',fontWeight:700,borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between'}}>
                      <span>✓ ACTUALS — Invoiced · {poInvoices.length} invoice{poInvoices.length===1?'':'s'}</span>
                      <span style={{fontFamily:'var(--mono)'}}>{fmt(invoiced)}</span>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead><tr>{['Reference','Date','Status','Amount'].map(h=><th key={h} style={{...TH,textAlign:h==='Amount'?'right':'left'}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {poInvoices.map((inv,i)=>{
                          const ia=inv as Invoice & {invoice_ref?:string;invoice_date?:string}
                          return <tr key={inv.id} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={TD}>{ia.invoice_ref||`Invoice ${i+1}`}</td>
                            <td style={TD}>{fmtDate(ia.invoice_date)}</td>
                            <td style={TD}><span style={{fontSize:'10px',padding:'2px 6px',borderRadius:'10px',background:inv.status==='approved'?'#d1fae5':'#fef3c7',color:inv.status==='approved'?'#065f46':'#92400e',fontWeight:600}}>{inv.status}</span></td>
                            <td style={{...TDR,fontWeight:600,color:'var(--green)'}}>{fmtFull(inv.amount||0)}</td>
                          </tr>
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Total actuals */}
                {totalActuals>0&&(
                  <div style={{padding:'8px 14px',background:'var(--bg2)',borderRadius:'6px',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px',fontWeight:700,border:'1px solid var(--border)'}}>
                    <span style={{color:'#065f46'}}>✓ TOTAL ACTUALS TO DATE</span>
                    <span style={{fontFamily:'var(--mono)',color:'var(--green)',fontSize:'14px'}}>{fmtFull(totalActuals)}</span>
                  </div>
                )}
              </div>
            })()}
            {detailTab==='fc-vs-act'&&(() => {
              // Build per-week forecast and actuals for this PO.
              // Forecast = linear proration of each linked item across its window
              //   (resources × mob window, hire/cars/accom × their dates).
              // Actuals  = real timesheet rows for labour, prorated to-date for equipment.
              const weekMap: Record<string, { forecast: number; actuals: number }> = {}
              const ensureWk = (wk: string) => {
                if (!weekMap[wk]) weekMap[wk] = { forecast: 0, actuals: 0 }
                return weekMap[wk]
              }
              const todayStr = new Date().toISOString().slice(0,10)
              const todayWk = weekKey(todayStr)

              // Helper: spread a totalCost linearly across [start,end] daily, contributing
              // to both forecast (always) and actuals (only for days < today).
              const spread = (start: string, end: string, totalCost: number, alsoActual: boolean) => {
                if (!start || !totalCost) return
                const sMs = new Date(start+'T12:00:00').getTime()
                const eMs = new Date((end || start)+'T12:00:00').getTime()
                const dayCount = Math.max(1, Math.round((eMs - sMs)/86400000) + 1)
                const perDay = totalCost / dayCount
                const d = new Date(start+'T12:00:00')
                for (let i = 0; i < dayCount; i++) {
                  const dStr = d.toISOString().slice(0,10)
                  const bucket = ensureWk(weekKey(dStr))
                  bucket.forecast += perDay
                  if (alsoActual && dStr < todayStr) bucket.actuals += perDay
                  d.setDate(d.getDate() + 1)
                }
              }

              // ── FORECAST contributions ──
              for (const p of bucket?.labour.people ?? []) {
                spread(p.mobIn, p.mobOut || p.mobIn, p.totalCost, false)  // labour actuals come from timesheets
              }
              // Equipment: forecast only, NOT actuals. Equipment is committed until
              // invoiced — it doesn't become an actual just because time passed.
              for (const h of hireActuals) {
                if (h.start_date && h.hire_cost) spread(h.start_date, h.end_date || h.start_date, h.hire_cost, false)
              }
              for (const c of carActuals) {
                if (c.start_date && c.total_cost) spread(c.start_date, c.end_date || c.start_date, c.total_cost, false)
              }
              for (const a of accomActuals) {
                if (a.check_in && a.total_cost) spread(a.check_in, a.check_out || a.check_in, a.total_cost, false)
              }

              // ── LABOUR ACTUALS — real timesheet rows ──
              for (const r of labActuals) {
                if (!r.work_date) continue
                const cost = (r.cost_labour||0) + (r.cost_allowances||0)
                if (cost) ensureWk(weekKey(r.work_date)).actuals += cost
              }

              const weeks = Object.keys(weekMap).sort()
              if (weeks.length === 0) {
                return <div className="card" style={{padding:'24px',textAlign:'center',color:'var(--text3)',fontSize:'12px'}}>
                  <div style={{fontSize:'24px',marginBottom:'8px'}}>📈</div>
                  <div>No forecast or actuals data for this PO yet. Link resources, equipment, or post timesheets to populate the chart.</div>
                </div>
              }

              // Cumulative series + variance per week
              let cumF = 0, cumA = 0
              const rows = weeks.map((wk, i) => {
                const w = weekMap[wk]
                cumF += w.forecast
                cumA += w.actuals
                const isPast = wk <= todayWk
                return {
                  wk,
                  weekNum: i + 1,
                  label: weekLabel(wk),
                  xLabel: wk.slice(5),  // short MM-DD for axis
                  forecast: w.forecast,
                  actuals: w.actuals,
                  weekVariance: w.forecast - w.actuals,
                  cumForecast: cumF,
                  cumActuals: cumA,
                  cumVariance: cumF - cumA,
                  isPast,
                  // For chart: null out actuals after today so the line stops cleanly
                  chartActuals: isPast ? cumA : null,
                }
              })

              // Per-week totals (used by chart and table). These describe the chart
              // trajectory — they may differ slightly from the EAC build-up below
              // because per-day proration in spread() vs prorateToDate.
              const chartForecastTotal = rows.reduce((s,r)=>s+r.forecast,0)
              const chartActualsTotal = rows.reduce((s,r)=>s+r.actuals,0)
              const chartVariance = chartForecastTotal - chartActualsTotal
              const todayRow = rows.find(r => r.wk === todayWk)

              // EAC build-up — matches the EAC tab and MIKA exactly so all three views agree.
              const eqPlanned = (bucket?.dryHire.cost||0)+(bucket?.wetHire.cost||0)+(bucket?.localHire.cost||0)+(bucket?.cars.cost||0)+(bucket?.accom.cost||0)
              const eacFwd = (bucket?.futureTotal != null && (bucket.labour.cost > 0 || eqPlanned > 0))
                ? bucket.futureTotal
                : Math.max(0, planned - totalActuals)
              const eacValue = totalActuals + eacFwd

              return <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                {/* KPI strip — mirrors the EAC tab build-up so all three views agree */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
                  <div className="card" style={{padding:'10px 12px',borderTop:'3px solid var(--green)'}}>
                    <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600}}>Actuals to Date</div>
                    <div style={{fontSize:'16px',fontWeight:700,fontFamily:'var(--mono)',color:'var(--green)',marginTop:'2px'}}>{fmtFull(totalActuals)}</div>
                  </div>
                  <div className="card" style={{padding:'10px 12px',borderTop:'3px solid #d97706'}}>
                    <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600}}>+ Forecast Forward</div>
                    <div style={{fontSize:'16px',fontWeight:700,fontFamily:'var(--mono)',color:'#d97706',marginTop:'2px'}}>{fmtFull(eacFwd)}</div>
                  </div>
                  <div className="card" style={{padding:'10px 12px',borderTop:'3px solid #7c3aed'}}>
                    <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600}}>= EAC</div>
                    <div style={{fontSize:'16px',fontWeight:700,fontFamily:'var(--mono)',color:'#7c3aed',marginTop:'2px'}}>{fmtFull(eacValue)}</div>
                  </div>
                </div>

                {/* Chart */}
                <div className="card" style={{padding:'12px'}}>
                  <div style={{fontSize:'11px',fontWeight:600,marginBottom:'8px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span>Cumulative Forecast vs Actuals · {rows.length} weeks</span>
                    <span style={{fontSize:'10px',color:'var(--text3)',fontWeight:400}}>Forecast = engine&apos;s full planned trajectory ({fmt(chartForecastTotal)}). Actuals stop at current week.</span>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={rows} margin={{top:8,right:16,left:8,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="xLabel" tick={{fontSize:10}} />
                      <YAxis tickFormatter={(v: number) => fmt(v)} tick={{fontSize:10}} />
                      <Tooltip
                        formatter={(v: unknown) => v == null ? '—' : fmtFull(Number(v))}
                        labelFormatter={(_, payload) => {
                          const r = payload?.[0]?.payload as { label?: string } | undefined
                          return r?.label ? `Week of ${r.label}` : ''
                        }}
                      />
                      <Legend wrapperStyle={{fontSize:11}} />
                      <Line type="monotone" dataKey="cumForecast" name="Forecast (cumulative)" stroke="#d97706" strokeWidth={2} dot={false} activeDot={{r:5}} />
                      <Line
                        type="monotone"
                        dataKey="chartActuals"
                        name="Actuals (cumulative)"
                        stroke="#059669"
                        strokeWidth={2.5}
                        connectNulls={false}
                        dot={(props: { cx?: number; cy?: number; index?: number; payload?: { chartActuals?: number | null } }) => {
                          const { cx, cy, index, payload } = props
                          if (cx == null || cy == null || payload?.chartActuals == null) return <g key={`a-${index}`} />
                          // Find the last index with non-null actuals — emphasise that endpoint
                          const lastActIdx = rows.reduce((last, r, i) => r.chartActuals != null ? i : last, -1)
                          const isEndpoint = index === lastActIdx
                          return <circle
                            key={`a-${index}`}
                            cx={cx} cy={cy}
                            r={isEndpoint ? 5 : 3}
                            fill="#059669"
                            stroke={isEndpoint ? '#fff' : '#059669'}
                            strokeWidth={isEndpoint ? 2 : 0}
                          />
                        }}
                        activeDot={{r:6}}
                      />
                      {todayRow && <ReferenceLine x={todayRow.xLabel} stroke="var(--amber)" strokeDasharray="4 4" label={{value:'Today',position:'insideTopRight',fontSize:10,fill:'var(--amber)'}} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Table */}
                <div className="card" style={{padding:0,overflow:'hidden'}}>
                  <div style={{padding:'8px 12px',background:'var(--bg2)',fontSize:'11px',fontWeight:600,borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between'}}>
                    <span>Week-by-week breakdown</span>
                    <span style={{color:'var(--text3)',fontWeight:400}}>Yellow row = current week</span>
                  </div>
                  <div style={{maxHeight:'400px',overflowY:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                      <thead style={{position:'sticky',top:0,background:'var(--bg2)',zIndex:1}}>
                        <tr>{['Wk','Period','Forecast','Actuals','Variance','Cum. Var'].map(h=>(
                          <th key={h} style={{...TH,textAlign:['Forecast','Actuals','Variance','Cum. Var'].includes(h)?'right':'left'}}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.wk} style={{borderBottom:'1px solid var(--border)',background:r.wk===todayWk?'#fffbeb':undefined}}>
                            <td style={{...TD,fontFamily:'var(--mono)',fontSize:'11px',fontWeight:600,color:r.wk===todayWk?'#92400e':'var(--text)'}}>W{r.weekNum}{r.wk===todayWk?' ←':''}</td>
                            <td style={{...TD,color:'var(--text3)'}}>{r.label}</td>
                            <td style={TDR}>{r.forecast>0?fmt(r.forecast):'—'}</td>
                            <td style={{...TDR,color:r.actuals>0?'var(--green)':'var(--text3)'}}>{r.actuals>0?fmt(r.actuals):'—'}</td>
                            <td style={{...TDR,color:!r.isPast?'var(--text3)':r.weekVariance<0?'var(--red)':'var(--green)',fontWeight:r.isPast?600:400}}>{r.isPast?((r.weekVariance>=0?'+':'')+fmt(r.weekVariance)):'—'}</td>
                            <td style={{...TDR,color:!r.isPast?'var(--text3)':r.cumVariance<0?'var(--red)':'var(--green)'}}>{r.isPast?((r.cumVariance>=0?'+':'')+fmt(r.cumVariance)):'—'}</td>
                          </tr>
                        ))}
                        <tr style={{background:'var(--bg2)',fontWeight:700,position:'sticky',bottom:0}}>
                          <td colSpan={2} style={TD}>Total</td>
                          <td style={TDR}>{fmt(chartForecastTotal)}</td>
                          <td style={{...TDR,color:'var(--green)'}}>{fmt(chartActualsTotal)}</td>
                          <td style={{...TDR,color:chartVariance<0?'var(--red)':'var(--green)'}}>{(chartVariance>=0?'+':'')+fmt(chartVariance)}</td>
                          <td style={TD}/>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            })()}
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
            <div className="fg-row">
              <div className="fg"><label>Forecast Start <span style={{fontWeight:400,color:'var(--text3)'}}>— cost spread begins</span></label><input type="date" className="input" value={form.forecast_start} onChange={e=>setForm(f=>({...f,forecast_start:e.target.value}))}/></div>
              <div className="fg"><label>Forecast End <span style={{fontWeight:400,color:'var(--text3)'}}>— cost spread ends</span></label><input type="date" className="input" value={form.forecast_end} onChange={e=>setForm(f=>({...f,forecast_end:e.target.value}))}/></div>
            </div>
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
              <div key={line.id} style={{display:'grid',gridTemplateColumns:isTce && tceLines.length>0?'1fr 100px 140px 120px 32px':'1fr 100px 120px 32px',gap:'6px',marginBottom:'6px',alignItems:'flex-end'}}>
                <div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>Description</label>}
                  <input className="input" value={line.description} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,description:e.target.value}:l)}))} placeholder="Description"/></div>
                <div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>WBS</label>}
                  <select className="input" value={line.wbs} onChange={e=>setForm(f=>({...f,lines:f.lines.map((l,j)=>j===i?{...l,wbs:e.target.value}:l)}))}>
                    <option value="">— WBS —</option>{wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}</select></div>
                {isTce && tceLines.length>0&&<div>{i===0&&<label style={{fontSize:'11px',display:'block',marginBottom:'2px'}}>TCE Item</label>}
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
      <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px'}}>
        <h1 style={{fontSize:'18px',fontWeight:700,margin:0}}>Purchase Orders</h1>
        <HelpButton panelId="purchase-orders" />
      </div>
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
