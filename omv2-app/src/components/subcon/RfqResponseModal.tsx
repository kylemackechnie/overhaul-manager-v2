import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../ui/Toast'
import { uploadQuotePdf, deleteQuotePdf, getQuotePdfSignedUrl, formatFileSize } from '../../lib/quotePdfStorage'
import { calcHoursCost } from '../../engines/costEngine'
import type {
  RfqDocument, RfqResponse, RfqLabourRow,
  RfqResponseLabour, RfqResponseLabourRates, RfqResponseEquip,
} from '../../types'

interface Props {
  doc: RfqDocument
  projectId: string
  vendorsSent: string[]
  existingResponse: RfqResponse | null
  onClose: () => void
  onSaved: () => void
}

const CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'NZD']

// Fresh rates object with sensible default thresholds (from HTML defaults)
const freshRates = (): RfqResponseLabourRates => ({
  rateMode: 'hourly',
  ntHrs: 7.2, ot1Hrs: 2.8, shiftHrs: 10,
  satNtHrs: 0, satT15Hrs: 10, satShiftHrs: 10,
  sunT15Hrs: 0, sunShiftHrs: 10,
  nntHrs: 7.2, nshiftHrs: 10,
})

// Build a labour entry per role on the doc, prefilling from existing response if present
function buildInitialLabour(doc: RfqDocument, existing: RfqResponse | null): RfqResponseLabour[] {
  return (doc.labour_rows || []).map(lr => {
    const existingLabour = existing?.labour?.find(l => l.role === lr.role)
    return {
      role: lr.role,
      rates: existingLabour?.rates || freshRates(),
    }
  })
}

function buildInitialEquip(doc: RfqDocument, existing: RfqResponse | null): RfqResponseEquip[] {
  return (doc.equip_rows || []).map(er => {
    const ex = existing?.equip?.find(e => e.desc === er.desc)
    return {
      desc: er.desc,
      rate: ex?.rate || 0,
      unit: ex?.unit || 'day',
      transportIn: ex?.transportIn || 0,
      transportOut: ex?.transportOut || 0,
    }
  })
}

// Live $/shift preview: returns weekday/saturday/sunday/PH costs and a breakdown line
interface PreviewResult {
  wd: number; sat: number; sun: number; ph: number
  breakdown: string
}

