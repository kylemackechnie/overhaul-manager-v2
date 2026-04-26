import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { computeCostModel, type CostModelShiftPattern, type CostModelResult, type PerVendorResult } from '../../engines/costModelEngine'
import type { RfqDocument, RfqResponse, PublicHoliday } from '../../types'

type Pattern = CostModelShiftPattern

const fmt  = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
const fmt2 = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%'

const notesKey = (docId: string) => `rfq_cost_notes_${docId}`

const TH_STYLE: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid var(--border2)', background: 'var(--bg3)',
  fontSize: '10px', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap',
}
const TH_LEFT: React.CSSProperties = { ...TH_STYLE, textAlign: 'left' }
const TH_CTR:  React.CSSProperties = { ...TH_STYLE, textAlign: 'center' }
const TD_STYLE: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid var(--border2)', fontSize: '11px',
  textAlign: 'right', fontFamily: 'var(--mono)',
}
const TD_LEFT: React.CSSProperties = { ...TD_STYLE, textAlign: 'left', fontFamily: 'inherit' }
const TD_CTR:  React.CSSProperties = { ...TD_STYLE, textAlign: 'center', fontFamily: 'inherit' }
const TD_BOLD: React.CSSProperties = { ...TD_STYLE, fontWeight: 700 }
const TD_GREEN: React.CSSProperties = { ...TD_STYLE, color: 'var(--green)', fontWeight: 700 }

// ─── Panel ────────────────────────────────────────────────────────────────────

