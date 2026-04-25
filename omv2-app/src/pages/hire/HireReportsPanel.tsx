import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'

interface HireItem {
  id: string; name: string; vendor: string; hire_type: string
  start_date: string | null; end_date: string | null
  hire_cost: number; customer_total: number; gm_pct: number
  currency: string; daily_rate: number | null
}

type ReportType = 'summary' | 'monthly' | 'vendor' | 'customer'

const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const fmtPct = (n: number) => n.toFixed(1) + '%'

function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  return Math.max(0, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

export function HireReportsPanel() {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<HireItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeReport, setActiveReport] = useState<ReportType | null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('hire_items')
      .select('id,name,vendor,hire_type,start_date,end_date,hire_cost,customer_total,gm_pct,currency,daily_rate')
      .eq('project_id', activeProject!.id)
      .order('hire_type').order('start_date')
    setItems((data || []) as HireItem[])
    setLoading(false)
  }

  const totalCost = items.reduce((s, i) => s + (i.hire_cost || 0), 0)
  const totalSell = items.reduce((s, i) => s + (i.customer_total || 0), 0)
  const gm = totalSell > 0 ? ((totalSell - totalCost) / totalSell * 100) : 0

  function exportReport() {
    if (!activeReport) return
    const rows: (string | number)[][] = []
    if (activeReport === 'summary') {
      rows.push(['Name', 'Type', 'Vendor', 'Start', 'End', 'Days', 'Daily Rate', 'Cost', 'Sell', 'GM%'])
      items.forEach(i => rows.push([i.name, i.hire_type, i.vendor || '—', i.start_date || '—', i.end_date || '—',
        daysBetween(i.start_date, i.end_date), i.daily_rate || '', i.hire_cost, i.customer_total, i.gm_pct]))
    } else if (activeReport === 'vendor') {
      const byVendor: Record<string, { cost: number; sell: number; items: string[] }> = {}
      items.forEach(i => {
        const v = i.vendor || 'Unknown'
        if (!byVendor[v]) byVendor[v] = { cost: 0, sell: 0, items: [] }
        byVendor[v].cost += i.hire_cost || 0
        byVendor[v].sell += i.customer_total || 0
        byVendor[v].items.push(i.name)
      })
      rows.push(['Vendor', 'Items', 'Total Cost', 'Total Sell', 'GM%'])
      Object.entries(byVendor).forEach(([v, d]) => {
        const gm = d.sell > 0 ? ((d.sell - d.cost) / d.sell * 100).toFixed(1) : '—'
        rows.push([v, d.items.join('; '), d.cost, d.sell, gm])
      })
    }
    downloadCSV(rows, `hire-${activeReport}-${activeProject?.name || 'report'}`)
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Hire Reports</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {items.length} items · Cost {fmt(totalCost)} · Sell {fmt(totalSell)} · GM {fmtPct(gm)}
          </p>
        </div>
        {activeReport && <button className="btn btn-sm" onClick={exportReport}>⬇ Export CSV</button>}
      </div>

      {/* Report selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {([
          ['summary', '📊', 'Weekly Cost Summary', 'All hire items with duration and costs'],
          ['monthly', '📅', 'Monthly Breakdown', 'Costs by item broken down by month'],
          ['vendor', '🏢', 'Vendor Spend', 'Total spend grouped by vendor'],
          ['customer', '💵', 'Customer Charge Report', 'Customer pricing for all hire items'],
        ] as [ReportType, string, string, string][]).map(([type, icon, title, desc]) => (
          <div key={type} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${activeReport === type ? 'var(--accent)' : 'var(--border)'}`, padding: '14px', background: activeReport === type ? 'rgba(99,102,241,.04)' : undefined }}
            onClick={() => setActiveReport(activeReport === type ? null : type)}>
            <div style={{ fontSize: '24px', marginBottom: '6px' }}>{icon}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{title}</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Report output */}
      {activeReport === 'summary' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>All Hire Items</div>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>Name</th><th>Type</th><th>Vendor</th><th>Start</th><th>End</th><th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Daily</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Sell</th><th style={{ textAlign: 'right' }}>GM%</th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 500 }}>{i.name}</td>
                  <td style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)' }}>{i.hire_type}</td>
                  <td style={{ color: 'var(--text2)' }}>{i.vendor || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{i.start_date || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{i.end_date || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{daysBetween(i.start_date, i.end_date) || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{i.daily_rate ? fmt(i.daily_rate) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(i.hire_cost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(i.customer_total)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{i.gm_pct ? fmtPct(i.gm_pct) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                <td colSpan={7} style={{ padding: '8px 12px' }}>Total</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmt(totalCost)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--green)' }}>{fmt(totalSell)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmtPct(gm)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeReport === 'monthly' && (() => {
        const byMonth: Record<string, { cost: number; sell: number; names: string[] }> = {}
        items.forEach(i => {
          const start = i.start_date; const end = i.end_date
          if (!start) return
          const days = daysBetween(start, end) || 1
          const d = new Date(start)
          const endD = end ? new Date(end) : new Date(start)
          while (d <= endD) {
            const mk = d.toISOString().slice(0, 7)
            if (!byMonth[mk]) byMonth[mk] = { cost: 0, sell: 0, names: [] }
            byMonth[mk].cost += (i.hire_cost || 0) / days
            byMonth[mk].sell += (i.customer_total || 0) / days
            if (!byMonth[mk].names.includes(i.name)) byMonth[mk].names.push(i.name)
            d.setDate(d.getDate() + 1)
          }
        })
        return (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>Monthly Breakdown</div>
            <table style={{ fontSize: '12px' }}>
              <thead><tr><th>Month</th><th>Active Items</th><th style={{ textAlign: 'right' }}>Accrued Cost</th><th style={{ textAlign: 'right' }}>Accrued Sell</th></tr></thead>
              <tbody>
                {Object.entries(byMonth).sort().map(([m, d]) => (
                  <tr key={m}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{m}</td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.names.join(', ')}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(d.cost)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(d.sell)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {activeReport === 'vendor' && (() => {
        const byVendor: Record<string, { cost: number; sell: number; count: number }> = {}
        items.forEach(i => {
          const v = i.vendor || 'Unknown'
          if (!byVendor[v]) byVendor[v] = { cost: 0, sell: 0, count: 0 }
          byVendor[v].cost += i.hire_cost || 0
          byVendor[v].sell += i.customer_total || 0
          byVendor[v].count++
        })
        return (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>Vendor Spend</div>
            <table style={{ fontSize: '12px' }}>
              <thead><tr><th>Vendor</th><th style={{ textAlign: 'right' }}>Items</th><th style={{ textAlign: 'right' }}>Total Cost</th><th style={{ textAlign: 'right' }}>Total Sell</th><th style={{ textAlign: 'right' }}>GM%</th></tr></thead>
              <tbody>
                {Object.entries(byVendor).sort((a, b) => b[1].cost - a[1].cost).map(([v, d]) => {
                  const gm = d.sell > 0 ? ((d.sell - d.cost) / d.sell * 100) : 0
                  return (
                    <tr key={v}>
                      <td style={{ fontWeight: 500 }}>{v}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{d.count}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(d.cost)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(d.sell)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{fmtPct(gm)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}

      {activeReport === 'customer' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>Customer Charge Report</div>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>Name</th><th>Type</th><th>Start</th><th>End</th><th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Customer Charge</th><th style={{ textAlign: 'right' }}>GM%</th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 500 }}>{i.name}</td>
                  <td style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)' }}>{i.hire_type}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{i.start_date || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{i.end_date || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{daysBetween(i.start_date, i.end_date) || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--green)' }}>{fmt(i.customer_total)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{i.gm_pct ? fmtPct(i.gm_pct) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                <td colSpan={5} style={{ padding: '8px 12px' }}>Total</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--green)' }}>{fmt(totalSell)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmtPct(gm)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {items.length === 0 && !activeReport && (
        <div className="empty-state">
          <div className="icon">📄</div>
          <h3>No hire data</h3>
          <p>Add hire items to generate reports.</p>
        </div>
      )}
    </div>
  )
}
