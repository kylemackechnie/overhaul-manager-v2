import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { PayrollImportModal } from '../../components/PayrollImportModal'
import type { WeeklyTimesheet, Resource, RateCard, PurchaseOrder, DayEntry } from '../../types'

type TsType = 'trades' | 'mgmt' | 'seag' | 'subcon'
const TYPE_LABELS: Record<TsType, string> = { trades: 'Trades', mgmt: 'Management', seag: 'SE AG', subcon: 'Subcontractor' }
const TYPE_COLOR: Record<TsType, string> = { trades: 'var(--mod-hr)', mgmt: '#6366f1', seag: '#0891b2', subcon: '#7c3aed' }
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft: { bg: '#f1f5f9', color: '#64748b' },
  submitted: { bg: '#dbeafe', color: '#1e40af' },
  approved: { bg: '#d1fae5', color: '#065f46' },
}
const STATUS_FLOW = ['draft', 'submitted', 'approved'] as const
const DAY_TYPES = [
  { key: 'weekday', label: 'Weekday' }, { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' }, { key: 'public_holiday', label: 'Public Holiday' },
  { key: 'rest', label: 'Rest/Fatigue' }, { key: 'standby', label: 'Standby' },
  { key: 'travel', label: 'Travel' }, { key: 'mob', label: 'Mob/Demob' },
]

function getMon(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return d.toISOString().slice(0, 10)
}
function weekDays(weekStart: string): string[] {
  const days: string[] = []
  const d = new Date(weekStart + 'T12:00:00')
  for (let i = 0; i < 7; i++) { days.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) }
  return days
}
function autoType(dateStr: string, holidays: Set<string>): string {
  if (holidays.has(dateStr)) return 'public_holiday'
  const dow = new Date(dateStr + 'T12:00:00').getDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}
function splitHours(hrs: number, dayType: string, shiftType: string, regime: string) {
  if (hrs <= 0) return { dnt: 0, dt15: 0, ddt: 0, nnt: 0, ndt: 0 }
  if (dayType === 'sunday' || dayType === 'public_holiday') return { dnt: 0, dt15: 0, ddt: hrs, nnt: 0, ndt: 0 }
  if (dayType === 'saturday') {
    if (regime === 'ge12') return { dnt: 0, dt15: 0, ddt: hrs, nnt: 0, ndt: 0 }
    return { dnt: 0, dt15: Math.min(hrs, 2), ddt: Math.max(0, hrs - 2), nnt: 0, ndt: 0 }
  }
  if (shiftType === 'night') return { dnt: 0, dt15: 0, ddt: 0, nnt: Math.min(hrs, 8), ndt: Math.max(0, hrs - 8) }
  if (regime === 'ge12') return { dnt: Math.min(hrs, 8), dt15: Math.min(Math.max(0, hrs - 8), 2), ddt: Math.max(0, hrs - 10), nnt: 0, ndt: 0 }
  return { dnt: Math.min(hrs, 7.6), dt15: Math.min(Math.max(0, hrs - 7.6), 2.4), ddt: Math.max(0, hrs - 10), nnt: 0, ndt: 0 }
}
function calcPersonTotals(member: WeeklyTimesheet['crew'][0], regime: string, rc: RateCard | null) {
  let hours = 0, sell = 0, cost = 0, allowances = 0
  const rates = rc?.rates as { cost: Record<string, number>; sell: Record<string, number> } | null
  const cr = rates?.cost || {}; const sr = rates?.sell || {}
  Object.values(member.days || {}).forEach(d => {
    const day = d as { dayType?: string; shiftType?: string; hours?: number; laha?: boolean; meal?: boolean }
    const h = day.hours || 0; if (h <= 0) return
    hours += h
    const split = splitHours(h, day.dayType || 'weekday', day.shiftType || 'day', regime)
    Object.entries(split).forEach(([b, bh]) => { if (bh > 0) { cost += bh * (cr[b] || 0); sell += bh * (sr[b] || 0) } })
    if (day.laha) { cost += (rc as { laha_cost?: number })?.laha_cost || 0; sell += (rc as { laha_sell?: number })?.laha_sell || 0; allowances += (rc as { laha_sell?: number })?.laha_sell || 0 }
    if (day.meal) { cost += (rc as { meal_cost?: number })?.meal_cost || 0; sell += (rc as { meal_sell?: number })?.meal_sell || 0; allowances += (rc as { meal_sell?: number })?.meal_sell || 0 }
  })
  const workedDays = Object.values(member.days || {}).filter((d: unknown) => ((d as { hours?: number }).hours || 0) > 0).length
  const fsaSell = (rc as { fsa_sell?: number })?.fsa_sell || 0; const fsaCost = (rc as { fsa_cost?: number })?.fsa_cost || 0
  if (fsaSell > 0) { sell += workedDays * fsaSell; cost += workedDays * fsaCost; allowances += workedDays * fsaSell }
  return { hours, sell, cost, allowances }
}

