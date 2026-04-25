import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { parseNrgTceFile } from '../../lib/nrgTceImport'
import { downloadTemplate } from '../../lib/templates'
import type { NrgTceLine } from '../../types'

const SOURCES = ['overhead', 'skilled'] as const
const EMPTY = {
  wbs_code: '', description: '', category: '', source: 'overhead' as 'overhead' | 'skilled',
  tce_total: 0, item_id: '', work_order: '', contract_scope: '', line_type: '', kpi_included: false,
  details: {} as Record<string, unknown>
}
const isGroupHeader = (id: string | null | undefined) => !!id && /^\d+\.\d+\.\d+$/.test(id)

export function NrgTcePanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | NrgTceLine>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [importing, setImporting] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkWbs, setBulkWbs] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [lRes, wbsRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid).order('item_id'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
    ])
    setLines((lRes.data || []) as NrgTceLine[])
    setWbsList((wbsRes.data || []) as { id: string; code: string; name: string }[])
    setLoading(false)
  }

  const toggleCollapse = (id: string) =>
    setCollapsed(s => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns })

  async function applyBulkWbs() {
    if (!bulkWbs || selected.size === 0) return
    const { error } = await supabase.from('nrg_tce_lines').update({ wbs_code: bulkWbs }).in('id', [...selected])
    if (error) { toast(error.message, 'error'); return }
    toast(`WBS ${bulkWbs} applied to ${selected.size} lines`, 'success')
    setSelected(new Set()); setBulkWbs(''); load()
  }

  function openNew() {
    // Auto-increment item ID from highest existing numeric ID
    const numericIds = lines
      .map(l => parseFloat(l.item_id || '0'))
      .filter(n => !isNaN(n) && n > 0)
    const nextId = numericIds.length > 0
      ? (Math.max(...numericIds) + 0.1).toFixed(1)
      : '1.0'
    setForm({ ...EMPTY, item_id: nextId })
    setModal('new')
  }
  function openEdit(l: NrgTceLine) {
    setForm({
      wbs_code: l.wbs_code, description: l.description, category: l.category,
      source: l.source, tce_total: l.tce_total, item_id: l.item_id || '',
      details: l.details as Record<string, unknown>, work_order: l.work_order || '',
      contract_scope: l.contract_scope || '', line_type: l.line_type || '', kpi_included: !!l.kpi_included
    })
    setModal(l)
  }

  async function save() {
    if (!form.description.trim() && !form.wbs_code.trim()) return toast('Description or WBS required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, wbs_code: form.wbs_code, description: form.description,
      category: form.category, source: form.source, tce_total: form.tce_total,
      item_id: form.item_id || null, work_order: form.work_order || null,
      contract_scope: form.contract_scope || null, line_type: form.line_type || null,
      kpi_included: form.kpi_included
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
      [['Item ID', 'Description', 'Source', 'WBS', 'Work Order', 'Contract Scope', 'TCE Total'],
       ...lines.map(l => [l.item_id || '', l.description || '', l.source || '', l.wbs_code || '', l.work_order || '', l.contract_scope || '', l.tce_total || 0])],
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

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })

  const filtered = lines
    .filter(l => sourceFilter === 'all' || l.source === sourceFilter)
    .filter(l => !search || l.description.toLowerCase().includes(search.toLowerCase()) ||
      (l.wbs_code || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.item_id || '').includes(search))

  const totalTce = filtered.reduce((s, l) => s + (l.tce_total || 0), 0)

  const visibleRows = filtered.filter(l => {
    if (isGroupHeader(l.item_id)) return true
    const parent = filtered.find(p =>
      isGroupHeader(p.item_id) && (l.item_id || '').startsWith((p.item_id || '') + '.')
    )
    return !parent || !collapsed.has(parent.item_id || '')
  })

  const leafIds = filtered.filter(l => !isGroupHeader(l.item_id)).map(l => l.id)
  const allLeafSel = leafIds.length > 0 && leafIds.every(id => selected.has(id))

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG TCE Register</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{lines.length} lines · Total {fmt(totalTce)}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={() => downloadTemplate('nrg_tce')}>⬇ Template</button>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {importing ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : '📥'} Import XLSX
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportFile} />
          </label>
          <button className="btn btn-primary" onClick={openNew}>+ Add Line</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: '240px' }} placeholder="Search description, WBS, item ID..." value={search} onChange={e => setSearch(e.target.value)} />
        {(['all', 'overhead', 'skilled'] as string[]).map(s => (
          <button key={s} className="btn btn-sm"
            style={{ background: sourceFilter === s ? 'var(--accent)' : 'var(--bg)', color: sourceFilter === s ? '#fff' : 'var(--text)' }}
            onClick={() => setSourceFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        {collapsed.size > 0 && (
          <button className="btn btn-sm" style={{ color: 'var(--text3)' }} onClick={() => setCollapsed(new Set())}>Expand All</button>
        )}
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 12px', background: 'var(--bg3)', borderRadius: '6px', marginBottom: '10px', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>{selected.size} lines selected</span>
          <select className="input" style={{ width: '220px', fontSize: '12px' }} value={bulkWbs} onChange={e => setBulkWbs(e.target.value)}>
            <option value="">Assign WBS code...</option>
            {wbsList.map(w => <option key={w.id} value={w.code}>{w.code}{w.name ? ' — ' + w.name : ''}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={applyBulkWbs} disabled={!bulkWbs}>Apply</button>
          <button className="btn btn-sm" onClick={() => { setSelected(new Set()); setBulkWbs('') }}>Clear</button>
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : filtered.length === 0 ? (
          <div className="empty-state"><div className="icon">📋</div><h3>No TCE lines</h3><p>Import from XLSX or add lines manually.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '28px' }}>
                    <input type="checkbox" checked={allLeafSel} onChange={e => setSelected(e.target.checked ? new Set(leafIds) : new Set())} />
                  </th>
                  <th>Item ID</th>
                  <th>Description</th>
                  <th>Work Order</th>
                  <th>Source</th>
                  <th style={{ textAlign: 'right' }}>TCE Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(l => {
                  const isHdr = isGroupHeader(l.item_id)
                  const isCol = isHdr && collapsed.has(l.item_id || '')
                  const childTotal = isHdr ? filtered.filter(c => (c.item_id || '').startsWith((l.item_id || '') + '.')).reduce((s, c) => s + (c.tce_total || 0), 0) : 0
                  const childCount = isHdr ? filtered.filter(c => !isGroupHeader(c.item_id) && (c.item_id || '').startsWith((l.item_id || '') + '.')).length : 0
                  const isSel = !isHdr && selected.has(l.id)
                  return (
                    <tr key={l.id} style={{ background: isSel ? 'rgba(59,130,246,0.05)' : isHdr ? 'var(--bg3)' : 'transparent' }}>
                      <td>{!isHdr && <input type="checkbox" checked={isSel} onChange={e => { const ns = new Set(selected); e.target.checked ? ns.add(l.id) : ns.delete(l.id); setSelected(ns) }} />}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', cursor: isHdr ? 'pointer' : 'default', color: isHdr ? 'var(--accent)' : 'var(--text3)', userSelect: 'none' }}
                        onClick={isHdr ? () => toggleCollapse(l.item_id || '') : undefined}>
                        {isHdr && <span style={{ marginRight: '4px' }}>{isCol ? '▶' : '▼'}</span>}
                        {l.item_id || l.wbs_code || '—'}
                        {isHdr && isCol && <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--text3)' }}>({childCount} lines · {fmt(childTotal)})</span>}
                      </td>
                      <td style={{ fontWeight: isHdr ? 700 : 500, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: isHdr ? undefined : '20px' }}>
                        {l.description || '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{l.work_order || '—'}</td>
                      <td>
                        {!isHdr && <span className="badge" style={l.source === 'skilled' ? { bg: '#dbeafe', color: '#1e40af' } : { bg: '#f1f5f9', color: '#64748b' } as { bg: string; color: string }}>{l.source}</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>{l.tce_total ? fmt(l.tce_total) : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(l)}>Edit</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(l)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                  <td colSpan={5} style={{ padding: '8px 12px' }}>Total ({filtered.filter(l => !isGroupHeader(l.item_id)).length} lines)</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(totalTce)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
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
                <div className="fg"><label>WBS Code</label>
                  <select className="input" value={form.wbs_code} onChange={e => setForm(f => ({ ...f, wbs_code: e.target.value }))}>
                    <option value="">— No WBS —</option>
                    {wbsList.map(w => <option key={w.id} value={w.code}>{w.code}{w.name ? ' — ' + w.name : ''}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Category</label><input className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Mechanical" /></div>
              </div>
              <div className="fg"><label>TCE Total ($)</label><input type="number" className="input" value={form.tce_total || ''} onChange={e => setForm(f => ({ ...f, tce_total: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="fg-row">
                <div className="fg"><label>Work Order</label><input className="input" value={form.work_order} onChange={e => setForm(f => ({ ...f, work_order: e.target.value }))} /></div>
                <div className="fg"><label>Contract Scope</label><input className="input" value={form.contract_scope} onChange={e => setForm(f => ({ ...f, contract_scope: e.target.value }))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Line Type</label><input className="input" value={form.line_type} onChange={e => setForm(f => ({ ...f, line_type: e.target.value }))} placeholder="Labour, Materials, Overhead" /></div>
                <div className="fg" style={{ display: 'flex', alignItems: 'center', paddingTop: '20px' }}>
                  <label style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.kpi_included} onChange={e => setForm(f => ({ ...f, kpi_included: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} />
                    KPI Included
                  </label>
                </div>
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
