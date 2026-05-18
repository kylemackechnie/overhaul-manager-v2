import { useEffect, useRef, useState } from 'react'
import { naturalSortItemId } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import { usePermissions, useTimesheetPermissions } from '../../lib/permissions'
import { resolveShift } from '../../lib/shiftPhases'
import { useAppStore } from '../../store/appStore'
import { writeTimesheetCostLines, calcPersonTotals } from '../../engines/timesheetCostEngine'
import { exportTimesheetDetail } from '../../lib/timesheetDetailExport'
import { splitHours } from '../../engines/costEngine'
import { getEurToBase } from '../../lib/currency'
import { toast } from '../../components/ui/Toast'
import { PayrollImportModal } from '../../components/PayrollImportModal'
import { HelpButton } from '../../components/HelpButton'
import type { WeeklyTimesheet, Resource, RateCard, PurchaseOrder, DayEntry, CrewMember } from '../../types'

// Group-header rows in NRG TCE have item_ids like "2.02.4" (3 segments).
// Real bookable lines have 4+ segments. Used by allocation pickers to filter
// out the headers that aren't valid scope/allowance targets.
const isGroupHeader = (id: string | null | undefined, lineType?: string | null): boolean =>
  (!!id && /^\d+\.\d+\.\d+$/.test(id)) || lineType === 'group'

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
  { key: 'travel', label: 'Direct Travel' }, { key: 'sea_travel', label: 'SEA Travel' },
  { key: 'travel_and_work', label: '✈ Direct Travel + Work' },
  { key: 'sea_travel_and_work', label: '✈ SEA Travel + Work' },
]

const TRAVEL_AND_WORK_TYPES = new Set(['travel_and_work', 'sea_travel_and_work'])
const isTravelAndWork = (dt: string) => TRAVEL_AND_WORK_TYPES.has(dt)

