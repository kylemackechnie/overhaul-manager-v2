/**
 * exportTce.ts
 *
 * Fills the full NRG TCE template (public/tce_full_template.xlsx) with OMV2
 * data across three sheets simultaneously:
 *   sheet3 = "Skilled Labour"   (rId3)
 *   sheet2 = "Overheads"        (rId2)
 *   sheet4 = "Variations"       (rId4)
 *
 * Uses JSZip direct XML injection to preserve all template styles exactly.
 * All three sheets keep their original rows 1–2 (headers) verbatim and have
 * their data rows rebuilt from OMV2 data.
 *
 * ── Skilled Labour (sheet3) style indices ──────────────────────────────────
 * H-row s=304, detail row s=457
 *   Col  H    Det  |  Col  H    Det  |  Col  H    Det
 *   A    294  445  |  J    296  448  |  S    449  449
 *   B    444  446  |  K    296  448  |  T    450  450
 *   C    444  446  |  L    297  297  |  U–V  week pairs…
 *   D    444  446  |  M    296  448  |  AO   300  451
 *   E    294  445  |  N    298  449  |  AP   298  452
 *   F    294  445  |  O    299  450  |  AQ   300  451
 *   G    295  447  |  P    298  449  |  AR   298  452
 *   H    295  448  |  Q    380  380  |  AS   298  452
 *   I    296  448  |  R    296  448  |  AT   298  452
 *                                    |  AU   301  453
 *                                    |  AV   298  452
 *                                    |  AW   298  452
 *                                    |  AX   302  454
 *                                    |  AY   303  455
 *                                    |  AZ   303  455
 *                                    |  BA   237  456
 *
 * ── Overheads (sheet2) style indices ───────────────────────────────────────
 * H-row s=146, detail row s=148
 *   A:142/23  B:142/23  C:142/147  D:143/406  E:144/148  F:135/149
 *   G:43/397  H:43/24   I:43/25    J:43/26    K:141/150
 *   L:43/27   M:43/28   N:43/26    O:43/26    P:141/150
 *   Q:43/151  R:43/44   S:43/151…  (week pairs repeat)
 *   AO:43/45  AP:43/44  AQ:43/44   AR:43/46   AS:43/46
 *   AT:145/152  AU:145/153
 *
 * ── Variations (sheet4) style indices ──────────────────────────────────────
 * Data rows start at row 2 (row 1 = header), s not set at row level
 *   Row2 per-col: A:230 B:230 C:229 D:228 E:227 F:226 G:226 H:226 I:51
 *   J:273 K:226 L:273 M:226 … (alternating 273/226 for week pairs)
 *   AH:274 AI:222 AJ:221 AK:221 AL:222 AM:222
 *   Row3+ data: A:225 B:225 C:224 D:223 E:222 F:222 G:222 H:222 I:272
 *   J:238 K:222 L:238 M:222 … AH:274 AI:222 AJ:221 AK:221 AL:222 AM:222
 */

import JSZip from 'jszip'
import { supabase } from './supabase'
import type { NrgTceLine } from '../types'

// ── Skilled Labour styles (from sheet3 in full template) ──────────────────
const SL_H: Record<string, number> = {
  A:294,B:444,C:444,D:444,E:294,F:294,G:295,H:295,I:296,J:296,K:296,
  L:297,M:296,N:298,O:299,P:298,Q:380,R:296,S:298,T:299,U:298,V:239,
  W:300,X:298,Y:300,Z:298,AA:300,AB:298,AC:300,AD:298,AE:300,AF:298,
  AG:300,AH:298,AI:300,AJ:298,AK:300,AL:298,AM:300,AN:298,AO:300,AP:298,
  AQ:300,AR:298,AS:298,AT:298,AU:301,AV:298,AW:298,AX:302,AY:303,AZ:303,BA:237,
}
const SL_D: Record<string, number> = {
  A:445,B:446,C:446,D:446,E:445,F:445,G:447,H:448,I:448,J:448,K:448,
  L:297,M:448,N:449,O:450,P:449,Q:380,R:448,S:449,T:450,U:449,V:239,
  W:451,X:452,Y:451,Z:452,AA:451,AB:452,AC:451,AD:452,AE:451,AF:452,
  AG:451,AH:452,AI:451,AJ:452,AK:451,AL:452,AM:451,AN:452,AO:451,AP:452,
  AQ:451,AR:452,AS:452,AT:452,AU:453,AV:452,AW:452,AX:454,AY:455,AZ:455,BA:456,
}
const SL_COLS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R',
  'S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH',
  'AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU','AV','AW',
  'AX','AY','AZ','BA',
]
// Week pairs S/T … AM/AN (11 weeks) — same columns as standalone template
const SL_WEEK_PAIRS: [string, string][] = [
  ['S','T'],['U','V'],['W','X'],['Y','Z'],['AA','AB'],['AC','AD'],
  ['AE','AF'],['AG','AH'],['AI','AJ'],['AK','AL'],['AM','AN'],
]

