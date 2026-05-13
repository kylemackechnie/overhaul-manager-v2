/**
 * exportTce.ts
 *
 * Produces ONE xlsx file using the full NRG template (tce_full_template.xlsx),
 * filling all three sheets simultaneously:
 *   sheet3 = Skilled Labour   (1 header row, data from row 2)
 *   sheet2 = Overheads        (2 header rows, data from row 3)
 *   sheet4 = Variations       (1 header row, data from row 2)
 *
 * Style indices extracted directly from the template rows.
 *
 * ── Skilled Labour sheet3 ─────────────────────────────────────────────────
 * Row s: H=304, detail=457   Cols A–BA (53 total)
 * A=Service Order, B=Work Order, C–F blank, G=Scope No, H=Description,
 * I=Scope Type, J=Task Resp, K=Comment, L=spacer,
 * M=Est Hours(TCE), N=Gang Rate, O=Est Total, P–V=Adj TCE + spacer,
 * W/X…AQ/AR=Week 1–11 pairs, AS=Total Hrs, AT=Total Cost, AU=Gang Rate,
 * AV=%Hrs, AW=%Cost, AX–BA blank
 *
 * ── Overheads sheet2 ──────────────────────────────────────────────────────
 * Row s: H=146, detail=148   2 header rows, data from row 3
 * A=Work Order, B=Service Order, C=Item ID, D=Description, E=KPI, F=spacer,
 * G=Units, H=Unit Type, I=Rate, J=Total Cost (TCE)
 * Q/R…AK/AL=Week 1–11, AM=Var Hrs, AN=Var Amt,
 * AO=Total Hrs, AP=Total Cost, AQ=Gang Rate, AR=%Hrs, AS=%Cost
 *
 * ── Variations sheet4 ─────────────────────────────────────────────────────
 * 1 header row, data from row 2
 * A=Service Order, B=Work Order, C=Description, D=Est Hrs, E=Gang Rate,
 * F=Est Total, G=Status, H=Ref/Comment,
 * J/K…AF/AG=Week 1–12, AH=Total Hrs, AI=Total Cost, AJ=%Hrs, AK=%Cost
 */

import JSZip from 'jszip'
import { supabase } from './supabase'
import { addDays } from './dates'
import type { NrgTceLine } from '../types'

// ── Skilled Labour styles (full template sheet3) ───────────────────────────
const SL_H: Record<string, number> = {
  A:294,B:444,C:444,D:444,E:294,F:294,G:295,H:295,I:296,J:296,K:296,
  L:297,M:296,N:298,O:299,P:298,Q:380,R:296,
  S:298,T:299,U:298,V:239,W:300,X:298,Y:300,Z:298,
  AA:300,AB:298,AC:300,AD:298,AE:300,AF:298,AG:300,AH:298,AI:300,AJ:298,
  AK:300,AL:298,AM:300,AN:298,AO:300,AP:298,AQ:300,AR:298,AS:298,
  AT:298,AU:301,AV:298,AW:298,AX:302,AY:303,AZ:303,BA:237,
}
const SL_D: Record<string, number> = {
  A:445,B:446,C:446,D:446,E:445,F:445,G:447,H:448,I:448,J:448,K:448,
  L:297,M:448,N:449,O:450,P:449,Q:380,R:448,
  S:449,T:450,U:449,V:239,W:451,X:452,Y:451,Z:452,
  AA:451,AB:452,AC:451,AD:452,AE:451,AF:452,AG:451,AH:452,AI:451,AJ:452,
  AK:451,AL:452,AM:451,AN:452,AO:451,AP:452,AQ:451,AR:452,AS:452,
  AT:452,AU:453,AV:452,AW:452,AX:454,AY:455,AZ:455,BA:456,
}
const SL_COLS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R',
  'S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH',
  'AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU','AV','AW',
  'AX','AY','AZ','BA',
]
// Week pairs W/X … AQ/AR (11 weeks)
const SL_WEEK_PAIRS: [string,string][] = [
  ['W','X'],['Y','Z'],['AA','AB'],['AC','AD'],['AE','AF'],['AG','AH'],
  ['AI','AJ'],['AK','AL'],['AM','AN'],['AO','AP'],['AQ','AR'],
]
const SL_TOT_HRS='AS', SL_TOT_COST='AT', SL_GANG='AU', SL_PCT_HRS='AV', SL_PCT_COST='AW'