function getMon(dateStr: string): string {
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

// Mirrors HTML PH override: walk all day entries and force dayType='public_holiday'
// for any date in the project's holidays set. Called whenever a week becomes active.
function applyPHOverrides(week: WeeklyTimesheet, holidays: Set<string>, resources?: Resource[]): WeeklyTimesheet {
  // Build the 7 dates for this week
  const weekDates: string[] = []
  const mon = new Date(week.week_start + 'T12:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    weekDates.push(d.toISOString().slice(0, 10))
  }

  return {
    ...week,
    crew: week.crew.map(m => {
      const days = { ...m.days }
      let changed = false

      // 1. Public holiday overrides — only apply to days with NO existing entry.
      // If the user has already saved a dayType on a PH day, respect their choice.
      if (holidays.size) {
        weekDates.forEach(ds => {
          if (holidays.has(ds) && !days[ds]) {
            days[ds] = { dayType: 'public_holiday', shiftType: 'day', hours: 0, laha: false, meal: false } as unknown as typeof days[typeof ds]
            changed = true
          }
        })
      }

      // 2. LAHA/meal reconciliation — ensure all on-project days have allowances
      // applied even if they have 0 hours (e.g. Sat/Sun rest days on site)
      const resource = resources?.find(r => r.id === m.personId)
      if (resource) {
        const res = resource as unknown as Record<string, unknown>
        const hasLaha = !!res.allow_laha
        const hasMeal = !!res.allow_meal
        if (hasLaha || hasMeal) {
          const mobIn  = (res.mob_in  as string | null) || null
          const mobOut = (res.mob_out as string | null) || null
          for (const ds of weekDates) {
            const onProject = (!mobIn || ds >= mobIn) && (!mobOut || ds <= mobOut)
            if (!onProject) continue
            const existing = days[ds] as Record<string, unknown> | undefined
            // Only fill if the day entry is missing entirely — don't overwrite
            // explicit user choices on days that already have an entry
            if (!existing) {
              const dow = new Date(ds + 'T12:00:00').getDay()
              const dayType = holidays.has(ds) ? 'public_holiday' : dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
              days[ds] = { dayType, shiftType: 'day', hours: 0, laha: hasLaha, meal: hasMeal } as unknown as typeof days[typeof ds]
              changed = true
            }
          }
        }
      }

      return changed ? { ...m, days } : m
    })
  }
}
// Hour split driven by rate-card thresholds. 12hr cards set wdT15=0/satT15=0
// to collapse to NT→DT. Same logic as the canonical engine.
type RegimeConfig = { wdNT?:number; wdT15?:number; satT15?:number; nightNT?:number; restNT?:number } | null | undefined

// printTimesheet remains local — it renders the print-ready HTML, not pure totals.


function printTimesheet(week: WeeklyTimesheet, projectName: string, rateCards: RateCard[], _holidays: Set<string>) {
  const monday = new Date(week.week_start + 'T12:00:00')
  const days = Array.from({length:7}, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate()+i); return d })
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const rcByRole: Record<string,RateCard> = {}
  rateCards.forEach(r => { rcByRole[r.role.toLowerCase()] = r })

  const fmtDate = (d: Date) => d.toLocaleDateString('en-AU', {day:'2-digit',month:'short',year:'numeric'})
  const typeLabel = week.type === 'mgmt' ? 'Management' : week.type === 'seag' ? 'SE AG' : 'Trades'
  const endDate = new Date(monday); endDate.setDate(monday.getDate()+6)

  const personRows = (week.crew || []).map(m => {
    const rc = rcByRole[(m.role||'').toLowerCase()]
    const rates = rc?.rates as {cost:Record<string,number>;sell:Record<string,number>}|null
    let totalHrs = 0, totalSell = 0

    const dayCols = days.map(d => {
      const ds = d.toISOString().slice(0,10)
      const cell = (m.days||{})[ds] as {hours?:number;dayType?:string;shiftType?:string;laha?:boolean;meal?:boolean}|undefined
      if (!cell?.hours) return '<td style="padding:6px 8px;border:1px solid #e2e8f0;text-align:center;color:#ccc">—</td>'
      const adjH = (m.mealBreakAdj && cell.hours > 0) ? 0.5 : 0
      const effH = cell.hours + adjH
      totalHrs += effH
      // Simple sell calc
      let sell = 0
      if (rates) {
        const split: Record<string,number> = {dnt:0,dt15:0,ddt:0,ddt15:0,nnt:0,ndt:0,ndt15:0}
        const h = effH, night = cell.shiftType === 'night', dt = cell.dayType||'weekday'
        if (dt === 'public_holiday') night ? (split.ndt15=h) : (split.ddt15=h)
        else if (dt === 'rest') night ? (split.nnt=h) : (split.dnt=h)
        else if (dt === 'travel'||dt==='sea_travel'||dt==='mob') split.dnt=h
        else if (dt === 'travel_and_work'||dt==='sea_travel_and_work') {
          // Composite: travel_hours at NT, hours at weekday rates
          const tH = (cell as Record<string,unknown>).travel_hours as number || 0
          if (tH > 0) split.dnt = (split.dnt||0) + tH
          // Work portion through normal weekday split (simplified for HTML export)
          const wH = h
          if (wH > 0) { split.dnt=(split.dnt||0)+Math.min(wH,7.2); split.dt15=(split.dt15||0)+Math.min(Math.max(0,wH-7.2),3.3); split.ddt=(split.ddt||0)+Math.max(0,wH-10.5) }
        }
        else if (night) { if (dt==='saturday'||dt==='sunday') split.ndt=h; else { split.nnt=Math.min(h,7.2); split.ndt=Math.max(0,h-7.2) } }
        else if (dt==='saturday') { split.dt15=Math.min(h,3); split.ddt=Math.max(0,h-3) }
        else if (dt==='sunday') split.ddt=h
        else { split.dnt=Math.min(h,7.2); split.dt15=Math.min(Math.max(0,h-7.2),3.3); split.ddt=Math.max(0,h-10.5) }
        Object.entries(split).forEach(([b,bh]) => { sell += bh*(parseFloat(String(rates.sell?.[b] || 0)) || 0) })
      }
      totalSell += sell
      return `<td style="padding:6px 8px;border:1px solid #e2e8f0;text-align:center">
        <div style="font-weight:700">${effH.toFixed(1)}h</div>
        ${sell>0?`<div style="font-size:9px;color:#059669">${week.type==='seag'?'€':'$'}${sell.toFixed(2)}</div>`:''}
      </td>`
    }).join('')

    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600">${m.name}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:11px;color:#555">${m.role||'—'}</td>
      ${dayCols}
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;background:#f8fafc">${totalHrs.toFixed(1)}h</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;color:#059669;font-weight:700;background:#f0fdf4">${totalSell>0?'$'+totalSell.toFixed(0):'—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center;font-size:11px">${m.mealBreakAdj?'✓':''}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${typeLabel} Timesheet — ${week.week_start}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#111}
  h1{font-size:16px;margin-bottom:4px;color:#0f766e}
  .meta{color:#555;font-size:10px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#f1f5f9;padding:7px 8px;border:1px solid #e2e8f0;font-size:10px;text-align:center}
  th.name-col{text-align:left}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
  .sig-line{border-bottom:1px solid #000;height:32px;margin-bottom:3px}
  @media print{@page{size:A3 landscape}button{display:none}}
</style></head><body>
<h1>${typeLabel} Timesheet — Week of ${fmtDate(monday)} to ${fmtDate(endDate)}</h1>
<div class="meta">${projectName} · ${week.wbs||''}</div>
<table>
  <thead><tr>
    <th class="name-col" style="text-align:left">Name</th>
    <th class="name-col" style="text-align:left">Role</th>
    ${days.map((d,i) => `<th>${dayLabels[i]}<br/><span style="font-size:9px;font-weight:400">${d.toLocaleDateString('en-AU',{day:'2-digit',month:'short'})}</span></th>`).join('')}
    <th>Total Hrs</th><th>Sell</th><th>MBA</th>
  </tr></thead>
  <tbody>${personRows}</tbody>
</table>
<div class="sig">
  <div><div class="sig-line"></div><div style="font-size:10px">Site Manager &nbsp; Date: ___________</div></div>
  <div><div class="sig-line"></div><div style="font-size:10px">Prepared by &nbsp; Date: ___________</div></div>
</div>
<div style="margin-top:16px;font-size:9px;color:#999">Generated by Overhaul Manager · ${new Date().toLocaleString('en-AU')} · CONFIDENTIAL</div>
<script>setTimeout(()=>window.print(),400)<\/script>
</body></html>`

  const win = window.open('', '_blank', 'width=1200,height=800')
  if (win) { win.document.write(html); win.document.close() }
}

function printCostBreakdown(week: WeeklyTimesheet, projectName: string, rateCards: RateCard[], regime: string) {
  const monday = new Date(week.week_start + 'T12:00:00')
  const days = Array.from({length:7}, (_,i) => { const d = new Date(monday); d.setDate(monday.getDate()+i); return d })
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const rcByRole: Record<string,RateCard> = {}
  rateCards.forEach(r => { rcByRole[r.role.toLowerCase()] = r })
  const fmtDate = (d: Date) => d.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })
  const fmtMoney = (n: number) => n > 0 ? `$${n.toLocaleString('en-AU', { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—'
  const fmtHrs = (n: number) => n > 0 ? `${n.toFixed(2)}h` : '—'
  const endDate = new Date(monday); endDate.setDate(monday.getDate()+6)
  const genDate = new Date().toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })
  void fmtDate; void endDate

  const RATE_TYPES = [
    { key: 'dnt',   label: 'DS Normal Time',   color: '#0ea5e9' },
    { key: 'dt15',  label: 'DS Time & Half',    color: '#f97316' },
    { key: 'ddt',   label: 'DS Double Time',    color: '#8b5cf6' },
    { key: 'ddt15', label: 'DS Public Holiday', color: '#ef4444' },
  ]
  const CELL = 'padding:5px 8px;border:1px solid #e2e8f0;text-align:right;vertical-align:top;'
  const CELL_L = 'padding:5px 10px;border:1px solid #e2e8f0;vertical-align:top;'
  const HDR = 'padding:6px 8px;border:1px solid #cbd5e1;background:#f8fafc;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;text-align:right;'
  const HDR_L = 'padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;text-align:left;'

  const personBlocks = (week.crew || []).map(m => {
    const rc = rcByRole[(m.role||'').toLowerCase()]
    if (!rc) return ''
    const rcAny = rc as unknown as Record<string,unknown>
    const rates = (rcAny.rates as {sell:Record<string,number>}|undefined)?.sell || {}
    const isMgmt = String(rcAny.category) === 'management' || String(rcAny.category) === 'seag'

    const dayBreaks = days.map(d => {
      const ds = d.toISOString().slice(0,10)
      const cell = (m.days||{})[ds] as {hours?:number;dayType?:string;shiftType?:string;laha?:boolean;meal?:boolean;fsa?:boolean;camp?:boolean}|undefined
      if (!cell) return { split:{} as Record<string,number>, sell:{} as Record<string,number>, hours:0, totalSell:0, allowances:[] as {label:string;sell:number}[] }
      const adjH = (m.mealBreakAdj && !isMgmt && (cell?.hours||0) > 10) ? 0.5 : 0
      const effH = (cell.hours||0) + adjH
      const sp = effH > 0 ? splitHours(effH, cell.dayType||'weekday', cell.shiftType||'day', rc.regime) as unknown as Record<string,number> : {} as Record<string,number>
      const sellMap: Record<string,number> = {}
      if (effH > 0) { for (const rt of RATE_TYPES) { sellMap[rt.key] = (sp[rt.key]||0) * (parseFloat(String(rates[rt.key]||0))||0) } }
      const totalSell = Object.values(sellMap).reduce((s,v) => s+v, 0)
      const allowances: {label:string;sell:number}[] = []
      if (cell.laha) allowances.push({ label: isMgmt?'FSA':'LAHA', sell: parseFloat(String(isMgmt?rcAny.fsa_sell:rcAny.laha_sell))||0 })
      if (cell.meal) allowances.push({ label:'Meal', sell: parseFloat(String(rcAny.meal_sell))||0 })
      if (cell.fsa && !cell.laha) allowances.push({ label:'FSA', sell: parseFloat(String(rcAny.fsa_sell))||0 })
      if (cell.camp) allowances.push({ label:'Camp', sell: parseFloat(String(rcAny.camp_sell||rcAny.fsa_sell))||0 })
      return { split:sp, sell:sellMap, hours:effH, totalSell, allowances }
    })

    const weekTotalHrs  = dayBreaks.reduce((s,d) => s+d.hours, 0)
    const weekTotalSell = dayBreaks.reduce((s,d) => s+d.totalSell, 0)
    const weekAllowances = dayBreaks.reduce((s,d) => s+d.allowances.reduce((a,al) => a+al.sell, 0), 0)
    const weekGrandTotal = weekTotalSell + weekAllowances

    const rateRows = RATE_TYPES.map(rt => {
      const weekHrs  = dayBreaks.reduce((s,d) => s+(d.split[rt.key]||0), 0)
      const weekSell = dayBreaks.reduce((s,d) => s+(d.sell[rt.key]||0), 0)
      if (!weekHrs) return ''
      const cells = dayBreaks.map(d => {
        const h = d.split[rt.key]||0, sv = d.sell[rt.key]||0
        return h ? `<td style="${CELL}"><span style="font-weight:600">${fmtHrs(h)}</span><br/><span style="font-size:9px;color:#555">${fmtMoney(sv)}</span></td>`
                 : `<td style="${CELL}color:#ccc">—</td>`
      }).join('')
      return `<tr><td style="${CELL_L}color:${rt.color};font-weight:500">${rt.label}</td>${cells}<td style="${CELL}font-weight:700">${fmtHrs(weekHrs)}<br/><span style="font-size:9px;color:#374151">${fmtMoney(weekSell)}</span></td></tr>`
    }).filter(Boolean).join('')

    const hrsRow = `<tr style="background:#f8fafc"><td style="${CELL_L}font-weight:600">Hours Total</td>${dayBreaks.map(d => d.hours ? `<td style="${CELL}font-weight:700">${fmtHrs(d.hours)}<br/><span style="font-size:9px">${fmtMoney(d.totalSell)}</span></td>` : `<td style="${CELL}color:#ccc">—</td>`).join('')}<td style="${CELL}font-weight:700">${fmtHrs(weekTotalHrs)}<br/><span style="font-size:9px">${fmtMoney(weekTotalSell)}</span></td></tr>`

    const allowRow = weekAllowances > 0 ? `<tr><td style="${CELL_L}color:#6b7280">Allowances</td>${dayBreaks.map(d => d.allowances.length ? `<td style="${CELL}font-size:10px">${d.allowances.map(a => `${a.label} ${fmtMoney(a.sell)}`).join('<br/>')}</td>` : `<td style="${CELL}color:#ccc">—</td>`).join('')}<td style="${CELL}color:#6b7280">${fmtMoney(weekAllowances)}</td></tr>` : ''

    const totRow = `<tr style="background:#f1f5f9"><td style="${CELL_L}font-weight:700;text-transform:uppercase;font-size:10px">TOTAL</td>${dayBreaks.map(d => { const t = d.totalSell + d.allowances.reduce((s,a)=>s+a.sell,0); return t>0?`<td style="${CELL}color:#6b7280;font-size:11px">A$${t.toFixed(2)}</td>`:`<td style="${CELL}color:#ccc">—</td>` }).join('')}<td style="${CELL}font-weight:700;font-size:12px">A$${weekGrandTotal.toFixed(2)}</td></tr>`

    const dayHdrs = days.map((d,i) => `<th style="${HDR}">${dayLabels[i]}<br/><span style="font-weight:400">${d.toLocaleDateString('en-AU',{day:'2-digit',month:'short'})}</span></th>`).join('')

    return `<div style="margin-bottom:32px;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin-bottom:8px">
        <div><span style="font-size:15px;font-weight:700">${m.name}</span><span style="font-size:12px;color:#6b7280;margin-left:8px">${m.role}</span></div>
        <div style="font-size:14px;font-weight:700;color:#059669">A$${weekGrandTotal.toFixed(2)} total</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr><th style="${HDR_L}width:140px">Rate Type</th>${dayHdrs}<th style="${HDR}width:90px">Week Total</th></tr></thead>
        <tbody>${rateRows}${hrsRow}${allowRow}${totRow}</tbody>
      </table></div>`
  }).filter(Boolean).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Trades Cost Breakdown — ${week.week_start}</title>
  <style>body{font-family:-apple-system,Arial,sans-serif;font-size:11px;padding:28px;color:#111;max-width:1200px;margin:0 auto}@media print{@page{size:A3 landscape;margin:10mm}button{display:none!important}body{padding:10px;max-width:none}}</style>
  </head><body>
  <button onclick="window.print()" style="position:fixed;top:12px;right:12px;padding:6px 16px;background:#0f766e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">🖨 Print</button>
  <h1 style="font-size:20px;font-weight:800;margin:0 0 4px">Trades Timesheet — Customer Cost Breakdown</h1>
  <div style="font-size:11px;color:#6b7280;margin-bottom:28px">${projectName} · Week of ${week.week_start} · ${regime||'Under 12hrs'} · Generated ${genDate}</div>
  ${personBlocks}
  <div style="margin-top:24px;font-size:9px;color:#999;border-top:1px solid #e2e8f0;padding-top:8px">Generated by Overhaul Manager · ${new Date().toLocaleString('en-AU')} · CONFIDENTIAL</div>
  <script>setTimeout(()=>window.print(),600)<\/script></body></html>`

  const win = window.open('', '_blank', 'width=1400,height=900')
  if (win) { win.document.write(html); win.document.close() }
}


// Spec shape for nrgWoAllocations[] entries in day cells
// These three shapes coexist in the same array:
// 1. TasTK-imported: { wo, hours } — no _tceMode, no tceItemId — NEVER overwrite
// 2. Manual WO-keyed: { wo, tceItemId:null, _tceMode:true, hours, label } — skilled labour by WO
// 3. Manual item-keyed: { wo:'', tceItemId, _tceMode:true, hours, label } — overheads or skilled no-WO
interface NrgWoAlloc {
  wo: string
  tceItemId: string | null
  _tceMode?: true
  hours: number
  label?: string
}

// One row in the multi-match resolver modal. Identifies a single TasTK-imported
// alloc that needs splitting, and tracks the user's hour-per-candidate input.
interface ResolveSplit {
  personId: string
  personName: string
  date: string
  wo: string
  totalHours: number
  /** All candidate items that share this WO. The split[] array is parallel — the
   *  hours the user wants to attribute to each candidate. Defaults to first
   *  candidate gets all hours. */
  candidates: { itemId: string; description: string }[]
  split: number[]
}

export function TimesheetsPanel({ type }: { type: TsType }) {
  const { activeProject } = useAppStore()
  const isTce = activeProject?.cost_method === 'nrg_tce'
  const { canWrite } = usePermissions()
  const tsPerms = useTimesheetPermissions(activeProject ?? null)
  const [sheets, setSheets] = useState<WeeklyTimesheet[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])
  const [holidays, setHolidays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [activeWeek, setActiveWeek] = useState<WeeklyTimesheet | null>(null)
  const [noteOpen, setNoteOpen] = useState<string | null>(null) // `${personId}__${date}`
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ week_start: getMon(new Date().toISOString().slice(0, 10)), wbs: '', notes: '', vendor: '', po_id: '' })
  const [saving, setSaving] = useState(false)
  const [showPayrollImport, setShowPayrollImport] = useState(false)
  const [woAllocModal, setWoAllocModal] = useState<{personId:string;date:string;hours:number;name:string}|null>(null)
  const [woAllocRows, setWoAllocRows] = useState<{woId:string;woNumber:string;hours:number}[]>([])
  const [workOrders, setWorkOrders] = useState<{id:string;wo_number:string;description:string}[]>([])
  // Spec: scopeTracking is per-week on weekly_timesheets, not project-level.
  // Read from activeWeek if available, fall back to project setting.
  // getScopeTrackingMode(week): reads week.scope_tracking if present,
  // else maps legacy week.woTracking===true to 'wo' (migration path).
  const scopeMode = (() => {
    if (!activeWeek) return activeProject?.scope_tracking || 'none'
    const ws = activeWeek as WeeklyTimesheet & { scope_tracking?: string; woTracking?: boolean }
    if (ws.scope_tracking) return ws.scope_tracking
    if (ws.woTracking === true) return 'work_orders'  // legacy migration
    return activeProject?.scope_tracking || 'none'
  })()

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
  const [tceAllocRows, setTceAllocRows] = useState<{key:string;label:string;hours:number;payCode?:string}[]>([])
  const [tceLines, setTceLines] = useState<{item_id:string;description:string;work_order:string|null;source:string;line_type:string|null;unit_type:string|null}[]>([])
  // Multi-match resolver — opens a modal listing every TasTK-imported alloc whose
  // WO maps to >1 TCE candidate item. User splits the hours, then save replaces
  // each ambiguous alloc with explicit {wo, tceItemId, hours} rows.
  const [resolveModal, setResolveModal] = useState<{open:boolean; splits: ResolveSplit[]}>({open:false, splits:[]})

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, type])
  useEffect(() => {
    if (activeProject) {
      supabase.from('work_orders').select('id,wo_number,description').eq('project_id', activeProject.id).neq('status','cancelled').order('wo_number')
        .then(r => setWorkOrders((r.data||[]) as {id:string;wo_number:string;description:string}[]))
      // Always load TCE lines when project has them — needed for allocation modal regardless of scope_tracking
      supabase.from('nrg_tce_lines').select('item_id,description,work_order,source,line_type,unit_type').eq('project_id', activeProject.id).order('sort_order').order('item_id')
        .then(r => setTceLines((r.data||[]) as {item_id:string;description:string;work_order:string|null;source:string;line_type:string|null;unit_type:string|null}[]))
    }
  }, [activeProject?.id])

  // ── Auto-save ─────────────────────────────────────────────────────────────
  // Debounce: save 1.5s after the last change to activeWeek.
  // Skip on initial mount (when activeWeek first becomes non-null from a load).
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevWeekId    = useRef<string | null>(null)
  useEffect(() => {
    if (!activeWeek) { prevWeekId.current = null; return }
    // Don't auto-save on the first render of a newly-loaded week
    if (activeWeek.id !== prevWeekId.current) { prevWeekId.current = activeWeek.id; return }
    // Don't auto-save approved timesheets — they are locked; only explicit PM actions can update them
    if (activeWeek.status === 'approved') return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => { saveWeek(activeWeek) }, 1500)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [activeWeek])

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
    const { data, error } = await supabase.from('weekly_timesheets').insert({
      project_id: activeProject!.id, type, week_start: ws, wbs: newForm.wbs, notes: newForm.notes,
      regime: 'lt12', status: 'draft', vendor: newForm.vendor || null, po_id: newForm.po_id || null, crew: [],
    }).select('*').single()
    if (error) { console.error('createWeek error:', error); toast(error.message + (error.details ? ' — ' + error.details : ''), 'error'); setSaving(false); return }
    toast('Week created', 'success'); setSaving(false); setShowNewModal(false)
    setNewForm({ week_start: getMon(new Date().toISOString().slice(0, 10)), wbs: '', notes: '', vendor: '', po_id: '' })
    setActiveWeek(applyPHOverrides(data as WeeklyTimesheet, holidays, resources)); load()
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
    if (total > woAllocModal.hours + 0.01) { toast(`Total (${total.toFixed(2)}h) exceeds shift hours (${woAllocModal.hours}h)`, 'error'); return }
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

  const [dupModal, setDupModal] = useState<WeeklyTimesheet|null>(null)
  const [dupMode, setDupMode] = useState<'copy'|'standard'|'blank'>('copy')
  const [dupCopyTce, setDupCopyTce] = useState(true)

  // Sync crew member fields from current resource list (name, role, wbs, mealBreakAdj)
  // Returns updated crew array — only touches members that have a matching resource by personId
  function syncCrew(crew: WeeklyTimesheet['crew']): WeeklyTimesheet['crew'] {
    return crew.map(m => {
      const res = resources.find(r => r.id === m.personId)
      if (!res) return m
      return {
        ...m,
        days: m.days as Record<string, DayEntry>,
        name: res.name,
        role: res.role,
        wbs: res.wbs || m.wbs,
        mealBreakAdj: res.meal_break_adj ?? m.mealBreakAdj,
      } as CrewMember
    })
  }

  async function syncTimesheetCrew(s: WeeklyTimesheet) {
    const synced = syncCrew(s.crew)
    const changed = synced.some((m, i) =>
      m.name !== s.crew[i].name || m.role !== s.crew[i].role ||
      m.wbs !== s.crew[i].wbs || m.mealBreakAdj !== s.crew[i].mealBreakAdj
    )
    if (!changed) { toast('Already up to date', 'success'); return }
    const { error } = await supabase.from('weekly_timesheets').update({ crew: synced }).eq('id', s.id)
    if (error) { toast(error.message, 'error'); return }
    // Update local state
    setSheets(prev => prev.map(t => t.id === s.id ? { ...t, crew: synced } : t))
    if (activeWeek?.id === s.id) setActiveWeek(w => w ? { ...w, crew: synced } : w)
    toast('Crew synced from resources', 'success')
  }

  async function confirmDuplicate(src: WeeklyTimesheet, mode: 'copy'|'standard'|'blank', copyTce: boolean) {
    const ws = new Date(src.week_start + 'T12:00:00')
    ws.setDate(ws.getDate() + 7)
    const newStart = ws.toISOString().slice(0, 10)
    const std = activeProject?.std_hours as {day:Record<string,number>;night:Record<string,number>} | null

    const newCrew = src.crew.map(m => {
      if (mode === 'copy') {
        const newDays: Record<string, unknown> = {}
        Object.entries(m.days || {}).forEach(([ds, cell]) => {
          const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + 7)
          const newDs = d.toISOString().slice(0, 10)
          newDays[newDs] = { ...(cell as object), dayType: autoType(newDs, holidays) }
          delete (newDays[newDs] as Record<string,unknown>).woAllocations
          if (!copyTce) delete (newDays[newDs] as Record<string,unknown>).nrgWoAllocations
        })
        return { ...m, days: newDays }
      } else if (mode === 'standard' && std) {
        const res = resources.find(r => r.id === m.personId)
        return { ...m, days: res ? buildPreDays(res, newStart) : {} }
      } else {
        return { ...m, days: {} }
      }
    })

    const { error } = await supabase.from('weekly_timesheets').insert({
      project_id: src.project_id, type: src.type, week_start: newStart,
      wbs: src.wbs, notes: src.notes, regime: src.regime, status: 'draft',
      vendor: src.vendor, po_id: src.po_id, crew: syncCrew(newCrew as CrewMember[]),
    })
    if (error) { toast(error.message, 'error'); return }
    toast('Week duplicated', 'success'); setDupModal(null); load()
  }

  function duplicateWeek(s: WeeklyTimesheet) { setDupMode('copy'); setDupModal(s) }

  function getNextMon(weekStart: string): string {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    return getMon(d.toISOString().slice(0, 10))
  }

  async function saveWeek(week: WeeklyTimesheet) {
    const { error } = await supabase.from('weekly_timesheets').update({
      crew: week.crew, regime: week.regime, status: week.status, wbs: week.wbs, notes: week.notes,
      scope_tracking: (week as WeeklyTimesheet & { scope_tracking?: string }).scope_tracking || 'none',
      allowances_tce_default: (week as WeeklyTimesheet & { allowances_tce_default?: string }).allowances_tce_default || '',
      travel_tce_default: (week as WeeklyTimesheet & { travel_tce_default?: string }).travel_tce_default || '',
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
    // Write timesheet_cost_lines — single source of truth for TCE actuals + invoicing
    try {
      await writeTimesheetCostLines(week, activeProject!.id, rateCards, tceLines, resources, activeProject, holidays)
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

  async function approveTimesheet(s: WeeklyTimesheet) {
    if (!tsPerms.canApprove) return toast('Only a Project Manager or Administrator can approve timesheets', 'error')
    const { currentUser } = useAppStore.getState()
    const updates = { status: 'approved', approved_by: currentUser?.id ?? null, approved_at: new Date().toISOString() }
    const { error } = await supabase.from('weekly_timesheets').update(updates).eq('id', s.id)
    if (error) { toast(error.message, 'error'); return }
    // Write cost lines immediately on approval
    const { error: clErr } = await writeTimesheetCostLines({ ...s, ...updates } as WeeklyTimesheet, activeProject!.id, rateCards, tceLines, resources, activeProject, holidays)
    if (clErr) console.warn('[TimesheetsPanel] Cost line write failed:', clErr)
    toast('Timesheet approved and locked', 'success')
    load()
    if (activeWeek?.id === s.id) setActiveWeek(null)
  }

  async function backfillCostLines() {
    const approved = sheets.filter(s => s.status === 'approved')
    if (!approved.length) { toast('No approved timesheets to backfill', 'info'); return }
    let count = 0
    for (const s of approved) {
      const { error } = await writeTimesheetCostLines(s, activeProject!.id, rateCards, tceLines, resources, activeProject, holidays)
      if (error) console.warn('[backfill] Failed for week', s.week_start, error)
      else count++
    }
    toast(`Cost lines recalculated for ${count} timesheet${count !== 1 ? 's' : ''}`, 'success')
  }

  async function submitTimesheet(s: WeeklyTimesheet) {
    if (!tsPerms.canSubmit) return toast('Only the Project Manager or Administrator can submit timesheets', 'error')
    const { error } = await supabase.from('weekly_timesheets').update({ status: 'submitted' }).eq('id', s.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Timesheet submitted for approval', 'success')
    load()
    if (activeWeek?.id === s.id) setActiveWeek({ ...s, status: 'submitted' })
  }

  async function unlockTimesheet(s: WeeklyTimesheet) {
    if (!tsPerms.canUnlock) return toast('Only a Project Manager or Administrator can unlock timesheets', 'error')
    const reason = prompt('Reason for unlocking this timesheet (required):')
    if (!reason || !reason.trim()) { toast('Unlock cancelled — reason is required', 'info'); return }
    const { currentUser } = useAppStore.getState()
    const updates = {
      status: 'draft',
      approved_by: null, approved_at: null,
      unlocked_by: currentUser?.id ?? null,
      unlocked_at: new Date().toISOString(),
      unlock_reason: reason.trim(),
    }
    const { error } = await supabase.from('weekly_timesheets').update(updates).eq('id', s.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Timesheet unlocked and returned to draft', 'success')
    load()
    if (activeWeek?.id === s.id) setActiveWeek({ ...s, ...updates } as WeeklyTimesheet)
  }

  function setDay(personId: string, date: string, field: string, value: unknown) {
    if (!activeWeek) return
    setActiveWeek({
      ...activeWeek,
      crew: activeWeek.crew.map(m => {
        if (m.personId !== personId) return m
        const rawEntry = m.days[date]
        const existing: DayEntry = rawEntry
          ? rawEntry as DayEntry
          : { dayType: autoType(date, holidays), shiftType: 'day' as const, hours: 0, laha: false, meal: false }
        return { ...m, days: { ...m.days, [date]: { ...existing, [field]: value } as DayEntry } }
      })
    })
  }

  // Set multiple day fields atomically (used by FSA/Camp radio buttons)
  function setDayMulti(personId: string, date: string, fields: Record<string, unknown>) {
    if (!activeWeek) return
    setActiveWeek({
      ...activeWeek,
      crew: activeWeek.crew.map(m => {
        if (m.personId !== personId) return m
        const rawEntry = m.days[date]
        const existing: DayEntry = rawEntry
          ? rawEntry as DayEntry
          : { dayType: autoType(date, holidays), shiftType: 'day' as const, hours: 0, laha: false, meal: false }
        return { ...m, days: { ...m.days, [date]: { ...existing, ...fields } as DayEntry } }
      })
    })
  }


  function openTceAlloc(personId: string, date: string, hours: number, name: string) {
    const member = activeWeek?.crew.find(m => m.personId === personId)
    const dayRaw = (member?.days?.[date] as Record<string,unknown>) || {}
    const allAllocs = (dayRaw.nrgWoAllocations as NrgWoAlloc[]) || []
    const dayType = (dayRaw.dayType as string) || 'weekday'
    const travelHours = (dayRaw.travel_hours as number) || 0

    // Show all rows that have any scope identity — _tceMode manual rows, tceItemId rows, and WO-keyed TasTK rows
    const tceRows = allAllocs
      .filter(a => a._tceMode || a.tceItemId || a.wo)
      .map(a => ({
        key: a.tceItemId ? `tce:${a.tceItemId}` : `wo:${a.wo}`,
        label: a.label || (a.tceItemId ? a.tceItemId : a.wo) || '',
        hours: a.hours,
        wo: a.wo || '',
        tceItemId: a.tceItemId || null,
        payCode: (a as NrgWoAlloc & {payCode?:string}).payCode,
      }))

    // For composite travel+work days, auto-add a travel row if not already present
    if (isTravelAndWork(dayType) && travelHours > 0 && tceRows.length === 0) {
      const memberAny = member as unknown as { travelTceItemId?: string | null }
      const tsTravelDefault = (activeWeek as WeeklyTimesheet & { travel_tce_default?: string }).travel_tce_default || ''
      const travelItemId = memberAny?.travelTceItemId || tsTravelDefault || ''
      const travelLine = tceLines.find(l => l.item_id === travelItemId)
      if (travelItemId) {
        tceRows.push({
          key: `tce:${travelItemId}`,
          label: `[OH] ${travelItemId}${travelLine ? ' — ' + travelLine.description : ''}`,
          hours: travelHours,
          wo: '',
          tceItemId: travelItemId,
          payCode: undefined,
        })
      }
    }

    setTceAllocRows(tceRows.length ? tceRows : [])
    setTceAllocModal({ personId, date, hours, name })
  }

  function saveTceAlloc() {
    if (!tceAllocModal || !activeWeek) return
    const total = tceAllocRows.reduce((s, r) => s + (r.hours || 0), 0)
    if (total > tceAllocModal.hours + 0.01) { toast(`Total exceeds shift hours`, 'error'); return }
    const updated = activeWeek.crew.map(m => {
      if (m.personId !== tceAllocModal.personId) return m
      const allAllocs = ((m.days?.[tceAllocModal.date] as Record<string,unknown>)?.nrgWoAllocations as NrgWoAlloc[]) || []
      // Preserve only rows with no scope identity at all (shouldn't normally exist,
      // but guards against data we don't understand). WO-keyed and item-keyed rows
      // are all shown in the editor and replaced on save.
      const preserved = allAllocs.filter(a => !a._tceMode && !a.tceItemId && !a.wo)
      // Convert editor rows to correct spec shape
      const tceFinal: NrgWoAlloc[] = tceAllocRows.filter(r => r.hours > 0 && r.key).map(r => {
        if (r.key.startsWith('wo:')) {
          const wo = r.key.slice(3)
          return { wo, tceItemId: null, _tceMode: true as const, hours: r.hours, label: r.label, ...(r.payCode ? { payCode: r.payCode } : {}) }
        } else {
          const tceItemId = r.key.startsWith('tce:') ? r.key.slice(4) : r.key
          return { wo: '', tceItemId, _tceMode: true as const, hours: r.hours, label: r.label, ...(r.payCode ? { payCode: r.payCode } : {}) }
        }
      })
      const dayEntry = (m.days?.[tceAllocModal.date] as Record<string,unknown>) || {}
      return { ...m, days: { ...m.days, [tceAllocModal.date]: { ...dayEntry, nrgWoAllocations: [...preserved, ...tceFinal] } as unknown as DayEntry } }
    })
    setActiveWeek({ ...activeWeek, crew: updated })
    setTceAllocModal(null)
    toast('TCE allocations saved', 'success')
  }

  // Three-tier dropdown per spec _getNrgTceAllocOptions():
  // Tier 1: [WO] Skilled labour grouped by Work Order (345 scopes → ~207 WO entries)
  // Tier 2: [SL] Skilled labour without a Work Order (direct item_id allocation)
  // Overhead, Fixed Price, and Fixed Hours lines excluded — not allocatable labour.
  // Must read tceLines live — do NOT memoize (edits in TCE register must reflect immediately)
  const isFixedUnit = (l: {unit_type:string|null}) => {
    const u = (l.unit_type || '').toLowerCase()
    return u === 'fixed hours' || u === 'fixed price'
  }
  function getTceOptions(): {key:string; label:string}[] {
    const isGroupHeader = (id: string|null) => !!id && /^\d+\.\d+\.\d+$/.test(id)
    const opts: {key:string;label:string}[] = []

    // Tier 1: Skilled labour with WO — grouped by WO (exclude fixed unit types)
    const skilledWithWo = tceLines.filter(l => l.source === 'skilled' && l.work_order && !isGroupHeader(l.item_id) && !isFixedUnit(l))
    const byWo: Record<string, typeof skilledWithWo> = {}
    skilledWithWo.forEach(l => {
      const wo = l.work_order!
      if (!byWo[wo]) byWo[wo] = []
      byWo[wo].push(l)
    })
    Object.entries(byWo).sort((a,b) => a[0].localeCompare(b[0], undefined, {numeric:true})).forEach(([wo, ls]) => {
      const extra = ls.length > 1 ? ` (+${ls.length-1} scopes)` : ''
      opts.push({ key: `wo:${wo}`, label: `[WO] ${wo} — ${ls[0]?.description?.slice(0,40)||''}${extra}` })
    })

    // Tier 2: Skilled labour WITHOUT a Work Order (fallback, direct item_id)
    tceLines.filter(l => l.source === 'skilled' && !l.work_order && !isGroupHeader(l.item_id) && !isFixedUnit(l)).forEach(l => {
      opts.push({ key: `tce:${l.item_id}`, label: `[SL] ${l.item_id} — ${l.description?.slice(0,50)||''}` })
    })

    // Tier 3: Overhead lines (not WO-tracked, allocate by item_id; exclude fixed unit types)
    tceLines.filter(l => l.source === 'overhead' && !isGroupHeader(l.item_id) && !isFixedUnit(l)).forEach(l => {
      opts.push({ key: `tce:${l.item_id}`, label: `[OH] ${l.item_id} — ${l.description?.slice(0,50)||''}` })
    })

    // Fixed Price/Fixed Hours lines excluded — not allocatable labour

    return opts
  }

  // ── Allowance / Travel TCE option renderer ──────────────────────────────
  // Renders <optgroup> sections matching TCE register order (skilled → overhead).
  // Excludes group-header rows, Fixed Price line_type, and Fixed Hours/Fixed Price unit types.
  function renderAllowanceTceOptions(excludeSkilled = false) {
    const skilled = tceLines.filter(l =>
      l.item_id &&
      l.source === 'skilled' &&
      !isGroupHeader(l.item_id, l.line_type) &&
      l.line_type !== 'Fixed Price' &&
      !isFixedUnit(l)
    ).sort((a,b) => naturalSortItemId(a.item_id, b.item_id))
    const overhead = tceLines.filter(l =>
      l.item_id &&
      l.source === 'overhead' &&
      !isGroupHeader(l.item_id, l.line_type) &&
      l.line_type !== 'Fixed Price' &&
      !isFixedUnit(l)
    ).sort((a,b) => naturalSortItemId(a.item_id, b.item_id))
    return (
      <>
        {!excludeSkilled && skilled.length > 0 && (
          <optgroup label="Skilled Labour">
            {skilled.map(l => (
              <option key={l.item_id} value={l.item_id}>{l.item_id} — {l.description}</option>
            ))}
          </optgroup>
        )}
        {overhead.length > 0 && (
          <optgroup label="Overhead">
            {overhead.map(l => (
              <option key={l.item_id} value={l.item_id}>{l.item_id} — {l.description}</option>
            ))}
          </optgroup>
        )}
      </>
    )
  }

  // ── Multi-match resolver helpers ────────────────────────────────────────
  // Map of WO → candidate TCE items. When a TasTK-imported alloc references a
  // WO with >1 candidate, the writer can't auto-resolve and the time becomes
  // unallocated. The resolver lets the user split it explicitly.
  function buildCandidatesByWo(): Record<string, { itemId: string; description: string }[]> {
    const isHdr = (id: string|null) => !!id && /^\d+\.\d+\.\d+$/.test(id)
    const byWo: Record<string, { itemId: string; description: string }[]> = {}
    tceLines.filter(l => l.source === 'skilled' && l.work_order && !isHdr(l.item_id)).forEach(l => {
      const wo = l.work_order!
      if (!byWo[wo]) byWo[wo] = []
      byWo[wo].push({ itemId: l.item_id, description: l.description || '' })
    })
    return byWo
  }

  // Collect every TasTK-imported alloc in the active week whose WO has multiple
  // candidates. TasTK rows are identified by !_tceMode && !tceItemId per spec.
  function findUnresolvedAllocs(): ResolveSplit[] {
    if (!activeWeek) return []
    const byWo = buildCandidatesByWo()
    const out: ResolveSplit[] = []
    for (const member of activeWeek.crew) {
      for (const [date, d] of Object.entries(member.days || {})) {
        const allocs = ((d as Record<string, unknown>).nrgWoAllocations as NrgWoAlloc[]) || []
        for (const a of allocs) {
          if (a._tceMode || a.tceItemId) continue  // only TasTK rows
          if (!a.wo) continue
          const candidates = byWo[a.wo] || []
          if (candidates.length < 2) continue  // 0 = no match, 1 = auto-resolves
          const split = candidates.map((_, i) => i === 0 ? a.hours : 0)
          out.push({
            personId: member.personId,
            personName: member.name,
            date, wo: a.wo,
            totalHours: a.hours,
            candidates, split,
          })
        }
      }
    }
    return out
  }

  function openResolveModal() {
    setResolveModal({ open: true, splits: findUnresolvedAllocs() })
  }

  function saveResolveModal() {
    if (!activeWeek) return
    // Validate every row sums to its totalHours
    for (const s of resolveModal.splits) {
      const sum = s.split.reduce((a, b) => a + (b || 0), 0)
      if (Math.abs(sum - s.totalHours) > 0.01) {
        toast(`${s.personName} ${s.date} WO ${s.wo}: split (${sum.toFixed(2)}h) ≠ total (${s.totalHours.toFixed(2)}h)`, 'error')
        return
      }
    }
    // Apply: for each split, replace the matching TasTK alloc on (person, date, wo)
    // with N explicit {wo, tceItemId, hours} rows. Other allocs on that day pass through.
    const newCrew = activeWeek.crew.map(m => {
      const splitsForPerson = resolveModal.splits.filter(s => s.personId === m.personId)
      if (splitsForPerson.length === 0) return m
      const newDays = { ...m.days }
      for (const s of splitsForPerson) {
        const dayEntry = (newDays[s.date] || {}) as Record<string, unknown>
        const allocs = (dayEntry.nrgWoAllocations as NrgWoAlloc[]) || []
        // Drop the ambiguous TasTK alloc; preserve everything else.
        const kept = allocs.filter(a => !(a.wo === s.wo && !a._tceMode && !a.tceItemId))
        // Build the resolved replacements. tce_item_id wins resolution in the writer.
        const replacements: NrgWoAlloc[] = s.candidates
          .map((c, i) => ({ wo: s.wo, tceItemId: c.itemId, _tceMode: true as const, hours: s.split[i] || 0, label: c.description }))
          .filter(r => r.hours > 0)
        newDays[s.date] = { ...dayEntry, nrgWoAllocations: [...kept, ...replacements] } as unknown as DayEntry
      }
      return { ...m, days: newDays }
    })
    setActiveWeek({ ...activeWeek, crew: newCrew })
    setResolveModal({ open: false, splits: [] })
    toast(`Resolved ${resolveModal.splits.length} ambiguous allocation${resolveModal.splits.length === 1 ? '' : 's'}`, 'success')
  }

  // Live count for the banner — re-derived on every render (cheap; O(crew × days × allocs))
  const unresolvedCount = activeWeek ? findUnresolvedAllocs().length : 0

  // TCE hour reconciliation mismatches: days where sum(nrgWoAllocations.hours) ≠ day.hours
  const tceMismatches: { name: string; date: string; dayHours: number; allocHours: number }[] = []
  if (activeWeek && scopeMode === 'nrg_tce') {
    for (const member of activeWeek.crew) {
      for (const [dateStr, day] of Object.entries(member.days)) {
        const d = day as Record<string, unknown>
        if (!d.hours || (d.hours as number) <= 0) continue
        const allocs = ((d.nrgWoAllocations as NrgWoAlloc[]) || []).filter(a => a._tceMode || a.tceItemId || a.wo)
        if (allocs.length === 0) continue
        const allocTotal = allocs.reduce((s, a) => s + (a.hours || 0), 0)
        if (Math.abs(allocTotal - (d.hours as number)) >= 0.05) {
          tceMismatches.push({ name: member.name, date: dateStr, dayHours: d.hours as number, allocHours: parseFloat(allocTotal.toFixed(2)) })
        }
      }
    }
  }
  const [showMismatchConfirm, setShowMismatchConfirm] = useState(false)

  function buildPreDays(r: Resource, weekStart: string): Record<string, DayEntry> {
    // Pre-fill standard hours from project settings and apply resource allowances.
    // LAHA/meal are applied to ALL days the person is on the project (mob window),
    // not just days with standard hours — allowances are paid regardless of hours worked.
    const std = (activeProject as typeof activeProject & {std_hours?: {day:Record<string,number>;night:Record<string,number>}})?.std_hours
    const days: Record<string, DayEntry> = {}
    const dayNames = ['mon','tue','wed','thu','fri','sat','sun']
    const monday = new Date(weekStart + 'T12:00:00')
    const mobIn  = (r as Resource & {mob_in?:string|null}).mob_in  || null
    const mobOut = (r as Resource & {mob_out?:string|null}).mob_out || null
    const hasLaha = !!(r as Resource & {allow_laha?:boolean}).allow_laha
    const hasMeal = !!(r as Resource & {allow_meal?:boolean}).allow_meal
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i)
      const ds = d.toISOString().slice(0, 10)
      const dow = dayNames[i]
      const shift = resolveShift(r, ds)
      const dayType = autoType(ds, holidays)
      const hrs = std ? (shift === 'night' ? (std.night?.[dow] || 0) : (std.day?.[dow] || 0)) : 0
      // Person is on the project this day if within their mob window (or no mob dates set)
      const onProject = (!mobIn || ds >= mobIn) && (!mobOut || ds <= mobOut)
      // Create entry if they have hours, or if they're on project with an allowance to apply
      if (hrs > 0 || (onProject && (hasLaha || hasMeal))) {
        days[ds] = {
          dayType, shiftType: shift === 'night' ? 'night' : 'day', hours: hrs,
          laha: hasLaha && onProject,
          meal: hasMeal && onProject,
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

  const days = activeWeek ? weekDays(activeWeek.week_start) : []
  const inCrew = new Set(activeWeek?.crew.map(m => m.personId) || [])
  // For SE AG weeks, rates are natively EUR — display with € symbol
  const isSeagWeek = type === 'seag'
  const eurToAud = getEurToBase(activeProject)
  const fmt = (n: number) => {
    if (!(n > 0)) return '—'
    if (isSeagWeek) return '€' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  // AUD-equivalent display for SE AG (used in week list subtitle)
  const fmtAudEquiv = (n: number) => n > 0 ? ' ≈$' + (n * eurToAud).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''

  function weekTotals(s: WeeklyTimesheet) {
    let hours = 0, sell = 0, cost = 0
    s.crew.forEach(m => { const t = calcPersonTotals(m, getRC(m.role)); hours += t.hours; sell += t.sell; cost += t.cost })
    return { hours, sell, cost }
  }


  function exportTimesheetCSV() {
    if (!activeWeek) return
    const rows: (string | number)[][] = [
      ['Name', 'Role', 'WBS', ...days.map(d => d), 'Total Hours', 'Total Sell']
    ]
    activeWeek.crew.forEach(m => {
      const t = calcPersonTotals(m, getRC(m.role))
      rows.push([
        m.name, m.role, m.wbs,
        ...days.map(d => {
          const de = m.days[d] as Record<string,unknown> | undefined
          return (de?.hours as number) || 0
        }),
        t.hours.toFixed(2),
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
        <div data-tour="timesheets-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{TYPE_LABELS[type]} Timesheets</h1>
            <HelpButton panelId={`hr-timesheets-${type === 'mgmt' ? 'mgmt' : type === 'seag' ? 'seag' : type === 'subcon' ? 'subcon' : 'trades'}`} />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{sheets.length} weeks · {resources.length} people</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {activeWeek && <>
            <button className="btn" onClick={() => {
              if (tceMismatches.length > 0) { setShowMismatchConfirm(true) }
              else { saveWeek(activeWeek); setActiveWeek(null) }
            }} disabled={!canWrite('personnel')}>💾 Save & Close</button>
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
            {sheets.some(s => s.status === 'approved') && (
              <button className="btn btn-sm" onClick={backfillCostLines} title="Recalculate cost lines for all approved timesheets (fixes missing actuals in MIKA/WBS view)">↺ Recalculate</button>
            )}
          </>}
          <button data-tour="timesheets-new-week" className="btn btn-primary" onClick={() => setShowNewModal(true)} disabled={!canWrite('personnel')}>+ New Week</button>
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
              <div data-tour="timesheets-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '14px' }}>
                {[
                  { label: 'Weeks', value: sheets.length, color: TYPE_COLOR[type] },
                  { label: 'Approved', value: `${approved}/${sheets.length}`, color: 'var(--green)' },
                  { label: 'Total Hours', value: totals.hours.toFixed(2) + 'h', color: TYPE_COLOR[type] },
                  { label: isSeagWeek ? 'Total Sell (EUR)' : 'Total Sell', value: totals.sell > 0 ? fmt(totals.sell) : '—', color: 'var(--green)' },
                ].map(t => (
                  <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
                    <div style={{ fontSize: '11px', marginTop: '3px' }}>{t.label}</div>
                  </div>
                ))}
              </div>
            )
          })()}
          <div data-tour="timesheets-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sheets.map(s => {
              const sc = STATUS_COLORS[s.status] || STATUS_COLORS.draft
              const { hours, sell, cost } = weekTotals(s)
              const endD = new Date(s.week_start + 'T12:00:00'); endD.setDate(endD.getDate() + 6)
              return (
                <div key={s.id} className="card" style={{ borderLeft: `3px solid ${TYPE_COLOR[type]}`, cursor: 'pointer' }} onClick={() => setActiveWeek(applyPHOverrides(s, holidays, resources))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontWeight: 700, fontSize: '14px' }}>
                        Week of {new Date(s.week_start + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })} → {endD.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{s.crew.length} people{s.notes ? ` · ${s.notes}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: TYPE_COLOR[type] }}>{hours.toFixed(1)}h</div><div style={{ fontSize: '11px', color: 'var(--text3)' }}>Total hours</div></div>
                    {sell > 0 && <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(sell)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{isSeagWeek ? 'Sell (EUR)' : 'Sell value'}</div>
                      {isSeagWeek && eurToAud > 1 && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{fmtAudEquiv(sell)} AUD</div>}
                    </div>}
                    {cost > 0 && cost !== sell && <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmt(cost)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{isSeagWeek ? 'Cost (EUR)' : 'Cost'}</div>
                    </div>}
                    <span className="badge" style={sc}>{s.status}</span>
                    <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                      {s.status === 'draft' && tsPerms.canSubmit && (
                        <button className="btn btn-sm" style={{color:'var(--mod-hr)',fontSize:'10px'}} title="Submit for approval" onClick={() => submitTimesheet(s)}>↑ Submit</button>
                      )}
                      {(s.status === 'draft' || s.status === 'submitted') && tsPerms.canApprove && (
                        <button className="btn btn-sm" style={{color:'var(--green)',fontSize:'10px'}} title="Approve timesheet" onClick={() => approveTimesheet(s)}>✓ Approve</button>
                      )}
                      {s.status === 'approved' && tsPerms.canUnlock && (
                        <button className="btn btn-sm" style={{color:'var(--orange,#f97316)',fontSize:'10px'}} title="Unlock timesheet" onClick={() => unlockTimesheet(s)}>🔓 Unlock</button>
                      )}
                      <button className="btn btn-sm" title="Sync crew from resources (name, role, WBS, MBA)" onClick={() => syncTimesheetCrew(s)}>🔄</button>
                      <button className="btn btn-sm" title="Duplicate week" onClick={() => duplicateWeek(s)}>⧉</button>
                      {s.status !== 'approved' && <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => del(s)}>✕</button>}
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
                {activeWeek.status === 'approved' ? (
                  <>
                    <span style={{fontSize:'11px',color:'var(--green)',fontWeight:600}}>🔒 Locked — read only</span>
                    {tsPerms.canUnlock && (
                      <button className="btn btn-sm" style={{color:'var(--orange,#f97316)',fontSize:'11px'}} onClick={() => unlockTimesheet(activeWeek)}>🔓 Unlock</button>
                    )}
                    {tsPerms.canApprove && (
                      <span style={{fontSize:'10px',color:'var(--text3)'}}>Approved by PM / PA</span>
                    )}
                  </>
                ) : (
                  <>
                    {activeWeek.status === 'draft' && tsPerms.canSubmit && (
                      <button className="btn btn-sm" style={{color:'var(--mod-hr)',fontSize:'11px'}} onClick={() => submitTimesheet(activeWeek)}>↑ Submit for Approval</button>
                    )}
                    {(activeWeek.status === 'draft' || activeWeek.status === 'submitted') && tsPerms.canApprove && (
                      <button className="btn btn-sm" style={{color:'var(--green)',fontSize:'11px'}} onClick={() => approveTimesheet(activeWeek)}>✓ Approve</button>
                    )}
                    <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Status:</span>
                    <select className="input" style={{ width: '120px', fontSize: '12px', padding: '3px 6px' }} value={activeWeek.status}
                      onChange={e => tsPerms.canEdit ? setActiveWeek({ ...activeWeek, status: e.target.value as 'draft' | 'submitted' | 'approved' }) : undefined}
                      disabled={!tsPerms.canEdit}>
                      {STATUS_FLOW.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </>
                )}
                {/* Scope tracking: per-week mode for WO or NRG TCE allocation */}
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Scope:</span>
                <select className="input" style={{ width: '140px', fontSize: '12px', padding: '3px 6px' }}
                  value={(activeWeek as WeeklyTimesheet & { scope_tracking?: string }).scope_tracking || 'none'}
                  onChange={e => setActiveWeek({ ...activeWeek, scope_tracking: e.target.value } as WeeklyTimesheet)}>
                  <option value="none">No tracking</option>
                  <option value="work_orders">Work Orders</option>
                  {isTce && tceLines.length > 0 && <option value="nrg_tce">NRG TCE</option>}
                </select>
                {/* Allowance TCE default — only shown when scope is nrg_tce. Per-person
                    overrides set on each crew row take precedence over this default. */}
                {scopeMode === 'nrg_tce' && tceLines.length > 0 && (
                  <>
                    <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Allowance TCE:</span>
                    <select className="input" style={{ width: '180px', fontSize: '12px', padding: '3px 6px' }}
                      value={(activeWeek as WeeklyTimesheet & { allowances_tce_default?: string }).allowances_tce_default || ''}
                      onChange={e => setActiveWeek({ ...activeWeek, allowances_tce_default: e.target.value } as WeeklyTimesheet)}
                      title="Default TCE item for all crew allowances on this timesheet. Override per person below.">
                      <option value="">— Unallocated —</option>
                      {renderAllowanceTceOptions(type === 'trades')}
                    </select>
                    <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Travel TCE:</span>
                    <select className="input" style={{ width: '180px', fontSize: '12px', padding: '3px 6px' }}
                      value={(activeWeek as WeeklyTimesheet & { travel_tce_default?: string }).travel_tce_default || ''}
                      onChange={e => setActiveWeek({ ...activeWeek, travel_tce_default: e.target.value } as WeeklyTimesheet)}
                      title="Default TCE item for all crew travel allowances on this timesheet.">
                      <option value="">— Unallocated —</option>
                      {renderAllowanceTceOptions(type === 'trades')}
                    </select>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Multi-match resolver banner — shown when TasTK imports map to
              ambiguous WOs (>1 candidate TCE item). The writer can't auto-pick,
              so without resolution the hours land as unallocated in NRG Actuals. */}
          {scopeMode === 'nrg_tce' && unresolvedCount > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.4)',
              borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: '8px',
              fontSize: '12px', color: 'var(--orange)', fontWeight: 500, minWidth: '960px',
            }}>
              <span>
                ⚠ <b>{unresolvedCount} TasTK allocation{unresolvedCount === 1 ? '' : 's'}</b> reference
                a Work Order that maps to multiple TCE items. Hours will land as unallocated
                in NRG Actuals until resolved.
              </span>
              <button className="btn btn-sm" style={{ background: 'var(--orange)', color: '#fff' }}
                onClick={openResolveModal}>Resolve allocations →</button>
            </div>
          )}

          {/* TCE hour mismatch banner — shown when alloc hours ≠ day hours */}
          {tceMismatches.length > 0 && (
            <div style={{
              background: 'rgba(220,38,38,0.06)', border: '2px solid rgba(220,38,38,0.5)',
              borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: '8px',
              fontSize: '12px', minWidth: '960px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '16px' }}>🚨</span>
                <span style={{ fontWeight: 700, color: '#dc2626', fontSize: '13px' }}>
                  TCE Hour Mismatch — {tceMismatches.length} day{tceMismatches.length !== 1 ? 's' : ''} where allocated hours ≠ shift hours
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {tceMismatches.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#7f1d1d', background: 'rgba(220,38,38,0.06)', borderRadius: 4, padding: '4px 8px' }}>
                    <span style={{ fontWeight: 600, minWidth: 140 }}>{m.name}</span>
                    <span style={{ color: '#991b1b' }}>{new Date(m.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                    <span>Shift: <b>{m.dayHours}h</b></span>
                    <span>TCE allocated: <b style={{ color: '#dc2626' }}>{m.allocHours}h</b></span>
                    <span style={{ color: '#dc2626', fontWeight: 700 }}>Δ {Math.abs(m.dayHours - m.allocHours).toFixed(2)}h</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#991b1b' }}>
                Re-import TasTK for affected days, or open the 🎯 TCE button on the day cell to adjust allocations manually.
              </div>
            </div>
          )}

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
            const { hours, sell, cost, allowances } = calcPersonTotals(member, rc)
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
                    {/* Bulk TCE scope selector — mgmt/seag/subcon most common use case */}
                    {scopeMode === 'nrg_tce' && (() => {
                      const tceOpts = getTceOptions()
                      // Detect current bulk scope: if all worked days share one TCE-mode alloc, pre-select it
                      const workedDays = days.filter(d => ((member.days[d] as Record<string,unknown>)?.hours as number || 0) > 0)
                      let currentKey = ''
                      if (workedDays.length > 0) {
                        const firstAllocs = ((member.days[workedDays[0]] as Record<string,unknown>)?.nrgWoAllocations as NrgWoAlloc[] || []).filter(a => a._tceMode || a.tceItemId || a.wo)
                        if (firstAllocs.length === 1) {
                          const fk = firstAllocs[0].tceItemId ? `tce:${firstAllocs[0].tceItemId}` : `wo:${firstAllocs[0].wo}`
                          const allMatch = workedDays.every(d => {
                            const da = ((member.days[d] as Record<string,unknown>)?.nrgWoAllocations as NrgWoAlloc[] || []).filter(a => a._tceMode || a.tceItemId || a.wo)
                            return da.length === 1 && (da[0].tceItemId ? `tce:${da[0].tceItemId}` : `wo:${da[0].wo}`) === fk
                          })
                          if (allMatch) currentKey = fk
                        }
                      }
                      return (
                        <div style={{ marginTop: '2px' }}>
                          <div style={{ fontSize: '9px', color: '#be185d', fontWeight: 600, marginBottom: '2px' }}>🎯 TCE Scope</div>
                          <select
                            value={currentKey}
                            style={{ width: '100%', fontSize: '9px', padding: '2px 3px', border: `1px solid ${currentKey ? '#be185d' : 'var(--border2)'}`, borderRadius: '3px', background: currentKey ? 'rgba(244,114,182,0.06)' : 'var(--bg3)', color: currentKey ? '#be185d' : 'var(--text3)', cursor: 'pointer' }}
                            onChange={e => {
                              const key = e.target.value
                              if (!key) return
                              const opt = tceOpts.find(o => o.key === key)
                              if (!opt) return
                              // Bulk-apply this scope to every worked day for this person
                              setActiveWeek(w => {
                                if (!w) return w
                                const newCrew = w.crew.map(m => {
                                  if (m.personId !== member.personId) return m
                                  const newDays = { ...m.days }
                                  days.forEach(d => {
                                    const dayEntry = (m.days[d] || {}) as Record<string,unknown>
                                    const h = (dayEntry.hours as number) || 0
                                    if (h <= 0) return
                                    // Preserve TasTK rows, replace TCE-mode rows
                                    const existing = (dayEntry.nrgWoAllocations as NrgWoAlloc[] || []).filter(a => !a._tceMode && !a.tceItemId)
                                    const newAlloc: NrgWoAlloc = key.startsWith('wo:')
                                      ? { wo: key.slice(3), tceItemId: null, _tceMode: true, hours: h, label: opt.label }
                                      : { wo: '', tceItemId: key.startsWith('tce:') ? key.slice(4) : key, _tceMode: true, hours: h, label: opt.label }
                                    newDays[d] = { ...dayEntry, nrgWoAllocations: [...existing, newAlloc] } as unknown as DayEntry
                                  })
                                  return { ...m, days: newDays }
                                })
                                return { ...w, crew: newCrew }
                              })
                            }}
                          >
                            <option value="">— Select scope —</option>
                            {tceOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                          {currentKey && (
                            <button
                              style={{ marginTop: '2px', width: '100%', fontSize: '9px', padding: '1px 3px', border: '1px solid var(--border2)', borderRadius: '3px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}
                              onClick={() => {
                                setActiveWeek(w => {
                                  if (!w) return w
                                  const newCrew = w.crew.map(m => {
                                    if (m.personId !== member.personId) return m
                                    const newDays = { ...m.days }
                                    days.forEach(d => {
                                      const dayEntry = (m.days[d] || {}) as Record<string,unknown>
                                      const preserved = (dayEntry.nrgWoAllocations as NrgWoAlloc[] || []).filter(a => !a._tceMode && !a.tceItemId)
                                      newDays[d] = { ...dayEntry, nrgWoAllocations: preserved } as unknown as DayEntry
                                    })
                                    return { ...m, days: newDays }
                                  })
                                  return { ...w, crew: newCrew }
                                })
                              }}
                            >✕ Clear scope</button>
                          )}
                        </div>
                      )
                    })()}
                    {/* Per-person allowance TCE override — only when scope is nrg_tce.
                        Default option ("Use timesheet default") falls back to the
                        timesheet-level allowances_tce_default; explicit pick wins.
                        The writer reads (member.allowancesTceItemId || ts default || null). */}
                    {scopeMode === 'nrg_tce' && tceLines.length > 0 && (() => {
                      const memberAny = member as unknown as { allowancesTceItemId?: string | null }
                      const personOverride = memberAny.allowancesTceItemId || ''
                      const tsDefault = (activeWeek as WeeklyTimesheet & { allowances_tce_default?: string }).allowances_tce_default || ''
                      const effective = personOverride || tsDefault
                      const isDefault = !personOverride
                      return (
                        <div style={{ marginTop: '2px' }}>
                          <div style={{ fontSize: '9px', color: '#0891b2', fontWeight: 600, marginBottom: '2px' }}>💰 Allowance TCE</div>
                          <select
                            value={personOverride}
                            style={{ width: '100%', fontSize: '9px', padding: '2px 3px', border: `1px solid ${effective ? '#0891b2' : 'var(--border2)'}`, borderRadius: '3px', background: effective ? 'rgba(8,145,178,0.06)' : 'var(--bg3)', color: effective ? '#0891b2' : 'var(--text3)', cursor: 'pointer' }}
                            title={isDefault ? (tsDefault ? `Using timesheet default: ${tsDefault}` : 'No timesheet default — allowances will land as unallocated') : `Override: ${personOverride}`}
                            onChange={e => {
                              const val = e.target.value
                              setActiveWeek(w => w ? ({
                                ...w,
                                crew: w.crew.map(m => m.personId === member.personId
                                  ? ({ ...m, allowancesTceItemId: val || null } as typeof m)
                                  : m)
                              }) : w)
                            }}
                          >
                            <option value="">{tsDefault ? `↳ Use default (${tsDefault})` : '↳ Use default (unallocated)'}</option>
                            {renderAllowanceTceOptions(type === 'trades')}
                          </select>
                        </div>
                      )
                    })()}
                    {/* Travel TCE dropdown — per-person, same pattern as Allowance TCE */}
                    {scopeMode === 'nrg_tce' && tceLines.length > 0 && (() => {
                      const memberAny = member as unknown as { travelTceItemId?: string | null }
                      const personOverride = memberAny.travelTceItemId || ''
                      const tsDefault = (activeWeek as WeeklyTimesheet & { travel_tce_default?: string }).travel_tce_default || ''
                      const effective = personOverride || tsDefault
                      return (
                        <div style={{ marginTop: '2px' }}>
                          <div style={{ fontSize: '9px', color: '#f59e0b', fontWeight: 600, marginBottom: '2px' }}>✈️ Travel TCE</div>
                          <select
                            value={personOverride}
                            style={{ width: '100%', fontSize: '9px', padding: '2px 3px', border: `1px solid ${effective ? '#f59e0b' : 'var(--border2)'}`, borderRadius: '3px', background: effective ? 'rgba(245,158,11,0.06)' : 'var(--bg3)', color: effective ? '#f59e0b' : 'var(--text3)', cursor: 'pointer' }}
                            title={personOverride ? `Override: ${personOverride}` : tsDefault ? `Using timesheet default: ${tsDefault}` : 'No default — travel will land as unallocated'}
                            onChange={e => {
                              const val = e.target.value
                              setActiveWeek(w => w ? ({
                                ...w,
                                crew: w.crew.map(m => m.personId === member.personId
                                  ? ({ ...m, travelTceItemId: val || null } as typeof m)
                                  : m)
                              }) : w)
                            }}
                          >
                            <option value="">{tsDefault ? `↳ Use default (${tsDefault})` : '↳ Use default (unallocated)'}</option>
                            {renderAllowanceTceOptions(type === 'trades')}
                          </select>
                        </div>
                      )
                    })()}
                    {/* EBA Meal Break Adjustment — trades only (+½h per worked day, cost & sell only) */}
                    {(type === 'trades') && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', marginTop: '2px' }}
                        title="+0.5h per day worked >10h (EBA meal break adjustment — cost &amp; charge only, payroll unaffected)">
                        <input type="checkbox" checked={!!member.mealBreakAdj} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }}
                          onChange={e => {
                            const updated = { ...member, mealBreakAdj: e.target.checked }
                            setActiveWeek(w => w ? ({ ...w, crew: w.crew.map(m => m.personId === member.personId ? updated : m) }) : w)
                          }} />
                        <span style={{ fontSize: '9px', color: member.mealBreakAdj ? TYPE_COLOR[type] : 'var(--text3)' }}>+½h/day adj.</span>
                      </label>
                    )}
                    <button className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--red)', alignSelf: 'flex-start' }} onClick={() => removePerson(member.personId)}>✕ Remove</button>
                  </div>
                  {/* Day cells */}
                  {days.map((d) => {
                    const raw = (member.days[d] || {}) as Record<string, unknown>
                    const cellHrs = (raw.hours as number) || 0
                    const travelHrs = (raw.travel_hours as number) || 0
                    const rawDayType = (raw.dayType as string) || autoType(d, holidays)
                    const dayType = rawDayType
                    const isComposite = isTravelAndWork(dayType)
                    const shiftType = (raw.shiftType as string) || 'day'
                    const laha = (raw.laha as boolean) || false
                    const meal = (raw.meal as boolean) || false
                    const isPH = holidays.has(d)
                    // EBA adj applies to work hours only
                    const adjH = (member.mealBreakAdj && cellHrs > 10) ? 0.5 : 0
                    const dispWorkHrs = cellHrs + adjH
                    const calDow = new Date(d + 'T12:00:00').getDay()
                    const calendarDayType = holidays.has(d) ? 'public_holiday' : calDow === 0 ? 'sunday' : calDow === 6 ? 'saturday' : 'weekday'
                    // Travel split — NT except Sunday/PH which are T1.5
                    const travelDayType = (calendarDayType === 'sunday' || calendarDayType === 'public_holiday') ? calendarDayType : 'travel'
                    const travelSplit = isComposite && travelHrs > 0 ? splitHours(travelHrs, travelDayType, shiftType, (rc?.regime as RegimeConfig), calendarDayType) : null
                    // Work split — normal weekday/sat/sun etc
                    const workSplit = isComposite && dispWorkHrs > 0 ? splitHours(dispWorkHrs, 'weekday', shiftType, (rc?.regime as RegimeConfig), calendarDayType) : null
                    // Single-mode split (non-composite)
                    const dispHrs = cellHrs + adjH
                    const split = !isComposite && dispHrs > 0 ? splitHours(dispHrs, dayType, shiftType, (rc?.regime as RegimeConfig), calendarDayType) : null
                    const SPLIT_LABELS: Record<string,string> = { dnt:'NT', dt15:'T1.5', ddt:'DT', ddt15:'DT1.5', nnt:'NNT', ndt:'NDT', ndt15:'NDT1.5' }
                    const SPLIT_COLORS: Record<string,string> = { dnt:'var(--accent)', dt15:'var(--orange)', ddt:'var(--red)', ddt15:'var(--red)', nnt:'var(--mod-tooling,#8b5cf6)', ndt:'var(--mod-tooling,#8b5cf6)', ndt15:'var(--mod-tooling,#8b5cf6)' }
                    const splitEntries = split ? (Object.entries(split) as [string,number][]).filter(([,v])=>v>0) : []
                    const travelSplitEntries = travelSplit ? (Object.entries(travelSplit) as [string,number][]).filter(([,v])=>v>0) : []
                    const workSplitEntries = workSplit ? (Object.entries(workSplit) as [string,number][]).filter(([,v])=>v>0) : []
                    return (
                      <div key={d} style={{ background: isPH ? 'rgba(139,92,246,0.05)' : 'var(--bg2)', padding: '4px 5px', borderLeft: '1px solid var(--border)' }}>
                        {isComposite ? (
                          /* Composite: two inputs — travel hours + work hours */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div>
                              <div style={{ fontSize: '8px', color: '#f59e0b', fontWeight: 600, letterSpacing: '0.04em', marginBottom: '1px' }}>✈ TRAVEL</div>
                              <input type="number" min="0" max="24" step="0.01" value={travelHrs || ''} placeholder="0"
                                style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, padding: '2px 4px', border: '1px solid #fde68a', borderRadius: '3px', background: 'transparent', color: travelHrs > 0 ? '#92400e' : 'var(--text3)', textAlign: 'center' }}
                                onChange={e => setDay(member.personId, d, 'travel_hours', parseFloat(e.target.value) || 0)} />
                              {travelSplitEntries.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '1px' }}>
                                  {travelSplitEntries.map(([k, v]) => <span key={k} style={{ color: SPLIT_COLORS[k], fontSize: '8px' }}>{SPLIT_LABELS[k]}:{v.toFixed(2)}</span>)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: '8px', color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: '1px' }}>☀ WORK</div>
                              <input type="number" min="0" max="24" step="0.01" value={cellHrs || ''} placeholder="0"
                                style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, padding: '2px 4px', border: '1px solid var(--border2)', borderRadius: '3px', background: 'transparent', color: cellHrs > 0 ? 'var(--text)' : 'var(--text3)', textAlign: 'center' }}
                                onChange={e => setDay(member.personId, d, 'hours', parseFloat(e.target.value) || 0)} />
                              {adjH > 0 && <div style={{ fontSize: '8px', color: TYPE_COLOR[type], textAlign: 'center' }}>{dispWorkHrs.toFixed(2)}h (adj)</div>}
                              {workSplitEntries.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '1px' }}>
                                  {workSplitEntries.map(([k, v]) => <span key={k} style={{ color: SPLIT_COLORS[k], fontSize: '8px' }}>{SPLIT_LABELS[k]}:{v.toFixed(2)}</span>)}
                                </div>
                              )}
                            </div>
                            <div style={{ fontSize: '8px', color: 'var(--text3)', textAlign: 'right', borderTop: '1px solid var(--border)', paddingTop: '1px' }}>
                              Total: {(travelHrs + cellHrs).toFixed(2)}h
                            </div>
                          </div>
                        ) : (
                          /* Standard: single hours input */
                          <>
                            <input type="number" min="0" max="24" step="0.5" value={cellHrs || ''} placeholder="0"
                              style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, padding: '2px 4px', border: '1px solid var(--border2)', borderRadius: '3px', background: 'transparent', color: cellHrs > 0 ? 'var(--text)' : 'var(--text3)', textAlign: 'center' }}
                              onChange={e => setDay(member.personId, d, 'hours', parseFloat(e.target.value) || 0)} />
                            {adjH > 0 && <div style={{ fontSize: '9px', color: TYPE_COLOR[type], textAlign: 'center', marginTop: '1px' }}>{dispHrs.toFixed(2)}h (adj)</div>}
                          </>
                        )}
                        <select value={dayType} style={{ width: '100%', fontSize: '9px', padding: '1px 2px', border: '1px solid var(--border2)', borderRadius: '2px', background: 'var(--bg3)', color: 'var(--text3)', marginTop: '2px' }}
                          onChange={e => {
                            const newType = e.target.value
                            setDayMulti(member.personId, d, {
                              dayType: newType,
                              // Auto-tick travel for pure travel or composite types
                              travel: newType === 'travel' || isTravelAndWork(newType),
                              // Init travel_hours to 0 when switching to composite
                              ...(isTravelAndWork(newType) && !raw.travel_hours ? { travel_hours: 0 } : {}),
                            })
                          }}>
                          {DAY_TYPES.map(dt => <option key={dt.key} value={dt.key}>{dt.label}</option>)}
                        </select>
                        <select value={shiftType} style={{ width: '100%', fontSize: '9px', padding: '1px 2px', border: '1px solid var(--border2)', borderRadius: '2px', background: 'var(--bg3)', color: 'var(--text3)', marginTop: '1px' }}
                          onChange={e => setDay(member.personId, d, 'shiftType', e.target.value)}>
                          <option value="day">Day</option>
                          <option value="night">Night</option>
                        </select>
                        {/* NT / T1.5 / DT breakdown — non-composite only */}
                        {!isComposite && splitEntries.length > 0 && (
                          <div style={{ marginTop: '2px', lineHeight: 1.4, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                            {splitEntries.map(([k, v]) => (
                              <span key={k} style={{ color: SPLIT_COLORS[k], fontSize: '9px' }}>{SPLIT_LABELS[k]}:{v.toFixed(2)}</span>
                            ))}
                          </div>
                        )}
                        {/* LAHA/Meal always visible — allowances paid every day on site */}
                        {(type === 'mgmt' || type === 'seag') ? (
                          // Management & SE AG: FSA / Camp / None radio (mutually exclusive)
                          (() => {
                            const fsa  = (raw.fsa  as boolean) || false
                            const camp = (raw.camp as boolean) || false
                            const allowVal = fsa ? 'fsa' : camp ? 'camp' : 'none'
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px', fontSize: '9px' }}>
                                {[
                                  { val: 'fsa',  label: 'FSA'  },
                                  { val: 'camp', label: 'Camp' },
                                  { val: 'none', label: 'None' },
                                ].map(opt => (
                                  <label key={opt.val} style={{ cursor: 'pointer', color: allowVal === opt.val && opt.val !== 'none' ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    <input type="radio" name={`allow_${member.personId}_${d}`} checked={allowVal === opt.val}
                                      style={{ accentColor: TYPE_COLOR[type], width: '9px', height: '9px' }}
                                      onChange={() => {
                                        setDayMulti(member.personId, d, {
                                          fsa:  opt.val === 'fsa',
                                          camp: opt.val === 'camp',
                                          laha: false,
                                        })
                                      }} />
                                    {opt.label}
                                  </label>
                                ))}
                              </div>
                            )
                          })()
                        ) : (
                          // Trades & Subcon: LAHA + Meal checkboxes
                          <div style={{ display: 'flex', gap: '4px', marginTop: '2px', fontSize: '9px' }}>
                            <label style={{ cursor: 'pointer', color: laha ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={laha} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'laha', e.target.checked)} /> LAHA
                            </label>
                            <label style={{ cursor: 'pointer', color: meal ? TYPE_COLOR[type] : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={meal} style={{ accentColor: TYPE_COLOR[type], width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'meal', e.target.checked)} /> Meal
                            </label>
                            <label style={{ cursor: 'pointer', color: ((raw as Record<string,unknown>).travel as boolean) ? '#f59e0b' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input type="checkbox" checked={!!((raw as Record<string,unknown>).travel as boolean)} style={{ accentColor: '#f59e0b', width: '10px', height: '10px' }} onChange={e => setDay(member.personId, d, 'travel', e.target.checked)} /> Travel
                            </label>
                          </div>
                        )}
                        {cellHrs > 0 && (
                          <div style={{ display: 'flex', gap: '4px', marginTop: '2px', fontSize: '9px', flexDirection: 'column' }}>
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
                              const allocs = ((raw.nrgWoAllocations as NrgWoAlloc[]) || []).filter(a => a._tceMode || a.tceItemId || a.wo)
                              const scopeLabel = allocs.length === 1
                                ? (allocs[0].label || allocs[0].tceItemId || allocs[0].wo || '').replace(/^\[(WO|SL|OH)\]\s*/, '').slice(0, 26)
                                : allocs.length > 1 ? `${allocs.length} scopes` : ''
                              // Reconciliation check: sum of TCE alloc hours vs day total hours
                              const tceTotal = allocs.reduce((s, a) => s + (a.hours || 0), 0)
                              const dayTotal = cellHrs
                              const reconciled = allocs.length === 0 || Math.abs(tceTotal - dayTotal) < 0.05
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                  <button onClick={() => openTceAlloc(member.personId, d, isComposite ? travelHrs + cellHrs : cellHrs, member.name)}
                                    style={{ width: '100%', fontSize: '9px', padding: '1px 3px', borderRadius: '3px', border: `1px solid ${allocs.length ? '#be185d' : 'var(--border2)'}`, background: allocs.length ? 'rgba(244,114,182,0.08)' : 'transparent', color: allocs.length ? '#be185d' : 'var(--text3)', cursor: 'pointer', textAlign: 'center' }}>
                                    {allocs.length ? `🎯 ${allocs.length} alloc${allocs.length > 1 ? 's' : ''}` : '🎯 TCE'}
                                  </button>
                                  {!reconciled && (
                                    <div title={`TCE total ${tceTotal.toFixed(2)}h ≠ day hours ${dayTotal.toFixed(2)}h — reimport TasTK or adjust allocations`}
                                      style={{ fontSize: '8px', color: '#d97706', lineHeight: 1.2, textAlign: 'center', cursor: 'help' }}>
                                      ⚠ {tceTotal.toFixed(2)}h≠{dayTotal.toFixed(2)}h
                                    </div>
                                  )}
                                  {reconciled && scopeLabel && (
                                    <div style={{ fontSize: '8px', color: '#be185d', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={allocs[0]?.label || ''}>
                                      {scopeLabel}
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                        )}
                        {/* Day note */}
                        {(() => {
                          const note = (raw.note as string) || ''
                          const noteKey = `${member.personId}__${d}`
                          const isOpen = noteOpen === noteKey
                          return (
                            <div style={{ marginTop: '3px' }}>
                              <button
                                onClick={() => setNoteOpen(isOpen ? null : noteKey)}
                                title={note || 'Add note'}
                                style={{ fontSize: '9px', padding: '0 3px', border: '1px solid var(--border)', borderRadius: '3px', background: note ? '#fef9c3' : 'var(--bg3)', color: note ? '#92400e' : 'var(--text3)', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                                {note ? '✎· Note' : '✎ Note'}
                              </button>
                              {isOpen && (
                                <textarea
                                  autoFocus
                                  value={note}
                                  onChange={e => setDay(member.personId, d, 'note', e.target.value)}
                                  onBlur={() => setNoteOpen(null)}
                                  placeholder="Day note…"
                                  rows={3}
                                  style={{ width: '100%', fontSize: '10px', marginTop: '2px', padding: '3px 4px', border: '1px solid var(--accent)', borderRadius: '3px', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
                                />
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                  {/* Totals cell */}
                  <div style={{ background: 'var(--bg2)', padding: '8px', textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: TYPE_COLOR[type], fontSize: '13px' }}>{hours.toFixed(1)}h</div>
                    {sell > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--green)', marginTop: '2px' }}>{fmt(sell)}{isSeagWeek && <span style={{ fontSize: '9px', color: 'var(--text3)', marginLeft: '2px' }}>EUR</span>}</div>}
                    {isSeagWeek && sell > 0 && eurToAud > 1 && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)' }}>{fmtAudEquiv(sell)} AUD</div>}
                    {allowances > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>incl. {fmt(allowances)} allow</div>}
                    {cost > 0 && cost !== sell && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>cost {fmt(cost)}{isSeagWeek && <span style={{ fontSize: '9px', marginLeft: '2px' }}>EUR</span>}</div>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Footer totals */}
          {activeWeek.crew.length > 0 && (() => {
            let tHrs = 0, tSell = 0, tCost = 0
            activeWeek.crew.forEach(m => { const t = calcPersonTotals(m, getRC(m.role)); tHrs += t.hours; tSell += t.sell; tCost += t.cost })
            const margin = tSell > 0 ? ((tSell - tCost) / tSell * 100).toFixed(2) : null
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px', background: 'var(--bg3)', border: '1px solid var(--border)', borderTop: '2px solid var(--border2)', borderRadius: '0 0 6px 6px', padding: '8px 10px', minWidth: '960px' }}>
                <div style={{ fontWeight: 700, fontSize: '12px' }}>Week Total — {activeWeek.crew.length} people</div>
                <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text3)' }}>
                  {margin && <span style={{ color: parseFloat(margin) >= 20 ? 'var(--green)' : parseFloat(margin) >= 10 ? 'var(--amber)' : 'var(--red)' }}>{margin}% margin</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: TYPE_COLOR[type] }}>{tHrs.toFixed(1)}h</div>
                  {tSell > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--green)' }}>{fmt(tSell)}{isSeagWeek && <span style={{ fontSize: '9px', color: 'var(--text3)', marginLeft: '2px' }}>EUR</span>}</div>}
                  {isSeagWeek && tSell > 0 && eurToAud > 1 && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)' }}>{fmtAudEquiv(tSell)} AUD</div>}
                  {tCost > 0 && tCost !== tSell && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>cost {fmt(tCost)}{isSeagWeek && <span style={{ fontSize: '9px', marginLeft: '2px' }}>EUR</span>}</div>}
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
            <button className="btn btn-sm" onClick={() => printTimesheet(activeWeek, activeProject?.name||'', rateCards, holidays)}>🖨 Print</button>
            <button className="btn btn-sm" onClick={() => printCostBreakdown(activeWeek, activeProject?.name||'', rateCards, activeWeek.regime||'')}>💰 Cost Breakdown</button>
            <button className="btn btn-sm" onClick={() => exportTimesheetDetail(activeWeek, activeProject?.name||'', rateCards)} title="Download an Excel report with per-person daily detail (hours by shift bucket, allowances, sell + cost)">📊 Excel Report</button>
            <span style={{ fontSize: '11px', color: 'var(--text3)', padding: '0 4px' }}>● Auto-saving</span>
          </div>
        </div>
      )}


      {/* Duplicate Week Modal */}
      {dupModal && (() => {
        const ws = new Date(dupModal.week_start + 'T12:00:00'); ws.setDate(ws.getDate() + 7)
        const newStart = ws.toISOString().slice(0, 10)
        const hasStd = !!(activeProject?.std_hours as {day?:Record<string,number>})?.day
        // Check if any crew member has TCE scope allocations
        const hasTce = dupModal.crew.some(m =>
          Object.values(m.days || {}).some(cell =>
            ((cell as Record<string,unknown>).nrgWoAllocations as unknown[])?.length > 0
          )
        )
        // Only show for NRG-style timesheets (trades, management, seag, subcon)
        const isTceType = ['trades','mgmt','seag','subcon'].includes(dupModal.type || '')
        const showTceOption = hasTce && isTceType
        return (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h3>⧉ Duplicate Week</h3><button className="btn-sm btn" onClick={() => setDupModal(null)}>✕</button></div>
              <div className="modal-body">
                <p style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '16px' }}>
                  Creating new week starting <strong>{newStart}</strong> with {dupModal.crew.length} people.
                </p>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>How should hours be filled?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: showTceOption ? '16px' : '20px' }}>
                  {([
                    { val: 'copy' as const,     title: 'Copy hours from previous week',     desc: 'Same hours, day types, shifts and allowances. Dates shift forward 7 days.' },
                    { val: 'standard' as const, title: 'Use standard hours from Project Settings', desc: hasStd ? 'Each person gets the configured shift pattern.' : 'No standard hours configured in Project Settings yet.', disabled: !hasStd },
                    { val: 'blank' as const,    title: 'Blank — zero hours',                desc: 'Keep the crew list but start with empty timesheets.' },
                  ]).map(opt => (
                    <label key={opt.val} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', border: `1px solid ${dupMode === opt.val ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', cursor: opt.disabled ? 'default' : 'pointer', opacity: opt.disabled ? 0.5 : 1, background: 'var(--bg2)' }}>
                      <input type="radio" name="dupMode" value={opt.val} checked={dupMode === opt.val} disabled={opt.disabled} onChange={() => setDupMode(opt.val)} style={{ marginTop: '2px' }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '12px' }}>{opt.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
                {showTceOption && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: `1px solid ${dupCopyTce ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: 'var(--bg2)', cursor: 'pointer', marginBottom: '4px' }}>
                    <input type="checkbox" checked={dupCopyTce} onChange={e => setDupCopyTce(e.target.checked)} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '12px' }}>Copy TCE scope allocations</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Carry forward which TCE scopes each person's hours are tagged to.</div>
                    </div>
                  </label>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setDupModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => confirmDuplicate(dupModal, dupMode, showTceOption ? dupCopyTce : false)}>⧉ Duplicate</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* New week modal */}
      {showNewModal && (
        <div className="modal-overlay">
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

            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createWeek} disabled={saving || !canWrite('personnel')}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Create Week
              </button>
            </div>
          </div>
        </div>
      )}

      {woAllocModal && (
        <div className="modal-overlay">
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
                    value={r.hours || ''} min={0} max={woAllocModal.hours} step={0.01} placeholder="hrs"
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
                        {over ? `+${Math.abs(diff).toFixed(2)}h` : diff.toFixed(2)+'h'}
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
        <div className="modal-overlay">
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
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🎯 TCE Scopes — {tceAllocModal.name}</h3>
              <button className="btn btn-sm" onClick={() => setTceAllocModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                {tceAllocModal.date} · Shift: <strong style={{ fontFamily: 'var(--mono)' }}>{tceAllocModal.hours}h</strong>
                {tceLines.length === 0 && <span style={{ color: 'var(--amber)', marginLeft: '8px' }}>⚠ No TCE lines — import a TCE file first</span>}
              </p>
              {tceAllocRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                  <select className="input" style={{ flex: 1, fontSize: '12px' }} value={r.key}
                    onChange={e => {
                      const opt = getTceOptions().find(o => o.key === e.target.value)
                      setTceAllocRows(rows => rows.map((x, j) => j === i ? { ...x, key: e.target.value, label: opt?.label || '' } : x))
                    }}>
                    <option value="">— Select scope —</option>
                    {getTceOptions().filter(o => o.key.startsWith('wo:')).length > 0 && (
                      <optgroup label="Work Orders (Skilled Labour)">
                        {getTceOptions().filter(o => o.key.startsWith('wo:')).map(o => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {getTceOptions().filter(o => o.label.startsWith('[SL]')).length > 0 && (
                      <optgroup label="Skilled Labour (no WO)">
                        {getTceOptions().filter(o => o.label.startsWith('[SL]')).map(o => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {getTceOptions().filter(o => o.label.startsWith('[OH]')).length > 0 && (
                      <optgroup label="Overheads">
                        {getTceOptions().filter(o => o.label.startsWith('[OH]')).map(o => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {/* Pay code dropdown — editable for all rows; pre-filled from TasTK, selectable for manual entries */}
                  {(() => {
                    const pc = r.payCode || ''
                    const bg  = pc === 'DT1.0' ? '#dbeafe' : pc === 'DT1.5' ? '#fef3c7' : pc === 'DT2.0' ? '#fce7f3' : pc === 'NT2.0' ? '#f0fdf4' : 'var(--bg2)'
                    const col = pc === 'DT1.0' ? '#1e40af' : pc === 'DT1.5' ? '#92400e' : pc === 'DT2.0' ? '#9d174d' : pc === 'NT2.0' ? '#166534' : 'var(--text3)'
                    return (
                      <select value={pc} title="Pay rate / regime (from Timecloud or select manually)"
                        style={{ fontSize: '10px', fontWeight: pc ? 700 : 400, fontFamily: 'var(--mono)', padding: '2px 4px', borderRadius: 4, flexShrink: 0, border: `1px solid ${pc ? bg : 'var(--border2)'}`, background: bg, color: col, width: 68, cursor: 'pointer' }}
                        onChange={e => setTceAllocRows(rows => rows.map((x, j) => j === i ? { ...x, payCode: e.target.value || undefined } : x))}>
                        <option value="">rate</option>
                        {['DT1.0','DT1.5','DT2.0','NT2.0'].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    )
                  })()}
                  <input type="number" className="input"
                    style={{ width: '72px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700 }}
                    value={r.hours || ''} min={0} max={tceAllocModal.hours} step={0.01} placeholder="h"
                    onChange={e => setTceAllocRows(rows => rows.map((x, j) => j === i ? { ...x, hours: parseFloat(e.target.value) || 0 } : x))} />
                  <button className="btn btn-sm" style={{ color: 'var(--red)', flexShrink: 0 }}
                    onClick={() => setTceAllocRows(rows => rows.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button className="btn btn-sm" onClick={() => setTceAllocRows(rows => [...rows, { key: '', label: '', hours: 0, payCode: undefined }])}>+ Add Scope</button>
                {(() => {
                  const allocated = tceAllocRows.reduce((s,r) => s+(r.hours||0), 0)
                  const remaining = parseFloat((tceAllocModal.hours - allocated).toFixed(2))
                  return remaining > 0.01 && tceAllocRows.length > 0 ? (
                    <button className="btn btn-sm" style={{ color: 'var(--accent)' }}
                      onClick={() => setTceAllocRows(rows => rows.map((r,i) => i===rows.length-1 ? {...r, hours: parseFloat((r.hours+remaining).toFixed(2))} : r))}>
                      ↑ Fill {remaining}h to last line
                    </button>
                  ) : null
                })()}
              </div>
              {(() => {
                const total = tceAllocRows.reduce((s, r) => s + (r.hours || 0), 0)
                const diff = parseFloat((tceAllocModal.hours - total).toFixed(2))
                const over = diff < -0.01
                return (
                  <div style={{ padding: '10px 14px', background: 'var(--bg3)', borderRadius: '6px', display: 'flex', gap: '20px', fontSize: '12px', border: `1px solid ${over ? 'var(--red)' : 'var(--border)'}` }}>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '2px' }}>SHIFT</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{tceAllocModal.hours}h</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '2px' }}>ALLOCATED</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#be185d' }}>{total.toFixed(1)}h</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '2px' }}>{over ? 'OVER' : 'REMAINING'}</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: over ? 'var(--red)' : diff > 0.01 ? 'var(--amber)' : 'var(--green)' }}>
                        {over ? `+${Math.abs(diff).toFixed(2)}h` : `${diff.toFixed(2)}h`}
                      </div>
                    </div>
                    {!over && diff <= 0.01 && total > 0 && (
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                        <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>✓ Fully allocated</span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn" style={{ marginRight: 'auto' }} onClick={() => { setTceAllocRows([]); saveTceAlloc() }}>Clear All</button>
              <button className="btn" onClick={() => setTceAllocModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#be185d' }} onClick={saveTceAlloc}>Save Allocations</button>
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
      {/* Multi-match resolver modal — split each ambiguous TasTK alloc across
          its candidate TCE items. Sum-of-splits must equal the alloc's total
          hours; otherwise save is blocked with a per-row error toast. */}
      {resolveModal.open && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '760px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠ Resolve Ambiguous WO Allocations</h3>
              <button className="btn btn-sm" onClick={() => setResolveModal({ open: false, splits: [] })}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                Each row below is a TasTK-imported allocation whose Work Order matches multiple
                TCE items. Split the hours across the candidates so each row sums to its total.
                Default puts all hours on the first candidate — adjust as needed.
              </p>
              {resolveModal.splits.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>
                  No ambiguous allocations remaining.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {resolveModal.splits.map((s, idx) => {
                    const sum = s.split.reduce((a, b) => a + (b || 0), 0)
                    const balanced = Math.abs(sum - s.totalHours) < 0.01
                    return (
                      <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div style={{ fontSize: '12px' }}>
                            <strong>{s.personName}</strong>
                            <span style={{ color: 'var(--text3)', marginLeft: '8px' }}>{s.date}</span>
                            <span style={{ marginLeft: '8px', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>WO {s.wo}</span>
                          </div>
                          <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: balanced ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                            {sum.toFixed(2)}h / {s.totalHours.toFixed(2)}h
                          </div>
                        </div>
                        {s.candidates.map((c, ci) => (
                          <div key={c.itemId} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{c.itemId}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.description}>{c.description}</span>
                            <input
                              type="number" min="0" step="0.01"
                              className="input"
                              style={{ fontSize: '12px', fontFamily: 'var(--mono)', textAlign: 'right' }}
                              value={s.split[ci] || ''}
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0
                                setResolveModal(prev => ({
                                  ...prev,
                                  splits: prev.splits.map((ps, pi) => pi === idx
                                    ? { ...ps, split: ps.split.map((h, hi) => hi === ci ? v : h) }
                                    : ps),
                                }))
                              }}
                            />
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                          <button className="btn btn-sm" style={{ fontSize: '10px' }}
                            title="Distribute hours equally across all candidates"
                            onClick={() => {
                              const each = s.totalHours / s.candidates.length
                              setResolveModal(prev => ({
                                ...prev,
                                splits: prev.splits.map((ps, pi) => pi === idx
                                  ? { ...ps, split: ps.candidates.map(() => each) }
                                  : ps),
                              }))
                            }}>Even split</button>
                          <button className="btn btn-sm" style={{ fontSize: '10px' }}
                            title="Put all hours on the first candidate"
                            onClick={() => {
                              setResolveModal(prev => ({
                                ...prev,
                                splits: prev.splits.map((ps, pi) => pi === idx
                                  ? { ...ps, split: ps.candidates.map((_, i) => i === 0 ? ps.totalHours : 0) }
                                  : ps),
                              }))
                            }}>All to first</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setResolveModal({ open: false, splits: [] })}>Cancel</button>
              <button className="btn btn-primary" onClick={saveResolveModal}
                disabled={resolveModal.splits.length === 0}>Apply splits</button>
            </div>
          </div>
        </div>
      )}

      {/* TCE mismatch confirmation — blocks Save & Close until user acknowledges */}
      {showMismatchConfirm && activeWeek && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '2px solid #dc2626' }}>
              <h3 style={{ color: '#dc2626' }}>🚨 TCE Hour Mismatches — Are you sure?</h3>
              <button className="btn btn-sm" onClick={() => setShowMismatchConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '13px', marginBottom: '12px', color: 'var(--text2)', lineHeight: 1.6 }}>
                The following days have TCE allocated hours that don't match the shift hours.
                Saving with mismatches will cause incorrect NRG Actuals and timesheet export data.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                {tceMismatches.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '8px 10px', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, minWidth: 130 }}>{m.name}</span>
                    <span style={{ color: 'var(--text3)' }}>{new Date(m.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: '#dc2626', fontWeight: 700 }}>
                      {m.allocHours}h allocated ≠ {m.dayHours}h shift
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 12px', fontSize: '12px', color: '#7f1d1d' }}>
                <strong>Recommended:</strong> Cancel, fix the allocations using the 🎯 TCE button on each affected day cell, then save.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowMismatchConfirm(false)}>← Go back and fix</button>
              <button className="btn" style={{ background: '#dc2626', color: '#fff', border: 'none' }}
                onClick={() => { setShowMismatchConfirm(false); saveWeek(activeWeek); setActiveWeek(null) }}>
                Save anyway (I understand)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