function computePreview(rates: RfqResponseLabourRates, shiftType: RfqLabourRow['shiftType']): PreviewResult {
  const empty: PreviewResult = { wd: 0, sat: 0, sun: 0, ph: 0, breakdown: '—' }

  if (rates.rateMode === 'flat') {
    const ds = rates.flatDs || 0
    const ns = rates.flatNs || 0
    const laha = rates.laha || 0
    const parts: string[] = []
    if (ds) parts.push(`DS $${ds.toFixed(2)}/shift`)
    if (ns) parts.push(`NS $${ns.toFixed(2)}/shift`)
    if (laha) parts.push(`LAHA $${laha}/day`)
    return {
      wd: ds + laha,
      sat: ds + laha,
      sun: ns + laha,
      ph: ns + laha,
      breakdown: parts.join(' + ') || '—',
    }
  }

  // Hourly mode
  const dnt = rates.dnt || 0, dt15 = rates.dt15 || 0, ddt = rates.ddt || 0, ddt15 = rates.ddt15 || 0
  const nnt = rates.nnt || 0, ndt = rates.ndt || 0, ndt15 = rates.ndt15 || ddt15 || 0
  const laha = rates.laha || 0
  const ntHrs = rates.ntHrs ?? 7.2
  const ot1Hrs = rates.ot1Hrs ?? 2.8
  const shiftHrs = rates.shiftHrs ?? 10
  const satNtHrs = rates.satNtHrs ?? 0
  const satT15Hrs = rates.satT15Hrs ?? shiftHrs
  const satShiftHrs = rates.satShiftHrs ?? shiftHrs
  const sunT15Hrs = rates.sunT15Hrs ?? 0
  const sunShiftHrs = rates.sunShiftHrs ?? shiftHrs
  const nntHrs = rates.nntHrs ?? 7.2
  const nshiftHrs = rates.nshiftHrs ?? 10

  if (!dnt && !nnt && !ndt) return empty

  const dayRc = { rates: { cost: { dnt, dt15, ddt, ddt15, nnt: 0, ndt: 0, ndt15: 0 } } }
  const nightRc = { rates: { cost: { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt, ndt, ndt15 } } }

  const calcDay = (dayType: 'weekday' | 'saturday' | 'sunday' | 'public_holiday', hrs: number): number => {
    let split: Record<string, number>
    if (dayType === 'weekday') {
      const nt = Math.min(hrs, ntHrs)
      const t15 = Math.min(Math.max(0, hrs - ntHrs), ot1Hrs)
      const dt = Math.max(0, hrs - ntHrs - ot1Hrs)
      split = { dnt: nt, dt15: t15, ddt: dt, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
    } else if (dayType === 'saturday') {
      const nt = Math.min(hrs, satNtHrs)
      const t15 = Math.min(Math.max(0, hrs - satNtHrs), satT15Hrs)
      const dt = Math.max(0, hrs - satNtHrs - satT15Hrs)
      split = { dnt: nt, dt15: t15, ddt: dt, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
    } else if (dayType === 'sunday') {
      const t15 = Math.min(hrs, sunT15Hrs)
      const dt = Math.max(0, hrs - sunT15Hrs)
      split = { dnt: 0, dt15: t15, ddt: dt, ddt15: 0, nnt: 0, ndt: 0, ndt15: 0 }
    } else {
      split = { dnt: 0, dt15: 0, ddt: 0, ddt15: hrs, nnt: 0, ndt: 0, ndt15: 0 }
    }
    return calcHoursCost(split as never, dayRc as never, 'cost')
  }

  const calcNight = (dayType: 'weekday' | 'saturday' | 'sunday' | 'public_holiday', hrs: number): number => {
    if (!nnt && !ndt) return 0
    let split: Record<string, number>
    if (dayType === 'public_holiday') {
      split = { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt: 0, ndt: 0, ndt15: hrs }
    } else {
      const nt = Math.min(hrs, nntHrs)
      const dt = Math.max(0, hrs - nntHrs)
      split = { dnt: 0, dt15: 0, ddt: 0, ddt15: 0, nnt: nt, ndt: dt, ndt15: 0 }
    }
    return calcHoursCost(split as never, nightRc as never, 'cost')
  }

  const isDual = shiftType === 'dual'
  const isNightOnly = shiftType === 'single-night'

  const computeFor = (dayType: 'weekday' | 'saturday' | 'sunday' | 'public_holiday', dayHrs: number): number => {
    const dayCost = isNightOnly ? 0 : calcDay(dayType, dayHrs)
    const nightCost = (isDual || isNightOnly) ? calcNight(dayType, nshiftHrs) : 0
    const lahaMul = (dayCost > 0 ? 1 : 0) + (nightCost > 0 ? 1 : 0)
    return dayCost + nightCost + (laha * lahaMul)
  }

  const wd = computeFor('weekday', shiftHrs)
  const sat = computeFor('saturday', satShiftHrs)
  const sun = computeFor('sunday', sunShiftHrs)
  const ph = computeFor('public_holiday', sunShiftHrs)

  // Breakdown for weekday
  const wdNT = Math.min(shiftHrs, ntHrs).toFixed(1)
  const wdT15 = Math.min(Math.max(0, shiftHrs - ntHrs), ot1Hrs).toFixed(1)
  const wdDT = Math.max(0, shiftHrs - ntHrs - ot1Hrs).toFixed(1)
  const parts: string[] = []
  if (+wdNT) parts.push(`${wdNT}h NT @ $${dnt}`)
  if (+wdT15) parts.push(`${wdT15}h T1.5 @ $${dt15}`)
  if (+wdDT) parts.push(`${wdDT}h DT @ $${ddt}`)
  if (isDual && nnt) {
    const nNT = Math.min(nshiftHrs, nntHrs).toFixed(1)
    const nDT = Math.max(0, nshiftHrs - nntHrs).toFixed(1)
    if (+nNT) parts.push(`Night: ${nNT}h N-NT @ $${nnt}`)
    if (+nDT) parts.push(`${nDT}h N-DT @ $${ndt}`)
  }
  if (laha) parts.push(`LAHA $${laha}/day`)

  return {
    wd, sat, sun, ph,
    breakdown: (isDual ? 'Dual — ' : isNightOnly ? 'Night — ' : 'Weekday — ') + (parts.join(' + ') || '—'),
  }
}

const fmtMoney = (v: number) => v > 0 ? `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

export function RfqResponseModal({ doc, projectId, vendorsSent, existingResponse, onClose, onSaved }: Props) {
  const [vendor, setVendor] = useState(existingResponse?.vendor || '')
  const [receivedDate, setReceivedDate] = useState(existingResponse?.received_date || '')
  const [totalQuote, setTotalQuote] = useState(existingResponse?.total_quote?.toString() || '')
  const [currency, setCurrency] = useState(existingResponse?.currency || 'AUD')
  const [responseNotes, setResponseNotes] = useState(existingResponse?.notes || '')
  const [labour, setLabour] = useState<RfqResponseLabour[]>(buildInitialLabour(doc, existingResponse))
  const [equip, setEquip] = useState<RfqResponseEquip[]>(buildInitialEquip(doc, existingResponse))
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfPath, setPdfPath] = useState<string | null>(existingResponse?.quote_pdf_path || null)
  const [pdfName, setPdfName] = useState<string | null>(existingResponse?.quote_pdf_name || null)
  const [pdfSize, setPdfSize] = useState<number | null>(existingResponse?.quote_pdf_size_bytes || null)
  const [saving, setSaving] = useState(false)

  // Esc key to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function setRoleRates(li: number, patch: Partial<RfqResponseLabourRates>) {
    setLabour(rows => rows.map((r, i) => i === li ? { ...r, rates: { ...r.rates, ...patch } } : r))
  }

  function setRoleMode(li: number, mode: 'hourly' | 'flat') {
    setRoleRates(li, { rateMode: mode })
  }

  function copyFromRole(fromLi: number, toLi: number) {
    if (fromLi === toLi) return
    const fromRates = labour[fromLi]?.rates
    if (!fromRates) return
    setLabour(rows => rows.map((r, i) => i === toLi ? { ...r, rates: { ...fromRates } } : r))
    toast(`Copied rates from ${labour[fromLi].role} to ${labour[toLi].role}`, 'success')
  }

  function setEquipField(ei: number, patch: Partial<RfqResponseEquip>) {
    setEquip(rows => rows.map((r, i) => i === ei ? { ...r, ...patch } : r))
  }

  function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') { toast('Please select a PDF file', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { toast('PDF must be under 10MB', 'error'); return }
    setPdfFile(file)
    setPdfName(file.name)
    setPdfSize(file.size)
  }

  function clearPdf() {
    setPdfFile(null)
    setPdfPath(null)
    setPdfName(null)
    setPdfSize(null)
  }

  async function viewPdf() {
    if (!pdfPath) return
    try {
      const url = await getQuotePdfSignedUrl(pdfPath)
      window.open(url, '_blank')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  async function save() {
    if (!vendor.trim()) { toast('Vendor name is required', 'error'); return }
    setSaving(true)

    try {
      // Filter labour entries that have any rate data (don't save empty roles)
      const labourToSave: RfqResponseLabour[] = labour.filter(l => {
        const r = l.rates
        if (r.rateMode === 'flat') return (r.flatDs || 0) > 0 || (r.flatNs || 0) > 0
        return (r.dnt || 0) > 0 || (r.nnt || 0) > 0 || (r.ndt || 0) > 0
      })

      const equipToSave: RfqResponseEquip[] = equip.filter(e => e.rate > 0 || e.transportIn > 0 || e.transportOut > 0)

      const payload = {
        rfq_document_id: doc.id,
        project_id: projectId,
        vendor: vendor.trim(),
        received_date: receivedDate || null,
        total_quote: totalQuote ? parseFloat(totalQuote) : null,
        currency,
        notes: responseNotes,
        labour: labourToSave,
        equip: equipToSave,
        quote_pdf_path: pdfPath,
        quote_pdf_name: pdfName,
        quote_pdf_size_bytes: pdfSize,
      }

      // Save the response row first, then upload the PDF using the new ID
      let responseId: string
      if (existingResponse) {
        const { error } = await supabase.from('rfq_responses').update(payload).eq('id', existingResponse.id)
        if (error) throw new Error(error.message)
        responseId = existingResponse.id
      } else {
        const { data, error } = await supabase.from('rfq_responses').insert(payload).select('id').single()
        if (error) throw new Error(error.message)
        responseId = data.id
      }

      // Handle PDF upload after we have a response ID
      if (pdfFile) {
        try {
          const result = await uploadQuotePdf(projectId, doc.id, responseId, pdfFile)
          // If we replaced an old PDF at a different path, delete the old one (best-effort)
          if (existingResponse?.quote_pdf_path && existingResponse.quote_pdf_path !== result.path) {
            await deleteQuotePdf(existingResponse.quote_pdf_path)
          }
          // Update the response row with the new path
          await supabase.from('rfq_responses')
            .update({ quote_pdf_path: result.path, quote_pdf_name: result.name, quote_pdf_size_bytes: result.sizeBytes })
            .eq('id', responseId)
        } catch (e) {
          toast(`Response saved but PDF upload failed: ${(e as Error).message}`, 'error')
        }
      } else if (existingResponse?.quote_pdf_path && !pdfPath) {
        // PDF was cleared — remove from storage
        await deleteQuotePdf(existingResponse.quote_pdf_path)
      }

      // Auto-transition stage if first response
      if (doc.stage === 'issued' && !existingResponse) {
        await supabase.from('rfq_documents').update({ stage: 'responses_in' }).eq('id', doc.id)
      }

      toast(existingResponse ? 'Response updated' : 'Response saved', 'success')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const labourRows = doc.labour_rows || []

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg2)', borderRadius: '12px', padding: '24px',
        maxWidth: '780px', width: '100%', maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>
              {existingResponse ? '✏️ Edit Vendor Response' : '📥 Add Vendor Response'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{doc.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>

        {/* Vendor + date */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <div className="fg" style={{ margin: 0 }}>
            <label>Vendor / Company *</label>
            <input className="input" list="vendor-suggestions" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. ABC Scaffolding Pty Ltd" />
            <datalist id="vendor-suggestions">
              {vendorsSent.map(v => <option key={v} value={v} />)}
            </datalist>
          </div>
          <div className="fg" style={{ margin: 0 }}>
            <label>Date Received</label>
            <input className="input" type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
          </div>
        </div>

        {/* Total quote + currency */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
          <div className="fg" style={{ margin: 0 }}>
            <label>Total Quote Value <span style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 400 }}>— lump sum or overall ref</span></label>
            <input className="input" type="number" min={0} step="0.01" value={totalQuote} onChange={e => setTotalQuote(e.target.value)} placeholder="0.00" />
          </div>
          <div className="fg" style={{ margin: 0 }}>
            <label>Currency</label>
            <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Labour rate cards */}
        {labourRows.length > 0 && (
          <>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
              Labour Rates — enter base rates and the system calculates shift costs
            </div>
            {labour.map((l, li) => (
              <RoleRatesBlock
                key={li}
                role={labourRows[li]}
                rates={l.rates}
                allRoles={labourRows}
                roleIndex={li}
                onModeChange={(m) => setRoleMode(li, m)}
                onRatesChange={(patch) => setRoleRates(li, patch)}
                onCopyFrom={(fromLi) => copyFromRole(fromLi, li)}
              />
            ))}
          </>
        )}

        {/* Equipment rates */}
        {(doc.equip_rows || []).length > 0 && (
          <>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '14px 0 8px' }}>
              Equipment Rates
            </div>
            {(doc.equip_rows || []).map((er, ei) => (
              <div key={ei} style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg3)', marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px' }}>
                  {er.desc}
                  <span style={{ fontWeight: 400, color: 'var(--text3)', marginLeft: '6px' }}>
                    — Est. {er.durMode === 'dates' ? 'date range' : `${er.dur} ${er.unit}`}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px' }}>
                  <div className="fg" style={{ margin: 0 }}>
                    <label style={{ fontSize: '10px' }}>Rate ($/period)</label>
                    <input className="input" style={{ fontSize: '11px', fontFamily: 'var(--mono)' }} type="number" min={0} step="0.01"
                      value={equip[ei]?.rate || ''} onChange={e => setEquipField(ei, { rate: parseFloat(e.target.value) || 0 })} placeholder="0.00" />
                  </div>
                  <div className="fg" style={{ margin: 0 }}>
                    <label style={{ fontSize: '10px' }}>Unit</label>
                    <select className="input" style={{ fontSize: '11px' }} value={equip[ei]?.unit || 'day'} onChange={e => setEquipField(ei, { unit: e.target.value as RfqResponseEquip['unit'] })}>
                      <option value="day">Per Day</option>
                      <option value="week">Per Week</option>
                      <option value="lump">Lump Sum</option>
                    </select>
                  </div>
                  <div className="fg" style={{ margin: 0 }}>
                    <label style={{ fontSize: '10px' }}>Transport In ($)</label>
                    <input className="input" style={{ fontSize: '11px', fontFamily: 'var(--mono)' }} type="number" min={0} step="0.01"
                      value={equip[ei]?.transportIn || ''} onChange={e => setEquipField(ei, { transportIn: parseFloat(e.target.value) || 0 })} placeholder="0.00" />
                  </div>
                  <div className="fg" style={{ margin: 0 }}>
                    <label style={{ fontSize: '10px' }}>Transport Out ($)</label>
                    <input className="input" style={{ fontSize: '11px', fontFamily: 'var(--mono)' }} type="number" min={0} step="0.01"
                      value={equip[ei]?.transportOut || ''} onChange={e => setEquipField(ei, { transportOut: parseFloat(e.target.value) || 0 })} placeholder="0.00" />
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Notes */}
        <div className="fg" style={{ marginTop: '14px' }}>
          <label>Notes</label>
          <textarea className="input" rows={2} value={responseNotes} onChange={e => setResponseNotes(e.target.value)}
            placeholder="e.g. Includes all PPE, excludes consumables..." />
        </div>

        {/* PDF upload */}
        <div style={{ marginTop: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '8px' }}>
            📎 Vendor Quote PDF
          </label>
          <div style={{
            border: '2px dashed var(--border)', borderRadius: '8px', padding: '14px 16px',
            background: 'var(--bg3)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
          }}>
            {pdfName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <span style={{ fontSize: '18px' }}>📄</span>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>{pdfName}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{pdfSize ? formatFileSize(pdfSize) : ''}</div>
                </div>
                {pdfPath && !pdfFile && (
                  <button onClick={viewPdf} style={{
                    fontSize: '10px', padding: '3px 8px', border: '1px solid #0891b2', borderRadius: '4px',
                    background: '#f0f9ff', color: '#0369a1', cursor: 'pointer', fontWeight: 600, marginLeft: '4px',
                  }}>View</button>
                )}
                <button onClick={clearPdf} style={{
                  fontSize: '10px', padding: '3px 8px', border: '1px solid var(--red)', borderRadius: '4px',
                  background: 'transparent', color: 'var(--red)', cursor: 'pointer', marginLeft: '4px',
                }}>Remove</button>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text3)', flex: 1 }}>No PDF attached</div>
            )}
            <label style={{
              cursor: 'pointer', padding: '6px 14px', border: '1px solid #7c3aed', borderRadius: '5px',
              background: 'transparent', color: '#7c3aed', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              📂 Choose PDF
              <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handlePdfChange} />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff' }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Response'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Per-role rate input block ────────────────────────────────────────────────

interface RoleBlockProps {
  role: RfqLabourRow
  rates: RfqResponseLabourRates
  allRoles: RfqLabourRow[]
  roleIndex: number
  onModeChange: (mode: 'hourly' | 'flat') => void
  onRatesChange: (patch: Partial<RfqResponseLabourRates>) => void
  onCopyFrom: (fromLi: number) => void
}

function RoleRatesBlock({ role, rates, allRoles, roleIndex, onModeChange, onRatesChange, onCopyFrom }: RoleBlockProps) {
  const isFlat = rates.rateMode === 'flat'
  const isDual = role.shiftType === 'dual'
  const isNightOnly = role.shiftType === 'single-night'
  const showNightThresh = isDual || isNightOnly

  const preview = computePreview(rates, role.shiftType)
  const shiftLabel = isDual ? 'Dual Shift (Day + Night combined)' : isNightOnly ? 'Night shift cost at given hours' : 'Day shift cost at given hours'

  const numInput = (key: keyof RfqResponseLabourRates, placeholder = '0.00') => (
    <input
      className="input"
      type="number" min={0} step="0.01"
      value={rates[key] === undefined || rates[key] === null ? '' : (rates[key] as number)}
      onChange={e => onRatesChange({ [key]: e.target.value === '' ? undefined : parseFloat(e.target.value) } as Partial<RfqResponseLabourRates>)}
      placeholder={placeholder}
    />
  )

  return (
    <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg3)', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, flex: 1 }}>
          {role.role || `Role ${roleIndex + 1}`}
          <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--text3)', marginLeft: '6px' }}>
            × {role.qty} · {isDual ? 'Dual Shift' : isNightOnly ? 'Single (Night)' : 'Single (Day)'}
          </span>
        </div>
        {allRoles.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Copy from:</span>
            <select
              defaultValue=""
              onChange={e => { if (e.target.value !== '') { onCopyFrom(parseInt(e.target.value)); e.target.value = '' } }}
              style={{ fontSize: '10px', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer' }}
            >
              <option value="">— select role —</option>
              {allRoles.map((or, oi) => oi === roleIndex ? null : (
                <option key={oi} value={oi}>{or.role || `Role ${oi + 1}`}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Rate mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 10px', background: 'var(--bg3)', borderRadius: '6px', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)' }}>Rate entry mode:</div>
        <button onClick={() => onModeChange('hourly')} style={{
          padding: '3px 10px', fontSize: '11px', borderRadius: '4px',
          border: `1px solid ${isFlat ? 'var(--border)' : 'var(--accent)'}`,
          background: isFlat ? 'var(--bg2)' : 'var(--accent)',
          color: isFlat ? 'var(--text2)' : '#fff', cursor: 'pointer',
        }}>Hourly rates</button>
        <button onClick={() => onModeChange('flat')} style={{
          padding: '3px 10px', fontSize: '11px', borderRadius: '4px',
          border: `1px solid ${isFlat ? 'var(--accent)' : 'var(--border)'}`,
          background: isFlat ? 'var(--accent)' : 'var(--bg2)',
          color: isFlat ? '#fff' : 'var(--text2)', cursor: 'pointer',
        }}>Flat $/shift</button>
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginLeft: '4px' }}>
          Flat rate: enter total $/shift directly (e.g. from a quote table)
        </div>
      </div>

      {/* Flat mode */}
      {isFlat ? (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: '8px', alignItems: 'end' }}>
            <div className="fg" style={{ margin: 0 }}>
              <label style={{ fontSize: '10px' }}>Day Shift $/shift (total)</label>
              {numInput('flatDs', 'e.g. 1378.00')}
            </div>
            <div className="fg" style={{ margin: 0 }}>
              <label style={{ fontSize: '10px' }}>Night Shift $/shift (total)</label>
              {numInput('flatNs', 'e.g. 1690.00')}
            </div>
            <div className="fg" style={{ margin: 0 }}>
              <label style={{ fontSize: '10px' }}>LAHA ($/day)</label>
              {numInput('laha', '0.00')}
            </div>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '6px' }}>
            Day shift used for weekday/Saturday shifts, Night shift for Sunday/PH shifts. LAHA applied per calendar day.
          </div>
        </div>
      ) : (
        <>
          {/* Day Shift $/hr */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Day Shift — Cost Rates ($/hr)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px' }}>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>NT (Day)</label>{numInput('dnt')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>T1.5 (Day)</label>{numInput('dt15')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>DT (Day)</label>{numInput('ddt')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>PH (Day)</label>{numInput('ddt15')}</div>
            </div>
          </div>

          {/* Night Shift $/hr */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Night Shift — Cost Rates ($/hr)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px' }}>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>NT (Night)</label>{numInput('nnt')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>DT (Night)</label>{numInput('ndt')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>PH (Night)</label>{numInput('ndt15')}</div>
            </div>
          </div>

          {/* Weekday thresholds */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Hour Thresholds — Day Shift (Weekday)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px' }}>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>NT hrs (then T1.5)</label>{numInput('ntHrs')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>T1.5 hrs (then DT)</label>{numInput('ot1Hrs')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>Day shift total hrs</label>{numInput('shiftHrs')}</div>
            </div>
          </div>

          {/* Saturday thresholds */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Hour Thresholds — Saturday</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px' }}>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>NT hrs (then T1.5)</label>{numInput('satNtHrs')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>T1.5 hrs (then DT)</label>{numInput('satT15Hrs')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>Saturday shift total hrs</label>{numInput('satShiftHrs')}</div>
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text3)', marginTop: '4px' }}>Leave NT hrs as 0 if Saturday starts at T1.5.</div>
          </div>

          {/* Sunday thresholds */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Hour Thresholds — Sunday / Public Holiday</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '6px' }}>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>T1.5 hrs before DT (0 = all DT)</label>{numInput('sunT15Hrs')}</div>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>Sunday / PH shift total hrs</label>{numInput('sunShiftHrs')}</div>
            </div>
          </div>

          {/* Night thresholds */}
          {showNightThresh && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Hour Thresholds — Night Shift</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '6px' }}>
                <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>Night NT hrs (then DT)</label>{numInput('nntHrs')}</div>
                <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>Night shift total hrs</label>{numInput('nshiftHrs')}</div>
              </div>
            </div>
          )}

          {/* LAHA */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '6px', alignItems: 'end' }}>
              <div className="fg" style={{ margin: 0 }}><label style={{ fontSize: '10px' }}>LAHA ($/day)</label>{numInput('laha')}</div>
            </div>
          </div>
        </>
      )}

      {/* Live preview */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text2)', marginBottom: '6px' }}>
          Estimated $/shift — <span style={{ color: '#7c3aed' }}>{shiftLabel}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px', fontSize: '11px', textAlign: 'center' }}>
          <div style={{ color: 'var(--text3)', fontSize: '9px', textTransform: 'uppercase' }}>Weekday</div>
          <div style={{ color: 'var(--text3)', fontSize: '9px', textTransform: 'uppercase' }}>Saturday</div>
          <div style={{ color: 'var(--text3)', fontSize: '9px', textTransform: 'uppercase' }}>Sunday</div>
          <div style={{ color: 'var(--text3)', fontSize: '9px', textTransform: 'uppercase' }}>PH</div>
          <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmtMoney(preview.wd)}</div>
          <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmtMoney(preview.sat)}</div>
          <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmtMoney(preview.sun)}</div>
          <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmtMoney(preview.ph)}</div>
        </div>
        <div style={{ marginTop: '6px', fontSize: '9px', color: 'var(--text3)' }}>{preview.breakdown}</div>
      </div>
    </div>
  )
}
