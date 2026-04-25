import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { applyEscalationFactor, calcYoyChange } from '../../lib/calculations'

interface EscalationYear {
  id?: string
  year: number
  factor: number
  yoy_change: number | null
  source: string
  notes: string
}

interface ContractLine {
  material_no: string
  description: string
  list_price: number
  escalation_factor: number | null
  escalated_price: number | null
  transfer_price: number | null
}

export function HardwareEscalationPanel() {
  const { activeProject } = useAppStore()
  const [years, setYears] = useState<EscalationYear[]>([])
  const [lines, setLines] = useState<ContractLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newYear, setNewYear] = useState({ year: new Date().getFullYear(), factor: 1.0, notes: '' })

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [escRes, contractRes] = await Promise.all([
      supabase.from('hardware_escalation').select('*').eq('project_id', pid).order('year'),
      supabase.from('hardware_contracts').select('line_items').eq('project_id', pid),
    ])
    const allLines: ContractLine[] = []
    ;(contractRes.data || []).forEach(c => {
      const items = (c.line_items as ContractLine[] | null) || []
      allLines.push(...items)
    })
    setLines(allLines)
    const escData = (escRes.data || []) as EscalationYear[]
    // Compute yoy_change between consecutive years
    const sorted = escData.sort((a, b) => a.year - b.year)
    sorted.forEach((e, i) => {
      if (i > 0) e.yoy_change = calcYoyChange(e.factor, sorted[i - 1].factor)
    })
    setYears(sorted)
    setLoading(false)
  }

  async function addYear() {
    if (!activeProject) return
    if (years.find(y => y.year === newYear.year)) { toast('Year already exists', 'error'); return }
    setSaving(true)
    const prevYear = [...years].sort((a, b) => b.year - a.year).find(y => y.year < newYear.year)
    const yoy = prevYear ? calcYoyChange(newYear.factor, prevYear.factor) : null
    const { error } = await supabase.from('hardware_escalation').insert({
      project_id: activeProject.id,
      year: newYear.year,
      factor: newYear.factor,
      yoy_change: yoy,
      source: 'manual',
      notes: newYear.notes,
    })
    if (error) { toast(error.message, 'error') } else { toast(`Year ${newYear.year} added`, 'success'); load() }
    setSaving(false)
  }

  async function deleteYear(id: string) {
    await supabase.from('hardware_escalation').delete().eq('id', id)
    load()
  }

  const baselineTransfer = lines.reduce((s, l) => s + (l.transfer_price || l.list_price || 0), 0)

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 707, marginBottom: '4px' }}>Hardware Escalation</h1>
      <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '20px' }}>
        Year-on-year price escalation factors from SE Germany contract updates.
        Applied to transfer prices when projecting future order costs.
      </p>

      {/* Add year */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Add Escalation Year</div>
        <div className="fg-row">
          <div className="fg">
            <label>Year</label>
            <input type="number" className="input" value={newYear.year}
              onChange={e => setNewYear(n => ({ ...n, year: parseInt(e.target.value) || n.year }))} />
          </div>
          <div className="fg">
            <label>Factor (e.g. 1.0350 = +3.5%)</label>
            <input type="number" step="0.0001" className="input" value={newYear.factor}
              onChange={e => setNewYear(n => ({ ...n, factor: parseFloat(e.target.value) || 1 }))} />
          </div>
          <div className="fg" style={{ flex: 2 }}>
            <label>Notes</label>
            <input className="input" value={newYear.notes} placeholder="e.g. OPSA 2026 contract update"
              onChange={e => setNewYear(n => ({ ...n, notes: e.target.value }))} />
          </div>
          <div className="fg" style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-primary" onClick={addYear} disabled={saving}>+ Add</button>
          </div>
        </div>
      </div>

      {/* Escalation table */}
      {years.length === 0 ? (
        <div className="empty-state"><div className="icon">📈</div><h3>No escalation factors</h3><p>Add year-by-year factors from SE contract updates above.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '20px' }}>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th style={{ textAlign: 'right' }}>Factor</th>
                <th style={{ textAlign: 'right' }}>YoY Change</th>
                <th style={{ textAlign: 'right' }}>Contract Value (at this factor)</th>
                <th>Source</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const escalatedValue = applyEscalationFactor(baselineTransfer, y.factor)
                return (
                  <tr key={y.year}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{y.year}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{y.factor.toFixed(4)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: y.yoy_change && y.yoy_change > 0 ? 'var(--red)' : 'var(--green)' }}>
                      {y.yoy_change != null ? `${y.yoy_change > 0 ? '+' : ''}${y.yoy_change.toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                      {baselineTransfer > 0 ? `€${escalatedValue.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '—'}
                    </td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase' }}>{y.source}</td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{y.notes || '—'}</td>
                    <td>
                      {y.id && <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteYear(y.id!)}>✕</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Price projection */}
      {lines.length > 0 && years.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Price Projection</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
            Baseline transfer value from {lines.length} contract lines: <strong style={{ fontFamily: 'var(--mono)' }}>€{baselineTransfer.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
            {years.map(y => (
              <div key={y.year} style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', borderTop: '3px solid var(--accent)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '3px' }}>{y.year}</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '16px', color: 'var(--accent)' }}>
                  €{applyEscalationFactor(baselineTransfer, y.factor).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text3)' }}>× {y.factor.toFixed(4)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
