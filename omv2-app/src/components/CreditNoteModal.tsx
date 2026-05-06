/**
 * CreditNoteModal
 *
 * Two-step modal for issuing credit notes against scope allocation rows.
 * Step 1: Summary of selected lines + reason + credit type selection
 * Step 2: Type-specific inputs (reallocation targets or hours to credit)
 * Step 3: Confirmation + apply
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { applyCreditNote, getNextReference, type SourceLine, type CreditNotePayload } from '../engines/creditNoteEngine'
import type { NrgTceLine } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  sourceLines: SourceLine[]
  onClose: () => void
  onApplied: () => void
}

type CreditType = 'reallocate' | 'credit_only' | 'adjust_timesheet'
type Step = 1 | 2 | 3

interface ReallocationTarget {
  tceItemId: string | null
  wo: string
  hours: number
  description: string
}

interface PerLineRealloc {
  [sourceLineIndex: number]: ReallocationTarget[]
}

const PAY_CODE_STYLE: Record<string, { bg: string; color: string }> = {
  'DT1.0': { bg: '#dbeafe', color: '#1e40af' },
  'DT1.5': { bg: '#fef3c7', color: '#92400e' },
  'DT2.0': { bg: '#fce7f3', color: '#9d174d' },
  'NT2.0': { bg: '#f0fdf4', color: '#166534' },
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreditNoteModal({ projectId, sourceLines, onClose, onApplied }: Props) {
  const { currentUser } = useAppStore()

  const [step, setStep]               = useState<Step>(1)
  const [creditType, setCreditType]   = useState<CreditType>('credit_only')
  const [reference, setReference]     = useState('')
  const [reason, setReason]           = useState('')
  const [applying, setApplying]       = useState(false)
  const [result, setResult]           = useState<{ success: boolean; warnings: string[]; error?: string } | null>(null)

  // Credit Only / Adjust: hours to credit per line index
  const [creditHours, setCreditHours] = useState<Record<number, number>>({})

  // Reallocate: targets per line index
  const [perLineRealloc, setPerLineRealloc] = useState<PerLineRealloc>({})

  // TCE options for reallocation picker
  const [tceLines, setTceLines]       = useState<NrgTceLine[]>([])

  // Approved timesheet warning
  const [hasApproved, setHasApproved] = useState(false)

  useEffect(() => {
    // Auto-fill reference
    getNextReference(projectId).then(setReference)

    // Default credit hours to full hours
    const defaults: Record<number, number> = {}
    sourceLines.forEach((l, i) => { defaults[i] = l.hours })
    setCreditHours(defaults)

    // Default reallocation: empty targets for each line
    const defRealloc: PerLineRealloc = {}
    sourceLines.forEach((_, i) => { defRealloc[i] = [] })
    setPerLineRealloc(defRealloc)

    // Load TCE lines for reallocation picker
    supabase.from('nrg_tce_lines').select('id,item_id,work_order,contract_scope,description,source,line_type')
      .eq('project_id', projectId).then(({ data }) => setTceLines((data || []) as NrgTceLine[]))

    // Check if any source timesheet is approved
    const tsIds = [...new Set(sourceLines.map(l => l.tsId))]
    supabase.from('weekly_timesheets').select('id,status').in('id', tsIds).then(({ data }) => {
      setHasApproved((data || []).some(ts => ts.status === 'approved'))
    })
  }, [])

  const totalHours = sourceLines.reduce((s, l) => s + l.hours, 0)
  const uniquePeople = new Set(sourceLines.map(l => l.personId)).size

  // ── Validation ──────────────────────────────────────────────────────────────

  function validateStep2(): string | null {
    if (!reason.trim()) return 'Please enter a reason for the credit.'

    if (creditType === 'reallocate') {
      for (let i = 0; i < sourceLines.length; i++) {
        const src = sourceLines[i]
        const targets = perLineRealloc[i] || []
        if (targets.length === 0) return `No reallocation targets set for ${src.personName} ${fmtDate(src.date)}`
        const targetTotal = targets.reduce((s, t) => s + t.hours, 0)
        if (Math.abs(targetTotal - src.hours) > 0.01) {
          return `Hours for ${src.personName} ${fmtDate(src.date)}: target total ${targetTotal}h must equal source ${src.hours}h`
        }
      }
    }

    if (creditType === 'credit_only' || creditType === 'adjust_timesheet') {
      for (let i = 0; i < sourceLines.length; i++) {
        const h = creditHours[i] ?? 0
        if (h <= 0) return `Credit hours for ${sourceLines[i].personName} must be > 0`
        if (h > sourceLines[i].hours + 0.01) return `Credit hours for ${sourceLines[i].personName} (${h}h) exceed allocated hours (${sourceLines[i].hours}h)`
      }
    }

    return null
  }

  // ── Apply ───────────────────────────────────────────────────────────────────

  async function apply() {
    const valErr = validateStep2()
    if (valErr) { alert(valErr); return }

    setApplying(true)

    const reallocationTargets = creditType === 'reallocate'
      ? sourceLines.map((_, i) => ({ sourceLineIndex: i, targets: perLineRealloc[i] || [] }))
      : undefined

    const payload: CreditNotePayload = {
      projectId,
      creditType,
      reference,
      reason,
      sourceLines,
      createdBy: currentUser?.id,
      reallocationTargets,
      creditHoursPerLine: creditType !== 'reallocate' ? creditHours : undefined,
    }

    const res = await applyCreditNote(payload)
    setResult({ success: res.success, warnings: res.warnings || [], error: res.error })
    setApplying(false)
    if (res.success) setStep(3)
  }

  // ── Print credit note ────────────────────────────────────────────────────────

  function printCreditNote() {
    const typeLabel = { reallocate: 'Scope Reallocation', credit_only: 'Credit Note', adjust_timesheet: 'Timesheet Adjustment' }[creditType]
    const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

    const linesHTML = sourceLines.map((l, i) => {
      const ch = creditType !== 'reallocate' ? (creditHours[i] ?? l.hours) : l.hours
      const pc = PAY_CODE_STYLE[l.payCode] || { bg: '#f3f4f6', color: '#374151' }
      return `<tr>
        <td>${l.personName}</td>
        <td>${fmtDate(l.date)}</td>
        <td><span style="background:${pc.bg};color:${pc.color};padding:1px 5px;border-radius:3px;font-weight:700;font-family:monospace;font-size:9px">${l.payCode}</span></td>
        <td>${l.woTask || l.scopeKey || '—'}</td>
        <td style="white-space:nowrap;overflow:hidden;max-width:180px">${l.description || '—'}</td>
        <td style="text-align:right;font-family:monospace">${l.hours}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;color:#dc2626">${ch}</td>
      </tr>`
    }).join('')

    const reallocHTML = creditType === 'reallocate' ? `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#475569;margin:20px 0 8px">Reallocation Targets</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:12px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:5px 8px;text-align:left;border:1px solid #cbd5e1">Source Person</th>
          <th style="padding:5px 8px;text-align:left;border:1px solid #cbd5e1">Source Date</th>
          <th style="padding:5px 8px;text-align:left;border:1px solid #cbd5e1">→ Target Scope</th>
          <th style="padding:5px 8px;text-align:right;border:1px solid #cbd5e1">Hours</th>
        </tr></thead>
        <tbody>
          ${sourceLines.map((l, i) => (perLineRealloc[i] || []).map(t =>
            `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0">${l.personName}</td>
             <td style="padding:4px 8px;border:1px solid #e2e8f0">${fmtDate(l.date)}</td>
             <td style="padding:4px 8px;border:1px solid #e2e8f0;font-family:monospace;font-size:9px">${t.wo || t.tceItemId || '—'} — ${t.description}</td>
             <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-family:monospace">${t.hours}</td></tr>`
          ).join('')).join('')}
        </tbody>
      </table>` : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${reference} — ${typeLabel}</title>
      <style>
        body { font-family: -apple-system, Arial, sans-serif; margin: 0; padding: 24px; color: #0f172a; }
        @media print { button { display: none !important } @page { size: A4; margin: 12mm } }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 9px; text-transform: uppercase; text-align: left; color: #475569; font-weight: 700; }
        td { border: 1px solid #e2e8f0; padding: 4px 8px; font-size: 10px; vertical-align: top; }
      </style>
    </head><body>
      <button onclick="window.print()" style="padding:6px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-bottom:20px">🖨 Print / Save PDF</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e2e8f0">
        <div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">Siemens Energy</div>
          <h1 style="font-size:22px;font-weight:800;margin:0 0 4px">${reference}</h1>
          <div style="font-size:13px;color:#475569">${typeLabel}</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#475569">
          <div><strong>Date issued:</strong> ${dateStr}</div>
          <div><strong>Issued by:</strong> ${currentUser?.name || 'Unknown'}</div>
        </div>
      </div>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:600;color:#991b1b;margin-bottom:4px">Reason</div>
        <div style="font-size:12px;color:#7f1d1d">${reason}</div>
      </div>

      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#475569;margin:0 0 8px">Credited Lines</h3>
      <table style="margin-bottom:12px">
        <thead><tr>
          <th>Person</th><th>Date</th><th>Pay Code</th><th>WO / Task</th><th>Description</th>
          <th style="text-align:right">Original Hrs</th><th style="text-align:right">Credited Hrs</th>
        </tr></thead>
        <tbody>${linesHTML}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="5" style="text-align:right;font-size:10px">Total</td>
          <td style="text-align:right;font-family:monospace">${totalHours.toFixed(1)}</td>
          <td style="text-align:right;font-family:monospace;color:#dc2626">
            ${creditType !== 'reallocate' ? Object.values(creditHours).reduce((s, h) => s + h, 0).toFixed(1) : totalHours.toFixed(1)}
          </td>
        </tr></tfoot>
      </table>
      ${reallocHTML}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8">
        Generated by Overhaul Manager · ${new Date().toISOString()}
      </div>
    </body></html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header" style={{ borderBottom: '2px solid var(--border)', flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0 }}>Issue Credit Note</h3>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {sourceLines.length} line{sourceLines.length !== 1 ? 's' : ''} · {uniquePeople} person{uniquePeople !== 1 ? 's' : ''} · {totalHours.toFixed(1)}h total
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflow: 'auto', padding: 20 }}>

          {/* ── Step 1: Type + Reference + Reason ── */}
          {step === 1 && (<>
            {/* Selected lines summary */}
            <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '10px 12px', marginBottom: 16, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', color: 'var(--text3)' }}>Selected lines</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflow: 'auto' }}>
                {sourceLines.map((l, i) => {
                  const pc = PAY_CODE_STYLE[l.payCode] || { bg: 'var(--bg3)', color: 'var(--text2)' }
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                      <span style={{ fontWeight: 600, minWidth: 130 }}>{l.personName}</span>
                      <span style={{ color: 'var(--text3)' }}>{fmtDate(l.date)}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: 3, background: pc.bg, color: pc.color }}>{l.payCode}</span>
                      <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 10 }}>{l.woTask || l.scopeKey}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 700 }}>{l.hours}h</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {hasApproved && (
              <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 11, color: '#78350f' }}>
                ⚠ One or more source timesheets are <strong>approved</strong>. Applying this credit will modify the cost lines but will not change the timesheet approval status — you may want to review and re-approve afterward.
              </div>
            )}

            {/* Reference */}
            <div className="fg" style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Credit Note Reference</label>
              <input className="input" value={reference} onChange={e => setReference(e.target.value)} placeholder="CN-001" style={{ maxWidth: 160 }} />
            </div>

            {/* Reason */}
            <div className="fg" style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Reason *</label>
              <textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Person not on site for allocated hours, scope incorrectly allocated..." style={{ resize: 'vertical' }} />
            </div>

            {/* Credit type */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Credit Type *</div>
              {([
                { type: 'credit_only' as CreditType, label: 'Credit Note Only', icon: '💰',
                  desc: 'Reduces the billable (sell) value and actual hours for client-facing reporting. Internal cost remains unchanged. Use when hours were worked but should not be billed.' },
                { type: 'reallocate' as CreditType, label: 'Reallocate Scope', icon: '↔',
                  desc: 'Moves hours from the selected scope(s) to different scope(s). Total hours unchanged. Use when hours were allocated to the wrong work order.' },
                { type: 'adjust_timesheet' as CreditType, label: 'Adjust Timesheet', icon: '✂',
                  desc: 'Removes hours from the timesheet entirely — affects internal cost, TCE actuals, and invoicing. Use when the person was not actually on site.' },
              ] as const).map(opt => (
                <label key={opt.type} onClick={() => setCreditType(opt.type)}
                  style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 8, border: `2px solid ${creditType === opt.type ? 'var(--accent)' : 'var(--border)'}`, background: creditType === opt.type ? 'var(--accent-bg)' : 'var(--bg)', cursor: 'pointer', marginBottom: 8 }}>
                  <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{opt.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: creditType === opt.type ? 'var(--accent)' : 'var(--text)', marginBottom: 3 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </>)}

          {/* ── Step 2: Type-specific inputs ── */}
          {step === 2 && (<>
            <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
              <strong>{reference}</strong> · {reason}
            </div>

            {/* Credit Only / Adjust: hours per line */}
            {(creditType === 'credit_only' || creditType === 'adjust_timesheet') && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                  {creditType === 'credit_only' ? 'Hours to credit (reduces billable hours only)' : 'Hours to remove (removes from timesheet + cost)'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sourceLines.map((l, i) => {
                    const pc = PAY_CODE_STYLE[l.payCode] || { bg: 'var(--bg3)', color: 'var(--text2)' }
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{l.personName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span>{fmtDate(l.date)}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: 3, background: pc.bg, color: pc.color }}>{l.payCode}</span>
                            <span style={{ fontFamily: 'var(--mono)' }}>{l.woTask || l.scopeKey}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>
                          of <strong style={{ fontFamily: 'var(--mono)' }}>{l.hours}h</strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="number" className="input" style={{ width: 70, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}
                            value={creditHours[i] ?? l.hours} min={0.1} max={l.hours} step={0.1}
                            onChange={e => setCreditHours(prev => ({ ...prev, [i]: parseFloat(e.target.value) || 0 }))} />
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>h</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 10, textAlign: 'right', fontSize: 12, color: 'var(--text2)' }}>
                  Total to credit: <strong style={{ fontFamily: 'var(--mono)', color: 'var(--red)' }}>
                    {Object.values(creditHours).reduce((s, h) => s + (h || 0), 0).toFixed(1)}h
                  </strong>
                </div>
              </div>
            )}

            {/* Reallocate: target scopes per line */}
            {creditType === 'reallocate' && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Set target scope(s) for each line</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {sourceLines.map((l, i) => {
                    const pc = PAY_CODE_STYLE[l.payCode] || { bg: 'var(--bg3)', color: 'var(--text2)' }
                    const targets = perLineRealloc[i] || []
                    const targetTotal = targets.reduce((s, t) => s + t.hours, 0)
                    const remaining = parseFloat((l.hours - targetTotal).toFixed(2))

                    return (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                        {/* Source line header */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 11, color: 'var(--text2)', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{l.personName}</span>
                          <span>{fmtDate(l.date)}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: 3, background: pc.bg, color: pc.color }}>{l.payCode}</span>
                          <span style={{ fontFamily: 'var(--mono)' }}>{l.woTask || l.scopeKey}</span>
                          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 700, color: remaining > 0.01 ? 'var(--red)' : 'var(--green)' }}>
                            {remaining > 0.01 ? `${remaining}h unallocated` : `✓ ${l.hours}h allocated`}
                          </span>
                        </div>

                        {/* Target rows */}
                        {targets.map((t, ti) => (
                          <div key={ti} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                            <select className="input" style={{ flex: 1, fontSize: 12 }} value={t.tceItemId ? `tce:${t.tceItemId}` : `wo:${t.wo}`}
                              onChange={e => {
                                const val = e.target.value
                                const isWo = val.startsWith('wo:')
                                const key  = val.slice(3)
                                const line = isWo ? tceLines.find(l => l.work_order === key) : tceLines.find(l => l.item_id === key)
                                setPerLineRealloc(prev => {
                                  const next = [...(prev[i] || [])]
                                  next[ti] = { ...next[ti], tceItemId: isWo ? null : key, wo: isWo ? key : (line?.work_order || ''), description: line?.description || '' }
                                  return { ...prev, [i]: next }
                                })
                              }}>
                              <option value="">— Select target scope —</option>
                              {tceLines.filter(l => l.source === 'skilled' && l.work_order).map(l => (
                                <option key={l.id} value={`wo:${l.work_order}`}>[WO] {l.work_order} — {l.description}</option>
                              ))}
                              {tceLines.filter(l => l.source === 'overhead' || (l.source === 'skilled' && !l.work_order)).map(l => (
                                <option key={l.id} value={`tce:${l.item_id}`}>[TCE] {l.item_id} — {l.description}</option>
                              ))}
                            </select>
                            <input type="number" className="input" style={{ width: 65, textAlign: 'right', fontFamily: 'var(--mono)' }}
                              value={t.hours} min={0.1} max={l.hours} step={0.1}
                              onChange={e => setPerLineRealloc(prev => {
                                const next = [...(prev[i] || [])]
                                next[ti] = { ...next[ti], hours: parseFloat(e.target.value) || 0 }
                                return { ...prev, [i]: next }
                              })} />
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>h</span>
                            <button className="btn btn-sm" style={{ color: 'var(--red)', flexShrink: 0 }}
                              onClick={() => setPerLineRealloc(prev => { const next = [...(prev[i] || [])]; next.splice(ti, 1); return { ...prev, [i]: next } })}>✕</button>
                          </div>
                        ))}

                        <button className="btn btn-sm" style={{ fontSize: 11 }}
                          onClick={() => setPerLineRealloc(prev => ({ ...prev, [i]: [...(prev[i] || []), { tceItemId: null, wo: '', hours: remaining > 0 ? remaining : 0, description: '' }] }))}>
                          + Add target scope
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>)}

          {/* ── Step 3: Result ── */}
          {step === 3 && result && (
            <div>
              {result.success ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Credit note applied</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{reference} — {sourceLines.length} line{sourceLines.length !== 1 ? 's' : ''} credited</div>
                  {result.warnings.length > 0 && (
                    <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 14px', textAlign: 'left', marginBottom: 16 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: '#78350f', marginBottom: 6 }}>⚠ Warnings</div>
                      {result.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400e', marginBottom: 3 }}>{w}</div>)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn" onClick={printCreditNote}>🖨 Print Credit Note</button>
                    <button className="btn btn-primary" onClick={onApplied}>Done</button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>Credit note failed</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16, fontFamily: 'var(--mono)', background: 'var(--bg2)', padding: 12, borderRadius: 6 }}>{result.error}</div>
                  <button className="btn" onClick={() => setStep(2)}>← Back</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 3 && (
          <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <button className="btn" onClick={step === 1 ? onClose : () => setStep(1)}>
              {step === 1 ? 'Cancel' : '← Back'}
            </button>
            {step === 1 && (
              <button className="btn btn-primary" disabled={!reason.trim() || !reference.trim()}
                onClick={() => setStep(2)}>
                Next →
              </button>
            )}
            {step === 2 && (
              <button className="btn btn-primary" disabled={applying} onClick={apply}
                style={{ background: '#dc2626', borderColor: '#dc2626' }}>
                {applying ? 'Applying…' : `Apply ${reference}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
