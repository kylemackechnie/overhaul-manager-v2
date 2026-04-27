import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { splitHours, calcHoursCost } from '../../engines/costEngine'
import {
  getCurrencyMode, setCurrencyMode, getEurToBase,
  fmt as fmtBase, fmtEUR, fmtEURForMode, eurLabel as buildEurLabel,
  convertToBase,
  type CurrencyMode,
} from '../../lib/currency'
import type { RateCard } from '../../types'

// Siemens Energy logo SVG
const SE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 343" style="width:140px;display:block">
<path style="fill:#099" d="m68.94,60.1q-19.36-8.71-24.02-11.4-5.17-4.02-5.17-8.6 0-14.09 25.62-14.09 18.2,0 39.41,8.47v-28.93q-28.52-5.55-44.02-5.55-27.33,0-44.34,11.72-17.21,11.83-17.21,34.42 0,17.54 11.82,29.04 9.12,8.72 39.19,21.08 16.75,6.89 20.83,10.76a11.78,11.78 0 0 1 4.02,9.03q0,14.42-27.29,14.42-19.77,0-45.44-8.08v30.07a207.29,207.27 0 0 0 47.23,5.54q27.76,0 45.2-10.53 21.52-14.02 21.52-37.76 0-17.22-10.98-28.08-9.24-9.15-37.12-21.53zm72.12,94.82h42.54v-152.27h-42.54zm122.56-65.22h59.28v-25.13h-59.28v-34.38h68.1v-27.54h-109.1v152.27h110.86v-29.09h-69.86zm191.1,10.24-38.32-97.29h-55.15v152.27h29.97v-107.81l43.8,109.36h26.37l44.67-109.36v107.81h40.33v-152.27h-52.39zm171.7-10.24h59.28v-25.13h-59.28v-34.38h68.1v-27.54h-109.1v152.27h110.85v-29.09h-69.85zm199.46,14.88l-52.3-101.93h-49.31v152.27h29.98v-104.02l54.02,104.02h47.91v-152.27h-29.97zm126.02-44.48q-19.35-8.71-24.02-11.4-5.17-4.02-5.17-8.6 0-14.09 25.62-14.09 18.2,0 39.41,8.47v-28.93q-28.52-5.55-44.02-5.55-27.33,0-44.34,11.72-17.21,11.83-17.21,34.42 0,17.54 11.82,29.04 9.12,8.72 39.19,21.08 16.76,6.89 20.83,10.76a11.78,11.78 0 0 1 4.02,9.03q0,14.42-27.29,14.42-19.77,0-45.44-8.08v30.07a207.29,207.27 0 0 0 47.23,5.54q27.76,0 45.2-10.53 21.52-14.02 21.52-37.76 0-17.22-10.98-28.08-9.24-9.15-37.12-21.53z"/>
<path style="fill:#641e8c" d="m123.9,189.25c-13.3-.75-26.8-1.25-40.4-1.25s-27.1,.5-40.4,1.25a45.5,45.5 0 0 0-43.1,45.25v62a45.5,45.5 0 0 0 43.1,45.25c13.3,.75 26.8,1.25 40.4,1.25s27.1-.5 40.4-1.25a45.5,45.5 0 0 0 43.1-45.25v-3.5h-19.5v3.5a25.9,25.9 0 0 1-24.4,25.7c-13.1,.8-26.3,1.3-39.6,1.3s-26.5-.5-39.6-1.3a25.9,25.9 0 0 1-24.4-25.7v-62a25.9,25.9 0 0 1 24.4-25.7c13.1-.8 26.3-1.3 39.6-1.3s26.5,.5 39.6,1.3a25.9,25.9 0 0 1 24.4,25.7v21h-80.5v20h100v-41a45.5,45.5 0 0 0-43.1-45.25z"/>
</svg>`

interface LabourPerson {
  name: string; role: string; type: string; isSeag: boolean
  hours: number
  sell: number        // native currency (EUR for seag, AUD for others)
  allowances: number  // always AUD
}

interface HireItem { hire_type: string; name: string; customer_total: number; start_date: string; end_date: string; vendor: string; currency: string }
interface BackOfficeEntry { name: string; role: string; hours: number; sell: number }
interface ToolingCosting { tv_no: string; sell_eur: number; charge_start: string; charge_end: string }
interface Expense { description: string; category: string; sell_price: number; vendor: string; date: string; currency: string }
interface Accommodation { property: string; room: string; check_in: string; check_out: string; nightly_rate: number; customer_total: number; nights: number }
interface Car { vendor: string; vehicle_type: string; start_date: string; end_date: string; daily_rate: number; customer_total: number; days: number }

export function CustomerReportPanel() {
  const { activeProject } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [html, setHtml] = useState('')
  const [mode, setMode] = useState<CurrencyMode>(() => getCurrencyMode())
  /** Selected week (Monday). Empty = "Project to date". */
  const [weekFilter, setWeekFilter] = useState<string>('')
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([])

  // Re-generate report when mode or week toggles
  useEffect(() => { if (activeProject) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeProject?.id, mode, weekFilter])

  function toggleMode(m: CurrencyMode) {
    setCurrencyMode(m)
    setMode(m)
  }

  // Window helpers — Monday-anchored
  const monday = (d: string): string => {
    const dt = new Date(d + 'T00:00:00')
    const dow = dt.getUTCDay()
    const offset = dow === 0 ? 6 : dow - 1
    dt.setUTCDate(dt.getUTCDate() - offset)
    return dt.toISOString().slice(0, 10)
  }
  const weekEndOf = (mon: string): string => {
    const dt = new Date(mon + 'T00:00:00')
    dt.setUTCDate(dt.getUTCDate() + 6)
    return dt.toISOString().slice(0, 10)
  }
  const overlapRatio = (start: string | null, end: string | null, wkStart: string, wkEnd: string): number => {
    if (!start) return 0
    const e = end || start
    const from = start > wkStart ? start : wkStart
    const to   = e < wkEnd ? e : wkEnd
    if (from > to) return 0
    const totalMs = new Date(e + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()
    const totalDays = Math.max(1, Math.round(totalMs / 86400000) + 1)
    const winMs = new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()
    const winDays = Math.max(0, Math.round(winMs / 86400000) + 1)
    return winDays / totalDays
  }

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const reportDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })

    // Currency helpers bound to this project + mode
    const proj = activeProject!
    const eurToAud = getEurToBase(proj)
    const allAUD = mode === 'allAUD'
    const fmtV = (n: number) => fmtBase(n, proj)
    const fmtE = (n: number) => fmtEURForMode(n, mode, proj)
    const eurLbl = buildEurLabel(mode, proj)
    const toAUD = (n: number, currency: string) => convertToBase(n, currency, proj)

    const wkStart = weekFilter
    const wkEnd = weekFilter ? weekEndOf(weekFilter) : ''
    const inWindow = (d: string | null | undefined): boolean =>
      !weekFilter || (!!d && d >= wkStart && d <= wkEnd)

    const [tsRes, rcRes, hireRes, boRes, tcRes, varRes, expRes, accomRes, carRes, vlRes] = await Promise.all([
      supabase.from('weekly_timesheets').select('type,crew').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('hire_type,name,customer_total,start_date,end_date,vendor,currency').eq('project_id', pid),
      supabase.from('back_office_hours').select('name,role,hours,sell,date').eq('project_id', pid),
      supabase.from('tooling_costings').select('tv_no,sell_eur,charge_start,charge_end').eq('project_id', pid),
      supabase.from('variations').select('id,number,title,status,approved_date').eq('project_id', pid).eq('status', 'approved'),
      supabase.from('expenses').select('description,category,sell_price,date,vendor,currency').eq('project_id', pid),
      supabase.from('accommodation').select('property,room,check_in,check_out,nightly_rate,customer_total,nights').eq('project_id', pid),
      supabase.from('cars').select('vendor,vehicle_type,start_date,end_date,daily_rate,customer_total,days').eq('project_id', pid),
      supabase.from('variation_lines').select('variation_id,sell_total,description').eq('project_id', pid),
    ])

    const rcs = (rcRes.data || []) as RateCard[]
    const getRC = (role: string) => rcs.find(r => r.role.toLowerCase() === role.toLowerCase()) || null

    // ── Build the list of weeks we have any data in (Monday-anchored).
    // Used to populate the week dropdown. Done once per fetch — the week
    // dropdown then drives subsequent re-renders without re-fetching.
    {
      const set = new Set<string>()
      for (const sheet of (tsRes.data || [])) {
        for (const member of (sheet.crew || [])) {
          for (const [dateKey, d] of Object.entries(member.days || {})) {
            const day = d as { hours?: number }
            if (day.hours && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) set.add(monday(dateKey))
          }
        }
      }
      ;(boRes.data || []).forEach((b: { date?: string }) => { if (b.date) set.add(monday(b.date)) })
      ;(expRes.data || []).forEach((e: { date?: string }) => { if (e.date) set.add(monday(e.date)) })
      ;(varRes.data || []).forEach((v: { approved_date?: string }) => { if (v.approved_date) set.add(monday(v.approved_date)) })
      setAvailableWeeks([...set].sort().reverse())
    }

    // ── Labour — SE AG hours are natively EUR ────────────────────────────────
    const sheets = tsRes.data || []
    const byPerson: Record<string, LabourPerson> = {}

    for (const sheet of sheets) {
      const isSeag = sheet.type === 'seag'
      const typeLabel = sheet.type === 'mgmt' ? 'Management' : isSeag ? 'SE AG' : sheet.type === 'subcon' ? 'Subcontractor' : 'Trades'
      for (const member of (sheet.crew || [])) {
        const rc = getRC(member.role)
        const key = member.name + '|' + typeLabel
        if (!byPerson[key]) byPerson[key] = { name: member.name, role: member.role || '', type: typeLabel, isSeag, hours: 0, sell: 0, allowances: 0 }
        for (const [dateKey, d] of Object.entries(member.days || {})) {
          // Skip days outside the selected week. dateKey is the calendar date (YYYY-MM-DD)
          // that the timesheet writer stores; if there's no week filter, inWindow returns true.
          if (!inWindow(dateKey)) continue
          const day = d as { hours?: number; dayType?: string; shiftType?: string; laha?: boolean; meal?: boolean; fsa?: boolean }
          if (!day.hours) continue
          const rawDayType = day.dayType || 'weekday'
          const normDayType = rawDayType === 'public_holiday' ? 'publicHoliday' : rawDayType as 'weekday'|'saturday'|'sunday'|'publicHoliday'
          const split = splitHours(day.hours, normDayType, (day.shiftType || 'day') as 'day'|'night', rc?.regime)
          // sell is in the rate card's native currency (EUR for seag, AUD for others)
          const sell = rc ? calcHoursCost(split, rc, 'sell') : 0
          const isMgmt = rc?.category === 'management' || rc?.category === 'seag'
          let allow = 0 // Allowances are always AUD
          if (isMgmt) { if (day.fsa || day.laha) allow = Number(rc?.fsa_sell) || 0 }
          else { allow = (day.laha ? Number(rc?.laha_sell) || 0 : 0) + (day.meal ? Number(rc?.meal_sell) || 0 : 0) }
          byPerson[key].hours += day.hours
          byPerson[key].sell += sell
          byPerson[key].allowances += allow
        }
      }
    }

    const labourPeople = Object.values(byPerson).filter(p => p.sell + p.allowances > 0)

    // Calculate totals with proper EUR→AUD conversion
    // seag.sell is in EUR, everything else in AUD
    const tradesTotal = labourPeople.filter(p => !p.isSeag).reduce((s, p) => s + p.sell + p.allowances, 0)
    const seagSellEUR  = labourPeople.filter(p => p.isSeag).reduce((s, p) => s + p.sell, 0)
    const seagAllowAUD = labourPeople.filter(p => p.isSeag).reduce((s, p) => s + p.allowances, 0)
    const seagSellAUD  = seagSellEUR * eurToAud

    // AUD-equivalent labour total
    const labourSellAUD = tradesTotal + seagSellAUD + seagAllowAUD

    // ── Equipment Hire ───────────────────────────────────────────────────────
    // When week-filtered, pro-rate customer_total by the days-in-window ratio.
    const hireRaw = ((hireRes.data || []) as HireItem[]).filter(h => h.customer_total > 0)
    const hire = weekFilter
      ? hireRaw.flatMap(h => {
          const r = overlapRatio(h.start_date || null, h.end_date || null, wkStart, wkEnd)
          if (r <= 0) return []
          return [{ ...h, customer_total: (h.customer_total || 0) * r }]
        })
      : hireRaw
    const hireSell = hire.reduce((s, h) => s + toAUD(h.customer_total, h.currency || proj.currency || 'AUD'), 0)

    // ── Back Office ──────────────────────────────────────────────────────────
    const boByPerson: Record<string, { name: string; role: string; hours: number; sell: number }> = {}
    for (const e of (boRes.data || []) as (BackOfficeEntry & { date?: string })[]) {
      // Date-stamped — exclude rows outside the week when filtering.
      if (!inWindow(e.date)) continue
      const k = e.name + '|' + e.role
      if (!boByPerson[k]) boByPerson[k] = { name: e.name, role: e.role, hours: 0, sell: 0 }
      boByPerson[k].hours += e.hours || 0
      boByPerson[k].sell += e.sell || 0
    }
    const boPeople = Object.values(boByPerson).filter(p => p.sell > 0)
    const boSell = boPeople.reduce((s, p) => s + p.sell, 0)

    // ── Tooling (always EUR) ──────────────────────────────────────────────────
    // sell_eur is the full-window sell. Pro-rate by clamped charge_start/charge_end.
    const toolingRaw = ((tcRes.data || []) as ToolingCosting[]).filter(t => t.sell_eur > 0)
    const tooling = weekFilter
      ? toolingRaw.flatMap(t => {
          if (!t.charge_start || !t.charge_end) return []
          const r = overlapRatio(t.charge_start, t.charge_end, wkStart, wkEnd)
          if (r <= 0) return []
          return [{ ...t, sell_eur: (t.sell_eur || 0) * r }]
        })
      : toolingRaw
    const toolingSellEUR = tooling.reduce((s, t) => s + t.sell_eur, 0)
    const toolingSellAUD = toolingSellEUR * eurToAud

    // ── Variations ───────────────────────────────────────────────────────────
    // Variation lines have no date — they ride on the parent variation's
    // approved_date. Filter the approved id set down to those approved in window.
    const varLines = vlRes.data || []
    const approvedInWindow = (varRes.data || []).filter(
      (v: { approved_date?: string }) => inWindow(v.approved_date)
    )
    const varIds = new Set(approvedInWindow.map((v: { id: string }) => v.id))
    const varMap = approvedInWindow.reduce((m: Record<string, string>, v: { id: string; number: string; title: string }) => {
      m[v.id] = `${v.number} — ${v.title}`; return m
    }, {})
    const approvedLines = varLines.filter(l => varIds.has(l.variation_id))
    const variationsSell = approvedLines.reduce((s: number, l: { sell_total: number }) => s + (l.sell_total || 0), 0)

    // ── Accommodation & Cars ──────────────────────────────────────────────────
    const accomRaw = ((accomRes.data || []) as Accommodation[]).filter(a => a.customer_total > 0)
    const accom = weekFilter
      ? accomRaw.flatMap(a => {
          const r = overlapRatio(a.check_in || null, a.check_out || null, wkStart, wkEnd)
          if (r <= 0) return []
          return [{ ...a, customer_total: (a.customer_total || 0) * r }]
        })
      : accomRaw
    const accomSell = accom.reduce((s, a) => s + a.customer_total, 0)

    const carsRaw = ((carRes.data || []) as Car[]).filter(c => c.customer_total > 0)
    const cars = weekFilter
      ? carsRaw.flatMap(c => {
          const r = overlapRatio(c.start_date || null, c.end_date || null, wkStart, wkEnd)
          if (r <= 0) return []
          return [{ ...c, customer_total: (c.customer_total || 0) * r }]
        })
      : carsRaw
    const carSell = cars.reduce((s, c) => s + c.customer_total, 0)

    // ── Expenses ──────────────────────────────────────────────────────────────
    const expenses = ((expRes.data || []) as Expense[])
      .filter(e => e.sell_price > 0)
      .filter(e => inWindow(e.date))
    const expSell = expenses.reduce((s, e) => s + toAUD(e.sell_price, e.currency || proj.currency || 'AUD'), 0)

    // Grand total always in AUD equivalent
    const grandSellAUD = labourSellAUD + hireSell + boSell + (allAUD ? toolingSellAUD : 0) + accomSell + carSell + expSell + variationsSell

    // ── Build HTML ─────────────────────────────────────────────────────────────
    const TH = (s: string, right = false) =>
      `<th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:5px 8px;font-size:8px;text-transform:uppercase;text-align:${right ? 'right' : 'left'};color:#475569;font-weight:700">${s}</th>`
    const TD = (s: string | number, right = false, bold = false) =>
      `<td style="border:1px solid #e2e8f0;padding:4px 8px;font-size:9px;vertical-align:top;${right ? 'text-align:right;font-family:monospace;' : ''}${bold ? 'font-weight:700;' : ''}">${s}</td>`

    const section = (num: number, title: string, desc: string, headerRow: string, bodyRows: string, subtotalLabel: string, subtotalVal: number, colSpan: number, isEUR = false) => `
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;padding:8px 0 6px;border-bottom:2px solid #e2e8f0">${num}. ${title}</div>
        <p style="font-size:9px;color:#64748b;margin-bottom:10px;line-height:1.5;font-style:italic">${desc}</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot><tr>
            <td colspan="${colSpan}" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">Subtotal — ${subtotalLabel}</td>
            <td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${isEUR ? fmtE(subtotalVal) : fmtV(subtotalVal)}</td>
          </tr></tfoot>
        </table>
      </div>`

    const sections: string[] = []

    // 1. Labour — split by trades/seag with EUR handling
    if (labourPeople.length) {
      const rows = labourPeople.sort((a, b) => {
        const aTotal = a.isSeag ? (a.sell * eurToAud + a.allowances) : (a.sell + a.allowances)
        const bTotal = b.isSeag ? (b.sell * eurToAud + b.allowances) : (b.sell + b.allowances)
        return bTotal - aTotal
      }).map(p => {
        // sellDisplay: for seag, show EUR or converted AUD per mode
        const sellDisplay = p.isSeag ? fmtE(p.sell) : fmtV(p.sell)
        const sellLabel = p.isSeag ? eurLbl : (proj.currency || 'AUD')
        const allowDisplay = p.allowances > 0 ? fmtV(p.allowances) : '—'
        const totalDisplay = p.isSeag
          ? (allAUD ? fmtV(p.sell * eurToAud + p.allowances) : `${fmtEUR(p.sell)} + ${fmtV(p.allowances)}`)
          : fmtV(p.sell + p.allowances)
        return `<tr>${TD(p.name, false, true)}${TD(p.role)}${TD(p.type)}${TD(p.hours.toFixed(1), true)}${TD(`${sellDisplay} <span style="font-size:8px;color:#94a3b8">${sellLabel}</span>`, true)}${TD(allowDisplay, true)}${TD(totalDisplay, true, true)}</tr>`
      }).join('')

      // Labour subtotal label
      const labourSubtotalDisplay = allAUD
        ? fmtV(labourSellAUD)
        : (seagSellEUR > 0
          ? `${fmtV(tradesTotal + seagAllowAUD)} AUD + ${fmtEUR(seagSellEUR)} EUR`
          : fmtV(tradesTotal))

      const labourFooter = allAUD
        ? `<tr><td colspan="6" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">Subtotal — Labour</td><td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${labourSubtotalDisplay}</td></tr>`
        : `<tr><td colspan="6" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">Subtotal — Labour ${seagSellEUR > 0 ? '(AUD portion)' : ''}</td><td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${labourSubtotalDisplay}</td></tr>`

      sections.push(`
        <div style="margin-bottom:24px;page-break-inside:avoid">
          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;padding:8px 0 6px;border-bottom:2px solid #e2e8f0">1. Labour</div>
          <p style="font-size:9px;color:#64748b;margin-bottom:10px;line-height:1.5;font-style:italic">
            Labour charges for all deployed personnel. SE AG rates are in EUR${allAUD ? `, converted at ${eurToAud.toFixed(4)} AUD/EUR` : ''}. Allowances (LAHA, FSA) in AUD.
          </p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
            <thead><tr>${[TH('Name'), TH('Role'), TH('Type'), TH('Hours', true), TH('Labour Sell', true), TH('Allowances', true), TH('Total', true)].join('')}</tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>${labourFooter}</tfoot>
          </table>
        </div>`)
    }

    // 2. Equipment Hire
    if (hire.length) {
      const rows = hire.map(h => {
        const sym = h.currency && h.currency !== (proj.currency || 'AUD') ? ` <span style="font-size:8px;color:#1d4ed8">${h.currency}</span>` : ''
        return `<tr>${TD(h.hire_type || '—')}${TD(h.vendor || '—')}${TD(h.name || '—')}${TD(h.start_date || '—')}${TD(h.end_date || '—')}${TD(fmtV(toAUD(h.customer_total, h.currency || proj.currency || 'AUD')) + sym, true, true)}</tr>`
      }).join('')
      sections.push(section(2, 'Equipment Hire', 'Third-party equipment hire — dry, wet and local. Customer pricing includes agreed margin.',
        [TH('Type'), TH('Vendor'), TH('Equipment'), TH('Start'), TH('End'), TH(`Total (${proj.currency || 'AUD'})`, true)].join(''),
        rows, 'Equipment Hire', hireSell, 5))
    }

    // 3. Accommodation
    if (accom.length) {
      const rows = accom.map(a =>
        `<tr>${TD(a.property || '—')}${TD(a.room || '—')}${TD(a.check_in || '—')}${TD(a.check_out || '—')}${TD(String(a.nights || '—'), true)}${TD(fmtV(a.nightly_rate || 0), true)}${TD(fmtV(a.customer_total), true, true)}</tr>`
      ).join('')
      sections.push(section(3, 'Accommodation', 'Accommodation for project personnel excluding GST.',
        [TH('Property'), TH('Room'), TH('Check-in'), TH('Check-out'), TH('Nights', true), TH('Nightly Rate', true), TH('Total ($)', true)].join(''),
        rows, 'Accommodation', accomSell, 6))
    }

    // 4. Car Hire
    if (cars.length) {
      const rows = cars.map(c =>
        `<tr>${TD(c.vendor || '—')}${TD(c.vehicle_type || '—')}${TD(c.start_date || '—')}${TD(c.end_date || '—')}${TD(String(c.days || '—'), true)}${TD(fmtV(c.daily_rate || 0), true)}${TD(fmtV(c.customer_total), true, true)}</tr>`
      ).join('')
      sections.push(section(4, 'Car Hire', 'Vehicle hire for project personnel excluding GST.',
        [TH('Vendor'), TH('Vehicle'), TH('Start'), TH('End'), TH('Days', true), TH('Daily Rate', true), TH('Total ($)', true)].join(''),
        rows, 'Car Hire', carSell, 6))
    }

    // 5. Back Office Hours
    if (boPeople.length) {
      const rows = boPeople.sort((a, b) => b.sell - a.sell).map(p =>
        `<tr>${TD(p.name, false, true)}${TD(p.role)}${TD(p.hours.toFixed(1), true)}${TD(fmtV(p.sell), true, true)}</tr>`
      ).join('')
      sections.push(section(5, 'Back Office Hours', 'Engineering, planning and project support hours.',
        [TH('Name'), TH('Role'), TH('Hours', true), TH('Total ($)', true)].join(''),
        rows, 'Back Office Hours', boSell, 3))
    }

    // 6. Tooling Rental (EUR — shown raw in split, converted in allAUD)
    if (tooling.length) {
      const toolingDesc = allAUD
        ? `Rental charges for Siemens Energy specialist tooling. EUR amounts converted at ${eurToAud.toFixed(4)} AUD/EUR.`
        : `Rental charges for Siemens Energy specialist tooling. Amounts in EUR — invoiced separately by Siemens Energy AG.`
      const rows = tooling.map(t =>
        `<tr>${TD('TV' + t.tv_no, false, true)}${TD(t.charge_start || '—')}${TD(t.charge_end || '—')}${TD(fmtE(t.sell_eur), true, true)}</tr>`
      ).join('')
      sections.push(`
        <div style="margin-bottom:24px;page-break-inside:avoid">
          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;padding:8px 0 6px;border-bottom:2px solid #e2e8f0">6. SE Rental Tooling</div>
          <p style="font-size:9px;color:#64748b;margin-bottom:10px;line-height:1.5;font-style:italic">${toolingDesc}</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
            <thead><tr>${[TH('TV No.'), TH('Charge Start'), TH('Charge End'), TH(allAUD ? `Sell (${proj.currency || 'AUD'})` : 'Sell (€)', true)].join('')}</tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr>
              <td colspan="3" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">Subtotal — Tooling Rental</td>
              <td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${fmtE(toolingSellEUR)}</td>
            </tr></tfoot>
          </table>
        </div>`)
    }

    // 7. Expenses
    if (expenses.length) {
      const rows = expenses.map(e => {
        const sym = e.currency && e.currency !== (proj.currency || 'AUD') ? ` <span style="font-size:8px;color:#1d4ed8">${e.currency}</span>` : ''
        return `<tr>${TD(e.date || '—')}${TD(e.vendor || '—')}${TD(e.description || e.category || '—')}${TD(fmtV(toAUD(e.sell_price, e.currency || proj.currency || 'AUD')) + sym, true, true)}</tr>`
      }).join('')
      sections.push(section(7, 'Chargeable Expenses', 'Reimbursable project expenses. Only chargeable items listed; amounts include agreed margin.',
        [TH('Date'), TH('Vendor'), TH('Description'), TH('Amount ($)', true)].join(''),
        rows, 'Expenses', expSell, 3))
    }

    // 8. Approved Variations
    if (approvedLines.length) {
      const rows = approvedLines.map((l: { variation_id: string; sell_total: number; description: string }) =>
        `<tr>${TD(varMap[l.variation_id] || '—')}${TD(l.description || '—')}${TD(fmtV(l.sell_total || 0), true, true)}</tr>`
      ).join('')
      sections.push(section(8, 'Approved Variations', 'Approved contract variations. Sell values include agreed margin.',
        [TH('Variation'), TH('Description'), TH('Sell ($)', true)].join(''),
        rows, 'Variations', variationsSell, 2))
    }

    // ── Summary table ─────────────────────────────────────────────────────────
    const summRow = (label: string, val: string) =>
      `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">${label}</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${val}</td></tr>`

    const labourSummary = allAUD
      ? summRow('Labour', fmtV(labourSellAUD))
      : (seagSellEUR > 0
        ? summRow('Labour (AUD)', fmtV(tradesTotal + seagAllowAUD)) + summRow('Labour — SE AG (EUR)', fmtEUR(seagSellEUR))
        : summRow('Labour', fmtV(tradesTotal)))

    const toolingSummary = toolingSellEUR > 0
      ? summRow(allAUD ? 'Tooling Rental' : 'Tooling Rental (EUR — separate invoice)', fmtE(toolingSellEUR))
      : ''

    const summaryRows = [
      labourPeople.length > 0 ? labourSummary : '',
      hire.length > 0 ? summRow('Equipment Hire', fmtV(hireSell)) : '',
      accom.length > 0 ? summRow('Accommodation', fmtV(accomSell)) : '',
      cars.length > 0 ? summRow('Car Hire', fmtV(carSell)) : '',
      boPeople.length > 0 ? summRow('Back Office Hours', fmtV(boSell)) : '',
      toolingSummary,
      expenses.length > 0 ? summRow('Chargeable Expenses', fmtV(expSell)) : '',
      approvedLines.length > 0 ? summRow('Approved Variations', fmtV(variationsSell)) : '',
    ].filter(Boolean).join('')

    const footerNote = allAUD
      ? `All EUR amounts converted at ${eurToAud.toFixed(4)} AUD/EUR.`
      : (toolingSellEUR > 0 || seagSellEUR > 0
        ? 'SE AG labour and tooling rental in EUR — invoiced separately by Siemens Energy AG.'
        : '')

    const report = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Customer Cost Report — ${proj.name}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,sans-serif; font-size:10px; color:#1e293b; padding:28px 36px; }