// ── Overheads styles (from sheet2 in full template) ───────────────────────
const OH_H: Record<string, number> = {
  A:142,B:142,C:142,D:143,E:144,F:135,
  G:43,H:43,I:43,J:43,K:141,L:43,M:43,N:43,O:43,P:141,
  Q:43,R:43,S:43,T:43,U:43,V:43,W:43,X:43,Y:43,Z:43,
  AA:43,AB:43,AC:43,AD:43,AE:43,AF:43,AG:43,AH:43,AI:43,AJ:43,
  AK:43,AL:43,AM:43,AN:43,AO:43,AP:43,AQ:43,AR:43,AS:43,AT:145,AU:145,
}
const OH_D: Record<string, number> = {
  A:23,B:23,C:147,D:406,E:148,F:149,
  G:397,H:24,I:25,J:26,K:150,L:27,M:28,N:26,O:26,P:150,
  Q:151,R:44,S:151,T:44,U:151,V:44,W:151,X:44,Y:151,Z:44,
  AA:151,AB:44,AC:151,AD:44,AE:151,AF:44,AG:151,AH:44,AI:151,AJ:44,
  AK:151,AL:44,AM:45,AN:44,AO:44,AP:46,AQ:46,AR:152,AS:153,AT:149,AU:149,
}
const OH_COLS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P',
  'Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF',
  'AG','AH','AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU',
]
const OH_WEEK_PAIRS: [string, string][] = [
  ['Q','R'],['S','T'],['U','V'],['W','X'],['Y','Z'],['AA','AB'],
  ['AC','AD'],['AE','AF'],['AG','AH'],['AI','AJ'],['AK','AL'],
]

// ── Variations styles (from sheet4 in full template) ─────────────────────
const VAR_D: Record<string, number> = {
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
// Week pairs J/K … AF/AG (12 weeks)
const VAR_WEEK_PAIRS: [string, string][] = [
  ['J','K'],['L','M'],['N','O'],['P','Q'],['R','S'],['T','U'],
  ['V','W'],['X','Y'],['Z','AA'],['AB','AC'],['AD','AE'],['AF','AG'],
]

// ── Shared types ──────────────────────────────────────────────────────────
type CellType = 's' | 'n' | 'f' | ''
interface CellDef { type: CellType; value: string | number | null; formula?: string }

interface CostRow {
  tce_item_id: string | null; week_ending: string
  allocated_hours: number; sell_labour: number
  sell_labour_eur: number; sell_allowances: number
}

// ── XML helpers ───────────────────────────────────────────────────────────
function xmlEsc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}

function makeCell(col: string, row: number, s: number, cd: CellDef): string {
  const ref = `${col}${row}`
  if (cd.type === '' || cd.value === null || cd.value === undefined)
    return `<c r="${ref}" s="${s}"/>`
  if (cd.type === 's') return `<c r="${ref}" s="${s}" t="s"><v>${cd.value}</v></c>`
  if (cd.type === 'f' && cd.formula)
    return `<c r="${ref}" s="${s}"><f>${xmlEsc(cd.formula)}</f><v>${typeof cd.value==='number'?cd.value:0}</v></c>`
  return `<c r="${ref}" s="${s}"><v>${cd.value}</v></c>`
}

