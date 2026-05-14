/**
 * NRG Customer Invoicing Panel
 * Mirrors NRG's "Invoice Summary" Excel tab.
 * Period-bounded invoices grouped by contract scope.
 * Manual cell overrides stored in invoice.overrides map.
 * Yellow cell = override in effect. Click any cell to set/clear.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { writeTimesheetCostLines } from '../../engines/timesheetCostEngine'
import type { RateCard, WeeklyTimesheet } from '../../types'
import type { NrgTceLine, NrgCustomerInvoice, NrgInvoiceGroupingRule } from '../../types'

const fmt = (n: number) => n === 0 ? '—' : '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const DEFAULT_RULES = [
  { group_name: 'TasTK — Overheads & Skilled Labour', triggers: ['000001','000003','000004','/00001','/00003','/00004'], sort_order: 0 },
  { group_name: 'Non TasTK — Overheads', triggers: ['000002','/00002'], sort_order: 1 },
]

function contractGroup(cs: string, rules: NrgInvoiceGroupingRule[]): string {
  for (const rule of [...rules].sort((a,b) => a.sort_order - b.sort_order)) {
    if (rule.triggers.some(t => cs.includes(t))) return rule.group_name
  }
  return 'Ungrouped'
}

export function NrgInvoicingPanel() {
  const { activeProject } = useAppStore()
  const [tceLines, setTceLines] = useState<NrgTceLine[]>([])
  const [invoices, setInvoices] = useState<NrgCustomerInvoice[]>([])
  const [rules, setRules] = useState<NrgInvoiceGroupingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [invModal, setInvModal] = useState<null|'new'|NrgCustomerInvoice>(null)
  const [invForm, setInvForm] = useState({ label:'', invoice_number:'', week_ending:'', sent_date:'', notes:'', eur_spot_rate:'' })
  const [rulesModal, setRulesModal] = useState(false)
  const [rulesForm, setRulesForm] = useState<{group_name:string;triggers_str:string}[]>([])
  const [drillCell, setDrillCell] = useState<{inv:NrgCustomerInvoice;cs:string;fromWE:string;toWE:string}|null>(null)
  const [overrideInput, setOverrideInput] = useState('')
  // Cost lines from timesheet_cost_lines — single source of truth for labour actuals
  const [costLinesByItemAndWeek, setCostLinesByItemAndWeek] = useState<Record<string,Record<string,{cost:number;sell:number;sellEur:number}>>>({})
  const [rawCostLines, setRawCostLines] = useState<{tce_item_id:string|null;week_ending:string;week_start:string;sell_labour:number;sell_labour_eur:number;sell_allowances:number;allocated_hours:number;category:string}[]>([])
  const [supplierInvoices, setSupplierInvoices] = useState<Record<string,unknown>[]>([])
  const [expenseItems, setExpenseItems] = useState<Record<string,unknown>[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    // Load TCE lines up front — both for the backfill writer (so WO-only allocs
    // get resolved to item_ids on legacy timesheets) and for the main render below.
    const { data: tceLinesData } = await supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('item_id')
    const fetchedTceLines = (tceLinesData || []) as NrgTceLine[]

    // Backfill: if no cost lines exist for this project, write them from approved timesheets
    const { count } = await supabase.from('timesheet_cost_lines').select('id', { count: 'exact', head: true }).eq('project_id', pid)
    if ((count || 0) === 0) {
      const [tsRes, rcRes, resRes] = await Promise.all([
        supabase.from('weekly_timesheets').select('*').eq('project_id', pid).eq('status', 'approved'),
        supabase.from('rate_cards').select('*').eq('project_id', pid),
        supabase.from('resources').select('id,wbs').eq('project_id', pid),
      ])
      const rcs = (rcRes.data || []) as RateCard[]
      const resources = (resRes.data || []) as { id: string; wbs?: string | null }[]
      for (const ts of (tsRes.data || []) as WeeklyTimesheet[]) {
        await writeTimesheetCostLines(ts, pid, rcs, fetchedTceLines, resources, activeProject)
      }
    }

    const [invRes, rulesRes, clRes, supInvRes, expRes] = await Promise.all([
      supabase.from('nrg_customer_invoices').select('*').eq('project_id', pid).order('week_ending'),
      supabase.from('nrg_invoice_grouping_rules').select('*').eq('project_id', pid).order('sort_order'),
      supabase.from('timesheet_cost_lines')
        .select('tce_item_id,week_ending,week_start,cost_labour,sell_labour,sell_labour_eur,cost_allowances,sell_allowances,allocated_hours,category')
        .eq('project_id', pid).eq('timesheet_status', 'approved'),
      supabase.from('invoices').select('tce_item_id,invoice_date,date_processed,amount,sell_price,status,invoice_number').eq('project_id', pid).in('status', ['approved', 'paid']),
      supabase.from('expenses').select('tce_item_id,date,cost_ex_gst,amount,sell_price,description,vendor,expense_ref,category,chargeable').eq('project_id', pid).eq('chargeable', true),
    ])
    setTceLines(fetchedTceLines)
    setInvoices((invRes.data||[]) as NrgCustomerInvoice[])
    // Aggregate cost lines: { tce_item_id -> { week_ending -> { cost, sell } } }
    const byItemWeek: Record<string,Record<string,{cost:number;sell:number;sellEur:number}>> = {}
    const rawCL: typeof rawCostLines = []
    for (const r of (clRes.data||[]) as {tce_item_id:string|null;week_ending:string;week_start:string;cost_labour:number;sell_labour:number;sell_labour_eur:number;cost_allowances:number;sell_allowances:number;allocated_hours:number;category:string}[]) {
      if (!r.tce_item_id) continue
      if (!byItemWeek[r.tce_item_id]) byItemWeek[r.tce_item_id] = {}
      if (!byItemWeek[r.tce_item_id][r.week_ending]) byItemWeek[r.tce_item_id][r.week_ending] = {cost:0,sell:0,sellEur:0}
      byItemWeek[r.tce_item_id][r.week_ending].cost += (r.cost_labour||0) + (r.cost_allowances||0)
      byItemWeek[r.tce_item_id][r.week_ending].sell += (r.sell_labour||0) + (r.sell_allowances||0)
      byItemWeek[r.tce_item_id][r.week_ending].sellEur += (r.sell_labour_eur||0)
      rawCL.push({ tce_item_id: r.tce_item_id, week_ending: r.week_ending, week_start: r.week_start, sell_labour: r.sell_labour||0, sell_labour_eur: r.sell_labour_eur||0, sell_allowances: r.sell_allowances||0, allocated_hours: r.allocated_hours||0, category: r.category||'' })
    }
    setCostLinesByItemAndWeek(byItemWeek)
    setRawCostLines(rawCL)
    setSupplierInvoices((supInvRes.data||[]) as Record<string,unknown>[])
    setExpenseItems((expRes.data||[]) as Record<string,unknown>[])
    let rd = (rulesRes.data||[]) as NrgInvoiceGroupingRule[]
    if (rd.length === 0) {
      const { data: nr } = await supabase.from('nrg_invoice_grouping_rules')
        .insert(DEFAULT_RULES.map(r => ({ ...r, project_id: pid }))).select()
      rd = (nr||[]) as NrgInvoiceGroupingRule[]
    }
    setRules(rd)
    setLoading(false)
  }

  const contractScopes = [...new Set(tceLines.map(l => l.contract_scope).filter(Boolean))].sort()
  const sortedInvoices = [...invoices].sort((a,b) => (a.week_ending||'').localeCompare(b.week_ending||''))

  const groups = new Map<string, string[]>()
  for (const cs of contractScopes) {
    const g = contractGroup(cs, rules)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(cs)
  }

  // Period helper: is `date` (YYYY-MM-DD) in (fromWE, toWE] — exclusive from, inclusive to
  function inPeriod(date: string, fromWE: string, toWE: string): boolean {
    if (!date || !toWE) return false
    const d = date.slice(0,10)
    if (d > toWE) return false
    if (fromWE && d <= fromWE) return false
    return true
  }

  // Previous invoice week-ending (for period start)
  function prevWE(invId: string): string {
    const all = [...sortedInvoices].filter(i => i.week_ending)
    const idx = all.findIndex(i => i.id === invId)
    if (idx <= 0) return ''
    return all[idx-1].week_ending || ''
  }

  // Sum period-bounded actuals for a contract scope
  function calcPeriodAmount(inv: NrgCustomerInvoice, cs: string): number {
    const from = prevWE(inv.id)
    const to = inv.week_ending || ''
    if (!to) return 0
    const isGroupHeader = (id: string|null) => !!id && /^\d+\.\d+\.\d+$/.test(id||'')
    return tceLines
      .filter(l => l.contract_scope === cs && !isGroupHeader(l.item_id))
      .reduce((s, l) => s + lineActualInPeriodEurAware(l, from, to), 0)
  }

  function effectiveAmount(inv: NrgCustomerInvoice, cs: string): number {
    const ov = inv.overrides?.[cs]
    if (ov !== undefined && ov !== null) return ov
    return calcPeriodAmount(inv, cs)
  }

  function hasOverride(inv: NrgCustomerInvoice, cs: string): boolean {
    return inv.overrides?.[cs] !== undefined && inv.overrides?.[cs] !== null
  }

  function isCalculated(inv: NrgCustomerInvoice, cs: string): boolean {
    return inv.overrides?.[cs] === undefined || inv.overrides?.[cs] === null
  }

  // ─── EUR spot rate helpers ─────────────────────────────────────────────────

  /** Get the spot rate for the invoice that covers a given week_ending. */
  function spotRateForInvoice(inv: NrgCustomerInvoice): number | null {
    const r = (inv as NrgCustomerInvoice & {eur_spot_rate?:number|null}).eur_spot_rate
    return (r != null && !isNaN(Number(r))) ? Number(r) : null
  }

  /** Map week_ending → spot rate from the covering invoice (the invoice whose
   *  week_ending is >= the cost line's week_ending, nearest chronologically). */
  const spotRateByWeek = (() => {
    const map: Record<string, number | null> = {}
    for (const cl of rawCostLines) {
      if (cl.sell_labour_eur === 0) continue
      if (map[cl.week_ending] !== undefined) continue
      // Find the first invoice whose week_ending >= this cost line's week_ending
      const covering = sortedInvoices.find(i => i.week_ending && i.week_ending >= cl.week_ending)
      map[cl.week_ending] = covering ? spotRateForInvoice(covering) : null
    }
    return map
  })()

  /** Total EUR sell that has no spot rate (ungated), and total that does (gated) */
  const eurSummary = (() => {
    let ungatedEur = 0, ungatedWeeks = new Set<string>()
    for (const cl of rawCostLines) {
      if (cl.sell_labour_eur === 0) continue
      const rate = spotRateByWeek[cl.week_ending]
      if (rate == null) { ungatedEur += cl.sell_labour_eur; ungatedWeeks.add(cl.week_ending) }
    }
    return { ungatedEur, ungatedWeekCount: ungatedWeeks.size }
  })()

  /** Compute the period-gated EUR-aware sell for a labour TCE line in a period.
   *  For seag weeks with no spot rate, contribution is 0 (gated).
   *  For seag weeks with a spot rate, uses: sell_labour_eur × rate + allowances(AUD).
   *  For non-seag labour, unchanged (uses sell_labour AUD directly). */
  function lineActualInPeriodEurAware(line: NrgTceLine, fromWE: string, toWE: string): number {
    if (!toWE) return 0
    if (line.line_type === 'Fixed Price') return 0
    const isLabour = (line.line_type || '').includes('Labour') || line.source === 'skilled'
    if (!isLabour) {
      // Non-labour: unchanged
      let total = 0
      for (const inv of supplierInvoices) {
        if (inv.tce_item_id !== line.item_id) continue
        if (!inPeriod((inv.date_processed || inv.invoice_date) as string, fromWE, toWE)) continue
        total += (Number(inv.sell_price) || 0) !== 0 ? Number(inv.sell_price) : (Number(inv.amount) || 0)
      }
      for (const exp of expenseItems) {
        if (exp.tce_item_id !== line.item_id) continue
        if (!inPeriod(exp.date as string, fromWE, toWE)) continue
        const sell = Number(exp.sell_price), cost = Number(exp.cost_ex_gst)
        total += (!isNaN(sell) && sell !== 0) ? sell : ((!isNaN(cost) && cost !== 0) ? cost : (Number(exp.amount) || 0))
      }
      return total
    }
    // Labour: sum week-by-week, applying spot rate for seag weeks
    const buckets = line.item_id ? (costLinesByItemAndWeek[line.item_id] || {}) : {}
    let total = 0
    for (const [we, vals] of Object.entries(buckets)) {
      if (we > toWE) continue
      if (fromWE && we <= fromWE) continue
      if (vals.sellEur > 0) {
        // seag week — gated on spot rate
        const rate = spotRateByWeek[we]
        if (rate == null) continue  // no rate = excluded
        total += vals.sellEur * rate  // EUR labour converted at spot rate
      } else {
        total += vals.sell
      }
    }
    // Also add any invoices/expenses tagged to this line (e.g. 'Labour and Invoice / Receipt' lines)
    for (const inv of supplierInvoices) {
      if (inv.tce_item_id !== line.item_id) continue
      if (!inPeriod((inv.date_processed || inv.invoice_date) as string, fromWE, toWE)) continue
      total += (Number(inv.sell_price) || 0) !== 0 ? Number(inv.sell_price) : (Number(inv.amount) || 0)
    }
    for (const exp of expenseItems) {
      if (exp.tce_item_id !== line.item_id) continue
      if (!inPeriod(exp.date as string, fromWE, toWE)) continue
      const sell = Number(exp.sell_price), cost = Number(exp.cost_ex_gst)
      total += (!isNaN(sell) && sell !== 0) ? sell : ((!isNaN(cost) && cost !== 0) ? cost : (Number(exp.amount) || 0))
    }
    return total
  }

  function handleCellClick(inv: NrgCustomerInvoice, cs: string) {
    const fromWE = prevWE(inv.id)
    const toWE   = inv.week_ending || ''
    setOverrideInput(inv.overrides?.[cs] !== undefined ? String(inv.overrides[cs]) : '')
    setDrillCell({ inv, cs, fromWE, toWE })
  }

  async function applyOverride(inv: NrgCustomerInvoice, cs: string, value: string) {
    const newOv = { ...(inv.overrides||{}) }
    if (value.trim().toLowerCase() === 'clear' || value.trim() === '') {
      delete newOv[cs]
    } else {
      const val = parseFloat(value.replace(/[^0-9.\-]/g,''))
      if (isNaN(val)) { toast('Invalid amount','error'); return }
      newOv[cs] = val
    }
    const { error } = await supabase.from('nrg_customer_invoices').update({ overrides: newOv }).eq('id', inv.id)
    if (error) { toast(error.message,'error'); return }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, overrides: newOv } : i))
  }

  function openNewInvoice() {
    setInvForm({ label:`Invoice ${sortedInvoices.length+1}`, invoice_number:'', week_ending:'', sent_date:'', notes:'', eur_spot_rate:'' })
    setInvModal('new')
  }

  function openEditInvoice(inv: NrgCustomerInvoice) {
    setInvForm({ label:inv.label, invoice_number:inv.invoice_number, week_ending:inv.week_ending||'', sent_date:inv.sent_date||'', notes:inv.notes, eur_spot_rate: (inv as NrgCustomerInvoice & {eur_spot_rate?:number|null}).eur_spot_rate != null ? String((inv as NrgCustomerInvoice & {eur_spot_rate?:number|null}).eur_spot_rate) : '' })
    setInvModal(inv)
  }

  async function saveInvoice() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, label: invForm.label.trim(),
      invoice_number: invForm.invoice_number.trim(),
      week_ending: invForm.week_ending||null, sent_date: invForm.sent_date||null,
      notes: invForm.notes, overrides: invModal!=='new' ? (invModal as NrgCustomerInvoice).overrides : {},
      eur_spot_rate: invForm.eur_spot_rate.trim() ? parseFloat(invForm.eur_spot_rate) : null,
    }
    const isNew = invModal === 'new'
    const { error } = isNew
      ? await supabase.from('nrg_customer_invoices').insert(payload)
      : await supabase.from('nrg_customer_invoices').update(payload).eq('id', (invModal as NrgCustomerInvoice).id)
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast(isNew ? 'Invoice added' : 'Updated','success')
    setSaving(false); setInvModal(null); load()
  }

  async function deleteInvoice(inv: NrgCustomerInvoice) {
    if (!confirm(`Delete "${inv.label}"?`)) return
    await supabase.from('nrg_customer_invoices').delete().eq('id', inv.id)
    toast('Deleted','info'); load()
  }

  async function saveRules() {
    setSaving(true)
    await supabase.from('nrg_invoice_grouping_rules').delete().eq('project_id', activeProject!.id)
    const inserts = rulesForm.filter(r=>r.group_name.trim()).map((r,i) => ({
      project_id: activeProject!.id, group_name: r.group_name.trim(),
      triggers: r.triggers_str.split(',').map(t=>t.trim()).filter(Boolean), sort_order: i,
    }))
    if (inserts.length > 0) {
      const { error } = await supabase.from('nrg_invoice_grouping_rules').insert(inserts)
      if (error) { toast(error.message,'error'); setSaving(false); return }
    }
    toast('Rules saved','success'); setSaving(false); setRulesModal(false); load()
  }

  function exportCSV() {
    const header = ['Group','Contract Scope',...sortedInvoices.map(i=>i.label||i.week_ending||i.id),'Progress Total']
    const rows: string[][] = [header]
    groups.forEach((scopes, groupName) => {
      rows.push([groupName,'',...sortedInvoices.map(()=>''),''])
      scopes.forEach(cs => {
        const amounts = sortedInvoices.map(inv => String(effectiveAmount(inv,cs)))
        const total = sortedInvoices.reduce((s,inv)=>s+effectiveAmount(inv,cs),0)
        rows.push(['',cs,...amounts,String(total)])
      })
      const groupTotals = sortedInvoices.map(inv => String(scopes.reduce((s,cs)=>s+effectiveAmount(inv,cs),0)))
      const groupTotal = scopes.reduce((s,cs)=>s+sortedInvoices.reduce((ss,inv)=>ss+effectiveAmount(inv,cs),0),0)
      rows.push(['','Total',...groupTotals,String(groupTotal)])
    })
    downloadCSV(rows, `NRG_Customer_Invoicing_${activeProject?.name||'project'}_${new Date().toISOString().slice(0,10)}`)
  }

  if (loading) return <div className="loading-center"><span className="spinner"/> Loading...</div>

  if (contractScopes.length === 0) return (
    <div style={{padding:'24px'}}>
      <h1 style={{fontSize:'18px',fontWeight:700,marginBottom:'8px'}}>NRG Customer Invoicing</h1>
      <div className="empty-state">
        <div className="icon">📄</div><h3>No contract scopes set</h3>
        <p>Populate Contract Scope on TCE lines first (Bulk Set Contract in TCE Register), then return here to add invoices.</p>
      </div>
    </div>
  )

  return (
    <div style={{padding:'24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px',flexWrap:'wrap',gap:'8px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>NRG Customer Invoicing</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {sortedInvoices.length} invoices · {contractScopes.length} contract scopes · Click any cell to override
          </p>
        </div>
        <div style={{display:'flex',gap:'6px'}}>
          <button className="btn btn-sm" onClick={()=>{setRulesForm(rules.map(r=>({group_name:r.group_name,triggers_str:r.triggers.join(', ')}))); setRulesModal(true)}}>⚙ Grouping Rules</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-primary" onClick={openNewInvoice}>+ Add Invoice</button>
        </div>
      </div>

      {eurSummary.ungatedEur > 0 && (
        <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',display:'flex',alignItems:'center',gap:'10px'}}>
          <span style={{fontSize:'18px'}}>🔴</span>
          <div>
            <div style={{fontWeight:700,fontSize:'13px',color:'#991b1b'}}>EUR costs pending spot rate</div>
            <div style={{fontSize:'12px',color:'#7f1d1d'}}>
              €{eurSummary.ungatedEur.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})} SE AG labour across {eurSummary.ungatedWeekCount} week{eurSummary.ungatedWeekCount!==1?'s':''} has no covering invoice spot rate. These costs are excluded from all totals until a spot rate is entered on the relevant invoice.
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={{fontSize:'12px',minWidth:'700px',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'var(--bg3)'}}>
                <th style={{padding:'8px 12px',textAlign:'left',minWidth:'200px'}}>Contract Scope</th>
                {sortedInvoices.map(inv=>{
                  const spot = spotRateForInvoice(inv)
                  return (
                  <th key={inv.id} style={{padding:'8px 12px',textAlign:'right',minWidth:'110px'}}>
                    <div style={{fontWeight:700}}>{inv.label||'Invoice'}</div>
                    <div style={{fontSize:'10px',color:'var(--text3)',fontWeight:400}}>{inv.week_ending?`WE ${inv.week_ending}`:'No period'}</div>
                    {spot != null
                      ? <div style={{fontSize:'9px',color:'#059669',fontWeight:600,marginTop:'1px'}}>€1 = ${spot.toFixed(4)}</div>
                      : <div style={{fontSize:'9px',color:'#dc2626',fontWeight:600,marginTop:'1px'}}>No spot rate</div>}
                    <div style={{display:'flex',gap:'3px',justifyContent:'flex-end',marginTop:'3px'}}>
                      <button className="btn btn-sm" style={{fontSize:'9px',padding:'1px 4px'}} onClick={()=>openEditInvoice(inv)}>✏</button>
                      <button className="btn btn-sm" style={{fontSize:'9px',padding:'1px 4px',color:'var(--red)'}} onClick={()=>deleteInvoice(inv)}>✕</button>
                    </div>
                  </th>
                )})}
                <th style={{padding:'8px 12px',textAlign:'right',minWidth:'100px',borderLeft:'2px solid var(--border)'}}>Progress Total</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([groupName, scopes]) => {
                const groupTotals = sortedInvoices.map(inv => scopes.reduce((s,cs)=>s+effectiveAmount(inv,cs),0))
                const progressTotal = groupTotals.reduce((s,t)=>s+t,0)
                return [
                  <tr key={`g-${groupName}`} style={{background:'#e0e7ff'}}>
                    <td colSpan={sortedInvoices.length+2} style={{padding:'6px 12px',fontWeight:700,fontSize:'11px',color:'#3730a3'}}>{groupName}</td>
                  </tr>,
                  ...scopes.map(cs => {
                    const rowTotal = sortedInvoices.reduce((s,inv)=>s+effectiveAmount(inv,cs),0)
                    return (
                      <tr key={cs} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'6px 12px',paddingLeft:'24px'}}>
                          <span style={{background:'#ede9fe',color:'#6b21a8',padding:'1px 6px',borderRadius:'3px',fontFamily:'var(--mono)',fontSize:'11px'}}>{cs}</span>
                        </td>
                        {sortedInvoices.map(inv => {
                          const amount = effectiveAmount(inv,cs)
                          const isOv = hasOverride(inv,cs)
                          const isCalc = isCalculated(inv,cs)
                          return (
                            <td key={inv.id} onClick={()=>handleCellClick(inv,cs)}
                              style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)',cursor:'pointer',
                                background:isOv?'#fefce8':isCalc&&amount!==0?'rgba(220,252,231,0.4)':'transparent',
                                color:amount>0?'var(--text)':amount<0?'var(--red)':'var(--text3)'}}>
                              {isOv&&<span style={{fontSize:'9px',color:'#d97706',marginRight:'3px'}}>✎</span>}
                              {isCalc&&amount!==0&&<span style={{fontSize:'9px',color:'#15803d',marginRight:'3px'}}>⚡</span>}
                              {fmt(amount)}
                            </td>
                          )
                        })}
                        <td style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,borderLeft:'2px solid var(--border)'}}>{fmt(rowTotal)}</td>
                      </tr>
                    )
                  }),
                  <tr key={`gt-${groupName}`} style={{background:'var(--bg3)',fontWeight:600,borderTop:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 12px',paddingLeft:'24px',color:'var(--text2)'}}>Total</td>
                    {groupTotals.map((t,i)=><td key={i} style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(t)}</td>)}
                    <td style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,borderLeft:'2px solid var(--border)'}}>{fmt(progressTotal)}</td>
                  </tr>,
                ]
              })}

              {/* Variations section — one row per variation TCE line, manual override cells */}
              {(() => {
                const variationLines = tceLines.filter(l => l.source === 'variation')
                if (!variationLines.length) return null
                const varTotals = sortedInvoices.map(inv =>
                  variationLines.reduce((s, vl) => s + effectiveAmount(inv, `__var__${vl.id}`), 0)
                )
                const varProgressTotal = varTotals.reduce((s,t)=>s+t,0)
                return [
                  <tr key="g-variations" style={{background:'#fdf2f8'}}>
                    <td colSpan={sortedInvoices.length+2} style={{padding:'6px 12px',fontWeight:700,fontSize:'11px',color:'#701a75',textTransform:'uppercase',letterSpacing:'0.04em'}}>Variations</td>
                  </tr>,
                  ...variationLines.map(vl => {
                    const key = `__var__${vl.id}`
                    const rowTotal = sortedInvoices.reduce((s,inv)=>s+effectiveAmount(inv,key),0)
                    return (
                      <tr key={key} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'6px 12px',paddingLeft:'24px'}}>
                          <span style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text2)',marginRight:'6px'}}>{vl.item_id||'—'}</span>
                          <span style={{fontSize:'12px',color:'var(--text)'}}>{vl.description||''}</span>
                          {vl.tce_total ? <span style={{marginLeft:'8px',fontSize:'10px',color:'var(--text3)'}}>(TCE: {fmt(vl.tce_total)})</span> : null}
                        </td>
                        {sortedInvoices.map(inv => {
                          const amount = effectiveAmount(inv, key)
                          const isOv = hasOverride(inv, key)
                          return (
                            <td key={inv.id} onClick={()=>handleCellClick(inv, key)}
                              style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)',cursor:'pointer',
                                background:isOv?'#fefce8':'transparent',
                                color:amount>0?'var(--text)':amount<0?'var(--red)':'var(--text3)'}}>
                              {isOv&&<span style={{fontSize:'9px',color:'#d97706',marginRight:'3px'}}>✎</span>}
                              {amount !== 0 ? fmt(amount) : <span style={{color:'var(--text3)'}}>—</span>}
                            </td>
                          )
                        })}
                        <td style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,borderLeft:'2px solid var(--border)'}}>{rowTotal !== 0 ? fmt(rowTotal) : '—'}</td>
                      </tr>
                    )
                  }),
                  <tr key="gt-variations" style={{background:'var(--bg3)',fontWeight:600,borderTop:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 12px',paddingLeft:'24px',color:'var(--text2)'}}>Total</td>
                    {varTotals.map((t,i)=><td key={i} style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)'}}>{t !== 0 ? fmt(t) : '—'}</td>)}
                    <td style={{padding:'6px 12px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,borderLeft:'2px solid var(--border)'}}>{varProgressTotal !== 0 ? fmt(varProgressTotal) : '—'}</td>
                  </tr>,
                ]
              })()}
            </tbody>
            <tfoot>
              <tr style={{background:'#1e3a5f',color:'#fff',fontWeight:700}}>
                <td style={{padding:'8px 12px'}}>GRAND TOTAL</td>
                {sortedInvoices.map(inv => {
                  const scopeTotal = contractScopes.reduce((s,cs)=>s+effectiveAmount(inv,cs),0)
                  const varTotal = tceLines.filter(l=>l.source==='variation').reduce((s,vl)=>s+effectiveAmount(inv,`__var__${vl.id}`),0)
                  return <td key={inv.id} style={{padding:'8px 12px',textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(scopeTotal+varTotal)}</td>
                })}
                <td style={{padding:'8px 12px',textAlign:'right',fontFamily:'var(--mono)',borderLeft:'2px solid rgba(255,255,255,0.2)'}}>
                  {fmt(
                    contractScopes.reduce((s,cs)=>s+sortedInvoices.reduce((ss,inv)=>ss+effectiveAmount(inv,cs),0),0) +
                    tceLines.filter(l=>l.source==='variation').reduce((s,vl)=>s+sortedInvoices.reduce((ss,inv)=>ss+effectiveAmount(inv,`__var__${vl.id}`),0),0)
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'8px',display:'flex',gap:'12px',flexWrap:'wrap'}}>
        <span><span style={{background:'rgba(220,252,231,0.6)',border:'1px solid #bbf7d0',padding:'1px 5px',borderRadius:'3px'}}>⚡ Green</span> = Auto-calculated from TCE actuals in period</span>
        <span><span style={{background:'#fefce8',border:'1px solid #fde68a',padding:'1px 5px',borderRadius:'3px'}}>✎ Yellow</span> = Manual override · Click any cell to set or clear</span>
      </div>

      {/* Invoice Modal */}
      {invModal&&(
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'480px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{invModal==='new'?'Add Invoice':`Edit: ${(invModal as NrgCustomerInvoice).label}`}</h3>
              <button className="btn btn-sm" onClick={()=>setInvModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>Label *</label><input className="input" value={invForm.label} onChange={e=>setInvForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Prepayment, Invoice 1, Final" autoFocus /></div>
                <div className="fg"><label>Invoice Number</label><input className="input" value={invForm.invoice_number} onChange={e=>setInvForm(f=>({...f,invoice_number:e.target.value}))} placeholder="INV-12345" /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Week Ending <span style={{fontWeight:400,color:'var(--text3)',fontSize:'11px'}}>period boundary</span></label><input type="date" className="input" value={invForm.week_ending} onChange={e=>setInvForm(f=>({...f,week_ending:e.target.value}))} /></div>
                <div className="fg"><label>Sent Date</label><input type="date" className="input" value={invForm.sent_date} onChange={e=>setInvForm(f=>({...f,sent_date:e.target.value}))} /></div>
                <div className="fg">
                  <label>EUR Spot Rate <span style={{fontWeight:400,color:'var(--text3)',fontSize:'11px'}}>€1 = $? AUD — gates SE AG labour in TCE &amp; actuals</span></label>
                  <input type="number" step="0.0001" min="0" className="input" value={invForm.eur_spot_rate} onChange={e=>setInvForm(f=>({...f,eur_spot_rate:e.target.value}))} placeholder="e.g. 1.6450" />
                  {invForm.eur_spot_rate && !isNaN(parseFloat(invForm.eur_spot_rate)) && (
                    <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px'}}>€100.00 = ${(parseFloat(invForm.eur_spot_rate)*100).toFixed(2)} AUD</div>
                  )}
                </div>
              </div>
              <div className="fg"><label>Notes</label><textarea className="input" rows={2} value={invForm.notes} onChange={e=>setInvForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}}/></div>
            </div>
            <div className="modal-footer">
              {invModal!=='new'&&<button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{deleteInvoice(invModal as NrgCustomerInvoice);setInvModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setInvModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveInvoice} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Grouping Rules Modal */}
      {rulesModal&&(
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'560px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>⚙ Grouping Rules</h3><button className="btn btn-sm" onClick={()=>setRulesModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>Contract scopes matched to groups by trigger substrings. First match wins.</p>
              {rulesForm.map((r,i)=>(
                <div key={i} className="fg-row" style={{alignItems:'flex-end'}}>
                  <div className="fg" style={{flex:2}}>{i===0&&<label>Group Name</label>}<input className="input" value={r.group_name} onChange={e=>setRulesForm(f=>f.map((x,j)=>j===i?{...x,group_name:e.target.value}:x))} placeholder="Group name"/></div>
                  <div className="fg" style={{flex:3}}>{i===0&&<label>Triggers (comma-separated)</label>}<input className="input" value={r.triggers_str} onChange={e=>setRulesForm(f=>f.map((x,j)=>j===i?{...x,triggers_str:e.target.value}:x))} placeholder="000001, /00001"/></div>
                  <button className="btn btn-sm" style={{color:'var(--red)',marginBottom:'0'}} onClick={()=>setRulesForm(f=>f.filter((_,j)=>j!==i))}>✕</button>
                </div>
              ))}
              <button className="btn btn-sm" style={{marginTop:'8px'}} onClick={()=>setRulesForm(f=>[...f,{group_name:'',triggers_str:''}])}>+ Add Rule</button>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setRulesModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRules} disabled={saving}>Save Rules</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cell Drill-down Modal ── */}
      {drillCell && (() => {
        const { inv, cs, fromWE, toWE } = drillCell
        const isGroupHeader = (id: string|null) => !!id && /^\d+\.\d+\.\d+$/.test(id||'')
        const allIds = tceLines.filter(l => l.contract_scope === cs && !isGroupHeader(l.item_id)).map(l => l.item_id).filter(Boolean) as string[]
        const isLabour = tceLines.some(l => l.contract_scope === cs && l.source === 'skilled')
        const isOverridden = inv.overrides?.[cs] !== undefined
        const calculatedAmount = calcPeriodAmount(inv, cs)
        const effectiveAmt = effectiveAmount(inv, cs)

        // Labour: aggregate weekly buckets across all item_ids in this scope, tracking EUR separately
        const labourWeekMap: Record<string, { sell: number; sellEur: number; rate: number | null }> = {}
        for (const id of allIds) {
          for (const [we, vals] of Object.entries(costLinesByItemAndWeek[id] || {})) {
            if (we > fromWE && we <= toWE) {
              if (!labourWeekMap[we]) labourWeekMap[we] = { sell: 0, sellEur: 0, rate: spotRateByWeek[we] ?? null }
              labourWeekMap[we].sell += vals.sell
              labourWeekMap[we].sellEur += vals.sellEur
            }
          }
        }
        const labourWeeks = Object.entries(labourWeekMap).sort(([a],[b]) => a.localeCompare(b))
        const hasEurWeeks = labourWeeks.some(([,v]) => v.sellEur > 0)
        const fmtEur = (n: number) => '€' + n.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})

        // Hours from raw cost lines across all item_ids
        const hoursWeeks = rawCostLines
          .filter(r => r.tce_item_id && allIds.includes(r.tce_item_id) && r.week_ending > fromWE && r.week_ending <= toWE)
          .reduce((acc, r) => { acc[r.week_ending] = (acc[r.week_ending] || 0) + r.allocated_hours; return acc }, {} as Record<string, number>)

        // Non-labour: supplier invoices across all item_ids
        const periodInvs = supplierInvoices
          .filter(i => allIds.includes(i.tce_item_id as string) && inPeriod((i.date_processed || i.invoice_date) as string, fromWE, toWE))

        // Non-labour: expenses across all item_ids
        const periodExps = expenseItems
          .filter(e => allIds.includes(e.tce_item_id as string) && inPeriod(e.date as string, fromWE, toWE))

        const fmtDate = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' }) : '—'
        const fmtWE   = (we: string) => `WE ${fmtDate(we)}`

        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDrillCell(null)}>
            <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3 style={{ margin: 0 }}>Cost Breakdown</h3>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {inv.label || inv.week_ending} · <span style={{ fontFamily: 'var(--mono)' }}>{cs}</span>
                    {fromWE && <span> · {fmtDate(fromWE)} → {fmtDate(toWE)}</span>}
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => setDrillCell(null)}>✕</button>
              </div>

              <div className="modal-body" style={{ padding: '16px 20px', maxHeight: '60vh', overflow: 'auto' }}>
                {labourWeeks.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>{isLabour ? 'Labour (approved timesheets)' : 'Timesheet Costs (approved)'}</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '5px 10px', textAlign: 'left', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Week</th>
                          <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Hours</th>
                          {hasEurWeeks && <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>SE AG (EUR)</th>}
                          {hasEurWeeks && <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Rate</th>}
                          <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Sell (AUD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {labourWeeks.map(([we, vals]) => {
                          const pending = vals.sellEur > 0 && vals.rate == null
                          const audSell = vals.sellEur > 0
                            ? (vals.rate != null ? vals.sellEur * vals.rate : null)
                            : vals.sell
                          return (
                          <tr key={we} style={{ borderBottom: '1px solid var(--border)', background: pending ? '#fff7f7' : undefined }}>
                            <td style={{ padding: '5px 10px' }}>{fmtWE(we)}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                              {(hoursWeeks[we] || 0).toFixed(2)}h
                            </td>
                            {hasEurWeeks && <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: vals.sellEur > 0 ? '#7c3aed' : 'var(--text3)' }}>
                              {vals.sellEur > 0 ? fmtEur(vals.sellEur) : '—'}
                            </td>}
                            {hasEurWeeks && <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11 }}>
                              {vals.sellEur > 0
                                ? (vals.rate != null ? <span style={{color:'#059669'}}>{vals.rate.toFixed(4)}</span> : <span style={{color:'#dc2626',fontWeight:600}}>pending</span>)
                                : '—'}
                            </td>}
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: pending ? '#dc2626' : undefined }}>
                              {audSell != null ? fmt(audSell) : <span style={{color:'#dc2626'}}>awaiting rate</span>}
                            </td>
                          </tr>
                        )})}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--bg2)', fontWeight: 700 }}>
                          <td style={{ padding: '5px 10px' }}>Total Labour</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                            {labourWeeks.reduce((s, [we]) => s + (hoursWeeks[we] || 0), 0).toFixed(2)}h
                          </td>
                          {hasEurWeeks && <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed' }}>
                            {fmtEur(labourWeeks.reduce((s,[,v]) => s + v.sellEur, 0))}
                          </td>}
                          {hasEurWeeks && <td/>}
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                            {labourWeeks.some(([,v]) => v.sellEur > 0 && v.rate == null)
                              ? <span style={{color:'#dc2626'}}>partial — rate(s) pending</span>
                              : fmt(labourWeeks.reduce((s,[,v]) => {
                                  if (v.sellEur > 0 && v.rate != null) return s + v.sellEur * v.rate
                                  return s + v.sell
                                }, 0))
                            }
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </>
                )}

                {periodInvs.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Supplier Invoices</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '5px 10px', textAlign: 'left', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Invoice #</th>
                          <th style={{ padding: '5px 10px', textAlign: 'left', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Description / Vendor</th>
                          <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Date</th>
                          <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodInvs.map((i, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{(i.invoice_number as string) || '—'}</td>
                            <td style={{ padding: '5px 10px', fontSize: 11 }}>{(i.invoice_number as string) || '—'}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, color: 'var(--text2)' }}>{fmtDate((i.date_processed || i.invoice_date) as string)}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmt((Number(i.sell_price) || 0) !== 0 ? Number(i.sell_price) : (Number(i.amount) || 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {periodExps.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Expenses</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '5px 10px', textAlign: 'left', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Ref / Category</th>
                          <th style={{ padding: '5px 10px', textAlign: 'left', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Description</th>
                          <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Date</th>
                          <th style={{ padding: '5px 10px', textAlign: 'right', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodExps.map((e, idx) => {
                          const sell = Number(e.sell_price) || Number(e.cost_ex_gst) || 0
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{(e.expense_ref as string) || (e.category as string) || '—'}</td>
                              <td style={{ padding: '5px 10px', fontSize: 11 }}>{(e.description as string) || (e.vendor as string) || '—'}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 11, color: 'var(--text2)' }}>{fmtDate(e.date as string)}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: sell < 0 ? 'var(--red)' : undefined }}>{fmt(sell)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )}

                {labourWeeks.length === 0 && periodInvs.length === 0 && periodExps.length === 0 && (
                  <div style={{ color: 'var(--text3)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>No cost data for this period.</div>
                )}

                {/* Total + override */}
                <div style={{ borderTop: '2px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Calculated total</span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15 }}>{fmt(calculatedAmount)}</span>
                  </div>
                  {isOverridden && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, color: '#d97706' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>✎ Overridden to</span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14 }}>{fmt(effectiveAmt)}</span>
                    </div>
                  )}
                  <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>MANUAL OVERRIDE <span style={{ fontWeight: 400 }}>(leave blank to use calculated)</span></div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input className="input" style={{ fontFamily: 'var(--mono)', maxWidth: 140 }}
                        value={overrideInput}
                        onChange={e => setOverrideInput(e.target.value)}
                        placeholder={fmt(calculatedAmount)} />
                      <button className="btn btn-sm" onClick={async () => {
                        await applyOverride(inv, cs, overrideInput)
                        setDrillCell(null)
                        load()
                      }}>Apply</button>
                      {isOverridden && (
                        <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={async () => {
                          await applyOverride(inv, cs, 'clear')
                          setDrillCell(null)
                          load()
                        }}>Clear override</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn" onClick={() => setDrillCell(null)}>Close</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
