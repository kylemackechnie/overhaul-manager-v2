import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { computeCostModel, type CostModelShiftPattern, type CostModelResult } from '../../engines/costModelEngine'
import type {
  RfqDocument, RfqResponse, PublicHoliday,
} from '../../types'

// Re-export the shift pattern type since we use it locally too
type Pattern = CostModelShiftPattern

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
const fmtMoneyDec = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%'

// Storage key for per-RFQ analysis notes (not worth a DB column for free-form note content)
const notesKey = (docId: string) => `rfq_cost_notes_${docId}`

export function SubconCostModelPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [docs, setDocs] = useState<RfqDocument[]>([])
  const [responses, setResponses] = useState<RfqResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  // Modelling params
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pattern, setPattern] = useState<Pattern>('weekday')
  const [headcounts, setHeadcounts] = useState<Record<number, number>>({})
  const [notes, setNotes] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [docsRes, respRes] = await Promise.all([
      supabase.from('rfq_documents').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('rfq_responses').select('*').eq('project_id', pid),
    ])
    setDocs((docsRes.data || []) as RfqDocument[])
    setResponses((respRes.data || []) as RfqResponse[])
    setLoading(false)
  }

  // When a doc is selected, prefill modelling params from its date window
  useEffect(() => {
    if (!selectedDocId) return
    const doc = docs.find(d => d.id === selectedDocId)
    if (!doc) return
    if (doc.start_date) setStartDate(doc.start_date)
    if (doc.end_date) setEndDate(doc.end_date)
    // Reset headcounts to row defaults
    const hc: Record<number, number> = {}
    ;(doc.labour_rows || []).forEach((lr, i) => { hc[i] = lr.qty || 1 })
    setHeadcounts(hc)
    // Load saved notes
    try {
      const saved = localStorage.getItem(notesKey(doc.id))
      setNotes(saved || '')
    } catch { /* ignore */ }
  }, [selectedDocId, docs])

  // Persist notes (debounced via blur — keep it simple)
  function saveNotes(value: string) {
    setNotes(value)
    if (!selectedDocId) return
    try { localStorage.setItem(notesKey(selectedDocId), value) } catch { /* quota etc — non-fatal */ }
  }

  const selectedDoc = useMemo(() => docs.find(d => d.id === selectedDocId) || null, [docs, selectedDocId])
  const selectedResponses = useMemo(
    () => selectedDocId ? responses.filter(r => r.rfq_document_id === selectedDocId) : [],
    [responses, selectedDocId],
  )

  // Eligible docs = those with at least one response
  const eligibleDocs = useMemo(() => {
    const idsWithResp = new Set(responses.map(r => r.rfq_document_id))
    return docs.filter(d => idsWithResp.has(d.id))
  }, [docs, responses])

  // Run the model whenever inputs change
  const result = useMemo(() => {
    if (!selectedDoc || !selectedResponses.length || !startDate || !endDate) return null
    if (endDate <= startDate) return null
    const phs: PublicHoliday[] = (activeProject?.public_holidays || []) as PublicHoliday[]
    return computeCostModel(selectedDoc, selectedResponses, {
      startDate, endDate, pattern, headcountOverrides: headcounts,
    }, phs)
  }, [selectedDoc, selectedResponses, startDate, endDate, pattern, headcounts, activeProject])

  function printReport() {
    if (!result || !selectedDoc) return
    const win = window.open('', '_blank', 'width=1200,height=820')
    if (!win) { toast('Popup blocked — allow popups for this site', 'error'); return }

    const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const vendorCards = result.vendors.map((v, i) => {
      const isBest = i === 0
      const saving = v.projectedTotal - result.vendors[0].projectedTotal
      return `<div class="vc ${isBest ? 'best' : ''}">
        <div class="vc-rank">${isBest ? '★' : '#' + (i + 1)}</div>
        <div style="flex:1">
          <div class="vc-name">${escHtml(v.vendor)}</div>
          <div class="vc-sub">
            ${v.totalQuote != null ? `Quoted: <b>${fmtMoneyDec(v.totalQuote)}</b> ${v.currency}` : 'No total quoted'}
            ${v.variance != null ? ` · Variance: ${v.variance >= 0 ? '+' : ''}${fmtMoneyDec(v.variance)} (${fmtPct(v.variancePct ?? 0)})` : ''}
          </div>
        </div>
        <div class="vc-total">${fmtMoneyDec(v.projectedTotal)}</div>
        ${!isBest ? `<div class="vc-saving">+${fmtMoneyDec(saving)} vs best</div>` : ''}
      </div>`
    }).join('')

    // Per-role breakdown table
    const labourRoles = selectedDoc.labour_rows || []
    const roleHeaderHtml = labourRoles.map(r => `<th>${escHtml(r.role)}</th>`).join('')
    const roleBodyHtml = result.vendors.map(v => `<tr>
      <td style="font-weight:600">${escHtml(v.vendor)}</td>
      ${labourRoles.map((_, ri) => {
        const role = v.roles.find(rr => rr.roleIndex === ri)
        return `<td class="num">${role ? fmtMoney(role.totalCost) : '—'}</td>`
      }).join('')}
      <td class="num" style="font-weight:700">${fmtMoney(v.labourCost)}</td>
    </tr>`).join('')

    // Weekly table
    const weekHeaderHtml = result.weekKeys.map(wk => `<th>${fmtDate(wk)}</th>`).join('')
    const weekBodyHtml = result.vendors.map(v => {
      const weekTotals: Record<string, number> = {}
      for (const r of v.roles) for (const w of r.perWeek) weekTotals[w.weekKey] = (weekTotals[w.weekKey] || 0) + w.cost
      return `<tr>
        <td style="font-weight:600">${escHtml(v.vendor)}</td>
        ${result.weekKeys.map(wk => `<td class="num">${weekTotals[wk] ? fmtMoney(weekTotals[wk]) : '—'}</td>`).join('')}
        <td class="num" style="font-weight:700">${fmtMoney(v.labourCost)}</td>
      </tr>`
    }).join('')

    // Equip table
    const equipRows = selectedDoc.equip_rows || []
    let equipSection = ''
    if (equipRows.length > 0) {
      const eqHeader = equipRows.map(e => `<th>${escHtml(e.desc)}</th>`).join('')
      const eqBody = result.vendors.map(v => `<tr>
        <td style="font-weight:600">${escHtml(v.vendor)}</td>
        ${equipRows.map((er) => {
          const ec = v.equip.find(eq => eq.desc === er.desc)
          return `<td class="num">${ec && ec.totalCost > 0 ? fmtMoney(ec.totalCost) : '—'}</td>`
        }).join('')}
        <td class="num" style="font-weight:700">${fmtMoney(v.equipCost)}</td>
      </tr>`).join('')
      equipSection = `<section><div class="section-title">Equipment Breakdown</div>
        <table><thead><tr><th>Vendor</th>${eqHeader}<th>Equip Total</th></tr></thead><tbody>${eqBody}</tbody></table>
      </section>`
    }

    const notesSection = notes
      ? `<section><div class="section-title">Analysis Notes</div><div class="notes-body">${
          escHtml(notes).split(/\n\n+/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('')
        }</div></section>`
      : ''

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${escHtml(activeProject?.name || 'Project')} — ${escHtml(selectedDoc.title)} — Cost Comparison</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 landscape;margin:12mm 10mm}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:9pt;color:#111;background:#fff;line-height:1.4}
.cover{padding-bottom:10pt;margin-bottom:10pt;border-bottom:2pt solid #7c3aed}
.cover h1{font-size:18pt;font-weight:700;color:#7c3aed;margin-bottom:2pt}
.cover .meta{font-size:8pt;color:#666;margin-bottom:6pt}
.params{display:flex;gap:18pt;background:#f5f5f5;padding:6pt 10pt;border-radius:4pt;font-size:8pt;margin-bottom:8pt}
.params span{color:#666}.params b{color:#111}
.vc{display:flex;align-items:center;gap:10pt;padding:8pt 12pt;border:1.5pt solid #e5e7eb;border-radius:5pt;break-inside:avoid;margin-bottom:6pt}
.vc.best{border-color:#16a34a;background:#f0fdf4}
.vc-rank{font-size:13pt;font-weight:700;color:#9ca3af;width:30pt;text-align:center}
.vc.best .vc-rank{color:#16a34a}
.vc-name{font-size:11pt;font-weight:700}
.vc-sub{font-size:7.5pt;color:#666;margin-top:1pt}
.vc-total{font-size:14pt;font-weight:700;font-family:monospace}
.vc.best .vc-total{color:#16a34a}
.vc-saving{font-size:8pt;color:#ea580c;margin-left:6pt}
section{break-before:page;padding-top:2pt}
.section-title{font-size:10pt;font-weight:700;color:#374151;margin-bottom:8pt;padding-bottom:4pt;border-bottom:1pt solid #e5e7eb}
table{width:100%;border-collapse:collapse;font-size:7.5pt;margin-bottom:8pt}
th,td{border:0.5pt solid #d1d5db;padding:2.5pt 4pt;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
th{background:#f3f4f6;font-weight:600;text-align:center}
th:first-child,td:first-child{text-align:left}
td.num{text-align:right;font-family:monospace}
thead{display:table-header-group}
tr{break-inside:avoid}
.notes-body p{font-size:9pt;line-height:1.7;margin-bottom:8pt;break-inside:avoid}
.footer{font-size:7pt;color:#9ca3af;display:flex;justify-content:space-between;border-top:0.5pt solid #e5e7eb;padding-top:4pt;margin-top:14pt}
.print-btn{padding:6px 16px;background:#7c3aed;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8pt}
@media print{.print-btn{display:none}}
</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="cover">
  <h1>${escHtml(selectedDoc.title)}</h1>
  <div class="meta">${escHtml(activeProject?.name || '')} · Cost Comparison · Generated ${new Date().toLocaleString('en-AU')}</div>
</div>
<div class="params">
  <span>Period:</span><b>${fmtDate(startDate)} → ${fmtDate(endDate)}</b>
  <span>Pattern:</span><b>${pattern === 'weekday' ? 'Mon–Fri' : '7-Day'}</b>
  <span>Working days:</span><b>${result.totalDays}</b>
  <span>Vendors:</span><b>${result.vendors.length}</b>
</div>
<div class="section-title">Vendor Ranking</div>
${vendorCards}
<section>
  <div class="section-title">Per-Role Breakdown</div>
  <table><thead><tr><th>Vendor</th>${roleHeaderHtml}<th>Labour Total</th></tr></thead><tbody>${roleBodyHtml}</tbody></table>
</section>
<section>
  <div class="section-title">Weekly Breakdown (Labour)</div>
  <table><thead><tr><th>Vendor</th>${weekHeaderHtml}<th>Labour Total</th></tr></thead><tbody>${weekBodyHtml}</tbody></table>
</section>
${equipSection}
${notesSection}
<div class="footer">
  <span>Siemens Energy — Confidential</span>
  <span>${new Date().toLocaleString('en-AU')}</span>
</div>
</body></html>`)
    win.document.close()
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1280px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Cost Model</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Compare projected costs across vendor responses for an RFQ</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('subcon-rfq-register')}>← RFQ Register</button>
          {result && (
            <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff' }} onClick={printReport}>Print Comparison</button>
          )}
        </div>
      </div>

      {/* RFQ picker */}
      {!selectedDocId ? (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Select an RFQ to model</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '14px' }}>
            Only RFQs with at least one logged vendor response can be cost-modelled.
          </div>
          {eligibleDocs.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px' }}>
              <div className="icon">📈</div>
              <h3>No RFQs ready for cost modelling</h3>
              <p>Create an RFQ document, log at least one vendor response, then return here.</p>
              <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff', marginTop: '12px' }} onClick={() => setActivePanel('subcon-rfq-register')}>
                → Go to RFQ Register
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {eligibleDocs.map(d => {
                const respCount = responses.filter(r => r.rfq_document_id === d.id).length
                return (
                  <button key={d.id} onClick={() => setSelectedDocId(d.id)} style={{
                    padding: '12px 14px',
                    border: '1px solid var(--border)', borderRadius: '6px',
                    background: 'var(--bg2)', cursor: 'pointer', textAlign: 'left',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{d.title || 'Untitled'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                      {(d.labour_rows || []).length} labour role{(d.labour_rows || []).length !== 1 ? 's' : ''}
                      {' · '}
                      {(d.equip_rows || []).length} equip item{(d.equip_rows || []).length !== 1 ? 's' : ''}
                      {' · '}
                      <span style={{ color: 'var(--green)' }}>{respCount} vendor response{respCount !== 1 ? 's' : ''}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : !selectedDoc ? null : (
        <>
          {/* Header for selected RFQ */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700 }}>{selectedDoc.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
                {selectedResponses.length} vendor response{selectedResponses.length !== 1 ? 's' : ''}
                {' · '}
                {(selectedDoc.labour_rows || []).length} labour role{(selectedDoc.labour_rows || []).length !== 1 ? 's' : ''}
                {' · '}
                {(selectedDoc.equip_rows || []).length} equip item{(selectedDoc.equip_rows || []).length !== 1 ? 's' : ''}
              </div>
            </div>
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelectedDocId(null)}>Change RFQ</button>
          </div>

          {/* Vendor responses chip row */}
          <div className="card" style={{ marginBottom: '14px', padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px' }}>Vendor Responses</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedResponses.map(r => (
                <div key={r.id} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg3)', fontSize: '11px' }}>
                  <div style={{ fontWeight: 600 }}>{r.vendor}</div>
                  <div style={{ color: 'var(--text3)' }}>
                    {r.received_date ? fmtDate(r.received_date) : 'No date'} · {r.currency || 'AUD'}
                    {r.total_quote != null ? ' · ' + fmtMoneyDec(r.total_quote) : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modelling parameters */}
          <div className="card" style={{ marginBottom: '14px', padding: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '10px' }}>Modelling Parameters</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div className="fg" style={{ margin: 0 }}>
                <label>Start Date *</label>
                <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="fg" style={{ margin: 0 }}>
                <label>End Date *</label>
                <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div className="fg" style={{ margin: 0 }}>
                <label>Shift Pattern</label>
                <select className="input" value={pattern} onChange={e => setPattern(e.target.value as Pattern)}>
                  <option value="weekday">Mon–Fri</option>
                  <option value="sevenDay">7-Day</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>
              Project public holidays applied automatically · Shift type per role definition · Roles costed within their date windows only
            </div>
          </div>

          {/* Role headcount overrides */}
          {(selectedDoc.labour_rows || []).length > 0 && (
            <div className="card" style={{ marginBottom: '14px', padding: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '10px' }}>
                Role Headcount <span style={{ fontWeight: 400, color: 'var(--text3)' }}>— override quantities from RFQ document</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {(selectedDoc.labour_rows || []).map((lr, li) => {
                  const window2 = lr.durMode === 'dates' && lr.dateStart
                    ? `${fmtDate(lr.dateStart)}–${fmtDate(lr.dateEnd)}`
                    : 'full range'
                  const shift = lr.shiftType === 'dual' ? 'Dual' : lr.shiftType === 'single-night' ? 'NS Only' : 'DS Only'
                  return (
                    <div key={li} className="fg" style={{ margin: 0, width: '180px' }}>
                      <label style={{ fontSize: '10px' }}>{lr.role || `Role ${li + 1}`}</label>
                      <div style={{ fontSize: '9px', color: 'var(--text3)', marginBottom: '2px' }}>{window2} · {shift}</div>
                      <input className="input" type="number" min={0} step={1}
                        style={{ fontSize: '11px' }}
                        value={headcounts[li] ?? lr.qty ?? 1}
                        onChange={e => setHeadcounts(s => ({ ...s, [li]: parseInt(e.target.value) || 0 }))} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Output */}
          {!result ? (
            <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>
              Enter start and end dates above to compute the cost model.
            </div>
          ) : (
            <CostModelOutput result={result} doc={selectedDoc} />
          )}

          {/* Notes */}
          <div className="card" style={{ marginTop: '16px', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)' }}>Analysis Notes</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>— included in print output, saved per RFQ in your browser</div>
            </div>
            <textarea
              className="input"
              rows={6}
              value={notes}
              onChange={e => saveNotes(e.target.value)}
              placeholder="Add notes about rate discrepancies, vendor assumptions, scope interpretation differences..."
              style={{ width: '100%', fontSize: '12px', lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Result rendering ────────────────────────────────────────────────────────

function CostModelOutput({ result, doc }: { result: CostModelResult; doc: RfqDocument }) {
  const [showWeeks, setShowWeeks] = useState(true)
  const [showRoles, setShowRoles] = useState(true)
  const [showEquip, setShowEquip] = useState(true)

  if (!result.vendors.length) {
    return <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>No vendor responses to compare.</div>
  }

  const best = result.vendors[0]
  const labourRoles = doc.labour_rows || []
  const equipRows = doc.equip_rows || []

  return (
    <>
      {/* Vendor cards */}
      <div className="card" style={{ marginBottom: '14px', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
          Vendor Ranking
        </div>
        <div style={{ padding: '10px 14px', display: 'grid', gap: '8px' }}>
          {result.vendors.map((v, i) => {
            const isBest = i === 0
            const saving = v.projectedTotal - best.projectedTotal
            return (
              <div key={v.responseId} style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
                border: `1.5px solid ${isBest ? '#16a34a' : 'var(--border)'}`,
                borderRadius: '6px',
                background: isBest ? '#f0fdf4' : 'var(--bg2)',
              }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: isBest ? '#16a34a' : 'var(--text3)', width: '28px', textAlign: 'center' }}>
                  {isBest ? '★' : '#' + (i + 1)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>{v.vendor}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
                    Labour: {fmtMoney(v.labourCost)} · Equip: {fmtMoney(v.equipCost)}
                    {v.totalQuote != null && (
                      <>
                        {' · '}Quoted: <strong>{fmtMoneyDec(v.totalQuote)}</strong> {v.currency}
                        {v.variance != null && (
                          <span style={{ color: v.variance > 0 ? 'var(--red)' : 'var(--green)', marginLeft: '4px' }}>
                            ({v.variance >= 0 ? '+' : ''}{fmtMoneyDec(v.variance)}{v.variancePct != null ? ' / ' + fmtPct(v.variancePct) : ''})
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: isBest ? '#16a34a' : 'var(--text)' }}>
                  {fmtMoneyDec(v.projectedTotal)}
                </div>
                {!isBest && (
                  <div style={{ fontSize: '10px', color: '#ea580c', fontWeight: 600 }}>
                    +{fmtMoneyDec(saving)} vs best
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-role breakdown */}
      {labourRoles.length > 0 && (
        <div className="card" style={{ marginBottom: '14px', padding: 0, overflow: 'hidden' }}>
          <div onClick={() => setShowRoles(!showRoles)} style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: showRoles ? '1px solid var(--border)' : 'none', background: 'var(--bg3)', cursor: 'pointer', userSelect: 'none' }}>
            {showRoles ? '▼' : '▶'} Per-Role Breakdown
          </div>
          {showRoles && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '11px', minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Vendor</th>
                    {labourRoles.map((r, i) => <th key={i} style={{ textAlign: 'right' }}>{r.role}</th>)}
                    <th style={{ textAlign: 'right' }}>Labour Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.vendors.map(v => (
                    <tr key={v.responseId}>
                      <td style={{ fontWeight: 600 }}>{v.vendor}</td>
                      {labourRoles.map((_, ri) => {
                        const role = v.roles.find(rr => rr.roleIndex === ri)
                        return <td key={ri} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{role && role.totalCost > 0 ? fmtMoney(role.totalCost) : '—'}</td>
                      })}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtMoney(v.labourCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Weekly breakdown */}
      {result.weekKeys.length > 0 && (
        <div className="card" style={{ marginBottom: '14px', padding: 0, overflow: 'hidden' }}>
          <div onClick={() => setShowWeeks(!showWeeks)} style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: showWeeks ? '1px solid var(--border)' : 'none', background: 'var(--bg3)', cursor: 'pointer', userSelect: 'none' }}>
            {showWeeks ? '▼' : '▶'} Weekly Breakdown (Labour) — {result.weekKeys.length} week{result.weekKeys.length !== 1 ? 's' : ''}
          </div>
          {showWeeks && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '11px', minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Vendor</th>
                    {result.weekKeys.map(wk => <th key={wk} style={{ textAlign: 'right' }}>{fmtDate(wk)}</th>)}
                    <th style={{ textAlign: 'right' }}>Labour Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.vendors.map(v => {
                    const weekTotals: Record<string, number> = {}
                    for (const r of v.roles) for (const w of r.perWeek) weekTotals[w.weekKey] = (weekTotals[w.weekKey] || 0) + w.cost
                    return (
                      <tr key={v.responseId}>
                        <td style={{ fontWeight: 600 }}>{v.vendor}</td>
                        {result.weekKeys.map(wk => (
                          <td key={wk} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                            {weekTotals[wk] ? fmtMoney(weekTotals[wk]) : '—'}
                          </td>
                        ))}
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtMoney(v.labourCost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Equipment breakdown */}
      {equipRows.length > 0 && (
        <div className="card" style={{ marginBottom: '14px', padding: 0, overflow: 'hidden' }}>
          <div onClick={() => setShowEquip(!showEquip)} style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: showEquip ? '1px solid var(--border)' : 'none', background: 'var(--bg3)', cursor: 'pointer', userSelect: 'none' }}>
            {showEquip ? '▼' : '▶'} Equipment Breakdown
          </div>
          {showEquip && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '11px', minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Vendor</th>
                    {equipRows.map((e, i) => <th key={i} style={{ textAlign: 'right' }}>{e.desc}</th>)}
                    <th style={{ textAlign: 'right' }}>Equip Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.vendors.map(v => (
                    <tr key={v.responseId}>
                      <td style={{ fontWeight: 600 }}>{v.vendor}</td>
                      {equipRows.map((er, i) => {
                        const ec = v.equip.find(eq => eq.desc === er.desc)
                        return <td key={i} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{ec && ec.totalCost > 0 ? fmtMoney(ec.totalCost) : '—'}</td>
                      })}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtMoney(v.equipCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
