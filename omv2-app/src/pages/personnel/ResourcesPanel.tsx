import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { resolveShift, hasMixedShifts, validatePhases, SHIFT_LABELS } from '../../lib/shiftPhases'
import type { ShiftPhase } from '../../types'
import { findOrCreatePerson, type Person } from '../../lib/persons'
import { resolveImportRole, resolveImportShift } from '../../lib/roleAliases'
import { PersonCard, usePersonCard } from '../../components/PersonCard'
import { useAppStore } from '../../store/appStore'
import { useResizableColumns, wasResizeDrag } from '../../hooks/useResizableColumns'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import { toast } from '../../components/ui/Toast'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ResourcesMobile } from '../mobile/ResourcesMobile'
import { ResourceCalendar } from './ResourceCalendar'
import type { Resource, RateCard, PurchaseOrder } from '../../types'

// ── Column registry ───────────────────────────────────────────────────────────
// All resizable columns except col-0 (checkbox) which is always visible.
// id must be stable — it's the key used in col_widths_v2 and hidden_cols.resources.
const RES_COLS = [
  { id: 'status',    label: 'Status',       default: 70,  group: 'Identity' },
  { id: 'name',      label: 'Name',         default: 140, group: 'Identity' },
  { id: 'role',           label: 'Role / Trade', default: 110, group: 'Identity' },
  { id: 'specialisation', label: 'Area',         default: 100, group: 'Identity' },
  { id: 'category',       label: 'Category',     default: 100, group: 'Identity' },
  { id: 'shift',     label: 'Shift',        default: 60,  group: 'Identity' },
  { id: 'company',   label: 'Company',      default: 110, group: 'Identity' },
  { id: 'mob_in',    label: 'Mob In',       default: 80,  group: 'Mob' },
  { id: 'mob_out',   label: 'Mob Out',      default: 80,  group: 'Mob' },
  { id: 'phone',     label: 'Phone',        default: 110, group: 'Contact' },
  { id: 'email',     label: 'Email',        default: 150, group: 'Contact' },
  { id: 'laha',      label: 'LAHA',         default: 40,  group: 'Allowances' },
  { id: 'meal',      label: 'Meal',         default: 40,  group: 'Allowances' },
  { id: 'fsa',       label: 'FSA',          default: 40,  group: 'Allowances' },
  { id: 'car',       label: 'Car',          default: 100, group: 'Logistics' },
  { id: 'flights',   label: 'Flights',      default: 100, group: 'Logistics' },
  { id: 'room',      label: 'Room',         default: 120, group: 'Logistics' },
  { id: 'wbs',       label: 'WBS',          default: 100, group: 'Assignment' },
  { id: 'po',        label: 'PO',           default: 80,  group: 'Assignment' },
] as const

type ResColId = typeof RES_COLS[number]['id']
const RES_COL_GROUPS = ['Identity', 'Mob', 'Contact', 'Allowances', 'Logistics', 'Assignment'] as const

