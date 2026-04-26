import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'

interface TV { tv_no: number; header_name: string | null; departure_date: string | null; eta_pod: string | null }
interface Costing { tv_no: string; charge_start: string | null; charge_end: string | null; cost_eur: number; sell_eur: number; linked_po_id: string | null }
interface Kollo { tv_no: string; kollo_id: string; gross: number; net: number; length: number; width: number; height: number; delivery_package: string }

type ReportType = 'cost-summary' | 'package-list'

export function ToolingReportsPanel() {
  const { activeProject } = useAppStore()
  const [tvs, setTvs] = useState<TV[]>([])
  const [costings, setCostings] = useState<Costing[]>([])
  const [kollos, setKollos] = useState<Kollo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeReport, setActiveReport] = useState<ReportType | null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [tvRes, costRes, kolloRes, projTvRes] = await Promise.all([
      supabase.from('global_tvs').select('tv_no,header_name,departure_date,eta_pod').order('tv_no'),
      supabase.from('tooling_costings').select('*').eq('project_id', pid).order('tv_no'),
      supabase.from('global_kollos').select('*').order('tv_no'),
      supabase.from('project_tvs').select('tv_no').eq('project_id', pid).eq('tv_type','tooling'),
    ])
    const projTvNos = new Set((projTvRes.data || []).map(t => t.tv_no))
    setTvs(((tvRes.data || []) as TV[]).filter(t => projTvNos.has(t.tv_no)))
    setCostings((costRes.data || []) as Costing[])
    setKollos(((kolloRes.data || []) as Kollo[]).filter(k => projTvNos.has(parseInt(k.tv_no))))
    setLoading(false)
  }

  const totalCostEur = costings.reduce((s, c) => s + (c.cost_eur || 0), 0)
  const totalSellEur = costings.reduce((s, c) => s + (c.sell_eur || 0), 0)
  const fmtEur = (n: number) => '€' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

  function daysBetween(a: string | null, b: string | null) {
    if (!a || !b) return null
    return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1)
  }

  function exportReport() {
    if (activeReport === 'cost-summary') {
      downloadCSV(
        [['TV', 'Name', 'Charge Start', 'Charge End', 'Days', 'Cost (EUR)', 'Sell (EUR)'],
         ...costings.map(c => {
           const tv = tvs.find(t => t.tv_no === parseInt(c.tv_no))
           const days = daysBetween(c.charge_start, c.charge_end)
           return [`TV${c.tv_no}`, tv?.header_name || '—', c.charge_start || '—', c.charge_end || '—', days || '—', c.cost_eur || 0, c.sell_eur || 0]
         })],
        `tooling-costs-${activeProject?.name}`
      )
    } else if (activeReport === 'package-list') {
      downloadCSV(
        [['TV', 'Kollo ID', 'Delivery Package', 'Gross (kg)', 'Net (kg)', 'L (cm)', 'W (cm)', 'H (cm)'],
         ...kollos.map(k => [`TV${k.tv_no}`, k.kollo_id, k.delivery_package, k.gross, k.net, k.length, k.width, k.height])],
        `tooling-packages-${activeProject?.name}`
      )
    }
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Tooling Reports</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {tvs.length} TVs · {kollos.length} kollos · Cost {fmtEur(totalCostEur)} · Sell {fmtEur(totalSellEur)}
          </p>
        </div>
        {activeReport && <button className="btn btn-sm" onClick={exportReport}>⬇ Export CSV</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {([
          ['cost-summary', '💶', 'Cost Summary by TV', 'Rental costs per TV with charge periods'],
          ['package-list', '📦', 'Package / Kollo List', 'Full package manifest with dimensions'],
        ] as [ReportType, string, string, string][]).map(([type, icon, title, desc]) => (
          <div key={type} className="card" style={{ cursor: 'pointer', borderTop: `3px solid ${activeReport === type ? 'var(--accent)' : 'var(--border)'}`, padding: '14px', background: activeReport === type ? 'rgba(99,102,241,.04)' : undefined }}
            onClick={() => setActiveReport(activeReport === type ? null : type)}>
            <div style={{ fontSize: '26px', marginBottom: '7px' }}>{icon}</div>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{title}</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{desc}</div>
          </div>
        ))}
      </div>

      {activeReport === 'cost-summary' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>TV</th><th>Name</th><th>Charge Start</th><th>Charge End</th><th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Cost (EUR)</th><th style={{ textAlign: 'right' }}>Sell (EUR)</th></tr></thead>
            <tbody>
              {costings.map(c => {
                const tv = tvs.find(t => t.tv_no === parseInt(c.tv_no))
                const days = daysBetween(c.charge_start, c.charge_end)
                return (
                  <tr key={c.tv_no}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: '#0891b2' }}>TV{c.tv_no}</td>
                    <td>{tv?.header_name || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c.charge_start || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c.charge_end || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{days ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{c.cost_eur ? fmtEur(c.cost_eur) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{c.sell_eur ? fmtEur(c.sell_eur) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                <td colSpan={5} style={{ padding: '8px 12px' }}>Total</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{fmtEur(totalCostEur)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px', color: 'var(--green)' }}>{fmtEur(totalSellEur)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeReport === 'package-list' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ fontSize: '12px' }}>
            <thead><tr><th>TV</th><th>Kollo ID</th><th>Delivery Package</th><th style={{ textAlign: 'right' }}>Gross (kg)</th><th style={{ textAlign: 'right' }}>Net (kg)</th><th style={{ textAlign: 'right' }}>L</th><th style={{ textAlign: 'right' }}>W</th><th style={{ textAlign: 'right' }}>H</th></tr></thead>
            <tbody>
              {kollos.map(k => (
                <tr key={k.kollo_id}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: '#0891b2' }}>TV{k.tv_no}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{k.kollo_id}</td>
                  <td style={{ color: 'var(--text2)' }}>{k.delivery_package || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{k.gross || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{k.net || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{k.length || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{k.width || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{k.height || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!activeReport && (tvs.length === 0 ? (
        <div className="empty-state"><div className="icon">📦</div><h3>No tooling data</h3><p>Add TVs and costings to generate reports.</p></div>
      ) : (
        <p style={{ fontSize: '13px', color: 'var(--text3)' }}>Select a report type above.</p>
      ))}
    </div>
  )
}
