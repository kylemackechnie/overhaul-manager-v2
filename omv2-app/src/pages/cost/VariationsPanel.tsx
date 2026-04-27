/**
 * Contract Variations Register
 * Full spec per OM_Variations_MIKA_Spec.docx
 * 
 * Key design rules:
 * - Line items live in variation_lines table (not line_items JSONB blob)
 * - Per-line WBS is CRITICAL for MIKA rollup — each line has its own wbs field
 * - tce_link stores TCE item_id TEXT (e.g. "2.02.8.34"), NOT UUID
 * - cost_total / sell_total on variation are computed sums, stored for fast querying
 * - Status workflow is controlled — not free-form
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Variation, VariationLine, NrgTceLine, RateCard } from '../../types'

const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  draft:     {bg:'#f1f5f9',color:'#64748b'},
  submitted: {bg:'#dbeafe',color:'#1e40af'},
  approved:  {bg:'#d1fae5',color:'#065f46'},
  rejected:  {bg:'#fee2e2',color:'#7f1d1d'},
}

const NEXT_STATUS: Record<string,string[]> = {
  draft:     ['submitted','rejected'],
  submitted: ['approved','rejected','draft'],
  approved:  [],
  rejected:  ['draft'],
}

const CAT_LABELS: Record<string,string> = {
  labour_trades:'Trades Labour', labour_mgmt:'Management Labour', labour_subcon:'Subcon Labour',
  materials:'Materials', equipment:'Equipment Hire', third_party:'Third Party Services', other:'Other',
}
const CAUSE_LABELS: Record<string,string> = {
  client_instruction:'Client Instruction', design_change:'Design Change',
  latent_condition:'Latent Condition', scope_omission:'Scope Omission',
  additional_scope:'Additional Scope', regulatory:'Regulatory', other:'Other',
}

type LineForm = {
  id: string; category: string; wbs: string; wbs_name: string
  description: string; qty: string; unit: string; unit_cost: string; unit_sell: string
  cost_total: number; sell_total: number
  // Labour-only fields
  role: string; hours: string; day_type: string; shift_type: string
  allowances: boolean
  // Breakdown for display
  breakdown?: { label: string; hrs: number | null; costRate: number; sellRate: number; costAmt: number; sellAmt: number; isAllowance?: boolean; shifts?: number }[]
}

const mkLine = (): LineForm => ({
  id: Math.random().toString(36).slice(2), category:'other', wbs:'', wbs_name:'',
  description:'', qty:'1', unit:'lump', unit_cost:'', unit_sell:'', cost_total:0, sell_total:0,
  role:'', hours:'', day_type:'weekday', shift_type:'day', allowances:true, breakdown:[],
})

const EMPTY_FORM = {
  number:'', title:'', status:'draft', cause:'', raised_date:'', scope:'',
  assumptions:'', exclusions:'', submitted_date:'', approved_date:'', customer_ref:'',
  notes:'', wo_ref:'', tce_link:'',
}

// Rate key buckets matching splitHours output
const BKTS = ['dnt','dt15','ddt','ddt15','nnt','ndt','ndt15'] as const
const BKT_LABELS: Record<string,string> = {
  dnt:'Normal Time', dt15:'Time & Half', ddt:'Double Time', ddt15:'DT+Half (PH)',
  nnt:'Night Normal', ndt:'Night DT', ndt15:'Night PH',
}

function splitHoursVn(
  totalHrs: number,
  dayType: string,
  shiftType: string,
  regime: 'lt12' | 'ge12',
  rc: RateCard
): Record<string, number> {
  const h = totalHrs
  const night = shiftType === 'night'
  const rcfg = (rc.regime || {}) as Record<string, number>
  const WD_NT   = rcfg.wdNT   ?? 7.2
  const WD_T15  = rcfg.wdT15  ?? 3.3
  const SAT_T15 = rcfg.satT15 ?? 3
  const NIGHT_NT = rcfg.nightNT ?? 7.2
  const zero = { dnt:0, dt15:0, ddt:0, ddt15:0, nnt:0, ndt:0, ndt15:0 }

  if (dayType === 'public_holiday') return night ? { ...zero, ndt15:h } : { ...zero, ddt15:h }
  if (dayType === 'rest' || dayType === 'travel') return night ? { ...zero, nnt:h } : { ...zero, dnt:h }

  if (night) {
    if (dayType === 'saturday' || dayType === 'sunday') return { ...zero, ndt:h }
    const nt = Math.min(h, NIGHT_NT), ddt = Math.max(0, h - NIGHT_NT)
    return { ...zero, nnt:nt, ndt:ddt }
  }

  if (dayType === 'saturday') {
    if (regime === 'lt12') { const t15 = Math.min(h, SAT_T15), ddt = Math.max(0, h - SAT_T15); return { ...zero, dt15:t15, ddt } }
    return { ...zero, ddt:h }
  }
  if (dayType === 'sunday') return { ...zero, ddt:h }

  // Weekday day
  if (regime === 'lt12') {
    const nt = Math.min(h, WD_NT), t15 = Math.min(Math.max(0, h - WD_NT), WD_T15), ddt = Math.max(0, h - WD_NT - WD_T15)
    return { ...zero, dnt:nt, dt15:t15, ddt }
  }
  const nt = Math.min(h, WD_NT), ddt = Math.max(0, h - WD_NT)
  return { ...zero, dnt:nt, ddt }
}

function computeLine(l: LineForm, gmPct: number, rateCards: RateCard[]): LineForm {
  if (l.category.startsWith('labour')) {
    const hours = parseFloat(l.hours) || 0
    const rc = rateCards.find(r => r.role.toLowerCase() === l.role.toLowerCase())
    if (rc && hours > 0) {
      const rates = rc.rates as { cost?: Record<string,number>; sell?: Record<string,number> }
      const costRates = rates.cost || {}
      const sellRates = rates.sell || {}

      // Standard shift hours — use 10.5 default (matched to HTML's stdH default)
      const shHrs = 10.5
      const regime: 'lt12' | 'ge12' = shHrs >= 12 ? 'ge12' : 'lt12'
      const fullShifts = Math.floor(hours / shHrs)
      const rem = +(hours % shHrs).toFixed(2)
      const nShifts = fullShifts + (rem > 0 ? 1 : 0)

      // Accumulate hour buckets across all shifts
      const buckets: Record<string, number> = {}
      const calcShift = (hrs: number) => {
        const sp = splitHoursVn(hrs, l.day_type || 'weekday', l.shift_type || 'day', regime, rc)
        for (const b of BKTS) { if (sp[b]) buckets[b] = (buckets[b] || 0) + sp[b] }
      }
      for (let s = 0; s < fullShifts; s++) calcShift(shHrs)
      if (rem > 0) calcShift(rem)

      let labCost = 0, labSell = 0
      const breakdown: LineForm['breakdown'] = []
      for (const b of BKTS) {
        if (buckets[b]) {
          const cr = costRates[b] || 0, sr = sellRates[b] || 0
          labCost += buckets[b] * cr; labSell += buckets[b] * sr
          breakdown!.push({ label: BKT_LABELS[b], hrs: +buckets[b].toFixed(2), costRate: cr, sellRate: sr, costAmt: +(buckets[b]*cr).toFixed(2), sellAmt: +(buckets[b]*sr).toFixed(2) })
        }
      }

      // Allowances (LAHA for trades, FSA for management)
      if (l.allowances !== false) {
        const isTrades = rc.category === 'trades' || l.category === 'labour_trades'
        const aC = isTrades ? (Number(rc.laha_cost) || 0) : (Number(rc.fsa_cost) || 0)
        const aS = isTrades ? (Number(rc.laha_sell) || 0) : (Number(rc.fsa_sell) || 0)
        if (aC || aS) {
          labCost += aC * nShifts; labSell += aS * nShifts
          breakdown!.push({ label: isTrades ? 'LAHA' : 'FSA', hrs: null, costRate: aC, sellRate: aS, costAmt: +(aC*nShifts).toFixed(2), sellAmt: +(aS*nShifts).toFixed(2), isAllowance: true, shifts: nShifts })
        }
      }

      return {
        ...l,
        unit_cost: String((costRates.dnt || 0).toFixed(2)),
        unit_sell: String((sellRates.dnt || 0).toFixed(2)),
        cost_total: +labCost.toFixed(2),
        sell_total: +labSell.toFixed(2),
        breakdown,
      }
    }
    // No rate card — manual entry
    const uc = parseFloat(l.unit_cost) || 0
    const us = parseFloat(l.unit_sell) || 0
    const cost_total = hours > 0 ? hours * uc : uc
    const sell_total = us > 0 ? (hours > 0 ? hours * us : us)
      : cost_total > 0 ? parseFloat((cost_total / (1 - gmPct/100)).toFixed(2)) : 0
    return { ...l, cost_total, sell_total, breakdown: [] }
  }
  const qty = parseFloat(l.qty) || 1
  const uc = parseFloat(l.unit_cost) || 0
  const us = parseFloat(l.unit_sell) || 0
  const cost_total = qty * uc
  const sell_total = us > 0 ? qty * us
    : cost_total > 0 ? parseFloat((cost_total / (1 - gmPct/100)).toFixed(2)) : 0
  return { ...l, cost_total, sell_total }
}

function printVariation(v: Variation, lines: VariationLine[], projectName: string, client: string) {
  const sc = STATUS_COLORS[v.status] || STATUS_COLORS.draft
  const catTotals: Record<string,{cost:number;sell:number}> = {}
  lines.forEach(l => {
    const c = l.category||'other'; if (!catTotals[c]) catTotals[c]={cost:0,sell:0}
    catTotals[c].cost += l.cost_total||0; catTotals[c].sell += l.sell_total||0
  })
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>VN ${v.number}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;padding:28px;color:#111}
h1{font-size:20px;color:#d97706}h2{font-size:12px;font-weight:700;color:#0369a1;text-transform:uppercase;border-bottom:2px solid #bae6fd;padding-bottom:4px;margin:16px 0 8px}
table{width:100%;border-collapse:collapse;margin-bottom:14px}th,td{padding:7px 10px;border:1px solid #e2e8f0;text-align:left}
th{background:#f8fafc;font-size:11px}.status{display:inline-block;padding:3px 12px;border-radius:12px;font-size:10px;font-weight:700;background:${sc.bg};color:${sc.color}}
.total-row td{background:#f0fdf4;font-weight:700}@media print{button{display:none}}</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px">
  <div><h1>Variation Notice — ${v.number}</h1><div style="color:#555;font-size:11px">${projectName}${client?' · '+client:''}</div></div>
  <div style="text-align:right"><span class="status">${v.status.toUpperCase()}</span>${v.customer_ref?`<div style="font-size:11px;margin-top:6px">Client Ref: <b>${v.customer_ref}</b></div>`:''}</div>
</div>
<h2 style="font-size:15px;text-transform:none;border-bottom:1px solid #e2e8f0;color:#111">${v.title}</h2>
${v.scope?`<h2>Scope</h2><p style="white-space:pre-wrap">${v.scope}</p>`:''}
<h2>Cost Summary</h2>
<table><thead><tr><th>Category</th><th style="text-align:right">Cost</th><th style="text-align:right">Variation Value</th></tr></thead>
<tbody>${Object.entries(catTotals).map(([cat,t])=>`<tr><td>${CAT_LABELS[cat]||cat}</td><td style="text-align:right;font-family:monospace">$${t.cost.toLocaleString('en-AU',{minimumFractionDigits:2})}</td><td style="text-align:right;font-family:monospace;font-weight:700">$${t.sell.toLocaleString('en-AU',{minimumFractionDigits:2})}</td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td>TOTAL</td><td style="text-align:right;font-family:monospace">$${lines.reduce((s,l)=>s+(l.cost_total||0),0).toLocaleString('en-AU',{minimumFractionDigits:2})}</td><td style="text-align:right;font-family:monospace">$${lines.reduce((s,l)=>s+(l.sell_total||0),0).toLocaleString('en-AU',{minimumFractionDigits:2})}</td></tr></tfoot></table>
${v.assumptions?`<h2>Assumptions</h2><p style="white-space:pre-wrap">${v.assumptions}</p>`:''}
${v.exclusions?`<h2>Exclusions</h2><p style="white-space:pre-wrap">${v.exclusions}</p>`:''}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:32px">
  <div><div style="border-bottom:1px solid #000;height:44px;margin-bottom:4px"></div><div style="font-size:11px">Authorised (Client) · Date: ___</div></div>
  <div><div style="border-bottom:1px solid #000;height:44px;margin-bottom:4px"></div><div style="font-size:11px">Prepared (SE) · Date: ___</div></div>
</div>
<script>setTimeout(()=>window.print(),400)<\/script></body></html>`
  const w = window.open('','_blank','width=900,height=800')
  if (w) { w.document.write(html); w.document.close() }
}

export function VariationsPanel() {
  const { activeProject } = useAppStore()
  const { canWrite } = usePermissions()
  const [variations, setVariations] = useState<Variation[]>([])
  const [variationLines, setVariationLines] = useState<Map<string, VariationLine[]>>(new Map())
  const [wbsList, setWbsList] = useState<{id:string;code:string;name:string}[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [tceLines, setTceLines] = useState<NrgTceLine[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Variation>(null)
  const [activeTab, setActiveTab] = useState<'details'|'lines'|'scope'>('details')
  const [form, setForm] = useState(EMPTY_FORM)
  const [lines, setLines] = useState<LineForm[]>([mkLine()])
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string|null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [varRes, linesRes, wbsRes, tceRes, rcRes] = await Promise.all([
      supabase.from('variations').select('*').eq('project_id', pid).order('number'),
      supabase.from('variation_lines').select('*').eq('project_id', pid),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('nrg_tce_lines').select('id,item_id,description,source').eq('project_id', pid)
        .order('item_id'),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
    ])
    const vars = (varRes.data||[]) as Variation[]
    const allLines = (linesRes.data||[]) as VariationLine[]
    const linesMap = new Map<string, VariationLine[]>()
    vars.forEach(v => linesMap.set(v.id, allLines.filter(l => l.variation_id === v.id)))
    setVariations(vars)
    setVariationLines(linesMap)
    setWbsList((wbsRes.data||[]) as {id:string;code:string;name:string}[])
    setTceLines((tceRes.data||[]) as NrgTceLine[])
    setRateCards((rcRes.data||[]) as RateCard[])
    setLoading(false)
  }

  const hasTce = tceLines.length > 0

  function printRegister() {
    const projectName = activeProject?.name || 'Project'
    const STATUS_LABELS: Record<string, string> = { draft:'Draft', submitted:'Submitted', approved:'Approved', rejected:'Rejected' }
    const STATUS_COLORS: Record<string, string> = { draft:'#94a3b8', submitted:'#f59e0b', approved:'#10b981', rejected:'#ef4444' }
    const fmt2 = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2 })
    const rows = variations.map(v => {
      const gm = v.sell_total > 0 ? ((v.sell_total - v.cost_total) / v.sell_total * 100) : 0
      const col = STATUS_COLORS[v.status] || '#94a3b8'
      return `<tr>
        <td class="mono">${v.number}</td>
        <td>${v.title}</td>
        <td style="text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;background:${col}22;color:${col}">${STATUS_LABELS[v.status] || v.status}</span></td>
        <td>${v.raised_date || '—'}</td>
        <td>${v.customer_ref || '—'}</td>
        <td class="num">${fmt2(v.cost_total || 0)}</td>
        <td class="num" style="color:#10b981;font-weight:600">${fmt2(v.sell_total || 0)}</td>
        <td class="num" style="color:${gm>=15?'#10b981':gm>=10?'#f59e0b':'#ef4444'}">${v.sell_total ? gm.toFixed(1)+'%' : '—'}</td>
      </tr>`
    }).join('')
    const totCost = variations.reduce((s,v) => s + (v.cost_total || 0), 0)
    const totSell = variations.reduce((s,v) => s + (v.sell_total || 0), 0)
    const totGm   = totSell > 0 ? (totSell - totCost) / totSell * 100 : 0
    const html = `<!DOCTYPE html><html><head><title>${projectName} — Variation Register</title>
    <style>body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:20px}
    h1{font-size:16px;margin-bottom:4px}p{color:#64748b;font-size:10px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th{background:#f8fafc;padding:6px 8px;text-align:left;font-size:10px;color:#64748b;border-bottom:2px solid #e2e8f0}
    td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
    .num{text-align:right;font-family:monospace}.mono{font-family:monospace;font-size:10px;font-weight:600}
    .total td{font-weight:700;background:#f0fdf4;border-top:2px solid #e2e8f0}
    @media print{@page{size:A4 landscape;margin:12mm}button{display:none}}</style></head>
    <body><h1>${projectName} — Variation Register</h1>
    <p>Printed ${new Date().toLocaleDateString('en-AU')} · ${variations.length} variations</p>
    <table><thead><tr><th>VN #</th><th>Title</th><th>Status</th><th>Raised</th><th>Client Ref</th><th style="text-align:right">Cost</th><th style="text-align:right">Sell</th><th style="text-align:right">GM%</th></tr></thead>
    <tbody>${rows}
    <tr class="total"><td colspan="5">TOTAL (${variations.length})</td><td class="num">${fmt2(totCost)}</td><td class="num">${fmt2(totSell)}</td><td class="num">${totSell?totGm.toFixed(1)+'%':'—'}</td></tr>
    </tbody></table><script>setTimeout(()=>window.print(),300)<\/script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function openNew() {
    const maxNum = variations.reduce((m,v) => Math.max(m, parseInt(String(v.number||'').replace(/\D/g,''))||0), 0)
    setForm({ ...EMPTY_FORM, number: `VN_${String(maxNum+1).padStart(3,'0')}` })
    setLines([mkLine()])
    setActiveTab('details')
    setModal('new')
  }

  function openEdit(v: Variation) {
    setForm({
      number:v.number, title:v.title, status:v.status,
      cause:v.cause||'', raised_date:v.raised_date||'', scope:v.scope||'',
      assumptions:v.assumptions||'', exclusions:v.exclusions||'',
      submitted_date:v.submitted_date||'', approved_date:v.approved_date||'',
      customer_ref:v.customer_ref||'', notes:v.notes||'',
      wo_ref:v.wo_ref||'', tce_link:v.tce_link||'',
    })
    const existingLines = variationLines.get(v.id) || []
    setLines(existingLines.length > 0
      ? existingLines.map(l => ({
          id:l.id, category:l.category, wbs:l.wbs, wbs_name:l.wbs_name,
          description:l.description, qty:String(l.qty??1), unit:l.unit||'lump',
          unit_cost:String(l.unit_cost??0), unit_sell:String(l.unit_sell??0),
          cost_total:l.cost_total, sell_total:l.sell_total,
          role:l.role||'', hours:String(l.hours||''),
          day_type:l.day_type||'weekday', shift_type:l.shift_type||'day',
          allowances: (l as unknown as LineForm).allowances !== false, breakdown:[],
        }))
      : [mkLine()])
    setActiveTab('details')
    setModal(v)
  }

  function setLineField(idx: number, field: keyof LineForm, value: string | boolean) {
    setLines(prev => {
      const updated = prev.map((l,i) => {
        if (i !== idx) return l
        const next = { ...l, [field]: value }
        return computeLine(next, activeProject?.default_gm||15, rateCards)
      })
      return updated
    })
  }

  async function transitionStatus(v: Variation, to: string) {
    const now = new Date().toISOString()
    const autoDate: Record<string,string> = {}
    if (to === 'submitted' && !v.submitted_date) autoDate.submitted_date = now.slice(0,10)
    if (to === 'approved' && !v.approved_date) autoDate.approved_date = now.slice(0,10)
    const history = [...(v.status_history||[]), { from:v.status, to, at:now, by:'' }]
    await supabase.from('variations').update({ status:to, status_history:history, ...autoDate }).eq('id',v.id)
    load()
  }

  const sumCost = (ls: LineForm[]) => ls.reduce((s,l)=>s+(l.cost_total||0),0)
  const sumSell = (ls: LineForm[]) => ls.reduce((s,l)=>s+(l.sell_total||0),0)
  const fmt = (n: number) => n>0 ? '$'+n.toLocaleString('en-AU',{maximumFractionDigits:0}) : '—'

  async function save() {
    if (!form.number.trim()) return toast('Variation number required','error')
    setSaving(true)

    const validLines = lines.filter(l => l.description.trim())
    const totalCost = sumCost(validLines)
    const totalSell = sumSell(validLines)

    const payload = {
      project_id: activeProject!.id, number:form.number.trim(), title:form.title.trim(),
      status:form.status, cause:form.cause, raised_date:form.raised_date||null,
      scope:form.scope, assumptions:form.assumptions, exclusions:form.exclusions,
      submitted_date:form.submitted_date||null, approved_date:form.approved_date||null,
      notes:form.notes, customer_ref:form.customer_ref,
      wo_ref:form.wo_ref,
      // CRITICAL: tce_link stores item_id text (e.g. "2.02.8.34"), never the UUID
      tce_link:form.tce_link,
      cost_total:totalCost, sell_total:totalSell,
      value:totalSell||null,
    }

    let varId: string
    const isNew = modal === 'new'
    if (isNew) {
      const { data, error } = await supabase.from('variations').insert(payload).select('id').single()
      if (error||!data) { toast(error?.message||'Insert failed','error'); setSaving(false); return }
      varId = data.id
    } else {
      varId = (modal as Variation).id
      const { error } = await supabase.from('variations').update(payload).eq('id',varId)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      // Delete existing lines before re-inserting
      await supabase.from('variation_lines').delete().eq('variation_id',varId)
    }

    // Insert lines into variation_lines table
    if (validLines.length > 0) {
      const lineInserts = validLines.map(l => {
        const wbsItem = wbsList.find(w => w.code === l.wbs)
        return {
          variation_id: varId, project_id: activeProject!.id,
          category: l.category, wbs: l.wbs,
          wbs_name: wbsItem?.name || l.wbs_name || '',
          description: l.description,
          qty: parseFloat(l.qty)||1, unit: l.unit||'lump',
          unit_cost: parseFloat(l.unit_cost)||0,
          unit_sell: parseFloat(l.unit_sell)||0,
          cost_total: l.cost_total, sell_total: l.sell_total,
          role: l.role||null,
          hours: parseFloat(l.hours)||null,
          day_type: l.day_type||null,
          shift_type: l.shift_type||null,
          breakdown: [],
        }
      })
      const { error: lineErr } = await supabase.from('variation_lines').insert(lineInserts)
      if (lineErr) { toast('Lines saved with error: '+lineErr.message,'error') }
    }

    toast(isNew?'Variation created':'Saved','success')

    // Handle "Create new TCE line for this VN" — spec Part 8
    // tce_link stores item_id text, auto-created line uses itemId = 'VN.' + number
    if (form.tce_link === 'create_new') {
      const newItemId = `VN.${form.number.trim()}`
      // Check it doesn't already exist
      const { data: existing } = await supabase.from('nrg_tce_lines')
        .select('id').eq('project_id', activeProject!.id).eq('item_id', newItemId).maybeSingle()
      if (!existing) {
        await supabase.from('nrg_tce_lines').insert({
          project_id: activeProject!.id,
          item_id: newItemId,
          source: 'overhead',
          description: form.title.trim(),
          work_order: form.wo_ref || '',
          contract_scope: '',
          unit_type: 'lump',
          estimated_qty: 1,
          tce_rate: totalSell || 0,
          tce_total: totalSell || 0,
          kpi_included: false,
          line_type: 'Variation',
          is_variation_line: true,
          wbs_code: '',
          category: '',
          forecast_enabled: false,
        })
      }
      // Update the variation to store the new item_id as tce_link
      await supabase.from('variations').update({ tce_link: newItemId }).eq('id', varId)
    }

    setSaving(false); setModal(null); load()
  }

  async function del(v: Variation) {
    if (!confirm(`Delete variation ${v.number}?`)) return
    // Cascade delete on variation_lines is set in DB, so just delete the variation
    await supabase.from('variations').delete().eq('id',v.id)
    toast('Deleted','info'); load()
  }

  function exportCSV() {
    const rows = [['VN #','Title','Status','Cause','Raised','Submitted','Approved','Cost','Sell']]
    variations.forEach(v => rows.push([
      v.number, v.title||'', v.status, v.cause||'',
      v.raised_date||'', v.submitted_date||'', v.approved_date||'',
      String(v.cost_total||0), String(v.sell_total||0),
    ]))
    const csv = rows.map(r=>r.map(c=>c.includes(',')?`"${c}"`:c).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `variations_${activeProject?.name||'project'}.csv`; a.click()
  }

  const totalApproved = variations.filter(v=>v.status==='approved').reduce((s,v)=>s+(v.sell_total||v.value||0),0)
  const totalSubmitted = variations.filter(v=>v.status==='submitted').reduce((s,v)=>s+(v.sell_total||v.value||0),0)

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Contract Variations</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {variations.length} variations · {fmt(totalApproved)} approved · {fmt(totalSubmitted)} pending
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={printRegister} disabled={variations.length===0}>🖨 Print Register</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-primary" disabled={!canWrite('cost_tracking')} onClick={openNew}>+ New Variation</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : variations.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📝</div><h3>No variations</h3>
          <p>Track contract variations and change orders here.</p>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {variations.map(v => {
            const sc = STATUS_COLORS[v.status]||STATUS_COLORS.draft
            const vLines = variationLines.get(v.id)||[]
            const sell = v.sell_total||v.value||0
            const cost = v.cost_total||0
            const isExpanded = expandedId === v.id
            const nextStatuses = NEXT_STATUS[v.status]||[]
            return (
              <div key={v.id} className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 16px',cursor:'pointer'}} onClick={()=>setExpandedId(isExpanded?null:v.id)}>
                  <span style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--accent)',minWidth:'80px'}}>{v.number}</span>
                  <span style={{flex:1,fontWeight:500}}>{v.title||'—'}</span>
                  {/* Status workflow buttons */}
                  <div style={{display:'flex',gap:'4px'}} onClick={e=>e.stopPropagation()}>
                    <span style={{...sc,padding:'2px 8px',borderRadius:'10px',fontSize:'10px',fontWeight:700}}>{v.status}</span>
                    {nextStatuses.map(ns => (
                      <button key={ns} className="btn btn-sm" style={{fontSize:'10px',padding:'2px 7px',
                        background:ns==='approved'?'#d1fae5':ns==='rejected'?'#fee2e2':ns==='submitted'?'#dbeafe':'var(--bg3)',
                        color:ns==='approved'?'#065f46':ns==='rejected'?'#7f1d1d':ns==='submitted'?'#1e40af':'var(--text2)'}}
                        onClick={()=>transitionStatus(v,ns)}
                        title={`Move to ${ns}`}>→ {ns}</button>
                    ))}
                  </div>
                  {sell > 0 && <span style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{fmt(sell)}</span>}
                  {cost > 0 && cost !== sell && <span style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>cost {fmt(cost)}</span>}
                  <span style={{fontSize:'12px',color:'var(--text3)'}}>{v.raised_date||'—'}</span>
                  <div style={{display:'flex',gap:'4px'}} onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={()=>{openEdit(v);setActiveTab('details')}}>Edit</button>
                    <button className="btn btn-sm" onClick={()=>printVariation(v,vLines,activeProject?.name||'',activeProject?.client||'')}>🖨</button>
                    <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={()=>del(v)}>✕</button>
                  </div>
                  <span style={{color:'var(--text3)',fontSize:'11px'}}>{isExpanded?'▲':'▼'}</span>
                </div>
                {isExpanded && (
                  <div style={{borderTop:'1px solid var(--border)',padding:'12px 16px',background:'var(--bg3)'}}>
                    {v.scope && <p style={{fontSize:'13px',color:'var(--text2)',marginBottom:'10px'}}>{v.scope}</p>}
                    {vLines.length > 0 ? (
                      <table style={{fontSize:'12px',width:'100%'}}>
                        <thead><tr><th>Category</th><th>Description</th><th>WBS</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Sell</th></tr></thead>
                        <tbody>
                          {vLines.map(l=>(
                            <tr key={l.id}>
                              <td style={{color:'var(--text3)',fontSize:'11px'}}>{CAT_LABELS[l.category]||l.category}</td>
                              <td>{l.description}</td>
                              <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.wbs||'—'}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(l.cost_total)}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(l.sell_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p style={{fontSize:'12px',color:'var(--text3)'}}>No cost lines</p>}
                    {v.notes && <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'8px',fontStyle:'italic'}}>{v.notes}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'780px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'New Variation':`Edit ${(modal as Variation).number}`}</h3>
              <div style={{display:'flex',gap:'6px'}}>
                {modal!=='new' && (
                  <button className="btn btn-sm"
                    onClick={()=>printVariation(modal as Variation, variationLines.get((modal as Variation).id)||[], activeProject?.name||'', activeProject?.client||'')}>
                    🖨 Print VN
                  </button>
                )}
                <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:'flex',gap:'0',borderBottom:'1px solid var(--border)',padding:'0 16px',background:'var(--bg3)'}}>
              {(['details','lines','scope'] as const).map(tab => (
                <button key={tab} onClick={()=>setActiveTab(tab)}
                  style={{padding:'8px 16px',fontSize:'12px',fontWeight:activeTab===tab?700:400,
                    borderBottom:activeTab===tab?'2px solid var(--accent)':'2px solid transparent',
                    background:'transparent',border:'none',cursor:'pointer',
                    color:activeTab===tab?'var(--accent)':'var(--text3)'}}>
                  {tab === 'details' ? 'Details' : tab === 'lines' ? `Cost Lines (${lines.filter(l=>l.description.trim()).length})` : 'Scope / Document'}
                </button>
              ))}
            </div>

            <div className="modal-body">
              {/* TAB: Details */}
              {activeTab === 'details' && (
                <>
                  <div className="fg-row">
                    <div className="fg"><label>VN Number *</label><input className="input" value={form.number} onChange={e=>setForm(f=>({...f,number:e.target.value}))} autoFocus /></div>
                    <div className="fg" style={{flex:2}}><label>Title</label><input className="input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Short description"/></div>
                  </div>
                  <div className="fg-row">
                    <div className="fg"><label>Cause</label>
                      <select className="input" value={form.cause} onChange={e=>setForm(f=>({...f,cause:e.target.value}))}>
                        <option value="">— Select —</option>
                        {Object.entries(CAUSE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div className="fg"><label>Customer Ref</label><input className="input" value={form.customer_ref} onChange={e=>setForm(f=>({...f,customer_ref:e.target.value}))} placeholder="Optional"/></div>
                  </div>
                  <div className="fg-row">
                    <div className="fg"><label>Raised</label><input type="date" className="input" value={form.raised_date} onChange={e=>setForm(f=>({...f,raised_date:e.target.value}))}/></div>
                    <div className="fg"><label>Submitted</label><input type="date" className="input" value={form.submitted_date} onChange={e=>setForm(f=>({...f,submitted_date:e.target.value}))}/></div>
                    <div className="fg"><label>Approved</label><input type="date" className="input" value={form.approved_date} onChange={e=>setForm(f=>({...f,approved_date:e.target.value}))}/></div>
                  </div>
                  {/* NRG TCE Section — only shown when project has TCE data */}
                  {hasTce && (
                    <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'6px',padding:'12px',marginTop:'8px'}}>
                      <div style={{fontSize:'11px',fontWeight:700,color:'#1e40af',marginBottom:'8px'}}>🔵 NRG TCE Integration</div>
                      <div className="fg-row">
                        <div className="fg">
                          <label>TCE Link <span style={{fontWeight:400,color:'#3b82f6',fontSize:'11px'}}>— stores item_id, not UUID</span></label>
                          <select className="input" value={form.tce_link} onChange={e=>setForm(f=>({...f,tce_link:e.target.value}))}>
                            <option value="">— No TCE Link —</option>
                            <option value="create_new">+ Create new TCE line for this VN</option>
                            {tceLines.filter(l=>l.item_id&&!isGroupHeader(l.item_id)).map(l=>(
                              <option key={l.id} value={l.item_id||''}>{l.item_id} — {l.description}</option>
                            ))}
                          </select>
                        </div>
                        <div className="fg"><label>Work Order Ref</label><input className="input" value={form.wo_ref} onChange={e=>setForm(f=>({...f,wo_ref:e.target.value}))} placeholder="e.g. 28243985-46"/></div>
                      </div>
                    </div>
                  )}
                  {/* Cost summary footer */}
                  {lines.some(l=>l.description.trim()) && (
                    <div style={{display:'flex',gap:'16px',padding:'10px 0',borderTop:'1px solid var(--border)',marginTop:'12px',fontSize:'12px'}}>
                      <span style={{color:'var(--text3)'}}>Total Cost: <strong>{fmt(sumCost(lines))}</strong></span>
                      <span style={{color:'var(--green)'}}>Total Sell: <strong>{fmt(sumSell(lines))}</strong></span>
                      {sumCost(lines)>0&&sumSell(lines)>0&&<span style={{color:'var(--text3)'}}>GM: <strong>{Math.round((1-sumCost(lines)/sumSell(lines))*100)}%</strong></span>}
                    </div>
                  )}
                </>
              )}

              {/* TAB: Cost Lines */}
              {activeTab === 'lines' && (
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
                    <p style={{fontSize:'12px',color:'var(--text3)'}}>Per-line WBS is required for MIKA rollup. Each line can map to a different WBS bucket.</p>
                    <button className="btn btn-sm" onClick={()=>setLines(l=>[...l,mkLine()])}>+ Add Line</button>
                  </div>
                  <table style={{fontSize:'12px',width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:'var(--bg3)'}}>
                        <th style={{padding:'6px 8px',textAlign:'left',width:'120px'}}>Category</th>
                        <th style={{padding:'6px 8px',textAlign:'left'}}>Description</th>
                        <th style={{padding:'6px 8px',width:'120px'}}>WBS</th>
                        <th style={{padding:'6px 8px',width:'140px',textAlign:'left'}}>Qty / Role</th>
                        <th style={{padding:'6px 8px',width:'70px',textAlign:'right'}}>Hrs / Cost</th>
                        <th style={{padding:'6px 8px',width:'90px',textAlign:'left'}}>Day Type</th>
                        <th style={{padding:'6px 8px',width:'70px',textAlign:'left'}}>Shift</th>
                        <th style={{padding:'6px 8px',width:'80px',textAlign:'right'}}>Cost $</th>
                        <th style={{padding:'6px 8px',width:'80px',textAlign:'right',color:'var(--green)'}}>Sell $</th>
                        <th style={{width:'28px'}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l,i)=>(
                        <><tr key={l.id} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={{padding:'3px 4px'}}>
                            <select className="input" style={{padding:'3px 5px',fontSize:'11px'}} value={l.category} onChange={e=>setLineField(i,'category',e.target.value)}>
                              {Object.entries(CAT_LABELS).map(([v,lbl])=><option key={v} value={v}>{lbl}</option>)}
                            </select>
                          </td>
                          <td style={{padding:'3px 4px'}}><input className="input" style={{padding:'3px 6px',fontSize:'12px'}} value={l.description} onChange={e=>setLineField(i,'description',e.target.value)} placeholder="Description"/></td>
                          <td style={{padding:'3px 4px'}}>
                            <select className="input" style={{padding:'3px 5px',fontSize:'11px'}} value={l.wbs} onChange={e=>setLineField(i,'wbs',e.target.value)}>
                              <option value="">— WBS —</option>
                              {wbsList.map(w=><option key={w.id} value={w.code}>{w.code}{w.name?' — '+w.name:''}</option>)}
                            </select>
                          </td>
                          {l.category.startsWith('labour') ? (
                            <>
                              {/* Role from rate card — triggers auto-calc */}
                              <td style={{padding:'3px 4px'}}>
                                <select className="input" style={{padding:'3px 5px',fontSize:'11px'}} value={l.role} onChange={e=>setLineField(i,'role',e.target.value)}>
                                  <option value="">— Role —</option>
                                  {rateCards.map(r=>(
                                    <option key={r.id} value={r.role}>{r.role}</option>
                                  ))}
                                  {rateCards.length === 0 && <option disabled>No rate cards</option>}
                                </select>
                              </td>
                              {/* Hours */}
                              <td style={{padding:'3px 4px'}}>
                                <input type="number" className="input" style={{padding:'3px 6px',fontSize:'12px',textAlign:'right'}} value={l.hours} onChange={e=>setLineField(i,'hours',e.target.value)} placeholder="hrs" min={0} step={0.5}/>
                              </td>
                              {/* Day type */}
                              <td style={{padding:'3px 4px'}}>
                                <select className="input" style={{padding:'3px 4px',fontSize:'11px'}} value={l.day_type||'weekday'} onChange={e=>setLineField(i,'day_type',e.target.value)}>
                                  {['weekday','saturday','sunday','public_holiday','travel','mob'].map(d=>(
                                    <option key={d} value={d}>{d.replace('_',' ')}</option>
                                  ))}
                                </select>
                              </td>
                              {/* Shift type */}
                              <td style={{padding:'3px 4px'}}>
                                <select className="input" style={{padding:'3px 4px',fontSize:'11px'}} value={l.shift_type||'day'} onChange={e=>setLineField(i,'shift_type',e.target.value)}>
                                  <option value="day">Day</option>
                                  <option value="night">Night</option>
                                </select>
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'3px 6px',fontSize:'12px',textAlign:'right'}} value={l.qty} onChange={e=>setLineField(i,'qty',e.target.value)} placeholder="1"/></td>
                              <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'3px 6px',fontSize:'12px',textAlign:'right'}} value={l.unit_cost||''} onChange={e=>setLineField(i,'unit_cost',e.target.value)} placeholder="0"/></td>
                              <td colSpan={2} style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'3px 6px',fontSize:'12px',textAlign:'right'}} value={l.unit_sell||''} onChange={e=>setLineField(i,'unit_sell',e.target.value)} placeholder="0"/></td>
                            </>
                          )}
                          <td style={{padding:'3px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text2)'}}>{l.cost_total>0?fmt(l.cost_total):'—'}</td>
                          <td style={{padding:'3px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)',fontWeight:600}}>{l.sell_total>0?fmt(l.sell_total):'—'}</td>
                          <td style={{padding:'3px 4px',textAlign:'center'}}>
                            <button className="btn btn-sm" style={{color:'var(--red)',padding:'2px 5px'}} onClick={()=>setLines(ls=>ls.filter((_,j)=>j!==i))}>✕</button>
                          </td>
                        </tr>
                        {/* Labour: allowances toggle + rate breakdown */}
                        {l.category.startsWith('labour') && (
                          <tr style={{borderBottom:'1px solid var(--border)',background:'var(--bg3)'}}>
                            <td colSpan={9} style={{padding:'6px 12px'}}>
                              <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'11px',cursor:'pointer',marginBottom: l.breakdown?.length ? '8px' : 0}}>
                                <input type="checkbox" checked={l.allowances !== false}
                                  onChange={e=>setLineField(i,'allowances',e.target.checked)} />
                                Include allowances (LAHA / FSA)
                                {l.role && !rateCards.find(r=>r.role.toLowerCase()===l.role.toLowerCase()) && (
                                  <span style={{color:'#d97706',marginLeft:'8px'}}>⚠ No rate card for this role</span>
                                )}
                              </label>
                              {l.breakdown && l.breakdown.length > 0 && (
                                <table style={{width:'auto',borderCollapse:'collapse',fontSize:'11px',background:'var(--bg2)',borderRadius:'4px',overflow:'hidden'}}>
                                  <thead>
                                    <tr style={{color:'var(--text3)'}}>
                                      <th style={{padding:'2px 8px',textAlign:'left',fontWeight:500}}>Rate Type</th>
                                      <th style={{padding:'2px 8px',textAlign:'right',fontWeight:500}}>Qty</th>
                                      <th style={{padding:'2px 8px',textAlign:'right',fontWeight:500}}>Sell Rate</th>
                                      <th style={{padding:'2px 8px',textAlign:'right',fontWeight:500}}>Sell $</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {l.breakdown.map((b,bi)=>(
                                      <tr key={bi} style={{borderTop:'1px solid var(--border)'}}>
                                        <td style={{padding:'2px 8px'}}>{b.label}</td>
                                        <td style={{padding:'2px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>
                                          {b.isAllowance ? `${b.shifts} shift${b.shifts!==1?'s':''}` : `${b.hrs}h`}
                                        </td>
                                        <td style={{padding:'2px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>
                                          {b.isAllowance ? '—' : fmt(b.sellRate)}
                                        </td>
                                        <td style={{padding:'2px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>
                                          {fmt(b.sellAmt)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                        </>
                      ))}
                    </tbody>
                    {lines.some(l=>l.description.trim()) && (
                      <tfoot>
                        <tr style={{background:'var(--bg3)',fontWeight:600}}>
                          <td colSpan={6} style={{padding:'7px 8px'}}>Total ({lines.filter(l=>l.description.trim()).length} lines)</td>
                          <td style={{padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(sumCost(lines))}</td>
                          <td style={{padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(sumSell(lines))}</td>
                          <td/>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {/* TAB: Scope / Document */}
              {activeTab === 'scope' && (
                <>
                  <div className="fg"><label>Scope of Works</label><textarea className="input" rows={4} value={form.scope} onChange={e=>setForm(f=>({...f,scope:e.target.value}))} placeholder="Describe the full scope of work..." style={{resize:'vertical'}}/></div>
                  <div className="fg"><label>Assumptions / Basis of Pricing</label><textarea className="input" rows={3} value={form.assumptions} onChange={e=>setForm(f=>({...f,assumptions:e.target.value}))} placeholder="List key assumptions..." style={{resize:'vertical'}}/></div>
                  <div className="fg"><label>Exclusions</label><textarea className="input" rows={2} value={form.exclusions} onChange={e=>setForm(f=>({...f,exclusions:e.target.value}))} placeholder="What is excluded from this variation..." style={{resize:'vertical'}}/></div>
                  <div className="fg"><label>Internal Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}}/></div>
                </>
              )}
            </div>

            <div className="modal-footer">
              {modal!=='new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as Variation);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function isGroupHeader(id: string|null|undefined): boolean {
  return !!id && /^\d+\.\d+\.\d+$/.test(id)
}
