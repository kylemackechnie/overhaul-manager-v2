/**
 * exportTce.ts
 *
 * Fills the NRG Skilled Labour TCE template (public/tce_skilled_labour_template.xlsx)
 * with live OMV2 data and triggers a browser download.
 *
 * Template structure (sheet: "Skilled Labour"):
 *   Row 1: section group headers (merged, styled)
 *   Row 2: column sub-headers (bold, 126pt tall)
 *   Rows 3+: data — H-type rows (orange fill, bold) then F/O/V detail rows
 *
 * Column mapping:
 *   A  Service Order Number/Release   → contract_scope
 *   B  Work Order                     → work_order
 *   C  Scope No.                      → item_id
 *   D  Activity description           → description
 *   E  Scope Type                     → line_type (H/F/O/V)
 *   F  Task responsibility            → details.task_responsibility
 *   G  Variable Scope Measurement     → (blank)
 *   H  Comment                        → notes
 *   I  (hidden spacer)                → (blank)
 *   J  Estimated Hours (TCE)          → estimated_qty  / SUM formula for H rows
 *   K  Gang rate $/hr                 → tce_rate
 *   L  Estimated Total Cost           → tce_total / SUM formula for H rows
 *   M  Notes (TCE)                    → (blank)
 *   N  Adjusted Est Hours             → (blank)
 *   O  Adj Gang rate                  → (blank)
 *   P  Adj Estimated Total Cost       → (blank)
 *   Q  Adj Notes                      → (blank)
 *   R  (spacer)                       → (blank)
 *   S–AN  Week 1–11 Actual Hours + Cost → from timesheet_cost_lines (sorted week_ending)
 *   AO Variation Hours                → from variations
 *   AP Variation Amount               → from variations
 *   AQ Total Actual Hours             → =SUM(S,U,W,...,AM)
 *   AR Total Actual Cost              → =SUM(T,V,X,...,AN)+AP
 *   AS Total Actual Gang Rate         → =AR/AQ
 *   AT % Hours Complete               → =AQ/J
 *   AU % Cost Used                    → =AR/L
 *   AV Task Complete                  → (blank)
 *   AW Forecast Cost                  → (blank)
 */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import type { NrgTceLine } from '../types'

// Col indices (0-based) for the 11 week pairs: S=18,T=19 … AM=38,AN=39
const WEEK_COLS: [number, number][] = [
  [18, 19], [20, 21], [22, 23], [24, 25], [26, 27], [28, 29],
  [30, 31], [32, 33], [34, 35], [36, 37], [38, 39],
]
const COL_VAR_HRS   = 40 // AO
const COL_VAR_AMT   = 41 // AP
const COL_TOT_HRS   = 42 // AQ
const COL_TOT_COST  = 43 // AR
const COL_GANG_RATE = 44 // AS
const COL_PCT_HRS   = 45 // AT
const COL_PCT_COST  = 46 // AU

/** Orange fill used on H-type (group header) rows */
const ORANGE_FILL = { patternType: 'solid', fgColor: { rgb: 'FFCC99' }, bgColor: { indexed: 64 } }
/** Accounting format matching the template's dollar columns */
const FMT_DOLLAR = '_-"$"* #,##0.00_-;\\-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-'
const FMT_HOURS  = '0.00'
const FMT_PCT    = '0.00%'

