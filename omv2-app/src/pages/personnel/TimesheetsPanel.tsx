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
  const catMap: Record<TsType, string[]> = { trades: ['trades', 'subcontractor'], mgmt: ['management'], seag: ['seag'], subcon: ['subcontractor'] }

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, type])

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

  async function saveWeek(week: WeeklyTimesheet) {
    const { error } = await supabase.from('weekly_timesheets').update({
      crew: week.crew, regime: week.regime, status: week.status, wbs: week.wbs, notes: week.notes,
    }).eq('id', week.id)
    if (error) { toast(error.message, 'error'); return }
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

  function addPerson(resourceId: string) {
    if (!activeWeek || activeWeek.crew.find(m => m.personId === resourceId)) return
    const r = resources.find(x => x.id === resourceId); if (!r) return
    setActiveWeek({ ...activeWeek, crew: [...activeWeek.crew, { personId: r.id, name: r.name, role: r.role || '', wbs: r.wbs || activeWeek.wbs || '', days: {} as Record<string, DayEntry>, mealBreakAdj: false }] })
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
            <button className="btn btn-sm" onClick={() => setShowPayrollImport(true)}>📥 Import Payroll</button>
            <button className="btn" onClick={() => setActiveWeek(null)}>← All Weeks</button>
          </>}
          <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>+ New Week</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>

      : !activeWeek ? (
        sheets.length === 0 ? (
          <div className="empty-state"><div className="icon">⏱️</div><h3>No timesheets yet</h3><p>Click + New Week to create the first weekly timesheet.</p></div>
        ) : (
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
                      <button className="btn btn-sm" title="Duplicate week" onClick={() => duplicateWeek(s)}>⧉</button>
                      <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => del(s)}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
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
                          <div style={{ display: 'flex', gap: '4px', marginTop: '2px', fontSize: '9px' }}>
                            <label style={{ cursor: 'pointer', color: laha ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={laha} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'laha', e.target.checked)} /> LAHA
                            </label>
                            <label style={{ cursor: 'pointer', color: meal ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={meal} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'meal', e.target.checked)} /> Meal
                            </label>
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
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select className="input" style={{ maxWidth: '280px' }} value="" onChange={e => { if (e.target.value) { addPerson(e.target.value); (e.target as HTMLSelectElement).value = '' } }}>
              <option value="">+ Add person to this week...</option>
              {resources.filter(r => !inCrew.has(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}{r.role ? ` (${r.role})` : ''}</option>)}
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