function buildSLRow(rowNum: number, isH: boolean, cells: Record<string, CellDef>): string {
  const rowS = isH ? 304 : 457
  const parts = SL_COLS.map(col => makeCell(col, rowNum, isH ? SL_H[col] : SL_D[col], cells[col] ?? { type:'', value:null }))
  return `<row r="${rowNum}" spans="1:53" s="${rowS}" customFormat="1" ht="15.75" customHeight="1" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

function buildOHRow(rowNum: number, isH: boolean, cells: Record<string, CellDef>): string {
  const rowS = isH ? 146 : 148
  const parts = OH_COLS.map(col => makeCell(col, rowNum, isH ? OH_H[col] : OH_D[col], cells[col] ?? { type:'', value:null }))
  return `<row r="${rowNum}" spans="1:47" s="${rowS}" customFormat="1" ht="12.75" customHeight="1" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

function buildVarRow(rowNum: number, cells: Record<string, CellDef>): string {
  const parts = VAR_COLS.map(col => makeCell(col, rowNum, VAR_D[col] ?? 222, cells[col] ?? { type:'', value:null }))
  return `<row r="${rowNum}" spans="1:39" ht="15.75" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

// ── Main export ───────────────────────────────────────────────────────────
export async function exportTceAll(
  projectId: string,
  projectName: string,
  lines: NrgTceLine[],
  orderedWeeks: string[], // week_ending dates user selected, Week1=[0] etc.
) {
  // 1. Fetch all data in parallel
  const [clRes, varRes, nrgInvRes, templateResp] = await Promise.all([
    supabase.from('timesheet_cost_lines')
      .select('tce_item_id,week_ending,allocated_hours,sell_labour,sell_labour_eur,sell_allowances')
      .eq('project_id', projectId).eq('timesheet_status', 'approved'),
    supabase.from('variations')
      .select('id,ref,description,tce_link,sell_total,status,estimated_hours,tce_rate')
      .eq('project_id', projectId),
    supabase.from('nrg_customer_invoices').select('week_ending,eur_spot_rate')
      .eq('project_id', projectId).order('week_ending'),
    fetch('/tce_full_template.xlsx'),
  ])

  const costLines = (clRes.data || []) as CostRow[]
  const variations = (varRes.data || []) as {
    id:string; ref:string; description:string; tce_link:string|null;
    sell_total:number; status:string; estimated_hours:number; tce_rate:number
  }[]
  const nrgInvSorted = ((nrgInvRes.data || []) as {week_ending:string|null;eur_spot_rate:number|null}[])
    .filter(i => i.week_ending).sort((a,b) => a.week_ending!.localeCompare(b.week_ending!))
  const templateBuf = await templateResp.arrayBuffer()

  // 2. Spot rate lookup (exact match by week_ending)
  const spotRateByWE: Record<string, number|null> = {}
  for (const i of nrgInvSorted) {
    const r = i.eur_spot_rate
    spotRateByWE[i.week_ending!] = r != null && !isNaN(Number(r)) ? Number(r) : null
  }
  function spotRate(we: string): number|null { return spotRateByWE[we] ?? null }

  // 3. Week slots (user-ordered, capped per sheet)
  const slWeeks = orderedWeeks.slice(0, 11)  // Skilled Labour: 11
  const ohWeeks = orderedWeeks.slice(0, 11)  // Overheads: 11
  const varWeeks = orderedWeeks.slice(0, 12) // Variations: 12
  const weSet = new Set(orderedWeeks)

  // 4. Aggregate cost lines by item × week
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

  // 5. Load template
  const zip = await JSZip.loadAsync(templateBuf)
  const sl3Xml = await zip.file('xl/worksheets/sheet3.xml')!.async('string')
  const oh2Xml = await zip.file('xl/worksheets/sheet2.xml')!.async('string')
  const var4Xml = await zip.file('xl/worksheets/sheet4.xml')!.async('string')
  const ssXml   = await zip.file('xl/sharedStrings.xml')!.async('string')

  // 6. Shared strings
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

  // ── Helper: group lines ──────────────────────────────────────────────────
  const isGroupHdr = (l: NrgTceLine) =>
    l.line_type === 'H' || l.line_type === 'group' || /^\d+\.\d+\.\d+$/.test(l.item_id || '')

  interface Group { hdr: NrgTceLine; dets: NrgTceLine[] }
  function groupLines(src: NrgTceLine[]): Group[] {
    const groups: Group[] = []; let cur: Group | null = null
    for (const l of src) {
      if (isGroupHdr(l)) { if (cur) groups.push(cur); cur = { hdr:l, dets:[] } }
      else if (cur) cur.dets.push(l)
    }
    if (cur) groups.push(cur)
    return groups
  }

  // ── Helper: week actuals for one item ────────────────────────────────────
  function weekCells(
    itemId: string | null,
    weekPairs: [string,string][],
    weeks: string[],
    cells: Record<string,CellDef>,
  ): { totHrs: number; totSell: number } {
    let totHrs = 0, totSell = 0
    const wd = itemId ? (byItemWeek[itemId] || {}) : {}
    for (let wi = 0; wi < weekPairs.length; wi++) {
      const [wh, wc] = weekPairs[wi]
      const we = weeks[wi]
      const data = we ? (wd[we] || { hours:0, sell:0 }) : { hours:0, sell:0 }
      cells[wh] = { type: data.hours ? 'n' : '', value: data.hours || null }
      cells[wc] = { type: data.sell  ? 'n' : '', value: data.sell  || null }
      totHrs += data.hours || 0; totSell += data.sell || 0
    }
    return { totHrs, totSell }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 7A. Build Skilled Labour rows
  // ────────────────────────────────────────────────────────────────────────
  const slRows: string[] = []
  let slRowNum = 3
  const varByItem: Record<string,number> = {}
  for (const v of variations) {
    if (v.tce_link) varByItem[v.tce_link] = (varByItem[v.tce_link]||0) + (v.sell_total||0)
  }

  for (const { hdr, dets } of groupLines(lines.filter(l => l.source === 'skilled'))) {
    const hRow = slRowNum++
    const detRows = dets.map(() => slRowNum++)

    const hc: Record<string,CellDef> = {
      A: { type:'s', value: strIdx(hdr.contract_scope || '') },
      B: { type:'s', value: strIdx('') },
      C: { type:'s', value: strIdx('') },
      D: { type:'s', value: strIdx('') },
      E: { type:'s', value: strIdx('') },
      F: { type:'s', value: strIdx('') },
      G: { type:'s', value: strIdx(hdr.item_id || '') },
      H: { type:'s', value: strIdx(hdr.description || '') },
      I: { type:'s', value: strIdx(hdr.line_type === 'group' ? 'H' : hdr.line_type || '') },
      J: { type:'s', value: strIdx((hdr.details as Record<string,unknown>)?.task_responsibility as string || '') },
      K: { type:'s', value: strIdx(hdr.notes || '') },
    }
    if (detRows.length > 0) {
      const r0 = detRows[0], r1 = detRows[detRows.length-1]
      hc['N'] = { type:'f', value:0, formula: r0===r1 ? `N${r0}` : `SUM(N${r0}:N${r1})` }
      hc['P'] = { type:'f', value:0, formula: r0===r1 ? `P${r0}` : `SUM(P${r0}:P${r1})` }
    } else {
      hc['N'] = { type:'n', value: hdr.estimated_qty || 0 }
      hc['P'] = { type:'n', value: hdr.tce_total || 0 }
    }
    hc['O'] = { type:'n', value: hdr.tce_rate || 0 }
    for (const c of ['L','M','Q','R']) hc[c] = { type:'', value:null }
    for (const [wh,wc] of SL_WEEK_PAIRS) { hc[wh]={ type:'', value:null }; hc[wc]={ type:'', value:null } }
    for (const c of ['AO','AP','AQ','AR','AS','AT','AU','AV','AW','AX','AY','AZ','BA'])
      hc[c] = { type:'', value:null }
    slRows.push(buildSLRow(hRow, true, hc))

    for (let i = 0; i < dets.length; i++) {
      const d = dets[i]; const dr = detRows[i]
      const dc: Record<string,CellDef> = {
        A: { type:'s', value: strIdx(d.contract_scope || '') },
        B: { type:'s', value: strIdx(d.work_order || '') },
        C: { type:'s', value: strIdx('') },
        D: { type:'s', value: strIdx('') },
        E: { type:'s', value: strIdx('') },
        F: { type:'s', value: strIdx('') },
        G: { type:'s', value: strIdx(d.item_id || '') },
        H: { type:'s', value: strIdx(d.description || '') },
        I: { type:'s', value: strIdx(d.line_type || '') },
        J: { type:'s', value: strIdx((d.details as Record<string,unknown>)?.task_responsibility as string || '') },
        K: { type:'s', value: strIdx(d.notes || '') },
        L: { type:'', value:null }, M: { type:'', value:null },
        N: { type: d.estimated_qty ? 'n' : '', value: d.estimated_qty || null },
        O: { type: d.tce_rate    ? 'n' : '', value: d.tce_rate    || null },
        P: { type: d.tce_total   ? 'n' : '', value: d.tce_total   || null },
        Q: { type:'', value:null }, R: { type:'', value:null },
      }
      const { totHrs, totSell } = weekCells(d.item_id, SL_WEEK_PAIRS, slWeeks, dc)
      const varAmt = d.item_id ? (varByItem[d.item_id]||0) : 0
      dc['AO'] = { type:'', value:null }
      dc['AP'] = { type: varAmt ? 'n' : '', value: varAmt || null }
      const fHrs = totHrs, fCost = totSell + varAmt
      dc['AQ'] = { type: fHrs  ? 'n' : '', value: fHrs  || null }
      dc['AR'] = { type: fCost ? 'n' : '', value: fCost || null }
      dc['AS'] = fHrs > 0 ? { type:'n', value: fCost/fHrs } : { type:'', value:null }
      dc['AT'] = (d.estimated_qty||0) > 0 ? { type:'n', value: fHrs/d.estimated_qty } : { type:'', value:null }
      dc['AU'] = (d.tce_total||0) > 0 ? { type:'n', value: fCost/d.tce_total } : { type:'', value:null }
      for (const c of ['AV','AW','AX','AY','AZ','BA']) dc[c] = { type:'', value:null }
      slRows.push(buildSLRow(dr, false, dc))
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 7B. Build Overheads rows
  // ────────────────────────────────────────────────────────────────────────
  const ohRows: string[] = []
  let ohRowNum = 3

  for (const { hdr, dets } of groupLines(lines.filter(l => l.source === 'overhead'))) {
    const hRow = ohRowNum++
    const detRows = dets.map(() => ohRowNum++)

    const hc: Record<string,CellDef> = {
      A: { type:'s', value: strIdx(hdr.work_order || '') },
      B: { type:'s', value: strIdx(hdr.contract_scope || '') },
      C: { type:'s', value: strIdx(hdr.item_id || '') },
      D: { type:'s', value: strIdx(hdr.description || '') },
      E: { type:'s', value: strIdx(hdr.kpi_included ? 'Yes' : 'No') },
      F: { type:'', value:null },
    }
    if (detRows.length > 0) {
      const r0 = detRows[0], r1 = detRows[detRows.length-1]
      hc['J'] = { type:'f', value:0, formula: r0===r1 ? `J${r0}` : `SUM(J${r0}:J${r1})` }
    } else {
      hc['J'] = { type:'n', value: hdr.tce_total || 0 }
    }
    for (const c of ['G','H','I','K','L','M','N','O','P','AM','AN','AO','AP','AQ','AR','AS','AT','AU'])
      hc[c] = { type:'', value:null }
    for (const [wh,wc] of OH_WEEK_PAIRS) { hc[wh]={ type:'', value:null }; hc[wc]={ type:'', value:null } }
    ohRows.push(buildOHRow(hRow, true, hc))

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
        I: { type: d.tce_rate  ? 'n' : '', value: d.tce_rate  || null },
        J: { type: d.tce_total ? 'n' : '', value: d.tce_total || null },
        K: { type:'', value:null },
        L: { type:'', value:null }, M: { type:'', value:null },
        N: { type:'', value:null }, O: { type:'', value:null }, P: { type:'', value:null },
      }
      const { totHrs, totSell } = weekCells(d.item_id, OH_WEEK_PAIRS, ohWeeks, dc)
      dc['AM'] = { type:'', value:null }; dc['AN'] = { type:'', value:null }
      dc['AO'] = { type: totHrs  ? 'n' : '', value: totHrs  || null }
      dc['AP'] = { type: totSell ? 'n' : '', value: totSell || null }
      dc['AQ'] = totHrs > 0 ? { type:'n', value: totSell/totHrs } : { type:'', value:null }
      dc['AR'] = (d.estimated_qty||0) > 0 ? { type:'n', value: totHrs/d.estimated_qty } : { type:'', value:null }
      dc['AS'] = (d.tce_total||0) > 0 ? { type:'n', value: totSell/d.tce_total } : { type:'', value:null }
      dc['AT'] = { type:'', value:null }; dc['AU'] = { type:'', value:null }
      ohRows.push(buildOHRow(dr, false, dc))
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 7C. Build Variations rows
  // ────────────────────────────────────────────────────────────────────────
  const varRows: string[] = []
  let varRowNum = 2  // Variations data starts at row 2
  for (const v of variations) {
    const dc: Record<string,CellDef> = {
      A: { type:'s', value: strIdx('') },
      B: { type:'s', value: strIdx('') },
      C: { type:'s', value: strIdx(v.description || '') },
      D: { type: v.estimated_hours ? 'n' : '', value: v.estimated_hours || null },
      E: { type: v.tce_rate    ? 'n' : '', value: v.tce_rate    || null },
      F: { type: v.sell_total  ? 'n' : '', value: v.sell_total  || null },
      G: { type:'s', value: strIdx(v.status || '') },
      H: { type:'s', value: strIdx(v.ref || '') },
      I: { type:'', value:null },
    }
    const { totHrs, totSell } = weekCells(v.tce_link, VAR_WEEK_PAIRS, varWeeks, dc)
    dc['AH'] = { type: totHrs  ? 'n' : '', value: totHrs  || null }
    dc['AI'] = { type: totSell ? 'n' : '', value: totSell || null }
    dc['AJ'] = (v.estimated_hours||0) > 0 ? { type:'n', value: totHrs/v.estimated_hours } : { type:'', value:null }
    dc['AK'] = (v.sell_total||0) > 0 ? { type:'n', value: totSell/v.sell_total } : { type:'', value:null }
    dc['AL'] = { type:'', value:null }; dc['AM'] = { type:'', value:null }
    varRows.push(buildVarRow(varRowNum++, dc))
  }

  // ────────────────────────────────────────────────────────────────────────
  // 8. Splice all three sheets
  // ────────────────────────────────────────────────────────────────────────
  function spliceSheet(xml: string, headerRows: number, dataRows: string[], lastRow: string, dimPattern: RegExp): string {
    const hdrs = Array.from({ length: headerRows }, (_, i) =>
      xml.match(new RegExp(`<row r="${i+1}"[^>]*>.*?</row>`, 's'))?.[0] || ''
    ).join('')
    return xml
      .replace(/<sheetData>.*?<\/sheetData>/s, `<sheetData>${hdrs}${dataRows.join('')}</sheetData>`)
      .replace(dimPattern, `ref="A1:${lastRow}"`)
  }

  const updatedSL  = spliceSheet(sl3Xml, 2, slRows,  `BA${slRowNum-1}`,  /ref="A1:BA\d+"/)
  const updatedOH  = spliceSheet(oh2Xml, 2, ohRows,  `AU${ohRowNum-1}`,  /ref="A1:BC\d+"/)
  const updatedVar = spliceSheet(var4Xml, 1, varRows, `AM${varRowNum-1}`, /ref="A1:AM\d+"/)

  // 9. Update sharedStrings
  const total = existingSiCount + newSi.length
  const updatedSs = ssXml
    .replace(/count="\d+"/, `count="${total}"`)
    .replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)
    .replace(/<\/sst>/, newSi.join('') + '</sst>')

  zip.file('xl/worksheets/sheet3.xml', updatedSL)
  zip.file('xl/worksheets/sheet2.xml', updatedOH)
  zip.file('xl/worksheets/sheet4.xml', updatedVar)
  zip.file('xl/sharedStrings.xml', updatedSs)
  zip.remove('xl/calcChain.xml')

  // 10. Download
  const outBuf = await zip.generateAsync({ type:'arraybuffer', compression:'DEFLATE' })
  const blob = new Blob([outBuf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `TCE_${projectName.replace(/[^a-zA-Z0-9_-]/g,'_')}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}
