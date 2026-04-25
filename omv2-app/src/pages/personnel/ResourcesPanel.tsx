import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Resource, RateCard, PurchaseOrder } from '../../types'

const CATEGORIES = ['trades','management','seag','subcontractor'] as const
const SHIFTS = ['day','night','both'] as const
const EMPTY: Partial<Resource> = {
  name:'', role:'', category:'trades', shift:'day',
  mob_in:null, mob_out:null, travel_days:0, wbs:'',
  allow_laha:false, allow_fsa:false, allow_meal:false,
  company:'', phone:'', email:'', notes:'',
  linked_po_id:null, rate_card_id:null,
}

function resourceStatus(r: Resource): 'onsite'|'incoming'|'upcoming'|'departed'|'future'|'unknown' {
  const today = new Date().toISOString().slice(0,10)
  if (!r.mob_in) return 'unknown'
  if (r.mob_out && r.mob_out < today) return 'departed'
  if (r.mob_in <= today && (!r.mob_out || r.mob_out >= today)) return 'onsite'
  const daysOut = (new Date(r.mob_in).getTime() - new Date(today).getTime()) / 86400000
  if (daysOut <= 7) return 'incoming'
  if (daysOut <= 30) return 'upcoming'
  return 'future'
}

const STATUS_STYLE: Record<string,{bg:string,color:string,label:string}> = {
  onsite:  {bg:'#d1fae5',color:'#065f46',label:'On-site'},
  incoming:{bg:'#fef3c7',color:'#92400e',label:'Incoming'},
  upcoming:{bg:'#dbeafe',color:'#1e40af',label:'Upcoming'},
  departed:{bg:'#f1f5f9',color:'#64748b',label:'Departed'},
  future:  {bg:'#f3e8ff',color:'#6b21a8',label:'Future'},
  unknown: {bg:'#f1f5f9',color:'#94a3b8',label:'No dates'},
}

type SortCol = 'status'|'name'|'role'|'shift'|'company'|'mob_in'|'mob_out'|'allow_laha'|'allow_meal'|'allow_fsa'