export function TimesheetsPanel({ type }: { type: TsType }) {
  const { activeProject } = useAppStore()
  const [sheets, setSheets] = useState<WeeklyTimesheet[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])
  const [holidays, setHolidays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [activeWeek, setActiveWeek] = useState<WeeklyTimesheet | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ week_start: getMon(new Date().toISOString().slice(0, 10)), wbs: '', notes: '', vendor: '', po_id: '' })
  const [saving, setSaving] = useState(false)
  const [showPayrollImport, setShowPayrollImport] = useState(false)
  const [woAllocModal, setWoAllocModal] = useState<{personId:string;date:string;hours:number;name:string}|null>(null)
  const [woAllocRows, setWoAllocRows] = useState<{woId:string;woNumber:string;hours:number}[]>([])
  const [workOrders, setWorkOrders] = useState<{id:string;wo_number:string;description:string}[]>([])
  const catMap: Record<TsType, string[]> = { trades: ['trades', 'subcontractor'], mgmt: ['management'], seag: ['seag'], subcon: ['subcontractor'] }
  const scopeMode = activeProject?.scope_tracking || 'none'

  // Mirror HTML getTsRoleType logic
  function getTsRoleType(r: Resource): TsType {
    const role = (r.role || '').toLowerCase()
    const cat  = (r.category || '').toLowerCase()
    if (cat === 'subcontractor' || cat === 'subcon') return 'subcon'
    if (cat === 'seag' || role.includes('se ag') || role.includes('seag')) return 'seag'
    if (['project manager','engineer','site manager','supervisor','administrator',
         'admin','specialist','safety','planner','scheduler'].some(k => role.includes(k))) return 'mgmt'
    return 'trades'
  }

  const [bulkAddModal, setBulkAddModal] = useState(false)
  const [tceAllocModal, setTceAllocModal] = useState<{personId:string;date:string;hours:number;name:string}|null>(null)
  const [tceAllocRows, setTceAllocRows] = useState<{key:string;label:string;hours:number}[]>([])
  const [tceLines, setTceLines] = useState<{item_id:string;description:string;work_order:string|null;source:string}[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, type])
  useEffect(() => {
    if (activeProject) {
      supabase.from('work_orders').select('id,wo_number,description').eq('project_id', activeProject.id).neq('status','cancelled').order('wo_number')
        .then(r => setWorkOrders((r.data||[]) as {id:string;wo_number:string;description:string}[]))
      if (activeProject.scope_tracking === 'nrg_tce') {
        supabase.from('nrg_tce_lines').select('item_id,description,work_order,source').eq('project_id', activeProject.id).order('item_id')
          .then(r => setTceLines((r.data||[]) as {item_id:string;description:string;work_order:string|null;source:string}[]))
      }
    }
  }, [activeProject?.id])

  async function load() {
    setLoading(true)
    try {
      const pid = activeProject!.id
      const [shData, resData, rcData, poData, wbsData, phData] = await Promise.all([
        supabase.from('weekly_timesheets').select('*').eq('project_id', pid).eq('type', type).order('week_start', { ascending: false }),
        supabase.from('resources').select('*').eq('project_id', pid).order('name'),
        supabase.from('rate_cards').select('*').eq('project_id', pid),
        supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid),
        supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
        supabase.from('public_holidays').select('date').eq('project_id', pid),
      ])
      setSheets((shData.data || []) as WeeklyTimesheet[])
      setResources((resData.data || []) as Resource[])
      setRateCards((rcData.data || []) as RateCard[])
      setPos((poData.data || []) as PurchaseOrder[])
      setWbsList((wbsData.data || []) as { id: string; code: string; name: string }[])
      setHolidays(new Set((phData.data || []).map((h: { date: string }) => h.date)))
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const getRC = (role: string) => rateCards.find(rc => rc.role.toLowerCase() === role.toLowerCase()) || null

  async function createWeek() {
    if (!newForm.week_start) return toast('Date required', 'error')
    setSaving(true)
    const ws = getMon(newForm.week_start)
    const crew = resources.filter(r => catMap[type].includes(r.category || 'trades') && r.mob_in && (!r.mob_out || r.mob_out >= ws))
      .map(r => ({ personId: r.id, name: r.name, role: r.role || '', wbs: r.wbs || newForm.wbs, days: {} as Record<string, unknown>, mealBreakAdj: false }))
    const { data, error } = await supabase.from('weekly_timesheets').insert({
      project_id: activeProject!.id, type, week_start: ws, wbs: newForm.wbs, notes: newForm.notes,
      regime: 'lt12', status: 'draft', vendor: newForm.vendor || null, po_id: newForm.po_id || null, crew,
    }).select('*').single()
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast('Week created', 'success'); setSaving(false); setShowNewModal(false)
    setNewForm({ week_start: getMon(new Date().toISOString().slice(0, 10)), wbs: '', notes: '', vendor: '', po_id: '' })
    setActiveWeek(data as WeeklyTimesheet); load()
  }


  function openWoAlloc(personId: string, date: string, hours: number, name: string) {
    const member = activeWeek?.crew.find(m => m.personId === personId)
    const existing = ((member?.days?.[date] as Record<string,unknown>)?.woAllocations as {woId:string;woNumber:string;hours:number}[]) || []
    setWoAllocRows(existing.length ? [...existing] : [])
    setWoAllocModal({ personId, date, hours, name })
  }

  function saveWoAlloc() {
    if (!woAllocModal || !activeWeek) return
    const total = woAllocRows.reduce((s, r) => s + (r.hours || 0), 0)
    if (total > woAllocModal.hours + 0.01) { toast(`Total (${total.toFixed(1)}h) exceeds shift hours (${woAllocModal.hours}h)`, 'error'); return }
    const updated = activeWeek.crew.map(m => {
      if (m.personId !== woAllocModal.personId) return m
      const existing: Record<string, unknown> = (m.days?.[woAllocModal.date] as Record<string,unknown>) || {}
      return { ...m, days: { ...m.days, [woAllocModal.date]: { ...existing, woAllocations: woAllocRows.filter(r=>r.hours>0) } as unknown as DayEntry } }
    })
    setActiveWeek({ ...activeWeek, crew: updated })
    setWoAllocModal(null)
    toast('WO allocations saved', 'success')
  }

  function applyAllowances() {
    if (!activeWeek || !resources.length) return
    const updated = activeWeek.crew.map(m => {
      const res = resources.find(r => r.name === m.name || r.id === m.personId)
      if (!res) return m
      const newDays: typeof m.days = {}
      Object.entries(m.days).forEach(([d, day]) => {
        const de = day as Record<string, unknown>
        if ((de.hours as number) > 0) {
          newDays[d] = { ...de,
            laha: !!(res as unknown as Record<string,unknown>).allow_laha,
            meal: !!(res as unknown as Record<string,unknown>).allow_meal,
            fsa: !!(res as unknown as Record<string,unknown>).allow_fsa,
          } as unknown as DayEntry
        } else {
          newDays[d] = day
        }
      })
      return { ...m, days: newDays }
    })
    setActiveWeek({ ...activeWeek, crew: updated })
    toast('Allowances applied from resource list', 'success')
  }

  async function duplicateWeek(s: WeeklyTimesheet) {
    const ws = new Date(s.week_start + 'T12:00:00')
    ws.setDate(ws.getDate() + 7)
    const { error } = await supabase.from('weekly_timesheets').insert({
      project_id: s.project_id, type: s.type, week_start: ws.toISOString().slice(0, 10),
      wbs: s.wbs, notes: s.notes, regime: s.regime, status: 'draft',
      vendor: s.vendor, po_id: s.po_id,
      crew: s.crew.map(m => ({ ...m, days: {} })),
    })
    if (error) { toast(error.message, 'error'); return }
    toast('Week duplicated', 'success'); load()
  }

  function getNextMon(weekStart: string): string {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    return getMon(d.toISOString().slice(0, 10))
  }

  async function saveWeek(week: WeeklyTimesheet) {
    const { error } = await supabase.from('weekly_timesheets').update({
      crew: week.crew, regime: week.regime, status: week.status, wbs: week.wbs, notes: week.notes,
    }).eq('id', week.id)
    if (error) { toast(error.message, 'error'); return }
    // Write wo_actuals rows for reporting
    try {
      await supabase.from('wo_actuals').delete().eq('timesheet_id', week.id)
      const actuals: {project_id:string;timesheet_id:string;person_name:string;person_role:string;week_start:string;date:string;hours:number;wo_number:string}[] = []
      for (const m of week.crew) {
        for (const [date, day] of Object.entries(m.days)) {
          const de = day as Record<string,unknown>
          const allocs = (de.woAllocations as {woId:string;woNumber:string;hours:number}[]) || []
          for (const a of allocs) {
            if (a.hours > 0) {
              actuals.push({ project_id: activeProject!.id, timesheet_id: week.id, person_name: m.name, person_role: m.role, week_start: week.week_start, date, hours: a.hours, wo_number: a.woNumber || '' })
            }
          }
        }
      }
      if (actuals.length) await supabase.from('wo_actuals').insert(actuals)
    } catch { /* non-critical */ }
    toast('Saved', 'success')
    setSheets(prev => prev.map(s => s.id === week.id ? week : s))
  }

  async function del(s: WeeklyTimesheet) {
    if (!confirm(`Delete week ${s.week_start}?`)) return
    await supabase.from('weekly_timesheets').delete().eq('id', s.id)
    if (activeWeek?.id === s.id) setActiveWeek(null)
    toast('Deleted', 'info'); load()
  }

  function setDay(personId: string, date: string, field: string, value: unknown) {
    if (!activeWeek) return
    setActiveWeek({
      ...activeWeek,
      crew: activeWeek.crew.map(m => {
        if (m.personId !== personId) return m
        const existing: DayEntry = m.days[date] || { dayType: autoType(date, holidays), shiftType: 'day' as const, hours: 0, laha: false, meal: false }
        return { ...m, days: { ...m.days, [date]: { ...existing, [field]: value } as DayEntry } }
      })
    })
  }


  function openTceAlloc(personId: string, date: string, hours: number, name: string) {
    const member = activeWeek?.crew.find(m => m.personId === personId)
    const existing = ((member?.days?.[date] as Record<string,unknown>)?.nrgWoAllocations as {key:string;label:string;hours:number}[]) || []
    setTceAllocRows(existing.length ? [...existing] : [])
    setTceAllocModal({ personId, date, hours, name })
  }

  function saveTceAlloc() {
    if (!tceAllocModal || !activeWeek) return
    const total = tceAllocRows.reduce((s, r) => s + (r.hours || 0), 0)
    if (total > tceAllocModal.hours + 0.01) { toast(`Total exceeds shift hours`, 'error'); return }
    const updated = activeWeek.crew.map(m => {
      if (m.personId !== tceAllocModal.personId) return m
      const existing: Record<string, unknown> = (m.days?.[tceAllocModal.date] as Record<string,unknown>) || {}
      return { ...m, days: { ...m.days, [tceAllocModal.date]: { ...existing, nrgWoAllocations: tceAllocRows.filter(r=>r.hours>0) } as unknown as DayEntry } }
    })
    setActiveWeek({ ...activeWeek, crew: updated })
    setTceAllocModal(null)
    toast('TCE allocations saved', 'success')
  }

  // Build TCE dropdown options grouped by WO (mirrors HTML _getNrgTceAllocOptions)
  function getTceOptions(): {key:string; label:string}[] {
    const opts: {key:string;label:string}[] = []
    // Work orders with TCE lines
    const byWo: Record<string, typeof tceLines> = {}
    tceLines.filter(l => l.work_order).forEach(l => {
      if (!byWo[l.work_order!]) byWo[l.work_order!] = []
      byWo[l.work_order!].push(l)
    })
    Object.entries(byWo).sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric:true})).forEach(([wo, ls]) => {
      opts.push({ key: `wo:${wo}`, label: `WO ${wo} — ${ls[0]?.description?.slice(0,45) || ''}${ls.length > 1 ? ` (+${ls.length-1})` : ''}` })
    })
    // Overhead / direct lines without WO
    tceLines.filter(l => !l.work_order && l.description).forEach(l => {
      opts.push({ key: `tce:${l.item_id}`, label: `${l.item_id} — ${l.description?.slice(0,50) || ''}` })
    })
    return opts
  }

  function buildPreDays(r: Resource, weekStart: string): Record<string, DayEntry> {
    // Pre-fill standard hours from project settings and apply resource allowances
    const std = (activeProject as typeof activeProject & {std_hours?: {day:Record<string,number>;night:Record<string,number>}})?.std_hours
    const days: Record<string, DayEntry> = {}
    if (!std) return days
    const dayNames = ['mon','tue','wed','thu','fri','sat','sun']
    const monday = new Date(weekStart + 'T12:00:00')
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i)
      const ds = d.toISOString().slice(0, 10)
      const dow = dayNames[i]
      const shift = (r as Resource & {shift?:string}).shift || 'day'
      const dayType = autoType(ds, holidays)
      const hrs = shift === 'night' ? (std.night?.[dow] || 0) : (std.day?.[dow] || 0)
      if (hrs > 0) {
        days[ds] = {
          dayType, shiftType: shift === 'night' ? 'night' : 'day', hours: hrs,
          laha: !!(r as Resource & {allow_laha?:boolean}).allow_laha,
          meal: !!(r as Resource & {allow_meal?:boolean}).allow_meal,
        } as DayEntry
      }
    }
    return days
  }

  function addPerson(resourceId: string) {
    if (!activeWeek || activeWeek.crew.find(m => m.personId === resourceId)) return
    const r = resources.find(x => x.id === resourceId); if (!r) return
    const preDays = buildPreDays(r, activeWeek.week_start)
    setActiveWeek({ ...activeWeek, crew: [...activeWeek.crew, { personId: r.id, name: r.name, role: r.role || '', wbs: r.wbs || activeWeek.wbs || '', days: preDays, mealBreakAdj: false }] })
  }

  function bulkAddByScope(scope: 'onsite' | 'all') {
    if (!activeWeek) return
    const weekEnd = days[days.length - 1]
    const inCrew = new Set(activeWeek.crew.map(m => m.personId))
    const candidates = resources.filter(r => {
      if (inCrew.has(r.id)) return false
      if (getTsRoleType(r) !== type && !(type === 'subcon' && r.category === 'subcontractor')) return false
      if (scope === 'onsite') {
        const mobIn = (r as Resource & {mob_in?:string|null}).mob_in
        const mobOut = (r as Resource & {mob_out?:string|null}).mob_out
        if (!mobIn) return false
        return mobIn <= weekEnd && (!mobOut || mobOut >= activeWeek.week_start)
      }
      return true
    })
    if (!candidates.length) { toast(`No ${scope === 'onsite' ? 'on-site' : ''} ${TYPE_LABELS[type]} to add`, 'info'); setBulkAddModal(false); return }
    const newCrew = [...activeWeek.crew, ...candidates.map(r => ({
      personId: r.id, name: r.name, role: r.role || '', wbs: r.wbs || activeWeek.wbs || '',
      days: buildPreDays(r, activeWeek.week_start), mealBreakAdj: false
    }))]
    setActiveWeek({ ...activeWeek, crew: newCrew })
    setBulkAddModal(false)
    toast(`Added ${candidates.length} ${scope === 'onsite' ? 'on-site ' : ''}${TYPE_LABELS[type]}`, 'success')
  }

  function removePerson(personId: string) {
    if (!activeWeek) return
    setActiveWeek({ ...activeWeek, crew: activeWeek.crew.filter(m => m.personId !== personId) })
  }

  const regime = activeWeek?.regime || 'lt12'
  const days = activeWeek ? weekDays(activeWeek.week_start) : []
  const inCrew = new Set(activeWeek?.crew.map(m => m.personId) || [])
  const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

  function weekTotals(s: WeeklyTimesheet) {
    let hours = 0, sell = 0, cost = 0
    s.crew.forEach(m => { const t = calcPersonTotals(m, s.regime || 'lt12', getRC(m.role)); hours += t.hours; sell += t.sell; cost += t.cost })
    return { hours, sell, cost }
  }


  function exportTimesheetCSV() {
    if (!activeWeek) return
    const rows: (string | number)[][] = [
      ['Name', 'Role', 'WBS', ...days.map(d => d), 'Total Hours', 'Total Sell']
    ]
    activeWeek.crew.forEach(m => {
      const t = calcPersonTotals(m, regime, getRC(m.role))
      rows.push([
        m.name, m.role, m.wbs,
        ...days.map(d => {
          const de = m.days[d] as Record<string,unknown> | undefined
          return (de?.hours as number) || 0
        }),
        t.hours.toFixed(1),
        t.sell.toFixed(2),
      ])
    })
    const csv = rows.map(r => r.map(c => String(c).includes(',') ? `"${c}"` : c).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `timesheet-${activeWeek.week_start}-${type}.csv`
    a.click()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>{TYPE_LABELS[type]} Timesheets</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{sheets.length} weeks · {resources.length} people</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {activeWeek && <>
            <button className="btn" onClick={() => { saveWeek(activeWeek); setActiveWeek(null) }}>💾 Save & Close</button>
            <button className="btn btn-sm" onClick={async () => {
              await saveWeek(activeWeek)
              const nextWk = getNextMon(activeWeek.week_start)
              const existing = sheets.find(s => s.week_start === nextWk && s.type === activeWeek.type)
              if (existing) { setActiveWeek(existing); return }
              // Create next week with same crew (no hours)
              const newWeek = { ...activeWeek, id: undefined, week_start: nextWk, crew: activeWeek.crew.map(m => ({ ...m, days: {} })) }
              const { data, error } = await supabase.from('weekly_timesheets').insert({ project_id: activeProject!.id, week_start: nextWk, type: activeWeek.type, regime: activeWeek.regime, wbs: activeWeek.wbs, notes: '', vendor: activeWeek.vendor || '', crew: newWeek.crew, status: 'draft' }).select('*').single()
              if (!error && data) { load(); setActiveWeek(data as WeeklyTimesheet) }
            }}>⏭ Next Week</button>
            <button className="btn btn-sm" onClick={() => setShowPayrollImport(true)}>📥 Import Payroll</button>
            <button className="btn" onClick={() => setActiveWeek(null)}>← All Weeks</button>
            <button className="btn btn-sm" onClick={exportTimesheetCSV}>⬇ CSV</button>
            <button className="btn btn-sm" onClick={applyAllowances} title="Apply LAHA/meal defaults from resource list">🏷 Allowances</button>
          </>}
          <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>+ New Week</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>

      : !activeWeek ? (
        sheets.length === 0 ? (
          <div className="empty-state"><div className="icon">⏱️</div><h3>No timesheets yet</h3><p>Click + New Week to create the first weekly timesheet.</p></div>
        ) : (
          <>
          {(() => {
            const totals = sheets.reduce((acc, s) => {
              const t = weekTotals(s)
              return { hours: acc.hours + t.hours, sell: acc.sell + t.sell, cost: acc.cost + t.cost }
            }, { hours: 0, sell: 0, cost: 0 })
            const approved = sheets.filter(s => s.status === 'approved').length
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '14px' }}>
                {[
                  { label: 'Weeks', value: sheets.length, color: TYPE_COLOR[type] },
                  { label: 'Approved', value: `${approved}/${sheets.length}`, color: 'var(--green)' },
                  { label: 'Total Hours', value: totals.hours.toFixed(1) + 'h', color: TYPE_COLOR[type] },
                  { label: 'Total Sell', value: totals.sell > 0 ? fmt(totals.sell) : '—', color: 'var(--green)' },
                ].map(t => (
                  <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
                    <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
                  </div>
                ))}
              </div>
            )
          })()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sheets.map(s => {
              const sc = STATUS_COLORS[s.status] || STATUS_COLORS.draft
              const { hours, sell, cost } = weekTotals(s)
              const endD = new Date(s.week_start + 'T12:00:00'); endD.setDate(endD.getDate() + 6)
              return (
                <div key={s.id} className="card" style={{ borderLeft: `3px solid ${TYPE_COLOR[type]}`, cursor: 'pointer' }} onClick={() => setActiveWeek(s)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontWeight: 700, fontSize: '14px' }}>
                        Week of {new Date(s.week_start + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })} → {endD.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{s.crew.length} people{s.notes ? ` · ${s.notes}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: TYPE_COLOR[type] }}>{hours.toFixed(1)}h</div><div style={{ fontSize: '11px', color: 'var(--text3)' }}>Total hours</div></div>
                    {sell > 0 && <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(sell)}</div><div style={{ fontSize: '11px', color: 'var(--text3)' }}>Sell value</div></div>}
                    {cost > 0 && cost !== sell && <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmt(cost)}</div><div style={{ fontSize: '11px', color: 'var(--text3)' }}>Cost</div></div>}
                    <span className="badge" style={sc}>{s.status}</span>
                    <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                      {s.status !== 'approved' && <button className="btn btn-sm" style={{color:'var(--green)',fontSize:'10px'}} title="Quick approve" onClick={async()=>{
                        await supabase.from('weekly_timesheets').update({status:'approved'}).eq('id',s.id)
                        load()
                      }}>✓ Approve</button>}
                      <button className="btn btn-sm" title="Duplicate week" onClick={() => duplicateWeek(s)}>⧉</button>
                      <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => del(s)}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          </>
        )
      ) : (
        // ── ACTIVE WEEK GRID ──
        <div style={{ overflowX: 'auto' }}>
          {/* Week controls */}
          <div className="card" style={{ marginBottom: '12px', padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '12px' }}>
                {new Date(activeWeek.week_start + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                {' → '}
                {new Date(new Date(activeWeek.week_start + 'T12:00:00').getTime() + 6 * 86400000).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <span className="badge" style={STATUS_COLORS[activeWeek.status] || STATUS_COLORS.draft}>{activeWeek.status}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Status:</span>
                <select className="input" style={{ width: '120px', fontSize: '12px', padding: '3px 6px' }} value={activeWeek.status} onChange={e => setActiveWeek({ ...activeWeek, status: e.target.value as 'draft' | 'submitted' | 'approved' })}>
                  {STATUS_FLOW.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Regime:</span>
                <select className="input" style={{ width: '130px', fontSize: '12px', padding: '3px 6px' }} value={activeWeek.regime || 'lt12'} onChange={e => setActiveWeek({ ...activeWeek, regime: e.target.value as 'lt12' | 'ge12' })}>
                  <option value="lt12">{'< 12hr shifts'}</option>
                  <option value="ge12">{'≥ 12hr shifts'}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Day header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(7, minmax(100px,1fr)) 120px', gap: '1px', background: 'var(--border)', borderRadius: '6px 6px 0 0', overflow: 'hidden', marginBottom: '1px', minWidth: '960px' }}>
            <div style={{ background: 'var(--bg3)', padding: '7px 10px', fontSize: '10px', fontFamily: 'var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>Person / Role</div>
            {days.map((d, i) => {
              const isPH = holidays.has(d); const isWknd = i >= 5
              const lbl = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]
              return (
                <div key={d} style={{ background: isPH ? '#f5f3ff' : 'var(--bg3)', padding: '7px 6px', fontSize: '10px', fontFamily: 'var(--mono)', color: isPH ? '#7c3aed' : isWknd ? 'var(--amber)' : 'var(--text3)', textTransform: 'uppercase', textAlign: 'center' }}>
                  {lbl}{isPH ? ' 🗓' : ''}<br /><span style={{ fontSize: '9px' }}>{new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}</span>
                </div>
              )
            })}
            <div style={{ background: 'var(--bg3)', padding: '7px 8px', fontSize: '10px', fontFamily: 'var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', textAlign: 'right' }}>Total / Value</div>
          </div>

          {/* Person rows */}
          {activeWeek.crew.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)', border: '1px solid var(--border)', minWidth: '960px' }}>No people on sheet yet — use the dropdown below to add crew.</div>
          ) : activeWeek.crew.map(member => {
            const rc = getRC(member.role)
            const { hours, sell, cost, allowances } = calcPersonTotals(member, regime, rc)
            return (
              <div key={member.personId} style={{ border: '1px solid var(--border)', borderTop: 'none', minWidth: '960px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(7, minmax(100px,1fr)) 120px', gap: '1px', background: 'var(--border)' }}>
                  {/* Person cell */}
                  <div style={{ background: 'var(--bg2)', padding: '8px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '6px' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '12px' }}>{member.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{member.role || '—'}</div>
                      {!rc && <div style={{ fontSize: '9px', color: 'var(--amber)', marginTop: '2px' }}>⚠ No rate card</div>}
                    </div>
                    <button className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--red)', alignSelf: 'flex-start' }} onClick={() => removePerson(member.personId)}>✕ Remove</button>
                  </div>
                  {/* Day cells */}
                  {days.map((d, i) => {
                    const raw = (member.days[d] || {}) as Record<string, unknown>
                    const cellHrs = (raw.hours as number) || 0
                    const dayType = (raw.dayType as string) || autoType(d, holidays)
                    const shiftType = (raw.shiftType as string) || 'day'
                    const laha = (raw.laha as boolean) || false
                    const meal = (raw.meal as boolean) || false
                    const isPH = holidays.has(d); const isWknd = i >= 5
                    return (
                      <div key={d} style={{ background: isPH ? 'rgba(139,92,246,0.05)' : isWknd ? 'rgba(194,65,12,0.03)' : 'var(--bg2)', padding: '4px 5px', borderLeft: '1px solid var(--border)' }}>
                        <input type="number" min="0" max="24" step="0.5" value={cellHrs || ''} placeholder="0"
                          style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, padding: '2px 4px', border: '1px solid var(--border2)', borderRadius: '3px', background: 'transparent', color: cellHrs > 0 ? 'var(--text)' : 'var(--text3)', textAlign: 'center' }}
                          onChange={e => setDay(member.personId, d, 'hours', parseFloat(e.target.value) || 0)} />
                        <select value={dayType} style={{ width: '100%', fontSize: '9px', padding: '1px 2px', border: '1px solid var(--border2)', borderRadius: '2px', background: 'var(--bg3)', color: 'var(--text3)', marginTop: '2px' }}
                          onChange={e => setDay(member.personId, d, 'dayType', e.target.value)}>
                          {DAY_TYPES.map(dt => <option key={dt.key} value={dt.key}>{dt.label}</option>)}
                        </select>
                        <select value={shiftType} style={{ width: '100%', fontSize: '9px', padding: '1px 2px', border: '1px solid var(--border2)', borderRadius: '2px', background: 'var(--bg3)', color: 'var(--text3)', marginTop: '1px' }}
                          onChange={e => setDay(member.personId, d, 'shiftType', e.target.value)}>
                          <option value="day">Day</option>
                          <option value="night">Night</option>
                        </select>
                        {cellHrs > 0 && (
                          <div style={{ display: 'flex', gap: '4px', marginTop: '2px', fontSize: '9px', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                            <label style={{ cursor: 'pointer', color: laha ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={laha} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'laha', e.target.checked)} /> LAHA
                            </label>
                            <label style={{ cursor: 'pointer', color: meal ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={meal} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'meal', e.target.checked)} /> Meal
                            </label>
                            </div>
                            {scopeMode === 'work_orders' && workOrders.length > 0 && (() => {
                              const allocs = ((raw.woAllocations as {woId:string;woNumber:string;hours:number}[]) || []).filter(a=>a.hours>0)
                              return (
                                <button onClick={() => openWoAlloc(member.personId, d, cellHrs, member.name)}
                                  style={{ width: '100%', fontSize: '9px', padding: '1px 3px', borderRadius: '3px', border: `1px solid ${allocs.length ? '#7c3aed' : 'var(--border2)'}`, background: allocs.length ? 'rgba(124,58,237,0.08)' : 'transparent', color: allocs.length ? '#7c3aed' : 'var(--text3)', cursor: 'pointer', textAlign: 'center' }}>
                                  {allocs.length ? `📋 ${allocs.length} WO${allocs.length > 1 ? 's' : ''}` : '📋 WOs'}
                                </button>
                              )
                            })()}
                            {scopeMode === 'nrg_tce' && (() => {
                              const allocs = ((raw.nrgWoAllocations as {key:string;label:string;hours:number}[]) || []).filter(a=>a.hours>0)
                              return (
                                <button onClick={() => openTceAlloc(member.personId, d, cellHrs, member.name)}
                                  style={{ width: '100%', fontSize: '9px', padding: '1px 3px', borderRadius: '3px', border: `1px solid ${allocs.length ? '#be185d' : 'var(--border2)'}`, background: allocs.length ? 'rgba(244,114,182,0.08)' : 'transparent', color: allocs.length ? '#be185d' : 'var(--text3)', cursor: 'pointer', textAlign: 'center' }}>
                                  {allocs.length ? `🎯 ${allocs.length} scope${allocs.length > 1 ? 's' : ''}` : '🎯 TCE'}
                                </button>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* Totals cell */}
                  <div style={{ background: 'var(--bg2)', padding: '8px', textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: TYPE_COLOR[type], fontSize: '13px' }}>{hours.toFixed(1)}h</div>
                    {sell > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--green)', marginTop: '2px' }}>{fmt(sell)}</div>}
                    {allowances > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>+{fmt(allowances)}</div>}
                    {cost > 0 && cost !== sell && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>cost {fmt(cost)}</div>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Footer totals */}
          {activeWeek.crew.length > 0 && (() => {
            let tHrs = 0, tSell = 0, tCost = 0
            activeWeek.crew.forEach(m => { const t = calcPersonTotals(m, regime, getRC(m.role)); tHrs += t.hours; tSell += t.sell; tCost += t.cost })
            const margin = tSell > 0 ? ((tSell - tCost) / tSell * 100).toFixed(1) : null
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px', background: 'var(--bg3)', border: '1px solid var(--border)', borderTop: '2px solid var(--border2)', borderRadius: '0 0 6px 6px', padding: '8px 10px', minWidth: '960px' }}>
                <div style={{ fontWeight: 700, fontSize: '12px' }}>Week Total — {activeWeek.crew.length} people</div>
                <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text3)' }}>
                  {margin && <span style={{ color: parseFloat(margin) >= 20 ? 'var(--green)' : parseFloat(margin) >= 10 ? 'var(--amber)' : 'var(--red)' }}>{margin}% margin</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: TYPE_COLOR[type] }}>{tHrs.toFixed(1)}h</div>
                  {tSell > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--green)' }}>{fmt(tSell)}</div>}
                  {tCost > 0 && tCost !== tSell && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>cost {fmt(tCost)}</div>}
                </div>
              </div>
            )
          })()}

          {/* Add person + save */}
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" style={{ background: TYPE_COLOR[type], color: '#fff' }} onClick={() => setBulkAddModal(true)}>
              👥 Add {TYPE_LABELS[type]}
            </button>
            <select className="input" style={{ maxWidth: '240px', fontSize: '12px' }} value="" onChange={e => { if (e.target.value) { addPerson(e.target.value); (e.target as HTMLSelectElement).value = '' } }}>
              <option value="">+ Add individual...</option>
              {resources.filter(r => !inCrew.has(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}{r.role ? ` — ${r.role}` : ''}</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => saveWeek(activeWeek)}>💾 Save</button>
          </div>
        </div>
      )}

      {/* New week modal */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📅 New {TYPE_LABELS[type]} Week</h3>
              <button className="btn btn-sm" onClick={() => setShowNewModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>Week Starting (Monday) *</label>
                <input type="date" className="input" value={newForm.week_start} onChange={e => setNewForm(f => ({ ...f, week_start: e.target.value }))} autoFocus />
                <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>Monday of this week: {getMon(newForm.week_start)}</p>
              </div>
              <div className="fg">
                <label>WBS (default for this week)</label>
                <select className="input" value={newForm.wbs} onChange={e => setNewForm(f => ({ ...f, wbs: e.target.value }))}>
                  <option value="">— Select WBS —</option>
                  {wbsList.map(w => <option key={w.id} value={w.code}>{w.code}{w.name ? ` — ${w.name}` : ''}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional — e.g. Week 3, commissioning phase" />
              </div>
              {type === 'subcon' && <>
                <div className="fg">
                  <label>Vendor</label>
                  <input className="input" value={newForm.vendor} onChange={e => setNewForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Subcontractor company" />
                </div>
                <div className="fg">
                  <label>Purchase Order</label>
                  <select className="input" value={newForm.po_id} onChange={e => setNewForm(f => ({ ...f, po_id: e.target.value }))}>
                    <option value="">— No PO —</option>
                    {pos.map(po => <option key={po.id} value={po.id}>{po.po_number || '—'} {po.vendor}</option>)}
                  </select>
                </div>
              </>}
              <p style={{ fontSize: '12px', color: 'var(--text3)' }}>
                Will auto-populate with matching resources on mob dates.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createWeek} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Create Week
              </button>
            </div>
          </div>
        </div>
      )}

      {woAllocModal && (
        <div className="modal-overlay" onClick={() => setWoAllocModal(null)}>
          <div className="modal" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📋 WO Allocations — {woAllocModal.name} ({woAllocModal.date})</h3>
              <button className="btn btn-sm" onClick={() => setWoAllocModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                Shift: <strong style={{ fontFamily: 'var(--mono)' }}>{woAllocModal.hours}h</strong>. Allocate across work orders.
              </p>
              {woAllocRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                  <select className="input" style={{ flex: 1 }} value={r.woId}
                    onChange={e => {
                      const wo = workOrders.find(w => w.id === e.target.value)
                      setWoAllocRows(rows => rows.map((x, j) => j === i ? { ...x, woId: e.target.value, woNumber: wo?.wo_number || '' } : x))
                    }}>
                    <option value="">Select WO...</option>
                    {workOrders.map(w => <option key={w.id} value={w.id}>{w.wo_number} — {w.description}</option>)}
                  </select>
                  <input type="number" className="input" style={{ width: '70px', textAlign: 'right', fontFamily: 'var(--mono)' }}
                    value={r.hours || ''} min={0} max={woAllocModal.hours} step={0.5} placeholder="hrs"
                    onChange={e => setWoAllocRows(rows => rows.map((x, j) => j === i ? { ...x, hours: parseFloat(e.target.value) || 0 } : x))} />
                  <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => setWoAllocRows(rows => rows.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="btn btn-sm" style={{ marginBottom: '12px' }} onClick={() => setWoAllocRows(rows => [...rows, { woId: '', woNumber: '', hours: 0 }])}>+ Add WO</button>
              {(() => {
                const total = woAllocRows.reduce((s, r) => s + (r.hours || 0), 0)
                const diff = woAllocModal.hours - total
                const over = diff < -0.01
                return (
                  <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: '6px', display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <div><div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>SHIFT</div><div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{woAllocModal.hours}h</div></div>
                    <div><div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>ALLOCATED</div><div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#7c3aed' }}>{total.toFixed(1)}h</div></div>
                    <div><div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{over ? 'OVER' : 'REMAINING'}</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: over ? 'var(--red)' : diff > 0.01 ? 'var(--amber)' : 'var(--green)' }}>
                        {over ? `+${Math.abs(diff).toFixed(1)}h` : diff.toFixed(1)+'h'}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setWoAllocModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveWoAlloc}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add People Modal */}
      {bulkAddModal && activeWeek && (
        <div className="modal-overlay" onClick={() => setBulkAddModal(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👥 Add {TYPE_LABELS[type]} to Week</h3>
              <button className="btn btn-sm" onClick={() => setBulkAddModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px' }}>
                Week of <strong>{activeWeek.week_start}</strong>
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(() => {
                  const weekEnd = days[days.length - 1]
                  const inCrew = new Set(activeWeek.crew.map(m => m.personId))
                  const forType = resources.filter(r => getTsRoleType(r) === type && !inCrew.has(r.id))
                  const onSite = forType.filter(r => {
                    const mobIn = (r as Resource & {mob_in?:string|null}).mob_in
                    const mobOut = (r as Resource & {mob_out?:string|null}).mob_out
                    return mobIn && mobIn <= weekEnd && (!mobOut || mobOut >= activeWeek.week_start)
                  })
                  return (<>
                    <button style={{ padding: '14px 18px', border: '2px solid var(--accent)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                      onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
                      onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '' }}
                      onClick={() => bulkAddByScope('onsite')}>
                      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '3px' }}>
                        🟢 On Site During This Week
                        <span style={{ float: 'right', fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: '12px' }}>{onSite.length} people</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text2)' }}>
                        {TYPE_LABELS[type]} whose mob-in/mob-out dates overlap this week
                      </div>
                      {onSite.length > 0
                        ? <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '4px' }}>{onSite.slice(0,5).map(r=>r.name).join(', ')}{onSite.length>5?` +${onSite.length-5} more`:''}</div>
                        : <div style={{ fontSize: '10px', color: 'var(--amber)', marginTop: '4px' }}>None available — check mob-in/mob-out dates</div>}
                    </button>
                    <button style={{ padding: '14px 18px', border: '2px solid var(--border2)', borderRadius: '8px', background: 'var(--bg3)', cursor: 'pointer', textAlign: 'left' }}
                      onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--border)' }}
                      onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg3)' }}
                      onClick={() => bulkAddByScope('all')}>
                      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '3px' }}>
                        👥 All {TYPE_LABELS[type]}
                        <span style={{ float: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{forType.length} people</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Add everyone in {TYPE_LABELS[type]} category regardless of dates</div>
                    </button>
                  </>)
                })()}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setBulkAddModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* TCE Scope Allocation Modal */}
      {tceAllocModal && (
        <div className="modal-overlay" onClick={() => setTceAllocModal(null)}>
          <div className="modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🎯 TCE Scopes — {tceAllocModal.name} ({tceAllocModal.date})</h3>
              <button className="btn btn-sm" onClick={() => setTceAllocModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                Shift: <strong style={{ fontFamily: 'var(--mono)' }}>{tceAllocModal.hours}h</strong>. Allocate to TCE scopes or Work Orders.
              </p>
              {tceAllocRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                  <select className="input" style={{ flex: 1, fontSize: '12px' }} value={r.key}
                    onChange={e => {
                      const opt = getTceOptions().find(o => o.key === e.target.value)
                      setTceAllocRows(rows => rows.map((x, j) => j === i ? { ...x, key: e.target.value, label: opt?.label || '' } : x))
                    }}>
                    <option value="">Select scope...</option>
                    {getTceOptions().map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <input type="number" className="input" style={{ width: '68px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '13px' }}
                    value={r.hours || ''} min={0} max={tceAllocModal.hours} step={0.5} placeholder="h"
                    onChange={e => setTceAllocRows(rows => rows.map((x, j) => j === i ? { ...x, hours: parseFloat(e.target.value) || 0 } : x))} />
                  <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => setTceAllocRows(rows => rows.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="btn btn-sm" style={{ marginBottom: '12px' }} onClick={() => setTceAllocRows(rows => [...rows, { key: '', label: '', hours: 0 }])}>+ Add Scope</button>
              {(() => {
                const total = tceAllocRows.reduce((s, r) => s + (r.hours || 0), 0)
                const diff = tceAllocModal.hours - total
                const over = diff < -0.01
                return (
                  <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: '6px', display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <div><div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>SHIFT</div><div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{tceAllocModal.hours}h</div></div>
                    <div><div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>ALLOCATED</div><div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#be185d' }}>{total.toFixed(1)}h</div></div>
                    <div><div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{over ? 'OVER' : 'REMAINING'}</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: over ? 'var(--red)' : diff > 0.01 ? 'var(--amber)' : 'var(--green)' }}>
                        {over ? `+${Math.abs(diff).toFixed(1)}h` : diff.toFixed(1)+'h'}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setTceAllocModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#be185d' }} onClick={saveTceAlloc}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showPayrollImport && activeWeek && (
        <PayrollImportModal
          activeWeek={activeWeek}
          onUpdate={(updated) => setActiveWeek(updated)}
          onClose={() => setShowPayrollImport(false)}
        />
      )}
    </div>
  )
}
