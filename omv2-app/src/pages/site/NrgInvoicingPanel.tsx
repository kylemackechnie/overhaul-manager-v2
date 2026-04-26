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
import { splitHours, calcHoursCost, getRateCardForRole } from '../../lib/calculations'
import type { NrgTceLine, NrgCustomerInvoice, NrgInvoiceGroupingRule } from '../../types'

const fmt = (n: number) => n === 0 ? '—' : '$' + Math.round(n).toLocaleString('en-AU')

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
  const [invForm, setInvForm] = useState({ label:'', invoice_number:'', week_ending:'', sent_date:'', notes:'' })
  const [rulesModal, setRulesModal] = useState(false)
  const [rulesForm, setRulesForm] = useState<{group_name:string;triggers_str:string}[]>([])
  // For period-bounded actuals
  const [timesheets, setTimesheets] = useState<Record<string,unknown>[]>([])
  const [supplierInvoices, setSupplierInvoices] = useState<Record<string,unknown>[]>([])
  const [expenseItems, setExpenseItems] = useState<Record<string,unknown>[]>([])
  const [rateCards, setRateCards] = useState<Record<string,unknown>[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [linesRes, invRes, rulesRes, tsRes, supInvRes, expRes, rcRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('item_id'),
      supabase.from('nrg_customer_invoices').select('*').eq('project_id', pid).order('week_ending'),
      supabase.from('nrg_invoice_grouping_rules').select('*').eq('project_id', pid).order('sort_order'),
      supabase.from('weekly_timesheets').select('week_start,type,regime,crew,scope_tracking').eq('project_id', pid).eq('status','approved'),
      supabase.from('invoices').select('tce_item_id,invoice_date,amount,status').eq('project_id', pid).neq('status','rejected'),
      supabase.from('expenses').select('tce_item_id,date,cost_ex_gst,amount').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
    ])
    setTceLines((linesRes.data||[]) as NrgTceLine[])
    setInvoices((invRes.data||[]) as NrgCustomerInvoice[])
    setTimesheets((tsRes.data||[]) as Record<string,unknown>[])
    setSupplierInvoices((supInvRes.data||[]) as Record<string,unknown>[])
    setExpenseItems((expRes.data||[]) as Record<string,unknown>[])
    setRateCards((rcRes.data||[]) as Record<string,unknown>[])
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

  // Period-bounded actual for a single TCE line — always uses SELL rates to match TCE register
  function lineActualInPeriod(line: NrgTceLine, fromWE: string, toWE: string): number {
    if (!toWE) return 0
    const isLabour = line.line_type === 'Labour' || line.source === 'skilled'
    if (isLabour) {
      let total = 0
      const pf = (v: unknown) => { const n = parseFloat(String(v || 0)); return isNaN(n) ? 0 : n }

      for (const ts of timesheets) {
        const wStart = ((ts.week_start as string)||'').slice(0,10)
        if (!wStart) continue
        // Week-ending = weekStart + 6 days
        const wEnd = new Date(wStart + 'T00:00:00')
        wEnd.setDate(wEnd.getDate() + 6)
        const wEndStr = wEnd.toISOString().slice(0,10)
        if (!inPeriod(wEndStr, fromWE, toWE)) continue
        const scopeTracking = ts.scope_tracking as string
        if (scopeTracking !== 'tce' && scopeTracking !== 'nrg_tce') continue
        const regime = ((ts.regime as string) || 'lt12') as 'lt12' | 'ge12'
        const crew = (ts.crew as Record<string,unknown>[]) || []

        for (const member of crew) {
          const rc = getRateCardForRole(member.role as string, rateCards as { role: string }[])
          if (!rc) continue
          const rcAny = rc as Record<string, unknown>
          const rates = rcAny.rates as { sell?: Record<string,number>; cost?: Record<string,number> } | null
          const isMgmt = rcAny.category === 'management' || rcAny.category === 'seag'
          const days = (member.days as Record<string, Record<string,unknown>>) || {}

          for (const day of Object.values(days)) {
            const allocs = (day.nrgWoAllocations as Record<string,unknown>[]) || []
            const match = allocs.find(a =>
              (a.tceItemId && a.tceItemId === line.item_id) ||
              (!a.tceItemId && line.work_order && a.wo === line.work_order)
            )
            if (!match) continue

            // Use allocated hours (may be partial if split across scopes)
            const allocHours = Number(match.hours) || 0
            if (!allocHours) continue

            // mealBreakAdj: +0.5h per worked day (EBA, trades only)
            const adjH = ((member.mealBreakAdj as boolean) && allocHours > 0 && !isMgmt) ? 0.5 : 0
            const effH = allocHours + adjH

            // Full split → sell using shared engine (matches TimesheetsPanel exactly)
            const dayType = (day.dayType as string) || 'weekday'
            const shiftType = ((day.shiftType as string) === 'night' ? 'night' : 'day') as 'day' | 'night'
            const regimeCfg = (rcAny.regime as Parameters<typeof splitHours>[4]) || null
            const split = splitHours(effH, dayType, shiftType, regime, regimeCfg)
            if (rates) total += calcHoursCost(split, rates, 'sell')

            // Allowances (sell): LAHA/Meal for trades/subcon, FSA/Camp for mgmt/seag
            if (isMgmt) {
              if (day.fsa)       total += pf(rcAny.fsa_sell)  || 183
              else if (day.camp) total += pf(rcAny.camp)       || 199
              else if (day.laha) total += pf(rcAny.fsa_sell)  || 183
            } else {
              if (day.laha) total += pf(rcAny.laha_sell) || 212
              if (day.meal) total += pf(rcAny.meal_sell) || 94
            }
          }
        }
      }
      return total
    }

    // Non-labour: supplier invoices + expenses in period (unchanged)
    let total = 0
    for (const inv of supplierInvoices) {
      if (inv.tce_item_id !== line.item_id) continue
      if (!inPeriod(inv.invoice_date as string, fromWE, toWE)) continue
      total += Number(inv.amount) || 0
    }
    for (const exp of expenseItems) {
      if (exp.tce_item_id !== line.item_id) continue
      if (!inPeriod(exp.date as string, fromWE, toWE)) continue
      const cost = Number(exp.cost_ex_gst)
      total += (!isNaN(cost) && cost > 0) ? cost : (Number(exp.amount) || 0)
    }
    return total
  }

  // Sum period-bounded actuals for a contract scope
  function calcPeriodAmount(inv: NrgCustomerInvoice, cs: string): number {
    const from = prevWE(inv.id)
    const to = inv.week_ending || ''
    if (!to) return 0
    const isGroupHeader = (id: string|null) => !!id && /^\d+\.\d+\.\d+$/.test(id||'')
    return tceLines
      .filter(l => l.contract_scope === cs && !isGroupHeader(l.item_id))
      .reduce((s, l) => s + lineActualInPeriod(l, from, to), 0)
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

  async function handleCellClick(inv: NrgCustomerInvoice, cs: string) {
    const cur = inv.overrides?.[cs]
    const input = window.prompt(
      `Override for ${cs} | ${inv.label||inv.week_ending||'Invoice'}\n(blank = calculated, "clear" = remove override)`,
      cur !== undefined ? String(cur) : ''
    )
    if (input === null) return
    const newOv = { ...(inv.overrides||{}) }
    if (input.trim().toLowerCase() === 'clear' || input.trim() === '') {
      delete newOv[cs]
    } else {
      const val = parseFloat(input.replace(/[^0-9.\-]/g,''))
      if (isNaN(val)) { toast('Invalid amount','error'); return }
      newOv[cs] = val
    }
    const { error } = await supabase.from('nrg_customer_invoices').update({ overrides: newOv }).eq('id', inv.id)
    if (error) { toast(error.message,'error'); return }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, overrides: newOv } : i))
  }

  function openNewInvoice() {
    setInvForm({ label:`Invoice ${sortedInvoices.length+1}`, invoice_number:'', week_ending:'', sent_date:'', notes:'' })
    setInvModal('new')
  }

  function openEditInvoice(inv: NrgCustomerInvoice) {
    setInvForm({ label:inv.label, invoice_number:inv.invoice_number, week_ending:inv.week_ending||'', sent_date:inv.sent_date||'', notes:inv.notes })
    setInvModal(inv)
  }

  async function saveInvoice() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, label: invForm.label.trim(),
      invoice_number: invForm.invoice_number.trim(),
      week_ending: invForm.week_ending||null, sent_date: invForm.sent_date||null,
      notes: invForm.notes, overrides: invModal!=='new' ? (invModal as NrgCustomerInvoice).overrides : {},
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

      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={{fontSize:'12px',minWidth:'700px',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'var(--bg3)'}}>
                <th style={{padding:'8px 12px',textAlign:'left',minWidth:'200px'}}>Contract Scope</th>
                {sortedInvoices.map(inv=>(
                  <th key={inv.id} style={{padding:'8px 12px',textAlign:'right',minWidth:'110px'}}>
                    <div style={{fontWeight:700}}>{inv.label||'Invoice'}</div>
                    <div style={{fontSize:'10px',color:'var(--text3)',fontWeight:400}}>{inv.week_ending?`WE ${inv.week_ending}`:'No period'}</div>
                    <div style={{display:'flex',gap:'3px',justifyContent:'flex-end',marginTop:'3px'}}>
                      <button className="btn btn-sm" style={{fontSize:'9px',padding:'1px 4px'}} onClick={()=>openEditInvoice(inv)}>✏</button>
                      <button className="btn btn-sm" style={{fontSize:'9px',padding:'1px 4px',color:'var(--red)'}} onClick={()=>deleteInvoice(inv)}>✕</button>
                    </div>
                  </th>
                ))}
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
                                background:isOv?'#fefce8':isCalc&&amount>0?'rgba(220,252,231,0.4)':'transparent',
                                color:amount>0?'var(--text)':'var(--text3)'}}>
                              {isOv&&<span style={{fontSize:'9px',color:'#d97706',marginRight:'3px'}}>✎</span>}
                              {isCalc&&amount>0&&<span style={{fontSize:'9px',color:'#15803d',marginRight:'3px'}}>⚡</span>}
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
            </tbody>
            <tfoot>
              <tr style={{background:'#1e3a5f',color:'#fff',fontWeight:700}}>
                <td style={{padding:'8px 12px'}}>GRAND TOTAL</td>
                {sortedInvoices.map(inv => {
                  const colTotal = contractScopes.reduce((s,cs)=>s+effectiveAmount(inv,cs),0)
                  return <td key={inv.id} style={{padding:'8px 12px',textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(colTotal)}</td>
                })}
                <td style={{padding:'8px 12px',textAlign:'right',fontFamily:'var(--mono)',borderLeft:'2px solid rgba(255,255,255,0.2)'}}>
                  {fmt(contractScopes.reduce((s,cs)=>s+sortedInvoices.reduce((ss,inv)=>ss+effectiveAmount(inv,cs),0),0))}
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
        <div className="modal-overlay" onClick={()=>setInvModal(null)}>
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
        <div className="modal-overlay" onClick={()=>setRulesModal(false)}>
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
    </div>
  )
}