// Subheader row for SL sheet (injected as row 2; style 42 = full template OH header style)
// Maps column → label. Week cols generated dynamically.
const SL_SUBHEADER_STATIC: Record<string, string> = {
  A:'Service Order Number/Release', D:'Work Order and Work Order Task Combined',
  F:'Scope No.', G:'Unit 2 2026 Turbine Scope Development - Activity description',
  H:'Scope Type', I:'Task responsibility (Contractor/NRGGOS/Others)',
  K:'Comment', L:'',
  M:'Estimated Hours', N:'Gang rate $/hr', O:'Estimated Total Cost',
  P:'', Q:'Notes (TCE)', R:'Adjusted Estimated Hours', S:'Adj Gang rate $/hr',
  T:'Adjusted Estimated Total Cost (excl.GST)', U:'Adj Notes', V:'',
  AS:'Total - Actual Hours', AT:'Total - Actual Total Cost', AU:'Total - Actual Gang Rate',
  AV:'Percentage of Hours Complete', AW:'Percentage of Cost Used',
  AX:'Task Complete', AY:'Forecast Cost for Completion of Project',
}

// ── Overheads styles (full template sheet2) ───────────────────────────────
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
  Q:45,R:26,S:45,T:26,U:45,V:26,W:45,X:26,Y:45,Z:26,
  AA:45,AB:26,AC:45,AD:26,AE:45,AF:26,AG:45,AH:26,AI:45,AJ:26,
  AK:45,AL:26,AM:45,AN:26,AO:45,AP:26,AQ:26,AR:153,AS:153,AT:149,AU:149,
}
const OH_COLS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P',
  'Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF',
  'AG','AH','AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU',
]
const OH_WEEK_PAIRS: [string,string][] = [
  ['Q','R'],['S','T'],['U','V'],['W','X'],['Y','Z'],['AA','AB'],
  ['AC','AD'],['AE','AF'],['AG','AH'],['AI','AJ'],['AK','AL'],
]

// ── Variations styles (full template sheet4) ──────────────────────────────
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
const VAR_WEEK_PAIRS: [string,string][] = [
  ['J','K'],['L','M'],['N','O'],['P','Q'],['R','S'],['T','U'],
  ['V','W'],['X','Y'],['Z','AA'],['AB','AC'],['AD','AE'],['AF','AG'],
]

