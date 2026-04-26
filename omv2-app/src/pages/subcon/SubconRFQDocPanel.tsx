import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { RfqLabourRow, RfqEquipRow, Resource } from '../../types'

const STAGE_COLOR: Record<string, string> = { draft: '#94a3b8', issued: '#3b82f6', responses_in: '#f59e0b', awarded: '#059669', contracted: '#7c3aed', cancelled: '#e11d48' }

interface SavedRFQ { id: string; title: string; stage: string; deadline: string | null; created_at: string }

const mkId = () => Math.random().toString(36).slice(2, 8)
const mkLabour = (): RfqLabourRow => ({
  id: mkId(), role: '', shiftType: 'single', qty: 1, durMode: 'shifts', shifts: 0, dateStart: null, dateEnd: null,
})
const mkEquip = (): RfqEquipRow => ({
  id: mkId(), desc: '', unit: 'days', durMode: 'qty', dur: 0, dateStart: null, dateEnd: null,
})

const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

export function SubconRFQDocPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [saved, setSaved] = useState<SavedRFQ[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resources, setResources] = useState<Resource[]>([])

  // Form state
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
  const [labour, setLabour] = useState<RfqLabourRow[]>([mkLabour()])
  const [equip, setEquip] = useState<RfqEquipRow[]>([mkEquip()])

  // Field-level validation errors. Cleared as the user types into the field.
  const [errors, setErrors] = useState<{ title?: string; deadline?: string }>({})

  useEffect(() => {
    if (!activeProject) return
    setProjectName(activeProject.name || '')
    const siteName = (activeProject as typeof activeProject & { site_name?: string }).site_name || ''
    const siteAddr = (activeProject.site_info?.address as string) || ''
    setSite(siteName + (siteAddr ? ' — ' + siteAddr : ''))
    loadSaved()
    loadResources()
    // Auto-fill on new doc only
    if (!editId) {
      if (!startDate) setStartDate(activeProject.start_date || '')
      if (!endDate) setEndDate(activeProject.end_date || '')
      if (!contactName) {
        setContactName(activeProject.pm || '')
        setContactRole(activeProject.pm ? 'Project Manager' : '')
        setContactPhone(activeProject.site_phone || '')
      }
    }
  }, [activeProject?.id])

  async function loadSaved() {
    const { data } = await supabase.from('rfq_documents')
      .select('id,title,stage,deadline,created_at').eq('project_id', activeProject!.id).order('created_at', { ascending: false })
    setSaved((data || []) as SavedRFQ[])
  }

  async function loadResources() {
    const { data } = await supabase.from('resources')
      .select('id,name,role,email,phone,company,category,shift,mob_in,mob_out,wbs,allow_laha,allow_fsa,allow_meal,linked_po_id,rate_card_id,home_city,transport_mode,drive_km,meal_break_adj,flags,notes,project_id,travel_days,created_at,updated_at')
      .eq('project_id', activeProject!.id)
    setResources((data || []) as Resource[])
  }

  function resetForm() {
    setEditId(null); setTitle(''); setScope(''); setDeadline('')
    setStartDate(activeProject?.start_date || '')
    setEndDate(activeProject?.end_date || '')
    setContactName(activeProject?.pm || '')
    setContactRole(activeProject?.pm ? 'Project Manager' : '')
    setContactEmail('')
    setContactPhone(activeProject?.site_phone || '')
    setNotes('')
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
    const lr = d.labour_rows as RfqLabourRow[] | undefined
    setLabour(lr && lr.length ? lr : [mkLabour()])
    const er = d.equip_rows as RfqEquipRow[] | undefined
    setEquip(er && er.length ? er : [mkEquip()])
  }

  function fillFromResource(resourceId: string) {
    if (!resourceId) return
    const r = resources.find(x => x.id === resourceId)
    if (!r) return
    if (r.name) setContactName(r.name)
    if (r.role) setContactRole(r.role)
    if (r.email) setContactEmail(r.email)
    if (r.phone) setContactPhone(r.phone)
    toast(`Contact filled from ${r.name}`, 'success')
  }

  async function saveRFQ() {
    // Field-level validation — sets red borders + inline error text and scrolls to first invalid field
    const newErrors: typeof errors = {}
    if (!title.trim()) newErrors.title = 'Title is required'
    if (!deadline) newErrors.deadline = 'Response deadline is required'
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) {
      // Scroll the first invalid field into view
      const firstField = newErrors.title ? 'rfq-title' : 'rfq-deadline'
      requestAnimationFrame(() => {
        const el = document.getElementById(firstField)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.focus()
      })
      toast(`Please fix the highlighted field${Object.keys(newErrors).length > 1 ? 's' : ''}`, 'error')
      return
    }

    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      title: title.trim(),
      scope,
      deadline: deadline || null,
      start_date: startDate || null,
      end_date: endDate || null,
      contact_name: contactName,
      contact_role: contactRole,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      notes,
      labour_rows: labour,
      equip_rows: equip,
      // Only set stage on new doc — preserve existing on update
      ...(editId ? {} : { stage: 'draft' }),
    }
    const { error, data } = editId
      ? await supabase.from('rfq_documents').update(payload).eq('id', editId).select('id').single()
      : await supabase.from('rfq_documents').insert(payload).select('id').single()
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    // Defend against silent RLS failures — Supabase client can return {data:null, error:null}
    // when an insert succeeds but RLS blocks the post-insert SELECT.
    if (!data) {
      toast('Save appeared to succeed but the row could not be read back. Check your project access.', 'error')
      setSaving(false)
      return
    }
    toast('RFQ saved', 'success')
    if (!editId) setEditId(data.id)
    setSaving(false)
    loadSaved()
  }

  async function deleteRFQ(id: string) {
    if (!confirm('Delete this RFQ? Any vendor responses will also be deleted.')) return
    const { error } = await supabase.from('rfq_documents').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    if (editId === id) resetForm()
    loadSaved()
    toast('Deleted', 'success')
  }

  function addLabour() { setLabour(r => [...r, mkLabour()]) }
  function removeLabour(i: number) { setLabour(r => r.filter((_, j) => j !== i)) }
  function duplicateLabour(i: number) { setLabour(r => [...r, { ...r[i], id: mkId() }]) }
  function updateLabour(i: number, patch: Partial<RfqLabourRow>) { setLabour(r => r.map((x, j) => j === i ? { ...x, ...patch } : x)) }
  function toggleLabourMode(i: number) {
    setLabour(r => r.map((x, j) => j === i ? { ...x, durMode: x.durMode === 'shifts' ? 'dates' : 'shifts' } : x))
  }

  function addEquip() { setEquip(r => [...r, mkEquip()]) }
  function removeEquip(i: number) { setEquip(r => r.filter((_, j) => j !== i)) }
  function duplicateEquip(i: number) { setEquip(r => [...r, { ...r[i], id: mkId() }]) }
  function updateEquip(i: number, patch: Partial<RfqEquipRow>) { setEquip(r => r.map((x, j) => j === i ? { ...x, ...patch } : x)) }
  function toggleEquipMode(i: number) {
    setEquip(r => r.map((x, j) => j === i ? { ...x, durMode: x.durMode === 'qty' ? 'dates' : 'qty' } : x))
  }

  function previewRFQ() {
    if (!title.trim()) { toast('Title is required', 'error'); return }
    if (!deadline) { toast('Response deadline is required', 'error'); return }

    const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const labourHtml = labour.filter(r => r.role.trim()).map(r => {
      const shiftLabel = r.shiftType === 'dual' ? 'Dual Shift' : r.shiftType === 'single-night' ? 'Single (Night)' : 'Single (Day)'
      const dur = r.durMode === 'dates'
        ? `${fmtDate(r.dateStart)} → ${fmtDate(r.dateEnd)}`
        : (r.shifts ? `${r.shifts} shifts` : '—')
      return `<tr>
        <td style="font-weight:600">${escHtml(r.role)}</td>
        <td class="num">${r.qty}</td>
        <td>${shiftLabel}</td>
        <td class="num">${dur}</td>
      </tr>`
    }).join('')

    const equipHtml = equip.filter(r => r.desc.trim()).map(r => {
      const dur = r.durMode === 'dates'
        ? `${fmtDate(r.dateStart)} → ${fmtDate(r.dateEnd)}`
        : (r.dur ? `${r.dur}` : '—')
      return `<tr>
        <td style="font-weight:600">${escHtml(r.desc)}</td>
        <td class="num">${dur}</td>
        <td>${r.durMode === 'dates' ? 'date range' : escHtml(r.unit)}</td>
      </tr>`
    }).join('')

    const win = window.open('', '_blank', 'width=1050,height=820')
    if (!win) { toast('Popup blocked — allow popups for this site', 'error'); return }

    const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>RFQ — ${escHtml(projectName || 'Siemens Energy')} — ${escHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5pt;color:#111;padding:24px;max-width:1020px;margin:0 auto;orphans:3;widows:3}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:12px;border-bottom:3px solid #7c3aed}
.rfq-title{font-size:20pt;font-weight:700;color:#7c3aed}.rfq-sub{font-size:10.5pt;color:#555;margin-top:3px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:16px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.meta-cell{padding:7px 14px;border-bottom:1px solid #e2e8f0}.meta-cell:nth-child(odd){border-right:1px solid #e2e8f0;background:#faf5ff}
.meta-label{font-size:8pt;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}
.meta-value{font-size:10.5pt;font-weight:600}
h2{font-size:12pt;color:#7c3aed;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid #e9d5ff}
.section-note{font-size:9.5pt;color:#555;margin-bottom:10px;line-height:1.5}
.scope-body{font-size:10.5pt;color:#333;line-height:1.7;white-space:pre-wrap;margin-bottom:16px;padding:12px 14px;background:#fafafa;border:1px solid #e2e8f0;border-radius:6px}
table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:9.5pt}
th{background:#f3e8ff;padding:6px 8px;text-align:left;border:1px solid #e2e8f0;font-weight:700;color:#5b21b6;font-size:8.5pt}
th.num{text-align:right}
td{padding:6px 8px;border:1px solid #e2e8f0;vertical-align:middle}
td.num{text-align:right;font-family:monospace}
.contact-box{margin-top:18px;padding:12px 16px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc}
.contact-title{font-size:11pt;font-weight:700;margin-bottom:8px;color:#1e293b}
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:10.5pt}
.notes-box{margin-top:14px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px}
.notes-title{font-size:10pt;font-weight:700;color:#991b1b;margin-bottom:6px}
.footer{margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9pt;color:#94a3b8;display:flex;justify-content:space-between}
.print-btn{padding:6px 16px;background:#7c3aed;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer}
@media print{
  .print-btn{display:none}
  body{padding:10px}
  h2{break-after:avoid;page-break-after:avoid}
  table{break-inside:auto;page-break-inside:auto}
  tr{break-inside:avoid;page-break-inside:avoid}
  thead{display:table-header-group}
  .scope-body,.notes-box,.contact-box,.meta-grid,.footer{break-inside:avoid;page-break-inside:avoid}
}
</style></head><body>
<div class="header">
  <div><div class="rfq-title">Request for Quotation</div><div class="rfq-sub">${escHtml(title)}</div></div>
  <div style="display:flex;align-items:center;gap:16px">
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>
</div>
<div class="meta-grid">
  <div class="meta-cell"><div class="meta-label">Project</div><div class="meta-value">${escHtml(projectName || '—')}</div></div>
  <div class="meta-cell"><div class="meta-label">Site / Location</div><div class="meta-value">${escHtml(site || '—')}</div></div>
  <div class="meta-cell"><div class="meta-label">Scope Start</div><div class="meta-value">${fmtDate(startDate)}</div></div>
  <div class="meta-cell"><div class="meta-label">Scope End</div><div class="meta-value">${fmtDate(endDate)}</div></div>
  <div class="meta-cell"><div class="meta-label">RFQ Issued</div><div class="meta-value">${new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
  <div class="meta-cell"><div class="meta-label">Issued By</div><div class="meta-value">${escHtml(contactName || '—')}${contactRole ? ' — ' + escHtml(contactRole) : ''}</div></div>
  <div class="meta-cell" style="border-bottom:none"><div class="meta-label">Response Required By</div><div class="meta-value">${fmtDate(deadline)}</div></div>
  <div class="meta-cell" style="border-bottom:none;color:#555;font-size:9.5pt;display:flex;align-items:center">Please submit your complete quotation by this date. Late submissions may not be considered.</div>
</div>
${labourHtml ? `<h2>Labour Resources Required</h2>
<p class="section-note">Please submit your schedule of rates for the roles listed below.</p>
<table><thead><tr><th>Role / Classification</th><th class="num">Qty</th><th>Shift Type</th><th class="num">Duration</th></tr></thead>
<tbody>${labourHtml}</tbody></table>` : ''}
${equipHtml ? `<h2>Equipment Required</h2>
<p class="section-note">Please submit your schedule of rates for the equipment listed below.</p>
<table><thead><tr><th>Equipment / Item</th><th class="num">Duration</th><th>Unit</th></tr></thead>
<tbody>${equipHtml}</tbody></table>` : ''}
${scope ? `<h2>Scope of Work</h2><div class="scope-body">${escHtml(scope)}</div>` : ''}
${notes ? `<div class="notes-box"><div class="notes-title">Additional Requirements</div><div style="font-size:10pt;white-space:pre-wrap;line-height:1.6;margin-top:4px">${escHtml(notes)}</div></div>` : ''}
<div class="contact-box">
  <div class="contact-title">Quotation Submission &amp; Enquiries</div>
  <div class="contact-grid">
    ${contactName ? `<div><strong>Contact:</strong> ${escHtml(contactName)}${contactRole ? ' (' + escHtml(contactRole) + ')' : ''}</div>` : ''}
    ${contactEmail ? `<div><strong>Email:</strong> <a href="mailto:${escHtml(contactEmail)}">${escHtml(contactEmail)}</a></div>` : ''}
    ${contactPhone ? `<div><strong>Phone:</strong> ${escHtml(contactPhone)}</div>` : ''}
  </div>
</div>
<div class="footer">
  <span>Siemens Energy — Confidential &amp; Commercial in Confidence</span>
  <span>Generated ${new Date().toLocaleString('en-AU')}</span>
</div>
</body></html>`
    win.document.write(html)
    win.document.close()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>RFQ Document</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Generate a Request for Quotation to send to potential subcontractors</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={resetForm}>+ New RFQ</button>
          <button className="btn btn-sm" onClick={saveRFQ} disabled={saving}>{saving ? 'Saving…' : 'Save RFQ'}</button>
          <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff' }} onClick={previewRFQ}>Preview &amp; Print</button>
        </div>
      </div>

      {/* Saved RFQ pill bar */}
      {saved.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: '4px' }}>Saved:</span>
          {saved.map(d => (
            <button key={d.id} onClick={() => loadRFQ(d.id)} style={{
              padding: '3px 10px',
              border: `1px solid ${editId === d.id ? '#7c3aed' : 'var(--border)'}`,
              borderRadius: '20px',
              background: editId === d.id ? '#f3e8ff' : 'var(--bg2)',
              color: editId === d.id ? '#7c3aed' : 'var(--text2)',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: editId === d.id ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}>
              {d.title || 'Untitled'}
              <span style={{ fontSize: '9px', color: STAGE_COLOR[d.stage] || 'var(--text3)', fontWeight: 600 }}>● {d.stage}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '12px' }}>Project &amp; Scope Details</div>
            <div className="fg"><label>Title / Scope Name *</label>
              <input
                id="rfq-title"
                className="input"
                value={title}
                onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(s => ({ ...s, title: undefined })) }}
                placeholder="e.g. Scaffolding Supply &amp; Erect — GT1 Outage 2026"
                style={errors.title ? { borderColor: 'var(--red)', boxShadow: '0 0 0 2px rgba(239,68,68,.15)' } : undefined}
              />
              {errors.title && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{errors.title}</div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="fg"><label>Project Name</label><input className="input" value={projectName} onChange={e => setProjectName(e.target.value)} /></div>
              <div className="fg"><label>Site / Location</label><input className="input" value={site} onChange={e => setSite(e.target.value)} /></div>
              <div className="fg"><label>Scope Start</label><input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
              <div className="fg"><label>Scope End</label><input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
            </div>
            <div className="fg"><label>Response Required By *</label>
              <input
                id="rfq-deadline"
                type="date"
                className="input"
                value={deadline}
                onChange={e => { setDeadline(e.target.value); if (errors.deadline) setErrors(s => ({ ...s, deadline: undefined })) }}
                style={errors.deadline ? { borderColor: 'var(--red)', boxShadow: '0 0 0 2px rgba(239,68,68,.15)' } : undefined}
              />
              {errors.deadline && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{errors.deadline}</div>}
            </div>
            <div className="fg"><label>Scope Description</label>
              <textarea className="input" rows={5} value={scope} onChange={e => setScope(e.target.value)}
                placeholder="Describe the full scope of work, inclusions, exclusions, site conditions, access requirements, HSE requirements, etc."
                style={{ resize: 'vertical' }} />
            </div>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>Contact Information</div>
              {resources.length > 0 && (
                <select
                  style={{ fontSize: '11px', padding: '3px 8px', width: '180px' }}
                  className="input"
                  onChange={e => { fillFromResource(e.target.value); e.target.value = '' }}
                  defaultValue=""
                >
                  <option value="">— fill from resource —</option>
                  {resources.map(r => (
                    <option key={r.id} value={r.id}>{r.name}{r.role ? ' — ' + r.role : ''}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="fg"><label>Contact Name</label><input className="input" value={contactName} onChange={e => setContactName(e.target.value)} /></div>
              <div className="fg"><label>Title / Role</label><input className="input" value={contactRole} onChange={e => setContactRole(e.target.value)} /></div>
              <div className="fg"><label>Email</label><input type="email" className="input" value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></div>
              <div className="fg"><label>Phone</label><input className="input" value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Labour Resources Required</div>
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '10px' }}>List each role with quantity, shift type, and duration. Vendors will quote schedule of rates against this.</p>
            {/* Header row */}
            {labour.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr 50px 28px 28px', gap: '5px', marginBottom: '4px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Role / Classification</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textAlign: 'center' }}>Shift Type</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textAlign: 'center' }}>Duration</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textAlign: 'center' }}>Qty</div>
                <div /><div />
              </div>
            )}
            {labour.map((r, i) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr 50px 28px 28px', gap: '5px', alignItems: 'center', marginBottom: '5px' }}>
                <input className="input" style={{ fontSize: '11px' }} placeholder="e.g. Scaffolder Level 2" value={r.role} onChange={e => updateLabour(i, { role: e.target.value })} />
                <select className="input" style={{ fontSize: '11px' }} value={r.shiftType} onChange={e => updateLabour(i, { shiftType: e.target.value as RfqLabourRow['shiftType'] })}>
                  <option value="single">Single (Day)</option>
                  <option value="single-night">Single (Night)</option>
                  <option value="dual">Dual Shift</option>
                </select>
                <div style={{ display: 'flex', gap: '3px', alignItems: 'center', minWidth: 0 }}>
                  <button onClick={() => toggleLabourMode(i)} title="Toggle between shifts or date range" style={{
                    padding: '2px 6px', fontSize: '9px',
                    border: `1px solid ${r.durMode === 'dates' ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '3px',
                    background: r.durMode === 'dates' ? 'transparent' : 'var(--bg3)',
                    color: r.durMode === 'dates' ? 'var(--accent)' : 'var(--text3)',
                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {r.durMode === 'dates' ? 'dates' : '# shifts'}
                  </button>
                  {r.durMode === 'shifts' ? (
                    <input className="input" style={{ fontSize: '11px', textAlign: 'center', fontFamily: 'var(--mono)', flex: 1, minWidth: 0 }}
                      type="number" min={0} step={1} placeholder="# shifts"
                      value={r.shifts || ''} onChange={e => updateLabour(i, { shifts: parseInt(e.target.value) || 0 })} />
                  ) : (
                    <div style={{ display: 'flex', flex: 1, gap: '3px', minWidth: 0 }}>
                      <input className="input" style={{ fontSize: '10px', padding: '4px 5px', flex: 1, minWidth: 0 }} type="date" value={r.dateStart || ''} onChange={e => updateLabour(i, { dateStart: e.target.value || null })} />
                      <input className="input" style={{ fontSize: '10px', padding: '4px 5px', flex: 1, minWidth: 0 }} type="date" value={r.dateEnd || ''} onChange={e => updateLabour(i, { dateEnd: e.target.value || null })} />
                    </div>
                  )}
                </div>
                <input className="input" style={{ fontSize: '11px', textAlign: 'center', fontFamily: 'var(--mono)' }} type="number" min={1} step={1}
                  value={r.qty || 1} onChange={e => updateLabour(i, { qty: parseInt(e.target.value) || 1 })} />
                <button onClick={() => duplicateLabour(i)} title="Duplicate row" style={{ padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: '11px' }}>⧉</button>
                <button onClick={() => removeLabour(i)} title="Remove row" style={{ padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: '11px' }}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop: '6px' }} onClick={addLabour}>+ Add Role</button>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>Equipment Required</div>
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '10px' }}>List equipment items with duration. Vendors quote rates for each.</p>
            {equip.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 28px 28px', gap: '5px', marginBottom: '4px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Equipment / Description</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textAlign: 'center' }}>Unit</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textAlign: 'center' }}>Duration</div>
                <div /><div />
              </div>
            )}
            {equip.map((r, i) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 28px 28px', gap: '5px', alignItems: 'center', marginBottom: '5px' }}>
                <input className="input" style={{ fontSize: '11px' }} placeholder="e.g. 20t All-Terrain Crane" value={r.desc} onChange={e => updateEquip(i, { desc: e.target.value })} />
                <select className="input" style={{ fontSize: '11px' }} value={r.unit} onChange={e => updateEquip(i, { unit: e.target.value as RfqEquipRow['unit'] })}>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="lump">Lump Sum</option>
                </select>
                <div style={{ display: 'flex', gap: '3px', alignItems: 'center', minWidth: 0 }}>
                  <button onClick={() => toggleEquipMode(i)} title="Toggle between quantity or date range" style={{
                    padding: '2px 6px', fontSize: '9px',
                    border: `1px solid ${r.durMode === 'dates' ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '3px',
                    background: r.durMode === 'dates' ? 'transparent' : 'var(--bg3)',
                    color: r.durMode === 'dates' ? 'var(--accent)' : 'var(--text3)',
                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {r.durMode === 'dates' ? 'dates' : 'qty'}
                  </button>
                  {r.durMode === 'qty' ? (
                    <input className="input" style={{ fontSize: '11px', textAlign: 'center', fontFamily: 'var(--mono)', flex: 1, minWidth: 0 }}
                      type="number" min={0} step={1} placeholder="qty"
                      value={r.dur || ''} onChange={e => updateEquip(i, { dur: parseInt(e.target.value) || 0 })} />
                  ) : (
                    <div style={{ display: 'flex', flex: 1, gap: '3px', minWidth: 0 }}>
                      <input className="input" style={{ fontSize: '10px', padding: '4px 5px', flex: 1, minWidth: 0 }} type="date" value={r.dateStart || ''} onChange={e => updateEquip(i, { dateStart: e.target.value || null })} />
                      <input className="input" style={{ fontSize: '10px', padding: '4px 5px', flex: 1, minWidth: 0 }} type="date" value={r.dateEnd || ''} onChange={e => updateEquip(i, { dateEnd: e.target.value || null })} />
                    </div>
                  )}
                </div>
                <button onClick={() => duplicateEquip(i)} title="Duplicate row" style={{ padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: '11px' }}>⧉</button>
                <button onClick={() => removeEquip(i)} title="Remove row" style={{ padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: '11px' }}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop: '6px' }} onClick={addEquip}>+ Add Equipment</button>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>Additional Requirements</div>
            <textarea className="input" rows={4} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. All personnel must hold valid Siemens Energy inductions. SWMS required prior to commencement. PPE to site standard..."
              style={{ resize: 'vertical', width: '100%' }} />
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
                      <button className="btn btn-sm" onClick={() => loadRFQ(r.id)}>Edit</button>
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
