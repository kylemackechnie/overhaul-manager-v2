/**
 * exportTce.ts — fills the NRG Skilled Labour TCE template via direct ZIP/XML
 * manipulation. SheetJS CE loses styles on write, so we load the .xlsx as a
 * ZIP, keep rows 1–2 verbatim, inject new data rows reusing the exact style
 * indices from the original template, append to sharedStrings.xml, and
 * regenerate the ZIP. All header formatting, merges, and column widths are
 * preserved exactly.
 *
 * Style indices (extracted from template row 3 = H-row, row 4 = detail row):
 *   Col  H   Det   |  Col  H   Det   |  Col  H   Det
 *   A    14  33    |  J    20  39    |  S    26  43
 *   B    15  34    |  K    20  42    |  T    27  42
 *   C    16  35    |  L    22  42    |  U…AN  (week pairs: 26/27, 43/42)
 *   D    17  36    |  M    23  39    |  AO   27  42
 *   E    18  37    |  N    20  39    |  AP   27  42
 *   F    19  38    |  O    23  39    |  AQ   28  44
 *   G    20  39    |  P    24  42    |  AR   27  42
 *   H    19  40    |  Q    23  39    |  AS   27  42
 *   I    21  41    |  R    25  39    |  AT   29  45
 *                                    |  AU   30  46
 *                                    |  AV   30  46
 *                                    |  AW   31  47
 * Row-level s: H-rows s="32", detail rows s="48"
 */

import JSZip from 'jszip'
import { supabase } from './supabase'
import type { NrgTceLine } from '../types'

const H_STYLES: Record<string, number> = {
  A:14,B:15,C:16,D:17,E:18,F:19,G:20,H:19,I:21,
  J:20,K:20,L:22,M:23,N:20,O:23,P:24,Q:23,R:25,
  S:26,T:27,U:26,V:27,W:26,X:27,Y:26,Z:27,
  AA:26,AB:27,AC:26,AD:27,AE:26,AF:27,AG:26,AH:27,
  AI:26,AJ:27,AK:26,AL:27,AM:26,AN:27,
  AO:27,AP:27,AQ:28,AR:27,AS:27,AT:29,AU:30,AV:30,AW:31,
}
const D_STYLES: Record<string, number> = {
  A:33,B:34,C:35,D:36,E:37,F:38,G:39,H:40,I:41,
  J:39,K:42,L:42,M:39,N:39,O:39,P:42,Q:39,R:39,
  S:43,T:42,U:43,V:42,W:43,X:42,Y:43,Z:42,
  AA:43,AB:42,AC:43,AD:42,AE:43,AF:42,AG:43,AH:42,
  AI:43,AJ:42,AK:43,AL:42,AM:43,AN:42,
  AO:42,AP:42,AQ:44,AR:42,AS:42,AT:45,AU:46,AV:46,AW:47,
}

const ALL_COLS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R',
  'S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH',
  'AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU','AV','AW',
]
const WEEK_PAIRS: [string, string][] = [
  ['S','T'],['U','V'],['W','X'],['Y','Z'],['AA','AB'],['AC','AD'],
  ['AE','AF'],['AG','AH'],['AI','AJ'],['AK','AL'],['AM','AN'],
]

type CellType = 's' | 'n' | 'f' | ''
interface CellDef { type: CellType; value: string | number | null; formula?: string }

function xmlEsc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}

function buildCell(col: string, row: number, isH: boolean, cd: CellDef): string {
  const s = isH ? H_STYLES[col] : D_STYLES[col]
  const ref = `${col}${row}`
  if (cd.type === '' || cd.value === null || cd.value === undefined) {
    return `<c r="${ref}" s="${s}"/>`
  }
  if (cd.type === 's') return `<c r="${ref}" s="${s}" t="s"><v>${cd.value}</v></c>`
  if (cd.type === 'f' && cd.formula) {
    return `<c r="${ref}" s="${s}"><f>${xmlEsc(cd.formula)}</f><v>${typeof cd.value==='number'?cd.value:0}</v></c>`
  }
  return `<c r="${ref}" s="${s}"><v>${cd.value}</v></c>`
}

