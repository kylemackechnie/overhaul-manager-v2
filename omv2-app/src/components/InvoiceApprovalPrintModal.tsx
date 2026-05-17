import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

interface StatusHistoryEntry { status: string; setBy: string; setAt: string; note?: string }

interface PrintInvoice {
  id: string
  invoice_number: string | null
  invoice_ref: string | null
  vendor_details: string | null
  po_id: string | null
  invoice_date: string | null
  amount: number | null
  tce_item_id: string | null
  status: string
  status_history: StatusHistoryEntry[]
  chargeable: boolean
}

interface PO { id: string; po_number: string | null; vendor: string | null }

interface Props {
  invoices: PrintInvoice[]
  pos: PO[]
  isTce: boolean
  onClose: () => void
}

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtIso = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const fmtHistoryEntry = (entry: StatusHistoryEntry | undefined) => {
  if (!entry) return null
  const dt = new Date(entry.setAt)
  const date = dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = dt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
  return { by: entry.setBy, at: `${date}, ${time}` }
}

function getWeekPresets() {
  const today = new Date()
  return Array.from({ length: 4 }, (_, i) => {
    const end = new Date(today)
    end.setDate(today.getDate() - i * 7)
    // Roll to Saturday
    end.setDate(end.getDate() + ((6 - end.getDay() + 7) % 7))
    const start = new Date(end)
    start.setDate(end.getDate() - 6)
    return {
      label: `WE ${end.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}`,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }
  })
}