@media print { button { display:none !important; } body { padding:16px; } @page { size:A4 landscape; margin:12mm; } }
</style>
</head><body>
<div style="text-align:right;margin-bottom:8px">
  <button onclick="window.print()" style="padding:6px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">🖨 Print / Save PDF</button>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #009999">
  <div>
    ${SE_LOGO}
    <div style="font-size:9px;color:#64748b;margin-top:8px">Customer Cost Report ${allAUD ? '(All AUD)' : '(AUD + EUR)'}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px">${proj.name || '—'}</div>
    <div style="font-size:9px;color:#64748b;line-height:1.8">
      ${proj.client ? `<b>Client:</b> ${proj.client}<br>` : ''}
      ${proj.start_date ? `<b>Period:</b> ${proj.start_date} to ${proj.end_date || 'ongoing'}<br>` : ''}
      ${weekFilter ? `<b style="color:#0284c7">Week of ${wkStart} → ${wkEnd}</b><br>` : ''}
      <b>Report Date:</b> ${reportDate}<br>
      ${proj.pm ? `<b>Prepared By:</b> ${proj.pm}` : ''}
    </div>
  </div>
</div>

<div style="background:#f0f9ff;border:2px solid #0284c7;border-radius:6px;overflow:hidden;margin-bottom:28px">
  <div style="font-size:10px;font-weight:700;color:#fff;background:#0284c7;text-transform:uppercase;letter-spacing:.08em;padding:7px 14px">
    Project Cost Summary — Total Chargeable (Sell, excl. GST)
  </div>
  <table style="width:100%;border-collapse:collapse">
    ${summaryRows}
  </table>
  <div style="display:flex;justify-content:space-between;padding:9px 14px;font-size:13px;font-weight:700;color:#0f172a;border-top:2px solid #0284c7;background:#e0f2fe">
    <span>Total Chargeable ${proj.currency || 'AUD'} (excl. GST)${allAUD || (toolingSellEUR === 0 && seagSellEUR === 0) ? '' : ' — AUD portion only'}</span>
    <span style="font-family:monospace">${fmtV(grandSellAUD)}</span>
  </div>
  ${!allAUD && (seagSellEUR > 0 || toolingSellEUR > 0) ? `
  <div style="display:flex;justify-content:space-between;padding:6px 14px;font-size:11px;font-weight:600;color:#1d4ed8;border-top:1px solid #93c5fd;background:#dbeafe">
    <span>SE EUR Total (separate invoice)</span>
    <span style="font-family:monospace">${fmtEUR(seagSellEUR + toolingSellEUR)}</span>
  </div>` : ''}