function buildRow(rowNum: number, isH: boolean, cells: Record<string, CellDef>): string {
  const rowS = isH ? 32 : 48
  const parts = ALL_COLS.map(col =>
    buildCell(col, rowNum, isH, cells[col] ?? { type: '', value: null })
  )
  return `<row r="${rowNum}" spans="1:49" s="${rowS}" customFormat="1" ht="12.75" customHeight="1" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

interface CostRow {
  tce_item_id: string | null; week_ending: string
  allocated_hours: number; sell_labour: number
  sell_labour_eur: number; sell_allowances: number
}

export async function exportTceSkilledLabour(
  projectId: string,
  projectName: string,
  lines: NrgTceLine[],
  orderedWeeks: string[],  // week_ending dates in the order the user selected (Week 1 = [0], etc.)
) {
  // ── Fetch ─────────────────────────────────────────────────────────────────
  const [clRes, varRes, nrgInvRes, templateResp] = await Promise.all([
    supabase.from('timesheet_cost_lines')
      .select('tce_item_id,week_ending,allocated_hours,sell_labour,sell_labour_eur,sell_allowances')
      .eq('project_id', projectId).eq('timesheet_status', 'approved'),
    supabase.from('variations').select('tce_link,sell_total')
      .eq('project_id', projectId).in('status', ['approved','submitted']),
    supabase.from('nrg_customer_invoices').select('week_ending,eur_spot_rate')
      .eq('project_id', projectId).order('week_ending'),
    fetch('/tce_skilled_labour_template.xlsx'),
  ])

  const costLines = (clRes.data || []) as CostRow[]
  const nrgInvSorted = ((nrgInvRes.data || []) as {week_ending:string|null;eur_spot_rate:number|null}[])
    .filter(i => i.week_ending).sort((a,b) => a.week_ending!.localeCompare(b.week_ending!))
  const templateBuf = await templateResp.arrayBuffer()

  // ── Spot rate lookup — exact match by week_ending ────────────────────────
  // week_ending must always be a Sunday; anything else is a data error.
  // Keyed by week_ending string for O(1) exact lookup.
  const spotRateByWE: Record<string, number | null> = {}
  for (const i of nrgInvSorted) {
    const r = i.eur_spot_rate
    spotRateByWE[i.week_ending!] = r != null && !isNaN(Number(r)) ? Number(r) : null
  }
  function spotRate(we: string): number | null {
    return spotRateByWE[we] ?? null
  }

  // ── Week slots: user-selected ordered list, capped at 11 ─────────────────
  const weekEndings = orderedWeeks.slice(0, 11)

  // ── Aggregate cost lines by item × invoice week_ending ───────────────────
  const byItemWeek: Record<string, Record<string, { hours: number; sell: number }>> = {}
  const weSet = new Set(weekEndings)
  for (const r of costLines) {
    if (!r.tce_item_id || !weSet.has(r.week_ending)) continue
    const b = byItemWeek[r.tce_item_id] ??= {}
    const w = b[r.week_ending] ??= { hours: 0, sell: 0 }
    w.hours += r.allocated_hours || 0
    const eur = r.sell_labour_eur || 0
    w.sell += eur > 0
      ? (spotRate(r.week_ending) ?? 1) * eur + (r.sell_allowances || 0)
      : (r.sell_labour || 0) + (r.sell_allowances || 0)
  }

  const varByItem: Record<string, number> = {}
  for (const v of (varRes.data || []) as {tce_link:string;sell_total:number}[]) {
    if (v.tce_link) varByItem[v.tce_link] = (varByItem[v.tce_link] || 0) + (v.sell_total || 0)
  }

  // ── Load template ZIP ─────────────────────────────────────────────────────
  const zip = await JSZip.loadAsync(templateBuf)
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  const ssXml    = await zip.file('xl/sharedStrings.xml')!.async('string')

  // ── Shared strings ────────────────────────────────────────────────────────
  const existingSiCount = (ssXml.match(/<si>/g) || []).length
  const newSi: string[] = []
  const strCache: Record<string, number> = {}
  function strIdx(s: string): number {
    if (s in strCache) return strCache[s]
    const idx = existingSiCount + newSi.length
    const space = s !== s.trim() ? ' xml:space="preserve"' : ''
    newSi.push(`<si><t${space}>${xmlEsc(s)}</t></si>`)
    strCache[s] = idx
    return idx
  }

  // ── Group TCE lines ───────────────────────────────────────────────────────
  const skilled = lines.filter(l => l.source === 'skilled')
  const isH = (l: NrgTceLine) =>
    l.line_type === 'H' || l.line_type === 'group' || /^\d+\.\d+\.\d+$/.test(l.item_id || '')

  interface Group { hdr: NrgTceLine; dets: NrgTceLine[] }
  const groups: Group[] = []
  let cur: Group | null = null
  for (const l of skilled) {
    if (isH(l)) { if (cur) groups.push(cur); cur = { hdr: l, dets: [] } }
    else if (cur) cur.dets.push(l)
  }
  if (cur) groups.push(cur)

  // ── Build rows ────────────────────────────────────────────────────────────
  const newRows: string[] = []
  let rowNum = 3

  for (const { hdr, dets } of groups) {
    const hRow = rowNum++
    const detRows = dets.map(() => rowNum++)

    // H-row cells
    const hc: Record<string, CellDef> = {
      A: { type:'s', value: strIdx(hdr.contract_scope || '') },
      B: { type:'s', value: strIdx(hdr.work_order || '') },
      C: { type:'s', value: strIdx(hdr.item_id || '') },
      D: { type:'s', value: strIdx(hdr.description || '') },
      E: { type:'s', value: strIdx(hdr.line_type === 'group' ? 'H' : hdr.line_type || '') },
      F: { type:'s', value: strIdx((hdr.details as Record<string,unknown>)?.task_responsibility as string || '') },
      G: { type:'', value:null }, H: { type:'s', value: strIdx(hdr.notes || '') },
      I: { type:'', value:null },
    }
    // J and L: SUM of detail rows if any, else direct value
    if (detRows.length > 0) {
      const jRange = detRows.length === 1 ? `J${detRows[0]}` : `J${detRows[0]}:J${detRows[detRows.length-1]}`
      const lRange = detRows.length === 1 ? `L${detRows[0]}` : `L${detRows[0]}:L${detRows[detRows.length-1]}`
      hc['J'] = { type:'f', value:0, formula:`SUM(${jRange})` }
      hc['L'] = { type:'f', value:0, formula:`SUM(${lRange})` }
    } else {
      hc['J'] = { type:'n', value: hdr.estimated_qty || 0 }
      hc['L'] = { type:'n', value: hdr.tce_total || 0 }
    }
    hc['K'] = { type:'n', value: hdr.tce_rate || 0 }
    // M–R and week/total cols blank on H rows
    for (const c of ['M','N','O','P','Q','R','AO','AP','AQ','AR','AS','AT','AU','AV','AW'])
      hc[c] = { type:'', value:null }
    for (const [wh, wc] of WEEK_PAIRS) { hc[wh] = { type:'', value:null }; hc[wc] = { type:'', value:null } }

    newRows.push(buildRow(hRow, true, hc))

    // Detail rows
    for (let i = 0; i < dets.length; i++) {
      const d = dets[i]
      const dr = detRows[i]
      const dc: Record<string, CellDef> = {
        A: { type:'s', value: strIdx(d.contract_scope || '') },
        C: { type:'s', value: strIdx(d.item_id || '') },
        D: { type:'s', value: strIdx(d.description || '') },
        E: { type:'s', value: strIdx(d.line_type || '') },
        F: { type:'s', value: strIdx((d.details as Record<string,unknown>)?.task_responsibility as string || '') },
        G: { type:'', value:null },
        H: { type:'s', value: strIdx(d.notes || '') },
        I: { type:'', value:null },
        J: { type:'n', value: d.estimated_qty || 0 },
        K: { type:'n', value: d.tce_rate || 0 },
        L: { type:'n', value: d.tce_total || 0 },
      }
      // B: numeric if work_order is a number, else string
      const wo = d.work_order || ''
      const woNum = wo ? Number(wo) : NaN
      dc['B'] = !wo ? { type:'', value:null }
        : isNaN(woNum) ? { type:'s', value: strIdx(wo) }
        : { type:'n', value: woNum }
      for (const c of ['M','N','O','P','Q','R']) dc[c] = { type:'', value:null }

      let totHrs = 0, totSell = 0
      for (let wi = 0; wi < WEEK_PAIRS.length; wi++) {
        const [wh, wc] = WEEK_PAIRS[wi]
        const we = weekEndings[wi]
        const data = we && d.item_id ? (byItemWeek[d.item_id]?.[we] || { hours:0, sell:0 }) : { hours:0, sell:0 }
        dc[wh] = { type: data.hours ? 'n' : '', value: data.hours || null }
        dc[wc] = { type: data.sell  ? 'n' : '', value: data.sell  || null }
        totHrs += data.hours || 0; totSell += data.sell || 0
      }

      const varAmt = d.item_id ? (varByItem[d.item_id] || 0) : 0
      dc['AO'] = { type:'', value:null }
      dc['AP'] = { type: varAmt ? 'n' : '', value: varAmt || null }
      const finalHrs = totHrs, finalCost = totSell + varAmt
      dc['AQ'] = { type: finalHrs  ? 'n' : '', value: finalHrs  || null }
      dc['AR'] = { type: finalCost ? 'n' : '', value: finalCost || null }
      dc['AS'] = finalHrs > 0 ? { type:'n', value: finalCost / finalHrs } : { type:'', value:null }
      dc['AT'] = (d.estimated_qty || 0) > 0 ? { type:'n', value: finalHrs / d.estimated_qty } : { type:'', value:null }
      dc['AU'] = (d.tce_total || 0) > 0    ? { type:'n', value: finalCost / d.tce_total }      : { type:'', value:null }
      dc['AV'] = { type:'', value:null }; dc['AW'] = { type:'', value:null }

      newRows.push(buildRow(dr, false, dc))
    }
  }

  // ── Splice sheet XML ──────────────────────────────────────────────────────
  const row1 = sheetXml.match(/<row r="1"[^>]*>.*?<\/row>/s)?.[0] || ''
  const row2 = sheetXml.match(/<row r="2"[^>]*>.*?<\/row>/s)?.[0] || ''
  const lastRow = rowNum - 1

  const updatedSheet = sheetXml
    .replace(/<sheetData>.*?<\/sheetData>/s,
      `<sheetData>${row1}${row2}${newRows.join('')}</sheetData>`)
    .replace(/ref="A1:AW\d+"/, `ref="A1:AW${lastRow}"`)

  // ── Update sharedStrings ──────────────────────────────────────────────────
  const total = existingSiCount + newSi.length
  const updatedSs = ssXml
    .replace(/count="\d+"/, `count="${total}"`)
    .replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)
    .replace(/<\/sst>/, newSi.join('') + '</sst>')

  zip.file('xl/worksheets/sheet1.xml', updatedSheet)
  zip.file('xl/sharedStrings.xml', updatedSs)
  zip.remove('xl/calcChain.xml')  // avoid stale formula cache warnings in Excel

  // ── Download ──────────────────────────────────────────────────────────────
  const outBuf = await zip.generateAsync({ type:'arraybuffer', compression:'DEFLATE' })
  const blob = new Blob([outBuf], {
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `TCE_Skilled_Labour_${projectName.replace(/[^a-zA-Z0-9_-]/g,'_')}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Overheads + Variations export ────────────────────────────────────────────
// Uses the full NRG template (tce_full_template.xlsx) which contains both
// Overheads (sheet2) and Variations (sheet4).

// Overheads sheet style indices
const OH_H_STYLES: Record<string, number> = {
  A:142,B:142,C:142,D:143,E:144,F:135,
  G:43,H:43,I:43,J:43,K:141,L:43,M:43,N:43,O:43,P:141,
  Q:43,R:43,S:43,T:43,U:43,V:43,W:43,X:43,Y:43,Z:43,
  AA:43,AB:43,AC:43,AD:43,AE:43,AF:43,AG:43,AH:43,AI:43,AJ:43,
  AK:43,AL:43,AM:43,AN:43,AO:43,AP:43,AQ:43,AR:43,AS:43,
  AT:145,AU:145,
}
const OH_D_STYLES: Record<string, number> = {
  A:23,B:23,C:147,D:406,E:148,F:149,
  G:397,H:24,I:25,J:26,K:150,L:27,M:28,N:26,O:26,P:150,
  Q:151,R:44,S:151,T:44,U:151,V:44,W:151,X:44,Y:151,Z:44,
  AA:151,AB:44,AC:151,AD:44,AE:151,AF:44,AG:151,AH:44,AI:151,AJ:44,
  AK:151,AL:44,AM:45,AN:44,AO:44,AP:46,AQ:46,
  AR:152,AS:153,AT:149,AU:149,
}
const OH_COLS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P',
  'Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF',
  'AG','AH','AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU',
]
// Week pairs for Overheads: Q/R … AK/AL (11 weeks)
const OH_WEEK_PAIRS: [string,string][] = [
  ['Q','R'],['S','T'],['U','V'],['W','X'],['Y','Z'],['AA','AB'],
  ['AC','AD'],['AE','AF'],['AG','AH'],['AI','AJ'],['AK','AL'],
]

