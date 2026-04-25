import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { calcRentalCost } from '../../lib/calculations'
import type { ToolingCosting, GlobalTV, PurchaseOrder } from '../../types'

interface Department { id: string; name: string; rental_pct: number; rate_unit: 'weekly'|'daily'|'monthly'; gm_pct: number }
interface Split { id?: string; project_name: string; start_date: string; end_date: string; notes: string }

const fmtEur = (n: number) => '€' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export function ToolingCostingsPanel() {
  const { activeProject } = useAppStore()
  const [costings, setCostings] = useState<(ToolingCosting & { tv?: GlobalTV; po?: PurchaseOrder })[]>([])
  const [depts, setDepts] = useState<Department[]>([])
  const [splitModal, setSplitModal] = useState<{ costing: ToolingCosting & { tv?: GlobalTV }; splits: Split[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [wbsList, setWbsList] = useState<{code:string;name:string}[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [cData, tvData, poData, deptData, wbsData] = await Promise.all([
      supabase.from('tooling_costings').select('*').eq('project_id', pid).order('tv_no'),
      supabase.from('global_tvs').select('*').order('tv_no'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid),
      supabase.from('tooling_departments').select('*').order('name'),
      supabase.from('wbs_list').select('code,name').eq('project_id', pid).order('sort_order'),
    ])
    const tvMap = Object.fromEntries((tvData.data || []).map(tv => [tv.tv_no, tv] as [string, GlobalTV]))
    const poMap = Object.fromEntries((poData.data || []).map(po => [po.id, po] as [string, PurchaseOrder]))
    setCostings((cData.data || []).map((c: ToolingCosting) => ({
      ...c, tv: tvMap[c.tv_no], po: c.linked_po_id ? poMap[c.linked_po_id] : undefined
    })))
    setDepts((deptData.data || []) as Department[])
    setWbsList((wbsData.data || []) as {code:string;name:string}[])
    setLoading(false)
  }

  function openSplits(costing: ToolingCosting & { tv?: GlobalTV }) {
    const existing = (costing as ToolingCosting & { splits?: Split[] }).splits || []
    setSplitModal({ costing, splits: existing.length ? existing : [{ project_name: '', start_date: costing.charge_start || '', end_date: costing.charge_end || '', notes: '' }] })
  }

  async function saveSplits() {
    if (!splitModal) return
    const validSplits = splitModal.splits.filter(s => s.project_name.trim() && s.start_date && s.end_date)
    const { error } = await supabase.from('tooling_costings')
      .update({ splits: validSplits } as Record<string, unknown>)
      .eq('id', splitModal.costing.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Splits saved', 'success')
    setSplitModal(null)
    load()
  }

  const totalCostEur = costings.reduce((s, c) => s + (c.cost_eur || 0), 0)
  const totalSellEur = costings.reduce((s, c) => s + (c.sell_eur || 0), 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 707 }}>Tooling Costings</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {costings.length} TVs costed · Cost {fmtEur(totalCostEur)} · Sell {fmtEur(totalSellEur)}
          </p>
        </div>
      </div>

      {/* Dept billing model info */}
      {depts.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', fontSize: '12px' }}>
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>💶 Department Billing Model</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {depts.map(d => {
                  return (
                <div key={d.id} style={{ padding: '4px 10px', background: 'var(--bg3)', borderRadius: '5px' }}>
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                  <span style={{ color: 'var(--text3)', marginLeft: '6px' }}>
                    {d.rental_pct}% replacement value / {d.rate_unit}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : costings.length === 0 ? (
          <div className="empty-state"><div className="icon">💶</div><h3>No tooling costings</h3><p>Add TVs via the TV Register, then set costings using the Costings button.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr><th>TV</th><th>Charge Start</th><th>Charge End</th><th style={{ textAlign: 'right' }}>Days</th>
                  <th style={{ textAlign: 'right' }}>Cost (EUR)</th><th style={{ textAlign: 'right' }}>Sell (EUR)</th>
                  <th>WBS</th><th style={{ textAlign: 'right' }}>FX Rate</th>
                  <th style={{ textAlign: 'right' }}>Cost (AUD)</th><th style={{ textAlign: 'right' }}>Sell (AUD)</th>
                  <th>PO</th><th>Splits</th></tr>
              </thead>
              <tbody>
                {costings.map(c => {
                  const days = c.charge_start && c.charge_end
                    ? Math.round((new Date(c.charge_end).getTime() - new Date(c.charge_start).getTime()) / 86400000) + 1 : null
                  const splits = (c as ToolingCosting & { splits?: Split[] }).splits || []
                  const repVal = (c.tv as GlobalTV & { replacement_value?: number } | undefined)?.replacement_value || 0

                  // Calc rental cost per dept if we have replacement value
                  const deptCalcs = repVal > 0 && c.charge_start && c.charge_end
                    ? depts.map(d => ({ dept: d, result: calcRentalCost(repVal, { charge_start: c.charge_start, charge_end: c.charge_end }, d) })).filter(x => x.result)
                    : []

                  return (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 707 }}>TV{c.tv_no}
                        {c.tv && <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'sans-serif' }}>{(c.tv as GlobalTV & {header_name?:string}).header_name || ''}</div>}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.charge_start || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.charge_end || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{days ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.cost_eur ? fmtEur(c.cost_eur) : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{c.sell_eur ? fmtEur(c.sell_eur) : '—'}</td>
                      <td>
                        <select style={{ fontSize: '11px', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: '3px', background: 'var(--bg2)', minWidth: '120px' }}
                          value={c.wbs || ''} onChange={async e => {
                            await supabase.from('tooling_costings').update({ wbs: e.target.value }).eq('id', c.id)
                            setCostings(cs => cs.map(x => x.id === c.id ? { ...x, wbs: e.target.value } : x))
                          }}>
                          <option value="">— No WBS —</option>
                          {wbsList.map(w => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" style={{ fontFamily: 'var(--mono)', fontSize: '11px', width: '60px', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: '3px', background: 'var(--bg2)', textAlign: 'right' }}
                          value={c.fx_rate || 1.65} min={0.1} step={0.01}
                          onChange={async e => {
                            const fx = parseFloat(e.target.value) || 1.65
                            await supabase.from('tooling_costings').update({ fx_rate: fx }).eq('id', c.id)
                            setCostings(cs => cs.map(x => x.id === c.id ? { ...x, fx_rate: fx } : x))
                          }} />
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text2)' }}>
                        {c.cost_eur ? '$' + Math.round(c.cost_eur * (c.fx_rate || 1.65)).toLocaleString() : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>
                        {c.sell_eur ? '$' + Math.round(c.sell_eur * (c.fx_rate || 1.65)).toLocaleString() : '—'}
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{c.po ? (c.po.po_number || c.po.vendor) : '—'}</td>
                      <td>
                        {deptCalcs.length > 0 ? (
                          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>
                            {deptCalcs.slice(0, 2).map(({ dept, result }) => (
                              <div key={dept.id}>{dept.name}: {result ? fmtEur(result.cost) : '—'}</div>
                            ))}
                          </div>
                        ) : null}
                        <button className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px', marginTop: '2px' }} onClick={() => openSplits(c)}>
                          {splits.length ? `📋 ${splits.length} split${splits.length > 1 ? 's' : ''}` : '+ Split'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg3)' }}>
                  <td colSpan={4} style={{ padding: '8px 10px', fontWeight: 600 }}>Total</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, padding: '8px 10px' }}>{fmtEur(totalCostEur)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', padding: '8px 10px' }}>{fmtEur(totalSellEur)}</td>
                  <td colSpan={4} />
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, padding: '8px 10px' }}>{'$' + Math.round(costings.reduce((s,c)=>s+(c.cost_eur||0)*(c.fx_rate||1.65),0)).toLocaleString()}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', padding: '8px 10px' }}>{'$' + Math.round(costings.reduce((s,c)=>s+(c.sell_eur||0)*(c.fx_rate||1.65),0)).toLocaleString()}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}

      {/* Splits modal */}
      {splitModal && (
        <div className="modal-overlay" onClick={() => setSplitModal(null)}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📋 Cost Splits — TV{splitModal.costing.tv_no}</h3>
              <button className="btn btn-sm" onClick={() => setSplitModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                Split TV rental cost across multiple projects or date ranges. Each project is billed for its own period.
              </p>
              {splitModal.splits.map((s, i) => (
                <div key={i} style={{ padding: '10px', background: 'var(--bg3)', borderRadius: '6px', marginBottom: '8px' }}>
                  <div className="fg-row">
                    <div className="fg" style={{ flex: 2 }}>
                      <label style={{ fontSize: '11px' }}>Project / Department</label>
                      <input className="input" value={s.project_name}
                        onChange={e => setSplitModal(m => m ? { ...m, splits: m.splits.map((x, j) => j === i ? { ...x, project_name: e.target.value } : x) } : null)}
                        placeholder="e.g. NRG GT11" />
                    </div>
                    <div className="fg">
                      <label style={{ fontSize: '11px' }}>Start</label>
                      <input type="date" className="input" value={s.start_date}
                        onChange={e => setSplitModal(m => m ? { ...m, splits: m.splits.map((x, j) => j === i ? { ...x, start_date: e.target.value } : x) } : null)} />
                    </div>
                    <div className="fg">
                      <label style={{ fontSize: '11px' }}>End</label>
                      <input type="date" className="input" value={s.end_date}
                        onChange={e => setSplitModal(m => m ? { ...m, splits: m.splits.map((x, j) => j === i ? { ...x, end_date: e.target.value } : x) } : null)} />
                    </div>
                    <button style={{ border: 'none', background: 'none', color: 'var(--red)', cursor: 'pointer', alignSelf: 'flex-end', paddingBottom: '8px' }}
                      onClick={() => setSplitModal(m => m ? { ...m, splits: m.splits.filter((_, j) => j !== i) } : null)}>✕</button>
                  </div>
                  {/* Show calculated cost for this split */}
                  {(() => {
                    const repVal = ((splitModal.costing.tv as GlobalTV & { replacement_value?: number }) || {}).replacement_value || 0
                    if (!repVal || !s.start_date || !s.end_date || !depts.length) return null
                    const days = Math.max(0, Math.round((new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 86400000) + 1)
                    return (
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>
                        {days} days · {depts.slice(0, 2).map(d => {
                          const r = calcRentalCost(repVal, { charge_start: s.start_date, charge_end: s.end_date }, d)
                          return r ? `${d.name}: ${fmtEur(r.cost)}` : null
                        }).filter(Boolean).join(' · ')}
                      </div>
                    )
                  })()}
                </div>
              ))}
              <button className="btn btn-sm" onClick={() => setSplitModal(m => m ? { ...m, splits: [...m.splits, { project_name: '', start_date: '', end_date: '', notes: '' }] } : null)}>
                + Add Split
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setSplitModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSplits}>Save Splits</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