const CATEGORIES = ['trades','management','seag','subcontractor'] as const
const SHIFTS = ['day','night','both'] as const
const EMPTY: Partial<Resource> = {
  name:'', role:'', category:'trades', shift:'day', shift_phases: null, specialisation: null,
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

type SortCol = 'status'|'name'|'role'|'category'|'shift'|'company'|'mob_in'|'mob_out'|'allow_laha'|'allow_meal'|'allow_fsa'

export function ResourcesPanel() {
  const { activeProject, setActivePanel } = useAppStore()

  const { prefs, setPref } = useUserPrefs()
  const [showColPicker, setShowColPicker] = useState(false)

  // Column visibility — stored as hidden_cols.resources (set of hidden col IDs)
  // Registry-merge: unknown stored IDs are ignored; new cols default visible
  const storedHidden = new Set<string>((prefs.hidden_cols as Record<string, string[]> | undefined)?.['resources'] ?? [])
  const hiddenCols = new Set(storedHidden)
  function setHiddenCols(next: Set<string>) {
    const existing = (prefs.hidden_cols as Record<string, string[]> | undefined) ?? {}
    setPref('hidden_cols', { ...existing, resources: Array.from(next) })
  }
  function isVisible(id: ResColId) { return !hiddenCols.has(id) }

  // Col widths via ID-keyed hook
  const { widths: rw, onResizeStart: rOnResize, thRef: rThRef } =
    useResizableColumns('resources', RES_COLS.map(c => ({ id: c.id, default: c.default })))

  // Total width = pinned col (102px: checkbox + More + ⧉ + ✕) + sum of visible column widths
  const totalResWidth = 102 + RES_COLS.reduce((s, c, i) => s + (isVisible(c.id) ? rw[i] : 0), 0)

  const { canWrite } = usePermissions()
  const isMobile = useIsMobile()
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
  const [sortCol, setSortCol] = useState<SortCol>((prefs.res_sort_col as SortCol | undefined) ?? 'name')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkForm, setBulkForm] = useState({ role:'', company:'', category:'', mob_in:'', mob_out:'', shift:'', wbs:'', specialisation:'', allow_laha:false, allow_meal:false, allow_fsa:false, applyLaha:false, applyMeal:false, applyFsa:false })
  const [sortAsc, setSortAsc] = useState(prefs.res_sort_asc ?? true)

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
    if (bulkForm.specialisation) updates.specialisation = bulkForm.specialisation
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
      shift: form.shift||'day', shift_phases: form.shift_phases||null, specialisation: form.specialisation||null, mob_in: form.mob_in||null, mob_out: form.mob_out||null,
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

  async function duplicateResource(r: Resource) {
    const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = r as Resource & { created_at?: string; updated_at?: string }
    const payload = { ...rest, name: r.name + ' (copy)', project_id: activeProject!.id }
    const { error } = await supabase.from('resources').insert(payload)
    if (error) { toast(error.message, 'error'); return }
    toast(`Duplicated ${r.name}`, 'success'); load()
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
    if (sortCol === col) {
      const next = !sortAsc
      setSortAsc(next)
      setPref('res_sort_asc', next)
    } else {
      setSortCol(col)
      setSortAsc(true)
      setPref('res_sort_col', col)
      setPref('res_sort_asc', true)
    }
  }

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
  void doSort; void arrow  // kept for future sort wiring on resizable headers

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
    <div style={isMobile ? {padding:0,maxWidth:'100%'} : {padding:'24px',maxWidth:'100%'}}>
    {isMobile ? (
      <ResourcesMobile
        resources={resources}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        catFilter={catFilter}
        onCatFilterChange={setCatFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onAddNew={openNew}
        onEdit={openEdit}
        canWrite={canWrite('personnel')}
      />
    ) : (<>
    <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px',flexWrap:'wrap'}}>
        {/* Title block */}
        <div style={{display:'flex',flexDirection:'column',gap:'1px',flexShrink:0}}>
          <span style={{fontSize:'14px',fontWeight:600,color:'var(--text)',whiteSpace:'nowrap'}}>Resources</span>
          <span style={{fontSize:'11px',color:'var(--text3)',whiteSpace:'nowrap'}}>{resources.length} people</span>
        </div>

        <div style={{width:'0.5px',height:'28px',background:'var(--border)',flexShrink:0}} />

        {/* Search */}
        <div style={{position:'relative',flex:'0 0 180px'}}>
          <span style={{position:'absolute',left:'7px',top:'50%',transform:'translateY(-50%)',fontSize:'13px',color:'var(--text3)',pointerEvents:'none'}}>⌕</span>
          <input className="input" style={{width:'100%',paddingLeft:'24px',height:'28px',fontSize:'12px'}}
            placeholder="Search name, role, company…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>

        {/* Category pills */}
        <div style={{display:'flex',gap:'4px',alignItems:'center',flexWrap:'wrap'}}>
          {(['all',...CATEGORIES] as string[]).map(cat => {
            const label = cat === 'all' ? 'All' : cat === 'management' ? 'Mgmt' : cat === 'subcontractor' ? 'Subcon' : cat === 'seag' ? 'SE AG' : cat.charAt(0).toUpperCase()+cat.slice(1)
            const count = cat === 'all' ? resources.length : catCounts[cat] || 0
            const active = catFilter === cat
            return (
              <button key={cat} onClick={() => setCatFilter(cat)}
                style={{padding:'3px 8px',fontSize:'11px',borderRadius:'20px',border:`0.5px solid ${active?'var(--accent)':'var(--border)'}`,background:active?'var(--accent)':'transparent',color:active?'#fff':'var(--text2)',cursor:'pointer',whiteSpace:'nowrap',lineHeight:'1.4'}}>
                {label} <span style={{opacity:0.75}}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Status filter */}
        <select className="input" style={{height:'28px',fontSize:'11px',padding:'2px 6px',width:'auto'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_STYLE).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <div style={{flex:1}} />

        {/* Actions */}
        <div style={{display:'flex',gap:'4px',alignItems:'center',flexShrink:0}}>
          <button className="btn btn-sm" onClick={exportCSV} title="Export CSV" style={{height:'28px',padding:'0 8px'}}>
            <span style={{fontSize:'13px'}}>↓</span>
          </button>
          <button className="btn btn-sm" onClick={() => setShowImport(s => !s)} title="Import CSV" style={{height:'28px',padding:'0 8px'}}>
            <span style={{fontSize:'13px'}}>↑</span>
          </button>
          <button className="btn btn-sm" onClick={() => setShowColPicker(true)} title={`Column visibility${hiddenCols.size > 0 ? ` (${hiddenCols.size} hidden)` : ''}`} style={{height:'28px',padding:'0 8px',position:'relative'}}>
            <span style={{fontSize:'13px'}}>⊞</span>
            {hiddenCols.size > 0 && <span style={{position:'absolute',top:'-4px',right:'-4px',background:'var(--accent)',color:'#fff',borderRadius:'50%',width:'14px',height:'14px',fontSize:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700}}>{hiddenCols.size}</span>}
          </button>
          <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('personnel')} style={{height:'28px',padding:'0 10px',fontSize:'12px'}}>+ Add person</button>
        </div>
      </div>

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

      {loading ? (<div className="loading-center"><span className="spinner"/> Loading...</div>)
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
              <button className="btn btn-sm" onClick={()=>{setBulkForm({role:'',company:'',category:'',mob_in:'',mob_out:'',shift:'',wbs:'',specialisation:'',allow_laha:false,allow_meal:false,allow_fsa:false,applyLaha:false,applyMeal:false,applyFsa:false});setBulkModal(true)}}>✏ Edit Role/Shift</button>
              <button className="btn btn-sm" style={{color:'var(--red)',borderColor:'var(--red)'}} onClick={bulkDelete}>🗑 Delete Selected</button>
              <button className="btn btn-sm" style={{color:'var(--text3)'}} onClick={()=>setSelected(new Set())}>✕ Clear</button>
            </div>
          )}
          {/* Resource table — scrollbar mirrored to top */}
          {(() => {
            const unlinked = filtered.filter(r => r.category === 'subcontractor' && !r.linked_po_id)
            return unlinked.length > 0 ? (
              <div style={{marginBottom:'8px',padding:'7px 12px',background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:'var(--radius)',fontSize:'11px',display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{color:'#c2410c',fontWeight:600}}>⚠ {unlinked.length} subcontractor{unlinked.length>1?'s':''} with no linked PO</span>
                <span style={{color:'var(--text3)'}}>— forecast will use flat spread instead of mob dates. Set PO in the PO column below.</span>
              </div>
            ) : null
          })()}
          <div className="card" style={{padding:0,marginBottom:'16px'}}>
            <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 280px)'}} onScroll={e => {
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
                  <th ref={el=>rThRef(el,0)} className="resizable" style={{width:'102px',textAlign:'left',padding:'8px 6px',whiteSpace:'nowrap',position:'sticky',left:0,top:0,zIndex:4,background:'var(--bg2)',borderRight:'1px solid var(--border)'}}>
                    <input type="checkbox"
                      style={{accentColor:'var(--mod-hr)',cursor:'pointer'}}
                      checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))}
                      ref={el => { if (el) el.indeterminate = selected.size > 0 && !filtered.every(r => selected.has(r.id)) }}
                      onChange={e => {
                        if (e.target.checked) setSelected(new Set(filtered.map(r => r.id)))
                        else setSelected(new Set())
                      }}
                    />
                  </th>
                  {RES_COLS.map((col, i) => {
                    if (!isVisible(col.id)) return null
                    const sortKey = col.id === 'status' ? 'status'
                      : col.id === 'name' ? 'name'
                      : col.id === 'role' ? 'role'
                      : col.id === 'category' ? 'category'
                      : col.id === 'mob_in' ? 'mob_in'
                      : col.id === 'mob_out' ? 'mob_out'
                      : col.id === 'company' ? 'company'
                      : col.id === 'wbs' ? 'wbs'
                      : col.id === 'shift' ? 'shift'
                      : null
                    return (
                      <th key={col.id} ref={el=>rThRef(el,i)} className="resizable"
                        style={{width:rw[i], cursor: sortKey ? 'pointer' : undefined, userSelect:'none', position:'sticky', top:0, zIndex:10, background:'var(--bg2)'}}
                        onClick={sortKey ? () => { if (!wasResizeDrag()) doSort(sortKey as SortCol) } : undefined}>
                        {col.label}{sortKey ? <span style={{color:'var(--accent)',fontSize:'10px',marginLeft:'2px'}}>{arrow(sortKey as SortCol)}</span> : null}
                        <div className="col-resizer" {...rOnResize(i)} />
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const st = resourceStatus(r)
                  const ss = STATUS_STYLE[st]
                  const car = cars.find(c => c.person_id === r.id)
                  const room = accom.find(a => (a.occupants||[]).includes(r.id))
                  return (
                    <tr key={r.id} style={{verticalAlign:'middle',background:selected.has(r.id)?'rgba(15,118,110,.05)':undefined}}>
                      {/* Pinned left col — checkbox + edit + duplicate + delete */}
                      <td style={{padding:'5px 6px',whiteSpace:'nowrap',position:'sticky',left:0,zIndex:2,background:selected.has(r.id)?'rgba(15,118,110,.05)':'var(--bg)',borderRight:'1px solid var(--border)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                          <input type="checkbox" checked={selected.has(r.id)} style={{accentColor:'var(--mod-hr)',cursor:'pointer'}}
                            onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(r.id) : next.delete(r.id); return next })} />
                          <button className="btn btn-sm" onClick={()=>openEdit(r)} style={{padding:'1px 6px',fontSize:'11px'}}>More</button>
                          <button className="btn btn-sm" title="Duplicate" style={{padding:'1px 4px',fontSize:'11px'}} onClick={()=>duplicateResource(r)}>⧉</button>
                          <button className="btn btn-sm" style={{color:'var(--red)',padding:'1px 4px',fontSize:'11px'}} onClick={()=>del(r)}>✕</button>
                        </div>
                      </td>
                      {/* Visibility-gated cells — rendered in RES_COLS order */}
                      {isVisible('status') && <td><span className="badge" style={ss}>{ss.label}</span></td>}
                      {isVisible('name') && <td style={{fontWeight:600}}>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          {((r as unknown as {person_id?:string}).person_id) && (
                            <button title="View person profile" onClick={() => openPersonCard((r as unknown as {person_id:string}).person_id)}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontSize:'12px',padding:'0 2px',flexShrink:0,opacity:0.7}}>👤</button>
                          )}
                          <input className="res-inline" defaultValue={r.name}
                            style={{fontWeight:600,flex:1,minWidth:0,background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'13px',fontFamily:'inherit',color:'inherit',cursor:'pointer',padding:'1px 2px'}}
                            onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)';(e.target as HTMLInputElement).style.background='var(--bg3)'}}
                            onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';(e.target as HTMLInputElement).style.background='transparent';saveInline(r.id,'name',(e.target as HTMLInputElement).value.trim()||r.name)}}
                            onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}
                          />
                          {r.notes && <span title={r.notes} style={{flexShrink:0,cursor:'default',fontSize:'11px',lineHeight:1,opacity:0.75}}>🚩</span>}
                        </div>
                      </td>}
                      {isVisible('role') && <td style={{minWidth:'140px'}}>
                        {(() => {
                          const isInRc = rcs.some(rc => rc.role === r.role)
                          const colour = !r.role ? 'var(--text3)' : isInRc ? 'var(--text2)' : 'var(--red)'
                          return (
                            <select defaultValue={r.role||''} title={!isInRc && r.role ? `"${r.role}" not in rate cards` : ''}
                              style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'inherit',color:colour,cursor:'pointer',padding:'1px 2px',appearance:'none'}}
                              onFocus={e=>{(e.target as HTMLSelectElement).style.borderBottomColor='var(--accent)';(e.target as HTMLSelectElement).style.background='var(--bg3)'}}
                              onBlur={e=>{(e.target as HTMLSelectElement).style.borderBottomColor='transparent';(e.target as HTMLSelectElement).style.background='transparent'}}
                              onChange={e=>saveInline(r.id,'role',(e.target as HTMLSelectElement).value)}>
                              <option value="">— select role —</option>
                              {r.role && !isInRc && <option value={r.role}>{r.role} (not in rate cards)</option>}
                              {rcs.map(rc => <option key={rc.id} value={rc.role}>{rc.role}</option>)}
                            </select>
                          )
                        })()}
                      </td>}
                      {isVisible('specialisation') && <td style={{fontSize:'12px',color:'var(--text3)'}}>{r.specialisation||'—'}</td>}
                      {isVisible('category') && <td>
                        <select defaultValue={r.category||'trades'}
                          style={{background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'inherit',color:'var(--text2)',cursor:'pointer',padding:'1px 2px',appearance:'none'}}
                          onFocus={e=>{(e.target as HTMLSelectElement).style.borderBottomColor='var(--accent)';(e.target as HTMLSelectElement).style.background='var(--bg3)'}}
                          onBlur={e=>{(e.target as HTMLSelectElement).style.borderBottomColor='transparent';(e.target as HTMLSelectElement).style.background='transparent'}}
                          onChange={e=>saveInline(r.id,'category',(e.target as HTMLSelectElement).value)}>
                          {CATEGORIES.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
                        </select>
                      </td>}
                      {isVisible('shift') && (() => {
                        const today = new Date().toISOString().slice(0, 10)
                        const resolved = resolveShift(r, today)
                        const mixed = hasMixedShifts(r)
                        return (
                          <td style={{ fontSize: '12px', color: 'var(--text3)' }}>
                            {SHIFT_LABELS[resolved]}
                            {mixed && <span title="Multi-phase shift schedule" style={{ marginLeft: '3px', fontSize: '9px', color: 'var(--accent)', fontWeight: 700 }}>~</span>}
                          </td>
                        )
                      })()}
                      {isVisible('company') && <td style={{overflow:'hidden'}}>
                        <input defaultValue={r.company||''} placeholder="—"
                          style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'inherit',color:'var(--text2)',cursor:'pointer',padding:'1px 2px'}}
                          onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)';(e.target as HTMLInputElement).style.background='var(--bg3)'}}
                          onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';(e.target as HTMLInputElement).style.background='transparent';saveInline(r.id,'company',(e.target as HTMLInputElement).value.trim())}}
                          onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}
                        />
                      </td>}
                      {isVisible('mob_in') && <td style={{overflow:'hidden'}}>
                        <input type="date" defaultValue={r.mob_in||''}
                          style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'var(--mono)',cursor:'pointer',padding:'1px 2px'}}
                          onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)'}}
                          onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';saveInline(r.id,'mob_in',(e.target as HTMLInputElement).value||null)}}
                        />
                      </td>}
                      {isVisible('mob_out') && <td style={{overflow:'hidden'}}>
                        <input type="date" defaultValue={r.mob_out||''}
                          style={{width:'100%',background:'transparent',border:'none',borderBottom:'1px solid transparent',fontSize:'12px',fontFamily:'var(--mono)',cursor:'pointer',padding:'1px 2px'}}
                          onFocus={e=>{(e.target as HTMLInputElement).style.borderBottomColor='var(--accent)'}}
                          onBlur={e=>{(e.target as HTMLInputElement).style.borderBottomColor='transparent';saveInline(r.id,'mob_out',(e.target as HTMLInputElement).value||null)}}
                        />
                      </td>}
                      {isVisible('phone') && <td style={{fontSize:'11px',color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.phone||'—'}</td>}
                      {isVisible('email') && <td style={{fontSize:'11px',color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.email||'—'}</td>}
                      {isVisible('laha') && <td style={{textAlign:'center'}}>
                        <input type="checkbox" checked={!!r.allow_laha} style={{accentColor:'var(--mod-hr)',width:'13px',height:'13px',cursor:'pointer'}}
                          onChange={e=>saveInline(r.id,'allow_laha',e.target.checked)} />
                      </td>}
                      {isVisible('meal') && <td style={{textAlign:'center'}}>
                        <input type="checkbox" checked={!!r.allow_meal} style={{accentColor:'var(--mod-hr)',width:'13px',height:'13px',cursor:'pointer'}}
                          onChange={e=>saveInline(r.id,'allow_meal',e.target.checked)} />
                      </td>}
                      {isVisible('fsa') && <td style={{textAlign:'center'}}>
                        <input type="checkbox" checked={!!r.allow_fsa} style={{accentColor:'var(--mod-hr)',width:'13px',height:'13px',cursor:'pointer'}}
                          onChange={e=>saveInline(r.id,'allow_fsa',e.target.checked)} />
                      </td>}
                      {isVisible('car') && <td style={{fontSize:'11px',color:car?'var(--mod-hr)':'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:car?'pointer':undefined}} onClick={car?()=>setActivePanel('hr-cars'):undefined}>{car?`🚗 ${car.vehicle_type}`:'—'}</td>}
                      {isVisible('flights') && <td style={{fontSize:'11px',color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.flights||'—'}</td>}
                      {isVisible('room') && <td style={{fontSize:'11px',color:room?'var(--mod-hr)':'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:room?'pointer':undefined}} onClick={room?()=>setActivePanel('hr-accommodation'):undefined}>{room?`🏨 ${room.property}${room.room?' '+room.room:''}`:'—'}</td>}
                      {isVisible('wbs') && <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.wbs||'—'}</td>}
                      {isVisible('po') && <td style={{minWidth:'110px'}}>
                        {r.category==='subcontractor' ? (
                          <select
                            className="input"
                            style={{fontSize:'10px',padding:'1px 4px',height:'22px',minWidth:'100px',
                              background: r.linked_po_id ? 'transparent' : 'rgba(220,38,38,0.06)',
                              color: r.linked_po_id ? 'var(--text)' : 'var(--red)',
                              borderColor: r.linked_po_id ? 'transparent' : 'rgba(220,38,38,0.3)',
                            }}
                            value={r.linked_po_id||''}
                            onChange={e => {
                              const val = e.target.value || null
                              saveInline(r.id, 'linked_po_id', val)
                            }}
                          >
                            <option value="">⚠ No PO</option>
                            {subconPos.map(po => <option key={po.id} value={po.id}>{po.po_number||'—'} {po.vendor}</option>)}
                          </select>
                        ) : <span style={{color:'var(--text3)'}}>—</span>}
                      </td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* On-site Gantt calendar */}
          <ResourceCalendar
            resources={filtered}
            onSave={async (id, field, value) => { await saveInline(id, field, value) }}
            onOpenEdit={r => { setForm({...r}); setModal(r) }}
            selected={selected}
            onBulkEdit={() => setBulkModal(true)}
            onClearSelected={() => setSelected(new Set())}
          />
        </>
      )}
    </>)}

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
                <div className="fg">
                  <label>Area / Specialisation</label>
                  <SpecialisationPicker
                    value={form.specialisation||''}
                    allSpecialisations={[...new Set(resources.map(r=>r.specialisation).filter(Boolean) as string[])]}
                    onChange={v=>setForm(f=>({...f,specialisation:v||null}))}
                  />
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
                  <label>Shift (default)</label>
                  <select className="input" value={form.shift||'day'} onChange={e=>setForm(f=>({...f,shift:e.target.value as Resource['shift']}))}>
                    {SHIFTS.map(s=><option key={s} value={s}>{s==='day'?'☀️ Day':s==='night'?'🌙 Night':'☀️🌙 Both'}</option>)}
                  </select>
                </div>
              </div>

              {/* Shift phase editor */}
              <ShiftPhaseEditor
                phases={form.shift_phases||[]}
                defaultShift={form.shift||'day'}
                mobIn={form.mob_in||null}
                mobOut={form.mob_out||null}
                onChange={phases=>setForm(f=>({...f,shift_phases:phases.length?phases:null}))}
              />

              <div className="fg-row">
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
              <div className="fg">
                <label>Area / Specialisation (set for all selected)</label>
                <SpecialisationPicker
                  value={bulkForm.specialisation}
                  allSpecialisations={[...new Set(resources.map(r=>r.specialisation).filter(Boolean) as string[])]}
                  onChange={v=>setBulkForm(f=>({...f,specialisation:v}))}
                />
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

      {/* ── Column picker modal ───────────────────────────────────────────────── */}
      {showColPicker && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1200,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)'}}
          onClick={()=>setShowColPicker(false)}>
          <div style={{background:'var(--bg2)',borderRadius:'12px',width:'460px',maxWidth:'95vw',maxHeight:'80vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 50px rgba(0,0,0,0.35)',border:'1px solid var(--border)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{padding:'16px 20px 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:700,fontSize:'15px'}}>Columns</div>
                <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'2px'}}>Choose which columns to show in the resource list</div>
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button className="btn btn-sm" onClick={()=>{setHiddenCols(new Set());setShowColPicker(false)}}>Show All</button>
                <button className="btn btn-sm" onClick={()=>setShowColPicker(false)}>Done</button>
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'12px 20px'}}>
              {RES_COL_GROUPS.map(group => {
                const cols = RES_COLS.filter(c => c.group === group && c.label)
                if (cols.length === 0) return null
                return (
                  <div key={group} style={{marginBottom:'16px'}}>
                    <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text3)',marginBottom:'8px'}}>{group}</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                      {cols.map(col => {
                        const visible = isVisible(col.id as ResColId)
                        return (
                          <label key={col.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 10px',borderRadius:'6px',background:visible?'var(--accent-dim,rgba(99,102,241,0.1))':'var(--bg3)',border:`1px solid ${visible?'var(--accent)':'var(--border)'}`,cursor:'pointer',userSelect:'none'}}>
                            <input type="checkbox" checked={visible}
                              onChange={e=>{
                                const next = new Set(hiddenCols)
                                if (e.target.checked) next.delete(col.id)
                                else next.add(col.id)
                                setHiddenCols(next)
                              }}
                              style={{accentColor:'var(--accent)',width:'14px',height:'14px',flexShrink:0}}
                            />
                            <span style={{fontSize:'13px',fontWeight:visible?600:400,color:visible?'var(--text)':'var(--text3)'}}>{col.label}</span>
                            {visible && <span style={{marginLeft:'auto',fontSize:'10px',color:'var(--accent)'}}>✓ Visible</span>}
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

      {cardPerson && <PersonCard person={cardPerson} onClose={closeCard} />}
    </div>
  )
}

// ── ShiftPhaseEditor component ────────────────────────────────────────────────
function ShiftPhaseEditor({ phases, defaultShift, mobIn, mobOut, onChange }: {
  phases: ShiftPhase[]
  defaultShift: 'day' | 'night' | 'both'
  mobIn: string | null
  mobOut: string | null
  onChange: (phases: ShiftPhase[]) => void
}) {
  const [open, setOpen] = useState(phases.length > 0)
  const hasPhases = phases.length > 0
  const validationError = hasPhases ? validatePhases(phases, mobIn, mobOut) : null

  function addPhase() {
    // Default new phase: starts day after last phase ends (or mob_in), ends at mob_out
    const lastEnd = phases.length > 0 ? phases[phases.length - 1].to : (mobIn || '')
    const newFrom = lastEnd ? nextDay(lastEnd) : (mobIn || '')
    const newTo = mobOut || newFrom
    onChange([...phases, { from: newFrom, to: newTo, shift: defaultShift }])
    setOpen(true)
  }

  function removePhase(i: number) {
    const next = phases.filter((_, j) => j !== i)
    onChange(next)
    if (next.length === 0) setOpen(false)
  }

  function updatePhase(i: number, field: keyof ShiftPhase, value: string) {
    onChange(phases.map((p, j) => j === i ? { ...p, [field]: value } : p))
  }

  // Timeline bar — visualise phases over mob period
  const canTimeline = mobIn && mobOut && phases.length > 0
  const mobStart = mobIn ? new Date(mobIn + 'T12:00:00').getTime() : 0
  const mobEnd   = mobOut ? new Date(mobOut + 'T12:00:00').getTime() : 0
  const mobSpan  = mobEnd - mobStart || 1

  const SHIFT_COLORS: Record<string, string> = {
    day:   '#fef3c7',
    night: '#dbeafe',
    both:  '#f3e8ff',
  }
  const SHIFT_TEXT: Record<string, string> = {
    day:   '#92400e',
    night: '#1e40af',
    both:  '#6b21a8',
  }

  return (
    <div style={{ marginBottom: '12px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--bg2)', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', flex: 1 }}>
          {hasPhases ? `⏱ Shift phases (${phases.length} phase${phases.length !== 1 ? 's' : ''})` : '⏱ Shift phases'}
        </span>
        {!hasPhases && (
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Optional — split shift by date range</span>
        )}
        {hasPhases && validationError && (
          <span style={{ fontSize: '10px', color: 'var(--red)', fontWeight: 600 }}>⚠ {validationError}</span>
        )}
        <button className="btn btn-sm" style={{ fontSize: '10px' }} onClick={e => { e.stopPropagation(); addPhase() }}>+ Add phase</button>
        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '10px 12px' }}>
          {phases.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text3)', textAlign: 'center', padding: '8px 0' }}>
              No phases. By default this person uses their default shift for the entire mob period.
              <br />Click "+ Add phase" to split by date range.
            </div>
          ) : (
            <>
              {/* Phase rows */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px auto', gap: '6px', marginBottom: '4px', fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span>From</span><span>To</span><span>Shift</span><span />
              </div>
              {phases.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                  <input type="date" className="input" style={{ fontSize: '12px' }} value={p.from}
                    onChange={e => updatePhase(i, 'from', e.target.value)} />
                  <input type="date" className="input" style={{ fontSize: '12px' }} value={p.to}
                    onChange={e => updatePhase(i, 'to', e.target.value)} />
                  <select className="input" style={{ fontSize: '12px' }} value={p.shift}
                    onChange={e => updatePhase(i, 'shift', e.target.value as ShiftPhase['shift'])}>
                    <option value="day">☀️ Day</option>
                    <option value="night">🌙 Night</option>
                    <option value="both">☀️🌙 Both</option>
                  </select>
                  <button className="btn btn-sm" style={{ color: 'var(--red)', padding: '2px 6px' }}
                    onClick={() => removePhase(i)}>✕</button>
                </div>
              ))}

              {/* Validation error */}
              {validationError && (
                <div style={{ fontSize: '11px', color: 'var(--red)', padding: '4px 0', marginBottom: '6px' }}>
                  ⚠ {validationError}
                </div>
              )}

              {/* Timeline visualisation */}
              {canTimeline && !validationError && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timeline</div>
                  <div style={{ display: 'flex', height: '24px', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    {phases.map((p, i) => {
                      const pStart = new Date(p.from + 'T12:00:00').getTime()
                      const pEnd   = new Date(p.to   + 'T12:00:00').getTime()
                      const left   = Math.max(0, (pStart - mobStart) / mobSpan * 100)
                      const width  = Math.min(100 - left, (pEnd - pStart + 86400000) / mobSpan * 100)
                      return (
                        <div key={i} style={{ width: width + '%', background: SHIFT_COLORS[p.shift] || '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: SHIFT_TEXT[p.shift] || '#374151', borderRight: i < phases.length - 1 ? '1px solid var(--border)' : undefined, overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 }}>
                          {SHIFT_LABELS[p.shift]}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
                    <span>{mobIn}</span><span>{mobOut}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function nextDay(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ── SpecialisationPicker ──────────────────────────────────────────────────────
const DEFAULT_SPECIALISATIONS = ['Turbine', 'Generator', 'Valves', 'Auxiliaries']

function SpecialisationPicker({ value, allSpecialisations, onChange }: {
  value: string
  allSpecialisations: string[]
  onChange: (v: string) => void
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newVal, setNewVal] = useState('')

  // Merge defaults + any project-specific ones already in use
  const options = [...new Set([...DEFAULT_SPECIALISATIONS, ...allSpecialisations])].sort()

  if (addingNew) {
    return (
      <div style={{ display: 'flex', gap: '4px' }}>
        <input
          className="input"
          autoFocus
          placeholder="e.g. Cooling Water"
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newVal.trim()) { onChange(newVal.trim()); setAddingNew(false); setNewVal('') }
            if (e.key === 'Escape') { setAddingNew(false); setNewVal('') }
          }}
        />
        <button className="btn btn-sm" onClick={() => { if (newVal.trim()) { onChange(newVal.trim()); setAddingNew(false); setNewVal('') } }}>✓</button>
        <button className="btn btn-sm" style={{ color: 'var(--text3)' }} onClick={() => { setAddingNew(false); setNewVal('') }}>✕</button>
      </div>
    )
  }

  return (
    <select className="input" value={value} onChange={e => {
      if (e.target.value === '__add_new__') { setAddingNew(true) }
      else onChange(e.target.value)
    }}>
      <option value="">— None —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      <option value="__add_new__">+ Add new…</option>
    </select>
  )
}