export function ResourcesPanel() {
  const { activeProject } = useAppStore()
  const [resources, setResources] = useState<Resource[]>([])
  const [rcs, setRcs] = useState<RateCard[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [cars, setCars] = useState<{id:string,person_id:string,vehicle_type:string}[]>([])
  const [accom, setAccom] = useState<{id:string,occupants:string[],property:string,room:string}[]>([])
  const [wbsList, setWbsList] = useState<{id:string,code:string,name:string}[]>([])
  const [accommodationByPerson, setAccomByPerson] = useState<Record<string,{property:string;room:string}>>({})
  const [_rateCards, setRateCards] = useState<{id:string,role:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Resource>(null)
  const [form, setForm] = useState<Partial<Resource>>(EMPTY)
  const [saving, setSaving] = useState(false)

  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('status')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkForm, setBulkForm] = useState({ mob_in:'', mob_out:'', shift:'', wbs:'', allow_laha:false, allow_meal:false, allow_fsa:false, applyLaha:false, applyMeal:false, applyFsa:false })
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, rcData, poData, carData, accomData, wbsData] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid).order('name'),
      supabase.from('rate_cards').select('*').eq('project_id', pid).order('role'),
      supabase.from('purchase_orders').select('id,po_number,vendor,description,status').eq('project_id', pid).order('po_number'),
      supabase.from('cars').select('id,person_id,vehicle_type').eq('project_id', pid),
      supabase.from('accommodation').select('id,occupants,property,room').eq('project_id', pid),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('rate_cards').select('id,role').eq('project_id', pid).order('role'),
    ])
    setResources((resData.data||[]) as Resource[])
    setRcs((rcData.data||[]) as RateCard[])
    setPos((poData.data||[]) as PurchaseOrder[])
    // Build per-person accommodation map
    const byPerson: Record<string,{property:string;room:string}> = {}
    for (const a of (accomData.data||[]) as {id:string;property:string;room:string;occupants:unknown}[]) {
      const occupants = (a.occupants as string[]) || []
      for (const oId of occupants) {
        byPerson[oId] = { property: a.property, room: a.room }
      }
    }
    setAccomByPerson(byPerson)
    setCars((carData.data||[]) as {id:string,person_id:string,vehicle_type:string}[])
    setAccom((accomData.data||[]) as {id:string,occupants:string[],property:string,room:string}[])
    setWbsList((wbsData.data||[]) as {id:string,code:string,name:string}[])
    setRateCards((rcData.data||[]) as {id:string,role:string}[])
    setLoading(false)
  }


  async function applyBulkEdit() {
    if (!selected.size) return
    const updates: Partial<Resource> & Record<string,unknown> = {}
    if (bulkForm.mob_in)    updates.mob_in  = bulkForm.mob_in
    if (bulkForm.mob_out)   updates.mob_out = bulkForm.mob_out
    if (bulkForm.shift)     updates.shift   = bulkForm.shift as Resource['shift']
    if (bulkForm.wbs)       updates.wbs     = bulkForm.wbs
    if (bulkForm.applyLaha) updates.allow_laha = bulkForm.allow_laha
    if (bulkForm.applyMeal) updates.allow_meal = bulkForm.allow_meal
    if (bulkForm.applyFsa)  updates.allow_fsa  = bulkForm.allow_fsa
    if (!Object.keys(updates).length) { toast('No changes to apply', 'info'); return }
    const ids = [...selected]
    const { error } = await supabase.from('resources').update(updates).in('id', ids)
    if (error) { toast(error.message, 'error'); return }
    toast(`Updated ${ids.length} resources`, 'success')
    setSelected(new Set()); setBulkModal(false); load()
  }

  function openNew() { setForm({...EMPTY}); setModal('new') }
  function openEdit(r: Resource) { setForm({...r}); setModal(r) }

  async function saveInline(id: string, field: string, value: unknown) {
    const { error } = await supabase.from('resources').update({ [field]: value }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setResources(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function save() {
    if (!form.name?.trim()) return toast('Name required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      name: form.name?.trim(), role: form.role||'', category: form.category||'trades',
      shift: form.shift||'day', mob_in: form.mob_in||null, mob_out: form.mob_out||null,
      travel_days: form.travel_days||0, wbs: form.wbs||'',
      allow_laha: form.allow_laha||false, allow_fsa: form.allow_fsa||false, allow_meal: form.allow_meal||false,
      company: form.company||'', phone: form.phone||'', email: form.email||'',
      linked_po_id: form.linked_po_id||null, rate_card_id: form.rate_card_id||null, notes: form.notes||'',
    }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('resources').insert(payload)
      : await supabase.from('resources').update(payload).eq('id', (modal as Resource).id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(isNew ? 'Resource added' : 'Saved', 'success')
    setSaving(false); setModal(null); load()
  }

  async function del(r: Resource) {
    if (!confirm(`Remove ${r.name}?`)) return
    await supabase.from('resources').delete().eq('id', r.id)
    toast('Removed', 'info'); load()
  }

  async function handleImportCSV(text: string) {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) { toast('No data to import', 'error'); return }
    setImporting(true)
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
    const col = (...terms: string[]) => headers.findIndex(h => terms.some(t => h.includes(t)))
    const nameI = col('name', 'full name', 'employee')
    const roleI = col('role', 'position', 'trade', 'classification')
    const catI  = col('category', 'type', 'cat')
    const compI = col('company', 'employer', 'contractor')
    const emailI= col('email')
    const phoneI= col('phone', 'mobile')
    const mobInI= col('mob in', 'mobilisation', 'start', 'mob_in')
    const mobOutI=col('mob out', 'demob', 'end', 'mob_out')
    if (nameI < 0) { toast('Could not find Name column', 'error'); setImporting(false); return }
    let added = 0, skipped = 0
    for (const line of lines.slice(1)) {
      const cols = line.split(',').map(c2 => c2.trim().replace(/^"|"$/g, ''))
      const name = cols[nameI]?.trim()
      if (!name) continue
      // Skip if already exists by name
      if (resources.some(r => r.name.toLowerCase() === name.toLowerCase())) { skipped++; continue }
      const payload = {
        project_id: activeProject!.id,
        name,
        role: roleI >= 0 ? (cols[roleI] || '') : '',
        category: catI >= 0 ? (cols[catI] || 'trades') : 'trades',
        company: compI >= 0 ? (cols[compI] || '') : '',
        email: emailI >= 0 ? (cols[emailI] || '') : '',
        phone: phoneI >= 0 ? (cols[phoneI] || '') : '',
        mob_in: mobInI >= 0 ? (cols[mobInI] || null) : null,
        mob_out: mobOutI >= 0 ? (cols[mobOutI] || null) : null,
        status: 'active',
      }
      const { error } = await supabase.from('resources').insert(payload)
      if (!error) added++
    }
    toast(`Imported ${added} people${skipped ? ` (${skipped} already exist)` : ''}`, 'success')
    setImporting(false)
    setShowImport(false)
    setImportText('')
    load()
  }

    function exportCSV() {
    const rows = [['Name','Role','Category','Company','Shift','Mob In','Mob Out','Phone','Email','WBS','Status','LAHA','Meal','FSA']]
    filtered.forEach(r => rows.push([
      r.name, r.role||'', r.category, r.company||'', r.shift||'',
      r.mob_in||'', r.mob_out||'', r.phone||'', r.email||'', r.wbs||'',
      STATUS_STYLE[resourceStatus(r)]?.label||'',
      r.allow_laha?'Y':'', r.allow_meal?'Y':'', r.allow_fsa?'Y':'',
    ]))
    const csv = rows.map(r => r.map(c => c.includes(',') ? `"${c}"` : c).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}))
    a.download = `resources_${activeProject?.name||'project'}.csv`
    a.click()
  }

  function doSort(col: SortCol) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  const statusOrder: Record<string,number> = {onsite:0,incoming:1,upcoming:2,future:3,departed:4,unknown:5}

  let filtered = resources
    .filter(r => catFilter === 'all' || r.category === catFilter)
    .filter(r => statusFilter === 'all' || resourceStatus(r) === statusFilter)
    .filter(r => !search || [r.name,r.role,r.company||'',r.email||''].some(f => f.toLowerCase().includes(search.toLowerCase())))
    .sort((a,b) => {
      let av: unknown, bv: unknown
      if (sortCol === 'status') { av = statusOrder[resourceStatus(a)]??9; bv = statusOrder[resourceStatus(b)]??9 }
      else if (['allow_laha','allow_meal','allow_fsa'].includes(sortCol)) { av = (a as unknown as Record<string,unknown>)[sortCol]?1:0; bv = (b as unknown as Record<string,unknown>)[sortCol]?1:0 }
      else { av = ((a as unknown as Record<string,unknown>)[sortCol]||'').toString().toLowerCase(); bv = ((b as unknown as Record<string,unknown>)[sortCol]||'').toString().toLowerCase() }
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })

  const arrow = (col: SortCol) => sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''
  const Th = ({col,label,title}:{col:SortCol,label:string,title?:string}) => (
    <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>doSort(col)} title={title||label}>
      {label}<span style={{color:'var(--accent)',fontSize:'10px'}}>{arrow(col)}</span>
    </th>
  )

  const catCounts: Record<string,number> = {}
  resources.forEach(r => { catCounts[r.category] = (catCounts[r.category]||0) + 1 })

  // Heatmap calendar
  const today = new Date().toISOString().slice(0,10)
  const calStart = new Date(); calStart.setDate(calStart.getDate()-7)
  const calEnd = new Date(); calEnd.setDate(calEnd.getDate()+28)
  const calDays: string[] = []
  const d = new Date(calStart)
  while (d <= calEnd) { calDays.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1) }
  const calResources = resources.filter(r => r.mob_in || r.mob_out).sort((a,b) => (a.mob_in||'').localeCompare(b.mob_in||''))

  const subconPos = pos.filter(po => po.status !== 'cancelled')


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
    <div style={{padding:'24px',maxWidth:'100%'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px',flexWrap:'wrap',gap:'8px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Resources</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{resources.length} people on this project</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
          <button className="btn btn-sm" onClick={() => setShowImport(s => !s)}>📥 Import CSV</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Person</button>
        </div>
      </div>

      {/* Filters */}
      {showImport && (
        <div className="card" style={{marginBottom:'16px'}}>
          <div style={{fontWeight:600,fontSize:'13px',marginBottom:'6px'}}>Bulk Import from CSV</div>
          <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'8px'}}>
            Paste CSV with a header row. Recognised columns: <code>Name, Role, Category, Company, Email, Phone, Mob In, Mob Out</code>
          </p>
          <textarea className="input" rows={6} value={importText} onChange={e=>setImportText(e.target.value)}
            placeholder={'Name,Role,Category,Company\nJohn Smith,Fitter,trades,Acme Co\nJane Doe,Supervisor,management,'} style={{fontFamily:'var(--mono)',fontSize:'12px',resize:'vertical'}} />
          <div style={{display:'flex',gap:'8px',marginTop:'10px'}}>
            <button className="btn btn-primary" onClick={()=>handleImportCSV(importText)} disabled={importing||!importText.trim()}>
              {importing?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Import
            </button>
            <label className="btn" style={{cursor:'pointer'}}>
              📂 From File<input type="file" accept=".csv,.txt" style={{display:'none'}} onChange={async e=>{const f=e.target.files?.[0];if(f){const t=await f.text();setImportText(t)}}} />
            </label>
            <button className="btn" onClick={()=>{setShowImport(false);setImportText('')}}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="input" style={{maxWidth:'220px'}} placeholder="Search name, role, company..." value={search} onChange={e=>setSearch(e.target.value)} />
        {(['all',...CATEGORIES] as string[]).map(cat => (
          <button key={cat} className="btn btn-sm"
            style={{background:catFilter===cat?'var(--accent)':'',color:catFilter===cat?'#fff':''}}
            onClick={() => setCatFilter(cat)}>
            {cat==='all'?`All (${resources.length})`:`${cat.charAt(0).toUpperCase()+cat.slice(1)} (${catCounts[cat]||0})`}
          </button>
        ))}
        <select className="input" style={{width:'130px',fontSize:'12px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_STYLE).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">👤</div>
          <h3>No resources</h3>
          <p>{search||catFilter!=='all'||statusFilter!=='all' ? 'No matches.' : 'Add people to this project.'}</p>
        </div>
      ) : (
        <>
          {/* Resource table */}
          <div className="card" style={{padding:0,overflow:'auto',marginBottom:'16px'}}>
            <table style={{minWidth:'900px'}}>
              <thead>
                <tr>
                  <Th col="status" label="Status" />
                  <Th col="name" label="Name" />
                  <Th col="role" label="Role / Trade" />
                  <Th col="shift" label="Shift" />
                  <Th col="company" label="Company" />
                  <Th col="mob_in" label="Mob In" />
                  <Th col="mob_out" label="Mob Out" />
                  <th>Phone</th>
                  <th>Email</th>
                  <Th col="allow_laha" label="LAHA" title="Living Away from Home Allowance" />
                  <Th col="allow_meal" label="Meal" title="Meal Allowance" />
                  <Th col="allow_fsa" label="FSA" title="Field Service Allowance" />
                  <th>Car</th>
                  <th>Room</th>
                  <th>WBS</th>
                  <th>PO</th>
                  <th style={{width:'80px'}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const st = resourceStatus(r)
                  const ss = STATUS_STYLE[st]
                  const car = cars.find(c => c.person_id === r.id)
                  const room = accom.find(a => (a.occupants||[]).includes(r.id))
                  const po = r.linked_po_id ? pos.find(p => p.id === r.linked_po_id) : null
                  return (
                    <tr key={r.id} style={{verticalAlign:'middle'}}>
                      <td><span className="badge" style={ss}>{ss.label}</span></td>
                      <td style={{fontWeight:600,minWidth:'130px'}}>
                        <input className="res-inline" defaultValue={r.name}
                          style={{fontWeight:600,width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'13px',fontFamily:'inherit',color:'inherit',cursor:'pointer',padding:'1px 2px'}}
                          onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)';(e.target as HTMLInputElement).style.background='var(--bg3)'}}
                          onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';(e.target as HTMLInputElement).style.background='transparent';saveInline(r.id,'name',(e.target as HTMLInputElement).value.trim()||r.name)}}
                          onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}
                        />
                      </td>
                      <td style={{minWidth:'140px'}}>
                        <input className="res-inline" defaultValue={r.role||''}
                          style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'inherit',color:'var(--text2)',cursor:'pointer',padding:'1px 2px'}}
                          onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)';(e.target as HTMLInputElement).style.background='var(--bg3)'}}
                          onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';(e.target as HTMLInputElement).style.background='transparent';saveInline(r.id,'role',(e.target as HTMLInputElement).value.trim())}}
                          onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}
                        />
                      </td>
                      <td style={{fontSize:'12px',color:'var(--text3)'}}>{r.shift||'day'}</td>
                      <td style={{minWidth:'110px'}}>
                        <input defaultValue={r.company||''}
                          style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'inherit',color:'var(--text2)',cursor:'pointer',padding:'1px 2px'}}
                          placeholder="—"
                          onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)';(e.target as HTMLInputElement).style.background='var(--bg3)'}}
                          onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';(e.target as HTMLInputElement).style.background='transparent';saveInline(r.id,'company',(e.target as HTMLInputElement).value.trim())}}
                          onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}
                        />
                      </td>
                      <td><input type="date" defaultValue={r.mob_in||''}
                        style={{width:'110px',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'var(--mono)',cursor:'pointer',padding:'1px 2px'}}
                        onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)'}}
                        onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';saveInline(r.id,'mob_in',(e.target as HTMLInputElement).value||null)}}
                      /></td>
                      <td><input type="date" defaultValue={r.mob_out||''}
                        style={{width:'110px',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'var(--mono)',cursor:'pointer',padding:'1px 2px'}}
                        onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)'}}
                        onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';saveInline(r.id,'mob_out',(e.target as HTMLInputElement).value||null)}}
                      /></td>
                      <td style={{minWidth:'110px',fontSize:'11px',color:'var(--text3)'}}>{r.phone||'—'}</td>
                      <td style={{minWidth:'140px',fontSize:'11px',color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'140px'}}>{r.email||'—'}</td>
                      <td style={{textAlign:'center'}}>
                        <input type="checkbox" checked={!!r.allow_laha} style={{accentColor:'var(--mod-hr)',width:'13px',height:'13px',cursor:'pointer'}}
                          onChange={e=>saveInline(r.id,'allow_laha',e.target.checked)} />
                      </td>
                      <td style={{textAlign:'center'}}>
                        <input type="checkbox" checked={!!r.allow_meal} style={{accentColor:'var(--mod-hr)',width:'13px',height:'13px',cursor:'pointer'}}
                          onChange={e=>saveInline(r.id,'allow_meal',e.target.checked)} />
                      </td>
                      <td style={{textAlign:'center'}}>
                        <input type="checkbox" checked={!!r.allow_fsa} style={{accentColor:'var(--mod-hr)',width:'13px',height:'13px',cursor:'pointer'}}
                          onChange={e=>saveInline(r.id,'allow_fsa',e.target.checked)} />
                      </td>
                      <td style={{fontSize:'11px',whiteSpace:'nowrap'}}>
                        {r.category==='subcontractor' && (
                          r.linked_po_id
                            ? <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#d1fae5',color:'#065f46',fontWeight:700}}>{pos.find(p=>p.id===r.linked_po_id)?.po_number||'PO linked'}</span>
                            : <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#fee2e2',color:'#991b1b',fontWeight:700}}>⚠ No PO</span>
                        )}
                        {r.category!=='subcontractor' && <span style={{color:'var(--text3)'}}>—</span>}
                      </td>
                      <td style={{fontSize:'11px',color:car?'var(--mod-hr)':'var(--text3)',whiteSpace:'nowrap'}}>{car?`🚗 ${car.vehicle_type}`:'—'}</td>
                      <td style={{fontSize:'11px',color:accommodationByPerson[r.id]?'var(--mod-hr)':'var(--text3)',whiteSpace:'nowrap'}}>{accommodationByPerson[r.id]?`🏨 ${accommodationByPerson[r.id].room||accommodationByPerson[r.id].property}`:'—'}</td>
                      <td style={{fontSize:'11px',color:room?'var(--mod-hr)':'var(--text3)',whiteSpace:'nowrap'}}>{room?`🏨 ${room.property}${room.room?' '+room.room:''}`:'—'}</td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)',maxWidth:'130px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.wbs||'—'}</td>
                      <td>
                        {r.category==='subcontractor' ? (
                          po
                            ? <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#d1fae5',color:'#065f46',fontWeight:700}}>{po.po_number||'PO'}</span>
                            : <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#fee2e2',color:'#991b1b',fontWeight:700}}>⚠ No PO</span>
                        ) : null}
                      </td>
                      <td style={{whiteSpace:'nowrap'}}>
                        <button className="btn btn-sm" onClick={()=>openEdit(r)}>More</button>
                        <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>del(r)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* On-site heatmap calendar */}
          {calResources.length > 0 && (
            <div className="card" style={{marginBottom:'16px'}}>
              <div style={{fontWeight:600,fontSize:'12px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'10px'}}>On-site Calendar</div>
              {selected.size > 0 && (
                <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'8px 12px',background:'rgba(59,130,246,0.08)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:'var(--radius)',marginBottom:'10px'}}>
                  <span style={{fontSize:'12px',fontWeight:600,color:'#1d4ed8'}}>{selected.size} selected</span>
                  <button className="btn btn-sm" onClick={()=>setBulkModal(true)}>✏ Bulk Edit</button>
                  <button className="btn btn-sm" style={{color:'var(--text3)'}} onClick={()=>setSelected(new Set())}>✕ Clear</button>
                </div>
              )}
              <div style={{overflowX:'auto'}}>
                <table style={{borderCollapse:'collapse',fontSize:'10px',whiteSpace:'nowrap'}}>
                  <thead>
                    <tr>
                      <th style={{padding:'3px 8px',textAlign:'left',fontWeight:600,color:'var(--text3)',minWidth:'120px'}}>Person</th>
                      {calDays.map(day => {
                        const dow = new Date(day+'T12:00:00').getDay()
                        const isToday = day === today
                        const isWknd = dow===0||dow===6
                        return (
                          <th key={day} style={{padding:'2px 1px',textAlign:'center',fontWeight:isToday?700:400,color:isToday?'var(--accent)':isWknd?'var(--amber)':'var(--text3)',minWidth:'18px',width:'18px'}}>
                            {isToday ? '▼' : new Date(day+'T12:00:00').getDate()===1 ? new Date(day+'T12:00:00').toLocaleDateString('en-AU',{month:'short'}) : new Date(day+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric'})}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {calResources.map(r => (
                      <tr key={r.id}>
                        <td style={{padding:'2px 8px',fontWeight:500,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'120px'}}>{r.name}</td>
                        {calDays.map(day => {
                          const onsite = r.mob_in && r.mob_in<=day && (!r.mob_out||r.mob_out>=day)
                          const isToday = day===today
                          const dow = new Date(day+'T12:00:00').getDay()
                          const isWknd = dow===0||dow===6
                          return (
                            <td key={day} style={{padding:'1px',textAlign:'center'}}>
                              <div style={{
                                width:'16px',height:'14px',borderRadius:'2px',margin:'auto',
                                background: onsite ? 'var(--accent)' : isToday ? 'rgba(0,137,138,0.1)' : isWknd ? 'rgba(0,0,0,0.03)' : 'transparent',
                                border: isToday ? '1px solid var(--accent)' : '1px solid transparent',
                              }}/>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{marginTop:'8px',display:'flex',gap:'16px',fontSize:'11px',color:'var(--text3)'}}>
                <span><span style={{display:'inline-block',width:'12px',height:'10px',borderRadius:'2px',background:'var(--accent)',marginRight:'4px',verticalAlign:'middle'}}/>On-site</span>
                <span style={{color:'var(--amber)'}}>Sat/Sun shaded lighter</span>
                <span style={{color:'var(--accent)'}}>▼ = today</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{maxWidth:'700px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new' ? 'Add Person' : `Edit: ${(modal as Resource).name}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Full Name *</label>
                  <input className="input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="First Last" autoFocus />
                </div>
                <div className="fg" style={{flex:2}}>
                  <label>Role / Trade</label>
                  <input className="input" value={form.role||''} onChange={e=>setForm(f=>({...f,role:e.target.value}))} placeholder="e.g. Fitter, Project Manager" list="rc-roles" />
                  <datalist id="rc-roles">{rcs.map(rc=><option key={rc.id} value={rc.role}/>)}</datalist>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Company</label>
                  <input className="input" value={form.company||''} onChange={e=>setForm(f=>({...f,company:e.target.value}))} placeholder="Siemens Energy, Contractor name..." />
                </div>
                <div className="fg">
                  <label>Phone</label>
                  <input className="input" value={form.phone||''} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+61 4xx xxx xxx" />
                </div>
                <div className="fg">
                  <label>Email</label>
                  <input className="input" value={form.email||''} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="name@company.com" />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Category</label>
                  <select className="input" value={form.category||'trades'} onChange={e=>setForm(f=>({...f,category:e.target.value as Resource['category']}))}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Shift</label>
                  <select className="input" value={form.shift||'day'} onChange={e=>setForm(f=>({...f,shift:e.target.value as Resource['shift']}))}>
                    {SHIFTS.map(s=><option key={s} value={s}>{s==='day'?'☀️ Day':s==='night'?'🌙 Night':'☀️🌙 Both'}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Rate Card</label>
                  <select className="input" value={form.rate_card_id||''} onChange={e=>setForm(f=>({...f,rate_card_id:e.target.value||null}))}>
                    <option value="">— None —</option>
                    {rcs.map(rc=><option key={rc.id} value={rc.id}>{rc.role}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Mob In (arrive on site)</label>
                  <input type="date" className="input" value={form.mob_in||''} onChange={e=>setForm(f=>({...f,mob_in:e.target.value||null}))} />
                </div>
                <div className="fg">
                  <label>Mob Out (leave site)</label>
                  <input type="date" className="input" value={form.mob_out||''} onChange={e=>setForm(f=>({...f,mob_out:e.target.value||null}))} />
                </div>
                <div className="fg">
                  <label>Travel Days</label>
                  <input type="number" className="input" value={form.travel_days||0} min={0} max={5} step={0.5} onChange={e=>setForm(f=>({...f,travel_days:parseFloat(e.target.value)||0}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>WBS</label>
                  <select className="input" value={form.wbs||''} onChange={e=>setForm(f=>({...f,wbs:e.target.value}))}>
                    <option value="">— Select WBS —</option>
                    {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Notes</label>
                  <input className="input" value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" />
                </div>
              </div>
              {form.category==='subcontractor' && (
                <div className="fg">
                  <label>Linked PO</label>
                  <select className="input" value={form.linked_po_id||''} onChange={e=>setForm(f=>({...f,linked_po_id:e.target.value||null}))}>
                    <option value="">— No PO —</option>
                    {subconPos.map(po=><option key={po.id} value={po.id}>{po.po_number||'—'} {po.vendor}{po.description?` — ${po.description}`:''}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div style={{fontSize:'12px',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'8px'}}>Allowances</div>
                <div style={{display:'flex',gap:'20px',flexWrap:'wrap'}}>
                  {[{key:'allow_laha',label:'LAHA (Trades)'},{key:'allow_fsa',label:'FSA (Mgmt/SE AG)'},{key:'allow_meal',label:'Meal Allowance'}].map(({key,label}) => (
                    <label key={key} style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'13px'}}>
                      <input type="checkbox" checked={!!((form as Record<string,unknown>)[key])} onChange={e=>setForm(f=>({...f,[key]:e.target.checked}))} style={{accentColor:'var(--mod-hr)'}} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as Resource);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkModal && (
        <div className="modal-overlay" onClick={()=>setBulkModal(false)}>
          <div className="modal" style={{maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Bulk Edit — {selected.size} Resources</h3><button className="btn btn-sm" onClick={()=>setBulkModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>Leave fields blank to skip them. Only filled fields will be updated.</p>
              <div className="fg"><label>Mob In</label><input type="date" className="input" value={bulkForm.mob_in} onChange={e=>setBulkForm(f=>({...f,mob_in:e.target.value}))} /></div>
              <div className="fg"><label>Mob Out</label><input type="date" className="input" value={bulkForm.mob_out} onChange={e=>setBulkForm(f=>({...f,mob_out:e.target.value}))} /></div>
              <div className="fg"><label>Shift</label>
                <select className="input" value={bulkForm.shift} onChange={e=>setBulkForm(f=>({...f,shift:e.target.value}))}>
                  <option value="">— No change —</option>
                  <option value="day">Day</option><option value="night">Night</option><option value="both">Both</option>
                </select>
              </div>
              <div className="fg"><label>WBS Code</label><input className="input" value={bulkForm.wbs} onChange={e=>setBulkForm(f=>({...f,wbs:e.target.value}))} placeholder="Leave blank to skip" /></div>
              <div style={{marginTop:'8px',fontSize:'12px',fontWeight:600,color:'var(--text2)'}}>Allowances</div>
              {(['allow_laha','allow_meal','allow_fsa'] as const).map(k => {
                const applyKey = ('apply'+k.replace('allow_','').charAt(0).toUpperCase()+k.replace('allow_','').slice(1)) as 'applyLaha'|'applyMeal'|'applyFsa'
                const label = k === 'allow_laha' ? 'LAHA' : k === 'allow_meal' ? 'Meal' : 'FSA'
                return (
                  <div key={k} style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'6px'}}>
                    <input type="checkbox" checked={(bulkForm as Record<string,unknown>)[applyKey] as boolean} onChange={e=>setBulkForm(f=>({...f,[applyKey]:e.target.checked}))} />
                    <span style={{fontSize:'12px',color:'var(--text2)'}}>Update {label}:</span>
                    <label style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',cursor:'pointer'}}>
                      <input type="checkbox" checked={(bulkForm as Record<string,unknown>)[k] as boolean} disabled={!(bulkForm as Record<string,unknown>)[applyKey]} onChange={e=>setBulkForm(f=>({...f,[k]:e.target.checked}))} />
                      Enabled
                    </label>
                  </div>
                )
              })}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyBulkEdit}>Apply to {selected.size} Resources</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