// ── Types ─────────────────────────────────────────────────────────────────
type CellType = 's'|'n'|'f'|''
interface CellDef { type: CellType; value: string|number|null; formula?: string }
interface CostRow {
  tce_item_id: string|null; week_ending: string
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
  if (cd.type===''||cd.value===null||cd.value===undefined) return `<c r="${ref}" s="${s}"/>`
  if (cd.type==='s') return `<c r="${ref}" s="${s}" t="s"><v>${cd.value}</v></c>`
  if (cd.type==='f'&&cd.formula)
    return `<c r="${ref}" s="${s}"><f>${xmlEsc(cd.formula)}</f><v>${typeof cd.value==='number'?cd.value:0}</v></c>`
  return `<c r="${ref}" s="${s}"><v>${cd.value}</v></c>`
}
function buildSLRow(rowNum: number, isH: boolean, cells: Record<string,CellDef>): string {
  const parts = SL_COLS.map(col => makeCell(col, rowNum, isH?SL_H[col]:SL_D[col], cells[col]??{type:'',value:null}))
  return `<row r="${rowNum}" spans="1:53" s="${isH?304:457}" customFormat="1" ht="15.75" customHeight="1" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}
function buildSLSubheaderRow(): string {
  // Style 439 = full template subheader style (blue bg, bold, wrap) — use OH row2 style 42
  const HDR_S = 439  // subheader cell style in full template SL sheet
  const ROW_S = 290  // row-level style for subheader rows in full template
  const cells: string[] = SL_COLS.map(col => {
    const ref = `${col}2`
    // Find week index for this column
    const weekIdx = SL_WEEK_PAIRS.findIndex(([wh, wc]) => wh === col || wc === col)
    let label = ''
    if (weekIdx >= 0) {
      const isHrs = SL_WEEK_PAIRS[weekIdx][0] === col
      label = `Week ${weekIdx+1} - Actual ${isHrs ? 'Hours' : 'Total Cost'}`
    } else {
      label = SL_SUBHEADER_STATIC[col] ?? ''
    }
    if (!label) return `<c r="${ref}" s="${HDR_S}"/>`
    return `<c r="${ref}" s="${HDR_S}" t="inlineStr"><is><t>${label}</t></is></c>`
  })
  return `<row r="2" spans="1:53" s="${ROW_S}" customFormat="1" ht="63" x14ac:dyDescent="0.25">${cells.join('')}</row>`
}

function buildOHRow(rowNum: number, isH: boolean, cells: Record<string,CellDef>): string {
  const parts = OH_COLS.map(col => makeCell(col, rowNum, isH?OH_H[col]:OH_D[col], cells[col]??{type:'',value:null}))
  return `<row r="${rowNum}" spans="1:47" s="${isH?146:148}" customFormat="1" ht="12.75" customHeight="1" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}
function buildVarRow(rowNum: number, cells: Record<string,CellDef>): string {
  const parts = VAR_COLS.map(col => makeCell(col, rowNum, VAR_D[col]??222, cells[col]??{type:'',value:null}))
  return `<row r="${rowNum}" spans="1:39" ht="15.75" x14ac:dyDescent="0.25">${parts.join('')}</row>`
}