</div>

${sections.join('\n')}

<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8;text-align:center">
  Generated by Overhaul Manager on ${reportDate}. All amounts are sell values inclusive of agreed margins, excluding GST. ${footerNote}
</div>
</body></html>`

    setHtml(report)
    setLoading(false)
  }

  function openReport() {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column'
    const toolbar = document.createElement('div')
    toolbar.style.cssText = 'display:flex;gap:8px;padding:8px 12px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;flex-shrink:0;align-items:center'
    toolbar.innerHTML = '<button onclick="this.closest(\'[style*=fixed]\').remove()" style="padding:5px 14px;background:#64748b;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px">✕ Close</button>'
      + '<button onclick="document.getElementById(\'_crFrame\').contentWindow.print()" style="padding:5px 14px;background:#059669;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px">🖨 Print / Save PDF</button>'
      + '<span style="font-size:11px;color:#64748b;margin-left:8px">Use Print to save as PDF</span>'
    const iframe = document.createElement('iframe')
    iframe.id = '_crFrame'
    iframe.style.cssText = 'flex:1;border:none;width:100%'
    overlay.appendChild(toolbar)
    overlay.appendChild(iframe)
    document.body.appendChild(overlay)
    iframe.contentDocument!.open()
    iframe.contentDocument!.write(html)
    iframe.contentDocument!.close()
  }

  const eurToAud = getEurToBase(activeProject)

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Customer Report</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {activeProject?.name} · Full sell-side cost report
            {weekFilter && (
              <span style={{ marginLeft: '8px', padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>
                Week of {weekFilter} → {weekEndOf(weekFilter)}
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          {/* Week filter — same semantics as Cost Report. Empty = project to date. */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>View:</span>
            <select className="input" style={{ fontSize: '12px', padding: '3px 6px', height: '28px' }}
              value={weekFilter} onChange={e => setWeekFilter(e.target.value)}>
              <option value="">Project to date</option>
              {availableWeeks.map(w => {
                const dt = new Date(w + 'T00:00:00')
                const sun = new Date(dt); sun.setUTCDate(dt.getUTCDate() + 6)
                const lbl = `${dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })} – ${sun.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}`
                return <option key={w} value={w}>{lbl}</option>
              })}
            </select>
          </div>

          {/* AUD+EUR / All AUD toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Currency Display
            </div>
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', padding: '3px', borderRadius: '7px', border: '1px solid var(--border)' }}>
              <button
                onClick={() => toggleMode('split')}
                style={{
                  padding: '4px 12px', borderRadius: '5px', border: 'none', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer',
                  background: mode === 'split' ? '#0891b2' : 'transparent',
                  color: mode === 'split' ? '#fff' : 'var(--text2)',
                  transition: 'all 0.15s',
                }}
              >AUD + EUR</button>
              <button
                onClick={() => toggleMode('allAUD')}
                style={{
                  padding: '4px 12px', borderRadius: '5px', border: 'none', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer',
                  background: mode === 'allAUD' ? '#0891b2' : 'transparent',
                  color: mode === 'allAUD' ? '#fff' : 'var(--text2)',
                  transition: 'all 0.15s',
                }}
              >All AUD</button>
            </div>
            {mode === 'allAUD' && (
              <div style={{ fontSize: '10px', color: 'var(--text3)' }}>
                EUR conv. @ {eurToAud.toFixed(4)} AUD/EUR
                {eurToAud === 1 && (
                  <span style={{ color: 'var(--orange)', marginLeft: '4px' }}>⚠ Set EUR rate in Project Settings</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /></div>
      ) : !html ? (
        <div className="empty-state">
          <div className="icon">📊</div>
          <h3>No billable data</h3>
          <p>Add timesheets, hire items, or other costs to generate a customer report.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
            <button className="btn btn-primary" onClick={openReport} style={{ fontSize: '14px', padding: '8px 20px' }}>
              📄 Open Report
            </button>
            <span style={{ fontSize: '12px', color: 'var(--text3)' }}>
              Opens in full-screen overlay with Print / Save PDF button
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.8 }}>
            <div style={{ fontWeight: 600, marginBottom: '8px' }}>Report includes:</div>
            <div>• Siemens Energy header with project details</div>
            <div>• Cost summary with subtotals by category</div>
            <div>• SE AG labour shown as {mode === 'split' ? 'EUR (with AUD allowances separate)' : `AUD equivalent (@ ${eurToAud.toFixed(4)} AUD/EUR)`}</div>
            <div>• Tooling rental shown in {mode === 'split' ? 'EUR — flagged as separate invoice' : 'AUD equivalent'}</div>
            <div>• Per-section detail tables: Labour, Equipment Hire, Accommodation, Car Hire, Back Office, Tooling, Expenses, Variations</div>
            <div>• Print-ready layout (A4 landscape)</div>
          </div>
        </div>
      )}
    </div>
  )
}
