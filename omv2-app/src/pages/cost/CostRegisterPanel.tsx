/**
 * CostRegisterPanel — Raw cost ledger
 *
 * Two tables:
 *   ACTUALS  — every cost that has been definitively incurred
 *              (approved timesheet lines, expenses, back office, SE support,
 *               approved invoices, approved variation lines)
 *
 *   COMMITTED — every booked cost, expanded to daily rows
 *               (hire items, cars, accommodation, tooling charge periods)
 *
 * All booking sources are expanded to one row per day.
 * Both tables share the same filter bar and support CSV export.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { calcRentalCost } from '../../lib/calculations'
import { fxRate } from '../../lib/currency'
import type {
  HireItem, Car, Accommodation, Expense, BackOfficeHour,
  ToolingCosting, GlobalTV, GlobalDepartment, Invoice,
  VariationLine,
} from '../../types'

// ── Shared row shape ──────────────────────────────────────────────────────────

interface CostRow {
  id: string
  type: string
  date: string         // ISO date — for bookings this is the specific expanded day
  description: string
  category: string
  wbs: string
  cost: number
  sell: number
  currency: string     // display currency (AUD unless EUR source)
  ref: string          // human reference (timesheet week, hire name, invoice no...)
}

const TYPE_LABEL: Record<string, string> = {
  labour: 'Labour', expense: 'Expense', backoffice: 'Back Office',
  se_support: 'SE Support', invoice: 'Invoice', variation: 'Variation',
  hire: 'Hire', car: 'Car', accom: 'Accom', tooling: 'Tooling',
}
const TYPE_COLOR: Record<string, string> = {
  labour: '#0891b2', expense: '#dc2626', backoffice: '#6366f1',
  se_support: '#1d4ed8', invoice: '#059669', variation: '#d97706',
  hire: '#d97706', car: '#059669', accom: '#7c3aed', tooling: '#1d4ed8',
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function expandDays(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T12:00:00')
  const last = new Date(end + 'T12:00:00')
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function fmt(n: number, eur = false): string {
  const sym = eur ? '€' : '$'
  return sym + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ── Main component ────────────────────────────────────────────────────────────

const PAGE = 100

export function CostRegisterPanel() {
  const { activeProject } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [actuals, setActuals] = useState<CostRow[]>([])
  const [committed, setCommitted] = useState<CostRow[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [wbsFilter, setWbsFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Pagination
  const [actualsPage, setActualsPage] = useState(0)
  const [committedPage, setCommittedPage] = useState(0)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    const [
      costLinesR, expensesR, boR, seR, invoicesR, posR,
      varsR, varLinesR, hireR, carsR, accomR,
      tcOwnedR, tcCrossR, tvsR, deptsR,
    ] = await Promise.all([
      supabase.from('timesheet_cost_lines')
        .select('id,work_date,person_name,role,category,wbs,cost_labour,sell_labour,cost_allowances,sell_allowances,week_start')
        .eq('project_id', pid).eq('timesheet_status', 'approved'),
      supabase.from('expenses').select('*').eq('project_id', pid),
      supabase.from('back_office_hours').select('*').eq('project_id', pid),
      supabase.from('se_support_costs')
        .select('id,date,person,description,amount,sell_price,currency,wbs')
        .eq('project_id', pid),
      supabase.from('invoices').select('*').eq('project_id', pid),
      supabase.from('purchase_orders').select('id,po_number,vendor,currency').eq('project_id', pid),
      supabase.from('variations').select('id,number,status').eq('project_id', pid),
      supabase.from('variation_lines').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').eq('project_id', pid),
      supabase.from('tooling_costings').select('*').neq('project_id', pid)
        .filter('splits', 'cs', `[{"projectId":"${pid}"}]`),
      supabase.from('global_tvs').select('*'),
      supabase.from('global_departments').select('*'),
    ])

    const project = activeProject!
    const eurRate = fxRate(project, 'EUR')
    const poMap = new Map((posR.data || []).map((p: { id: string; po_number: string; vendor: string; currency: string }) => [p.id, p]))
    const approvedVnIds = new Set(
      ((varsR.data || []) as { id: string; status: string }[])
        .filter(v => v.status === 'approved').map(v => v.id)
    )
    const tvByNo = Object.fromEntries(((tvsR.data || []) as GlobalTV[]).map(tv => [tv.tv_no, tv]))
    const deptById = Object.fromEntries(((deptsR.data || []) as GlobalDepartment[]).map(d => [d.id, d]))

    // ── ACTUALS ──────────────────────────────────────────────────────────────

    const acts: CostRow[] = []

    // Timesheet cost lines
    for (const cl of (costLinesR.data || []) as {
      id: string; work_date: string; person_name: string; role: string
      category: string; wbs: string; cost_labour: number; sell_labour: number
      cost_allowances: number; sell_allowances: number; week_start: string
    }[]) {
      const cost = (Number(cl.cost_labour) || 0) + (Number(cl.cost_allowances) || 0)
      const sell = (Number(cl.sell_labour) || 0) + (Number(cl.sell_allowances) || 0)
      if (!cost && !sell) continue
      const cat = cl.category || 'trades'
      acts.push({
        id: cl.id, type: 'labour', date: cl.work_date,
        description: `${cl.person_name || '—'}${cl.role ? ` (${cl.role})` : ''}`,
        category: cat === 'management' ? 'Management' : cat === 'seag' ? 'SE AG' : cat === 'subcontractor' ? 'Subcontractor' : 'Trades',
        wbs: cl.wbs || '', cost, sell, currency: 'AUD',
        ref: `Wk ${cl.week_start}`,
      })
    }

    // Expenses
    for (const e of (expensesR.data || []) as Expense[]) {
      const cost = Number(e.cost_ex_gst) || 0
      const sell = Number(e.sell_price) || 0
      acts.push({
        id: e.id, type: 'expense', date: e.date || '',
        description: e.description || e.vendor || 'Expense',
        category: e.category || 'Expense',
        wbs: e.wbs || '', cost, sell, currency: e.currency || 'AUD',
        ref: e.expense_ref || '',
      })
    }

    // Back office hours
    for (const bo of (boR.data || []) as BackOfficeHour[]) {
      acts.push({
        id: bo.id, type: 'backoffice', date: bo.date,
        description: `${bo.name}${bo.role ? ` (${bo.role})` : ''}`,
        category: 'Back Office', wbs: bo.wbs || '',
        cost: Number(bo.cost) || 0, sell: Number(bo.sell) || 0, currency: 'AUD',
        ref: `${bo.hours}h`,
      })
    }

    // SE support costs
    for (const se of (seR.data || []) as {
      id: string; date: string; person: string; description: string
      amount: number; sell_price: number; currency: string; wbs: string
    }[]) {
      const isEur = (se.currency || 'EUR') === 'EUR'
      const cost = (Number(se.amount) || 0) * (isEur ? eurRate : 1)
      const sell = (Number(se.sell_price) || Number(se.amount) || 0) * (isEur ? eurRate : 1)
      acts.push({
        id: se.id, type: 'se_support', date: se.date || '',
        description: `${se.person || ''}${se.description ? ` — ${se.description}` : ''}`.trim() || 'SE Support',
        category: 'SE Support', wbs: se.wbs || '',
        cost, sell, currency: 'AUD', ref: '',
      })
    }

    // Approved invoices
    for (const inv of (invoicesR.data || []) as Invoice[]) {
      if (inv.status !== 'approved') continue
      const po = inv.po_id ? poMap.get(inv.po_id) : null
      const invCurrency = inv.currency || 'AUD'
      const invFx = invCurrency !== 'AUD' ? fxRate(project, invCurrency) : 1
      const cost = (Number(inv.amount) || 0) * invFx
      acts.push({
        id: inv.id, type: 'invoice',
        date: inv.invoice_date || inv.received_date || '',
        description: `${po?.vendor || inv.vendor_ref || 'Invoice'} — ${inv.invoice_number || '—'}`,
        category: 'Invoice', wbs: inv.sap_wbs || '',
        cost, sell: cost, currency: 'AUD',
        ref: po ? `PO ${po.po_number}` : '',
      })
    }

    // Approved variation lines (cost side)
    for (const vl of (varLinesR.data || []) as VariationLine[]) {
      if (!approvedVnIds.has(vl.variation_id)) continue
      acts.push({
        id: vl.id, type: 'variation', date: '',
        description: vl.description || vl.category || 'Variation',
        category: 'Variation', wbs: vl.wbs || '',
        cost: Number(vl.cost_total) || 0, sell: Number(vl.sell_total) || 0,
        currency: 'AUD', ref: '',
      })
    }

    // ── COMMITTED ────────────────────────────────────────────────────────────

    const comm: CostRow[] = []

    // Hire items — expand to daily
    for (const h of (hireR.data || []) as HireItem[]) {
      if (!h.start_date || !h.end_date) continue
      const days = expandDays(h.start_date, h.end_date)
      if (!days.length) continue
      const hCurrency = (h as HireItem & { currency?: string }).currency || 'AUD'
      const hFx = hCurrency !== 'AUD' ? fxRate(project, hCurrency) : 1
      const totalCost = (Number(h.hire_cost) || 0) * hFx
      const totalSell = (Number(h.customer_total) || 0) * hFx
      const dailyCost = totalCost / days.length
      const dailySell = totalSell / days.length
      const typeKey = h.hire_type === 'dry' ? 'hire' : h.hire_type === 'wet' ? 'hire' : 'hire'
      const catLabel = h.hire_type === 'dry' ? 'Dry Hire' : h.hire_type === 'wet' ? 'Wet Hire' : 'Local Hire'
      for (const day of days) {
        comm.push({
          id: `${h.id}-${day}`, type: typeKey, date: day,
          description: `${h.name || h.description || 'Hire'}${h.vendor ? ` — ${h.vendor}` : ''}`,
          category: catLabel, wbs: h.wbs || '',
          cost: dailyCost, sell: dailySell, currency: 'AUD',
          ref: `${h.start_date} → ${h.end_date}`,
        })
      }
    }

    // Cars — expand to daily
    for (const c of (carsR.data || []) as Car[]) {
      if (!c.start_date || !c.end_date) continue
      const days = expandDays(c.start_date, c.end_date)
      if (!days.length) continue
      const dailyCost = Number(c.daily_rate) || (Number(c.total_cost) || 0) / days.length
      const dailySell = (Number(c.customer_total) || Number(c.total_cost) || 0) / days.length
      for (const day of days) {
        comm.push({
          id: `${c.id}-${day}`, type: 'car', date: day,
          description: `${c.vehicle_type || 'Car'}${c.rego ? ` (${c.rego})` : ''}${c.vendor ? ` — ${c.vendor}` : ''}`,
          category: 'Car', wbs: c.wbs || '',
          cost: dailyCost, sell: dailySell, currency: 'AUD',
          ref: `${c.start_date} → ${c.end_date}`,
        })
      }
    }

    // Accommodation — expand to daily
    for (const a of (accomR.data || []) as Accommodation[]) {
      if (!a.check_in || !a.check_out) continue
      const days = expandDays(a.check_in, a.check_out)
      if (!days.length) continue
      const nights = Math.max(1, Number(a.nights) || days.length)
      const dailyCost = (Number(a.total_cost) || 0) / nights
      const dailySell = (Number(a.customer_total) || Number(a.total_cost) || 0) / nights
      for (const day of days) {
        comm.push({
          id: `${a.id}-${day}`, type: 'accom', date: day,
          description: `${a.property || 'Accom'}${a.room ? ` Rm ${a.room}` : ''}${a.vendor ? ` — ${a.vendor}` : ''}`,
          category: 'Accommodation', wbs: a.wbs || '',
          cost: dailyCost, sell: dailySell, currency: 'AUD',
          ref: `${a.check_in} → ${a.check_out}`,
        })
      }
    }

    // Tooling — expand to daily using calcRentalCost
    const allTc = [...(tcOwnedR.data || []), ...(tcCrossR.data || [])] as ToolingCosting[]
    for (const tc of allTc) {
      if (!tc.charge_start || !tc.charge_end) continue
      const days = expandDays(tc.charge_start, tc.charge_end)
      if (!days.length) continue
      const tv = tvByNo[tc.tv_no] as GlobalTV & { replacement_value_eur?: number; department_id?: string }
      if (!tv) continue
      const dept = tv.department_id ? (deptById[tv.department_id] as GlobalDepartment & { rates?: Record<string, unknown> }) : null
      if (!dept) continue
      const rates = (dept.rates || {}) as Record<string, unknown>
      const deptCalc = {
        rental_pct: Number(rates.rentalPct || 0),
        rate_unit: ((rates.rateUnit as string) || 'weekly') as 'weekly' | 'daily' | 'monthly',
        gm_pct: Number(rates.gmPct || 0),
      }
      const replVal = Number(tv.replacement_value_eur || 0)
      if (!replVal) continue
      const fx = tc.fx_rate || eurRate || 1.65
      const calc = calcRentalCost(replVal, {
        charge_start: tc.charge_start,
        charge_end: tc.charge_end,
        sell_override_eur: tc.sell_override_eur ?? null,
      }, deptCalc)
      if (!calc) continue
      const totalCost = calc.cost * fx
      const totalSell = calc.sell * fx
      const dailyCost = totalCost / days.length
      const dailySell = totalSell / days.length
      for (const day of days) {
        comm.push({
          id: `${tc.id}-${day}`, type: 'tooling', date: day,
          description: `TV${tc.tv_no}${tv.header_name ? ` — ${tv.header_name}` : ''}`,
          category: 'Tooling', wbs: tc.wbs || '',
          cost: dailyCost, sell: dailySell, currency: 'AUD',
          ref: `${tc.charge_start} → ${tc.charge_end}`,
        })
      }
    }

    // Sort both by date desc
    acts.sort((a, b) => b.date.localeCompare(a.date))
    comm.sort((a, b) => b.date.localeCompare(a.date))

    setActuals(acts)
    setCommitted(comm)
    setLoading(false)
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  function applyFilters(rows: CostRow[]): CostRow[] {
    return rows.filter(r => {
      if (dateFrom && r.date && r.date < dateFrom) return false
      if (dateTo && r.date && r.date > dateTo) return false
      if (wbsFilter && !r.wbs.toLowerCase().includes(wbsFilter.toLowerCase())) return false
      if (typeFilter.length && !typeFilter.includes(r.type)) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.description.toLowerCase().includes(q) &&
            !r.category.toLowerCase().includes(q) &&
            !r.wbs.toLowerCase().includes(q) &&
            !r.ref.toLowerCase().includes(q)) return false
      }
      return true
    })
  }

  const filteredActuals   = useMemo(() => applyFilters(actuals),   [actuals, search, typeFilter, wbsFilter, dateFrom, dateTo])
  const filteredCommitted = useMemo(() => applyFilters(committed),  [committed, search, typeFilter, wbsFilter, dateFrom, dateTo])

  const actualsPage_rows   = filteredActuals.slice(actualsPage * PAGE, (actualsPage + 1) * PAGE)
  const committedPage_rows = filteredCommitted.slice(committedPage * PAGE, (committedPage + 1) * PAGE)

  // Reset pages when filters change
  useEffect(() => { setActualsPage(0); setCommittedPage(0) },
    [search, typeFilter, wbsFilter, dateFrom, dateTo])

  // Totals
  const actTotal  = useMemo(() => filteredActuals.reduce((s, r) => s + r.cost, 0), [filteredActuals])
  const commTotal = useMemo(() => filteredCommitted.reduce((s, r) => s + r.cost, 0), [filteredCommitted])

  // CSV export
  function exportCSV(rows: CostRow[], name: string) {
    const header = 'Date,Type,Description,Category,WBS,Cost,Sell,Currency,Ref'
    const lines = rows.map(r =>
      [r.date, r.type, `"${r.description.replace(/"/g, '""')}"`, r.category, r.wbs,
       r.cost.toFixed(2), r.sell.toFixed(2), r.currency, r.ref].join(',')
    )
    const csv = [header, ...lines].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${name}_${activeProject?.name || 'project'}.csv`
    a.click()
  }

  // All type keys for filter checkboxes
  const allActualTypes   = [...new Set(actuals.map(r => r.type))]
  const allCommittedTypes = [...new Set(committed.map(r => r.type))]
  const allTypes = [...new Set([...allActualTypes, ...allCommittedTypes])].sort()

  function toggleType(t: string) {
    setTypeFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  if (!activeProject) return <div className="empty-state"><h3>No project selected</h3></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Cost Register</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
          Raw ledger of every cost item — actuals incurred and committed bookings, expanded to daily rows
        </p>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ width: '220px' }} placeholder="Search description / WBS / ref…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <input className="input" style={{ width: '120px' }} type="date" title="Date from"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span style={{ fontSize: '12px', color: 'var(--text3)' }}>→</span>
          <input className="input" style={{ width: '120px' }} type="date" title="Date to"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
          <input className="input" style={{ width: '140px' }} placeholder="WBS filter…"
            value={wbsFilter} onChange={e => setWbsFilter(e.target.value)} />
          <div style={{ flex: 1 }} />
          {typeFilter.length > 0 && (
            <button className="btn btn-sm" onClick={() => setTypeFilter([])}>✕ Clear filters</button>
          )}
        </div>

        {/* Type pills */}
        {allTypes.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text3)', alignSelf: 'center' }}>Type:</span>
            {allTypes.map(t => (
              <button key={t} onClick={() => toggleType(t)} style={{
                fontSize: '10px', padding: '2px 8px', borderRadius: '10px', cursor: 'pointer', border: 'none',
                background: typeFilter.includes(t) ? (TYPE_COLOR[t] || 'var(--accent)') : 'var(--bg3)',
                color: typeFilter.includes(t) ? '#fff' : 'var(--text2)',
                fontWeight: typeFilter.includes(t) ? 600 : 400,
              }}>
                {TYPE_LABEL[t] || t}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="loading-center"><span className="spinner" /> Loading cost register…</div>}

      {!loading && (
        <>
          {/* ── ACTUALS ── */}
          <CostTable
            title="Actuals"
            subtitle="Approved timesheets · Expenses · Back office · SE support · Approved invoices · Approved variations"
            accentColor="var(--green)"
            rows={filteredActuals}
            pageRows={actualsPage_rows}
            page={actualsPage}
            setPage={setActualsPage}
            totalCost={actTotal}
            totalRows={filteredActuals.length}
            onExport={() => exportCSV(filteredActuals, 'actuals')}
          />

          {/* ── COMMITTED ── */}
          <CostTable
            title="Committed"
            subtitle="Hire items · Cars · Accommodation · Tooling — all expanded to daily rows"
            accentColor="#f97316"
            rows={filteredCommitted}
            pageRows={committedPage_rows}
            page={committedPage}
            setPage={setCommittedPage}
            totalCost={commTotal}
            totalRows={filteredCommitted.length}
            onExport={() => exportCSV(filteredCommitted, 'committed')}
          />
        </>
      )}
    </div>
  )
}

