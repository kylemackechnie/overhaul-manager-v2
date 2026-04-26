import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { splitHours, calcHoursCost } from '../../engines/costEngine'
import type { RateCard } from '../../types'

const fmt = (n: number) => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur = (n: number) => '€' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// removed

// Siemens Energy logo SVG (teal wordmark + purple icon)
const SE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 343" style="width:140px;display:block">
<path style="fill:#099" d="m68.94,60.1q-19.36-8.71-24.02-11.4-5.17-4.02-5.17-8.6 0-14.09 25.62-14.09 18.2,0 39.41,8.47v-28.93q-28.52-5.55-44.02-5.55-27.33,0-44.34,11.72-17.21,11.83-17.21,34.42 0,17.54 11.82,29.04 9.12,8.72 39.19,21.08 16.75,6.89 20.83,10.76a11.78,11.78 0 0 1 4.02,9.03q0,14.42-27.29,14.42-19.77,0-45.44-8.08v30.07a207.29,207.27 0 0 0 47.23,5.54q27.76,0 45.2-10.53 21.52-14.02 21.52-37.76 0-17.22-10.98-28.08-9.24-9.15-37.12-21.53zm72.12,94.82h42.54v-152.27h-42.54zm122.56-65.22h59.28v-25.13h-59.28v-34.38h68.1v-27.54h-109.1v152.27h110.86v-29.09h-69.86zm191.1,10.24-38.32-97.29h-55.15v152.27h29.97v-107.81l43.8,109.36h26.37l44.67-109.36v107.81h40.33v-152.27h-52.39zm171.7-10.24h59.28v-25.13h-59.28v-34.38h68.1v-27.54h-109.1v152.27h110.85v-29.09h-69.85zm199.46,14.88l-52.3-101.93h-49.31v152.27h29.98v-104.02l54.02,104.02h47.91v-152.27h-29.97zm126.02-44.48q-19.35-8.71-24.02-11.4-5.17-4.02-5.17-8.6 0-14.09 25.62-14.09 18.2,0 39.41,8.47v-28.93q-28.52-5.55-44.02-5.55-27.33,0-44.34,11.72-17.21,11.83-17.21,34.42 0,17.54 11.82,29.04 9.12,8.72 39.19,21.08 16.76,6.89 20.83,10.76a11.78,11.78 0 0 1 4.02,9.03q0,14.42-27.29,14.42-19.77,0-45.44-8.08v30.07a207.29,207.27 0 0 0 47.23,5.54q27.76,0 45.2-10.53 21.52-14.02 21.52-37.76 0-17.22-10.98-28.08-9.24-9.15-37.12-21.53z"/>
<path style="fill:#641e8c" d="m123.9,189.25c-13.3-.75-26.8-1.25-40.4-1.25s-27.1,.5-40.4,1.25a45.5,45.5 0 0 0-43.1,45.25v62a45.5,45.5 0 0 0 43.1,45.25c13.3,.75 26.8,1.25 40.4,1.25s27.1-.5 40.4-1.25a45.5,45.5 0 0 0 43.1-45.25v-3.5h-19.5v3.5a25.9,25.9 0 0 1-24.4,25.7c-13.1,.8-26.3,1.3-39.6,1.3s-26.5-.5-39.6-1.3a25.9,25.9 0 0 1-24.4-25.7v-62a25.9,25.9 0 0 1 24.4-25.7c13.1-.8 26.3-1.3 39.6-1.3s26.5,.5 39.6,1.3a25.9,25.9 0 0 1 24.4,25.7v21h-80.5v20h100v-41a45.5,45.5 0 0 0-43.1-45.25z"/>
</svg>`

interface LabourPerson { name: string; role: string; type: string; hours: number; sell: number; allowances: number }
interface HireItem { hire_type: string; name: string; customer_total: number; start_date: string; end_date: string; vendor: string }
interface BackOfficeEntry { name: string; role: string; hours: number; sell: number }
interface ToolingCosting { tv_no: string; sell_eur: number; charge_start: string; charge_end: string }
interface Expense { description: string; category: string; sell_price: number; vendor: string; date: string }
interface Accommodation { property: string; room: string; check_in: string; check_out: string; nightly_rate: number; customer_total: number; nights: number }
interface Car { vendor: string; vehicle_type: string; start_date: string; end_date: string; daily_rate: number; customer_total: number; days: number }

export function CustomerReportPanel() {
  const { activeProject } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [html, setHtml] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const reportDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })

    const [tsRes, rcRes, hireRes, boRes, tcRes, varRes, expRes, accomRes, carRes, vlRes] = await Promise.all([
      supabase.from('weekly_timesheets').select('type,regime,crew').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('hire_type,name,customer_total,start_date,end_date,vendor').eq('project_id', pid),
      supabase.from('back_office_hours').select('name,role,hours,sell').eq('project_id', pid),
      supabase.from('tooling_costings').select('tv_no,sell_eur,charge_start,charge_end').eq('project_id', pid),
      supabase.from('variations').select('id,number,title,status').eq('project_id', pid).eq('status', 'approved'),
      supabase.from('expenses').select('description,category,sell_price,date,vendor').eq('project_id', pid),
      supabase.from('accommodation').select('property,room,check_in,check_out,nightly_rate,customer_total,nights').eq('project_id', pid),
      supabase.from('cars').select('vendor,vehicle_type,start_date,end_date,daily_rate,customer_total,days').eq('project_id', pid),
      supabase.from('variation_lines').select('variation_id,sell_total,description').eq('project_id', pid),
    ])

    const rcs = (rcRes.data || []) as RateCard[]
    const getRC = (role: string) => rcs.find(r => r.role.toLowerCase() === role.toLowerCase()) || null

    // ── Labour ──────────────────────────────────────────────────────────────
    const sheets = tsRes.data || []
    const byPerson: Record<string, LabourPerson> = {}
    for (const sheet of sheets) {
      const typeLabel = sheet.type === 'mgmt' ? 'Management' : sheet.type === 'seag' ? 'SE AG' : sheet.type === 'subcon' ? 'Subcontractor' : 'Trades'
      for (const member of (sheet.crew || [])) {
        const rc = getRC(member.role)
        const key = member.name + '|' + typeLabel
        if (!byPerson[key]) byPerson[key] = { name: member.name, role: member.role || '', type: typeLabel, hours: 0, sell: 0, allowances: 0 }
        for (const [, d] of Object.entries(member.days || {})) {
          const day = d as { hours?: number; dayType?: string; shiftType?: string; laha?: boolean; meal?: boolean; fsa?: boolean }
          if (!day.hours) continue
          const rawDayType = day.dayType || 'weekday'; const normDayType = rawDayType === 'public_holiday' ? 'publicHoliday' : rawDayType as 'weekday'|'saturday'|'sunday'|'publicHoliday'; const split = splitHours(day.hours, normDayType, (day.shiftType || 'day') as 'day'|'night', (sheet.regime || 'lt12') as 'lt12'|'ge12', rc?.regime)
          const sell = rc ? calcHoursCost(split, rc, 'sell') : 0
          const isMgmt = rc?.category === 'management' || rc?.category === 'seag'
          let allow = 0
          if (isMgmt) { if (day.fsa) allow = Number(rc?.fsa_sell) || 0; else if (day.laha) allow = Number(rc?.fsa_sell) || 0 }
          else { allow = (day.laha ? Number(rc?.laha_sell) || 0 : 0) + (day.meal ? Number(rc?.meal_sell) || 0 : 0) }
          byPerson[key].hours += day.hours
          byPerson[key].sell += sell
          byPerson[key].allowances += allow
        }
      }
    }
    const labourPeople = Object.values(byPerson).filter(p => p.sell + p.allowances > 0)
    const labourSell = labourPeople.reduce((s, p) => s + p.sell + p.allowances, 0)

    // ── Equipment Hire ───────────────────────────────────────────────────────
    const hire = ((hireRes.data || []) as HireItem[]).filter(h => h.customer_total > 0)
    const hireSell = hire.reduce((s, h) => s + h.customer_total, 0)

    // ── Back Office ──────────────────────────────────────────────────────────
    const boByPerson: Record<string, { name: string; role: string; hours: number; sell: number }> = {}
    for (const e of (boRes.data || []) as BackOfficeEntry[]) {
      const k = e.name + '|' + e.role
      if (!boByPerson[k]) boByPerson[k] = { name: e.name, role: e.role, hours: 0, sell: 0 }
      boByPerson[k].hours += e.hours || 0
      boByPerson[k].sell += e.sell || 0
    }
    const boPeople = Object.values(boByPerson).filter(p => p.sell > 0)
    const boSell = boPeople.reduce((s, p) => s + p.sell, 0)

    // ── Tooling ──────────────────────────────────────────────────────────────
    const tooling = ((tcRes.data || []) as ToolingCosting[]).filter(t => t.sell_eur > 0)
    const toolingSellEur = tooling.reduce((s, t) => s + t.sell_eur, 0)

    // ── Variations ───────────────────────────────────────────────────────────
    const varLines = vlRes.data || []
    const varIds = new Set((varRes.data || []).map((v: { id: string }) => v.id))
    const varMap = (varRes.data || []).reduce((m: Record<string, string>, v: { id: string; number: string; title: string }) => { m[v.id] = `${v.number} — ${v.title}`; return m }, {})
    const approvedLines = varLines.filter(l => varIds.has(l.variation_id))
    const variationsSell = approvedLines.reduce((s: number, l: { sell_total: number }) => s + (l.sell_total || 0), 0)

    // ── Accommodation ─────────────────────────────────────────────────────────
    const accom = ((accomRes.data || []) as Accommodation[]).filter(a => a.customer_total > 0)
    const accomSell = accom.reduce((s, a) => s + a.customer_total, 0)

    // ── Cars ──────────────────────────────────────────────────────────────────
    const cars = ((carRes.data || []) as Car[]).filter(c => c.customer_total > 0)
    const carSell = cars.reduce((s, c) => s + c.customer_total, 0)

    // ── Expenses ──────────────────────────────────────────────────────────────
    const expenses = ((expRes.data || []) as Expense[]).filter(e => e.sell_price > 0)
    const expSell = expenses.reduce((s, e) => s + e.sell_price, 0)

    const grandSell = labourSell + hireSell + boSell + accomSell + carSell + expSell + variationsSell

    // ── Build HTML report ────────────────────────────────────────────────────
    const TH = (s: string, right = false) => `<th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:5px 8px;font-size:8px;text-transform:uppercase;text-align:${right ? 'right' : 'left'};color:#475569;font-weight:700">${s}</th>`
    const TD = (s: string | number, right = false, bold = false) => `<td style="border:1px solid #e2e8f0;padding:4px 8px;font-size:9px;vertical-align:top;${right ? 'text-align:right;font-family:monospace;' : ''}${bold ? 'font-weight:700;' : ''}">${s}</td>`
    const section = (num: number, title: string, desc: string, headerRow: string, bodyRows: string, subtotalLabel: string, subtotalVal: number, colSpan: number) => `
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;padding:8px 0 6px;border-bottom:2px solid #e2e8f0">${num}. ${title}</div>
        <p style="font-size:9px;color:#64748b;margin-bottom:10px;line-height:1.5;font-style:italic">${desc}</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot><tr>
            <td colspan="${colSpan}" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">Subtotal — ${subtotalLabel}</td>
            <td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${fmt(subtotalVal)}</td>
          </tr></tfoot>
        </table>
      </div>`

    const sections: string[] = []

    // 1. Labour
    if (labourPeople.length) {
      const rows = labourPeople.sort((a, b) => (b.sell + b.allowances) - (a.sell + a.allowances)).map(p =>
        `<tr>${TD(p.name, false, true)}${TD(p.role)}${TD(p.type)}${TD(p.hours.toFixed(1), true)}${TD(fmt(p.sell), true)}${TD(p.allowances > 0 ? fmt(p.allowances) : '—', true)}${TD(fmt(p.sell + p.allowances), true, true)}</tr>`
      ).join('')
      sections.push(section(1, 'Labour', 'Labour charges for all deployed personnel. Rates per the agreed rate card. Allowances include LAHA, Meal, and FSA as applicable.',
        [TH('Name'), TH('Role'), TH('Type'), TH('Hours', true), TH('Labour Sell', true), TH('Allowances', true), TH('Total ($)', true)].join(''),
        rows, 'Labour', labourSell, 6))
    }

    // 2. Equipment Hire
    if (hire.length) {
      const rows = hire.map(h =>
        `<tr>${TD(h.hire_type || '—')}${TD(h.vendor || '—')}${TD(h.name || '—')}${TD(h.start_date || '—')}${TD(h.end_date || '—')}${TD(fmt(h.customer_total), true, true)}</tr>`
      ).join('')
      sections.push(section(2, 'Equipment Hire', 'Third-party equipment hire — dry hire, wet hire and local tools. Customer pricing includes the agreed margin.',
        [TH('Type'), TH('Vendor'), TH('Equipment'), TH('Start'), TH('End'), TH('Total ($)', true)].join(''),
        rows, 'Equipment Hire', hireSell, 5))
    }

    // 3. Accommodation
    if (accom.length) {
      const rows = accom.map(a =>
        `<tr>${TD(a.property || '—')}${TD(a.room || '—')}${TD(a.check_in || '—')}${TD(a.check_out || '—')}${TD(String(a.nights || '—'), true)}${TD(fmt(a.nightly_rate || 0), true)}${TD(fmt(a.customer_total), true, true)}</tr>`
      ).join('')
      sections.push(section(3, 'Accommodation', 'Accommodation for project personnel excluding GST. Nightly rates include the agreed margin.',
        [TH('Property'), TH('Room'), TH('Check-in'), TH('Check-out'), TH('Nights', true), TH('Nightly Rate', true), TH('Total ($)', true)].join(''),
        rows, 'Accommodation', accomSell, 6))
    }

    // 4. Car Hire
    if (cars.length) {
      const rows = cars.map(c =>
        `<tr>${TD(c.vendor || '—')}${TD(c.vehicle_type || '—')}${TD(c.start_date || '—')}${TD(c.end_date || '—')}${TD(String(c.days || '—'), true)}${TD(fmt(c.daily_rate || 0), true)}${TD(fmt(c.customer_total), true, true)}</tr>`
      ).join('')
      sections.push(section(4, 'Car Hire', 'Vehicle hire for project personnel excluding GST. Daily rates include the agreed margin.',
        [TH('Vendor'), TH('Vehicle'), TH('Start'), TH('End'), TH('Days', true), TH('Daily Rate', true), TH('Total ($)', true)].join(''),
        rows, 'Car Hire', carSell, 6))
    }

    // 5. Back Office Hours
    if (boPeople.length) {
      const rows = boPeople.sort((a, b) => b.sell - a.sell).map(p =>
        `<tr>${TD(p.name, false, true)}${TD(p.role)}${TD(p.hours.toFixed(1), true)}${TD(fmt(p.sell), true, true)}</tr>`
      ).join('')
      sections.push(section(5, 'Back Office Hours', 'Engineering, planning and project support hours by back-office personnel.',
        [TH('Name'), TH('Role'), TH('Hours', true), TH('Total ($)', true)].join(''),
        rows, 'Back Office Hours', boSell, 3))
    }

    // 6. Tooling Rental
    if (tooling.length) {
      const rows = tooling.map(t =>
        `<tr>${TD('TV' + t.tv_no, false, true)}${TD(t.charge_start || '—')}${TD(t.charge_end || '—')}${TD(fmtEur(t.sell_eur), true, true)}</tr>`
      ).join('')
      const totalEurHtml = `
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;padding:8px 0 6px;border-bottom:2px solid #e2e8f0">6. SE Rental Tooling</div>
        <p style="font-size:9px;color:#64748b;margin-bottom:10px;line-height:1.5;font-style:italic">Rental charges for Siemens Energy specialist tooling. Calculated from replacement value and rental rate. Amounts in EUR, invoiced separately.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
          <thead><tr>${[TH('TV No.'), TH('Charge Start'), TH('Charge End'), TH('Sell (€)', true)].join('')}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td colspan="3" style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">Subtotal — Tooling Rental</td>
            <td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:10px;background:#f8fafc;border-top:2px solid #94a3b8">${fmtEur(toolingSellEur)}</td>
          </tr></tfoot>
        </table>
      </div>`
      sections.push(totalEurHtml)
    }

    // 7. Chargeable Expenses
    if (expenses.length) {
      const rows = expenses.map(e =>
        `<tr>${TD(e.date || '—')}${TD(e.vendor || '—')}${TD(e.description || e.category || '—')}${TD(fmt(e.sell_price), true, true)}</tr>`
      ).join('')
      sections.push(section(7, 'Chargeable Expenses', 'Reimbursable project expenses. Only chargeable items are listed; amounts include agreed margin.',
        [TH('Date'), TH('Vendor'), TH('Description'), TH('Amount ($)', true)].join(''),
        rows, 'Expenses', expSell, 3))
    }

    // 8. Approved Variations
    if (approvedLines.length) {
      const rows = approvedLines.map((l: { variation_id: string; sell_total: number; description: string }) =>
        `<tr>${TD(varMap[l.variation_id] || '—')}${TD(l.description || '—')}${TD(fmt(l.sell_total || 0), true, true)}</tr>`
      ).join('')
      sections.push(section(8, 'Approved Variations', 'Approved contract variations. Sell values include agreed margin.',
        [TH('Variation'), TH('Description'), TH('Sell ($)', true)].join(''),
        rows, 'Variations', variationsSell, 2))
    }

    // ── Summary table ─────────────────────────────────────────────────────────
    const summaryRows = [
      labourSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Labour</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(labourSell)}</td></tr>` : '',
      hireSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Equipment Hire</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(hireSell)}</td></tr>` : '',
      accomSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Accommodation</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(accomSell)}</td></tr>` : '',
      carSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Car Hire</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(carSell)}</td></tr>` : '',
      boSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Back Office Hours</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(boSell)}</td></tr>` : '',
      toolingSellEur > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Tooling Rental (EUR — invoiced separately)</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmtEur(toolingSellEur)}</td></tr>` : '',
      expSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Chargeable Expenses</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(expSell)}</td></tr>` : '',
      variationsSell > 0 ? `<tr style="font-weight:700"><td style="padding:4px 14px;border-bottom:1px solid #e0f2fe">Approved Variations</td><td style="padding:4px 14px;text-align:right;font-family:monospace;font-weight:600;border-bottom:1px solid #e0f2fe">${fmt(variationsSell)}</td></tr>` : '',
    ].filter(Boolean).join('')

    const proj = activeProject
    const report = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Customer Cost Report — ${proj?.name}</title>
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
    <div style="font-size:9px;color:#64748b;margin-top:8px">Customer Cost Report</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px">${proj?.name || '—'}</div>
    <div style="font-size:9px;color:#64748b;line-height:1.8">
      ${proj?.client ? `<b>Client:</b> ${proj.client}<br>` : ''}
      ${(proj as typeof proj & {site_address?: string})?.site_address ? `<b>Site:</b> ${(proj as typeof proj & {site_address?: string}).site_address}<br>` : ''}
      ${proj?.start_date ? `<b>Period:</b> ${proj.start_date} to ${proj.end_date || 'ongoing'}<br>` : ''}
      <b>Report Date:</b> ${reportDate}<br>
      ${(proj as typeof proj & {pm?: string})?.pm ? `<b>Prepared By:</b> ${(proj as typeof proj & {pm?: string}).pm}` : ''}
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
    <span>Total Chargeable AUD (excl. GST)</span>
    <span style="font-family:monospace">${fmt(grandSell)}</span>
  </div>
</div>

${sections.join('\n')}

<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8;text-align:center">
  Generated by Overhaul Manager on ${reportDate}. All amounts are sell values inclusive of agreed margins, excluding GST.
  ${toolingSellEur > 0 ? 'Tooling rental amounts are in EUR and are invoiced separately.' : ''}
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

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Customer Report</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
          {activeProject?.name} · Full sell-side cost report with section detail tables
        </p>
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
            <div>• Cost summary table with subtotals by category</div>
            <div>• Per-section detail tables: Labour, Equipment Hire, Accommodation, Car Hire, Back Office, Tooling, Expenses, Variations</div>
            <div>• Print-ready layout (A4 landscape)</div>
          </div>
        </div>
      )}
    </div>
  )
}