/** Convert 0-based column index to Excel letter(s) */
function colLetter(c: number): string {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function cellAddr(col: number, row: number): string {
  return colLetter(col) + row
}

/** Build a SUM formula string for non-contiguous row ranges (col letter fixed, rows vary) */
function sumFormula(col: string, ranges: [number, number][]): string {
  return '=SUM(' + ranges.map(([r1, r2]) => r1 === r2 ? `${col}${r1}` : `${col}${r1}:${col}${r2}`).join(',') + ')'
}

interface CostRow {
  tce_item_id: string | null
  week_ending: string
  allocated_hours: number
  sell_labour: number
  sell_labour_eur: number
  sell_allowances: number
  cost_labour: number
  cost_allowances: number
}

interface VariationRow {
  tce_link: string
  sell_total: number
  status: string
}

export async function exportTceSkilledLabour(
  projectId: string,
  projectName: string,
  lines: NrgTceLine[],
) {
  // ── 1. Fetch cost lines, variations, and nrg invoices ──────────────────
  const [clRes, varRes, nrgInvRes] = await Promise.all([
    supabase
      .from('timesheet_cost_lines')
      .select('tce_item_id,week_ending,allocated_hours,sell_labour,sell_labour_eur,sell_allowances,cost_labour,cost_allowances')
      .eq('project_id', projectId)
      .eq('timesheet_status', 'approved'),
    supabase
      .from('variations')
      .select('tce_link,sell_total,status')
      .eq('project_id', projectId)
      .in('status', ['approved', 'submitted']),
    supabase
      .from('nrg_customer_invoices')
      .select('week_ending,eur_spot_rate')
      .eq('project_id', projectId)
      .order('week_ending'),
  ])

  const costLines = (clRes.data || []) as CostRow[]
  const variations = (varRes.data || []) as VariationRow[]

  // ── 2. Spot rate lookup (week_ending → rate) ────────────────────────────
  const nrgInvSorted = ((nrgInvRes.data || []) as { week_ending: string | null; eur_spot_rate: number | null }[])
    .filter(i => i.week_ending)
    .sort((a, b) => (a.week_ending!).localeCompare(b.week_ending!))

  function spotRateForWorkDate(workDate: string): number | null {
    // week_ending from work_date: advance to Sunday
    const dt = new Date(workDate + 'T12:00:00')
    dt.setUTCDate(dt.getUTCDate() + (7 - dt.getUTCDay()) % 7 || 7)
    const we = dt.toISOString().slice(0, 10)
    const covering = nrgInvSorted.find(i => i.week_ending! >= we)
    const r = covering?.eur_spot_rate
    return r != null && !isNaN(Number(r)) ? Number(r) : null
  }

  // ── 3. Aggregate cost lines by item_id × week_ending ───────────────────
  // Sorted unique week endings (chronological) — up to 11
  const weekEndingsAll = [...new Set(costLines.map(r => r.week_ending))].sort()
  const weekEndings = weekEndingsAll.slice(0, 11) // template supports 11 weeks

  // { item_id → { week_ending → { hours, sell } } }
  const byItemWeek: Record<string, Record<string, { hours: number; sell: number }>> = {}
  for (const r of costLines) {
    if (!r.tce_item_id) continue
    if (!byItemWeek[r.tce_item_id]) byItemWeek[r.tce_item_id] = {}
    const we = r.week_ending
    if (!byItemWeek[r.tce_item_id][we]) byItemWeek[r.tce_item_id][we] = { hours: 0, sell: 0 }
    byItemWeek[r.tce_item_id][we].hours += r.allocated_hours || 0
    // For sell: use spot rate for EUR rows, direct sell_labour for others
    const eurAmt = r.sell_labour_eur || 0
    let sell: number
    if (eurAmt > 0) {
      const rate = spotRateForWorkDate(we) // approximation: use week_ending as work date
      sell = rate != null ? eurAmt * rate : r.sell_labour || 0
    } else {
      sell = (r.sell_labour || 0)
    }
    sell += (r.sell_allowances || 0)
    byItemWeek[r.tce_item_id][we].sell += sell
  }

  // Aggregate variations by tce_link (item_id)
  const varByItem: Record<string, { hours: number; amount: number }> = {}
  for (const v of variations) {
    if (!v.tce_link) continue
    if (!varByItem[v.tce_link]) varByItem[v.tce_link] = { hours: 0, amount: 0 }
    varByItem[v.tce_link].amount += v.sell_total || 0
  }

  // ── 4. Load template ────────────────────────────────────────────────────
  const resp = await fetch('/tce_skilled_labour_template.xlsx')
  const buf = await resp.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellStyles: true, cellNF: true, cellFormula: true })
  const ws = wb.Sheets['Skilled Labour']

  // ── 5. Delete all existing data rows (row 3+) ───────────────────────────
  // We do this by removing all cell keys with row >= 3
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue
    const match = key.match(/\d+$/)
    if (match && parseInt(match[0]) >= 3) delete ws[key]
  }

  // ── 6. Build row data ───────────────────────────────────────────────────
  // Group header rows (line_type === 'H' or item_id matches X.Y.Z pattern without .N suffix)
  const isGroupHeader = (l: NrgTceLine) =>
    l.line_type === 'H' || (!!l.item_id && /^\d+\.\d+\.\d+$/.test(l.item_id))

  // Only skilled labour lines
  const skilledLines = lines.filter(l => l.source === 'skilled')

  // For H rows we need to know which detail rows follow them (for SUM ranges)
  // We'll do two passes: first build row layout, then write cells

  interface RowSpec {
    line: NrgTceLine
    excelRow: number
    isHeader: boolean
  }
  const rowSpecs: RowSpec[] = []
  let excelRow = 3
  for (const line of skilledLines) {
    rowSpecs.push({ line, excelRow, isHeader: isGroupHeader(line) })
    excelRow++
  }

  // ── 7. Write rows into worksheet ────────────────────────────────────────
  // Helper: set a cell with value + style + format
  function setCell(
    addr: string,
    value: string | number | null,
    fmt: string,
    style: Record<string, unknown>,
    cellType?: string,
    formula?: string,
  ) {
    const t = formula ? 'n' : (value === null || value === undefined ? 'z' : typeof value === 'number' ? 'n' : 's')
    const cell: Record<string, unknown> = { t: cellType || t, z: fmt, s: style }
    if (formula) {
      cell.f = formula
      cell.v = value ?? 0
    } else if (value !== null && value !== undefined) {
      cell.v = value
    }
    ws[addr] = cell
  }

  // Pass 1: group detail rows under their headers
  const grouped: { header: RowSpec; details: RowSpec[] }[] = []
  let currentGroup: { header: RowSpec; details: RowSpec[] } | null = null
  for (const spec of rowSpecs) {
    if (spec.isHeader) {
      if (currentGroup) grouped.push(currentGroup)
      currentGroup = { header: spec, details: [] }
    } else {
      if (currentGroup) currentGroup.details.push(spec)
      else {
        // Detail without a header — treat as standalone
        grouped.push({ header: spec, details: [] })
      }
    }
  }
  if (currentGroup) grouped.push(currentGroup)

  const allRows: RowSpec[] = []
  for (const g of grouped) {
    allRows.push(g.header)
    allRows.push(...g.details)
  }

  // Write rows
  for (const g of grouped) {
    const hSpec = g.header
    const dSpecs = g.details
    const hRow = hSpec.excelRow
    const l = hSpec.line
    const isH = hSpec.isHeader

    // Orange style for H rows, plain for details
    const fill = isH ? ORANGE_FILL : { patternType: 'none' }
    const boldStyle = { ...fill, bold: true }
    const plainStyle = fill

    // SUM ranges for J and L on H rows
    let jFormula: string | undefined
    let lFormula: string | undefined
    if (isH && dSpecs.length > 0) {
      const rows = dSpecs.map(d => d.excelRow)
      const ranges: [number, number][] = []
      let start = rows[0], end = rows[0]
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] === end + 1) end = rows[i]
        else { ranges.push([start, end]); start = rows[i]; end = rows[i] }
      }
      ranges.push([start, end])
      jFormula = sumFormula('J', ranges).slice(1) // remove leading =
      lFormula = sumFormula('L', ranges).slice(1)
    }

    const taskResp = (l.details as Record<string, unknown>)?.task_responsibility as string || ''

    // Write columns A–H
    setCell(cellAddr(0, hRow), l.contract_scope || '', 'General', boldStyle)
    setCell(cellAddr(1, hRow), l.work_order || '', 'General', boldStyle)
    setCell(cellAddr(2, hRow), l.item_id || '', 'General', boldStyle)
    setCell(cellAddr(3, hRow), l.description || '', 'General', boldStyle)
    setCell(cellAddr(4, hRow), l.line_type || '', 'General', boldStyle)
    setCell(cellAddr(5, hRow), taskResp, 'General', plainStyle)
    setCell(cellAddr(6, hRow), '', 'General', plainStyle)
    setCell(cellAddr(7, hRow), l.notes || '', 'General', plainStyle)

    // Col I (index 8) — hidden spacer, leave empty
    // Cols J, K, L — TCE estimates
    if (isH && jFormula) {
      setCell(cellAddr(9, hRow), null, 'General', boldStyle, 'n', jFormula)
    } else {
      setCell(cellAddr(9, hRow), isH ? null : (l.estimated_qty || 0), 'General', isH ? boldStyle : plainStyle)
    }
    setCell(cellAddr(10, hRow), l.tce_rate || 0, FMT_DOLLAR, isH ? boldStyle : plainStyle)
    if (isH && lFormula) {
      setCell(cellAddr(11, hRow), null, FMT_DOLLAR, boldStyle, 'n', lFormula)
    } else {
      setCell(cellAddr(11, hRow), l.tce_total || 0, FMT_DOLLAR, isH ? boldStyle : plainStyle)
    }

    // Cols M–R: blank (adjusted TCE section — not our data)
    for (let c = 12; c <= 17; c++) {
      setCell(cellAddr(c, hRow), null, 'General', plainStyle)
    }

    // Week columns S–AN (indices 18–39): only for detail rows; H rows get blanks
    if (!isH && l.item_id) {
      const weeksData = byItemWeek[l.item_id] || {}
      let totHrs = 0, totSell = 0
      for (let wi = 0; wi < WEEK_COLS.length; wi++) {
        const [hrsCol, costCol] = WEEK_COLS[wi]
        const we = weekEndings[wi]
        const data = we ? (weeksData[we] || { hours: 0, sell: 0 }) : { hours: 0, sell: 0 }
        const hrs = data.hours || 0
        const sell = data.sell || 0
        setCell(cellAddr(hrsCol, hRow), hrs || null, FMT_HOURS, plainStyle)
        setCell(cellAddr(costCol, hRow), sell || null, FMT_DOLLAR, plainStyle)
        if (we) { totHrs += hrs; totSell += sell }
      }

      // Variation cols AO, AP
      const varData = varByItem[l.item_id] || { hours: 0, amount: 0 }
      setCell(cellAddr(COL_VAR_HRS, hRow), varData.hours || null, FMT_HOURS, plainStyle)
      setCell(cellAddr(COL_VAR_AMT, hRow), varData.amount || null, FMT_DOLLAR, plainStyle)

      // Totals AQ, AR, AS, AT, AU
      const totalHrs = totHrs + (varData.hours || 0)
      const totalCost = totSell + (varData.amount || 0)
      setCell(cellAddr(COL_TOT_HRS, hRow), totalHrs || null, FMT_HOURS, plainStyle)
      setCell(cellAddr(COL_TOT_COST, hRow), totalCost || null, FMT_DOLLAR, plainStyle)
      // Gang rate = cost / hours
      if (totalHrs > 0) {
        setCell(cellAddr(COL_GANG_RATE, hRow), totalCost / totalHrs, FMT_DOLLAR, plainStyle)
      }
      // % Hours = total hrs / estimated_qty
      const estQty = l.estimated_qty || 0
      if (estQty > 0) {
        setCell(cellAddr(COL_PCT_HRS, hRow), totalHrs / estQty, FMT_PCT, plainStyle)
      }
      // % Cost = total cost / tce_total
      const tceTotal = l.tce_total || 0
      if (tceTotal > 0) {
        setCell(cellAddr(COL_PCT_COST, hRow), totalCost / tceTotal, FMT_PCT, plainStyle)
      }
    } else {
      // H row or no item_id: blank week/total cols
      for (let c = 18; c <= 46; c++) {
        setCell(cellAddr(c, hRow), null, 'General', isH ? boldStyle : plainStyle)
      }
    }

    // Now write detail rows
    for (const dSpec of dSpecs) {
      const dr = dSpec.excelRow
      const dl = dSpec.line
      const df = { patternType: 'none' }
      const taskR = (dl.details as Record<string, unknown>)?.task_responsibility as string || ''

      setCell(cellAddr(0, dr), dl.contract_scope || '', 'General', df)
      setCell(cellAddr(1, dr), dl.work_order || '', 'General', df)
      setCell(cellAddr(2, dr), dl.item_id || '', 'General', df)
      setCell(cellAddr(3, dr), dl.description || '', 'General', df)
      setCell(cellAddr(4, dr), dl.line_type || '', 'General', df)
      setCell(cellAddr(5, dr), taskR, 'General', df)
      setCell(cellAddr(6, dr), '', 'General', df)
      setCell(cellAddr(7, dr), dl.notes || '', 'General', df)
      setCell(cellAddr(9, dr), dl.estimated_qty || 0, 'General', df)
      setCell(cellAddr(10, dr), dl.tce_rate || 0, FMT_DOLLAR, df)
      setCell(cellAddr(11, dr), dl.tce_total || 0, FMT_DOLLAR, df)
      for (let c = 12; c <= 17; c++) setCell(cellAddr(c, dr), null, 'General', df)

      // Week actuals
      if (dl.item_id) {
        const weeksData = byItemWeek[dl.item_id] || {}
        let totHrs = 0, totSell = 0
        for (let wi = 0; wi < WEEK_COLS.length; wi++) {
          const [hrsCol, costCol] = WEEK_COLS[wi]
          const we = weekEndings[wi]
          const data = we ? (weeksData[we] || { hours: 0, sell: 0 }) : { hours: 0, sell: 0 }
          setCell(cellAddr(hrsCol, dr), data.hours || null, FMT_HOURS, df)
          setCell(cellAddr(costCol, dr), data.sell || null, FMT_DOLLAR, df)
          if (we) { totHrs += data.hours || 0; totSell += data.sell || 0 }
        }
        const varData = varByItem[dl.item_id] || { hours: 0, amount: 0 }
        setCell(cellAddr(COL_VAR_HRS, dr), varData.hours || null, FMT_HOURS, df)
        setCell(cellAddr(COL_VAR_AMT, dr), varData.amount || null, FMT_DOLLAR, df)
        const totalHrs = totHrs + (varData.hours || 0)
        const totalCost = totSell + (varData.amount || 0)
        setCell(cellAddr(COL_TOT_HRS, dr), totalHrs || null, FMT_HOURS, df)
        setCell(cellAddr(COL_TOT_COST, dr), totalCost || null, FMT_DOLLAR, df)
        if (totalHrs > 0) setCell(cellAddr(COL_GANG_RATE, dr), totalCost / totalHrs, FMT_DOLLAR, df)
        const estQty = dl.estimated_qty || 0
        if (estQty > 0) setCell(cellAddr(COL_PCT_HRS, dr), totalHrs / estQty, FMT_PCT, df)
        const tceTotal = dl.tce_total || 0
        if (tceTotal > 0) setCell(cellAddr(COL_PCT_COST, dr), totalCost / tceTotal, FMT_PCT, df)
      } else {
        for (let c = 18; c <= 46; c++) setCell(cellAddr(c, dr), null, 'General', df)
      }
    }
  }

  // ── 8. Update sheet range ───────────────────────────────────────────────
  const lastRow = rowSpecs.length > 0 ? rowSpecs[rowSpecs.length - 1].excelRow : 2
  ws['!ref'] = `A1:AW${lastRow}`

  // ── 9. Write and download ───────────────────────────────────────────────
  const outBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true })
  const blob = new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `TCE_Skilled_Labour_${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
