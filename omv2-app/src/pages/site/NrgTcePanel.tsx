import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import { useAppStore } from '../../store/appStore'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import { SavedViewsBar } from '../../components/ui/SavedViewsBar'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { parseNrgTceFile } from '../../lib/nrgTceImport'
import { downloadTemplate } from '../../lib/templates'
import { nrgLineActual, nrgLineActualHours, nrgMatchAllocForLine, splitHours, calcHoursCost, type NrgTimesheet, type NrgInvoiceMin, type NrgExpenseMin, type NrgVariationMin } from '../../engines/costEngine'
import type { NrgTceLine, RateCard } from '../../types'

const SOURCES = ['overhead', 'skilled'] as const
const LINE_TYPES = ['', 'Labour', 'Equipment', 'Other', 'Fixed Price', 'Invoice / Receipt'] as const

// ── TCE column registry ───────────────────────────────────────────────────────
const TCE_COLS = [
  { id: 'item_id',        label: 'Item ID',        default: 80,  defaultVisible: true,  group: 'Identity' },
  { id: 'source',         label: 'Source',          default: 72,  defaultVisible: true,  group: 'Identity' },
  { id: 'description',    label: 'Description',     default: 220, defaultVisible: true,  group: 'Identity' },
  { id: 'work_order',     label: 'Work Order',      default: 90,  defaultVisible: true,  group: 'Scope' },
  { id: 'contract_scope', label: 'Contract Scope',  default: 100, defaultVisible: true,  group: 'Scope' },
  { id: 'unit',           label: 'Unit',            default: 56,  defaultVisible: true,  group: 'Estimates' },
  { id: 'est_qty',        label: 'Est. Qty',        default: 60,  defaultVisible: true,  group: 'Estimates' },
  { id: 'act_hrs',        label: 'Act. Hrs',        default: 60,  defaultVisible: true,  group: 'Estimates' },
  { id: 'tce_rate',       label: 'TCE Rate',        default: 74,  defaultVisible: true,  group: 'Financials' },
  { id: 'tce_total',      label: 'TCE Total',       default: 82,  defaultVisible: true,  group: 'Financials' },
  { id: 'committed',      label: 'Committed',       default: 82,  defaultVisible: true,  group: 'Financials' },
  { id: 'actual_cost',    label: 'Actual Cost',     default: 82,  defaultVisible: true,  group: 'Financials' },
  { id: 'kpi',            label: 'KPI',             default: 40,  defaultVisible: true,  group: 'Admin' },
  { id: 'line_type',      label: 'Type',            default: 110, defaultVisible: true,  group: 'Admin' },
  { id: 'wbs',            label: 'WBS',             default: 95,  defaultVisible: true,  group: 'Admin' },
  { id: 'actions',        label: '',                default: 60,  defaultVisible: true,  group: 'Admin' },
  // Optional — hidden by default, user can add
  { id: 'category',       label: 'Category',        default: 90,  defaultVisible: false, group: 'Identity' },
  { id: 'notes',          label: 'Notes',           default: 160, defaultVisible: false, group: 'Admin' },
] as const

type TceColId = typeof TCE_COLS[number]['id']
const TCE_COL_GROUPS = ['Identity', 'Scope', 'Estimates', 'Financials', 'Admin'] as const

const EMPTY = {
  wbs_code: '', description: '', category: '', source: 'overhead' as 'overhead' | 'skilled',
  tce_total: 0, item_id: '', work_order: '', contract_scope: '', line_type: '', kpi_included: false,
  unit_type: '', estimated_qty: 0, tce_rate: 0, details: {} as Record<string, unknown>
}

const isGroupHeader = (id: string | null | undefined, lineType?: string | null) => 
  (!!id && /^\d+\.\d+\.\d+$/.test(id)) || lineType === 'group'

const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })

