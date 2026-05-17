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

  const [dateFrom, setDateFrom] = useState(weekPresets[0].from)
  const [dateTo, setDateTo] = useState(weekPresets[0].to)
  const [showFilingRef, setShowFilingRef] = useState(true)
  const [showTce, setShowTce] = useState(isTce)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    document.body.classList.add('print-modal-open')
    return () => {
      document.body.style.overflow = ''
      document.body.classList.remove('print-modal-open')
    }
  }, [])

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
  const siemensNo   = (activeProject?.site_info?.siemens_project_no as string) || '—'
  const contractNo  = (activeProject?.site_info?.contract_no as string) || '—'
  const client      = activeProject?.client || '—'
  const cpmName = (activeProject?.site_info?.cpm_name as string) || '—'
  const pmName      = activeProject?.pm || '—'
  const generatedDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="invoice-approval-print-root" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.55)' }}>

      {/* Controls — hidden on print */}
      <div className="no-print" style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '10px 20px', display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Date range (invoice date)</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" style={{ fontSize: 12, padding: '4px 8px', width: 140 }} />
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" style={{ fontSize: 12, padding: '4px 8px', width: 140 }} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Quick select</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {weekPresets.map(p => {
              const active = dateFrom === p.from && dateTo === p.to
              return (
                <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to) }}
                  className={active ? 'btn btn-primary' : 'btn btn-sm'}
                  style={{ fontSize: 11, padding: '4px 10px' }}>
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Columns</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {([['ISO Filing Ref', showFilingRef, setShowFilingRef], ...(isTce ? [['TCE Allocation', showTce, setShowTce]] : [])] as [string, boolean, (v: boolean) => void][]).map(([label, state, set]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>
                <input type="checkbox" checked={state} onChange={e => set(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: 12 }}>🖨 Print / PDF</button>
          <button onClick={onClose} className="btn btn-sm" style={{ fontSize: 12 }}>✕ Close</button>
        </div>
      </div>

      {/* Document — scrollable area */}
      <div className="invoice-approval-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div className="invoice-approval-document" style={{ width: 800, maxWidth: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', fontFamily: 'var(--font, system-ui, sans-serif)' }}>

          {/* Header strip */}
          <div style={{ background: 'var(--accent)', padding: '16px 28px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
                  Invoice Approval Record
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{projectName}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>{fmtDateRange()}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Generated</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--mono)' }}>{generatedDate}</div>
              </div>
            </div>
          </div>

          {/* Project details strip */}
          <div style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)', padding: '8px 28px', display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {[['Project No.', siemensNo], ['Contract', contractNo], ['Client', client], ['Commercial PM', cpmName], ['Project Manager', pmName]].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Summary row */}
          <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 28px', display: 'flex', gap: 0 }}>
            {[['Invoices in period', filtered.length.toString()], ['Total cost (ex GST)', fmt(totalCost)]].map(([label, value], i) => (
              <div key={label} style={{ paddingRight: 28, paddingLeft: i ? 28 : 0, borderLeft: i ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: i ? 'var(--mono)' : undefined }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Invoice list */}
          <div style={{ padding: '16px 28px 24px' }}>
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text3)', fontSize: 13 }}>
                No approved invoices with invoice dates in this range.
              </div>
            )}

            {filtered.length > 0 && (
              <>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 82px', gap: '0 8px', paddingBottom: 5, borderBottom: '2px solid var(--text)', marginBottom: 0 }}>
                  <div />
                  {['Invoice / Vendor', 'PO Number', 'Amount'].map(h => (
                    <div key={h} style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 700 }}>{h}</div>
                  ))}
                </div>

                {filtered.map((inv, idx) => {
                  const po = inv.po_id ? poMap[inv.po_id] : null
                  const vendor = po?.vendor || inv.vendor_details || '—'
                  const checkedEntry  = inv.status_history?.find(h => h.status === 'checked')
                  const approvedEntry = [...(inv.status_history || [])].reverse().find(h => h.status === 'approved' || h.status === 'paid')
                  const checked  = fmtHistoryEntry(checkedEntry)
                  const approved = fmtHistoryEntry(approvedEntry)

                  return (
                    <div key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      {/* Main row */}
                      <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 82px', gap: '0 8px', padding: '10px 0 5px', alignItems: 'start' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', paddingTop: 1, fontFamily: 'var(--mono)' }}>
                          {String(idx + 1).padStart(2, '0')}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{inv.invoice_number || '—'}</span>
                            <span style={{ fontSize: 11, color: 'var(--text2)' }}>{vendor}</span>
                          </div>
                          {showFilingRef && inv.invoice_ref && (
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--accent)', background: 'var(--accent-light)', display: 'inline-block', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--accent)', marginBottom: 3 }}>
                              {inv.invoice_ref}
                            </div>
                          )}
                          {showTce && isTce && inv.tce_item_id && (
                            <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 2, fontFamily: 'var(--mono)' }}>
                              {inv.tce_item_id}
                            </div>
                          )}
                          <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                            Invoice date: <span style={{ color: 'var(--text2)' }}>{fmtIso(inv.invoice_date)}</span>
                          </div>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', paddingTop: 1 }}>
                          {po?.po_number || '—'}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--text)', paddingTop: 1, textAlign: 'right' }}>
                          {fmt(inv.amount)}
                        </div>
                      </div>

                      {/* Audit trail */}
                      <div style={{ display: 'flex', gap: 20, padding: '0 0 8px 32px' }}>
                        {checked && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 12, height: 12, background: '#7c3aed', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 7, fontWeight: 700, flexShrink: 0 }}>✓</span>
                            <span style={{ fontSize: 9, color: 'var(--text3)' }}>
                              <span style={{ color: 'var(--text2)', fontWeight: 600 }}>Checked</span> · {checked.by} · {checked.at}
                            </span>
                          </div>
                        )}
                        {approved && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 12, height: 12, background: 'var(--accent)', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 7, fontWeight: 700, flexShrink: 0 }}>✓</span>
                            <span style={{ fontSize: 9, color: 'var(--text3)' }}>
                              <span style={{ color: 'var(--text2)', fontWeight: 600 }}>Approved</span> · {approved.by} · {approved.at}
                            </span>
                          </div>
                        )}
                        {!checked && !approved && (
                          <span style={{ fontSize: 9, color: 'var(--text3)' }}>No audit trail recorded</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Total */}
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 82px', gap: '0 8px', padding: '10px 0 0', borderTop: '2px solid var(--text)' }}>
                  <div />
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                    Total — {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
                  </div>
                  <div />
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>
                    {fmt(totalCost)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 28px', display: 'flex', justifyContent: 'space-between', background: 'var(--bg3)' }}>
            <div style={{ fontSize: 8, color: 'var(--text3)' }}>
              Generated by Overhaul Manager · {projectName} · {fmtDateRange()}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text3)' }}>CONFIDENTIAL — FOR INTERNAL USE</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body.print-modal-open > *:not(.invoice-approval-print-root) { display: none !important; }
          body { margin: 0 !important; padding: 0 !important; background: #fff !important; overflow: visible !important; }
          .invoice-approval-print-root {
            position: static !important;
            display: block !important;
            background: #fff !important;
            overflow: visible !important;
            width: 100% !important;
            height: auto !important;
          }
          .invoice-approval-scroll {
            display: block !important;
            overflow: visible !important;
            padding: 0 !important;
            height: auto !important;
          }
          .invoice-approval-document {
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  )
}
