import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface SavedReport {
  id: string; project_id: string; title: string; type: string
  content: string; created_at: string; created_by: string
}

const REPORT_TYPES: Record<string, { icon: string; label: string }> = {
  cost_report: { icon: '📊', label: 'Cost Report' },
  variation_log: { icon: '📝', label: 'Variation Log' },
  timesheet_summary: { icon: '⏱', label: 'Timesheet Summary' },
  custom: { icon: '📄', label: 'Custom' },
}

export function ReportsDatabasePanel() {
  const { activeProject, currentUser } = useAppStore()
  const [reports, setReports] = useState<SavedReport[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewReport, setViewReport] = useState<SavedReport | null>(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState('custom')
  const [newContent, setNewContent] = useState('')
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('saved_reports')
      .select('*').eq('project_id', activeProject!.id)
      .order('created_at', { ascending: false })
    setReports((data || []) as SavedReport[])
    setLoading(false)
  }

  async function del(r: SavedReport) {
    if (!confirm(`Delete report "${r.title}"?`)) return
    await supabase.from('saved_reports').delete().eq('id', r.id)
    toast('Report deleted', 'info')
    load()
  }

  async function saveReport() {
    if (!newTitle.trim()) return toast('Title required', 'error')
    setSaving(true)
    const { error } = await supabase.from('saved_reports').insert({
      project_id: activeProject!.id,
      title: newTitle.trim(),
      type: newType,
      content: newContent,
      created_by: currentUser?.name || currentUser?.email || '',
    })
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast('Report saved', 'success')
    setSaving(false)
    setShowNew(false)
    setNewTitle(''); setNewContent(''); setNewType('custom')
    load()
  }

  async function snapshotCostReport() {
    setSaving(true)
    try {
      const pid = activeProject!.id
      const [wbsData, invData, tsData, hireData, varData] = await Promise.all([
        supabase.from('wbs_list').select('code,name,pm100').eq('project_id', pid).order('sort_order'),
        supabase.from('invoices').select('amount,status,invoice_number,vendor_ref').eq('project_id', pid),
        supabase.from('weekly_timesheets').select('crew').eq('project_id', pid),
        supabase.from('hire_items').select('hire_cost,name').eq('project_id', pid),
        supabase.from('variations').select('number,value,status').eq('project_id', pid),
      ])
      const invTotal = (invData.data || []).reduce((s: number, i: { amount: number }) => s + (i.amount || 0), 0)
      const hireTotal = (hireData.data || []).reduce((s: number, h: { hire_cost: number }) => s + (h.hire_cost || 0), 0)
      const tsHours = (tsData.data || []).reduce((s: number, t: { crew: { days?: Record<string, { hours?: number }> }[] }) => {
        return s + t.crew.reduce((cs, m) => cs + Object.values(m.days || {}).reduce((ds, d) => ds + (d.hours || 0), 0), 0)
      }, 0)
      const varApproved = (varData.data || []).filter((v: { status: string }) => v.status === 'approved').reduce((s: number, v: { value: number }) => s + (v.value || 0), 0)
      const snapshot = {
        generated: new Date().toISOString(),
        project: activeProject?.name,
        summary: { invoices: invTotal, hire: hireTotal, tsHours, variations_approved: varApproved },
        wbs: wbsData.data,
      }
      const { error } = await supabase.from('saved_reports').insert({
        project_id: pid,
        title: `Cost Snapshot — ${new Date().toLocaleDateString('en-AU')}`,
        type: 'cost_report',
        content: JSON.stringify(snapshot, null, 2),
        created_by: currentUser?.name || currentUser?.email || '',
      })
      if (error) throw error
      toast('Cost snapshot saved', 'success')
      load()
    } catch (e) { toast((e as Error).message, 'error') }
    setSaving(false)
  }

  const filtered = typeFilter === 'all' ? reports : reports.filter(r => r.type === typeFilter)
  const types = [...new Set(reports.map(r => r.type))]

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Reports Database</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{reports.length} saved reports</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={snapshotCostReport} disabled={saving}>📸 Snapshot Cost</button>
          <button className="btn btn-primary" onClick={() => setShowNew(s => !s)}>+ New Report</button>
        </div>
      </div>

      {/* New report form */}
      {showNew && (
        <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
          <div style={{ fontWeight: 600, marginBottom: '12px' }}>New Report</div>
          <div className="fg-row">
            <div className="fg" style={{ flex: 2 }}>
              <label>Title *</label>
              <input className="input" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Week 3 Progress Report" autoFocus />
            </div>
            <div className="fg">
              <label>Type</label>
              <select className="input" value={newType} onChange={e => setNewType(e.target.value)}>
                {Object.entries(REPORT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div className="fg">
            <label>Content</label>
            <textarea className="input" rows={6} value={newContent} onChange={e => setNewContent(e.target.value)}
              placeholder="Enter report content, notes, or paste data here..." style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: '12px' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button className="btn btn-primary" onClick={saveReport} disabled={saving}>{saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save Report</button>
            <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      {types.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          <button className="btn btn-sm" style={{ background: typeFilter === 'all' ? 'var(--accent)' : '', color: typeFilter === 'all' ? '#fff' : '' }} onClick={() => setTypeFilter('all')}>All</button>
          {types.map(t => <button key={t} className="btn btn-sm" style={{ background: typeFilter === t ? 'var(--accent)' : '', color: typeFilter === t ? '#fff' : '' }} onClick={() => setTypeFilter(t)}>{REPORT_TYPES[t]?.label || t}</button>)}
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📄</div>
          <h3>No reports yet</h3>
          <p>Save a cost snapshot, or create a custom report to build your project report library.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(r => {
            const typeInfo = REPORT_TYPES[r.type] || REPORT_TYPES.custom
            return (
              <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', cursor: 'pointer' }} onClick={() => setViewReport(r)}>
                <div style={{ fontSize: '24px', flexShrink: 0 }}>{typeInfo.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                    {typeInfo.label} · {new Date(r.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {r.created_by && ` · ${r.created_by}`}
                  </div>
                </div>
                <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={e => { e.stopPropagation(); del(r) }}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* View modal */}
      {viewReport && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{viewReport.title}</h3>
              <button className="btn btn-sm" onClick={() => setViewReport(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '12px' }}>
                {REPORT_TYPES[viewReport.type]?.label || viewReport.type} · {new Date(viewReport.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}
                {viewReport.created_by && ` · By ${viewReport.created_by}`}
              </div>
              <pre style={{ fontFamily: 'var(--mono)', fontSize: '11px', background: 'var(--bg3)', padding: '12px', borderRadius: '6px', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {viewReport.content}
              </pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(viewReport.content); toast('Copied', 'success') }}>📋 Copy</button>
              <button className="btn" onClick={() => setViewReport(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
