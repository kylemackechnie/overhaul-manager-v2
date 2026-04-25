import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface LabourRow { id: string; role: string; estDayShifts: number; estNightShifts: number; notes: string }
interface EquipRow { id: string; description: string; unit: string; estimatedDays: number; notes: string }
interface SavedRFQ { id: string; title: string; stage: string; deadline: string | null; created_at: string }

const mkId = () => Math.random().toString(36).slice(2, 8)
const mkLabour = (): LabourRow => ({ id: mkId(), role: '', estDayShifts: 0, estNightShifts: 0, notes: '' })
const mkEquip = (): EquipRow => ({ id: mkId(), description: '', unit: 'item', estimatedDays: 0, notes: '' })

export function SubconRFQDocPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [saved, setSaved] = useState<SavedRFQ[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [projectName, setProjectName] = useState('')
  const [site, setSite] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [deadline, setDeadline] = useState('')
  const [scope, setScope] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactRole, setContactRole] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [labour, setLabour] = useState<LabourRow[]>([mkLabour()])
  const [equip, setEquip] = useState<EquipRow[]>([mkEquip()])

  useEffect(() => {
    if (activeProject) {
      setProjectName(activeProject.name || '')
      setSite((activeProject as typeof activeProject & { site_name?: string }).site_name || '')
      loadSaved()
    }
  }, [activeProject?.id])

  async function loadSaved() {
    const { data } = await supabase.from('rfq_documents')
      .select('id,title,stage,deadline,created_at').eq('project_id', activeProject!.id).order('created_at', { ascending: false })
    setSaved((data || []) as SavedRFQ[])
  }

  function resetForm() {
    setEditId(null); setTitle(''); setScope(''); setDeadline(''); setStartDate(''); setEndDate('')
    setContactName(''); setContactRole(''); setContactEmail(''); setContactPhone(''); setNotes('')
    setLabour([mkLabour()]); setEquip([mkEquip()])
  }

  async function loadRFQ(id: string) {
    const { data } = await supabase.from('rfq_documents').select('*').eq('id', id).single()
    if (!data) return
    const d = data as Record<string, unknown>
    setEditId(id)
    setTitle(String(d.title || ''))
    setScope(String((d.scope as string) || ''))
    setDeadline(String(d.deadline || ''))
    setStartDate(String(d.start_date || ''))
    setEndDate(String(d.end_date || ''))
    setContactName(String((d.contact_name as string) || ''))
    setContactRole(String((d.contact_role as string) || ''))
    setContactEmail(String((d.contact_email as string) || ''))
    setContactPhone(String((d.contact_phone as string) || ''))
    setNotes(String(d.notes || ''))
    setLabour(((d.labour_rows as LabourRow[]) || [mkLabour()]))
    setEquip(((d.equip_rows as EquipRow[]) || [mkEquip()]))
  }

  async function saveRFQ() {
    if (!title.trim()) { toast('Title is required', 'error'); return }
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      title: title.trim(), scope, deadline: deadline || null,
      start_date: startDate || null, end_date: endDate || null,
      contact_name: contactName, contact_role: contactRole,
      contact_email: contactEmail, contact_phone: contactPhone,
      notes, labour_rows: labour, equip_rows: equip,
      stage: 'draft',
    }
    const { error } = editId
      ? await supabase.from('rfq_documents').update(payload).eq('id', editId)
      : await supabase.from('rfq_documents').insert(payload)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast('RFQ saved', 'success')
    setSaving(false)
    loadSaved()
  }

  async function deleteRFQ(id: string) {
    if (!confirm('Delete this RFQ?')) return
    await supabase.from('rfq_documents').delete().eq('id', id)
    if (editId === id) resetForm()
    loadSaved()
    toast('Deleted', 'success')
  }

  function printRFQ() {
    const fmtD = (s: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
    const labourRows = labour.filter(r => r.role).map(r => `
      <tr>
        <td>${r.role}</td>
        <td style="text-align:right">${r.estDayShifts || '—'}</td>
        <td style="text-align:right">${r.estNightShifts || '—'}</td>
        <td>${r.notes || ''}</td>
      </tr>`).join('')
    const equipRows = equip.filter(r => r.description).map(r => `
      <tr>
        <td>${r.description}</td>
        <td>${r.unit}</td>
        <td style="text-align:right">${r.estimatedDays || '—'}</td>
        <td>${r.notes || ''}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>RFQ — ${title}</title>
<style>
  @page{size:A4 portrait;margin:16mm}
  body{font-family:Arial,sans-serif;font-size:10px;color:#0f172a}
  button{display:none}
  h1{font-size:18px;font-weight:700;margin-bottom:3px}
  h2{font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;border-bottom:1.5px solid #e9d5ff;padding-bottom:4px;margin:14px 0 8px}
  .header{display:flex;justify-content:space-between;border-bottom:3px solid #7c3aed;padding-bottom:10px;margin-bottom:14px}
  .meta{font-size:9px;color:#64748b;line-height:1.8;text-align:right}
  table{width:100%;border-collapse:collapse;font-size:9px}
  th{background:#f5f3ff;padding:5px 8px;border:1px solid #e9d5ff;text-align:left;font-size:8px;text-transform:uppercase;color:#6b21a8}
  td{padding:4px 8px;border:1px solid #e9d5ff;vertical-align:top}
  .narrative{font-size:10px;color:#334155;line-height:1.6;white-space:pre-line}
  .kv{display:grid;grid-template-columns:120px 1fr;gap:4px 16px;font-size:10px;margin-bottom:8px}
  .kv .k{color:#64748b;font-weight:600}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8;display:flex;justify-content:space-between}
  @media screen{body{max-width:900px;margin:0 auto;padding:24px}button{display:inline-block}}
</style></head><body>
<div class="header">
  <div>
    <div style="font-size:16px;font-weight:700;color:#7c3aed">Request for Quotation</div>
    <h1 style="font-size:14px;margin-top:4px">${title}</h1>
    <div style="font-size:9px;color:#64748b">${projectName}${site ? ' · ' + site : ''}</div>
  </div>
  <div class="meta">
    <div style="font-size:12px;font-weight:700;color:#7c3aed">CONFIDENTIAL</div>
    <div>Issued: ${new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
    ${deadline ? `<div style="font-weight:600;color:#dc2626">Response by: ${fmtD(deadline)}</div>` : ''}
  </div>
</div>

<h2>Project & Scope Details</h2>
<div class="kv">
  <span class="k">Project</span><span>${projectName}</span>
  ${site ? `<span class="k">Site</span><span>${site}</span>` : ''}
  ${startDate ? `<span class="k">Scope Period</span><span>${fmtD(startDate)}${endDate ? ' → ' + fmtD(endDate) : ''}</span>` : ''}
  ${deadline ? `<span class="k">Response By</span><span style="font-weight:600;color:#dc2626">${fmtD(deadline)}</span>` : ''}
</div>
${scope ? `<div class="narrative">${scope}</div>` : ''}

${labourRows ? `<h2>Labour Resources Required</h2>
<table><thead><tr><th>Role</th><th style="text-align:right">Est. Day Shifts</th><th style="text-align:right">Est. Night Shifts</th><th>Notes</th></tr></thead>
<tbody>${labourRows}</tbody></table>
<div style="font-size:9px;color:#64748b;margin-top:6px">Please provide rates per shift type (day/afternoon/night) in your response.</div>` : ''}

${equipRows ? `<h2>Equipment Required</h2>
<table><thead><tr><th>Description</th><th>Unit</th><th style="text-align:right">Est. Duration</th><th>Notes</th></tr></thead>
<tbody>${equipRows}</tbody></table>` : ''}

${notes ? `<h2>Additional Requirements</h2><div class="narrative">${notes}</div>` : ''}

<h2>Contact Information</h2>
<div class="kv">
  ${contactName ? `<span class="k">Contact</span><span>${contactName}${contactRole ? ', ' + contactRole : ''}</span>` : ''}
  ${contactEmail ? `<span class="k">Email</span><span>${contactEmail}</span>` : ''}
  ${contactPhone ? `<span class="k">Phone</span><span>${contactPhone}</span>` : ''}
</div>

<h2>Submission Instructions</h2>
<div class="narrative">Please provide your quotation by ${deadline ? fmtD(deadline) : 'the date specified'}.

Your response should include:
• Itemised pricing for all labour roles and equipment
• Confirmation of availability for the scope period
• Any qualifications, exclusions, or assumptions
• Company details, ABN, and current insurances

Submit to: ${contactEmail || 'contact listed above'}</div>

<div class="footer">
  <span>${projectName} — CONFIDENTIAL</span>
  <span>${new Date().toLocaleDateString('en-AU')}</span>
</div>
<script>setTimeout(()=>window.print(),400)<\/script>
</body></html>`

    const win = window.open('', '_blank', 'width=900,height=800')
    if (win) { win.document.write(html); win.document.close() }
  }

  const STAGE_COLOR: Record<string, string> = { draft: '#94a3b8', issued: '#3b82f6', responses_in: '#f59e0b', awarded: '#059669', contracted: '#7c3aed', cancelled: '#e11d48' }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>RFQ Document</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Generate a Request for Quotation to send to potential subcontractors</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={resetForm}>+ New RFQ</button>
          <button className="btn btn-sm" onClick={saveRFQ} disabled={saving}>{saving ? '⏳ Saving…' : '💾 Save RFQ'}</button>
          <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff' }} onClick={printRFQ}>👁 Preview & Print</button>
        </div>
      </div>

      {/* Saved RFQs list */}
      {saved.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', padding: '10px 14px', background: 'var(--bg3)', borderRadius: 'var(--radius)' }}>
          <span style={{ fontSize: '11px', color: 'var(--text3)', alignSelf: 'center', marginRight: '4px' }}>Saved:</span>
          {saved.map(r => (
            <button key={r.id} onClick={() => loadRFQ(r.id)} style={{
              fontSize: '11px', padding: '3px 10px', borderRadius: '12px', border: `1px solid ${r.id === editId ? '#7c3aed' : 'var(--border)'}`,
              background: r.id === editId ? '#ede9fe' : 'var(--bg2)', color: r.id === editId ? '#7c3aed' : 'var(--text2)', cursor: 'pointer', fontWeight: r.id === editId ? 700 : 400,
            }}>
              {r.title || 'Untitled'}
              <span style={{ marginLeft: '5px', fontSize: '9px', color: STAGE_COLOR[r.stage] || '#94a3b8' }}>● {r.stage}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '12px' }}>Project & Scope Details</div>
            <div className="fg"><label>Title / Scope Name *</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Scaffolding Supply & Erect — GT1 Outage 2026" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="fg"><label>Project Name</label><input className="input" value={projectName} onChange={e => setProjectName(e.target.value)} /></div>
              <div className="fg"><label>Site / Location</label><input className="input" value={site} onChange={e => setSite(e.target.value)} /></div>
              <div className="fg"><label>Scope Start</label><input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
              <div className="fg"><label>Scope End</label><input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
            </div>
            <div className="fg"><label>Response Required By *</label><input type="date" className="input" value={deadline} onChange={e => setDeadline(e.target.value)} /></div>
            <div className="fg"><label>Scope Description</label>
              <textarea className="input" rows={5} value={scope} onChange={e => setScope(e.target.value)}
                placeholder="Describe the full scope of work, inclusions, exclusions, site conditions, access requirements, HSE requirements, etc."
                style={{ resize: 'vertical' }} /></div>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '12px' }}>Contact Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="fg"><label>Contact Name</label><input className="input" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="e.g. Kyle Mackechnie" /></div>
              <div className="fg"><label>Title / Role</label><input className="input" value={contactRole} onChange={e => setContactRole(e.target.value)} placeholder="e.g. Project Manager" /></div>
              <div className="fg"><label>Email</label><input type="email" className="input" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="pm@siemensenergy.com" /></div>
              <div className="fg"><label>Phone</label><input className="input" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+61 4xx xxx xxx" /></div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Labour Resources Required</div>
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '10px' }}>List the roles required with estimated shifts. Vendors price per shift type.</p>
            {labour.map((r, i) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <input className="input" placeholder="Role (e.g. Rigger, Scaffolder)" value={r.role} onChange={e => setLabour(rows => rows.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} />
                <input type="number" className="input" placeholder="Day shifts" min={0} value={r.estDayShifts || ''} onChange={e => setLabour(rows => rows.map((x, j) => j === i ? { ...x, estDayShifts: parseInt(e.target.value) || 0 } : x))} />
                <input type="number" className="input" placeholder="Night shifts" min={0} value={r.estNightShifts || ''} onChange={e => setLabour(rows => rows.map((x, j) => j === i ? { ...x, estNightShifts: parseInt(e.target.value) || 0 } : x))} />
                <input className="input" placeholder="Notes" value={r.notes} onChange={e => setLabour(rows => rows.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} />
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: '14px' }} onClick={() => setLabour(rows => rows.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop: '4px' }} onClick={() => setLabour(r => [...r, mkLabour()])}>+ Add Role</button>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Equipment Required</div>
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '10px' }}>List equipment items and quantities. Vendors quote rates for each.</p>
            {equip.map((r, i) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <input className="input" placeholder="Equipment description" value={r.description} onChange={e => setEquip(rows => rows.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                <select className="input" value={r.unit} onChange={e => setEquip(rows => rows.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}>
                  <option>item</option><option>day</option><option>week</option><option>month</option><option>set</option>
                </select>
                <input type="number" className="input" placeholder="Days" min={0} value={r.estimatedDays || ''} onChange={e => setEquip(rows => rows.map((x, j) => j === i ? { ...x, estimatedDays: parseInt(e.target.value) || 0 } : x))} />
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: '14px' }} onClick={() => setEquip(rows => rows.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop: '4px' }} onClick={() => setEquip(r => [...r, mkEquip()])}>+ Add Equipment</button>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>Additional Requirements</div>
            <div className="fg">
              <textarea className="input" rows={4} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. All personnel must hold valid Siemens Energy inductions. SWMS required prior to commencement. PPE to site standard..."
                style={{ resize: 'vertical' }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: '12px', color: 'var(--text3)' }}>Save this RFQ, then track vendor responses in the register.</div>
            <button className="btn btn-sm" onClick={() => setActivePanel('subcon-rfq-register')}>→ Go to RFQ Register</button>
          </div>
        </div>
      </div>

      {/* Saved list at bottom */}
      {saved.length > 0 && (
        <div className="card" style={{ marginTop: '16px', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>Saved RFQ Documents</div>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>Title</th><th>Deadline</th><th>Stage</th><th></th></tr></thead>
            <tbody>
              {saved.map(r => (
                <tr key={r.id} style={{ background: r.id === editId ? '#faf5ff' : 'transparent' }}>
                  <td style={{ fontWeight: 500 }}>{r.title || 'Untitled'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{r.deadline ? r.deadline.split('-').reverse().join('/') : '—'}</td>
                  <td><span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', background: '#f5f3ff', color: STAGE_COLOR[r.stage] || '#94a3b8', fontWeight: 600 }}>{r.stage}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn btn-sm" onClick={() => loadRFQ(r.id)}>✏ Edit</button>
                      <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteRFQ(r.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