export function SubconCostModelPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [docs, setDocs] = useState<RfqDocument[]>([])
  const [responses, setResponses] = useState<RfqResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

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

  useEffect(() => {
    if (!selectedDocId) return
    const doc = docs.find(d => d.id === selectedDocId)
    if (!doc) return
    if (doc.start_date) setStartDate(doc.start_date)
    if (doc.end_date) setEndDate(doc.end_date)
    const hc: Record<number, number> = {}
    ;(doc.labour_rows || []).forEach((lr, i) => { hc[i] = lr.qty || 1 })
    setHeadcounts(hc)
    try { setNotes(localStorage.getItem(notesKey(doc.id)) || '') } catch { /* ignore */ }
  }, [selectedDocId, docs])

  function saveNotes(value: string) {
    setNotes(value)
    if (!selectedDocId) return
    try { localStorage.setItem(notesKey(selectedDocId), value) } catch { /* ignore */ }
  }

  const selectedDoc = useMemo(() => docs.find(d => d.id === selectedDocId) || null, [docs, selectedDocId])
  const selectedResponses = useMemo(
    () => selectedDocId ? responses.filter(r => r.rfq_document_id === selectedDocId) : [],
    [responses, selectedDocId],
  )
  const eligibleDocs = useMemo(() => {
    const ids = new Set(responses.map(r => r.rfq_document_id))
    return docs.filter(d => ids.has(d.id))
  }, [docs, responses])

  const result = useMemo(() => {
    if (!selectedDoc || !selectedResponses.length || !startDate || !endDate) return null
    if (endDate <= startDate) return null
    const phs: PublicHoliday[] = (activeProject?.public_holidays || []) as PublicHoliday[]
    return computeCostModel(selectedDoc, selectedResponses, { startDate, endDate, pattern, headcountOverrides: headcounts }, phs)
  }, [selectedDoc, selectedResponses, startDate, endDate, pattern, headcounts, activeProject])

  function printReport() {
    if (!result || !selectedDoc) return
    const win = window.open('', '_blank', 'width=1200,height=820')
    if (!win) { toast('Popup blocked — allow popups for this site', 'error'); return }
    win.document.write(buildPrintHTML(result, selectedDoc, startDate, endDate, pattern, notes, activeProject?.name || ''))
    win.document.close()
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Cost Model</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Compare projected costs across vendor responses for an RFQ</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('subcon-rfq-register')}>← RFQ Register</button>
          {result && <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff' }} onClick={printReport}>🖨 Print</button>}
        </div>
      </div>

      {/* RFQ picker */}
      {!selectedDocId ? (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Select an RFQ to model</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '14px' }}>Only RFQs with at least one logged vendor response can be cost-modelled.</div>
          {eligibleDocs.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px' }}>
              <div className="icon">📈</div>
              <h3>No RFQs ready for cost modelling</h3>
              <p>Create an RFQ document, log at least one vendor response, then return here.</p>
              <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff', marginTop: '12px' }} onClick={() => setActivePanel('subcon-rfq-register')}>→ Go to RFQ Register</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {eligibleDocs.map(d => {
                const cnt = responses.filter(r => r.rfq_document_id === d.id).length
                return (
                  <button key={d.id} onClick={() => setSelectedDocId(d.id)} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg2)', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{d.title || 'Untitled'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                      {(d.labour_rows || []).length} labour roles · {(d.equip_rows || []).length} equip items · <span style={{ color: 'var(--green)' }}>{cnt} vendor response{cnt !== 1 ? 's' : ''}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : !selectedDoc ? null : (
        <>
          {/* RFQ header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700 }}>{selectedDoc.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
                {selectedResponses.length} vendor response{selectedResponses.length !== 1 ? 's' : ''} · {(selectedDoc.labour_rows || []).length} labour roles · {(selectedDoc.equip_rows || []).length} equip items
              </div>
            </div>
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelectedDocId(null)}>Change RFQ</button>
          </div>

          {/* Vendor response chips */}
          <div className="card" style={{ marginBottom: '14px', padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px' }}>Vendor Responses</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedResponses.map(r => (
                <div key={r.id} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg3)', fontSize: '11px' }}>
                  <div style={{ fontWeight: 600 }}>{r.vendor}</div>
                  <div style={{ color: 'var(--text3)' }}>{r.received_date ? fmtD(r.received_date) : 'No date'} · {r.currency || 'AUD'}{r.total_quote != null ? ' · ' + fmt2(r.total_quote) : ''}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Modelling params */}
          <div className="card" style={{ marginBottom: '14px', padding: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '10px' }}>Modelling Parameters</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div className="fg" style={{ margin: 0 }}><label>Start Date *</label><input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
              <div className="fg" style={{ margin: 0 }}><label>End Date *</label><input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
              <div className="fg" style={{ margin: 0 }}>
                <label>Shift Pattern</label>
                <select className="input" value={pattern} onChange={e => setPattern(e.target.value as Pattern)}>
                  <option value="weekday">Mon–Fri</option>
                  <option value="sevenDay">7-Day</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>🇦🇺 Project public holidays applied automatically · Shift type per role definition · Roles costed within their date windows only</div>
          </div>

          {/* Headcount overrides */}
          {(selectedDoc.labour_rows || []).length > 0 && (
            <div className="card" style={{ marginBottom: '14px', padding: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '10px' }}>
                Role Headcount <span style={{ fontWeight: 400, color: 'var(--text3)' }}>— override quantities from RFQ document</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {(selectedDoc.labour_rows || []).map((lr, li) => {
                  const window2 = lr.durMode === 'dates' && lr.dateStart ? `${fmtD(lr.dateStart)}–${fmtD(lr.dateEnd)}` : 'full range'
                  const shift = lr.shiftType === 'dual' ? 'Dual' : lr.shiftType === 'single-night' ? 'NS Only' : 'DS Only'
                  return (
                    <div key={li} className="fg" style={{ margin: 0, width: '180px' }}>
                      <label style={{ fontSize: '10px' }}>{lr.role || `Role ${li + 1}`}</label>
                      <div style={{ fontSize: '9px', color: 'var(--text3)', marginBottom: '2px' }}>{window2} · {shift}</div>
                      <input className="input" type="number" min={0} step={1} style={{ fontSize: '11px' }}
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
            <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>Enter start and end dates above to compute the cost model.</div>
          ) : (
            <CostModelOutput result={result} doc={selectedDoc} startDate={startDate} endDate={endDate} />
          )}

          {/* Notes */}
          <div className="card" style={{ marginTop: '16px', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)' }}>Analysis Notes</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>— included in print output</div>
            </div>
            <textarea className="input" rows={6} value={notes} onChange={e => saveNotes(e.target.value)}
              placeholder="Add notes about rate discrepancies, vendor assumptions, scope interpretation differences..."
              style={{ width: '100%', fontSize: '12px', lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Output component ─────────────────────────────────────────────────────────

function CostModelOutput({ result, doc, startDate, endDate }: { result: CostModelResult; doc: RfqDocument; startDate: string; endDate: string }) {
  const [showDayByDay, setShowDayByDay] = useState(false)
  const labourRoles = doc.labour_rows || []
  const equipRows   = doc.equip_rows  || []

  if (!result.vendors.length) {
    return <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>No vendor responses to compare.</div>
  }

  const best = result.vendors[0]
  const multiVendor = result.vendors.length > 1

  // ── Summary line ──────────────────────────────────────────────────────────
  const summaryLine = `${fmtD(startDate)} → ${fmtD(endDate)} · ${result.totalDays} working days · ${result.weekKeys.length} weeks${result.phCount ? ` · ${result.phCount} public holiday${result.phCount !== 1 ? 's' : ''}` : ''}`

  return (
    <>
      {/* ── Cost Summary header ─────────────────────────────────────────── */}
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
        Cost Summary — {summaryLine}
        {result.phCount > 0 && <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--orange)', marginLeft: '8px' }}>{result.phCount} public holiday{result.phCount !== 1 ? 's' : ''}</span>}
      </div>

      {/* ── Vendor ranking cards with weekly pills ─────────────────────── */}
      <div style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        {result.vendors.map((v, rank) => {
          const isBest = rank === 0
          const saving = v.projectedTotal - best.projectedTotal
          const pct = best.projectedTotal > 0 ? saving / best.projectedTotal * 100 : 0
          return (
            <div key={v.responseId} style={{ border: `2px solid ${isBest ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: isBest ? '#f0fdf4' : 'var(--bg2)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: isBest ? 'var(--green)' : 'var(--text3)', width: '24px' }}>#{rank + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {v.vendor} {isBest && <span style={{ fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '10px' }}>CHEAPEST</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                    Labour: {fmt(v.labourCost)}{v.equipCost > 0 ? ` · Equipment: ${fmt(v.equipCost)}` : ''}
                    {v.totalQuote != null && <> · Quoted: <strong>{fmt2(v.totalQuote)}</strong> {v.currency}{v.variance != null && <span style={{ color: v.variance > 0 ? 'var(--orange)' : 'var(--green)', marginLeft: 4 }}>({v.variance >= 0 ? '+' : ''}{fmt2(v.variance)} / {fmtPct(v.variancePct ?? 0)})</span>}</>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '22px', fontWeight: 700, color: isBest ? 'var(--green)' : 'var(--text)' }}>{fmt(v.projectedTotal)}</div>
                  {saving > 0 && <div style={{ fontSize: '11px', color: 'var(--orange)' }}>+{fmt(saving)} (+{pct.toFixed(1)}%) vs cheapest</div>}
                </div>
              </div>
              {/* Weekly cost pills */}
              <div style={{ padding: '8px 18px 12px', borderTop: `1px solid ${isBest ? '#bbf7d0' : 'var(--border)'}` }}>
                <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Weekly Cost (Labour + Equipment)</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {v.weekSummaries.map(w => (
                    <div key={w.weekKey} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 8px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: '5px', minWidth: '64px' }}>
                      <div style={{ fontSize: '9px', color: 'var(--text3)', marginBottom: '1px' }}>{w.weekKey.slice(5)}</div>
                      <div style={{ fontSize: '11px', fontWeight: 600, fontFamily: 'var(--mono)', color: isBest ? 'var(--green)' : 'var(--text)' }}>{w.totalCost > 0 ? fmt(w.totalCost) : '—'}</div>
                      {w.phDays > 0 && <div style={{ fontSize: '8px', color: 'var(--orange)' }}>{w.phDays} PH</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Labour / LAHA / Equipment summary table ─────────────────────── */}
      <SectionTable title="Cost Component Breakdown">
        <thead><tr>
          <th style={TH_LEFT}>Cost Component</th>
          {result.vendors.map(v => <th key={v.responseId} style={TH_STYLE}>{v.vendor}</th>)}
          {multiVendor && <th style={{ ...TH_STYLE, color: 'var(--text3)' }}>Saving</th>}
        </tr></thead>
        <tbody>
          {([
            ['Shift Labour', (v: PerVendorResult) => v.shiftGrandTotal],
            ['LAHA', (v: PerVendorResult) => v.lahaGrandTotal],
            ['Equipment', (v: PerVendorResult) => v.equipCost],
          ] as [string, (v: PerVendorResult) => number][]).map(([label, fn]) => {
            const vals = result.vendors.map(v => fn(v))
            const min = Math.min(...vals.filter(x => x > 0))
            const max = Math.max(...vals.filter(x => x > 0))
            return (
              <tr key={label}>
                <td style={{ ...TD_LEFT, fontWeight: 600 }}>{label}</td>
                {vals.map((val, vi) => <td key={vi} style={TD_STYLE}>{val > 0 ? fmt(val) : '—'}</td>)}
                {multiVendor && <td style={{ ...TD_STYLE, color: 'var(--text3)' }}>{vals.filter(x => x > 0).length > 1 ? fmt(max - min) : '—'}</td>}
              </tr>
            )
          })}
          <tr style={{ background: 'var(--bg3)' }}>
            <td style={{ ...TD_LEFT, fontWeight: 700, fontSize: '12px' }}>Total</td>
            {result.vendors.map((v, vi) => <td key={vi} style={vi === 0 ? TD_GREEN : TD_BOLD}>{fmt(v.projectedTotal)}</td>)}
            {multiVendor && <td style={TD_BOLD}>{fmt(result.vendors[result.vendors.length - 1].projectedTotal - result.vendors[0].projectedTotal)}</td>}
          </tr>
        </tbody>
      </SectionTable>

      {/* ── Cumulative cost SVG chart ────────────────────────────────────── */}
      {result.weekKeys.length >= 2 && <CumulativeChart result={result} />}

      {/* ── Weekly cost table ────────────────────────────────────────────── */}
      <SectionTitle>Weekly Cost</SectionTitle>
      <SectionTable>
        <thead><tr>
          <th style={TH_LEFT}>Week</th>
          <th style={TH_CTR}>Days</th>
          <th style={TH_CTR}>PH</th>
          {result.vendors.map(v => <th key={v.responseId} style={TH_STYLE}>{v.vendor}</th>)}
          {multiVendor && <th style={{ ...TH_STYLE, color: 'var(--text3)' }}>Saving</th>}
        </tr></thead>
        <tbody>
          {result.weekKeys.map(wk => {
            const sums = result.vendors.map(v => v.weekSummaries.find(w => w.weekKey === wk)?.labourCost || 0)
            const meta = result.vendors[0].weekSummaries.find(w => w.weekKey === wk)
            const minC = Math.min(...sums.filter(c => c > 0))
            return (
              <tr key={wk}>
                <td style={{ ...TD_STYLE, fontFamily: 'var(--mono)', textAlign: 'left', fontSize: '10px' }}>{wk}</td>
                <td style={TD_CTR}>{meta?.days || 0}</td>
                <td style={{ ...TD_CTR, color: meta?.phDays ? 'var(--orange)' : 'var(--text3)' }}>{meta?.phDays || '—'}</td>
                {sums.map((c, ci) => {
                  const isBest = c === minC && c > 0 && sums.filter(x => x > 0).length > 1
                  return <td key={ci} style={isBest ? TD_GREEN : TD_STYLE}>{c > 0 ? fmt(c) : '—'}</td>
                })}
                {multiVendor && <td style={{ ...TD_STYLE, color: 'var(--text3)' }}>{sums.filter(c => c > 0).length > 1 ? fmt(Math.max(...sums) - minC) : '—'}</td>}
              </tr>
            )
          })}
          <tr style={{ background: 'var(--bg3)' }}>
            <td colSpan={3} style={{ ...TD_LEFT, fontWeight: 700, fontSize: '11px' }}>Total</td>
            {result.vendors.map((v, vi) => <td key={vi} style={vi === 0 ? TD_GREEN : TD_BOLD}>{fmt(v.labourCost)}</td>)}
            {multiVendor && <td style={TD_BOLD}>{fmt(result.vendors[result.vendors.length - 1].labourCost - result.vendors[0].labourCost)}</td>}
          </tr>
        </tbody>
      </SectionTable>

      {/* ── Cost by Role (with shift counts) ────────────────────────────── */}
      {labourRoles.length > 0 && (
        <>
          <SectionTitle>Cost by Role — Total over Engagement</SectionTitle>
          {/* Day-by-day toggle */}
          <details style={{ marginBottom: '14px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
            <summary style={{ padding: '8px 12px', background: 'var(--bg3)', cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: 'var(--text2)', userSelect: 'none' }}>
              🔍 Day-by-Day Cost Breakdown — click to expand
            </summary>
            <DayByDayTable result={result} doc={doc} startDate={startDate} endDate={endDate} />
          </details>
          <SectionTable>
            <thead><tr>
              <th style={TH_LEFT}>Role</th>
              <th style={TH_CTR}>Qty</th>
              <th style={TH_CTR}>Shift</th>
              <th style={TH_CTR}>Active Period</th>
              <th style={{ ...TH_CTR, background: '#fef9c3', color: '#854d0e' }}>WD<br />Shifts</th>
              <th style={{ ...TH_CTR, background: '#fef9c3', color: '#854d0e' }}>Sat<br />Shifts</th>
              <th style={{ ...TH_CTR, background: '#fef9c3', color: '#854d0e' }}>Sun<br />Shifts</th>
              <th style={{ ...TH_CTR, background: '#fef9c3', color: '#854d0e' }}>Total<br />Shifts</th>
              {result.vendors.map(v => <th key={v.responseId} style={TH_STYLE}>{v.vendor}</th>)}
              {multiVendor && <th style={{ ...TH_STYLE, color: 'var(--text3)' }}>Saving</th>}
            </tr></thead>
            <tbody>
              {labourRoles.map((lr, li) => {
                const roleCosts = result.vendors.map(v => v.roles[li]?.totalCost || 0)
                const minC = Math.min(...roleCosts.filter(c => c > 0))
                const maxC = Math.max(...roleCosts.filter(c => c > 0))
                const hasDiff = roleCosts.filter(c => c > 0).length > 1
                const ref = result.vendors[0].roles[li]
                const wdS = (ref?.wdShifts || 0) * (ref?.headcount || 1)
                const satS = (ref?.satShifts || 0) * (ref?.headcount || 1)
                const sunS = (ref?.sunShifts || 0) * (ref?.headcount || 1)
                const totalS = ref?.totalShifts || 0
                const shiftLabel = lr.shiftType === 'dual' ? 'Dual' : lr.shiftType === 'single-night' ? 'NS Only' : 'DS Only'
                return (
                  <tr key={li}>
                    <td style={{ ...TD_LEFT, fontWeight: 600 }}>{lr.role}</td>
                    <td style={TD_CTR}>{lr.qty || 1}</td>
                    <td style={TD_CTR}>{shiftLabel}</td>
                    <td style={{ ...TD_CTR, color: 'var(--text3)', fontSize: '10px' }}>{ref?.activePeriod || 'Full range'}</td>
                    <td style={{ ...TD_CTR, background: '#fefce8', fontFamily: 'var(--mono)' }}>{wdS || '—'}</td>
                    <td style={{ ...TD_CTR, background: '#fefce8', fontFamily: 'var(--mono)' }}>{satS || '—'}</td>
                    <td style={{ ...TD_CTR, background: '#fefce8', fontFamily: 'var(--mono)' }}>{sunS || '—'}</td>
                    <td style={{ ...TD_CTR, background: '#fefce8', fontFamily: 'var(--mono)', fontWeight: 700 }}>{totalS || '—'}</td>
                    {roleCosts.map((c, ci) => {
                      const isBest = c === minC && c > 0 && hasDiff
                      return <td key={ci} style={isBest ? TD_GREEN : TD_STYLE}>{c > 0 ? fmt(c) : '—'}</td>
                    })}
                    {multiVendor && <td style={{ ...TD_STYLE, color: 'var(--text3)' }}>{hasDiff ? fmt(maxC - minC) : '—'}</td>}
                  </tr>
                )
              })}
              <tr style={{ background: 'var(--bg3)' }}>
                <td colSpan={8} style={{ ...TD_LEFT, fontWeight: 700 }}>Labour Total</td>
                {result.vendors.map((v, vi) => <td key={vi} style={vi === 0 ? TD_GREEN : TD_BOLD}>{fmt(v.labourCost)}</td>)}
                {multiVendor && <td style={TD_BOLD}>{fmt(result.vendors[result.vendors.length - 1].labourCost - result.vendors[0].labourCost)}</td>}
              </tr>
            </tbody>
          </SectionTable>
        </>
      )}

      {/* ── Cost per Shift by Role ──────────────────────────────────────── */}
      {labourRoles.length > 0 && (
        <>
          <SectionTitle>Cost per Shift — by Role <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>(shift cost + LAHA per person-position)</span></SectionTitle>
          <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={TH_LEFT}>Role</th>
                  <th style={TH_CTR}>Qty</th>
                  <th style={TH_CTR}>Shift</th>
                  {result.vendors.map(v => (
                    <th key={v.responseId} style={{ ...TH_STYLE, textAlign: 'center' }} colSpan={4}>{v.vendor}</th>
                  ))}
                </tr>
                <tr>
                  <th colSpan={3} style={{ border: '1px solid var(--border2)', background: 'var(--bg3)' }} />
                  {result.vendors.map(v => (
                    ['Weekday', 'Saturday', 'Sunday', 'PH'].map(d => (
                      <th key={v.responseId + d} style={{ ...TH_STYLE, fontSize: '9px', color: 'var(--text3)' }}>{d}</th>
                    ))
                  ))}
                </tr>
              </thead>
              <tbody>
                {labourRoles.map((lr, li) => {
                  const isDual = lr.shiftType === 'dual'
                  const isNS   = lr.shiftType === 'single-night'
                  // LAHA multiplier per day type per position
                  const lahaMulMap = { wd: isDual ? 2 : 1, sat: isNS ? 0 : 1, sun: (isDual || isNS) ? 1 : 0, ph: isDual ? 2 : 1 }
                  const shiftLabel = isDual ? 'Dual' : isNS ? 'NS Only' : 'DS Only'

                  return [
                    // Row 1: shift only
                    <tr key={`${li}-shift`}>
                      <td style={{ ...TD_LEFT, fontWeight: 600 }} rowSpan={2}>{lr.role}</td>
                      <td style={TD_CTR} rowSpan={2}>{lr.qty || 1}</td>
                      <td style={TD_CTR} rowSpan={2}>{shiftLabel}</td>
                      {result.vendors.map(v => {
                        const rb = v.roles[li]
                        if (!rb) return ['wd','sat','sun','ph'].map((_, ti) => <td key={ti} style={{ ...TD_STYLE, color: 'var(--text3)' }} rowSpan={2}>—</td>)
                        const costs: Record<string, number> = { wd: rb.wdCost, sat: rb.satCost, sun: rb.sunCost, ph: rb.phCost }
                        return ['wd','sat','sun','ph'].map(t => {
                          const allCosts = result.vendors.map(vv => vv.roles[li]?.[t === 'wd' ? 'wdCost' : t === 'sat' ? 'satCost' : t === 'sun' ? 'sunCost' : 'phCost'] || 0)
                          const minC = Math.min(...allCosts.filter(c => c > 0))
                          const isBest = costs[t] > 0 && costs[t] === minC && allCosts.filter(c => c > 0).length > 1
                          return <td key={t} style={isBest ? TD_GREEN : TD_STYLE}>{costs[t] > 0 ? fmt2(costs[t]) : '—'}</td>
                        })
                      })}
                    </tr>,
                    // Row 2: shift + LAHA
                    <tr key={`${li}-total`} style={{ background: 'var(--bg2)' }}>
                      {result.vendors.map(v => {
                        const rb = v.roles[li]
                        if (!rb) return null
                        const costs: Record<string, number> = { wd: rb.wdCost, sat: rb.satCost, sun: rb.sunCost, ph: rb.phCost }
                        return ['wd','sat','sun','ph'].map(t => {
                          const laha = (rb.lahaPerDay || 0) * (lahaMulMap[t as keyof typeof lahaMulMap] || 0)
                          const total = costs[t] + laha
                          const allTotals = result.vendors.map(vv => {
                            const rbb = vv.roles[li]
                            const c = rbb?.[t === 'wd' ? 'wdCost' : t === 'sat' ? 'satCost' : t === 'sun' ? 'sunCost' : 'phCost'] || 0
                            return c + (rbb?.lahaPerDay || 0) * (lahaMulMap[t as keyof typeof lahaMulMap] || 0)
                          })
                          const minT = Math.min(...allTotals.filter(c => c > 0))
                          const isBest = total > 0 && total === minT && allTotals.filter(c => c > 0).length > 1
                          return <td key={t} style={{ ...TD_STYLE, fontSize: '9px', color: isBest ? 'var(--green)' : 'var(--text3)' }} title={laha > 0 ? `+$${laha.toFixed(0)} LAHA` : ''}>{total > 0 ? fmt(total) : '—'}</td>
                        })
                      })}
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '6px' }}>Top row: shift labour only · Bottom row: shift + LAHA · Hover bottom row for LAHA breakdown · LAHA doubles on dual-shift weekdays (2 crews)</div>
          </div>
        </>
      )}

      {/* ── Equipment breakdown ─────────────────────────────────────────── */}
      {equipRows.length > 0 && (
        <>
          <SectionTitle>Equipment Breakdown</SectionTitle>
          <SectionTable>
            <thead><tr>
              <th style={TH_LEFT}>Vendor</th>
              {equipRows.map((e, i) => <th key={i} style={TH_STYLE}>{e.desc}</th>)}
              <th style={TH_STYLE}>Equip Total</th>
            </tr></thead>
            <tbody>
              {result.vendors.map(v => (
                <tr key={v.responseId}>
                  <td style={{ ...TD_LEFT, fontWeight: 600 }}>{v.vendor}</td>
                  {equipRows.map((er, i) => {
                    const ec = v.equip.find(eq => eq.desc === er.desc)
                    return <td key={i} style={TD_STYLE}>{ec && ec.totalCost > 0 ? fmt(ec.totalCost) : '—'}</td>
                  })}
                  <td style={TD_BOLD}>{fmt(v.equipCost)}</td>
                </tr>
              ))}
            </tbody>
          </SectionTable>
        </>
      )}

      {/* ── Per-vendor rate card + weekly person snapshot ───────────────── */}
      {labourRoles.length > 0 && result.vendors.map(v => (
        <VendorRateSnapshot key={v.responseId} vendor={v} doc={doc} startDate={startDate} />
      ))}
    </>
  )
}

// ─── Vendor Rate Card + Weekly Person Snapshot ────────────────────────────────

function VendorRateSnapshot({ vendor: v, doc, startDate }: { vendor: PerVendorResult; doc: RfqDocument; startDate: string }) {
  const labourRoles = doc.labour_rows || []
  const fmtS = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

  // Build snap week: Mon of the start week
  const snapMon = (() => {
    const d = new Date(startDate + 'T00:00:00')
    const dow = d.getDay()
    const mon = new Date(d)
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
    return mon
  })()
  const snapDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(snapMon); d.setDate(snapMon.getDate() + i); return d
  })
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const hStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid var(--border2)', background: 'var(--bg3)', fontSize: '9px', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }
  const cStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid var(--border2)', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '9px', whiteSpace: 'nowrap', verticalAlign: 'top' }

  return (
    <div style={{ marginBottom: '24px' }}>
      <SectionTitle>{v.vendor} — Rate Card &amp; Daily Snapshot</SectionTitle>

      {/* Rate card */}
      <div style={{ overflowX: 'auto', marginBottom: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
          <thead><tr>
            {['Role', 'Shift', 'DS NT $/hr', 'DS T1.5 $/hr', 'DS DT $/hr', 'DS NT hrs', 'DS T1.5 hrs', 'DS total hrs', 'NS NT $/hr', 'NS DT $/hr', 'NS NT hrs', 'NS total hrs', 'LAHA/day'].map(h => (
              <th key={h} style={h === 'Role' ? { ...hStyle, textAlign: 'left', minWidth: '140px' } : hStyle}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {labourRoles.map((lr, li) => {
              const rb = v.roles[li]
              const resp = v.roles[li]
              // find raw rates from response
              const rawRates = resp ? {
                dnt: 0, dt15: 0, ddt: 0, ntHrs: 0, ot1Hrs: 0, shiftHrs: 0,
                nnt: 0, ndt: 0, nntHrs: 0, nshiftHrs: 0, laha: 0, ...({} as Record<string, number>)
              } : null
              // We don't have raw rates on the result — use per-day costs as proxies
              const isDual = lr.shiftType === 'dual'
              const isNS   = lr.shiftType === 'single-night'
              const showDS = !isNS, showNS = isDual || isNS
              const na = '—'
              if (!rb) return <tr key={li}><td style={{ ...cStyle, textAlign: 'left', fontWeight: 600 }}>{lr.role}</td><td colSpan={12} style={{ ...cStyle, textAlign: 'center', color: 'var(--text3)' }}>No rates provided</td></tr>
              return (
                <tr key={li}>
                  <td style={{ ...cStyle, textAlign: 'left', fontWeight: 600 }}>{lr.role}</td>
                  <td style={{ ...cStyle, textAlign: 'center' }}>{isDual ? 'Dual' : isNS ? 'NS Only' : 'DS Only'}</td>
                  {/* DS columns — show weekday cost as proxy since we only have aggregated costs */}
                  <td style={{ ...cStyle, color: showDS ? 'inherit' : 'var(--text3)' }}>{showDS ? fmtS(rb.wdCost) + '*' : na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: showNS ? 'inherit' : 'var(--text3)' }}>{showNS ? fmtS(rb.sunCost) + '*' : na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, color: 'var(--text3)' }}>{na}</td>
                  <td style={{ ...cStyle, fontWeight: 600 }}>{rb.lahaPerDay > 0 ? '$' + rb.lahaPerDay.toFixed(0) : na}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ fontSize: '8px', color: 'var(--text3)', marginTop: '2px' }}>* Weekday shift cost shown (aggregated — detailed rate card not shown). Hourly breakdown visible in the vendor's response.</div>
      </div>

      {/* Weekly person snapshot */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
          <thead><tr>
            <th style={{ ...hStyle, textAlign: 'left', minWidth: '180px' }}>Person</th>
            {snapDays.map((d, i) => {
              const dow = d.getDay()
              const label = dayLabels[i] + ' ' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
              const isWeekend = dow === 0 || dow === 6
              return <th key={i} style={{ ...hStyle, color: isWeekend ? 'var(--text3)' : 'inherit' }}>{label}</th>
            })}
            <th style={hStyle}>Week Total</th>
          </tr></thead>
          <tbody>
            {labourRoles.flatMap((lr, li) => {
              const rb = v.roles[li]
              if (!rb) return []
              const hc = rb.headcount
              const isDual = lr.shiftType === 'dual'
              const isNS   = lr.shiftType === 'single-night'
              const crews = isDual ? ['Day', 'Night'] : isNS ? ['Night'] : ['Day']

              return Array.from({ length: hc }, (_, p) =>
                crews.map(crew => {
                  const isNight = crew === 'Night'
                  const label = `${lr.role} #${p + 1}${(isDual || isNS) ? ` (${crew})` : ''}`
                  let weekTotal = 0
                  const cells = snapDays.map((d, di) => {
                    const dow = d.getDay()
                    const isSat = dow === 6, isSun = dow === 0
                    const dayType: 'weekday' | 'saturday' | 'sunday' = isSun ? 'sunday' : isSat ? 'saturday' : 'weekday'
                    const worksToday = isNight
                      ? (isDual || isNS) // night crew works every day in dual/NS
                      : !isNS           // day crew works every day (mon-sun in 7day, mon-fri in weekday)
                    const lahaDay = rb.lahaPerDay || 0
                    const lahaMulV = isDual ? (dow !== 0 && dow !== 6 ? 2 : 1) : 1

                    if (!worksToday) {
                      weekTotal += lahaDay
                      return (
                        <td key={di} style={{ ...cStyle, color: 'var(--text3)' }} title="Rest day">
                          {lahaDay > 0 ? <span style={{ fontSize: '8px' }}>LAHA<br />${lahaDay.toFixed(0)}</span> : '—'}
                        </td>
                      )
                    }

                    const shiftCost = isNight ? rb.sunCost /* use sun as NS proxy */ : (dayType === 'saturday' ? rb.satCost : dayType === 'sunday' ? rb.sunCost : rb.wdCost)
                    weekTotal += shiftCost + lahaDay
                    return (
                      <td key={di} style={cStyle} title={`Labour: $${shiftCost.toFixed(0)} | LAHA: $${lahaDay.toFixed(0)}`}>
                        <span style={{ display: 'block' }}>${Math.round(shiftCost).toLocaleString()}</span>
                        {lahaDay > 0 && <span style={{ display: 'block', color: 'var(--text3)', fontSize: '8px' }}>+${lahaDay.toFixed(0)} LAHA</span>}
                      </td>
                    )
                  })

                  return (
                    <tr key={`${li}-${p}-${crew}`}>
                      <td style={{ ...cStyle, textAlign: 'left', fontWeight: 600 }}>{label}</td>
                      {cells}
                      <td style={{ ...cStyle, fontWeight: 700, background: 'var(--bg3)' }}>${Math.round(weekTotal).toLocaleString()}</td>
                    </tr>
                  )
                })
              ).flat()
            })}
          </tbody>
        </table>
        <div style={{ fontSize: '9px', color: 'var(--text3)', marginTop: '4px' }}>
          Snapshot week: {startDate} · Grey cells = rest day (LAHA only) · Hover cells for labour/LAHA split · Note: uses day-type rate as proxy for individual hours
        </div>
      </div>
    </div>
  )
}

// ─── Day-by-Day table (collapsible) ──────────────────────────────────────────

function DayByDayTable({ result, doc, startDate, endDate }: { result: CostModelResult; doc: RfqDocument; startDate: string; endDate: string }) {
  const v0 = result.vendors[0]
  const labourRoles = doc.labour_rows || []
  if (!v0) return null

  // Enumerate all working days across the full range
  const days: Array<{ date: string; type: string; dow: number }> = []
  const cur = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  while (cur <= end) {
    const y = cur.getFullYear(), m = String(cur.getMonth() + 1).padStart(2, '0'), d = String(cur.getDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${d}`
    // Check if this date appears in any vendor's weekly data
    const dow = cur.getDay()
    const isSat = dow === 6, isSun = dow === 0
    const type = isSun ? 'sun' : isSat ? 'sat' : 'wd'
    days.push({ date: dateStr, type, dow })
    cur.setDate(cur.getDate() + 1)
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
        <thead><tr>
          <th style={{ padding: '4px 8px', border: '1px solid var(--border2)', background: 'var(--bg3)', fontSize: '9px', textAlign: 'left' }}>Date</th>
          <th style={{ padding: '4px 8px', border: '1px solid var(--border2)', background: 'var(--bg3)', fontSize: '9px', textAlign: 'center' }}>DoW</th>
          <th style={{ padding: '4px 8px', border: '1px solid var(--border2)', background: 'var(--bg3)', fontSize: '9px', textAlign: 'center' }}>Type</th>
          {labourRoles.map((lr, i) => (
            <th key={i} style={{ padding: '4px 8px', border: '1px solid var(--border2)', background: 'var(--bg3)', fontSize: '9px', textAlign: 'right', maxWidth: '90px' }}>
              {lr.role.split(/[\s/]/).pop()}<br /><span style={{ fontWeight: 400, color: 'var(--text3)' }}>{lr.shiftType}</span>
            </th>
          ))}
        </tr></thead>
        <tbody>
          {days.map(({ date, type, dow }) => (
            <tr key={date}>
              <td style={{ padding: '3px 6px', border: '1px solid var(--border2)', fontFamily: 'monospace', fontSize: '9px', background: '#fff' }}>{date}</td>
              <td style={{ padding: '3px 6px', border: '1px solid var(--border2)', textAlign: 'center', fontSize: '9px' }}>{dayNames[dow]}</td>
              <td style={{ padding: '3px 6px', border: '1px solid var(--border2)', textAlign: 'center', fontFamily: 'monospace', fontSize: '9px' }}>{type}</td>
              {labourRoles.map((lr, li) => {
                const rb = v0.roles[li]
                const roleFrom = (lr.durMode === 'dates' && lr.dateStart) || startDate
                const roleTo   = (lr.durMode === 'dates' && lr.dateEnd) || endDate
                const inWindow = date >= roleFrom && date <= roleTo
                if (!inWindow) return <td key={li} style={{ padding: '3px 6px', border: '1px solid var(--border2)', textAlign: 'right', color: '#9ca3af', background: '#fafafa', fontSize: '9px' }}>out</td>
                if (!rb || rb.totalCost === 0) return <td key={li} style={{ padding: '3px 6px', border: '1px solid var(--border2)', textAlign: 'right', color: '#9ca3af', fontSize: '9px' }}>—</td>
                const dayType: 'weekday' | 'saturday' | 'sunday' | 'publicHoliday' = dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
                const cost: Record<string, number> = { weekday: rb.wdCost, saturday: rb.satCost, sunday: rb.sunCost, publicHoliday: rb.phCost }
                const c = (cost[dayType] || 0) * rb.headcount
                return <td key={li} style={{ padding: '3px 6px', border: '1px solid var(--border2)', textAlign: 'right', fontSize: '9px' }}>{c > 0 ? '$' + Math.round(c).toLocaleString() : '—'}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '5px 10px', fontSize: '9px', color: '#9ca3af', background: '#f9fafb' }}>Costs shown for first vendor only · "out" = outside role window · Hover cells for debug detail</div>
    </div>
  )
}

// ─── Cumulative Cost SVG Chart ────────────────────────────────────────────────

function CumulativeChart({ result }: { result: CostModelResult }) {
  const COLOURS = ['#7c3aed', '#059669', '#2563eb', '#d97706', '#dc2626', '#0891b2']
  const W = 860, H = 220, PAD = { top: 20, right: 20, bottom: 36, left: 72 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const nWeeks = result.weekKeys.length

  const allCums = result.vendors.map(v => {
    let cum = 0
    return v.weekSummaries.map(w => { cum += w.totalCost; return cum })
  })
  const maxVal = Math.max(...allCums.flat(), 1)

  const xPos = (i: number) => PAD.left + (i / (nWeeks - 1)) * innerW
  const yPos = (v: number) => PAD.top + innerH - (v / maxVal) * innerH

  const yTicks = 5
  const tickStep = maxVal / yTicks
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = tickStep * i
    const y = yPos(val)
    const label = val >= 1000 ? '$' + (val / 1000).toFixed(0) + 'k' : '$' + Math.round(val)
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-width="1"/>
            <text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--text3)">${label}</text>`
  }).join('')

  const step = nWeeks > 10 ? 2 : 1
  const xLabels = result.weekKeys.map((wk, i) => {
    if (i % step !== 0 && i !== nWeeks - 1) return ''
    return `<text x="${xPos(i)}" y="${H - PAD.bottom + 14}" text-anchor="middle" font-size="9" fill="var(--text3)">${wk.slice(5)}</text>`
  }).join('')

  const vendorPaths = result.vendors.map((v, ci) => {
    const col = COLOURS[ci % COLOURS.length]
    const cumCosts = allCums[ci]
    const pts = cumCosts.map((c, i) => `${xPos(i)},${yPos(c)}`).join(' ')
    const dots = cumCosts.map((c, i) => `<circle cx="${xPos(i)}" cy="${yPos(c)}" r="3.5" fill="${col}" stroke="white" stroke-width="1.5"/>`).join('')
    return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}`
  }).join('')

  const legend = result.vendors.map((v, ci) =>
    `<g transform="translate(${PAD.left + ci * 140}, ${H - 6})">
      <line x1="0" y1="-4" x2="16" y2="-4" stroke="${COLOURS[ci % COLOURS.length]}" stroke-width="2.5"/>
      <circle cx="8" cy="-4" r="3" fill="${COLOURS[ci % COLOURS.length]}"/>
      <text x="21" y="0" font-size="10" fill="var(--text2)" font-weight="600">${v.vendor}</text>
    </g>`
  ).join('')

  return (
    <div style={{ marginBottom: '20px' }}>
      <SectionTitle>Cumulative Cost — All Vendors</SectionTitle>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: '480px', display: 'block' }}
          dangerouslySetInnerHTML={{ __html: yLines + xLabels + vendorPaths + legend }} />
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px', marginTop: '4px' }}>{children}</div>
}

function SectionTable({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      {title && <SectionTitle>{title}</SectionTitle>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>{children}</table>
      </div>
    </div>
  )
}

// ─── Print HTML builder ───────────────────────────────────────────────────────

function buildPrintHTML(result: CostModelResult, doc: RfqDocument, startDate: string, endDate: string, pattern: string, notes: string, projectName: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const labourRoles = doc.labour_rows || []
  const equipRows   = doc.equip_rows  || []

  const vendorCards = result.vendors.map((v, i) => {
    const isBest = i === 0
    const saving = v.projectedTotal - result.vendors[0].projectedTotal
    return `<div class="vc ${isBest ? 'best' : ''}">
      <div class="vc-rank">${isBest ? '★' : '#' + (i + 1)}</div>
      <div style="flex:1"><div class="vc-name">${esc(v.vendor)}</div>
        <div class="vc-sub">Labour: <b>${fmt(v.labourCost)}</b>${v.equipCost > 0 ? ` · Equip: <b>${fmt(v.equipCost)}</b>` : ''}${v.totalQuote != null ? ` · Quoted: <b>${fmt2(v.totalQuote)}</b>` : ''}</div></div>
      <div><div class="vc-total">${fmt(v.projectedTotal)}</div>${!isBest ? `<div class="vc-saving">+${fmt(saving)} vs cheapest</div>` : ''}</div>
    </div>`
  }).join('')

  // Component breakdown table
  const compRows = [
    ['Shift Labour', (v: PerVendorResult) => v.shiftGrandTotal],
    ['LAHA', (v: PerVendorResult) => v.lahaGrandTotal],
    ['Equipment', (v: PerVendorResult) => v.equipCost],
  ].map(([label, fn]) => {
    const vals = result.vendors.map(v => (fn as (v: PerVendorResult) => number)(v))
    return `<tr><td style="font-weight:600">${esc(label as string)}</td>${vals.map(val => `<td class="num">${val > 0 ? fmt(val) : '—'}</td>`).join('')}</tr>`
  }).join('')

  // Role breakdown table
  const roleHeaderHtml = labourRoles.map(r => `<th>${esc(r.role)}</th><th>Shifts</th>`).join('')
  const roleBodyHtml = result.vendors.map(v => `<tr>
    <td style="font-weight:600">${esc(v.vendor)}</td>
    ${labourRoles.map((_, ri) => {
      const role = v.roles[ri]
      return `<td class="num">${role && role.totalCost > 0 ? fmt(role.totalCost) : '—'}</td><td class="num">${role?.totalShifts || '—'}</td>`
    }).join('')}
    <td class="num" style="font-weight:700">${fmt(v.labourCost)}</td>
  </tr>`).join('')

  // Weekly table
  const weekHeaderHtml = result.weekKeys.map(wk => `<th>${fmtD(wk)}</th>`).join('')
  const weekBodyHtml = result.vendors.map(v => `<tr>
    <td style="font-weight:600">${esc(v.vendor)}</td>
    ${result.weekKeys.map(wk => `<td class="num">${(v.weekSummaries.find(w => w.weekKey === wk)?.labourCost || 0) > 0 ? fmt(v.weekSummaries.find(w => w.weekKey === wk)!.labourCost) : '—'}</td>`).join('')}
    <td class="num" style="font-weight:700">${fmt(v.labourCost)}</td>
  </tr>`).join('')

  const notesSection = notes
    ? `<section><div class="section-title">Analysis Notes</div><div class="notes-body">${esc(notes).split(/\n\n+/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('')}</div></section>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${esc(projectName)} — ${esc(doc.title)} — Cost Comparison</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}@page{size:A4 landscape;margin:12mm 10mm}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:9pt;color:#111;background:#fff;line-height:1.4}
.cover{padding-bottom:10pt;margin-bottom:10pt;border-bottom:2pt solid #7c3aed}
.cover h1{font-size:18pt;font-weight:700;color:#7c3aed;margin-bottom:2pt}
.cover .meta{font-size:8pt;color:#666;margin-bottom:6pt}
.params{display:flex;gap:18pt;background:#f5f5f5;padding:6pt 10pt;border-radius:4pt;font-size:8pt;margin-bottom:8pt}
.params span{color:#666}.params b{color:#111}
.vc{display:flex;align-items:center;gap:10pt;padding:8pt 12pt;border:1.5pt solid #e5e7eb;border-radius:5pt;break-inside:avoid;margin-bottom:6pt}
.vc.best{border-color:#16a34a;background:#f0fdf4}.vc-rank{font-size:13pt;font-weight:700;color:#9ca3af;width:30pt;text-align:center}
.vc.best .vc-rank{color:#16a34a}.vc-name{font-size:11pt;font-weight:700}.vc-sub{font-size:7.5pt;color:#666;margin-top:1pt}
.vc-total{font-size:14pt;font-weight:700;font-family:monospace}.vc.best .vc-total{color:#16a34a}
.vc-saving{font-size:8pt;color:#ea580c}
section{break-before:page;padding-top:2pt}.section-title{font-size:10pt;font-weight:700;color:#374151;margin-bottom:8pt;padding-bottom:4pt;border-bottom:1pt solid #e5e7eb}
table{width:100%;border-collapse:collapse;font-size:7.5pt;margin-bottom:8pt}
th,td{border:0.5pt solid #d1d5db;padding:2.5pt 4pt;vertical-align:top;overflow-wrap:break-word}
th{background:#f3f4f6;font-weight:600;text-align:center}th:first-child,td:first-child{text-align:left}
td.num{text-align:right;font-family:monospace}thead{display:table-header-group}tr{break-inside:avoid}
.notes-body p{font-size:9pt;line-height:1.7;margin-bottom:8pt;break-inside:avoid}
.footer{font-size:7pt;color:#9ca3af;display:flex;justify-content:space-between;border-top:0.5pt solid #e5e7eb;padding-top:4pt;margin-top:14pt}
.print-btn{padding:6px 16px;background:#7c3aed;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8pt}
@media print{.print-btn{display:none}}
</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="cover"><h1>${esc(doc.title)}</h1><div class="meta">${esc(projectName)} · Cost Comparison · Generated ${new Date().toLocaleString('en-AU')}</div></div>
<div class="params"><span>Period:</span><b>${fmtD(startDate)} → ${fmtD(endDate)}</b><span>Pattern:</span><b>${pattern === 'weekday' ? 'Mon–Fri' : '7-Day'}</b><span>Working days:</span><b>${result.totalDays}</b><span>Vendors:</span><b>${result.vendors.length}</b></div>
<div class="section-title">Vendor Ranking</div>
${vendorCards}
<section>
  <div class="section-title">Cost Component Summary</div>
  <table><thead><tr><th>Component</th>${result.vendors.map(v => `<th>${esc(v.vendor)}</th>`).join('')}</tr></thead><tbody>
    ${compRows}
    <tr style="background:#f3f4f6"><td style="font-weight:700">Total</td>${result.vendors.map(v => `<td class="num" style="font-weight:700">${fmt(v.projectedTotal)}</td>`).join('')}</tr>
  </tbody></table>
</section>
<section>
  <div class="section-title">Per-Role Breakdown</div>
  <table><thead><tr><th>Vendor</th>${roleHeaderHtml}<th>Labour Total</th></tr></thead><tbody>${roleBodyHtml}</tbody></table>
</section>
<section>
  <div class="section-title">Weekly Breakdown (Labour)</div>
  <table><thead><tr><th>Vendor</th>${weekHeaderHtml}<th>Labour Total</th></tr></thead><tbody>${weekBodyHtml}</tbody></table>
</section>
${notesSection}
<div class="footer"><span>Siemens Energy — Confidential</span><span>${new Date().toLocaleString('en-AU')}</span></div>
</body></html>`
}