export function NrgTcePanel() {
  const { activeProject } = useAppStore()
  const { prefs, setPref } = useUserPrefs()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])
  const [timesheets, setTimesheets] = useState<NrgTimesheet[]>([])
  const [invoices, setInvoices] = useState<NrgInvoiceMin[]>([])
  const [expenses, setExpenses] = useState<NrgExpenseMin[]>([])
  const [variations, setVariations] = useState<NrgVariationMin[]>([])
  const [pos, setPos] = useState<{id:string;tce_item_id:string|null;po_value:number|null;status:string}[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | NrgTceLine>(null)
  const [drillLine, setDrillLine] = useState<NrgTceLine | null>(null)
  const [drillType, setDrillType] = useState<'actual' | 'committed'>('actual')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, _setSourceFilter] = useState((prefs.tce_source_filter as string) || 'all')
  const [hideUnused, _setHideUnused] = useState((prefs.tce_hide_unused as boolean) ?? false)
  const [showWeekly, _setShowWeekly] = useState((prefs.tce_show_weekly as boolean) ?? false)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  function doTceSort(col: string) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  function setSourceFilter(v: string) { _setSourceFilter(v); setPref('tce_source_filter', v) }
  function setHideUnused(v: boolean)  { _setHideUnused(v);  setPref('tce_hide_unused', v) }
  function setShowWeekly(v: boolean)  { _setShowWeekly(v);  setPref('tce_show_weekly', v) }
  const [importing, setImporting] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkWbs, setBulkWbs] = useState('')
  const [bulkContract, setBulkContract] = useState('')


  // Resizable columns — fixed columns only (weekly date cols use fixed 80px)
  // Column visibility
  const [showColPicker, setShowColPicker] = useState(false)
  // Simpler approach: stored hidden list is the source of truth, initialised with defaults
  const tceHiddenStored = (prefs.hidden_cols as Record<string, string[]> | undefined)?.['nrg-tce']
  const tceHidden = new Set<string>(
    tceHiddenStored ?? TCE_COLS.filter(c => !c.defaultVisible).map(c => c.id)
  )
  function isTceVisible(id: TceColId) { return !tceHidden.has(id) }
  function setTceHidden(next: Set<string>) {
    const existing = (prefs.hidden_cols as Record<string, string[]> | undefined) ?? {}
    setPref('hidden_cols', { ...existing, 'nrg-tce': Array.from(next) })
  }

  // Resizable columns — ID-keyed
  // Order matches TCE_COLS. Checkbox col (idx 0) is separate.
  const TCE_COL_DEFAULTS = TCE_COLS.map(c => ({ id: c.id, default: c.default }))
  const { widths: cw, onResizeStart, thRef } = useResizableColumns('nrg-tce', TCE_COL_DEFAULTS)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [lRes, wbsRes, tsRes, invRes, expRes, varRes, rcRes, poRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('source').order('sort_order').order('item_id'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('weekly_timesheets').select('id,week_start,type,status,scope_tracking,regime,crew,allowances_tce_default,travel_tce_default')
        .eq('project_id', pid).eq('status', 'approved'),
      supabase.from('invoices').select('tce_item_id,amount,status').eq('project_id', pid),
      supabase.from('expenses').select('tce_item_id,cost_ex_gst,amount').eq('project_id', pid),
      supabase.from('variations').select('status,tce_link,sell_total').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('purchase_orders').select('id,tce_item_id,po_value,status').eq('project_id', pid),
    ])
    setLines((lRes.data || []) as NrgTceLine[])
    setWbsList((wbsRes.data || []) as { id: string; code: string; name: string }[])
    setPos((poRes.data || []) as {id:string;tce_item_id:string|null;po_value:number|null;status:string}[])
    setTimesheets((tsRes.data || []) as NrgTimesheet[])
    setInvoices((invRes.data || []) as NrgInvoiceMin[])
    setExpenses((expRes.data || []) as NrgExpenseMin[])
    setVariations((varRes.data || []) as NrgVariationMin[])
    setRateCards((rcRes.data || []) as RateCard[])
    setLoading(false)
  }

  const toggleCollapse = (id: string) =>
    setCollapsed(s => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns })

  /** Sum of open (non-cancelled, non-closed) PO values linked to this TCE line */
  function lineCommitted(itemId: string | null): number {
    if (!itemId) return 0
    return pos
      .filter(p => p.tce_item_id === itemId && p.status !== 'cancelled' && p.status !== 'closed')
      .reduce((s, p) => s + (p.po_value || 0), 0)
  }

  function lineActualCost(l: NrgTceLine): number {
    return nrgLineActual(
      { item_id: l.item_id, source: l.source, work_order: l.work_order || '', line_type: l.line_type || '', tce_total: l.tce_total || 0 },
      timesheets, invoices, expenses, variations,
      (role: string) => {
        const rc = rateCards.find(r => r.role.toLowerCase() === role.toLowerCase())
        return rc || null
      }
    )
  }

  async function applyBulkWbs() {
    if (!bulkWbs || selected.size === 0) return
    const { error } = await supabase.from('nrg_tce_lines').update({ wbs_code: bulkWbs }).in('id', [...selected])
    if (error) { toast(error.message, 'error'); return }
    toast(`WBS applied to ${selected.size} lines`, 'success')
    setSelected(new Set()); setBulkWbs(''); load()
  }

  async function applyBulkContract() {
    if (!bulkContract || selected.size === 0) return
    const { error } = await supabase.from('nrg_tce_lines').update({ contract_scope: bulkContract }).in('id', [...selected])
    if (error) { toast(error.message, 'error'); return }
    toast(`Contract scope applied to ${selected.size} lines`, 'success')
    setSelected(new Set()); setBulkContract(''); load()
  }

  async function setLineType(id: string, val: string) {
    await supabase.from('nrg_tce_lines').update({ line_type: val }).eq('id', id)
    setLines(ls => ls.map(l => l.id === id ? { ...l, line_type: val } : l))
  }

  async function clearAll() {
    if (!confirm('Clear ALL TCE lines? This cannot be undone.')) return
    await supabase.from('nrg_tce_lines').delete().eq('project_id', activeProject!.id)
    setLines([]); toast('Cleared', 'info')
  }

  function openNew() {
    const numericIds = lines.map(l => parseFloat(l.item_id || '0')).filter(n => !isNaN(n) && n > 0)
    const nextId = numericIds.length > 0 ? (Math.max(...numericIds) + 0.1).toFixed(1) : '1.0'
    setForm({ ...EMPTY, item_id: nextId }); setModal('new')
  }

  function openEdit(l: NrgTceLine) {
    setForm({
      wbs_code: l.wbs_code, description: l.description, category: l.category,
      source: l.source, tce_total: l.tce_total, item_id: l.item_id || '',
      details: l.details as Record<string, unknown>, work_order: l.work_order || '',
      contract_scope: l.contract_scope || '', line_type: l.line_type || '',
      kpi_included: !!l.kpi_included, unit_type: l.unit_type || '',
      estimated_qty: l.estimated_qty || 0, tce_rate: l.tce_rate || 0,
    })
    setModal(l)
  }

  async function save() {
    if (!form.description.trim() && !form.wbs_code.trim()) return toast('Description or WBS required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, wbs_code: form.wbs_code, description: form.description,
      category: form.category, source: form.source, tce_total: form.tce_total,
      item_id: form.item_id || null, work_order: form.work_order || '',
      contract_scope: form.contract_scope || '', line_type: form.line_type || '',
      kpi_included: form.kpi_included, unit_type: form.unit_type || '',
      estimated_qty: form.estimated_qty || 0, tce_rate: form.tce_rate || 0,
      notes: (form as typeof form & { notes?: string }).notes || '',
    }
    if (modal === 'new') {
      const { error } = await supabase.from('nrg_tce_lines').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('TCE line added', 'success')
    } else {
      const { error } = await supabase.from('nrg_tce_lines').update(payload).eq('id', (modal as NrgTceLine).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  function exportCSV() {
    const leafLines = lines.filter(l => !isGroupHeader(l.item_id, l.line_type))
    const rows: (string | number)[][] = [
      ['Item ID', 'Source', 'Description', 'Work Order', 'Contract Scope', 'Unit', 'Est Qty', 'Act Hrs', 'TCE Rate', 'TCE Total', 'Committed', 'Actual Cost', 'Remaining', '% Used', 'KPI', 'Type', 'WBS'],
    ]
    for (const l of leafLines) {
      const actHrs = nrgLineActualHours(
        { item_id: l.item_id, source: l.source, work_order: l.work_order, line_type: l.line_type },
        timesheets
      )
      const actual   = lineActualCost(l)
      const committed = lineCommitted(l.item_id)
      const tce      = l.tce_total || 0
      const remaining = tce - actual
      const pct      = tce > 0 ? ((actual / tce) * 100).toFixed(1) + '%' : '—'
      rows.push([
        l.item_id || '', l.source || '', l.description || '',
        l.work_order || '', l.contract_scope || '',
        l.unit_type || '',
        l.estimated_qty || 0,
        actHrs > 0 ? actHrs.toFixed(1) : 0,
        l.tce_rate || 0,
        tce,
        committed,
        actual,
        remaining,
        pct,
        l.kpi_included ? 'Yes' : 'No',
        l.line_type || '',
        l.wbs_code || '',
      ])
    }
    downloadCSV(rows, 'nrg_tce_' + (activeProject?.name || 'project'))
  }

  async function del(l: NrgTceLine) {
    if (!confirm(`Delete "${l.description}"?`)) return
    await supabase.from('nrg_tce_lines').delete().eq('id', l.id)
    toast('Deleted', 'info'); load()
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const existingIds = new Set(lines.map(l => l.item_id).filter(Boolean) as string[])
      const result = parseNrgTceFile(buffer, existingIds)
      if (result.errors.length > 0) { toast(result.errors[0], 'error'); setImporting(false); return }
      const pid = activeProject!.id
      if (result.added.length > 0) {
        const rows = result.added.map(l => ({
          project_id: pid, item_id: l.item_id, description: l.description, source: l.source,
          work_order: l.work_order || '', contract_scope: l.contract_scope || '',
          unit_type: l.unit_type || '', estimated_qty: l.estimated_qty || 0,
          tce_rate: l.tce_rate || 0, tce_total: l.tce_total || 0,
          kpi_included: l.kpi_included || false, line_type: l.line_type || '',
          wbs_code: '', category: '', forecast_enabled: true,
          sort_order: l.sort_order ?? 0,
          parent_id: l.parent_id ?? null,
        }))
        const { error } = await supabase.from('nrg_tce_lines').insert(rows)
        if (error) { toast(error.message, 'error'); setImporting(false); return }
      }
      let updatedCount = 0
      for (const { item_id, fields } of result.toUpdate) {
        const existing = lines.find(l => l.item_id === item_id); if (!existing) continue
        const patch: Record<string, unknown> = {}
        if (fields.work_order && !existing.work_order) patch.work_order = fields.work_order
        if (fields.contract_scope && !existing.contract_scope) patch.contract_scope = fields.contract_scope
        if (Object.keys(patch).length > 0) { await supabase.from('nrg_tce_lines').update(patch).eq('id', existing.id); updatedCount++ }
      }
      const parts: string[] = []
      if (result.added.length) parts.push(result.added.length + ' added')
      if (updatedCount) parts.push(updatedCount + ' back-filled')
      if (result.skipped) parts.push(result.skipped + ' unchanged')
      toast('TCE import: ' + parts.join(', '), 'success')
      load()
    } catch (e2) { toast((e2 as Error).message, 'error') }
    setImporting(false); e.target.value = ''
  }

  // Apply filters
  let filtered = lines
  if (sourceFilter === 'overhead') filtered = filtered.filter(l => l.source === 'overhead')
  else if (sourceFilter === 'skilled') filtered = filtered.filter(l => l.source === 'skilled')
  else if (sourceFilter === 'untyped') filtered = filtered.filter(l => !l.line_type)

  if (hideUnused) {
    // Hide skilled leaf rows with no contract scope (NRG convention: blank = unused scope)
    filtered = filtered.filter(l => {
      if (l.source !== 'skilled') return true
      if (isGroupHeader(l.item_id, l.line_type)) return true
      return !!l.contract_scope
    })
    // Drop group headers with no surviving children
    const liveLines = filtered.filter(l => !isGroupHeader(l.item_id, l.line_type))
    const liveIds = new Set(liveLines.map(l => l.item_id))
    const liveParents = new Set(liveLines.map(l => l.parent_id).filter(Boolean))
    filtered = filtered.filter(l => {
      if (!isGroupHeader(l.item_id, l.line_type)) return true
      // Has a child pointing to it via parent_id, OR has a child by prefix
      if (liveParents.has(l.item_id)) return true
      const prefix = (l.item_id || '') + '.'
      return [...liveIds].some((id: string | null) => (id || '').startsWith(prefix))
    })
  }

  if (search) {
    filtered = filtered.filter(l =>
      l.description.toLowerCase().includes(search.toLowerCase()) ||
      (l.wbs_code || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.item_id || '').includes(search) ||
      (l.work_order || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.contract_scope || '').toLowerCase().includes(search.toLowerCase())
    )
  }

  const visibleRows = filtered.filter(l => {
    if (isGroupHeader(l.item_id, l.line_type)) return true
    // Find parent: prefer parent_id match, fall back to prefix match
    const lp = l.parent_id
    const parent = lp
      ? filtered.find(p => isGroupHeader(p.item_id, p.line_type) && p.item_id === lp)
      : filtered.find(p => isGroupHeader(p.item_id, p.line_type) && (l.item_id || '').startsWith((p.item_id || '') + '.'))
    return !parent || !collapsed.has(parent.item_id || '')
  })

  // Sort: leaf lines sorted within their group, group headers stay in place
  const sortedVisible = (() => {
    if (!sortCol) return visibleRows
    const result: typeof visibleRows = []
    let i = 0
    while (i < visibleRows.length) {
      const row = visibleRows[i]
      if (isGroupHeader(row.item_id, row.line_type)) {
        // Collect this header + all its immediate leaf children
        result.push(row)
        i++
        const leaves: typeof visibleRows = []
        while (i < visibleRows.length && !isGroupHeader(visibleRows[i].item_id, visibleRows[i].line_type)) {
          leaves.push(visibleRows[i])
          i++
        }
        // Sort the leaves
        leaves.sort((a, b) => {
          let av: string | number = ''
          let bv: string | number = ''
          if (sortCol === 'item_id')     { av = a.item_id || ''; bv = b.item_id || '' }
          else if (sortCol === 'description') { av = a.description || ''; bv = b.description || '' }
          else if (sortCol === 'work_order')  { av = a.work_order || ''; bv = b.work_order || '' }
          else if (sortCol === 'tce_rate')    { av = a.tce_rate || 0; bv = b.tce_rate || 0 }
          else if (sortCol === 'tce_total')   { av = a.tce_total || 0; bv = b.tce_total || 0 }
          else if (sortCol === 'line_type')   { av = a.line_type || ''; bv = b.line_type || '' }
          else if (sortCol === 'wbs')         { av = a.wbs_code || ''; bv = b.wbs_code || '' }
          else if (sortCol === 'actual_cost') { av = lineActualCost(a); bv = lineActualCost(b) }
          const cmp = typeof av === 'number'
            ? (av as number) - (bv as number)
            : (av as string).localeCompare(bv as string)
          return sortAsc ? cmp : -cmp
        })
        result.push(...leaves)
      } else {
        // Top-level leaf (no group header parent) — just add
        result.push(row)
        i++
      }
    }
    return result
  })()
  const leafIds = filtered.filter(l => !isGroupHeader(l.item_id, l.line_type)).map(l => l.id)
  const allLeafSel = leafIds.length > 0 && leafIds.every(id => selected.has(id))
  const totalTce = filtered.filter(l => !isGroupHeader(l.item_id, l.line_type)).reduce((s, l) => s + (l.tce_total || 0), 0)

  // Get sorted unique week keys from timesheets for weekly columns
  const weekKeys = showWeekly
    ? [...new Set(timesheets.map(ts => ts.week_start))].sort()
    : []

  const sourceBadge = (src: string) => (
    <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
      background: src === 'skilled' ? '#dbeafe' : '#fef3c7',
      color: src === 'skilled' ? '#1d4ed8' : '#92400e' }}>
      {src === 'skilled' ? 'Skilled' : 'Overhead'}
    </span>
  )

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG TCE Register</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{lines.length} lines · Total {fmt(totalTce)}</p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={() => downloadTemplate('nrg_tce')}>⬇ Template</button>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {importing ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : '📥'} Import XLSX
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportFile} />
          </label>
          <button className="btn btn-sm" onClick={openNew}>＋ Add Line</button>
          <button className="btn btn-sm" onClick={() => setShowColPicker(true)} title="Show/hide columns">
            ⚙ Columns{tceHidden.size > TCE_COLS.filter(c => !c.defaultVisible).length ? ` (${tceHidden.size - TCE_COLS.filter(c => !c.defaultVisible).length} hidden)` : ''}
          </button>
          <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={clearAll}>🗑 Clear All</button>
        </div>
      </div>

      {/* Filters + toolbar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: '220px' }} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        {(['all', 'overhead', 'skilled', 'untyped'] as string[]).map(s => (
          <button key={s} className="btn btn-sm"
            style={{ background: sourceFilter === s ? 'var(--accent)' : 'var(--bg)', color: sourceFilter === s ? '#fff' : 'var(--text)' }}
            onClick={() => setSourceFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={hideUnused} onChange={e => setHideUnused(e.target.checked)} />
          Hide unused
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: showWeekly ? '#eff6ff' : 'var(--bg3)', cursor: 'pointer', color: showWeekly ? '#1d4ed8' : 'var(--text)' }}>
          <input type="checkbox" checked={showWeekly} onChange={e => setShowWeekly(e.target.checked)} />
          Show Weekly
        </label>
        {collapsed.size > 0 && (
          <button className="btn btn-sm" style={{ color: 'var(--text3)' }} onClick={() => setCollapsed(new Set())}>Expand All</button>
        )}
        <SavedViewsBar
          panelId="nrg-tce"
          currentFilters={{ sourceFilter, hideUnused, showWeekly }}
          onLoad={filters => {
            if (typeof filters.sourceFilter === 'string') setSourceFilter(filters.sourceFilter)
            if (typeof filters.hideUnused === 'boolean') setHideUnused(filters.hideUnused)
            if (typeof filters.showWeekly === 'boolean') setShowWeekly(filters.showWeekly)
          }}
        />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 12px', background: 'var(--bg3)', borderRadius: '6px', marginBottom: '10px', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>{selected.size} lines selected</span>
          {/* Bulk WBS */}
          <select className="input" style={{ width: '200px', fontSize: '12px' }} value={bulkWbs} onChange={e => setBulkWbs(e.target.value)}>
            <option value="">🏷 Assign WBS...</option>
            {wbsList.map(w => <option key={w.id} value={w.code}>{w.code}{w.name ? ' — ' + w.name : ''}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={applyBulkWbs} disabled={!bulkWbs}>Apply WBS</button>
          {/* Bulk Contract */}
          <input className="input" style={{ width: '180px', fontSize: '12px' }} placeholder="📑 Set Contract Scope..." value={bulkContract} onChange={e => setBulkContract(e.target.value)} />
          <button className="btn btn-sm btn-primary" onClick={applyBulkContract} disabled={!bulkContract}>Apply Contract</button>
          <button className="btn btn-sm" onClick={() => { setSelected(new Set()); setBulkWbs(''); setBulkContract('') }}>Clear</button>
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : filtered.length === 0 ? (
          <div className="empty-state"><div className="icon">📋</div><h3>No TCE lines</h3><p>Import from XLSX or add lines manually.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '12px', tableLayout: 'fixed', minWidth: '1100px' }}>
                <thead>
                  <tr>
                    <th ref={el => thRef(el, 0)} style={{ width: 28, textAlign: 'center' }}>
                      <input type="checkbox" checked={allLeafSel} onChange={e => setSelected(e.target.checked ? new Set(leafIds) : new Set())} />
                    </th>
                    {TCE_COLS.map((col, i) => {
                      if (!isTceVisible(col.id)) return null
                      const sortable = ['item_id','description','work_order','tce_rate','tce_total','actual_cost','line_type','wbs'].includes(col.id)
                      const alignMap: Record<string, 'right'|'center'|undefined> = {
                        est_qty: 'right', act_hrs: 'right', tce_rate: 'right',
                        tce_total: 'right', committed: 'right', actual_cost: 'right',
                      }
                      return (
                        <th key={col.id} ref={el => thRef(el, i + 1)} className="resizable"
                          style={{ width: cw[i + 1], textAlign: alignMap[col.id], cursor: sortable ? 'pointer' : undefined, userSelect: 'none' }}
                          onClick={sortable ? () => doTceSort(col.id) : undefined}>
                          {col.label}
                          {sortable && (
                            <span style={{ fontSize: '9px', marginLeft: '3px', color: sortCol === col.id ? 'var(--accent)' : 'var(--border2)' }}>
                              {sortCol === col.id ? (sortAsc ? '↑' : '↓') : '↕'}
                            </span>
                          )}
                          <div className="col-resizer" {...onResizeStart(i + 1)} />
                        </th>
                      )
                    })}
                    {showWeekly && weekKeys.map(wk => (
                      <th key={wk} style={{ width: 80, textAlign: 'right', fontSize: '10px', color: 'var(--text3)' }}>
                        {new Date(wk + 'T12:00:00').toLocaleDateString('en-AU', { day:'2-digit', month:'short' })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedVisible.map(l => {
                    const isHdr = isGroupHeader(l.item_id, l.line_type)
                    const isCol = isHdr && collapsed.has(l.item_id || '')
                    const isSel = !isHdr && selected.has(l.id)

                    if (isHdr) {
                      const children = filtered.filter(c => !isGroupHeader(c.item_id) && (c.item_id || '').startsWith((l.item_id || '') + '.'))
                      const groupTotal = children.reduce((s, c) => s + (c.tce_total || 0), 0)
                      const childCount = children.length
                      return (
                        <tr key={l.id} style={{ background: '#e0e7ff', color: '#3730a3', borderBottom: '1px solid #c7d2fe' }}>
                          <td></td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer' }}
                            onClick={() => toggleCollapse(l.item_id || '')}>
                            <span style={{ marginRight: '4px' }}>{isCol ? '▶' : '▼'}</span>
                            {l.item_id}
                            {isCol && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#6366f1' }}>({childCount} · {fmt(groupTotal)})</span>}
                          </td>
                          <td colSpan={Math.max(1, TCE_COLS.filter(c => isTceVisible(c.id) && ['source','description','work_order','contract_scope','unit','est_qty','act_hrs','tce_rate'].includes(c.id)).length)} style={{ fontWeight: 700, fontSize: '12px' }}>{l.description}</td>
                          {isTceVisible('tce_total') && <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px' }}>{groupTotal ? fmt(groupTotal) : '—'}</td>}
                          {isTceVisible('committed') && <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', color: '#1e40af' }}>{(() => {
                            const gc = children.reduce((s, ch) => s + lineCommitted(ch.item_id), 0)
                            return gc > 0 ? fmt(gc) : '—'
                          })()}</td>}
                          {isTceVisible('actual_cost') && <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', color: '#4f46e5' }}>{(() => {
                            const groupActual = children.reduce((s, c) => s + lineActualCost(c), 0)
                            return groupActual > 0 ? fmt(groupActual) : '—'
                          })()}</td>}
                          {isTceVisible('kpi') && <td></td>}
                          {isTceVisible('line_type') && <td></td>}
                          {isTceVisible('wbs') && <td></td>}
                          {isTceVisible('category') && <td></td>}
                          {isTceVisible('notes') && <td></td>}
                          {isTceVisible('actions') && <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px' }} onClick={() => openEdit(l)}>✏</button>
                            <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px', marginLeft: '3px', color: 'var(--red)' }} onClick={() => del(l)}>🗑</button>
                          </td>}
                        </tr>
                      )
                    }

                    return (
                      <tr key={l.id} style={{ background: isSel ? 'rgba(59,130,246,0.05)' : 'transparent' }}>
                        <td>
                          <input type="checkbox" checked={isSel} onChange={e => {
                            const ns = new Set(selected); e.target.checked ? ns.add(l.id) : ns.delete(l.id); setSelected(ns)
                          }} />
                        </td>
                        {isTceVisible('item_id') && <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', paddingLeft: '20px', color: 'var(--text3)' }}>{l.item_id || l.wbs_code || '—'}</td>}
                        {isTceVisible('source') && <td>{sourceBadge(l.source)}</td>}
                        {isTceVisible('description') && <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }} title={l.description}>{l.description || '—'}</td>}
                        {isTceVisible('work_order') && <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.work_order || '—'}</td>}
                        {isTceVisible('contract_scope') && <td style={{ fontSize: '11px', overflow: 'hidden' }}>{l.contract_scope ? <span style={{ background: '#ede9fe', color: '#6b21a8', borderRadius: '3px', padding: '1px 4px', fontSize: '10px' }}>{l.contract_scope}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>}
                        {isTceVisible('unit') && <td style={{ fontSize: '11px', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.unit_type || '—'}</td>}
                        {isTceVisible('est_qty') && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.estimated_qty ? l.estimated_qty.toLocaleString() : '—'}</td>}
                        {isTceVisible('act_hrs') && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{(() => {
                          const hrs = nrgLineActualHours({ item_id: l.item_id, source: l.source, work_order: l.work_order, line_type: l.line_type }, timesheets)
                          return hrs > 0 ? hrs.toFixed(1) : '—'
                        })()}</td>}
                        {isTceVisible('tce_rate') && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.tce_rate ? '$' + Number(l.tce_rate).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>}
                        {isTceVisible('tce_total') && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{l.tce_total ? fmt(l.tce_total) : '—'}</td>}
                        {isTceVisible('committed') && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#1e40af', cursor: lineCommitted(l.item_id) > 0 ? 'pointer' : undefined }}
                          onClick={lineCommitted(l.item_id) > 0 ? () => { setDrillLine(l); setDrillType('committed') } : undefined}
                          title={lineCommitted(l.item_id) > 0 ? 'Click to see POs' : undefined}>
                          {lineCommitted(l.item_id) > 0 ? <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{fmt(lineCommitted(l.item_id))}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>}
                        {isTceVisible('actual_cost') && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, cursor: lineActualCost(l) > 0 ? 'pointer' : undefined }}
                          onClick={lineActualCost(l) > 0 ? () => { setDrillLine(l); setDrillType('actual') } : undefined}
                          title={lineActualCost(l) > 0 ? 'Click to see breakdown' : undefined}>
                          {(() => { const actual = lineActualCost(l); const over = l.tce_total > 0 && actual > l.tce_total
                            return actual > 0 ? <span style={{ color: over ? 'var(--red)' : 'var(--green)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{fmt(actual)}</span> : <span style={{ color: 'var(--text3)' }}>—</span>
                          })()}
                        </td>}
                        {isTceVisible('kpi') && <td>{l.kpi_included ? <span style={{ fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '1px 5px', borderRadius: '3px' }}>KPI</span> : <span style={{ color: 'var(--text3)', fontSize: '11px' }}>—</span>}</td>}
                        {isTceVisible('line_type') && <td>
                          <select style={{ fontSize: '11px', padding: '2px 4px', height: '26px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', width: '100%' }}
                            value={l.line_type || ''} onChange={e => setLineType(l.id, e.target.value)}>
                            {LINE_TYPES.map(t => <option key={t} value={t}>{t || '— Set type —'}</option>)}
                          </select>
                        </td>}
                        {isTceVisible('wbs') && <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.wbs_code ? <span style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '3px', padding: '1px 4px' }}>{l.wbs_code}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>}
                        {isTceVisible('category') && <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{(l as NrgTceLine & {category?:string}).category || '—'}</td>}
                        {isTceVisible('notes') && <td style={{ fontSize: '11px', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={(l as NrgTceLine & {notes?:string}).notes || undefined}>{(l as NrgTceLine & {notes?:string}).notes || '—'}</td>}
                        {showWeekly && weekKeys.map(wk => {
                          // Weekly hours from approved TCE-mode timesheets for this line
                          const wkHrs = timesheets.filter(ts => ts.week_start === wk).reduce((s, ts) => {
                            for (const m of ts.crew) {
                              for (const day of Object.values(m.days)) {
                                const allocs = (day as {nrgWoAllocations?: {wo:string;tceItemId:string|null;hours:number}[]}).nrgWoAllocations || []
                                const match = nrgMatchAllocForLine(allocs, {
                                  item_id: l.item_id, source: l.source,
                                  work_order: l.work_order || '', line_type: l.line_type || ''
                                })
                                if (match) s += match.hours
                              }
                            }
                            return s
                          }, 0)
                          return (
                            <td key={wk} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '10px', color: wkHrs > 0 ? '#be185d' : 'var(--text3)' }}>
                              {wkHrs > 0 ? wkHrs.toFixed(1) + 'h' : '—'}
                            </td>
                          )
                        })}
                        {isTceVisible('actions') && <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px' }} onClick={() => openEdit(l)}>✏</button>
                          <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px', marginLeft: '3px', color: 'var(--red)' }} onClick={() => del(l)}>🗑</button>
                        </td>}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                    <td colSpan={Math.max(1, 1 + TCE_COLS.filter(c => isTceVisible(c.id) && ['item_id','source','description','work_order','contract_scope','unit','est_qty','act_hrs','tce_rate'].includes(c.id)).length)} style={{ padding: '8px 12px' }}>Total ({filtered.filter(l => !isGroupHeader(l.item_id, l.line_type)).length} lines)</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(totalTce)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--green)' }}>{(() => {
                      const tot = filtered.filter(l => !isGroupHeader(l.item_id, l.line_type)).reduce((s, l) => s + lineActualCost(l), 0)
                      return tot > 0 ? fmt(tot) : '—'
                    })()}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

      {/* Edit/Add Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add TCE Line' : 'Edit TCE Line'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>Item ID</label><input className="input" value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))} placeholder="e.g. 1.2.3" /></div>
                <div className="fg"><label>Source</label>
                  <select className="input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value as 'overhead' | 'skilled' }))}>
                    {SOURCES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} autoFocus /></div>
              <div className="fg-row">
                <div className="fg"><label>Work Order</label><input className="input" value={form.work_order} onChange={e => setForm(f => ({ ...f, work_order: e.target.value }))} /></div>
                <div className="fg"><label>Contract Scope</label><input className="input" value={form.contract_scope} onChange={e => setForm(f => ({ ...f, contract_scope: e.target.value }))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Unit Type</label><input className="input" value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))} placeholder="Hours, Days, Items..." /></div>
                <div className="fg"><label>Est. Qty</label><input type="number" className="input" value={form.estimated_qty || ''} onChange={e => setForm(f => ({ ...f, estimated_qty: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>TCE Rate ($)</label><input type="number" className="input" value={form.tce_rate || ''} onChange={e => setForm(f => ({ ...f, tce_rate: parseFloat(e.target.value) || 0 }))} /></div>
              </div>
              <div className="fg"><label>TCE Total ($)</label><input type="number" className="input" value={form.tce_total || ''} onChange={e => setForm(f => ({ ...f, tce_total: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="fg-row">
                <div className="fg"><label>WBS Code</label>
                  <select className="input" value={form.wbs_code} onChange={e => setForm(f => ({ ...f, wbs_code: e.target.value }))}>
                    <option value="">— No WBS —</option>
                    {wbsList.map(w => <option key={w.id} value={w.code}>{w.code}{w.name ? ' — ' + w.name : ''}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Line Type</label>
                  <select className="input" value={form.line_type} onChange={e => setForm(f => ({ ...f, line_type: e.target.value }))}>
                    {LINE_TYPES.map(t => <option key={t} value={t}>{t || '— Unset —'}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg" style={{ display: 'flex', alignItems: 'center', paddingTop: '4px' }}>
                <label style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.kpi_included} onChange={e => setForm(f => ({ ...f, kpi_included: e.target.checked }))} />
                  KPI Included
                </label>
              </div>
              <div className="fg" style={{ marginTop: '8px' }}>
                <label>Notes</label>
                <textarea className="input" rows={2}
                  value={(form as typeof form & { notes?: string }).notes || ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value } as typeof f))}
                  style={{ resize: 'vertical' }} placeholder="Optional notes for this TCE line" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column picker modal ───────────────────────────────────────────── */}
      {showColPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(3px)' }}
          onClick={() => setShowColPicker(false)}>
          <div style={{ background:'var(--bg2)', borderRadius:'12px', width:'440px', maxWidth:'95vw', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 50px rgba(0,0,0,0.35)', border:'1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:'15px' }}>TCE Register Columns</div>
                <div style={{ fontSize:'11px', color:'var(--text3)', marginTop:'2px' }}>Columns marked † are hidden by default</div>
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button className="btn btn-sm" onClick={() => { setTceHidden(new Set()); setShowColPicker(false) }}>Show All</button>
                <button className="btn btn-sm" onClick={() => setShowColPicker(false)}>Done</button>
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'12px 20px' }}>
              {TCE_COL_GROUPS.map(group => {
                const cols = TCE_COLS.filter(c => c.group === group && c.label)
                if (cols.length === 0) return null
                return (
                  <div key={group} style={{ marginBottom:'16px' }}>
                    <div style={{ fontSize:'10px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)', marginBottom:'8px' }}>{group}</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                      {cols.map(col => {
                        const visible = isTceVisible(col.id)
                        return (
                          <label key={col.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', borderRadius:'6px', background:visible?'rgba(99,102,241,0.1)':'var(--bg3)', border:`1px solid ${visible?'var(--accent)':'var(--border)'}`, cursor:'pointer', userSelect:'none' }}>
                            <input type="checkbox" checked={visible}
                              onChange={e => {
                                const next = new Set(tceHidden)
                                if (e.target.checked) next.delete(col.id)
                                else next.add(col.id)
                                setTceHidden(next)
                              }}
                              style={{ accentColor:'var(--accent)', width:'14px', height:'14px', flexShrink:0 }}
                            />
                            <span style={{ fontSize:'13px', fontWeight:visible?600:400, color:visible?'var(--text)':'var(--text3)' }}>
                              {col.label}{!col.defaultVisible ? ' †' : ''}
                            </span>
                            {visible && <span style={{ marginLeft:'auto', fontSize:'10px', color:'var(--accent)' }}>✓</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {/* ── Drill-down modal ─────────────────────────────────────────────── */}
      {drillLine && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(3px)' }}
          onClick={() => setDrillLine(null)}>
          <div style={{ background:'var(--bg2)', borderRadius:'12px', width:'640px', maxWidth:'95vw', maxHeight:'82vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 50px rgba(0,0,0,0.35)', border:'1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:'15px' }}>{drillLine.item_id} — {drillLine.description}</div>
                <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                  {(['actual','committed'] as const).map(t => (
                    <button key={t} onClick={() => setDrillType(t)} className="btn btn-sm"
                      style={{ background: drillType===t ? 'var(--accent)' : undefined, color: drillType===t ? '#fff' : undefined }}>
                      {t === 'actual' ? 'Actual Cost' : 'Committed (POs)'}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => setDrillLine(null)}>✕</button>
            </div>

            {/* Body */}
            <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
              {drillType === 'committed' && (() => {
                const linePOs = pos.filter(p => p.tce_item_id === drillLine.item_id && p.status !== 'cancelled' && p.status !== 'closed')
                return linePOs.length === 0
                  ? <div style={{ color:'var(--text3)', fontSize:'13px' }}>No POs committed to this line.</div>
                  : <table style={{ width:'100%', fontSize:'13px', borderCollapse:'collapse' }}>
                      <thead><tr style={{ borderBottom:'2px solid var(--border)' }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>PO</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Vendor</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'var(--text3)', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Status</th>
                        <th style={{ textAlign:'right', padding:'6px 8px', color:'var(--text3)', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Value</th>
                      </tr></thead>
                      <tbody>
                        {linePOs.map(p => (
                          <tr key={p.id} style={{ borderBottom:'1px solid var(--border)' }}>
                            <td style={{ padding:'8px' }}>{(p as unknown as Record<string,unknown>).po_number as string || p.id.slice(0,8)}</td>
                            <td style={{ padding:'8px', color:'var(--text2)' }}>{(p as unknown as Record<string,unknown>).vendor as string || '—'}</td>
                            <td style={{ padding:'8px' }}><span style={{ fontSize:'11px', fontWeight:600, padding:'2px 6px', borderRadius:'3px', background:'var(--bg3)' }}>{p.status}</span></td>
                            <td style={{ padding:'8px', textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'#1e40af' }}>{fmt(p.po_value || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr style={{ borderTop:'2px solid var(--border)', fontWeight:700 }}>
                        <td colSpan={3} style={{ padding:'8px' }}>Total ({linePOs.length})</td>
                        <td style={{ padding:'8px', textAlign:'right', fontFamily:'var(--mono)', color:'#1e40af' }}>{fmt(linePOs.reduce((s,p) => s + (p.po_value||0), 0))}</td>
                      </tr></tfoot>
                    </table>
              })()}

              {drillType === 'actual' && (() => {
                const isLabour = drillLine.line_type === 'Labour' || drillLine.source === 'skilled'
                const fmt2 = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

                if (isLabour) {
                  // Labour: show per-timesheet-week breakdown
                  type LabourRow = { weekStart: string; person: string; role: string; hours: number; cost: number }
                  const rows: LabourRow[] = []
                  for (const ts of timesheets) {
                    if (ts.status !== 'approved') continue
                    if (ts.scope_tracking !== 'tce' && ts.scope_tracking !== 'nrg_tce') continue
                    for (const member of ts.crew) {
                      let memberHours = 0; let memberCost = 0
                      const rc = rateCards.find(r => r.role.toLowerCase() === member.role.toLowerCase())
                      for (const [, day] of Object.entries(member.days)) {
                        if (!day.hours || day.hours <= 0) continue
                        const match = (day.nrgWoAllocations || []).find((a: NrgWoAlloc) =>
                          a.tceItemId === drillLine.item_id ||
                          (drillLine.work_order && a.wo === drillLine.work_order)
                        )
                        if (!match) continue
                        memberHours += match.hours || 0
                        if (rc) {
                          const adjH = ((member as unknown as {mealBreakAdj?:boolean}).mealBreakAdj && match.hours > 0) ? 0.5 : 0
                          const effH = (match.hours || 0) + adjH
                          const split = splitHours(effH, day.dayType || 'weekday', day.shiftType as 'day'|'night', rc.regime)
                          memberCost += calcHoursCost(split, rc, 'sell')
                        }
                      }
                      if (memberHours > 0) rows.push({ weekStart: ts.week_start, person: member.name, role: member.role, hours: memberHours, cost: memberCost })
                    }
                  }
                  if (!rows.length) return <div style={{ color:'var(--text3)', fontSize:'13px' }}>No approved timesheet allocations found.</div>
                  return <table style={{ width:'100%', fontSize:'13px', borderCollapse:'collapse' }}>
                    <thead><tr style={{ borderBottom:'2px solid var(--border)' }}>
                      {['Week','Person','Role','Hours','Cost'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Hours' || h === 'Cost' ? 'right' : 'left', padding:'6px 8px', color:'var(--text3)', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {rows.sort((a,b) => a.weekStart.localeCompare(b.weekStart) || a.person.localeCompare(b.person)).map((r,i) => (
                        <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>
                          <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text3)' }}>{new Date(r.weekStart+'T12:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short'})}</td>
                          <td style={{ padding:'7px 8px', fontWeight:500 }}>{r.person}</td>
                          <td style={{ padding:'7px 8px', color:'var(--text2)', fontSize:'12px' }}>{r.role}</td>
                          <td style={{ padding:'7px 8px', textAlign:'right', fontFamily:'var(--mono)' }}>{r.hours.toFixed(1)}h</td>
                          <td style={{ padding:'7px 8px', textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'var(--green)' }}>{fmt2(r.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ borderTop:'2px solid var(--border)', fontWeight:700 }}>
                      <td colSpan={3} style={{ padding:'8px' }}>Total</td>
                      <td style={{ padding:'8px', textAlign:'right', fontFamily:'var(--mono)' }}>{rows.reduce((s,r)=>s+r.hours,0).toFixed(1)}h</td>
                      <td style={{ padding:'8px', textAlign:'right', fontFamily:'var(--mono)', color:'var(--green)' }}>{fmt2(rows.reduce((s,r)=>s+r.cost,0))}</td>
                    </tr></tfoot>
                  </table>
                }

                // Non-labour: invoices + expenses + variations
                const lineInvoices = invoices.filter(i => i.tce_item_id === drillLine.item_id && i.status !== 'rejected')
                const lineExpenses = expenses.filter(e => e.tce_item_id === drillLine.item_id)
                const lineVariations = variations.filter(v => v.tce_link === drillLine.item_id && v.status === 'approved')
                const total = lineInvoices.reduce((s,i)=>s+(i.amount||0),0) + lineExpenses.reduce((s,e)=>s+(e.cost_ex_gst||e.amount||0),0) + lineVariations.reduce((s,v)=>s+(v.sell_total||0),0)

                if (!lineInvoices.length && !lineExpenses.length && !lineVariations.length)
                  return <div style={{ color:'var(--text3)', fontSize:'13px' }}>No invoices, expenses or variations allocated to this line.</div>

                return <table style={{ width:'100%', fontSize:'13px', borderCollapse:'collapse' }}>
                  <thead><tr style={{ borderBottom:'2px solid var(--border)' }}>
                    {['Source','Reference','Description','Date','Amount'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding:'6px 8px', color:'var(--text3)', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {lineInvoices.map((i, idx) => (
                      <tr key={idx} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'7px 8px' }}><span style={{ fontSize:'10px', background:'#dbeafe', color:'#1e40af', padding:'1px 5px', borderRadius:'3px', fontWeight:600 }}>Invoice</span></td>
                        <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px' }}>{(i as unknown as Record<string,unknown>).invoice_number as string || '—'}</td>
                        <td style={{ padding:'7px 8px', color:'var(--text2)', fontSize:'12px', maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(i as unknown as Record<string,unknown>).vendor_details as string || (i as unknown as Record<string,unknown>).vendor_ref as string || '—'}</td>
                        <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text3)' }}>{(i as unknown as Record<string,unknown>).invoice_date as string || '—'}</td>
                        <td style={{ padding:'7px 8px', textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'#1e40af' }}>{fmt(i.amount || 0)}</td>
                      </tr>
                    ))}
                    {lineExpenses.map((e, idx) => (
                      <tr key={idx} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'7px 8px' }}><span style={{ fontSize:'10px', background:'#fef3c7', color:'#92400e', padding:'1px 5px', borderRadius:'3px', fontWeight:600 }}>Expense</span></td>
                        <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px' }}>{(e as unknown as Record<string,unknown>).ref as string || '—'}</td>
                        <td style={{ padding:'7px 8px', color:'var(--text2)', fontSize:'12px', maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(e as unknown as Record<string,unknown>).description as string || (e as unknown as Record<string,unknown>).ref as string || '—'}</td>
                        <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text3)' }}>{e.date || '—'}</td>
                        <td style={{ padding:'7px 8px', textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'#d97706' }}>{fmt(e.cost_ex_gst || e.amount || 0)}</td>
                      </tr>
                    ))}
                    {lineVariations.map((v, idx) => (
                      <tr key={idx} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'7px 8px' }}><span style={{ fontSize:'10px', background:'#d1fae5', color:'#065f46', padding:'1px 5px', borderRadius:'3px', fontWeight:600 }}>Variation</span></td>
                        <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px' }}>{(v as unknown as Record<string,unknown>).ref as string || '—'}</td>
                        <td style={{ padding:'7px 8px', color:'var(--text2)', fontSize:'12px', maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(v as unknown as Record<string,unknown>).description as string || '—'}</td>
                        <td style={{ padding:'7px 8px', fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text3)' }}>{(v as unknown as Record<string,unknown>).approved_date as string || '—'}</td>
                        <td style={{ padding:'7px 8px', textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color:'#059669' }}>{fmt(v.sell_total || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ borderTop:'2px solid var(--border)', fontWeight:700 }}>
                    <td colSpan={4} style={{ padding:'8px' }}>Total</td>
                    <td style={{ padding:'8px', textAlign:'right', fontFamily:'var(--mono)', color:'var(--green)' }}>{fmt(total)}</td>
                  </tr></tfoot>
                </table>
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
