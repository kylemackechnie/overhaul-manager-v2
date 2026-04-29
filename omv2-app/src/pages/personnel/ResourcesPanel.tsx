import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { findOrCreatePerson, type Person } from '../../lib/persons'
import { resolveImportRole, resolveImportShift } from '../../lib/roleAliases'
import { PersonCard, usePersonCard } from '../../components/PersonCard'
import { useAppStore } from '../../store/appStore'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import { toast } from '../../components/ui/Toast'
import type { Resource, RateCard, PurchaseOrder } from '../../types'

const CATEGORIES = ['trades','management','seag','subcontractor'] as const
const SHIFTS = ['day','night','both'] as const
const EMPTY: Partial<Resource> = {
  name:'', role:'', category:'trades', shift:'day',
  mob_in:null, mob_out:null, travel_days:0, wbs:'',
  allow_laha:false, allow_fsa:false, allow_meal:false,
  company:'', phone:'', email:'', notes:'', flights:'',
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
  const { activeProject, setActivePanel } = useAppStore()

  const RES_COL_DEFAULTS = [32, 70, 140, 110, 60, 110, 80, 80, 110, 150, 40, 40, 40, 100, 100, 120, 100, 80, 80]
  const { widths: rw, onResizeStart: rOnResize, thRef: rThRef } = useResizableColumns('resources', RES_COL_DEFAULTS)
  const totalResWidth = rw.reduce((s, w) => s + w, 0)

  const { canWrite } = usePermissions()
  const [resources, setResources] = useState<Resource[]>([])
  const [rcs, setRcs] = useState<RateCard[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [cars, setCars] = useState<{id:string,person_id:string,vehicle_type:string}[]>([])
  const [accom, setAccom] = useState<{id:string,occupants:string[],property:string,room:string}[]>([])
  const [wbsList, setWbsList] = useState<{id:string,code:string,name:string}[]>([])
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
  const [bulkForm, setBulkForm] = useState({ role:'', company:'', category:'', mob_in:'', mob_out:'', shift:'', wbs:'', allow_laha:false, allow_meal:false, allow_fsa:false, applyLaha:false, applyMeal:false, applyFsa:false })
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
    setCars((carData.data||[]) as {id:string,person_id:string,vehicle_type:string}[])
    setAccom((accomData.data||[]) as {id:string,occupants:string[],property:string,room:string}[])
    setWbsList((wbsData.data||[]) as {id:string,code:string,name:string}[])
    setRateCards((rcData.data||[]) as {id:string,role:string}[])
    setLoading(false)
  }


  async function applyBulkEdit() {
    if (!selected.size) return
    const updates: Partial<Resource> & Record<string,unknown> = {}
    if (bulkForm.role)     updates.role     = bulkForm.role
    if (bulkForm.company)  updates.company  = bulkForm.company
    if (bulkForm.category) updates.category = bulkForm.category as Resource['category']
    if (bulkForm.mob_in)   updates.mob_in   = bulkForm.mob_in
    if (bulkForm.mob_out)  updates.mob_out  = bulkForm.mob_out
    if (bulkForm.shift)    updates.shift    = bulkForm.shift as Resource['shift']
    if (bulkForm.wbs)      updates.wbs      = bulkForm.wbs
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

  async function bulkDelete() {
    if (!selected.size) return
    if (!confirm(`Delete ${selected.size} resource${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    const ids = [...selected]
    const { error } = await supabase.from('resources').delete().in('id', ids)
    if (error) { toast(error.message, 'error'); return }
    toast(`Deleted ${ids.length} resources`, 'info')
    setSelected(new Set()); load()
  }

  const { cardPerson, openCard, closeCard } = usePersonCard()
  const [personCache, setPersonCache] = useState<Record<string, Person>>({})

  async function openPersonCard(personId: string) {
    if (personCache[personId]) { openCard(personCache[personId]); return }
    const { data } = await supabase.from('persons').select('*').eq('id', personId).single()
    if (data) {
      setPersonCache(prev => ({ ...prev, [personId]: data as Person }))
      openCard(data as Person)
    }
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
    // Find or create a persistent person record
    let personId: string | null = null
    try {
      const { person } = await findOrCreatePerson({
        full_name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        company: form.company || null,
        default_category: (form.category as 'trades'|'management'|'seag'|'subcontractor') || 'trades',
        default_role: form.role || null,
      })
      personId = person.id
    } catch { /* non-critical — resource still saves */ }
    const payload = {
      project_id: activeProject!.id,
      name: form.name?.trim(), role: form.role||'', category: form.category||'trades',
      shift: form.shift||'day', mob_in: form.mob_in||null, mob_out: form.mob_out||null,
      travel_days: form.travel_days||0, wbs: form.wbs||'',
      allow_laha: form.allow_laha||false, allow_fsa: form.allow_fsa||false, allow_meal: form.allow_meal||false,
      company: form.company||'', phone: form.phone||'', email: form.email||'',
      linked_po_id: form.linked_po_id||null, rate_card_id: form.rate_card_id||null, notes: form.notes||'',
      flights: (form as Partial<Resource> & {flights?:string}).flights||'',
      person_id: personId,
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

  // RFC 4180 CSV parser — handles quoted fields with embedded newlines/commas/escaped quotes.
  // Same algorithm as the HTML app's parseCSV. Splits the entire text into rows, not line-by-line,
  // so cells containing newlines (e.g. "EHS 29/05/2025\nQUAL 29/05/2025") parse correctly.
  function parseCSV(text: string): string[][] {
    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
    const rows: string[][] = []
    let row: string[] = [], cur = '', inQuote = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      const next = text[i + 1]
      if (c === '"') {
        if (inQuote && next === '"') { cur += '"'; i++ }       // escaped quote
        else inQuote = !inQuote                                 // toggle quote mode
      } else if (c === ',' && !inQuote) {
        row.push(cur); cur = ''                                 // field separator
      } else if ((c === '\n' || (c === '\r' && next === '\n')) && !inQuote) {
        if (c === '\r') i++                                     // skip \n in \r\n
        row.push(cur); cur = ''
        rows.push(row); row = []
      } else if (c === '\r' && !inQuote) {
        row.push(cur); cur = ''
        rows.push(row); row = []
      } else {
        cur += c                                                // normal char (incl. embedded newlines in quotes)
      }
    }
    if (cur || row.length) { row.push(cur); rows.push(row) }
    return rows
  }

  // Parse date strings — handles DD/MM/YYYY, D/M/YY, and "Sun 26 Apr 26" forms → "YYYY-MM-DD"
  function parseNRGDate(s: string): string {
    if (!s || !s.trim()) return ''
    // Strip trailing notes like "(DL)" and surrounding whitespace
    const clean = s.trim().replace(/\s*\(.*?\)\s*/g, '').trim()
    // Already ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
    // DD/MM/YYYY or D/M/YY (or with hyphens)
    const slash = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
    if (slash) {
      // eslint-disable-next-line prefer-const
      let [, d, mo, y] = slash
      if (y.length === 2) y = '20' + y
      return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
    }
    // "Sun 26 Apr 26" / "26 Apr 26" / "Apr 26 26"
    const months: Record<string,string> = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'}
    const m = clean.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/) || clean.match(/([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2,4})/)
    if (!m) return ''
    const day = m[1].padStart(2,'0'), mon = months[m[2].toLowerCase()] || months[m[1].toLowerCase()], yr = m[3].length === 2 ? '20'+m[3] : m[3]
    return mon ? `${yr}-${mon}-${day}` : ''
  }

  interface ParsedResource { name:string; role:string; company:string; email:string; phone:string; mobIn:string; mobOut:string; shift:string }

  async function handleImportCSV(text: string) {
    const rows = parseCSV(text)
    if (rows.length < 2) { toast('No data to import', 'error'); return }
    setImporting(true)

    // Auto-detect format — matches HTML importResourceCSV
    const firstRowLower = rows[0].map(c => (c || '').toLowerCase().trim())
    const isStandard = firstRowLower.includes('name') || firstRowLower.includes('full name')

    const SECTION_HEADERS = ['management','day shift','night shift','subcontractor','trades','roster','overhead','day shift trades','night shift trades']
    let parsed: ParsedResource[] = []

    if (isStandard) {
      // Standard export format — row 0 is headers
      const hdr = rows[0].map(c => (c || '').toLowerCase().trim())
      const col = (...terms: string[]) => hdr.findIndex(h => terms.some(t => h.includes(t)))
      const nameI  = col('name','full name','employee')
      const roleI  = col('role','position','trade','classification')
      const compI  = col('company','employer','contractor')
      const emailI = col('email')
      const phoneI = col('phone','mobile')
      const mobInI = col('mob in','mobin','mobilisation','start')
      const mobOutI= col('mob out','mobout','demob','finish','end')
      if (nameI < 0) { toast('Could not find Name column', 'error'); setImporting(false); return }
      for (const r of rows.slice(1)) {
        const name = (r[nameI] || '').trim()
        if (!name) continue
        parsed.push({
          name,
          role:    (roleI    >= 0 ? r[roleI]    : '').trim(),
          company: (compI    >= 0 ? r[compI]    : '').trim(),
          email:   (emailI   >= 0 ? r[emailI]   : '').trim(),
          phone:   (phoneI   >= 0 ? r[phoneI]   : '').trim(),
          mobIn:   parseNRGDate(mobInI  >= 0 ? r[mobInI]  : ''),
          mobOut:  parseNRGDate(mobOutI >= 0 ? r[mobOutI] : ''),
          shift:   'day',
        })
      }
    } else {
      // NRG/multi-header format — scan first 8 rows for the data header row
      let headerRowIdx = -1
      const hdrMap: Record<string,number> = {}
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        const rowLower = rows[i].map(c => (c || '').toLowerCase().trim())
        const col2 = rowLower[2] || ''
        if (col2 === 'employee' || col2 === 'name' || rowLower.includes('employee') || (rowLower.includes('mobile') && rowLower.includes('role'))) {
          headerRowIdx = i
          rows[i].forEach((cell, j) => { hdrMap[(cell || '').toLowerCase().trim()] = j })
          break
        }
      }
      const dataStart = headerRowIdx >= 0 ? headerRowIdx + 1 : 3

      const colName   = hdrMap['employee']  ?? hdrMap['name']     ?? hdrMap['full name']           ?? 2
      const colRole   = hdrMap['role']       ?? hdrMap['position'] ?? hdrMap['job title']            ?? 1
      const colEmail  = hdrMap['email']      ?? hdrMap['email address']                               ?? 3
      const colPhone  = hdrMap['mobile']     ?? hdrMap['phone']    ?? hdrMap['mobile phone']          ?? 4
      const colMobIn  = hdrMap['mob date']   ?? hdrMap['mob in']   ?? hdrMap['mobilisation date'] ?? hdrMap['shift start date'] ?? hdrMap['start date'] ?? 18
      const colMobOut = hdrMap['finish date']?? hdrMap['mob out']  ?? hdrMap['finish'] ?? hdrMap['end date'] ?? 21

      for (let i = dataStart; i < rows.length; i++) {
        const r = rows[i]
        const name = (r[colName] || '').trim()
        const role = (r[colRole] || '').trim()
        if (!name || !role) continue
        if (SECTION_HEADERS.some(s => role.toLowerCase() === s || name.toLowerCase() === s)) continue
        const email = (r[colEmail] || '').trim()
        const phone = (r[colPhone] || '').trim().replace(/\s/g,'')
        // NRG format: skip rows with no email AND no phone (likely blank/section rows)
        if (!email && !phone) continue
        parsed.push({
          name, role, company: 'Siemens Energy', email, phone,
          mobIn:  parseNRGDate(r[colMobIn]  || ''),
          mobOut: parseNRGDate(r[colMobOut] || ''),
          shift: 'day',
        })
      }
    }

    if (!parsed.length) { toast('No valid resource rows found — check file format', 'error'); setImporting(false); return }

    let added = 0, skipped = 0, failed = 0, unmapped = 0
    let firstError: string | null = null
    const projAliases = (activeProject?.role_aliases as { from: string; to: string }[]) || []
    for (const p of parsed) {
      if (resources.some(r => r.name.toLowerCase() === p.name.toLowerCase())) { skipped++; continue }

      // Resolve raw roster role → known rate-card role + shift, mirroring the
      // HTML's resolveImportRole/resolveImportShift. After this point the
      // resource's role IS the rate-card role verbatim, so every downstream
      // lookup is a plain exact match.
      const resolvedRole = resolveImportRole(p.role, rcs, projAliases)
      const resolvedShift = resolveImportShift(p.role)
      const matchedCard = rcs.find(rc => rc.role.toLowerCase() === resolvedRole.toLowerCase())
      if (!matchedCard) unmapped++
      const category = matchedCard?.category || 'trades'

      const payload = {
        project_id: activeProject!.id,
        name: p.name,
        role: resolvedRole,
        category,
        company: p.company,
        email: p.email,
        phone: p.phone,
        mob_in: p.mobIn || null,
        mob_out: p.mobOut || null,
        shift: resolvedShift,
      }
      let personId: string | null = null
      try {
        const { person } = await findOrCreatePerson({ full_name: p.name, email: p.email||null, phone: p.phone||null, company: p.company||null, default_role: resolvedRole })
        personId = person.id
      } catch { /* non-critical */ }
      const { error } = await supabase.from('resources').insert({ ...payload, person_id: personId })
      if (!error) {
        added++
      } else {
        failed++
        if (!firstError) firstError = error.message
      }
    }
    if (failed) {
      toast(`Imported ${added}, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}${unmapped ? `, ${unmapped} unmapped roles` : ''}${firstError ? ` — ${firstError}` : ''}`, 'error')
    } else if (unmapped) {
      toast(`Imported ${added} people${skipped ? ` (${skipped} already exist)` : ''} — ⚠ ${unmapped} role${unmapped===1?'':'s'} unmapped, add a project alias under Rate Cards`, 'error')
    } else {
      toast(`Imported ${added} people${skipped ? ` (${skipped} already exist)` : ''}`, 'success')
    }
    setImporting(false); setShowImport(false); setImportText(''); load()
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

  void doSort; void arrow  // kept for future sort wiring on resizable headers

  const catCounts: Record<string,number> = {}
  resources.forEach(r => { catCounts[r.category] = (catCounts[r.category]||0) + 1 })

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
          <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('personnel')}>+ Add Person</button>
        </div>
      </div>

      {/* Filters */}
      {showImport && (
        <div className="card" style={{marginBottom:'16px'}}>
          <div style={{fontWeight:600,fontSize:'13px',marginBottom:'6px'}}>Bulk Import from CSV</div>
          <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'8px'}}>
            Paste CSV or upload file. Supports standard format (header row: <code>Name, Role, Company, Email, Phone, Mob In, Mob Out</code>) and NRG roster format (multi-row header with Employee/Mobile/Role columns).
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
          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'8px 12px',background:'rgba(15,118,110,.08)',border:'1px solid rgba(15,118,110,.2)',borderRadius:'6px',marginBottom:'10px',flexWrap:'wrap'}}>
              <span style={{fontSize:'12px',fontWeight:600,color:'var(--mod-hr)'}}>{selected.size} selected</span>
              <button className="btn btn-sm" onClick={()=>{setBulkForm({role:'',company:'',category:'',mob_in:'',mob_out:'',shift:'',wbs:'',allow_laha:false,allow_meal:false,allow_fsa:false,applyLaha:false,applyMeal:false,applyFsa:false});setBulkModal(true)}}>✏ Edit Role/Shift</button>
              <button className="btn btn-sm" style={{color:'var(--red)',borderColor:'var(--red)'}} onClick={bulkDelete}>🗑 Delete Selected</button>
              <button className="btn btn-sm" style={{color:'var(--text3)'}} onClick={()=>setSelected(new Set())}>✕ Clear</button>
            </div>
          )}
          {/* Resource table — scrollbar mirrored to top */}
          <div className="card" style={{padding:0,marginBottom:'16px'}}>
            <div style={{overflowX:'auto'}} onScroll={e => {
              const el = e.currentTarget
              const mirror = el.parentElement?.querySelector('.scroll-mirror') as HTMLElement | null
              if (mirror) mirror.scrollLeft = el.scrollLeft
            }}>
              <div className="scroll-mirror" style={{overflowX:'auto',height:'12px',marginBottom:'-12px'}}
                onScroll={e => {
                  const mirror = e.currentTarget
                  const table = mirror.parentElement?.querySelector('div:not(.scroll-mirror)') as HTMLElement | null
                  if (table) table.scrollLeft = mirror.scrollLeft
                }}>
                <div style={{width: totalResWidth + 'px', height:'1px'}} />
              </div>
              <table style={{tableLayout:'fixed', width: totalResWidth + 'px'}}>
              <thead>
                <tr>
                  <th ref={el=>rThRef(el,0)} className="resizable" style={{width:rw[0],textAlign:'center',padding:'8px 6px'}}>
                    <input type="checkbox"
                      style={{accentColor:'var(--mod-hr)',cursor:'pointer'}}
                      checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))}
                      ref={el => { if (el) el.indeterminate = selected.size > 0 && !filtered.every(r => selected.has(r.id)) }}
                      onChange={e => {
                        if (e.target.checked) setSelected(new Set(filtered.map(r => r.id)))
                        else setSelected(new Set())
                      }}
                    />
                    <div className="col-resizer" {...rOnResize(0)} />
                  </th>
                  {[['Status','status'],['Name','name'],['Role / Trade','role'],['Shift','shift'],['Company','company'],['Mob In','mob_in'],['Mob Out','mob_out'],['Phone','phone'],['Email','email'],['LAHA','laha'],['Meal','meal'],['FSA','fsa'],['Car','car'],['Flights','flights'],['Room','room'],['WBS','wbs'],['PO','po'],['','actions']].map(([label], i) => (
                    <th key={i+1} ref={el=>rThRef(el,i+1)} className="resizable" style={{width:rw[i+1]}}>
                      {label}
                      <div className="col-resizer" {...rOnResize(i+1)} />
                    </th>
                  ))}
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
                    <tr key={r.id} style={{verticalAlign:'middle',background:selected.has(r.id)?'rgba(15,118,110,.05)':undefined}}>
                      <td style={{textAlign:'center',padding:'5px 6px'}}>
                        <input type="checkbox" checked={selected.has(r.id)} style={{accentColor:'var(--mod-hr)',cursor:'pointer'}}
                          onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(r.id) : next.delete(r.id); return next })} />
                      </td>
                      <td><span className="badge" style={ss}>{ss.label}</span></td>
                      <td style={{fontWeight:600,minWidth:'130px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <input className="res-inline" defaultValue={r.name}
                            style={{fontWeight:600,flex:1,background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'13px',fontFamily:'inherit',color:'inherit',cursor:'pointer',padding:'1px 2px'}}
                            onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)';(e.target as HTMLInputElement).style.background='var(--bg3)'}}
                            onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';(e.target as HTMLInputElement).style.background='transparent';saveInline(r.id,'name',(e.target as HTMLInputElement).value.trim()||r.name)}}
                            onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}
                          />
                          {((r as unknown as {person_id?:string}).person_id) && (
                            <button title="View person profile" onClick={() => openPersonCard((r as unknown as {person_id:string}).person_id)}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontSize:'12px',padding:'0 2px',flexShrink:0,opacity:0.7}}>
                              👤
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{minWidth:'140px'}}>
                        {(() => {
                          const isInRc = rcs.some(rc => rc.role === r.role)
                          const colour = !r.role ? 'var(--text3)' : isInRc ? 'var(--text2)' : 'var(--red)'
                          return (
                            <select
                              defaultValue={r.role||''}
                              title={!isInRc && r.role ? `"${r.role}" is not in the current rate cards — pick one or update Rate Cards.` : ''}
                              style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'inherit',color:colour,cursor:'pointer',padding:'1px 2px',appearance:'none'}}
                              onFocus={e=>{(e.target as HTMLSelectElement).style.borderBottomColor='var(--accent)';(e.target as HTMLSelectElement).style.background='var(--bg3)'}}
                              onBlur={e=>{(e.target as HTMLSelectElement).style.borderBottomColor='transparent';(e.target as HTMLSelectElement).style.background='transparent'}}
                              onChange={e=>saveInline(r.id,'role',(e.target as HTMLSelectElement).value)}
                            >
                              <option value="">— select role —</option>
                              {r.role && !isInRc && (
                                <option value={r.role}>{r.role} (not in rate cards)</option>
                              )}
                              {rcs.map(rc => <option key={rc.id} value={rc.role}>{rc.role}</option>)}
                            </select>
                          )
                        })()}
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
                      <td style={{fontSize:'11px',color:car?'var(--mod-hr)':'var(--text3)',whiteSpace:'nowrap',cursor:car?'pointer':undefined}} onClick={car?()=>setActivePanel('hr-cars'):undefined} title={car?'View in Car Hire':undefined}>{car?`🚗 ${car.vehicle_type}`:'—'}</td>
                      <td style={{fontSize:'11px',color:'var(--text2)',whiteSpace:'nowrap',maxWidth:'140px',overflow:'hidden',textOverflow:'ellipsis'}} title={r.flights||undefined}>{r.flights||'—'}</td>
                      <td style={{fontSize:'11px',color:room?'var(--mod-hr)':'var(--text3)',whiteSpace:'nowrap',cursor:room?'pointer':undefined}} onClick={room?()=>setActivePanel('hr-accommodation'):undefined} title={room?'View in Accommodation':undefined}>{room?`🏨 ${room.property}${room.room?' '+room.room:''}`:'—'}</td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)',maxWidth:'130px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.wbs||'—'}</td>
                      <td>
                        {r.category==='subcontractor' ? (
                          po
                            ? <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#d1fae5',color:'#065f46',fontWeight:700}}>{po.po_number||'PO'}</span>
                            : <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#fee2e2',color:'#991b1b',fontWeight:700}}>⚠ No PO</span>
                        ) : <span style={{color:'var(--text3)'}}>—</span>}
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
        <div className="modal-overlay">
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
                  {rcs.length === 0 ? (
                    <div style={{ fontSize:'12px', color:'var(--amber)', padding:'8px 10px', background:'var(--bg3)', borderRadius:'6px' }}>
                      No rate cards yet — set them up under <strong>Rate Cards</strong> first, then assign roles here.
                    </div>
                  ) : (
                    <select className="input" value={form.role||''} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                      <option value="">— select role —</option>
                      {/* If the resource has a legacy role not in the current rate-card list,
                          show it at the top so we don't silently lose the value on save. */}
                      {form.role && !rcs.some(rc => rc.role === form.role) && (
                        <option value={form.role}>{form.role} (not in rate cards)</option>
                      )}
                      {rcs.map(rc => <option key={rc.id} value={rc.role}>{rc.role}</option>)}
                    </select>
                  )}
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
                <div className="fg">
                  <label>✈️ Flights</label>
                  <input className="input" value={(form as Partial<Resource> & {flights?:string}).flights||''} onChange={e=>setForm(f=>({...f,flights:e.target.value}))} placeholder="e.g. QF510 BNE→SYD 18/05 09:30" />
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
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'460px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Bulk Edit Resources</h3><button className="btn btn-sm" onClick={()=>setBulkModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>Editing {selected.size} resource{selected.size > 1 ? 's' : ''}. Leave a field blank / at "Keep existing" to leave it unchanged.</p>
              <div className="fg">
                <label>Role (set for all selected)</label>
                <select className="input" value={bulkForm.role} onChange={e=>setBulkForm(f=>({...f,role:e.target.value}))}>
                  <option value="">— Keep existing —</option>
                  {rcs.map(rc=><option key={rc.id} value={rc.role}>{rc.role}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Shift Pattern (set for all selected)</label>
                <select className="input" value={bulkForm.shift} onChange={e=>setBulkForm(f=>({...f,shift:e.target.value}))}>
                  <option value="">— Keep existing —</option>
                  <option value="day">☀️ Day Shift</option>
                  <option value="night">🌙 Night Shift</option>
                  <option value="both">☀️🌙 Both</option>
                </select>
              </div>
              <div className="fg">
                <label>Company (set for all selected)</label>
                <input className="input" value={bulkForm.company} onChange={e=>setBulkForm(f=>({...f,company:e.target.value}))} placeholder="— Keep existing —" />
              </div>
              <div className="fg">
                <label>Employee Type (set for all selected)</label>
                <select className="input" value={bulkForm.category} onChange={e=>setBulkForm(f=>({...f,category:e.target.value}))}>
                  <option value="">— Keep existing —</option>
                  <option value="trades">Trades</option>
                  <option value="management">Management</option>
                  <option value="seag">SE AG</option>
                  <option value="subcontractor">Subcontractor</option>
                </select>
              </div>
              <div className="fg">
                <label>Mob In Date (set for all selected)</label>
                <input type="date" className="input" value={bulkForm.mob_in} onChange={e=>setBulkForm(f=>({...f,mob_in:e.target.value}))} />
              </div>
              <div className="fg">
                <label>Mob Out Date (set for all selected)</label>
                <input type="date" className="input" value={bulkForm.mob_out} onChange={e=>setBulkForm(f=>({...f,mob_out:e.target.value}))} />
              </div>
              <div className="fg">
                <label>WBS Code (set for all selected)</label>
                <select className="input" value={bulkForm.wbs} onChange={e=>setBulkForm(f=>({...f,wbs:e.target.value}))}>
                  <option value="">— Select WBS —</option>
                  {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?` — ${w.name}`:''}</option>)}
                </select>
              </div>
              <div style={{marginTop:'8px',fontSize:'12px',fontWeight:600,color:'var(--text2)',marginBottom:'6px'}}>Allowances</div>
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
              <button className="btn btn-primary" style={{background:'var(--mod-hr)',border:'none'}} onClick={applyBulkEdit}>Apply to Selected</button>
            </div>
          </div>
        </div>
      )}

      {cardPerson && <PersonCard person={cardPerson} onClose={closeCard} />}
    </div>
  )
}