import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { HelpButton } from '../../components/HelpButton'
import type { BackOfficeHour, RateCard, WbsItem } from '../../types'

type BOForm = { name:string; role:string; date:string; hours:number; cost:number; sell:number; wbs:string; notes:string }
const EMPTY_BO: BOForm = { name:'', role:'', date:new Date().toISOString().slice(0,10), hours:0, cost:0, sell:0, wbs:'', notes:'' }

// ── SAP CSV importer types ──
interface SapRow { name: string; date: string; cost: number; hours: number; wbs: string }
interface PersonSelection { name: string; enabled: boolean; dateFrom: string; dateTo: string; minDate: string; maxDate: string }
interface ImportPreviewRow { name: string; date: string; hours: number; cost: number; wbs: string }

interface SEEntry { id:string; project_id:string; date:string; person:string; description:string; currency:string; amount:number; gm_pct:number; sell_price:number; wbs:string }
type SEForm = { date:string; person:string; description:string; currency:string; amount:number; gm_pct:number; sell_price:number; wbs:string }
const EMPTY_SE: SEForm = { date:new Date().toISOString().slice(0,10), person:'', description:'', currency:'AUD', amount:0, gm_pct:15, sell_price:0, wbs:'' }

export function BackOfficePanel() {
  const { activeProject } = useAppStore()
  const [tab, setTab] = useState<'bo'|'se'>('bo')
  const [entries, setEntries] = useState<BackOfficeHour[]>([])
  const [seEntries, setSeEntries] = useState<SEEntry[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|BackOfficeHour>(null)
  const [seModal, setSeModal] = useState<null|'new'|SEEntry>(null)
  const [form, setForm] = useState<BOForm>(EMPTY_BO)
  const [seForm, setSeForm] = useState<SEForm>(EMPTY_SE)
  const [saving, setSaving] = useState(false)
  const [seSaving, setSeSaving] = useState(false)
  const [monthFilter, setMonthFilter] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showImporter, setShowImporter] = useState(false)
  const [importPersons, setImportPersons] = useState<PersonSelection[]>([])
  const [importSapRows, setImportSapRows] = useState<SapRow[]>([])
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([])
  const [importSaving, setImportSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [boData, rcData, wbsData, seData] = await Promise.all([
      supabase.from('back_office_hours').select('*').eq('project_id', pid).order('date', {ascending:false}),
      supabase.from('rate_cards').select('*').eq('project_id', pid).in('category',['management','seag']).order('role'),
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
      supabase.from('se_support_costs').select('*').eq('project_id', pid).order('date', {ascending:false}),
    ])
    setEntries((boData.data||[]) as BackOfficeHour[])
    setRateCards((rcData.data||[]) as RateCard[])
    setWbsList((wbsData.data||[]) as WbsItem[])
    setSeEntries((seData.data||[]) as SEEntry[])
    setLoading(false)
  }

  // ── Back Office ──
  function calcRates(role: string, hours: number) {
    const rc = rateCards.find(r => r.role.toLowerCase() === role.toLowerCase())
    if (!rc) return { cost:0, sell:0 }
    const rates = rc.rates as {cost:Record<string,number>;sell:Record<string,number>}
    return { cost: parseFloat(((hours)*(rates?.cost?.dnt||0)).toFixed(2)), sell: parseFloat(((hours)*(rates?.sell?.dnt||0)).toFixed(2)) }
  }
  function updateRole(role: string) { const {cost,sell}=calcRates(role,form.hours); setForm(f=>({...f,role,cost,sell})) }
  function updateHours(hours: number) { const {cost,sell}=calcRates(form.role,hours); setForm(f=>({...f,hours,cost,sell})) }

  async function saveBo() {
    if (!form.name.trim()) return toast('Name required','error')
    setSaving(true)
    const payload = {project_id:activeProject!.id,name:form.name.trim(),role:form.role,date:form.date,hours:form.hours,cost:form.cost,sell:form.sell,wbs:form.wbs,notes:form.notes}
    const isNew = modal==='new'
    const {error} = isNew ? await supabase.from('back_office_hours').insert(payload) : await supabase.from('back_office_hours').update(payload).eq('id',(modal as BackOfficeHour).id)
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast(isNew?'Added':'Saved','success'); setSaving(false); setModal(null); load()
  }

  async function delBo(e: BackOfficeHour) {
    if (!confirm(`Delete entry for ${e.name}?`)) return
    await supabase.from('back_office_hours').delete().eq('id',e.id)
    toast('Deleted','info'); load()
  }

  // ── SE Support ──
  function updateSeAmount(amount: number) {
    const sell = parseFloat((amount / (1 - (seForm.gm_pct||15)/100)).toFixed(2))
    setSeForm(f=>({...f,amount,sell_price:sell}))
  }
  function updateSeGm(gm: number) {
    const sell = parseFloat((seForm.amount / (1 - gm/100)).toFixed(2))
    setSeForm(f=>({...f,gm_pct:gm,sell_price:sell}))
  }

  async function saveSe() {
    if (!seForm.person.trim()||!seForm.description.trim()) return toast('Person and description required','error')
    setSeSaving(true)
    const payload = {project_id:activeProject!.id,...seForm,person:seForm.person.trim(),description:seForm.description.trim()}
    const isNew = seModal==='new'
    const {error} = isNew ? await supabase.from('se_support_costs').insert(payload) : await supabase.from('se_support_costs').update(payload).eq('id',(seModal as SEEntry).id)
    if (error) { toast(error.message,'error'); setSeSaving(false); return }
    toast(isNew?'Added':'Saved','success'); setSeSaving(false); setSeModal(null); load()
  }

  async function delSe(e: SEEntry) {
    if (!confirm('Delete this SE Support entry?')) return
    await supabase.from('se_support_costs').delete().eq('id',e.id)
    toast('Deleted','info'); load()
  }

  // ── SAP CSV Importer ──
  function parseSapCsv(text: string): SapRow[] {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
    if (lines.length < 2) return []
    // Find header row
    const headerLine = lines.findIndex(l => l.includes('Document Date') || l.includes('Name'))
    if (headerLine < 0) return []
    const headers = parseCSVLine(lines[headerLine])
    const iName = headers.findIndex(h => h === 'Name')
    const iDate = headers.findIndex(h => h === 'Document Date')
    const iVal  = headers.findIndex(h => h === 'Val/COArea Crcy')
    const iQty  = headers.findIndex(h => h.trim() === 'Total quantity') // last col (col 18)
    const iWbs  = headers.findIndex(h => h === 'WBS Element')
    if (iName < 0 || iDate < 0) return []

    const rows: SapRow[] = []
    for (let i = headerLine + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const cols = parseCSVLine(line)
      const name = cols[iName]?.trim() || ''
      const dateRaw = cols[iDate]?.trim() || ''
      const valRaw = cols[iVal]?.trim().replace(/,/g, '') || '0'
      const qtyRaw = cols[iQty]?.trim() || '0'
      const wbs = cols[iWbs]?.trim() || ''

      // Skip: empty name, no date, non-person rows (no space = not "First Last"), zero hours
      if (!name || !dateRaw || !name.includes(' ')) continue
      const hours = parseFloat(qtyRaw) || 0
      const cost = parseFloat(valRaw) || 0
      if (hours <= 0 && cost <= 0) continue

      // Parse DD/MM/YYYY → YYYY-MM-DD
      const parts = dateRaw.split('/')
      if (parts.length !== 3) continue
      const date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`

      rows.push({ name, date, cost, hours, wbs })
    }
    return rows
  }

  function parseCSVLine(line: string): string[] {
    const result: string[] = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
      else { cur += ch }
    }
    result.push(cur)
    return result
  }

  function handleSapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseSapCsv(text)
      if (!rows.length) { toast('No valid person rows found in CSV','error'); return }

      // Build per-person summaries
      const byPerson: Record<string, { dates: string[]; minDate: string; maxDate: string }> = {}
      for (const r of rows) {
        if (!byPerson[r.name]) byPerson[r.name] = { dates: [], minDate: r.date, maxDate: r.date }
        byPerson[r.name].dates.push(r.date)
        if (r.date < byPerson[r.name].minDate) byPerson[r.name].minDate = r.date
        if (r.date > byPerson[r.name].maxDate) byPerson[r.name].maxDate = r.date
      }

      const persons: PersonSelection[] = Object.entries(byPerson).sort((a,b) => a[0].localeCompare(b[0])).map(([name, info]) => ({
        name,
        enabled: true,
        dateFrom: info.minDate,
        dateTo: info.maxDate,
        minDate: info.minDate,
        maxDate: info.maxDate,
      }))

      setImportSapRows(rows)
      setImportPersons(persons)
      setImportPreview([])
      setShowImporter(true)
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.readAsText(file, 'utf-8')
  }

  function updateImportPreview(persons: PersonSelection[], rows: SapRow[]) {
    // Aggregate: per person per date, sum cost and hours
    const agg: Record<string, ImportPreviewRow> = {}
    for (const p of persons) {
      if (!p.enabled) continue
      const personRows = rows.filter(r =>
        r.name === p.name && r.date >= p.dateFrom && r.date <= p.dateTo
      )
      for (const r of personRows) {
        const key = `${r.name}|${r.date}`
        if (!agg[key]) agg[key] = { name: r.name, date: r.date, hours: 0, cost: 0, wbs: r.wbs }
        agg[key].hours += r.hours
        agg[key].cost += r.cost
      }
    }
    setImportPreview(Object.values(agg).sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)))
  }

  function updatePersonSelection(idx: number, patch: Partial<PersonSelection>) {
    setImportPersons(prev => {
      const updated = prev.map((p, i) => i === idx ? { ...p, ...patch } : p)
      updateImportPreview(updated, importSapRows)
      return updated
    })
  }

  async function runImport() {
    if (!importPreview.length) return toast('Nothing selected to import','error')
    setImportSaving(true)
    const pid = activeProject!.id
    const payload = importPreview.map(r => ({
      project_id: pid,
      name: r.name,
      role: '',
      date: r.date,
      hours: parseFloat(r.hours.toFixed(2)),
      cost: parseFloat(r.cost.toFixed(2)),
      sell: 0,
      wbs: r.wbs,
      notes: 'Imported from SAP actuals CSV',
    }))
    const { error } = await supabase.from('back_office_hours').insert(payload)
    if (error) { toast(error.message, 'error'); setImportSaving(false); return }
    toast(`Imported ${payload.length} back office entries`, 'success')
    setImportSaving(false)
    setShowImporter(false)
    load()
  }

  function exportBoCsv() {
    const rows=[['Date','Name','Role','Hours','Cost','Sell','WBS']]
    entries.forEach(e=>rows.push([e.date,e.name,e.role||'',String(e.hours||0),String(e.cost||0),String(e.sell||0),e.wbs||'']))
    const csv=rows.map(r=>r.map(c=>c.includes(',')?`"${c}"`:c).join(',')).join('\n')
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='back_office.csv';a.click()
  }

  function exportSeCsv() {
    const rows=[['Date','Person','Description','Currency','Amount','GM%','Sell','WBS']]
    seEntries.forEach(e=>rows.push([e.date,e.person,e.description,e.currency,String(e.amount||0),String(e.gm_pct||0),String(e.sell_price||0),e.wbs||'']))
    const csv=rows.map(r=>r.map(c=>c.includes(',')?`"${c}"`:c).join(',')).join('\n')
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='se_support.csv';a.click()
  }

  const months=[...new Set(entries.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse()
  const filtered=entries.filter(e=>!monthFilter||e.date?.startsWith(monthFilter))
  const totalHrs=filtered.reduce((s,e)=>s+(e.hours||0),0)
  const totalCost=filtered.reduce((s,e)=>s+(e.cost||0),0)
  const totalSell=filtered.reduce((s,e)=>s+(e.sell||0),0)
  const seTotalAmt=seEntries.reduce((s,e)=>s+(e.amount||0),0)
  const seTotalSell=seEntries.reduce((s,e)=>s+(e.sell_price||0),0)
  const fmt=(n:number)=>'$'+n.toLocaleString('en-AU',{maximumFractionDigits:0})

  const byPerson = filtered.reduce((acc, e) => {
    const name = e.name || 'Unknown'
    if (!acc[name]) acc[name] = { hours: 0, cost: 0, sell: 0 }
    acc[name].hours += e.hours || 0
    acc[name].cost += e.cost || 0
    acc[name].sell += e.sell || 0
    return acc
  }, {} as Record<string, { hours: number; cost: number; sell: number }>)

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <h1 style={{fontSize:'18px',fontWeight:700,margin:0}}>Back Office & SE Support</h1>
            <HelpButton panelId="hr-backoffice" />
          </div>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {tab==='bo' ? `${entries.length} entries · ${totalHrs.toFixed(2)} hrs · Cost ${fmt(totalCost)}` : `${seEntries.length} entries · Cost ${fmt(seTotalAmt)} · Sell ${fmt(seTotalSell)}`}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={tab==='bo'?exportBoCsv:exportSeCsv}>⬇ Export CSV</button>
          {tab==='bo' && (
            <>
              <button className="btn btn-sm" style={{background:'#0891b2',color:'#fff',fontWeight:600}}
                onClick={() => fileInputRef.current?.click()}>⬆ Import SAP CSV</button>
              <input ref={fileInputRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleSapFile} />
            </>
          )}
          <button className="btn btn-primary" onClick={()=>tab==='bo'?(setForm(EMPTY_BO),setModal('new')):(setSeForm(EMPTY_SE),setSeModal('new'))}>+ Add Entry</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'6px',marginBottom:'16px'}}>
        <button className="btn btn-sm" style={{background:tab==='bo'?'var(--accent)':'',color:tab==='bo'?'#fff':''}} onClick={()=>setTab('bo')}>🏢 Back Office Hours ({entries.length})</button>
        <button className="btn btn-sm" style={{background:tab==='se'?'var(--accent)':'',color:tab==='se'?'#fff':''}} onClick={()=>setTab('se')}>✈️ SE Support Costs ({seEntries.length})</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div> : <>

      {/* ── BACK OFFICE TAB ── */}
      {tab==='bo' && <>
        <div style={{display:'flex',gap:'4px',marginBottom:'12px',flexWrap:'wrap'}}>
          <button className="btn btn-sm" style={{background:!monthFilter?'var(--accent)':'',color:!monthFilter?'#fff':''}} onClick={()=>setMonthFilter('')}>All</button>
          {months.map(m=><button key={m} className="btn btn-sm" style={{background:monthFilter===m?'var(--accent)':'',color:monthFilter===m?'#fff':''}} onClick={()=>setMonthFilter(m||'')}>{m}</button>)}
        </div>
        {filtered.length===0 ? (
          <div className="empty-state"><div className="icon">🏢</div><h3>No back office hours</h3><p>Log office-based hours for project management and support staff.</p></div>
        ) : (
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <table>
              {Object.keys(byPerson).length > 1 && (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'8px',marginBottom:'12px'}}>
                  {Object.entries(byPerson).sort((a,b)=>b[1].hours-a[1].hours).map(([name, t]) => (
                    <div key={name} className="card" style={{padding:'10px 12px',borderTop:'3px solid #0891b2'}}>
                      <div style={{fontWeight:600,fontSize:'12px',marginBottom:'4px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name}</div>
                      <div style={{fontFamily:'var(--mono)',fontSize:'13px',fontWeight:700,color:'#0891b2'}}>{t.hours.toFixed(1)}h</div>
                      {t.sell > 0 && <div style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--green)'}}>{fmt(t.sell)}</div>}
                    </div>
                  ))}
                </div>
              )}
              <thead><tr><th>Date</th><th>Name</th><th>Role</th><th style={{textAlign:'right'}}>Hours</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Sell</th><th>WBS</th><th></th></tr></thead>
              <tbody>
                {filtered.map(e=>(
                  <tr key={e.id}>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{e.date}</td>
                    <td style={{fontWeight:500}}>{e.name}</td>
                    <td style={{fontSize:'12px',color:'var(--text2)'}}>{e.role||'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{(e.hours||0).toFixed(2)}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{fmt(e.cost||0)}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{e.sell>0?fmt(e.sell):'—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{e.wbs||'—'}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={()=>{setForm({name:e.name,role:e.role,date:e.date,hours:e.hours,cost:e.cost,sell:e.sell,wbs:e.wbs,notes:e.notes});setModal(e)}}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>delBo(e)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{background:'var(--bg3)',fontWeight:600}}>
                <td colSpan={3} style={{padding:'8px 12px',fontSize:'12px'}}>Total ({filtered.length})</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',padding:'8px 12px'}}>{totalHrs.toFixed(2)}</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',padding:'8px 12px'}}>{fmt(totalCost)}</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',padding:'8px 12px',color:'var(--green)'}}>{totalSell>0?fmt(totalSell):'—'}</td>
                <td colSpan={2}/>
              </tr></tfoot>
            </table>
          </div>
        )}
      </>}

      {/* ── SE SUPPORT TAB ── */}
      {tab==='se' && <>
        <div className="card" style={{marginBottom:'12px',padding:'10px 14px',background:'#eff6ff',borderLeft:'4px solid #0284c7',fontSize:'13px'}}>
          SE Support costs are costs that SE Australia incurs to support the project — site visits, flights, mob costs for head-office personnel. These appear in the cost dashboard under SE Support.
        </div>
        {seEntries.length===0 ? (
          <div className="empty-state"><div className="icon">✈️</div><h3>No SE Support costs</h3><p>Track head-office costs like flights, accommodation and mob for SE Australia personnel visiting the site.</p></div>
        ) : (
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <table>
              <thead><tr><th>Date</th><th>Person</th><th>Description</th><th>Currency</th><th style={{textAlign:'right'}}>Amount</th><th style={{textAlign:'right'}}>GM%</th><th style={{textAlign:'right'}}>Sell</th><th>WBS</th><th></th></tr></thead>
              <tbody>
                {seEntries.map(e=>(
                  <tr key={e.id}>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{e.date}</td>
                    <td style={{fontWeight:500}}>{e.person}</td>
                    <td style={{fontSize:'12px',color:'var(--text2)'}}>{e.description}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)'}}>{e.currency}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{fmt(e.amount||0)}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{e.gm_pct||0}%</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{fmt(e.sell_price||0)}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{e.wbs||'—'}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={()=>{setSeForm({date:e.date,person:e.person,description:e.description,currency:e.currency,amount:e.amount,gm_pct:e.gm_pct,sell_price:e.sell_price,wbs:e.wbs});setSeModal(e)}}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>delSe(e)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{background:'var(--bg3)',fontWeight:600}}>
                <td colSpan={4} style={{padding:'8px 12px',fontSize:'12px'}}>Total ({seEntries.length})</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',padding:'8px 12px'}}>{fmt(seTotalAmt)}</td>
                <td/>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',padding:'8px 12px',color:'var(--green)'}}>{fmt(seTotalSell)}</td>
                <td colSpan={2}/>
              </tr></tfoot>
            </table>
          </div>
        )}
      </>}
      </>}

      {/* ── BO MODAL ── */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'500px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>{modal==='new'?'Add Back Office Hours':'Edit Entry'}</h3><button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}><label>Name</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
                <div className="fg"><label>Date</label><input type="date" className="input" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}><label>Role</label><input className="input" value={form.role} onChange={e=>updateRole(e.target.value)} list="bo-roles" /><datalist id="bo-roles">{rateCards.map(rc=><option key={rc.id} value={rc.role}/>)}</datalist></div>
                <div className="fg"><label>Hours</label><input type="number" step="0.5" min="0" className="input" value={form.hours||''} onChange={e=>updateHours(parseFloat(e.target.value)||0)} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Cost ($)</label><input type="number" className="input" value={form.cost||''} onChange={e=>setForm(f=>({...f,cost:parseFloat(e.target.value)||0}))} /></div>
                <div className="fg"><label>Sell ($)</label><input type="number" className="input" value={form.sell||''} onChange={e=>setForm(f=>({...f,sell:parseFloat(e.target.value)||0}))} /></div>
              </div>
              <div className="fg"><label>WBS</label>
                <select className="input" value={form.wbs} onChange={e=>setForm(f=>({...f,wbs:e.target.value}))}>
                  <option value="">— No WBS —</option>
                  {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
                </select>
              </div>
              <div className="fg"><label>Notes</label><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-footer">
              {modal!=='new'&&<button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{delBo(modal as BackOfficeHour);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBo} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SE MODAL ── */}
      {seModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'520px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>{seModal==='new'?'Add SE Support Cost':'Edit SE Support Cost'}</h3><button className="btn btn-sm" onClick={()=>setSeModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}><label>Person *</label><input className="input" value={seForm.person} onChange={e=>setSeForm(f=>({...f,person:e.target.value}))} placeholder="Name" autoFocus /></div>
                <div className="fg"><label>Date</label><input type="date" className="input" value={seForm.date} onChange={e=>setSeForm(f=>({...f,date:e.target.value}))} /></div>
              </div>
              <div className="fg"><label>Description *</label><input className="input" value={seForm.description} onChange={e=>setSeForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Flights BNE-GLT, Site visit 3 days" /></div>
              <div className="fg-row">
                <div className="fg"><label>Currency</label>
                  <select className="input" value={seForm.currency} onChange={e=>setSeForm(f=>({...f,currency:e.target.value}))}>
                    {['AUD','USD','EUR','GBP','NZD'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Amount</label><input type="number" className="input" value={seForm.amount||''} onChange={e=>updateSeAmount(parseFloat(e.target.value)||0)} placeholder="0" /></div>
                <div className="fg"><label>GM %</label><input type="number" className="input" value={seForm.gm_pct} onChange={e=>updateSeGm(parseFloat(e.target.value)||0)} /></div>
                <div className="fg"><label>Sell Price</label><input type="number" className="input" value={seForm.sell_price||''} onChange={e=>setSeForm(f=>({...f,sell_price:parseFloat(e.target.value)||0}))} placeholder="0" /></div>
              </div>
              <div className="fg"><label>WBS</label>
                <select className="input" value={seForm.wbs} onChange={e=>setSeForm(f=>({...f,wbs:e.target.value}))}>
                  <option value="">— No WBS —</option>
                  {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              {seModal!=='new'&&<button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{delSe(seModal as SEEntry);setSeModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setSeModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSe} disabled={seSaving}>{seSaving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
      {/* ── SAP CSV IMPORTER MODAL ── */}
      {showImporter && (
        <div className="modal-overlay" onClick={() => setShowImporter(false)}>
          <div className="modal" style={{maxWidth:'780px',maxHeight:'90vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>⬆ Import Back Office Hours from SAP CSV</h3>
              <button className="btn btn-sm" onClick={() => setShowImporter(false)}>✕</button>
            </div>

            <div style={{overflowY:'auto',flex:1}}>
              {/* Step 1 — person selection */}
              <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}>
                <div style={{fontWeight:600,fontSize:'13px',marginBottom:'12px',color:'var(--text2)'}}>
                  Step 1 — Select people and date ranges to import
                </div>
                <div style={{fontSize:'11px',color:'var(--text3)',marginBottom:'12px'}}>
                  Each person's date range defaults to their full date span in the file. Narrow it to exclude on-site periods.
                </div>
                <table style={{width:'100%',fontSize:'12px',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)'}}>
                      <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600,width:'32px'}}></th>
                      <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600}}>Person</th>
                      <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600}}>From</th>
                      <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600}}>To</th>
                      <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600}}>Rows in file</th>
                      <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600}}>In range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPersons.map((p, idx) => {
                      const allRows = importSapRows.filter(r => r.name === p.name)
                      const inRange = allRows.filter(r => r.date >= p.dateFrom && r.date <= p.dateTo)
                      const rangeHours = inRange.reduce((s,r) => s+r.hours, 0)
                      const rangeCost = inRange.reduce((s,r) => s+r.cost, 0)
                      return (
                        <tr key={p.name} style={{borderBottom:'1px solid var(--border)',background:p.enabled?'':'var(--bg3)',opacity:p.enabled?1:0.5}}>
                          <td style={{padding:'8px'}}>
                            <input type="checkbox" checked={p.enabled} onChange={e => updatePersonSelection(idx, {enabled: e.target.checked})} />
                          </td>
                          <td style={{padding:'8px',fontWeight:600}}>{p.name}</td>
                          <td style={{padding:'8px'}}>
                            <input type="date" className="input" style={{fontSize:'11px',padding:'3px 6px'}}
                              value={p.dateFrom} min={p.minDate} max={p.dateTo}
                              onChange={e => updatePersonSelection(idx, {dateFrom: e.target.value})} />
                          </td>
                          <td style={{padding:'8px'}}>
                            <input type="date" className="input" style={{fontSize:'11px',padding:'3px 6px'}}
                              value={p.dateTo} min={p.dateFrom} max={p.maxDate}
                              onChange={e => updatePersonSelection(idx, {dateTo: e.target.value})} />
                          </td>
                          <td style={{padding:'8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text3)'}}>{allRows.length}</td>
                          <td style={{padding:'8px',textAlign:'right',fontFamily:'var(--mono)'}}>
                            {p.enabled ? (
                              <span>
                                <span style={{color:'var(--accent)',fontWeight:600}}>{inRange.length}</span>
                                <span style={{color:'var(--text3)',fontSize:'10px',marginLeft:'6px'}}>{rangeHours.toFixed(1)}h · ${rangeCost.toLocaleString('en-AU',{maximumFractionDigits:0})}</span>
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Step 2 — preview */}
              <div style={{padding:'16px 20px'}}>
                <div style={{fontWeight:600,fontSize:'13px',marginBottom:'8px',color:'var(--text2)'}}>
                  Step 2 — Preview ({importPreview.length} entries to import)
                </div>
                {importPreview.length === 0 ? (
                  <div style={{color:'var(--text3)',fontSize:'12px',padding:'12px 0'}}>
                    Enable at least one person above to see the preview.
                  </div>
                ) : (
                  <div style={{maxHeight:'240px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
                    <table style={{width:'100%',fontSize:'11px',borderCollapse:'collapse'}}>
                      <thead style={{position:'sticky',top:0,background:'var(--bg3)'}}>
                        <tr>
                          <th style={{padding:'5px 8px',textAlign:'left'}}>Date</th>
                          <th style={{padding:'5px 8px',textAlign:'left'}}>Name</th>
                          <th style={{padding:'5px 8px',textAlign:'right'}}>Hours</th>
                          <th style={{padding:'5px 8px',textAlign:'right'}}>Cost (AUD)</th>
                          <th style={{padding:'5px 8px',textAlign:'left'}}>WBS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((r, i) => (
                          <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                            <td style={{padding:'4px 8px',fontFamily:'var(--mono)'}}>{r.date}</td>
                            <td style={{padding:'4px 8px',fontWeight:500}}>{r.name}</td>
                            <td style={{padding:'4px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>{r.hours.toFixed(2)}</td>
                            <td style={{padding:'4px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>${r.cost.toLocaleString('en-AU',{maximumFractionDigits:0})}</td>
                            <td style={{padding:'4px 8px',fontFamily:'var(--mono)',color:'var(--text3)',fontSize:'10px'}}>{r.wbs||'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot style={{background:'var(--bg3)',fontWeight:600}}>
                        <tr>
                          <td colSpan={2} style={{padding:'5px 8px',fontSize:'11px'}}>Total</td>
                          <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>{importPreview.reduce((s,r)=>s+r.hours,0).toFixed(2)}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>
                            ${importPreview.reduce((s,r)=>s+r.cost,0).toLocaleString('en-AU',{maximumFractionDigits:0})}
                          </td>
                          <td/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'8px'}}>
                  ℹ️ Multiple SAP rows for the same person on the same date are aggregated into one entry. Hours and costs are summed. Role and sell price can be set after import.
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{flexShrink:0}}>
              <button className="btn" onClick={() => setShowImporter(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={runImport} disabled={importSaving || importPreview.length === 0}>
                {importSaving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null}
                Import {importPreview.length} {importPreview.length === 1 ? 'entry' : 'entries'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
