import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Resource { id: string; name: string; role: string; category: string; company: string; mob_in: string | null; mob_out: string | null; shift: string }
interface WBS { code: string; name: string; pm100: number | null }

export function PrePlanningReportPanel() {
  const { activeProject } = useAppStore()
  const [resources, setResources] = useState<Resource[]>([])
  const [wbsList, setWbsList] = useState<WBS[]>([])
  const [invoiceTotal, setInvoiceTotal] = useState(0)
  const [varCount, setVarCount] = useState(0)
  const [poCount, setPoCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState({ scope: '', objectives: '', agenda: '', risks: '', assumptions: '' })
  const [sections, setSections] = useState({ scope: true, resources: true, procurement: true, budget: true, agenda: true })
  const [showCosts, setShowCosts] = useState(true)
  const [showMargin, setShowMargin] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, wbsData, invData, varData, poData] = await Promise.all([
      supabase.from('resources').select('id,name,role,category,company,mob_in,mob_out,shift').eq('project_id', pid).order('mob_in'),
      supabase.from('wbs_list').select('code,name,pm100').eq('project_id', pid).order('sort_order'),
      supabase.from('invoices').select('amount').eq('project_id', pid),
      supabase.from('variations').select('id').eq('project_id', pid),
      supabase.from('purchase_orders').select('id').eq('project_id', pid),
    ])
    setResources((resData.data || []) as Resource[])
    setWbsList((wbsData.data || []) as WBS[])
    setInvoiceTotal((invData.data || []).reduce((s, i) => s + (i.amount || 0), 0))
    setVarCount(varData.data?.length || 0)
    setPoCount(poData.data?.length || 0)
    setLoading(false)
  }

  function applyPreset(preset: 'internal' | 'external' | 'scope') {
    if (preset === 'internal') { setSections({ scope: true, resources: true, procurement: true, budget: true, agenda: true }); setShowCosts(true); setShowMargin(true) }
    else if (preset === 'external') { setSections({ scope: true, resources: true, procurement: true, budget: true, agenda: true }); setShowCosts(false); setShowMargin(false) }
    else { setSections({ scope: true, resources: true, procurement: false, budget: false, agenda: true }); setShowCosts(false); setShowMargin(false) }
  }

  function print() {
    const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
    const resRows = resources.map(r => `<tr>
      <td>${r.name}</td><td>${r.role || '—'}</td><td>${r.company || '—'}</td>
      <td>${r.mob_in || '—'}</td><td>${r.mob_out || '—'}</td>
      <td>${r.shift || 'day'}</td>
      <td><span style="font-size:8px;padding:2px 5px;border-radius:3px;background:${r.category==='trades'?'#e0e7ff':'#dcfce7'};color:${r.category==='trades'?'#3730a3':'#15803d'}">${r.category}</span></td>
    </tr>`).join('')

    const wbsRows = wbsList.map(w => `<tr>
      <td style="font-family:monospace;font-size:9px;color:#64748b">${w.code}</td>
      <td>${w.name}</td>
      ${showCosts ? `<td style="text-align:right;font-family:monospace">${w.pm100 ? '$' + Math.round(w.pm100).toLocaleString() : '—'}</td>` : ''}
    </tr>`).join('')

    const pm100Total = wbsList.reduce((s, w) => s + (w.pm100 || 0), 0)

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Pre-Planning Report — ${activeProject?.name}</title>
<style>
  @page{size:A4 portrait;margin:14mm 16mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:10px;color:#0f172a;background:#fff}
  button{display:none}
  @media screen{body{padding:20px;max-width:900px;margin:0 auto}button{display:inline-block}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:3px solid #009999;margin-bottom:16px}
  .title{font-size:18px;font-weight:700;margin-bottom:3px}
  .meta{font-size:9px;color:#64748b;line-height:1.7;text-align:right}
  .section{margin-bottom:18px;page-break-inside:avoid}
  .section-title{font-size:12px;font-weight:700;color:#4f46e5;border-bottom:1.5px solid #e0e7ff;padding-bottom:4px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:4px}
  th{background:#f8fafc;padding:4px 6px;text-align:left;font-weight:700;border:1px solid #e2e8f0;font-size:8px;text-transform:uppercase;color:#475569}
  td{padding:3px 6px;border:1px solid #e2e8f0;vertical-align:top}
  .kpi-row{display:flex;gap:12px;margin-bottom:10px}
  .kpi-box{flex:1;border:1px solid #e2e8f0;border-radius:5px;padding:7px 10px}
  .kpi-val{font-size:14px;font-weight:700;font-family:monospace}
  .kpi-lbl{font-size:7.5px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
  .narrative{font-size:9.5px;color:#334155;line-height:1.6;margin-bottom:8px;white-space:pre-line}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:7.5px;color:#94a3b8;display:flex;justify-content:space-between}
</style></head><body>
<div class="header">
  <div>
    <div class="title">${activeProject?.name}</div>
    <div style="font-size:9px;color:#64748b;margin-top:2px">${activeProject?.client || ''} · ${activeProject?.start_date || ''} ${activeProject?.end_date ? '→ ' + activeProject.end_date : ''}</div>
    <div style="font-size:9px;color:#64748b">${activeProject?.wbs || ''}</div>
  </div>
  <div class="meta">
    <div style="font-size:13px;font-weight:700;color:#4f46e5">Pre-Planning Report</div>
    <div>Generated: ${today}</div>
    <div>${resources.length} people · ${poCount} POs · ${varCount} VNs</div>
  </div>
</div>

${sections.scope ? `<div class="section">
  <div class="section-title">Scope of Works</div>
  ${notes.scope ? `<div class="narrative">${notes.scope}</div>` : '<div style="color:#94a3b8;font-size:9px">No scope notes entered.</div>'}
  ${notes.objectives ? `<div style="margin-top:8px;font-weight:600;font-size:9px;margin-bottom:4px">Objectives</div><div class="narrative">${notes.objectives}</div>` : ''}
</div>` : ''}

${sections.resources ? `<div class="section">
  <div class="section-title">Personnel (${resources.length})</div>
  <table><thead><tr><th>Name</th><th>Role</th><th>Company</th><th>Mob In</th><th>Mob Out</th><th>Shift</th><th>Type</th></tr></thead>
  <tbody>${resRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">No resources added</td></tr>'}</tbody></table>
</div>` : ''}

${sections.procurement && showCosts ? `<div class="section">
  <div class="section-title">Procurement Summary</div>
  <div class="kpi-row">
    <div class="kpi-box"><div class="kpi-val" style="color:#0284c7">${poCount}</div><div class="kpi-lbl">Purchase Orders</div></div>
    <div class="kpi-box"><div class="kpi-val" style="color:#059669">$${Math.round(invoiceTotal).toLocaleString()}</div><div class="kpi-lbl">Invoiced to Date</div></div>
    <div class="kpi-box"><div class="kpi-val" style="color:#d97706">${varCount}</div><div class="kpi-lbl">Variations</div></div>
  </div>
</div>` : ''}

${sections.budget && wbsList.length > 0 ? `<div class="section">
  <div class="section-title">Budget (WBS)</div>
  <table><thead><tr><th>WBS Code</th><th>Description</th>${showCosts ? '<th style="text-align:right">PM100 Budget</th>' : ''}</tr></thead>
  <tbody>${wbsRows}</tbody>
  ${showCosts && pm100Total > 0 ? `<tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-family:monospace;font-weight:700">$${Math.round(pm100Total).toLocaleString()}</td></tr></tfoot>` : ''}
  </table>
</div>` : ''}

${notes.risks ? `<div class="section">
  <div class="section-title">Risks & Issues</div>
  <div class="narrative">${notes.risks}</div>
</div>` : ''}

${sections.agenda && notes.agenda ? `<div class="section">
  <div class="section-title">Meeting Agenda</div>
  <div class="narrative">${notes.agenda}</div>
</div>` : ''}

<div class="footer">
  <span>Overhaul Manager — CONFIDENTIAL</span>
  <span>${today}</span>
</div>
<script>setTimeout(()=>window.print(),400)<\/script>
</body></html>`

    const win = window.open('', '_blank', 'width=900,height=800')
    if (win) { win.document.write(html); win.document.close() }
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Pre-Planning Report</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Generate a meeting-ready summary of all project details</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => applyPreset('internal')}>📋 Internal Full</button>
          <button className="btn btn-sm" onClick={() => applyPreset('external')}>👤 External</button>
          <button className="btn btn-sm" onClick={() => applyPreset('scope')}>🗂 Scope Only</button>
          <button className="btn btn-sm" style={{ background: '#4f46e5', color: '#fff' }} onClick={print}>🖨 Print / Share</button>
        </div>
      </div>

      {/* Section toggles */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '10px' }}>Include Sections</div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {Object.entries({ scope: 'Scope of Works', resources: 'Personnel', procurement: 'Procurement', budget: 'Budget / WBS', agenda: 'Agenda' }).map(([k, lbl]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={sections[k as keyof typeof sections]} onChange={e => setSections(s => ({ ...s, [k]: e.target.checked }))} /> {lbl}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '16px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showCosts} onChange={e => setShowCosts(e.target.checked)} /> Show costs
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showMargin} onChange={e => setShowMargin(e.target.checked)} /> Show margins
          </label>
        </div>
      </div>

      {/* Notes fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[
          { key: 'scope', label: 'Scope of Works', rows: 4, placeholder: 'Describe the full scope of work for this project...' },
          { key: 'objectives', label: 'Key Objectives', rows: 3, placeholder: 'Bullet points or paragraph describing outage objectives...' },
          { key: 'risks', label: 'Risks & Issues', rows: 3, placeholder: 'Known risks, open issues, or areas requiring attention...' },
          { key: 'assumptions', label: 'Assumptions', rows: 2, placeholder: 'Key assumptions underpinning the plan...' },
          { key: 'agenda', label: 'Meeting Agenda', rows: 4, placeholder: 'e.g. 1. Safety Moment\n2. Project Overview\n3. Resources & Mobilisation\n4. Tooling & Parts\n5. Q&A' },
        ].map(f => (
          <div key={f.key} className="fg">
            <label>{f.label}</label>
            <textarea className="input" rows={f.rows} placeholder={f.placeholder} style={{ resize: 'vertical' }}
              value={notes[f.key as keyof typeof notes]}
              onChange={e => setNotes(n => ({ ...n, [f.key]: e.target.value }))} />
          </div>
        ))}
      </div>

      {/* Preview summary */}
      <div style={{ marginTop: '16px', padding: '12px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius)', fontSize: '12px', color: 'var(--text3)' }}>
        Report will include: {resources.length} personnel, {wbsList.length} WBS elements, {poCount} POs, {varCount} variations
      </div>
    </div>
  )
}
