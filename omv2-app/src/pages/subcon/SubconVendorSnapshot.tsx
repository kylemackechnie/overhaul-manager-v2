import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const fmt = (n: number) => n > 0 ? '$' + Math.round(n).toLocaleString('en-AU') : '—'

interface VendorRow {
  vendor: string
  contracts: number; contractValue: number
  invoices: number; invoiced: number
  cars: number; carCost: number
  hire: number; hireCost: number
  accom: number; accomCost: number
  total: number
}

export function SubconVendorSnapshot() {
  const { activeProject } = useAppStore()
  const [rows, setRows] = useState<VendorRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [cRes, invRes, carRes, hireRes, accomRes] = await Promise.all([
      supabase.from('purchase_orders').select('vendor,po_value,quote_source').eq('project_id', pid),
      supabase.from('invoices').select('vendor_ref,amount').eq('project_id', pid),
      supabase.from('cars').select('vendor,total_cost').eq('project_id', pid),
      supabase.from('hire_items').select('vendor,hire_cost').eq('project_id', pid),
      supabase.from('accommodation').select('vendor,total_cost').eq('project_id', pid),
    ])

    const map: Record<string, VendorRow> = {}
    const ensure = (v: string) => {
      if (!v) return
      if (!map[v]) map[v] = { vendor: v, contracts: 0, contractValue: 0, invoices: 0, invoiced: 0, cars: 0, carCost: 0, hire: 0, hireCost: 0, accom: 0, accomCost: 0, total: 0 }
    }

    for (const c of cRes.data || []) { ensure(c.vendor); if (!c.vendor) continue; map[c.vendor].contracts++; map[c.vendor].contractValue += (c as {po_value?:number}).po_value || 0 }
    for (const i of invRes.data || []) { ensure(i.vendor_ref); if (!i.vendor_ref) continue; map[i.vendor_ref].invoices++; map[i.vendor_ref].invoiced += i.amount || 0 }
    for (const c of carRes.data || []) { ensure(c.vendor); if (!c.vendor) continue; map[c.vendor].cars++; map[c.vendor].carCost += c.total_cost || 0 }
    for (const h of hireRes.data || []) { ensure(h.vendor); if (!h.vendor) continue; map[h.vendor].hire++; map[h.vendor].hireCost += h.hire_cost || 0 }
    for (const a of accomRes.data || []) { ensure(a.vendor); if (!a.vendor) continue; map[a.vendor].accom++; map[a.vendor].accomCost += a.total_cost || 0 }

    const result = Object.values(map).map(r => ({
      ...r, total: r.contractValue + r.invoiced + r.carCost + r.hireCost + r.accomCost
    })).sort((a, b) => b.total - a.total)

    setRows(result)
    setLoading(false)
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Vendor Snapshot</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Cost summary by vendor across labour and equipment</p>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--mono)', color: '#7c3aed' }}>{fmt(grandTotal)}</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state"><div className="icon">📊</div><h3>No vendor data yet</h3><p>Add contracts, invoices, hire items, and accommodation to see the vendor breakdown.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th style={{ textAlign: 'right' }}>Contracts</th>
                <th style={{ textAlign: 'right' }}>Contract Value</th>
                <th style={{ textAlign: 'right' }}>Invoiced</th>
                <th style={{ textAlign: 'right' }}>Hire Cost</th>
                <th style={{ textAlign: 'right' }}>Car Cost</th>
                <th style={{ textAlign: 'right' }}>Accom Cost</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.vendor}>
                  <td style={{ fontWeight: 600 }}>{r.vendor}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{r.contracts > 0 ? r.contracts : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.contractValue)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{fmt(r.invoiced)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.hireCost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.carCost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.accomCost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700, color: '#7c3aed' }}>{fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                <td>TOTAL</td>
                <td colSpan={6}></td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed' }}>{fmt(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
