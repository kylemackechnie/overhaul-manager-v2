/**
 * NrgWeeklyRegisterPanel — every line item feeding into the TCE, week-by-week.
 *
 * Reads from timesheet_cost_lines (single source of truth) plus tce-tagged
 * invoices and expenses. For labour rows, re-runs splitHours() against the
 * resource's rate card to break the day's hours into pay bands (NT/T1.5/DT/
 * Night NT/Night OT), each emitted as its own register row.
 *
 * This is the deeper version of the NrgTcePanel drill-down: every line
 * available, no aggregation. Designed for NRG-facing weekly audit.
 *
 * Layout: header → filter bar → one flat table → totals footer.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { splitHours } from '../../engines/costEngine'
import { getEurToBase } from '../../lib/currency'
import { downloadCSV } from '../../lib/csv'
import { HelpButton } from '../../components/HelpButton'
import type { RateCard } from '../../types'

// ── Types ────────────────────────────────────────────────────────────────────

type RowType = 'labour' | 'allowance' | 'travel' | 'invoice' | 'expense'

interface CostLineRaw {
  id: string
  timesheet_id: string
  week_start: string
  work_date: string
  person_id: string
  person_name: string
  role: string
  category: string
  wbs: string
  tce_item_id: string | null
  work_order: string | null
  variation_id: string | null
  day_type: string
  shift_type: string
  allocated_hours: number
  cost_labour: number
  sell_labour: number
  sell_labour_eur: number
  cost_allowances: number
  sell_allowances: number
  timesheet_status: string
  po_id: string | null
}

interface InvoiceRow {
  id: string
  invoice_date: string | null
  invoice_number: string | null
  tce_item_id: string | null
  amount: number | null
  sell_price: number | null
  vendor_details: string | null
  status: string
  po_id: string | null
}

interface ExpenseRow {
  id: string
  date: string | null
  expense_ref: string | null
  tce_item_id: string | null
  description: string
  vendor: string
  cost_ex_gst: number | null
  sell_price: number | null
  chargeable: boolean
}

interface RegisterRow {
  // Identity
  rowKey: string
  type: RowType
  date: string                  // ISO work_date / invoice_date / expense_date
  weekEnding: string            // ISO Sunday of the week the row falls in
  // Identifiers
  tceItemId: string
  tceDescription: string
  variationId: string | null
  // Labour fields
  personName: string
  role: string
  category: string              // trades / mgmt / seag / subcon
  dayType: string
  shiftType: string
  band: string                  // 'NT' | 'T1.5' | 'DT' | 'Night NT' | 'Night OT' | ''
  hours: number                 // numeric hours, 0 for non-labour
  rate: number                  // per-hour rate in row's native currency
  // Allowance / travel fields
  allowanceKind: string         // 'LAHA' | 'FSA' | 'Meal' | 'Camp' | 'Travel' | ''
  // Money
  cost: number                  // AUD
  sell: number                  // AUD
  sellEur: number               // raw EUR (seag only), 0 otherwise
  // Provenance
  wbs: string
  workOrder: string
  poRef: string                 // PO number if linked
  timesheetId: string
  timesheetStatus: string
  ref: string                   // ref/invoice number/expense ref
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<RowType, string> = {
  labour: 'Labour', allowance: 'Allowance', travel: 'Travel',
  invoice: 'Invoice', expense: 'Expense',
}
const TYPE_COLOR: Record<RowType, string> = {
  labour: '#0891b2', allowance: '#7c3aed', travel: '#0ea5e9',
  invoice: '#059669', expense: '#dc2626',
}
const BAND_LABEL: Record<string, string> = {
  dnt: 'NT', dt15: 'T1.5', ddt: 'DT', ddt15: 'DT×1.5',
  nnt: 'Night NT', ndt: 'Night OT', ndt15: 'Night DT',
}
const BAND_COLOR: Record<string, string> = {
  dnt: '#0891b2', dt15: '#d97706', ddt: '#7c3aed', ddt15: '#dc2626',
  nnt: '#0369a1', ndt: '#b45309', ndt15: '#991b1b',
}

function fmt(n: number, currency: '$' | '€' = '$'): string {
  if (!isFinite(n) || Math.abs(n) < 0.005) return '—'
  return currency + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d: string): string {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}
function isoSunday(workDate: string): string {
  // Return the Sunday of the week containing this date (matches week_ending
  // generated column on timesheet_cost_lines).
  const d = new Date(workDate + 'T12:00:00')
  const dow = d.getDay()   // Sun=0..Sat=6
  d.setDate(d.getDate() + (7 - dow) % 7)
  return d.toISOString().slice(0, 10)
}

// ── Main panel ───────────────────────────────────────────────────────────────

const PAGE = 200

export function NrgWeeklyRegisterPanel() {
  const { activeProject } = useAppStore()

  const [loading, setLoading] = useState(true)
  const [allRows, setAllRows] = useState<RegisterRow[]>([])
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([])

  // Filters
  const [weekEnding, setWeekEnding] = useState<string>('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<RowType[]>([])
  const [tceFilter, setTceFilter] = useState<string>('')
  const [personFilter, setPersonFilter] = useState<string>('')
  const [page, setPage] = useState(0)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id

    const [clRes, tceRes, rcRes, invRes, expRes, poRes] = await Promise.all([
      supabase.from('timesheet_cost_lines')
        .select('id,timesheet_id,week_start,work_date,person_id,person_name,role,category,wbs,tce_item_id,work_order,variation_id,day_type,shift_type,allocated_hours,cost_labour,sell_labour,sell_labour_eur,cost_allowances,sell_allowances,timesheet_status,po_id')
        .eq('project_id', pid)
        .not('tce_item_id', 'is', null),
      supabase.from('nrg_tce_lines')
        .select('item_id,description')
        .eq('project_id', pid),
      supabase.from('rate_cards')
        .select('*')
        .eq('project_id', pid),
      supabase.from('invoices')
        .select('id,invoice_date,invoice_number,tce_item_id,amount,sell_price,vendor_details,status,po_id')
        .eq('project_id', pid)
        .in('status', ['approved', 'paid'])
        .not('tce_item_id', 'is', null),
      supabase.from('expenses')
        .select('id,date,expense_ref,tce_item_id,description,vendor,cost_ex_gst,sell_price,chargeable')
        .eq('project_id', pid)
        .not('tce_item_id', 'is', null),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid),
    ])

    const costLines = (clRes.data || []) as CostLineRaw[]
    const tceLines = (tceRes.data || []) as { item_id: string | null; description: string | null }[]
    const rateCards = (rcRes.data || []) as RateCard[]
    const invoices = (invRes.data || []) as InvoiceRow[]
    const expenses = (expRes.data || []) as ExpenseRow[]
    const pos = (poRes.data || []) as { id: string; po_number: string | null; vendor: string | null }[]

    // ── Lookups ──
    const tceDescById: Record<string, string> = {}
    for (const l of tceLines) if (l.item_id) tceDescById[l.item_id] = l.description || ''
    const rcByRole: Record<string, RateCard> = {}
    for (const r of rateCards) rcByRole[r.role.toLowerCase()] = r
    const poById: Record<string, string> = {}
    for (const p of pos) poById[p.id] = p.po_number || p.vendor || ''

    const rows: RegisterRow[] = []

    // ── Labour + Allowance + Travel rows from timesheet_cost_lines ──────────
    for (const cl of costLines) {
      const tceItemId = cl.tce_item_id || ''
      const tceDescription = tceDescById[tceItemId] || ''
      const weekEnding = isoSunday(cl.work_date)
      const poRef = cl.po_id ? (poById[cl.po_id] || '') : ''
      const baseShared = {
        date: cl.work_date,
        weekEnding,
        tceItemId,
        tceDescription,
        variationId: cl.variation_id,
        personName: cl.person_name,
        role: cl.role,
        category: cl.category,
        dayType: cl.day_type,
        shiftType: cl.shift_type,
        wbs: cl.wbs,
        workOrder: cl.work_order || '',
        poRef,
        timesheetId: cl.timesheet_id,
        timesheetStatus: cl.timesheet_status,
        ref: '',
      }

      // ── Labour row(s): break into per-band sub-rows where possible ──
      if (cl.allocated_hours > 0 && (cl.cost_labour > 0 || cl.sell_labour > 0 || cl.sell_labour_eur > 0)) {
        const rc = rcByRole[(cl.role || '').toLowerCase()]
        const rcCurrency = ((rc as unknown as { currency?: string })?.currency) || 'AUD'
        const isEurCard = rcCurrency === 'EUR'
        const rcRegime = rc ? ((rc as unknown as { regime?: unknown }).regime) : undefined
        const rcRates = rc ? ((rc as unknown as { rates?: { sell: Record<string,number>; cost: Record<string,number> } }).rates) : undefined

        let bandSplit: Record<string, number> | null = null
        if (rc) {
          try {
            bandSplit = splitHours(
              cl.allocated_hours,
              cl.day_type,
              cl.shift_type as 'day' | 'night',
              rcRegime as Parameters<typeof splitHours>[3],
            ) as unknown as Record<string, number>
          } catch { /* fall through to flat row */ }
        }

        const stampedBands = bandSplit
          ? Object.entries(bandSplit).filter(([, h]) => (h as number) > 0)
          : []

        if (stampedBands.length > 0 && rcRates) {
          // Per-band sub-rows. Cost/sell prorated by hours so the totals
          // reconcile with the stored cost_labour / sell_labour (which may
          // include mealBreakAdj or payCode overrides we can't recover from
          // cost_lines alone — the proration keeps totals honest).
          const totalBandHours = stampedBands.reduce((s, [, h]) => s + (h as number), 0) || cl.allocated_hours
          for (const [bandKey, bandHrs] of stampedBands) {
            const h = bandHrs as number
            const ratio = h / totalBandHours
            const sellRate = (rcRates.sell?.[bandKey] as number) || 0
            const costRate = (rcRates.cost?.[bandKey] as number) || 0
            // For SEAG, native rates are EUR — show rate as such; AUD figures
            // come from prorating the cost_lines stored values (already
            // FX-converted at write time using the timesheet's fx_rate).
            const sellAud = cl.sell_labour * ratio
            const costAud = cl.cost_labour * ratio
            const sellEur = cl.sell_labour_eur * ratio
            rows.push({
              ...baseShared,
              rowKey: `cl-${cl.id}-${bandKey}`,
              type: 'labour',
              band: BAND_LABEL[bandKey] || bandKey,
              hours: h,
              rate: isEurCard ? sellRate : sellRate, // native rate; UI labels with currency
              allowanceKind: '',
              cost: costAud,
              sell: sellAud,
              sellEur: isEurCard ? sellEur : 0,
            })
            void costRate
          }
        } else {
          // No rate card / no band breakdown → flat single labour row.
          rows.push({
            ...baseShared,
            rowKey: `cl-${cl.id}-flat`,
            type: 'labour',
            band: '',
            hours: cl.allocated_hours,
            rate: cl.allocated_hours > 0 ? cl.sell_labour / cl.allocated_hours : 0,
            allowanceKind: '',
            cost: cl.cost_labour,
            sell: cl.sell_labour,
            sellEur: cl.sell_labour_eur,
          })
        }
      }

      // ── Allowance / travel row ──
      // The writer emits dedicated allowance rows (allocated_hours=0,
      // sell_allowances>0). Travel allowance lives in the same row when
      // the day's `travel` flag is set with hours, but cost_lines doesn't
      // tell us which kind it was — best we can do is label as 'Allowance'
      // and leave the kind blank. Future enhancement: write allowance_kind
      // to cost_lines.
      if (cl.cost_allowances > 0 || cl.sell_allowances > 0) {
        rows.push({
          ...baseShared,
          rowKey: `cl-${cl.id}-allow`,
          type: 'allowance',
          band: '',
          hours: 0,
          rate: 0,
          allowanceKind: '',
          cost: cl.cost_allowances,
          sell: cl.sell_allowances,
          sellEur: 0,
        })
      }
    }

    // ── Invoices tagged to TCE items ────────────────────────────────────────
    for (const inv of invoices) {
      const tceItemId = inv.tce_item_id || ''
      const tceDescription = tceDescById[tceItemId] || ''
      const date = inv.invoice_date || ''
      const weekEnding = date ? isoSunday(date) : ''
      const poRef = inv.po_id ? (poById[inv.po_id] || '') : ''
      rows.push({
        rowKey: `inv-${inv.id}`,
        type: 'invoice',
        date,
        weekEnding,
        tceItemId,
        tceDescription,
        variationId: null,
        personName: '',
        role: '',
        category: '',
        dayType: '',
        shiftType: '',
        band: '',
        hours: 0,
        rate: 0,
        allowanceKind: '',
        cost: inv.amount || 0,
        sell: inv.sell_price || inv.amount || 0,
        sellEur: 0,
        wbs: '',
        workOrder: '',
        poRef,
        timesheetId: '',
        timesheetStatus: inv.status,
        ref: inv.invoice_number || inv.vendor_details || '',
      })
    }

    // ── Expenses tagged to TCE items ────────────────────────────────────────
    for (const exp of expenses) {
      const tceItemId = exp.tce_item_id || ''
      const tceDescription = tceDescById[tceItemId] || ''
      const date = exp.date || ''
      const weekEnding = date ? isoSunday(date) : ''
      rows.push({
        rowKey: `exp-${exp.id}`,
        type: 'expense',
        date,
        weekEnding,
        tceItemId,
        tceDescription,
        variationId: null,
        personName: '',
        role: '',
        category: '',
        dayType: '',
        shiftType: '',
        band: '',
        hours: 0,
        rate: 0,
        allowanceKind: '',
        cost: exp.cost_ex_gst || 0,
        sell: exp.chargeable ? (exp.sell_price || exp.cost_ex_gst || 0) : 0,
        sellEur: 0,
        wbs: '',
        workOrder: '',
        poRef: '',
        timesheetId: '',
        timesheetStatus: '',
        ref: exp.expense_ref || exp.vendor || '',
      })
    }

    // ── Sort by date desc, then person, then type ──
    rows.sort((a, b) => {
      const dt = b.date.localeCompare(a.date)
      if (dt !== 0) return dt
      const pn = a.personName.localeCompare(b.personName)
      if (pn !== 0) return pn
      return a.type.localeCompare(b.type)
    })

    setAllRows(rows)

    // ── Build week list from data ──
    const weeks = Array.from(new Set(rows.map(r => r.weekEnding).filter(Boolean))).sort().reverse()
    setAvailableWeeks(weeks)
    if (weeks.length > 0 && !weekEnding) setWeekEnding(weeks[0])

    setLoading(false)
  }

  // ── Filters ──
  const filtered = useMemo(() => {
    return allRows.filter(r => {
      if (weekEnding && r.weekEnding !== weekEnding) return false
      if (typeFilter.length && !typeFilter.includes(r.type)) return false
      if (tceFilter && !(r.tceItemId.toLowerCase().includes(tceFilter.toLowerCase()) || r.tceDescription.toLowerCase().includes(tceFilter.toLowerCase()))) return false
      if (personFilter && !r.personName.toLowerCase().includes(personFilter.toLowerCase())) return false
      if (search) {
        const q = search.toLowerCase()
        if (!(
          r.tceItemId.toLowerCase().includes(q) ||
          r.tceDescription.toLowerCase().includes(q) ||
          r.personName.toLowerCase().includes(q) ||
          r.wbs.toLowerCase().includes(q) ||
          r.workOrder.toLowerCase().includes(q) ||
          r.ref.toLowerCase().includes(q) ||
          r.role.toLowerCase().includes(q)
        )) return false
      }
      return true
    })
  }, [allRows, weekEnding, typeFilter, tceFilter, personFilter, search])

  const totalCost = filtered.reduce((s, r) => s + r.cost, 0)
  const totalSell = filtered.reduce((s, r) => s + r.sell, 0)
  const totalSellEur = filtered.reduce((s, r) => s + r.sellEur, 0)
  const totalHours = filtered.filter(r => r.type === 'labour').reduce((s, r) => s + r.hours, 0)

  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE))
  useEffect(() => { setPage(0) }, [weekEnding, typeFilter, tceFilter, personFilter, search])

  const allTypes: RowType[] = Array.from(new Set(allRows.map(r => r.type))) as RowType[]

  function toggleType(t: RowType) {
    setTypeFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  function exportCSV() {
    const eurToAud = activeProject ? getEurToBase(activeProject) : 1
    const headers = [
      'Date','Week Ending','Type','TCE ID','TCE Description','Variation ID',
      'Person','Role','Category','Day Type','Shift',
      'Band','Hours','Rate (native)','Allowance Kind',
      'Cost (AUD)','Sell (AUD)','Sell (EUR)','Project FX',
      'WBS','Work Order','PO','Timesheet ID','Status','Ref',
    ]
    const csvRows: (string | number)[][] = [
      headers,
      ...filtered.map(r => [
        r.date, r.weekEnding, TYPE_LABEL[r.type],
        r.tceItemId, r.tceDescription, r.variationId || '',
        r.personName, r.role, r.category, r.dayType, r.shiftType,
        r.band, r.hours.toFixed(2),
        r.rate.toFixed(4), r.allowanceKind,
        r.cost.toFixed(2), r.sell.toFixed(2),
        r.sellEur.toFixed(2), eurToAud.toFixed(4),
        r.wbs, r.workOrder, r.poRef, r.timesheetId, r.timesheetStatus, r.ref,
      ]),
    ]
    const wkLabel = weekEnding ? `_wk-${weekEnding}` : ''
    downloadCSV(csvRows, `NRG_Weekly_Register${wkLabel}_${activeProject?.name || 'project'}`)
  }

  if (!activeProject) return <div className="empty-state"><h3>No project selected</h3></div>

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: '100%' }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>NRG Weekly Cost Register</h1>
          <HelpButton panelId="nrg-weekly-register" />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
          Every line item feeding into the TCE for the selected week — labour (per pay band), allowances, travel, invoices, and expenses tagged to TCE items.
        </p>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Week ending:</label>
          <select className="input" style={{ width: '180px', fontSize: '12px' }}
            value={weekEnding} onChange={e => setWeekEnding(e.target.value)}>
            {availableWeeks.length === 0 && <option value="">— no data —</option>}
            {availableWeeks.map(w => (
              <option key={w} value={w}>
                {new Date(w + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
              </option>
            ))}
          </select>
          <input className="input" style={{ width: '200px', fontSize: '12px' }}
            placeholder="Search TCE / person / WO / ref…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <input className="input" style={{ width: '160px', fontSize: '12px' }}
            placeholder="TCE filter…"
            value={tceFilter} onChange={e => setTceFilter(e.target.value)} />
          <input className="input" style={{ width: '140px', fontSize: '12px' }}
            placeholder="Person filter…"
            value={personFilter} onChange={e => setPersonFilter(e.target.value)} />
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
        </div>

        {/* Type pills */}
        {allTypes.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text3)', alignSelf: 'center' }}>Type:</span>
            {allTypes.map(t => (
              <button key={t} onClick={() => toggleType(t)} style={{
                fontSize: '10px', padding: '2px 8px', borderRadius: '10px', cursor: 'pointer', border: 'none',
                background: typeFilter.includes(t) ? TYPE_COLOR[t] : 'var(--bg3)',
                color: typeFilter.includes(t) ? '#fff' : 'var(--text2)',
                fontWeight: typeFilter.includes(t) ? 600 : 400,
              }}>{TYPE_LABEL[t]}</button>
            ))}
            {typeFilter.length > 0 && (
              <button className="btn btn-sm" onClick={() => setTypeFilter([])}>✕ Clear</button>
            )}
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '24px', fontSize: '12px', alignItems: 'baseline' }}>
        <span><b>{filtered.length}</b> rows</span>
        <span><b style={{ fontFamily: 'var(--mono)' }}>{totalHours.toFixed(2)}h</b> labour</span>
        <span>Cost: <b style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmt(totalCost)}</b></span>
        <span>Sell: <b style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(totalSell)}</b></span>
        {totalSellEur > 0 && <span style={{ color: 'var(--text3)' }}>incl. EUR labour: <b style={{ fontFamily: 'var(--mono)' }}>{fmt(totalSellEur, '€')}</b></span>}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-center" style={{ padding: '40px' }}><span className="spinner" /> Loading register…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            {allRows.length === 0 ? 'No TCE-tagged cost lines, invoices, or expenses found.' : 'No rows match the current filters.'}
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', minWidth: '1500px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    <th style={TH}>Date</th>
                    <th style={TH}>Type</th>
                    <th style={{ ...TH, fontFamily: 'var(--mono)' }}>TCE ID</th>
                    <th style={TH}>TCE Description</th>
                    <th style={TH}>Person</th>
                    <th style={TH}>Role</th>
                    <th style={TH}>Cat</th>
                    <th style={TH}>Day</th>
                    <th style={TH}>Shift</th>
                    <th style={TH}>Band</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Hours</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Rate</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Cost</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Sell</th>
                    <th style={{ ...TH, textAlign: 'right' }}>EUR Labour</th>
                    <th style={{ ...TH, fontFamily: 'var(--mono)' }}>WBS</th>
                    <th style={{ ...TH, fontFamily: 'var(--mono)' }}>WO</th>
                    <th style={{ ...TH, fontFamily: 'var(--mono)' }}>PO</th>
                    <th style={TH}>VN</th>
                    <th style={TH}>Status</th>
                    <th style={TH}>Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const isLabour = r.type === 'labour'
                    const isSeag = r.category === 'seag'
                    return (
                      <tr key={r.rowKey} style={{ borderBottom: '0.5px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg2)' }}>
                        <td style={{ ...TD, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                        <td style={TD}>
                          <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '10px', background: TYPE_COLOR[r.type] + '22', color: TYPE_COLOR[r.type], fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {TYPE_LABEL[r.type]}
                          </span>
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--mono)', fontSize: '10px', color: r.tceItemId ? 'var(--text)' : 'var(--text3)' }}>{r.tceItemId || '—'}</td>
                        <td style={{ ...TD, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.tceDescription}>{r.tceDescription || '—'}</td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>{r.personName || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text3)', fontSize: '10px' }}>{r.role || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text3)', fontSize: '10px' }}>{r.category || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text3)', fontSize: '10px' }}>{r.dayType || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text3)', fontSize: '10px' }}>{r.shiftType || '—'}</td>
                        <td style={TD}>
                          {r.band ? (
                            <span style={{
                              fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                              background: (BAND_COLOR[Object.keys(BAND_LABEL).find(k => BAND_LABEL[k] === r.band) || ''] || '#888') + '22',
                              color: BAND_COLOR[Object.keys(BAND_LABEL).find(k => BAND_LABEL[k] === r.band) || ''] || '#888',
                              fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'var(--mono)',
                            }}>{r.band}</span>
                          ) : '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                          {isLabour && r.hours > 0 ? r.hours.toFixed(2) + 'h' : '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: '10px' }}>
                          {isLabour && r.rate > 0 ? fmt(r.rate, isSeag ? '€' : '$') : '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                          {fmt(r.cost)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--green)' }}>
                          {fmt(r.sell)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: '10px' }}>
                          {r.sellEur > 0 ? fmt(r.sellEur, '€') : '—'}
                        </td>
                        <td style={{ ...TD, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{r.wbs || '—'}</td>
                        <td style={{ ...TD, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{r.workOrder || '—'}</td>
                        <td style={{ ...TD, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{r.poRef || '—'}</td>
                        <td style={{ ...TD, fontSize: '10px' }}>{r.variationId ? <span style={{ background: '#fdf2f8', color: '#701a75', padding: '1px 4px', borderRadius: '3px', fontWeight: 600 }}>VN</span> : '—'}</td>
                        <td style={{ ...TD, fontSize: '10px', color: 'var(--text3)' }}>{r.timesheetStatus || '—'}</td>
                        <td style={{ ...TD, fontSize: '10px', color: 'var(--text3)' }}>{r.ref || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                    <td colSpan={10} style={{ ...TD, color: 'var(--text2)' }}>
                      Page {page + 1} of {totalPages} · {filtered.length.toLocaleString()} rows
                    </td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {totalHours.toFixed(2)}h
                    </td>
                    <td style={TD} />
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmt(totalCost)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(totalSell)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                      {totalSellEur > 0 ? fmt(totalSellEur, '€') : '—'}
                    </td>
                    <td colSpan={6} style={TD} />
                  </tr>
                </tfoot>
              </table>
            </div>

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

      <div style={{ marginTop: '10px', fontSize: '10px', color: 'var(--text3)', lineHeight: 1.5 }}>
        Labour rows are broken into pay bands (NT / T1.5 / DT / Night NT / Night OT) by re-running splitHours against the resource's rate card.
        Per-band Cost / Sell are prorated from the stored daily totals on <code>timesheet_cost_lines</code> so they reconcile with the writer's output even when mealBreakAdj or per-allocation payCode overrides were applied.
        SEAG labour 'EUR Labour' column shows the raw EUR before FX conversion — Sell (AUD) is the FX-converted figure stored at save time using the timesheet's fx_rate.
        Allowances stay AUD throughout.
      </div>
    </div>
  )
}

const TH: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontWeight: 600,
  fontSize: '9px', color: 'var(--text3)', textTransform: 'uppercase',
  letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
}
const TD: React.CSSProperties = { padding: '4px 8px', verticalAlign: 'middle' }