export function InvoiceApprovalPrintModal({ invoices, pos, isTce, onClose }: Props) {
  const { activeProject } = useAppStore()
  const weekPresets = useMemo(() => getWeekPresets(), [])

  // Lock body scroll and mark for print isolation while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    document.body.classList.add('print-modal-open')
    return () => {
      document.body.style.overflow = ''
      document.body.classList.remove('print-modal-open')
    }
  }, [])

  // Default to current week
  const [dateFrom, setDateFrom] = useState(weekPresets[0].from)
  const [dateTo, setDateTo] = useState(weekPresets[0].to)
  const [showFilingRef, setShowFilingRef] = useState(true)
  const [showTce, setShowTce] = useState(isTce)

  const poMap = useMemo(() => Object.fromEntries(pos.map(p => [p.id, p])), [pos])

  const filtered = useMemo(() =>
    invoices
      .filter(i => (i.status === 'approved' || i.status === 'paid') && i.invoice_date && i.invoice_date >= dateFrom && i.invoice_date <= dateTo)
      .sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || ''))
  , [invoices, dateFrom, dateTo])

  const totalCost = filtered.reduce((s, i) => s + (i.amount || 0), 0)

  const fmtDateRange = () => {
    const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' }
    const f = new Date(dateFrom + 'T12:00:00').toLocaleDateString('en-AU', opts)
    const t = new Date(dateTo + 'T12:00:00').toLocaleDateString('en-AU', opts)
    return f === t ? f : `${f} — ${t}`
  }

  const projectName = activeProject?.name || '—'
  const siemensNo = (activeProject?.site_info?.siemens_project_no as string) || '—'
  const contractNo = (activeProject?.site_info?.contract_no as string) || '—'
  const client = activeProject?.client || '—'
  const cpmName = (activeProject?.site_info?.cpm_name as string) || '—'
  const pmName = activeProject?.pm || '—'
  const generatedDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="invoice-approval-print-root" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>

      {/* Controls bar — hidden on print */}
      <div className="no-print" style={{ background: '#1a1a2e', padding: '12px 24px', display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'sans-serif' }}>Date range (invoice date)</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '5px 8px', fontSize: 12, border: '1px solid #444', borderRadius: 4, fontFamily: 'sans-serif', background: '#2a2a3e', color: '#fff' }} />
            <span style={{ color: '#666', fontSize: 12 }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ padding: '5px 8px', fontSize: 12, border: '1px solid #444', borderRadius: 4, fontFamily: 'sans-serif', background: '#2a2a3e', color: '#fff' }} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'sans-serif' }}>Quick select</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {weekPresets.map(p => {
              const active = dateFrom === p.from && dateTo === p.to
              return (
                <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to) }}
                  style={{ padding: '4px 10px', fontSize: 11, fontFamily: 'sans-serif', border: '1px solid ' + (active ? '#c9a84c' : '#444'), borderRadius: 4, cursor: 'pointer', background: active ? '#c9a84c22' : 'transparent', color: active ? '#c9a84c' : '#aaa', fontWeight: active ? 700 : 400 }}>
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'sans-serif' }}>Columns</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {([['ISO Filing Ref', showFilingRef, setShowFilingRef], ...(isTce ? [['TCE Allocation', showTce, setShowTce]] : [])] as [string, boolean, (v: boolean) => void][]).map(([label, state, set]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontFamily: 'sans-serif', color: '#ccc' }}>
                <input type="checkbox" checked={state} onChange={e => set(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()}
            style={{ padding: '8px 18px', background: '#c9a84c', color: '#1a1a2e', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'sans-serif', fontWeight: 700, letterSpacing: '0.05em' }}>
            🖨 Print / PDF
          </button>
          <button onClick={onClose}
            style={{ padding: '8px 14px', background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'sans-serif' }}>
            ✕ Close
          </button>
        </div>
      </div>

      {/* Document */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 820, background: '#fff', boxShadow: '0 2px 24px rgba(0,0,0,0.15)', fontFamily: "'Georgia','Times New Roman',serif" }}>

          {/* Header */}
          <div style={{ background: '#1a1a2e', padding: '24px 36px 20px', borderBottom: '4px solid #c9a84c' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 6, fontFamily: 'sans-serif' }}>
                  Siemens Energy · Invoice Approval Record
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>{projectName}</div>
                <div style={{ fontSize: 12, color: '#8888aa', marginTop: 5, fontFamily: 'sans-serif' }}>{fmtDateRange()}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: '#555', fontFamily: 'sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>Generated</div>
                <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'sans-serif' }}>{generatedDate}</div>
              </div>
            </div>
          </div>

          {/* Project strip */}
          <div style={{ background: '#f5f3ee', borderBottom: '1px solid #e2dfd7', padding: '10px 36px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            {[['Project No.', siemensNo], ['Contract', contractNo], ['Client', client], ['Commercial PM', cpmName], ['Project Manager', pmName]].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#bbb', fontFamily: 'sans-serif', marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#222', fontFamily: 'sans-serif' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div style={{ padding: '12px 36px', borderBottom: '1px solid #e2dfd7', display: 'flex', gap: 0 }}>
            {[['Invoices in period', filtered.length.toString()], ['Total cost (ex GST)', fmt(totalCost)]].map(([label, value], i) => (
              <div key={label} style={{ paddingRight: 32, paddingLeft: i ? 32 : 0, borderLeft: i ? '1px solid #e2dfd7' : 'none' }}>
                <div style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#bbb', fontFamily: 'sans-serif', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e', fontFamily: 'sans-serif' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Invoice list */}
          <div style={{ padding: '20px 36px 28px' }}>
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '36px 0', color: '#bbb', fontFamily: 'sans-serif', fontSize: 13 }}>
                No approved invoices with invoice dates in this range.
              </div>
            )}

            {filtered.length > 0 && (
              <>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 96px 86px', gap: '0 10px', paddingBottom: 6, borderBottom: '2px solid #1a1a2e' }}>
                  <div />
                  {['Invoice / Vendor', 'PO Number', 'Amount (ex GST)'].map(h => (
                    <div key={h} style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#999', fontFamily: 'sans-serif', fontWeight: 700 }}>{h}</div>
                  ))}
                </div>

                {filtered.map((inv, idx) => {
                  const po = inv.po_id ? poMap[inv.po_id] : null
                  const vendor = po?.vendor || inv.vendor_details || '—'
                  const checkedEntry = inv.status_history?.find(h => h.status === 'checked')
                  const approvedEntry = [...(inv.status_history || [])].reverse().find(h => h.status === 'approved' || h.status === 'paid')
                  const checked = fmtHistoryEntry(checkedEntry)
                  const approved = fmtHistoryEntry(approvedEntry)

                  return (
                    <div key={inv.id} style={{ borderBottom: '1px solid #ede9e0' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 96px 86px', gap: '0 10px', padding: '11px 0 6px', alignItems: 'start' }}>
                        <div style={{ fontFamily: 'sans-serif', fontSize: 10, fontWeight: 700, color: '#c9a84c', paddingTop: 1 }}>
                          {String(idx + 1).padStart(2, '0')}
                        </div>

                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e' }}>{inv.invoice_number || '—'}</span>
                            <span style={{ fontSize: 11, color: '#555', fontFamily: 'sans-serif' }}>{vendor}</span>
                          </div>

                          {showFilingRef && inv.invoice_ref && (
                            <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#0369a1', background: '#eff6ff', display: 'inline-block', padding: '1px 5px', borderRadius: 2, border: '1px solid #bfdbfe', marginBottom: 3 }}>
                              {inv.invoice_ref}
                            </div>
                          )}

                          {showTce && isTce && inv.tce_item_id && (
                            <div style={{ fontSize: 9, color: '#888', fontFamily: 'sans-serif', marginBottom: 2 }}>
                              {inv.tce_item_id}
                            </div>
                          )}

                          <div style={{ fontSize: 9, color: '#bbb', fontFamily: 'sans-serif' }}>
                            Invoice date: <span style={{ color: '#777' }}>{fmtIso(inv.invoice_date)}</span>
                          </div>
                        </div>

                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#555', paddingTop: 1 }}>
                          {po?.po_number || '—'}
                        </div>

                        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#1a1a2e', paddingTop: 1, textAlign: 'right' }}>
                          {fmt(inv.amount)}
                        </div>
                      </div>

                      {/* Audit trail */}
                      <div style={{ display: 'flex', gap: 24, padding: '0 0 9px 36px' }}>
                        {checked && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 12, height: 12, background: '#6d28d9', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 7, fontWeight: 700, fontFamily: 'sans-serif', flexShrink: 0 }}>✓</span>
                            <span style={{ fontSize: 9, fontFamily: 'sans-serif', color: '#888' }}>
                              <span style={{ color: '#555', fontWeight: 600 }}>Checked</span> · {checked.by} · {checked.at}
                            </span>
                          </div>
                        )}
                        {approved && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 12, height: 12, background: '#0369a1', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 7, fontWeight: 700, fontFamily: 'sans-serif', flexShrink: 0 }}>✓</span>
                            <span style={{ fontSize: 9, fontFamily: 'sans-serif', color: '#888' }}>
                              <span style={{ color: '#555', fontWeight: 600 }}>Approved</span> · {approved.by} · {approved.at}
                            </span>
                          </div>
                        )}
                        {!checked && !approved && (
                          <span style={{ fontSize: 9, fontFamily: 'sans-serif', color: '#ddd' }}>No audit trail recorded</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Total */}
                <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 96px 86px', gap: '0 10px', padding: '10px 0 0', borderTop: '2px solid #1a1a2e' }}>
                  <div />
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1a1a2e', fontFamily: 'sans-serif' }}>
                    Total — {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
                  </div>
                  <div />
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#1a1a2e', textAlign: 'right' }}>
                    {fmt(totalCost)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid #e2dfd7', padding: '10px 36px', display: 'flex', justifyContent: 'space-between', background: '#f5f3ee' }}>
            <div style={{ fontSize: 8, color: '#ccc', fontFamily: 'sans-serif' }}>
              Generated by Overhaul Manager · {projectName} · {fmtDateRange()}
            </div>
            <div style={{ fontSize: 8, color: '#ccc', fontFamily: 'sans-serif' }}>CONFIDENTIAL — FOR INTERNAL USE</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body.print-modal-open > *:not(.invoice-approval-print-root) { display: none !important; }
          body { margin: 0 !important; padding: 0 !important; background: #fff !important; overflow: visible !important; }
          .invoice-approval-print-root { position: static !important; overflow: visible !important; background: #fff !important; }
          .invoice-approval-print-root > div:last-child { display: block !important; padding: 0 !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  )
}
