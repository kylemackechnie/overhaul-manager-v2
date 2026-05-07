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

  // ── Week slots anchored to invoice week_endings (chronological order) ─────
  // Invoice 1 → Week 1 column, Invoice 2 → Week 2, etc. up to 11.
  // Cost lines whose week_ending doesn't exactly match an invoice week_ending
  // are ignored — weeks must always end on Sunday and align with invoices.
  const weekEndings = nrgInvSorted.map(i => i.week_ending!).slice(0, 11)

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