// Variations sheet style indices (row 2 = header-like, row 3 = data)
const VAR_D_STYLES: Record<string, number> = {
  A:225,B:225,C:224,D:223,E:222,F:222,G:222,H:222,I:272,
  J:238,K:222,L:238,M:222,N:238,O:222,P:238,Q:222,R:238,S:222,
  T:238,U:222,V:238,W:222,X:238,Y:222,Z:238,AA:222,AB:238,AC:222,
  AD:238,AE:222,AF:238,AG:222,AH:274,AI:222,AJ:221,AK:221,AL:222,AM:222,
}
const VAR_COLS = [
  'A','B','C','D','E','F','G','H','I',
  'J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  'AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM',
]
// Week pairs for Variations: J/K … AF/AG (12 weeks — template has 12)
const VAR_WEEK_PAIRS: [string,string][] = [
  ['J','K'],['L','M'],['N','O'],['P','Q'],['R','S'],['T','U'],
  ['V','W'],['X','Y'],['Z','AA'],['AB','AC'],['AD','AE'],['AF','AG'],
]

function buildOHCell(col: string, row: number, isH: boolean, cd: CellDef): string {
  const s = isH ? OH_H_STYLES[col] : OH_D_STYLES[col]
  const ref = `${col}${row}`
  if (cd.type === '' || cd.value === null || cd.value === undefined)
    return `<c r="${ref}" s="${s}"/>`
  if (cd.type === 's') return `<c r="${ref}" s="${s}" t="s"><v>${cd.value}</v></c>`
  if (cd.type === 'f' && cd.formula)
    return `<c r="${ref}" s="${s}"><f>${xmlEsc(cd.formula)}</f><v>${typeof cd.value==='number'?cd.value:0}</v></c>`
  return `<c r="${ref}" s="${s}"><v>${cd.value}</v></c>`
}