// ── Main export ───────────────────────────────────────────────────────────
export async function exportTceAll(
  projectId: string,
  projectName: string,
  lines: NrgTceLine[],
  orderedWeeks: string[],
) {
  const [clRes, varRes, nrgInvRes, supInvRes, expRes, templateResp] = await Promise.all([
    supabase.from('timesheet_cost_lines')
      .select('tce_item_id,week_ending,allocated_hours,sell_labour,sell_labour_eur,sell_allowances')
      .eq('project_id', projectId).eq('timesheet_status', 'approved'),
    supabase.from('variations').select('id,number,title,tce_link,wo_ref,sell_total,cost_total,status,scope,notes')
      .eq('project_id', projectId),
    supabase.from('nrg_customer_invoices').select('week_ending,eur_spot_rate')
      .eq('project_id', projectId).order('week_ending'),
    supabase.from('invoices').select('tce_item_id,invoice_date,date_processed,amount')
      .eq('project_id', projectId).in('status', ['approved', 'paid']),
    supabase.from('expenses').select('tce_item_id,date,sell_price,cost_ex_gst,amount')
      .eq('project_id', projectId),
    fetch('/tce_full_template.xlsx'),
  ])

  if (!templateResp.ok) throw new Error(`Template fetch failed: ${templateResp.status}`)
  const templateBuf = await templateResp.arrayBuffer()

  const costLines = (clRes.data||[]) as CostRow[]
  const variations = (varRes.data||[]) as {
    id:string;number:string;title:string;tce_link:string|null;wo_ref:string|null;
    sell_total:number;cost_total:number;status:string;scope:string;notes:string
  }[]
  const nrgInvSorted = ((nrgInvRes.data||[]) as {week_ending:string|null;eur_spot_rate:number|null}[])
    .filter(i=>i.week_ending).sort((a,b)=>a.week_ending!.localeCompare(b.week_ending!))
  const supplierInvoices = (supInvRes.data||[]) as {tce_item_id:string|null;invoice_date:string|null;date_processed:string|null;amount:number|null}[]
  const expenseItems = (expRes.data||[]) as {tce_item_id:string|null;date:string|null;sell_price:number|null;cost_ex_gst:number|null;amount:number|null}[]

  const spotRateByWE: Record<string,number|null> = {}
  for (const i of nrgInvSorted) {
    const r=i.eur_spot_rate
    spotRateByWE[i.week_ending!]=r!=null&&!isNaN(Number(r))?Number(r):null
  }
  const spotRate=(we:string)=>spotRateByWE[we]??null

  const slWeeks=orderedWeeks.slice(0,11)
  const ohWeeks=orderedWeeks.slice(0,11)
  const varWeeks=orderedWeeks.slice(0,12)
  const weSet=new Set(orderedWeeks)

  // Classify each TCE item exactly like NrgInvoicingPanel.lineActualInPeriodEurAware():
  // - Fixed Price items: panel returns 0 → we skip cost_lines AND invoices/expenses
  // - Labour items (line_type contains 'Labour' OR source === 'skilled'): cost_lines + invoices + expenses
  // - Non-labour items (everything else, e.g. 'Invoice / Receipt'): invoices + expenses ONLY.
  // This last rule is the important one — non-labour overhead items like Accommodation
  // or LAHA can have allowance entries written to timesheet_cost_lines by the
  // timesheet engine (zero-hour rows with sell_allowances > 0). The panel ignores
  // those for non-labour lines; we must too, otherwise the column total overshoots.
  const itemIsFixedPrice: Record<string, boolean> = {}
  const itemIsLabour: Record<string, boolean> = {}
  for (const l of lines) {
    if (!l.item_id) continue
    itemIsFixedPrice[l.item_id] = l.line_type === 'Fixed Price'
    itemIsLabour[l.item_id] = (l.line_type || '').includes('Labour') || l.source === 'skilled'
  }

  const byItemWeek:Record<string,Record<string,{hours:number;sell:number}>>= {}
  for (const r of costLines) {
    if(!r.tce_item_id||!weSet.has(r.week_ending)) continue
    if(itemIsFixedPrice[r.tce_item_id]) continue   // panel returns 0 for fixed-price
    if(!itemIsLabour[r.tce_item_id]) continue      // panel skips cost_lines for non-labour items
    const b=byItemWeek[r.tce_item_id]??={}
    const w=b[r.week_ending]??={hours:0,sell:0}
    w.hours+=r.allocated_hours||0
    const eur=r.sell_labour_eur||0
    w.sell+=eur>0?(spotRate(r.week_ending)??1)*eur+(r.sell_allowances||0):(r.sell_labour||0)+(r.sell_allowances||0)
  }

  // Period-bucketed non-labour costs (supplier invoices + expenses) tagged to TCE items.
  // Each selected WE column represents a Mon-Sun week ending on that date. A cost
  // with date D lands in column WE if D is in the 7-day window (WE-7, WE] — i.e.
  // the Monday-to-Sunday week ending on WE. Costs outside any selected week are
  // dropped. If a user wants a fortnightly column they create two weekly invoices.
  const nonLabourByItemWeek:Record<string,Record<string,number>>={}
  function periodWE(date:string|null):string|null{
    if(!date) return null
    const d=date.slice(0,10)
    for(const we of orderedWeeks){
      const fromExclusive=addDays(we,-7)
      if(d>fromExclusive && d<=we) return we
    }
    return null
  }
  for(const inv of supplierInvoices){
    if(!inv.tce_item_id) continue
    if(itemIsFixedPrice[inv.tce_item_id]) continue   // panel returns 0 for fixed-price
    const we=periodWE(inv.date_processed || inv.invoice_date)
    if(!we) continue
    const b=nonLabourByItemWeek[inv.tce_item_id]??={}
    b[we]=(b[we]||0)+(Number(inv.amount)||0)
  }
  for(const exp of expenseItems){
    if(!exp.tce_item_id) continue
    if(itemIsFixedPrice[exp.tce_item_id]) continue   // panel returns 0 for fixed-price
    const we=periodWE(exp.date)
    if(!we) continue
    const sell=Number(exp.sell_price), cost=Number(exp.cost_ex_gst)
    const amt=(!isNaN(sell)&&sell!==0)?sell:((!isNaN(cost)&&cost!==0)?cost:(Number(exp.amount)||0))
    const b=nonLabourByItemWeek[exp.tce_item_id]??={}
    b[we]=(b[we]||0)+amt
  }

  const varByItem:Record<string,number>={}
  for (const v of variations) if(v.tce_link) varByItem[v.tce_link]=(varByItem[v.tce_link]||0)+(v.sell_total||0)

  // Build item_id → contract_scope map from TCE lines for variation service order lookup
  const scopeByItemId:Record<string,string>={}
  for (const l of lines) if(l.item_id && l.contract_scope) scopeByItemId[l.item_id]=l.contract_scope

  const zip=await JSZip.loadAsync(templateBuf)
  const sl3Xml=await zip.file('xl/worksheets/sheet3.xml')!.async('string')
  const oh2Xml=await zip.file('xl/worksheets/sheet2.xml')!.async('string')
  const var4Xml=await zip.file('xl/worksheets/sheet4.xml')!.async('string')
  const ssXml=await zip.file('xl/sharedStrings.xml')!.async('string')

  const existingSiCount=(ssXml.match(/<si>/g)||[]).length
  const newSi:string[]=[]
  const strCache:Record<string,number>={}
  function strIdx(s:string):number {
    if(s in strCache) return strCache[s]
    const idx=existingSiCount+newSi.length
    const space=s!==s.trim()?' xml:space="preserve"':''
    newSi.push(`<si><t${space}>${xmlEsc(s)}</t></si>`)
    strCache[s]=idx; return idx
  }

  const isGroupHdr=(l:NrgTceLine)=>l.line_type==='H'||l.line_type==='group'||/^\d+\.\d+\.\d+$/.test(l.item_id||'')
  interface Group{hdr:NrgTceLine;dets:NrgTceLine[]}
  function groupLines(src:NrgTceLine[]):Group[]{
    const g:Group[]=[]; let cur:Group|null=null
    for(const l of src){
      if(isGroupHdr(l)){if(cur)g.push(cur);cur={hdr:l,dets:[]}}
      else if(cur) cur.dets.push(l)
    }
    if(cur)g.push(cur); return g
  }
  function weekCells(itemId:string|null,weekPairs:[string,string][],weeks:string[],cells:Record<string,CellDef>,includeNonLabour:boolean=false):{totHrs:number;totSell:number}{
    let totHrs=0,totSell=0
    const wd=itemId?(byItemWeek[itemId]||{})  :{}
    const nlwd:Record<string,number>=itemId&&includeNonLabour?(nonLabourByItemWeek[itemId]||{}):{}
    for(let wi=0;wi<weekPairs.length;wi++){
      const[wh,wc]=weekPairs[wi],we=weeks[wi]
      const data=we?(wd[we]||{hours:0,sell:0}):{hours:0,sell:0}
      const nonLabour=we?(nlwd[we]||0):0
      const sellTotal=data.sell+nonLabour
      cells[wh]={type:data.hours?'n':'',value:data.hours||null}
      cells[wc]={type:sellTotal?'n':'',value:sellTotal||null}
      totHrs+=data.hours||0;totSell+=sellTotal
    }
    return{totHrs,totSell}
  }

  // ── Skilled Labour rows (data from row 2, 1 header) ────────────────────
  const slRows:string[]=[]; let slRowNum=3
  for(const{hdr,dets}of groupLines(lines.filter(l=>l.source==='skilled'))){
    const hRow=slRowNum++; const detRows=dets.map(()=>slRowNum++)
    // Full template SL layout: A=Service Order, D=Work Order, F=Scope No,
    // G=Description, H=Scope Type, I=Task Resp, K=Comment, M=Est Hrs,
    // N=Gang Rate, O=Est Total, W/X…AQ/AR=weeks
    const hc:Record<string,CellDef>={
      A:{type:'s',value:strIdx(hdr.contract_scope||'')},B:{type:'',value:null},
      C:{type:'',value:null},D:{type:'s',value:strIdx(hdr.work_order||'')},
      E:{type:'',value:null},F:{type:'s',value:strIdx(hdr.item_id||'')},
      G:{type:'s',value:strIdx(hdr.description||'')},
      H:{type:'s',value:strIdx(hdr.line_type==='group'?'H':hdr.line_type||'')},
      I:{type:'s',value:strIdx((hdr.details as Record<string,unknown>)?.task_responsibility as string||'')},
      J:{type:'',value:null},K:{type:'s',value:strIdx(hdr.notes||'')},L:{type:'',value:null},
    }
    if(detRows.length>0){
      const r0=detRows[0],r1=detRows[detRows.length-1]
      hc['M']={type:'f',value:0,formula:r0===r1?`M${r0}`:`SUM(M${r0}:M${r1})`}
      hc['O']={type:'f',value:0,formula:r0===r1?`O${r0}`:`SUM(O${r0}:O${r1})`}
    }else{hc['M']={type:'n',value:hdr.estimated_qty||0};hc['O']={type:'n',value:hdr.tce_total||0}}
    hc['N']={type:'n',value:hdr.tce_rate||0}
    for(const c of['P','Q','R','S','T','U','V'])hc[c]={type:'',value:null}
    for(const[wh,wc]of SL_WEEK_PAIRS){hc[wh]={type:'',value:null};hc[wc]={type:'',value:null}}
    for(const c of[SL_TOT_HRS,SL_TOT_COST,SL_GANG,SL_PCT_HRS,SL_PCT_COST,'AX','AY','AZ','BA'])hc[c]={type:'',value:null}
    slRows.push(buildSLRow(hRow,true,hc))

    for(let i=0;i<dets.length;i++){
      const d=dets[i],dr=detRows[i]
      const dc:Record<string,CellDef>={
        A:{type:'s',value:strIdx(d.contract_scope||'')},B:{type:'',value:null},
        C:{type:'',value:null},D:{type:'s',value:strIdx(d.work_order||'')},
        E:{type:'',value:null},F:{type:'s',value:strIdx(d.item_id||'')},
        G:{type:'s',value:strIdx(d.description||'')},
        H:{type:'s',value:strIdx(d.line_type||'')},
        I:{type:'s',value:strIdx((d.details as Record<string,unknown>)?.task_responsibility as string||'')},
        J:{type:'',value:null},K:{type:'s',value:strIdx(d.notes||'')},L:{type:'',value:null},
        M:{type:d.estimated_qty?'n':'',value:d.estimated_qty||null},
        N:{type:d.tce_rate?'n':'',value:d.tce_rate||null},
        O:{type:d.tce_total?'n':'',value:d.tce_total||null},
        P:{type:'',value:null},Q:{type:'',value:null},R:{type:'',value:null},
        S:{type:'',value:null},T:{type:'',value:null},U:{type:'',value:null},V:{type:'',value:null},
      }
      const{totHrs,totSell}=weekCells(d.item_id,SL_WEEK_PAIRS,slWeeks,dc,true)
      const varAmt=d.item_id?(varByItem[d.item_id]||0):0
      const fHrs=totHrs,fCost=totSell+varAmt
      dc[SL_TOT_HRS]={type:fHrs?'n':'',value:fHrs||null}
      dc[SL_TOT_COST]={type:fCost?'n':'',value:fCost||null}
      dc[SL_GANG]=fHrs>0?{type:'n',value:fCost/fHrs}:{type:'',value:null}
      dc[SL_PCT_HRS]=(d.estimated_qty||0)>0?{type:'n',value:fHrs/d.estimated_qty}:{type:'',value:null}
      dc[SL_PCT_COST]=(d.tce_total||0)>0?{type:'n',value:fCost/d.tce_total}:{type:'',value:null}
      for(const c of['AX','AY','AZ','BA'])dc[c]={type:'',value:null}
      slRows.push(buildSLRow(dr,false,dc))
    }
  }

  // ── Overheads rows (data from row 3, 2 headers) ────────────────────────
  const ohRows:string[]=[]; let ohRowNum=3
  for(const{hdr,dets}of groupLines(lines.filter(l=>l.source==='overhead'))){
    const hRow=ohRowNum++; const detRows=dets.map(()=>ohRowNum++)
    const hc:Record<string,CellDef>={
      A:{type:'s',value:strIdx(hdr.work_order||'')},B:{type:'s',value:strIdx(hdr.contract_scope||'')},
      C:{type:'s',value:strIdx(hdr.item_id||'')},D:{type:'s',value:strIdx(hdr.description||'')},
      E:{type:'s',value:strIdx(hdr.kpi_included?'Yes':'No')},F:{type:'',value:null},
    }
    if(detRows.length>0){
      const r0=detRows[0],r1=detRows[detRows.length-1]
      hc['J']={type:'f',value:0,formula:r0===r1?`J${r0}`:`SUM(J${r0}:J${r1})`}
    }else{hc['J']={type:'n',value:hdr.tce_total||0}}
    for(const c of['G','H','I','K','L','M','N','O','P','AM','AN','AO','AP','AQ','AR','AS','AT','AU'])hc[c]={type:'',value:null}
    for(const[wh,wc]of OH_WEEK_PAIRS){hc[wh]={type:'',value:null};hc[wc]={type:'',value:null}}
    ohRows.push(buildOHRow(hRow,true,hc))

    for(let i=0;i<dets.length;i++){
      const d=dets[i],dr=detRows[i]
      const dc:Record<string,CellDef>={
        A:{type:'s',value:strIdx(d.work_order||'')},B:{type:'s',value:strIdx(d.contract_scope||'')},
        C:{type:'s',value:strIdx(d.item_id||'')},D:{type:'s',value:strIdx(d.description||'')},
        E:{type:'s',value:strIdx(d.kpi_included?'Yes':'No')},F:{type:'',value:null},
        G:{type:d.estimated_qty?'n':'',value:d.estimated_qty||null},
        H:{type:'s',value:strIdx(d.unit_type||'')},
        I:{type:d.tce_rate?'n':'',value:d.tce_rate||null},
        J:{type:d.tce_total?'n':'',value:d.tce_total||null},
        K:{type:'',value:null},L:{type:'',value:null},M:{type:'',value:null},
        N:{type:'',value:null},O:{type:'',value:null},P:{type:'',value:null},
      }
      const{totHrs,totSell}=weekCells(d.item_id,OH_WEEK_PAIRS,ohWeeks,dc,true)
      dc['AM']={type:'',value:null};dc['AN']={type:'',value:null}
      dc['AO']={type:totHrs?'n':'',value:totHrs||null}
      dc['AP']={type:totSell?'n':'',value:totSell||null}
      dc['AQ']=totHrs>0?{type:'n',value:totSell/totHrs}:{type:'',value:null}
      dc['AR']=(d.estimated_qty||0)>0?{type:'n',value:totHrs/d.estimated_qty}:{type:'',value:null}
      dc['AS']=(d.tce_total||0)>0?{type:'n',value:totSell/d.tce_total}:{type:'',value:null}
      dc['AT']={type:'',value:null};dc['AU']={type:'',value:null}
      ohRows.push(buildOHRow(dr,false,dc))
    }
  }

  // ── Variations rows (data from row 2, 1 header) ────────────────────────
  const varRows:string[]=[]; let varRowNum=2
  for(const v of variations){
    const contractScope = v.tce_link ? (scopeByItemId[v.tce_link]||'') : ''
    const dc:Record<string,CellDef>={
      A:{type:'s',value:strIdx(contractScope)},
      B:{type:'s',value:strIdx(v.wo_ref||'')},
      C:{type:'s',value:strIdx(v.title||'')},
      D:{type:'',value:null},
      E:{type:'',value:null},
      F:{type:v.sell_total?'n':'',value:v.sell_total||null},
      G:{type:'s',value:strIdx(v.status||'')},H:{type:'s',value:strIdx(v.number||'')},I:{type:'',value:null},
    }
    const{totHrs,totSell}=weekCells(v.tce_link,VAR_WEEK_PAIRS,varWeeks,dc)
    dc['AH']={type:totHrs?'n':'',value:totHrs||null}
    dc['AI']={type:totSell?'n':'',value:totSell||null}
    dc['AJ']={type:'',value:null}
    dc['AK']=(v.sell_total||0)>0?{type:'n',value:totSell/v.sell_total}:{type:'',value:null}
    dc['AL']={type:'',value:null};dc['AM']={type:'',value:null}
    varRows.push(buildVarRow(varRowNum++,dc))
  }

  // ── Splice + write ────────────────────────────────────────────────────
  function spliceSheet(xml:string,headerRows:number,dataRows:string[],lastRow:string,dimRe:RegExp):string{
    const hdrs=Array.from({length:headerRows},(_,i)=>
      xml.match(new RegExp('<row r="'+(i+1)+'"[^>]*>.*?<\\/row>','s'))?.[0]||''
    ).join('')
    return xml
      .replace(/<sheetData>.*?<\/sheetData>/s,`<sheetData>${hdrs}${dataRows.join('')}</sheetData>`)
      .replace(dimRe,`ref="A1:${lastRow}"`)
  }

  // SL: keep row 1 (section labels), inject custom subheader as row 2, data from row 3
  const slSubheader = buildSLSubheaderRow()
  const sl1 = sl3Xml.match(/<row r="1"[^>]*>.*?<\/row>/s)?.[0] || ''
  const updatedSL = sl3Xml
    .replace(/<sheetData>.*?<\/sheetData>/s, `<sheetData>${sl1}${slSubheader}${slRows.join('')}</sheetData>`)
    .replace(/ref="A1:BA\d+"/, `ref="A1:BA${slRowNum-1}"`)
  zip.file('xl/worksheets/sheet3.xml', updatedSL)
  zip.file('xl/worksheets/sheet2.xml', spliceSheet(oh2Xml,  2, ohRows,  `AU${ohRowNum-1}`,  /ref="A1:BC\d+"/))
  zip.file('xl/worksheets/sheet4.xml', spliceSheet(var4Xml, 1, varRows, `AM${varRowNum-1}`, /ref="A1:AM\d+"/))

  const total=existingSiCount+newSi.length
  zip.file('xl/sharedStrings.xml', ssXml
    .replace(/count="\d+"/,`count="${total}"`)
    .replace(/uniqueCount="\d+"/,`uniqueCount="${total}"`)
    .replace(/<\/sst>/,newSi.join('')+'</sst>'))
  zip.remove('xl/calcChain.xml')

  const outBuf=await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'})
  const a=document.createElement('a')
  a.href=URL.createObjectURL(new Blob([outBuf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  a.download=`TCE_${projectName.replace(/[^a-zA-Z0-9_-]/g,'_')}.xlsx`
  a.click(); URL.revokeObjectURL(a.href)
}
