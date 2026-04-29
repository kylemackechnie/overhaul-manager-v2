import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { parseNrgTceFile } from '../../lib/nrgTceImport'
import { downloadTemplate } from '../../lib/templates'
import { nrgLineActual, nrgLineActualHours, nrgMatchAllocForLine, type NrgTimesheet, type NrgInvoiceMin, type NrgExpenseMin, type NrgVariationMin } from '../../engines/costEngine'
import type { NrgTceLine, RateCard } from '../../types'

const SOURCES = ['overhead', 'skilled'] as const
const LINE_TYPES = ['', 'Labour', 'Equipment', 'Other', 'Fixed Price'] as const

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
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [hideUnused, setHideUnused] = useState(false)
  const [showWeekly, setShowWeekly] = useState(false)
  const [importing, setImporting] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkWbs, setBulkWbs] = useState('')
  const [bulkContract, setBulkContract] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [lRes, wbsRes, tsRes, invRes, expRes, varRes, rcRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('source').order('sort_order').order('item_id'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('weekly_timesheets').select('id,week_start,type,status,scope_tracking,regime,crew,allowances_tce_default,travel_tce_default')
        .eq('project_id', pid).eq('status', 'approved'),
      supabase.from('invoices').select('tce_item_id,amount,status').eq('project_id', pid),
      supabase.from('expenses').select('tce_item_id,cost_ex_gst,amount').eq('project_id', pid),
      supabase.from('variations').select('status,tce_link,sell_total').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
    ])
    setLines((lRes.data || []) as NrgTceLine[])
    setWbsList((wbsRes.data || []) as { id: string; code: string; name: string }[])
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
    downloadCSV(
      [['Item ID', 'Source', 'Description', 'Work Order', 'Contract Scope', 'Unit', 'Est Qty', 'TCE Rate', 'TCE Total', 'KPI', 'Type', 'WBS'],
       ...lines.map(l => [l.item_id || '', l.source || '', l.description || '', l.work_order || '', l.contract_scope || '', l.unit_type || '', l.estimated_qty || 0, l.tce_rate || 0, l.tce_total || 0, l.kpi_included ? 'Yes' : 'No', l.line_type || '', l.wbs_code || ''])],
      'nrg_tce_' + (activeProject?.name || 'project')
    )
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
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '12px', minWidth: '1100px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '28px' }}>
                      <input type="checkbox" checked={allLeafSel} onChange={e => setSelected(e.target.checked ? new Set(leafIds) : new Set())} />
                    </th>
                    <th style={{ width: '80px' }}>Item ID</th>
                    <th style={{ width: '72px' }}>Source</th>
                    <th>Description</th>
                    <th style={{ width: '90px' }}>Work Order</th>
                    <th style={{ width: '100px' }}>Contract Scope</th>
                    <th style={{ width: '56px' }}>Unit</th>
                    <th style={{ width: '60px', textAlign: 'right' }}>Est. Qty</th>
                    <th style={{ width: '60px', textAlign: 'right' }}>Act. Hrs</th>
                    <th style={{ width: '74px', textAlign: 'right' }}>TCE Rate</th>
                    <th style={{ width: '82px', textAlign: 'right' }}>TCE Total</th>
                    <th style={{ width: '82px', textAlign: 'right' }}>Committed</th>
                    <th style={{ width: '82px', textAlign: 'right' }}>Actual Cost</th>
                    <th style={{ width: '40px' }}>KPI</th>
                    <th style={{ width: '110px' }}>Type</th>
                    <th style={{ width: '95px' }}>WBS</th>
                    {showWeekly && weekKeys.map(wk => (
                      <th key={wk} style={{ width: '80px', textAlign: 'right', fontSize: '10px', color: 'var(--text3)' }}>
                        {new Date(wk + 'T12:00:00').toLocaleDateString('en-AU', { day:'2-digit', month:'short' })}
                      </th>
                    ))}
                    <th style={{ width: '60px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(l => {
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
                          <td colSpan={8} style={{ fontWeight: 700, fontSize: '12px' }}>{l.description}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px' }}>{groupTotal ? fmt(groupTotal) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', color: '#1e40af' }}>{(() => {
                            const gc = children.reduce((s, ch) => s + lineCommitted(ch.item_id), 0)
                            return gc > 0 ? fmt(gc) : '—'
                          })()}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', color: '#4f46e5' }}>{(() => {
                            const groupActual = children.reduce((s, c) => s + lineActualCost(c), 0)
                            return groupActual > 0 ? fmt(groupActual) : '—'
                          })()}</td>
                          <td colSpan={3}></td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px' }} onClick={() => openEdit(l)}>✏</button>
                            <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px', marginLeft: '3px', color: 'var(--red)' }} onClick={() => del(l)}>🗑</button>
                          </td>
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
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', paddingLeft: '20px', color: 'var(--text3)' }}>{l.item_id || l.wbs_code || '—'}</td>
                        <td>{sourceBadge(l.source)}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }} title={l.description}>
                          {l.description || '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)' }}>{l.work_order || '—'}</td>
                        <td style={{ fontSize: '11px' }}>
                          {l.contract_scope
                            ? <span style={{ background: '#ede9fe', color: '#6b21a8', borderRadius: '3px', padding: '1px 4px', fontSize: '10px' }}>{l.contract_scope}</span>
                            : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ fontSize: '11px', color: 'var(--text2)' }}>{l.unit_type || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.estimated_qty ? l.estimated_qty.toLocaleString() : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{(() => {
                          const hrs = nrgLineActualHours(
                            { item_id: l.item_id, source: l.source, work_order: l.work_order, line_type: l.line_type },
                            timesheets
                          )
                          return hrs > 0 ? hrs.toFixed(1) : '—'
                        })()}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.tce_rate ? '$' + Number(l.tce_rate).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{l.tce_total ? fmt(l.tce_total) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#1e40af' }}>{(() => {
                          const committed = lineCommitted(l.item_id)
                          return committed > 0 ? fmt(committed) : <span style={{ color: 'var(--text3)' }}>—</span>
                        })()}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{(() => {
                          const actual = lineActualCost(l)
                          const over = l.tce_total > 0 && actual > l.tce_total
                          return actual > 0
                            ? <span style={{ color: over ? 'var(--red)' : 'var(--green)' }}>{fmt(actual)}</span>
                            : <span style={{ color: 'var(--text3)' }}>—</span>
                        })()}</td>
                        <td>
                          {l.kpi_included
                            ? <span style={{ fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '1px 5px', borderRadius: '3px' }}>KPI</span>
                            : <span style={{ color: 'var(--text3)', fontSize: '11px' }}>—</span>}
                        </td>
                        <td>
                          <select style={{ fontSize: '11px', padding: '2px 4px', height: '26px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', width: '100%' }}
                            value={l.line_type || ''}
                            onChange={e => setLineType(l.id, e.target.value)}>
                            {LINE_TYPES.map(t => <option key={t} value={t}>{t || '— Set type —'}</option>)}
                          </select>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.wbs_code
                            ? <span style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '3px', padding: '1px 4px' }}>{l.wbs_code}</span>
                            : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
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
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px' }} onClick={() => openEdit(l)}>✏</button>
                          <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px', marginLeft: '3px', color: 'var(--red)' }} onClick={() => del(l)}>🗑</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                    <td colSpan={10} style={{ padding: '8px 12px' }}>Total ({filtered.filter(l => !isGroupHeader(l.item_id, l.line_type)).length} lines)</td>
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
    </div>
  )
}
