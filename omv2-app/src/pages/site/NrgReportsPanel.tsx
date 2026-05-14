/**
 * NrgReportsPanel — consolidated NRG customer reporting hub
 *
 * Reports:
 *  1. TasTK Timesheet Export  (from actuals — via NrgTimesheetExportModal)
 *  2. TCE Export              (from TCE register — via exportTceAll)
 *  3. NRG Expenses Report     (receipts/invoices evidence for customer)
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import { NrgTimesheetExportModal } from '../../components/NrgTimesheetExportModal'
import { exportTceAll } from '../../lib/exportTce'
import type { NrgTceLine } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceWeek { id: string; label: string; week_ending: string }

interface ExpenseRow {
  id: string
  date: string | null
  expense_ref: string | null
  tce_item_id: string | null
  description: string
  vendor: string
  sell_price: number
  gm_pct: number
  chargeable: boolean
  cost_ex_gst: number
}

interface InvoiceRow {
  id: string
  invoice_date: string | null
  invoice_ref: string | null
  tce_item_id: string | null
  vendor_details: string | null
  amount: number | null
  sell_price: number | null
  gm_pct: number | null
  chargeable: boolean
  po_id: string | null
  // joined
  po?: { vendor: string | null } | null
}

interface TceLookup { [itemId: string]: { item_id: string; description: string } }

const fmt = (v: number | null | undefined) =>
  v != null ? '$' + Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtDate = (s?: string | null) => (s ? s.split('-').reverse().join('/') : '—')
const fmtPct = (v: number | null | undefined) => (v != null ? Number(v).toFixed(1) + '%' : '—')

// ── Component ─────────────────────────────────────────────────────────────────

export function NrgReportsPanel() {
  const { activeProject } = useAppStore()

  // — TasTK —
  const [showTimesheetModal, setShowTimesheetModal] = useState(false)

  // — TCE export —
  const [tceLines, setTceLines] = useState<NrgTceLine[]>([])
  const [tceInvoiceWeeks, setTceInvoiceWeeks] = useState<InvoiceWeek[]>([])
  const [tceSelectedWeeks, setTceSelectedWeeks] = useState<Set<string>>(new Set())
  const [exportingTce, setExportingTce] = useState(false)
  const [showTceWeekPicker, setShowTceWeekPicker] = useState(false)
  const [tceWeeksLoading, setTceWeeksLoading] = useState(false)

  // — NRG Expenses report —
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [tceLookup, setTceLookup] = useState<TceLookup>({})
  const [loading, setLoading] = useState(false)
  const [expFilter, setExpFilter] = useState<'all' | 'chargeable' | 'nonchargeable'>('all')
  const [expSearch, setExpSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    if (activeProject) load()
  }, [activeProject?.id])

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id

    const [expData, invData, tceData, weeksData] = await Promise.all([
      supabase
        .from('expenses')
        .select('id,date,expense_ref,tce_item_id,description,vendor,sell_price,gm_pct,chargeable,cost_ex_gst')
        .eq('project_id', pid)
        .order('date', { ascending: false }),
      supabase
        .from('invoices')
        .select('id,invoice_date,invoice_ref,tce_item_id,vendor_details,amount,sell_price,gm_pct,chargeable,po_id,purchase_orders(vendor)')
        .eq('project_id', pid)
        .in('status', ['approved', 'paid'])
        .order('invoice_date', { ascending: false }),
      supabase
        .from('nrg_tce_lines')
        .select('id,item_id,description,wbs_code,source,tce_total,category,kpi_included,line_type,work_order,contract_scope,unit_type,estimated_qty,tce_rate,details')
        .eq('project_id', pid)
        .order('item_id'),
      supabase
        .from('nrg_customer_invoices')
        .select('id,week_ending')
        .eq('project_id', pid)
        .order('week_ending'),
    ])

    setExpenses((expData.data || []) as ExpenseRow[])

    // Normalise invoice join
    // Supabase returns purchase_orders as array from the join; normalise to single object
    type RawInv = Omit<InvoiceRow, 'po'> & { purchase_orders?: { vendor: string | null }[] | null }
    const rawInvs = (invData.data || []) as unknown as RawInv[]
    setInvoices(rawInvs.map(inv => ({
      ...inv,
      po: inv.purchase_orders?.[0] ?? null,
    })))

    const lines = (tceData.data || []) as NrgTceLine[]
    setTceLines(lines)

    const lookup: TceLookup = {}
    lines.forEach(l => { if (l.item_id) lookup[l.item_id] = { item_id: l.item_id, description: l.description } })
    setTceLookup(lookup)

    const weeks: InvoiceWeek[] = (weeksData.data || []).map((w: { id: string; week_ending: string }) => ({
      id: w.id,
      week_ending: w.week_ending,
      label: `Week ending ${fmtDate(w.week_ending)}`,
    }))
    setTceInvoiceWeeks(weeks)

    setLoading(false)
  }

  // ── TCE Export ──────────────────────────────────────────────────────────────

  async function openTceWeekPicker() {
    setTceWeeksLoading(true)
    await load()
    setShowTceWeekPicker(true)
    setTceWeeksLoading(false)
  }

  async function doExportTce() {
    if (!activeProject || tceSelectedWeeks.size === 0) return
    const orderedWeeks = tceInvoiceWeeks
      .filter(i => tceSelectedWeeks.has(i.id))
      .map(i => i.week_ending)
    setExportingTce(true)
    setShowTceWeekPicker(false)
    try {
      await exportTceAll(activeProject.id, activeProject.name || 'project', tceLines, orderedWeeks)
    } catch (e) {
      toast('Export failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setExportingTce(false)
    }
  }

  // ── NRG Expenses CSV export ─────────────────────────────────────────────────

  function buildExpensesRows() {
    // Expenses
    const expRows = expenses
      .filter(e => {
        if (expFilter !== 'nonchargeable' && !e.chargeable) return false
        if (expFilter === 'nonchargeable' && e.chargeable) return false
        if (dateFrom && e.date && e.date < dateFrom) return false
        if (dateTo && e.date && e.date > dateTo) return false
        if (expSearch) {
          const q = expSearch.toLowerCase()
          return (
            (e.description || '').toLowerCase().includes(q) ||
            (e.vendor || '').toLowerCase().includes(q) ||
            (e.expense_ref || '').toLowerCase().includes(q) ||
            (e.tce_item_id || '').toLowerCase().includes(q)
          )
        }
        return true
      })
      .map(e => ({
        type: 'Expense',
        date: fmtDate(e.date),
        ref: e.expense_ref || '—',
        tce_item_id: e.tce_item_id || '—',
        tce_description: e.tce_item_id ? (tceLookup[e.tce_item_id]?.description || '—') : '—',
        vendor: e.vendor,
        description: e.description,
        cost_price: e.cost_ex_gst ?? 0,
        sell_price: e.chargeable ? (e.sell_price ?? e.cost_ex_gst) : 0,
        gm_pct: e.chargeable ? e.gm_pct : 0,
        chargeable: e.chargeable ? 'Yes' : 'No',
      }))

    // Invoices
    const invRows = invoices
      .filter(i => {
        if (expFilter !== 'nonchargeable' && !i.chargeable) return false
        if (expFilter === 'nonchargeable' && i.chargeable) return false
        if (dateFrom && i.invoice_date && i.invoice_date < dateFrom) return false
        if (dateTo && i.invoice_date && i.invoice_date > dateTo) return false
        if (expSearch) {
          const q = expSearch.toLowerCase()
          const vendor = i.po?.vendor || i.vendor_details || ''
          return (
            vendor.toLowerCase().includes(q) ||
            (i.invoice_ref || '').toLowerCase().includes(q) ||
            (i.tce_item_id || '').toLowerCase().includes(q)
          )
        }
        return true
      })
      .map(i => ({
        type: 'Invoice',
        date: fmtDate(i.invoice_date),
        ref: i.invoice_ref || '—',
        tce_item_id: i.tce_item_id || '—',
        tce_description: i.tce_item_id ? (tceLookup[i.tce_item_id]?.description || '—') : '—',
        vendor: i.po?.vendor || i.vendor_details || '—',
        description: '—',
        cost_price: i.amount ?? 0,
        sell_price: i.chargeable ? (i.sell_price ?? i.amount ?? 0) : 0,
        gm_pct: i.chargeable ? (i.gm_pct ?? 0) : 0,
        chargeable: i.chargeable ? 'Yes' : 'No',
      }))

    return [...expRows, ...invRows].sort((a, b) => a.date.localeCompare(b.date))
  }

  function exportExpensesCSV() {
    const rows = buildExpensesRows()
    if (!rows.length) { toast('No data to export', 'info'); return }
    const headers = ['Type','Date','SPOL / ISO Filing Ref','TCE Item ID','TCE Description','Vendor','Description','Cost Price','Sell Price','GM %','Chargeable']
    const csvRows: (string | number | boolean | null | undefined)[][] = [
      headers,
      ...rows.map(r => [r.type, r.date, r.ref, r.tce_item_id, r.tce_description, r.vendor, r.description, r.cost_price.toFixed(2), r.sell_price.toFixed(2), r.gm_pct.toFixed(1), r.chargeable]),
    ]
    downloadCSV(csvRows, `NRG_Expenses_${activeProject?.name || 'project'}`)
    toast('Exported', 'success')
  }

  // ── Filtered rows for table display ─────────────────────────────────────────

  const displayRows = buildExpensesRows()

  const totalSell = displayRows.reduce((s, r) => s + (r.sell_price || 0), 0)
  const chargeableCount = displayRows.filter(r => r.chargeable === 'Yes').length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>NRG Reports</h1>
        <p style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '4px' }}>
          Customer-facing reports for NRG Gladstone
        </p>
      </div>

      {/* ── Report Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '32px' }}>

        {/* TasTK Timesheet */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>🕒</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>TasTK Timesheet</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px', lineHeight: 1.5 }}>
            Export timesheet from actuals in TasTK XML format. Covers all approved labour for the selected period.
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => setShowTimesheetModal(true)}
          >
            📤 Export Timesheet
          </button>
        </div>

        {/* TCE Export */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>📊</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>TCE Export</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px', lineHeight: 1.5 }}>
            Export TCE register data to NRG's Excel template. Select invoice weeks to include in the export.
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={openTceWeekPicker}
            disabled={exportingTce || tceWeeksLoading}
          >
            {exportingTce
              ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Exporting…</>
              : tceWeeksLoading
                ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Loading…</>
                : '📊 Export TCE'
            }
          </button>
          {tceLines.length > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px', textAlign: 'center' }}>
              {tceLines.length} TCE lines · {tceInvoiceWeeks.length} invoice weeks
            </div>
          )}
        </div>

        {/* NRG Expenses */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>🧾</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>NRG Expenses Report</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px', lineHeight: 1.5 }}>
            All receipts and invoices with SPOL ref, TCE allocation, sell price and GM%. Evidence report for the customer.
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={exportExpensesCSV}
            disabled={loading}
          >
            📥 Export to CSV
          </button>
          {!loading && (
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px', textAlign: 'center' }}>
              {expenses.length} expenses · {invoices.length} invoices
            </div>
          )}
        </div>

      </div>

      {/* ── NRG Expenses Table ── */}
      <div className="card" style={{ padding: '0' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, flex: 1 }}>Expenses &amp; Invoices Preview</div>
          <input
            className="input"
            style={{ width: '200px', fontSize: '12px' }}
            placeholder="Search ref, vendor, TCE…"
            value={expSearch}
            onChange={e => setExpSearch(e.target.value)}
          />
          <input type="date" className="input" style={{ width: '140px', fontSize: '12px' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
          <span style={{ fontSize: '12px', color: 'var(--text3)' }}>–</span>
          <input type="date" className="input" style={{ width: '140px', fontSize: '12px' }} value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
          {(dateFrom || dateTo) && (
            <button className="btn btn-sm" onClick={() => { setDateFrom(''); setDateTo('') }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
          {(['all', 'chargeable', 'nonchargeable'] as const).map(f => (
            <button
              key={f}
              className={`btn btn-sm${expFilter === f ? ' btn-primary' : ''}`}
              onClick={() => setExpFilter(f)}
            >
              {f === 'all' ? '✓ All Chargeable' : f === 'chargeable' ? '✓ Chargeable' : '✗ Non-chargeable'}
            </button>
          ))}
          <button className="btn btn-sm" onClick={exportExpensesCSV}>⬇ CSV</button>
        </div>

        {/* Summary strip */}
        <div style={{ padding: '8px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '24px', fontSize: '12px' }}>
          <span><b>{displayRows.length}</b> rows</span>
          <span><b>{chargeableCount}</b> chargeable</span>
          <span>Total sell: <b style={{ color: 'var(--accent)' }}>{fmt(totalSell)}</b></span>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
        ) : displayRows.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            No expenses or invoices found{expSearch ? ' matching search' : ''}.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--bg2)', borderBottom: '2px solid var(--border)' }}>
                  {['Type', 'Date', 'SPOL / ISO Filing Ref', 'TCE Item', 'TCE Description', 'Vendor / Description', 'Cost Price', 'Sell Price', 'GM %', 'Chargeable'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg2)' }}>
                    <td style={{ padding: '7px 10px' }}>
                      <span style={{
                        fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px',
                        background: row.type === 'Expense' ? '#dbeafe' : '#fef3c7',
                        color: row.type === 'Expense' ? '#1d4ed8' : '#d97706',
                      }}>
                        {row.type}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{row.date}</td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: '11px', color: row.ref !== '—' ? 'var(--accent)' : 'var(--text3)' }}>
                      {row.ref}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: '11px' }}>{row.tce_item_id}</td>
                    <td style={{ padding: '7px 10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.tce_description}</td>
                    <td style={{ padding: '7px 10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div>{row.vendor}</div>
                      {row.description && row.description !== '—' && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{row.description}</div>}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                      {fmt(row.cost_price)}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.chargeable === 'Yes' ? fmt(row.sell_price) : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {row.chargeable === 'Yes' ? fmtPct(row.gm_pct) : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      {row.chargeable === 'Yes'
                        ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✓</span>
                        : <span style={{ color: 'var(--text3)' }}>✗</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── TCE Week Picker Modal ── */}
      {showTceWeekPicker && (
        <div className="modal-overlay" onClick={() => setShowTceWeekPicker(false)}>
          <div className="modal" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Export TCE — Select Weeks</h2>
              <button className="modal-close" onClick={() => setShowTceWeekPicker(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {tceInvoiceWeeks.length === 0 ? (
                <p style={{ color: 'var(--text3)', textAlign: 'center', padding: '20px' }}>
                  No invoice weeks found. Create customer invoices in NRG Invoicing first.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '12px' }}>
                    Select invoice weeks to include. Week 1 in the export = first ticked, etc.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className="btn btn-sm" onClick={() => setTceSelectedWeeks(new Set(tceInvoiceWeeks.map(i => i.id)))}>Select All</button>
                    <button className="btn btn-sm" onClick={() => setTceSelectedWeeks(new Set())}>Clear</button>
                  </div>
                  {tceInvoiceWeeks.map((inv, idx) => {
                    const checked = tceSelectedWeeks.has(inv.id)
                    const weekNum = checked
                      ? [...tceInvoiceWeeks].filter(i => tceSelectedWeeks.has(i.id)).findIndex(i => i.id === inv.id) + 1
                      : null
                    return (
                      <label key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '4px', cursor: 'pointer', background: checked ? 'var(--accent-soft)' : 'transparent', marginBottom: '4px' }}>
                        <input type="checkbox" checked={checked} onChange={e => {
                          const s = new Set(tceSelectedWeeks)
                          if (e.target.checked) s.add(inv.id); else s.delete(inv.id)
                          setTceSelectedWeeks(s)
                        }} />
                        <span style={{ flex: 1, fontSize: '13px' }}>{inv.label}</span>
                        {weekNum && <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>Week {weekNum}</span>}
                        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>#{idx + 1}</span>
                      </label>
                    )
                  })}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowTceWeekPicker(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doExportTce} disabled={tceSelectedWeeks.size === 0 || exportingTce}>
                Export {tceSelectedWeeks.size > 0 ? `(${tceSelectedWeeks.size} week${tceSelectedWeeks.size !== 1 ? 's' : ''})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TasTK Timesheet Modal ── */}
      {showTimesheetModal && <NrgTimesheetExportModal onClose={() => setShowTimesheetModal(false)} />}
    </div>
  )
}