function buildOHRow(rowNum: number, isH: boolean, cells: Record<string, CellDef>): string {
  const rowS = isH ? 146 : 148
  const parts = OH_COLS.map(col => buildOHCell(col, rowNum, isH, cells[col] ?? { type:'', value:null }))
  return `<row r="${rowNum}" spans="1:47" s="${rowS}" customFormat="1" ht="12.75" customHeight="1" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

function buildVarCell(col: string, row: number, cd: CellDef): string {
  const s = VAR_D_STYLES[col] ?? 222
  const ref = `${col}${row}`
  if (cd.type === '' || cd.value === null || cd.value === undefined)
    return `<c r="${ref}" s="${s}"/>`
  if (cd.type === 's') return `<c r="${ref}" s="${s}" t="s"><v>${cd.value}</v></c>`
  return `<c r="${ref}" s="${s}"><v>${cd.value}</v></c>`
}

function buildVarRow(rowNum: number, cells: Record<string, CellDef>): string {
  const parts = VAR_COLS.map(col => buildVarCell(col, rowNum, cells[col] ?? { type:'', value:null }))
  return `<row r="${rowNum}" spans="1:39" ht="15.75" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

export async function exportTceOverheadsVariations(
  projectId: string,
  projectName: string,
  lines: NrgTceLine[],
  orderedWeeks: string[],
) {
  // ── Fetch ─────────────────────────────────────────────────────────────────
  const [clRes, varRes, nrgInvRes, templateResp] = await Promise.all([
    supabase.from('timesheet_cost_lines')
      .select('tce_item_id,week_ending,allocated_hours,sell_labour,sell_labour_eur,sell_allowances')
      .eq('project_id', projectId).eq('timesheet_status', 'approved'),
    supabase.from('variations')
      .select('id,ref,description,tce_link,sell_total,status,approved_date,estimated_hours,tce_rate')
      .eq('project_id', projectId),
    supabase.from('nrg_customer_invoices').select('week_ending,eur_spot_rate')
      .eq('project_id', projectId).order('week_ending'),
    fetch('/tce_full_template.xlsx'),
  ])

  const costLines = (clRes.data || []) as CostRow[]
  const variations = (varRes.data || []) as {
    id:string; ref:string; description:string; tce_link:string|null;
    sell_total:number; status:string; approved_date:string|null;
    estimated_hours:number; tce_rate:number
  }[]
  const nrgInvSorted = ((nrgInvRes.data || []) as {week_ending:string|null;eur_spot_rate:number|null}[])
    .filter(i => i.week_ending).sort((a,b) => a.week_ending!.localeCompare(b.week_ending!))
  const templateBuf = await templateResp.arrayBuffer()

  // ── Spot rate ─────────────────────────────────────────────────────────────
  const spotRateByWE: Record<string, number|null> = {}
  for (const i of nrgInvSorted) {
    const r = i.eur_spot_rate
    spotRateByWE[i.week_ending!] = r != null && !isNaN(Number(r)) ? Number(r) : null
  }
  function spotRate(we: string): number|null { return spotRateByWE[we] ?? null }

  // ── Week slots ────────────────────────────────────────────────────────────
  const weekEndings = orderedWeeks.slice(0, 11)  // Overheads: 11 weeks max
  const varWeekEndings = orderedWeeks.slice(0, 12) // Variations: 12 weeks max
  const weSet = new Set(weekEndings)

  // ── Aggregate cost lines by item × week ───────────────────────────────────
  const byItemWeek: Record<string, Record<string, {hours:number; sell:number}>> = {}
  for (const r of costLines) {
    if (!r.tce_item_id || !weSet.has(r.week_ending)) continue
    const b = byItemWeek[r.tce_item_id] ??= {}
    const w = b[r.week_ending] ??= { hours:0, sell:0 }
    w.hours += r.allocated_hours || 0
    const eur = r.sell_labour_eur || 0
    w.sell += eur > 0
      ? (spotRate(r.week_ending) ?? 1) * eur + (r.sell_allowances || 0)
      : (r.sell_labour || 0) + (r.sell_allowances || 0)
  }

  // ── Load template ZIP ─────────────────────────────────────────────────────
  const zip = await JSZip.loadAsync(templateBuf)
  const sheet2Xml = await zip.file('xl/worksheets/sheet2.xml')!.async('string')
  const sheet4Xml = await zip.file('xl/worksheets/sheet4.xml')!.async('string')
  const ssXml     = await zip.file('xl/sharedStrings.xml')!.async('string')

  const existingSiCount = (ssXml.match(/<si>/g) || []).length
  const newSi: string[] = []
  const strCache: Record<string,number> = {}
  function strIdx(s: string): number {
    if (s in strCache) return strCache[s]
    const idx = existingSiCount + newSi.length
    const space = s !== s.trim() ? ' xml:space="preserve"' : ''
    newSi.push(`<si><t${space}>${xmlEsc(s)}</t></si>`)
    strCache[s] = idx
    return idx
  }

  // ── Build Overheads rows ──────────────────────────────────────────────────
  const overheadLines = lines.filter(l => l.source === 'overhead')
  const isOHHeader = (l: NrgTceLine) =>
    l.line_type === 'H' || l.line_type === 'group' || /^\d+\.\d+\.\d+$/.test(l.item_id || '')

  interface OHGroup { hdr: NrgTceLine; dets: NrgTceLine[] }
  const ohGroups: OHGroup[] = []
  let ohCur: OHGroup | null = null
  for (const l of overheadLines) {
    if (isOHHeader(l)) { if (ohCur) ohGroups.push(ohCur); ohCur = { hdr:l, dets:[] } }
    else if (ohCur) ohCur.dets.push(l)
  }
  if (ohCur) ohGroups.push(ohCur)

  const ohRows: string[] = []
  let ohRowNum = 3
  for (const { hdr, dets } of ohGroups) {
    const hRow = ohRowNum++
    const detRows = dets.map(() => ohRowNum++)

    // H-row
    const hc: Record<string,CellDef> = {
      A: { type:'s', value: strIdx(hdr.work_order || '') },
      B: { type:'s', value: strIdx(hdr.contract_scope || '') },
      C: { type:'s', value: strIdx(hdr.item_id || '') },
      D: { type:'s', value: strIdx(hdr.description || '') },
      E: { type:'s', value: strIdx(hdr.kpi_included ? 'Yes' : 'No') },
      F: { type:'', value:null },
    }
    if (detRows.length > 0) {
      const jRange = detRows.length === 1 ? `J${detRows[0]}` : `J${detRows[0]}:J${detRows[detRows.length-1]}`
      hc['J'] = { type:'f', value:0, formula:`SUM(${jRange})` }
    } else {
      hc['J'] = { type:'n', value: hdr.tce_total || 0 }
    }
    for (const c of ['G','H','I','K','L','M','N','O','P','AM','AN','AO','AP','AQ','AR','AS','AT','AU'])
      hc[c] = { type:'', value:null }
    for (const [wh,wc] of OH_WEEK_PAIRS) { hc[wh] = { type:'', value:null }; hc[wc] = { type:'', value:null } }
    ohRows.push(buildOHRow(hRow, true, hc))

    // Detail rows
    for (let i = 0; i < dets.length; i++) {
      const d = dets[i]; const dr = detRows[i]
      const dc: Record<string,CellDef> = {
        A: { type:'s', value: strIdx(d.work_order || '') },
        B: { type:'s', value: strIdx(d.contract_scope || '') },
        C: { type:'s', value: strIdx(d.item_id || '') },
        D: { type:'s', value: strIdx(d.description || '') },
        E: { type:'s', value: strIdx(d.kpi_included ? 'Yes' : 'No') },
        F: { type:'', value:null },
        G: { type: d.estimated_qty ? 'n' : '', value: d.estimated_qty || null },
        H: { type:'s', value: strIdx(d.unit_type || '') },
        I: { type: d.tce_rate ? 'n' : '', value: d.tce_rate || null },
        J: { type: d.tce_total ? 'n' : '', value: d.tce_total || null },
        K: { type:'', value:null },
        L: { type:'', value:null }, M: { type:'', value:null },
        N: { type:'', value:null }, O: { type:'', value:null }, P: { type:'', value:null },
      }
      let totHrs = 0, totSell = 0
      if (d.item_id) {
        const wd = byItemWeek[d.item_id] || {}
        for (let wi = 0; wi < OH_WEEK_PAIRS.length; wi++) {
          const [wh,wc] = OH_WEEK_PAIRS[wi]
          const we = weekEndings[wi]
          const data = we ? (wd[we] || { hours:0, sell:0 }) : { hours:0, sell:0 }
          dc[wh] = { type: data.hours ? 'n' : '', value: data.hours || null }
          dc[wc] = { type: data.sell  ? 'n' : '', value: data.sell  || null }
          totHrs += data.hours || 0; totSell += data.sell || 0
        }
      } else {
        for (const [wh,wc] of OH_WEEK_PAIRS) { dc[wh] = { type:'', value:null }; dc[wc] = { type:'', value:null } }
      }
      dc['AM'] = { type:'', value:null }; dc['AN'] = { type:'', value:null }
      dc['AO'] = { type: totHrs  ? 'n' : '', value: totHrs  || null }
      dc['AP'] = { type: totSell ? 'n' : '', value: totSell || null }
      dc['AQ'] = totHrs > 0 ? { type:'n', value: totSell/totHrs } : { type:'', value:null }
      dc['AR'] = (d.estimated_qty||0) > 0 ? { type:'n', value: totHrs/d.estimated_qty } : { type:'', value:null }
      dc['AS'] = (d.tce_total||0) > 0    ? { type:'n', value: totSell/d.tce_total }     : { type:'', value:null }
      dc['AT'] = { type:'', value:null }; dc['AU'] = { type:'', value:null }
      ohRows.push(buildOHRow(dr, false, dc))
    }
  }

  // ── Build Variations rows ─────────────────────────────────────────────────
  // Aggregate variation actuals from cost lines tagged to each variation's tce_link
  // Plus variation's own sell_total for the total
  const varRows: string[] = []
  let varRowNum = 2  // data starts at row 2 in Variations sheet
  for (const v of variations) {
    const dc: Record<string,CellDef> = {
      A: { type:'s', value: strIdx('') },         // Service Order — not on variation record
      B: { type:'s', value: strIdx('') },         // Work Order
      C: { type:'s', value: strIdx(v.description || '') },
      D: { type: v.estimated_hours ? 'n' : '', value: v.estimated_hours || null },
      E: { type: v.tce_rate       ? 'n' : '', value: v.tce_rate        || null },
      F: { type: v.sell_total     ? 'n' : '', value: v.sell_total      || null },
      G: { type:'s', value: strIdx(v.status || '') },
      H: { type:'s', value: strIdx(v.ref || '') },
      I: { type:'', value:null },
    }
    // Week actuals — from cost lines tagged to this variation's tce_link
    let totHrs = 0, totSell = 0
    const wd = v.tce_link ? (byItemWeek[v.tce_link] || {}) : {}
    for (let wi = 0; wi < VAR_WEEK_PAIRS.length; wi++) {
      const [wh,wc] = VAR_WEEK_PAIRS[wi]
      const we = varWeekEndings[wi]
      const data = we ? (wd[we] || { hours:0, sell:0 }) : { hours:0, sell:0 }
      dc[wh] = { type: data.hours ? 'n' : '', value: data.hours || null }
      dc[wc] = { type: data.sell  ? 'n' : '', value: data.sell  || null }
      totHrs += data.hours || 0; totSell += data.sell || 0
    }
    dc['AH'] = { type: totHrs  ? 'n' : '', value: totHrs  || null }
    dc['AI'] = { type: totSell ? 'n' : '', value: totSell || null }
    dc['AJ'] = (v.estimated_hours||0) > 0 ? { type:'n', value: totHrs/(v.estimated_hours) } : { type:'', value:null }
    dc['AK'] = (v.sell_total||0) > 0      ? { type:'n', value: totSell/(v.sell_total) }      : { type:'', value:null }
    dc['AL'] = { type:'', value:null }; dc['AM'] = { type:'', value:null }
    varRows.push(buildVarRow(varRowNum++, dc))
  }

  // ── Splice Overheads sheet (sheet2) ───────────────────────────────────────
  const oh1 = sheet2Xml.match(/<row r="1"[^>]*>.*?<\/row>/s)?.[0] || ''
  const oh2 = sheet2Xml.match(/<row r="2"[^>]*>.*?<\/row>/s)?.[0] || ''
  const updatedSheet2 = sheet2Xml
    .replace(/<sheetData>.*?<\/sheetData>/s,
      `<sheetData>${oh1}${oh2}${ohRows.join('')}</sheetData>`)
    .replace(/ref="A1:BC\d+"/, `ref="A1:BC${ohRowNum-1}"`)

  // ── Splice Variations sheet (sheet4) ─────────────────────────────────────
  const var1 = sheet4Xml.match(/<row r="1"[^>]*>.*?<\/row>/s)?.[0] || ''
  const updatedSheet4 = sheet4Xml
    .replace(/<sheetData>.*?<\/sheetData>/s,
      `<sheetData>${var1}${varRows.join('')}</sheetData>`)
    .replace(/ref="A1:AM\d+"/, `ref="A1:AM${Math.max(varRowNum-1, 1)}"`)

  // ── Update sharedStrings ──────────────────────────────────────────────────
  const total = existingSiCount + newSi.length
  const updatedSs = ssXml
    .replace(/count="\d+"/, `count="${total}"`)
    .replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)
    .replace(/<\/sst>/, newSi.join('') + '</sst>')

  zip.file('xl/worksheets/sheet2.xml', updatedSheet2)
  zip.file('xl/worksheets/sheet4.xml', updatedSheet4)
  zip.file('xl/sharedStrings.xml', updatedSs)
  zip.remove('xl/calcChain.xml')

  // ── Download ──────────────────────────────────────────────────────────────
  const outBuf = await zip.generateAsync({ type:'arraybuffer', compression:'DEFLATE' })
  const blob = new Blob([outBuf], {
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `TCE_Overheads_Variations_${projectName.replace(/[^a-zA-Z0-9_-]/g,'_')}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}
