import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'

interface HardwareContract {
  id: string; vendor: string; status: string; value: number | null; currency: string
  line_items: { id: string; part_no: string; description: string; qty: number; transfer_price: number; customer_price: number }[]
}

type ReportType = 'full-contract' | 'price-comparison'

export function HardwareReportsPanel() {
  const { activeProject } = useAppStore()
  const [contracts, setContracts] = useState<HardwareContract[]>([])
  const [loading, setLoading] = useState(true)
  const [activeReport, setActiveReport] = useState<ReportType | null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('hardware_contracts')
      .select('id,vendor,status,value,currency,line_items')
      .eq('project_id', activeProject!.id)
    setContracts((data || []) as HardwareContract[])
    setLoading(false)
  }

  const allLines = contracts.flatMap(c => (c.line_items || []).map(l => ({ ...l, vendor: c.vendor, currency: c.currency })))
  const totalTransfer = allLines.reduce((s, l) => s + (l.transfer_price * l.qty || 0), 0)
  const totalCustomer = allLines.reduce((s, l) => s + (l.customer_price * l.qty || 0), 0)
  const fmtAmt = (n: number, cur = 'EUR') => (cur === 'EUR' ? '€' : '$') + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

  function exportReport() {
    if (activeReport === 'full-contract') {
      downloadCSV(
        [['Vendor', 'Part No', 'Description', 'Qty', 'Transfer Price', 'Customer Price', 'Total Transfer', 'Total Customer'],
         ...allLines.map(l => [l.vendor, l.part_no, l.description, l.qty, l.transfer_price, l.customer_price,
           l.transfer_price * l.qty, l.customer_price * l.qty])],
        `hardware-contract-${activeProject?.name}`
      )
    }
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Hardware Reports</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {contracts.length} contracts · {allLines.length} lines · Transfer {fmtAmt(totalTransfer)} · Customer {fmtAmt(totalCustomer)}
          </p>
        </div>
        {activeReport && <button className="btn btn-sm" onClick={exportReport}>⬇ Export CSV</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        {([
          ['full-contract', '📃', 'Full Contract List', 'All parts with original and escalated pricing'],
          ['price-comparison', '📊', 'Price Comparison', 'Original vs escalated prices across all years'],
        ] as [ReportType, string, string, string][]).map(([type, icon, title, desc]) => (
          <div key={type} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${activeReport === type ? 'var(--accent)' : 'var(--border)'}`, padding: '14px' }}
            onClick={() => setActiveReport(activeReport === type ? null : type)}>
            <div style={{ fontSize: '26px', marginBottom: '7px' }}>{icon}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{title}</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{desc}</div>
          </div>
        ))}
      </div>

      {activeReport === 'full-contract' && (
        allLines.length === 0 ? (
          <div className="empty-state"><div className="icon">📃</div><h3>No contract lines</h3><p>Add hardware contracts and line items first.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ fontSize: '12px' }}>
              <thead><tr><th>Vendor</th><th>Part No</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit Transfer</th><th style={{ textAlign: 'right' }}>Unit Customer</th><th style={{ textAlign: 'right' }}>Total Transfer</th></tr></thead>
              <tbody>
                {allLines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{l.vendor}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--accent)' }}>{l.part_no || '—'}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.qty}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.transfer_price ? fmtAmt(l.transfer_price) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{l.customer_price ? fmtAmt(l.customer_price) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{l.transfer_price ? fmtAmt(l.transfer_price * l.qty) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                  <td colSpan={6} style={{ padding: '8px 12px' }}>Total ({allLines.length} lines)</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmtAmt(totalTransfer)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {activeReport === 'price-comparison' && (
        <div style={{ padding: '20px', background: 'var(--bg3)', borderRadius: '8px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
          📈 Price comparison requires escalation factors set in the Hardware Escalation panel.
          {contracts.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '16px', justifyContent: 'center' }}>
              <div className="card" style={{ padding: '14px', minWidth: '140px', borderTop: '3px solid #7c3aed' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 700, color: '#7c3aed' }}>{fmtAmt(totalTransfer)}</div>
                <div style={{ fontSize: '11px', marginTop: '3px' }}>Transfer Value</div>
              </div>
              <div className="card" style={{ padding: '14px', minWidth: '140px', borderTop: '3px solid var(--green)' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 700, color: 'var(--green)' }}>{fmtAmt(totalCustomer)}</div>
                <div style={{ fontSize: '11px', marginTop: '3px' }}>Customer Value</div>
              </div>
            </div>
          )}
        </div>
      )}

      {!activeReport && contracts.length === 0 && (
        <div className="empty-state"><div className="icon">📄</div><h3>No hardware contracts</h3><p>Add contracts in the Hardware module first.</p></div>
      )}
    </div>
  )
}