// ── Reusable table component ──────────────────────────────────────────────────

interface CostTableProps {
  title: string
  subtitle: string
  accentColor: string
  rows: CostRow[]
  pageRows: CostRow[]
  page: number
  setPage: (p: number) => void
  totalCost: number
  totalRows: number
  onExport: () => void
}

function CostTable({ title, subtitle, accentColor, pageRows, page, setPage, totalCost, totalRows, onExport }: CostTableProps) {
  const totalPages = Math.ceil(totalRows / PAGE)
  const totalSell  = pageRows.reduce((s, r) => s + r.sell, 0)

  return (
    <div className="card" style={{ padding: 0, marginBottom: '24px', overflow: 'hidden' }}>
      {/* Table header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', borderLeft: `4px solid ${accentColor}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: accentColor }}>{title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: '24px', marginRight: '16px', textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Rows</div>
            <div style={{ fontWeight: 600, fontSize: '13px', fontFamily: 'var(--mono)' }}>{totalRows.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Total Cost</div>
            <div style={{ fontWeight: 700, fontSize: '13px', fontFamily: 'var(--mono)', color: accentColor }}>{fmt(totalCost)}</div>
          </div>
        </div>
        <button className="btn btn-sm" onClick={onExport}>⬇ CSV</button>
      </div>

      {/* Table */}
      {totalRows === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--text3)' }}>No rows match the current filters</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  <th style={TH}>Date</th>
                  <th style={TH}>Type</th>
                  <th style={{ ...TH, minWidth: '280px' }}>Description</th>
                  <th style={TH}>Category</th>
                  <th style={{ ...TH, fontFamily: 'var(--mono)' }}>WBS</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Cost</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Sell</th>
                  <th style={TH}>Ref</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: '0.5px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg2)' }}>
                    <td style={{ ...TD, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                      {r.date ? fmtDate(r.date) : '—'}
                    </td>
                    <td style={TD}>
                      <span style={{
                        fontSize: '9px', padding: '1px 6px', borderRadius: '10px',
                        background: (TYPE_COLOR[r.type] || '#888') + '22',
                        color: TYPE_COLOR[r.type] || '#888',
                        fontWeight: 600, whiteSpace: 'nowrap',
                      }}>
                        {TYPE_LABEL[r.type] || r.type}
                      </span>
                    </td>
                    <td style={{ ...TD, maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.description}
                    </td>
                    <td style={{ ...TD, color: 'var(--text2)' }}>{r.category}</td>
                    <td style={{ ...TD, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>
                      {r.wbs || '—'}
                    </td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                      {fmt(r.cost)}
                    </td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                      {r.sell ? fmt(r.sell) : '—'}
                    </td>
                    <td style={{ ...TD, fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                      {r.ref || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ ...TD, color: 'var(--text2)' }}>
                    Page {page + 1} of {totalPages} · {totalRows.toLocaleString()} rows total
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: accentColor }}>
                    {fmt(pageRows.reduce((s, r) => s + r.cost, 0))}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                    {fmt(totalSell)}
                  </td>
                  <td style={TD} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', padding: '10px', borderTop: '0.5px solid var(--border)' }}>
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(0)}>«</button>
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span style={{ fontSize: '12px', alignSelf: 'center', color: 'var(--text2)' }}>
                {page + 1} / {totalPages}
              </span>
              <button className="btn btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
              <button className="btn btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const TH: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontWeight: 600,
  fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase',
  letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
}
const TD: React.CSSProperties = { padding: '5px 10px', verticalAlign: 'middle' }
