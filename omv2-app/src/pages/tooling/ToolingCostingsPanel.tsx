import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { calcRentalCost } from '../../lib/calculations'
import type { ToolingCosting, GlobalTV } from '../../types'

interface Department { id: string; name: string; rates: Record<string, unknown> }

function deptRentalPct(d: Department) { return Number(d.rates.rentalPct || 0) }
function deptRateUnit(d: Department): 'weekly' | 'daily' | 'monthly' { return (d.rates.rateUnit as 'weekly'|'daily'|'monthly') || 'weekly' }
function deptGmPct(d: Department) { return Number(d.rates.gmPct || 0) }

function deptToCalc(d: Department | null | undefined): { rental_pct: number; rate_unit: 'weekly'|'daily'|'monthly'; gm_pct: number } | null {
  if (!d) return null
  return { rental_pct: deptRentalPct(d), rate_unit: deptRateUnit(d), gm_pct: deptGmPct(d) }
}
interface WbsItem { code: string; name: string }
interface ProjectRef { id: string; name: string }

type SplitType = 'project' | 'standby'
interface Split {
  type: SplitType
  projectId?: string
  projectName?: string   // free-text label for cross-project splits
  startDate: string
  endDate: string
  wbs: string
  discountPct?: number   // standby only
}

type CostingRow = ToolingCosting & {
  _crossProject?: boolean
  tv?: GlobalTV & { header_name?: string; replacement_value_eur?: number; department_id?: string }
  splits: Split[]
}

const fmtEur = (n: number) => '€' + Math.round(n).toLocaleString('en-AU')
const fmtAud = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')

function daysBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1)
}

export function ToolingCostingsPanel() {
  const { activeProject } = useAppStore()
  const [costings, setCostings] = useState<CostingRow[]>([])
  const [depts, setDepts] = useState<Department[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [projects, setProjects] = useState<ProjectRef[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    // Fetch both owned costings AND costings from other projects that have splits for this project
    const [cData, crossData, tvData, deptData, wbsData, projData] = await Promise.all([
      supabase.from('tooling_costings').select('*').eq('project_id', pid).order('tv_no'),
      supabase.from('tooling_costings').select('*').neq('project_id', pid).filter('splits', 'cs', `[{"projectId":"${pid}"}]`).order('tv_no'),
      supabase.from('global_tvs').select('tv_no,header_name,replacement_value_eur,department_id').order('tv_no'),
      supabase.from('global_departments').select('*').order('name'),
      supabase.from('wbs_list').select('code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('projects').select('id,name').order('name'),
    ])
    const tvMap = Object.fromEntries((tvData.data || []).map(tv => [tv.tv_no, tv]))
    const ownedRows = (cData.data || []).map((c: ToolingCosting) => ({
      ...c,
      splits: (c as unknown as { splits?: Split[] }).splits || [],
      tv: tvMap[c.tv_no],
      _crossProject: false,
    }))
    // Cross-project: read-only view, filtered to splits relevant to this project
    const crossRows = (crossData.data || []).map((c: ToolingCosting) => ({
      ...c,
      splits: ((c as unknown as { splits?: Split[] }).splits || []).filter(s => s.type === 'project' && s.projectId === pid),
      tv: tvMap[c.tv_no],
      _crossProject: true,
    }))
    // Deduplicate — don't show cross-project row if we already own it
    const ownedTvNos = new Set(ownedRows.map(r => r.tv_no))
    setCostings([...ownedRows, ...crossRows.filter(r => !ownedTvNos.has(r.tv_no))])
    setDepts((deptData.data || []) as Department[])
    setWbsList((wbsData.data || []) as WbsItem[])
    setProjects((projData.data || []) as ProjectRef[])
    setLoading(false)
  }

  async function updateField(id: string, field: string, value: unknown) {
    const row = costings.find(c => c.id === id)
    if ((row as CostingRow)?._crossProject) { toast('Edit this TV on its owning project', 'error'); return }
    const { error } = await supabase.from('tooling_costings').update({ [field]: value }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setCostings(cs => cs.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  async function saveSplits(id: string, splits: Split[]) {
    const { error } = await supabase.from('tooling_costings').update({ splits }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setCostings(cs => cs.map(c => c.id === id ? { ...c, splits } : c))

    // Auto-create project_tvs rows for any cross-project splits
    // so the TV shows up in those projects' TV Registers
    const costing = costings.find(c => c.id === id)
    if (!costing) return
    const crossProjects = splits
      .filter(s => s.type === 'project' && s.projectId && s.projectId !== activeProject!.id)
      .map(s => s.projectId!)
      .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    for (const projId of crossProjects) {
      const siteId = (activeProject as typeof activeProject & {site_id?:string}).site_id || null
      await supabase.from('project_tvs').upsert({
        project_id: projId, tv_no: costing.tv_no, site_id: siteId,
        header_name: costing.tv?.header_name || null,
        replacement_value_eur: costing.tv?.replacement_value_eur || null,
      }, { onConflict: 'project_id,tv_no', ignoreDuplicates: true })
    }
  }

  function addSplit(costing: CostingRow, type: SplitType) {
    const newSplit: Split = type === 'project'
      ? { type: 'project', projectId: activeProject!.id, projectName: activeProject!.name, startDate: costing.charge_start || '', endDate: costing.charge_end || '', wbs: costing.wbs || '' }
      : { type: 'standby', startDate: '', endDate: '', wbs: '', discountPct: 0 }
    const splits = [...costing.splits, newSplit]
    saveSplits(costing.id, splits)
  }

  function updateSplit(costing: CostingRow, idx: number, patch: Partial<Split>) {
    const splits = costing.splits.map((s, i) => i === idx ? { ...s, ...patch } : s)
    saveSplits(costing.id, splits)
  }

  function removeSplit(costing: CostingRow, idx: number) {
    saveSplits(costing.id, costing.splits.filter((_, i) => i !== idx))
  }

  function calcSplitCost(costing: CostingRow, split: Split, dept: Department | null | undefined): number | null {
    if (!split.startDate || !split.endDate || !dept || !costing.tv?.replacement_value_eur) return null
    const replVal = costing.tv.replacement_value_eur
    const result = calcRentalCost(replVal, { charge_start: split.startDate, charge_end: split.endDate }, deptToCalc(dept)!)
    if (!result) return null
    const base = result.cost
    if (split.type === 'standby' && split.discountPct) return base * (1 - split.discountPct / 100)
    return base
  }


  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  const totalCostEur = costings.reduce((s, c) => s + (c.cost_eur || 0), 0)
  const totalSellEur = costings.reduce((s, c) => s + (c.sell_eur || 0), 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 707 }}>Tooling Costings</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {costings.length} TVs · Cost {fmtEur(totalCostEur)} · Sell {fmtEur(totalSellEur)}
          </p>
        </div>
      </div>

      {/* Dept billing model info */}
      {depts.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', fontSize: '12px' }}>
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>💶 Department Billing Model</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {depts.map(d => (
              <div key={d.id} style={{ padding: '4px 10px', background: 'var(--bg3)', borderRadius: '5px' }}>
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                <span style={{ color: 'var(--text3)', marginLeft: '6px' }}>{deptRentalPct(d)}% repl. value / {deptRateUnit(d)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {costings.length === 0 ? (
        <div className="empty-state"><div className="icon">💶</div><h3>No tooling costings</h3><p>Add TVs via the TV Register, then set charge dates here.</p></div>
      ) : (
        costings.map(c => {
          const dept = c.tv?.department_id ? depts.find(d => d.id === c.tv!.department_id) : null
          const replVal = c.tv?.replacement_value_eur || 0
          const deptCalc = deptToCalc(dept)
          const calc = deptCalc && c.charge_start && c.charge_end && replVal > 0
            ? calcRentalCost(replVal, { charge_start: c.charge_start, charge_end: c.charge_end }, deptCalc)
            : null
          const days = c.charge_start && c.charge_end ? daysBetween(c.charge_start, c.charge_end) : null
          const fx = c.fx_rate || 1.65
          const isExpanded = expandedId === c.id
          const hasSplits = c.splits.length > 0

          // Total split costs for this project
          const thisProjectSplitCost = c.splits
            .filter(s => s.type === 'project' && s.projectId === activeProject!.id)
            .reduce((sum, s) => sum + (calcSplitCost(c, s, dept) || 0), 0)

          return (
            <div key={c.id} className="card" style={{ marginBottom: '14px', borderLeft: '3px solid var(--mod-tooling)', padding: '16px' }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 700, color: 'var(--mod-tooling)' }}>TV{c.tv_no}</span>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>{c.tv?.header_name || <em style={{ color: 'var(--text3)', fontWeight: 400 }}>unnamed</em>}</span>
                  {dept && <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '3px', background: '#e0e7ff', color: '#3730a3', fontWeight: 600 }}>{dept.name}</span>}
                  {(c as CostingRow)._crossProject && (
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '3px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                      📋 Cross-project — edit on owning project
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>
                  {replVal > 0 ? fmtEur(replVal) + ' repl. value' : '—'}
                </span>
              </div>

              {/* Charge dates + dept + notes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '14px' }}>
                <div className="fg" style={{ margin: 0 }}>
                  <label>Charge Start <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>— departure from DE warehouse</span></label>
                  <input type="date" className="input" value={c.charge_start || ''}
                    onChange={e => updateField(c.id, 'charge_start', e.target.value || null)} />
                  {c.tv && (c.tv as typeof c.tv & { departure_date?: string }).departure_date && (
                    <div style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px' }}>📦 WOSIT: {(c.tv as typeof c.tv & { departure_date?: string }).departure_date}</div>
                  )}
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label>Charge End <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>— return to DE warehouse</span></label>
                  <input type="date" className="input" value={c.charge_end || ''}
                    onChange={e => updateField(c.id, 'charge_end', e.target.value || null)} />
                  <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>Includes transit both ways</div>
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label>WBS Code <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>— fallback if no splits</span></label>
                  <select className="input" value={c.wbs || ''} onChange={e => updateField(c.id, 'wbs', e.target.value)}>
                    <option value="">— No WBS —</option>
                    {wbsList.map(w => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
                  </select>
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label>Notes</label>
                  <input className="input" value={c.notes || ''} placeholder="Optional"
                    onChange={e => updateField(c.id, 'notes', e.target.value)} />
                </div>
              </div>

              {/* FX rate + sell override + replacement value */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                <div className="fg" style={{ margin: 0 }}>
                  <label>Replacement Value (EUR)</label>
                  <input type="number" className="input" value={replVal || ''} min={0} step={1}
                    placeholder="e.g. 250000"
                    onChange={e => {
                      const val = parseFloat(e.target.value) || null
                      supabase.from('global_tvs').update({ replacement_value_eur: val }).eq('tv_no', c.tv_no).then(({ error }) => {
                        if (error) toast(error.message, 'error')
                        else setCostings(cs => cs.map(x => x.id === c.id ? { ...x, tv: x.tv ? { ...x.tv, replacement_value_eur: val ?? undefined } : x.tv } : x) as CostingRow[])
                      })
                    }} />
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label>FX Rate EUR → AUD</label>
                  <input type="number" className="input" value={c.fx_rate || 1.65} min={0.1} step={0.01}
                    onChange={e => updateField(c.id, 'fx_rate', parseFloat(e.target.value) || 1.65)} />
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label>Customer Rate Override (EUR/{dept ? deptRateUnit(dept) : 'weekly'}) <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>— leave blank to use GM%</span></label>
                  <input type="number" className="input" value={(c as unknown as { sell_override_eur?: number }).sell_override_eur || ''} min={0} step={0.01}
                    placeholder={`e.g. 500 per ${dept ? deptRateUnit(dept) : 'week'}`}
                    onChange={e => updateField(c.id, 'sell_override_eur', parseFloat(e.target.value) || null)} />
                </div>
              </div>

              {/* Calculated cost summary */}
              {calc ? (
                <div style={{ display: 'flex', gap: '18px', padding: '11px 13px', background: 'var(--bg3)', borderRadius: 'var(--radius)', marginBottom: '14px', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Duration', value: `${days} days` },
                    { label: 'Weekly Rate', value: fmtEur(calc.weeklyRate), color: 'var(--mod-tooling)' },
                    { label: 'Total Cost EUR', value: fmtEur(calc.cost), color: 'var(--mod-tooling)' },
                    { label: 'GM%', value: calc.sell > 0 ? `${((calc.sell-calc.cost)/calc.sell*100).toFixed(0)}%` : '—', color: 'var(--amber)' },
                    { label: 'Customer Sell EUR', value: fmtEur(calc.sell), color: 'var(--green)' },
                    { label: 'Cost AUD', value: fmtAud(calc.cost * fx), color: 'var(--text2)' },
                    { label: 'Sell AUD', value: fmtAud(calc.sell * fx), color: 'var(--green)' },
                  ].map(k => (
                    <div key={k.label}>
                      <div style={{ fontSize: '9px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'var(--mono)' }}>{k.label}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 700, color: k.color || 'var(--text)' }}>{k.value}</div>
                    </div>
                  ))}
                  {hasSplits && thisProjectSplitCost > 0 && (
                    <div>
                      <div style={{ fontSize: '9px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'var(--mono)' }}>This Project (from splits)</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 700, color: 'var(--accent)' }}>{fmtEur(thisProjectSplitCost)}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '9px 13px', background: 'var(--bg3)', borderRadius: 'var(--radius)', fontSize: '12px', color: 'var(--text3)', marginBottom: '14px' }}>
                  {!dept ? '⚠ Assign a department in the TV Register to calculate rental cost.'
                    : !c.charge_start || !c.charge_end ? '⚠ Set charge start and end dates to calculate cost.'
                    : replVal === 0 ? '⚠ No replacement value set — enter a replacement value below to calculate cost.'
                    : '⚠ Cannot calculate cost.'}
                </div>
              )}

              {/* ── COST SPLITS ── */}
              <div>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', fontFamily: 'var(--mono)', fontWeight: 700, marginBottom: '8px' }}>
                  Cost Splits <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', color: 'var(--text3)' }}>— project charges and standby periods</span>
                  {hasSplits && (
                    <button style={{ marginLeft: '8px', fontSize: '10px', padding: '1px 8px', borderRadius: '3px', border: '1px solid var(--border)', background: 'var(--bg2)', cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                      {isExpanded ? '▲ Collapse' : `▼ ${c.splits.length} split${c.splits.length !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>

                {(!hasSplits || isExpanded) && c.splits.map((sp, idx) => {
                  const spCost = calcSplitCost(c, sp, dept)
                  const isStandby = sp.type === 'standby'
                  return (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap',
                      padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                      background: isStandby ? '#fefce8' : 'var(--bg3)',
                    }}>
                      {/* Type badge */}
                      <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '3px', fontWeight: 700, whiteSpace: 'nowrap',
                        background: isStandby ? '#fef3c7' : '#dbeafe',
                        color: isStandby ? '#92400e' : '#1e40af' }}>
                        {isStandby ? '⏸ STANDBY' : '📋 PROJECT'}
                      </span>

                      {/* Project select (project splits only) */}
                      {!isStandby && (
                        <select style={{ fontSize: '11px', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', minWidth: '160px' }}
                          value={sp.projectId || ''}
                          onChange={e => {
                            const proj = projects.find(p => p.id === e.target.value)
                            updateSplit(c, idx, { projectId: e.target.value, projectName: proj?.name || '' })
                          }}>
                          <option value="">— Select Project —</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}

                      {/* Date range */}
                      <input type="date" style={{ fontSize: '11px', padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', fontFamily: 'var(--mono)' }}
                        value={sp.startDate} onChange={e => updateSplit(c, idx, { startDate: e.target.value })} />
                      <span style={{ color: 'var(--text3)', fontSize: '11px' }}>to</span>
                      <input type="date" style={{ fontSize: '11px', padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', fontFamily: 'var(--mono)' }}
                        value={sp.endDate} onChange={e => updateSplit(c, idx, { endDate: e.target.value })} />

                      {/* Standby discount */}
                      {isStandby && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input type="number" style={{ fontSize: '11px', padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', width: '60px', textAlign: 'right' }}
                            value={sp.discountPct || 0} min={0} max={100} step={1}
                            onChange={e => updateSplit(c, idx, { discountPct: parseFloat(e.target.value) || 0 })} />
                          <span style={{ color: 'var(--text3)', fontSize: '11px' }}>% discount</span>
                        </div>
                      )}

                      {/* WBS */}
                      <select style={{ fontSize: '11px', padding: '3px 5px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', minWidth: '140px' }}
                        value={sp.wbs || ''}
                        onChange={e => updateSplit(c, idx, { wbs: e.target.value })}>
                        <option value="">— No WBS —</option>
                        {wbsList.map(w => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
                      </select>

                      {/* Calculated cost */}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', minWidth: '80px', fontWeight: 600,
                        color: isStandby ? '#854d0e' : 'var(--mod-tooling)' }}>
                        {spCost != null ? fmtEur(spCost) : '—'}
                        {spCost != null && sp.startDate && sp.endDate && (
                          <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px', marginLeft: '4px' }}>
                            ({daysBetween(sp.startDate, sp.endDate)}d)
                          </span>
                        )}
                      </span>

                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}
                        onClick={() => removeSplit(c, idx)}>✕</button>
                    </div>
                  )
                })}

                {/* Splits total */}
                {isExpanded && hasSplits && (
                  <div style={{ fontSize: '11px', color: 'var(--text3)', padding: '4px 10px', display: 'flex', gap: '20px' }}>
                    {['project', 'standby'].map(t => {
                      const total = c.splits.filter(s => s.type === t).reduce((sum, s) => sum + (calcSplitCost(c, s, dept) || 0), 0)
                      return total > 0 ? (
                        <span key={t}>
                          {t === 'project' ? '📋 Project total' : '⏸ Standby total'}:&nbsp;
                          <strong style={{ fontFamily: 'var(--mono)', color: t === 'project' ? 'var(--mod-tooling)' : '#854d0e' }}>{fmtEur(total)}</strong>
                        </span>
                      ) : null
                    })}
                    <span>
                      All splits:&nbsp;
                      <strong style={{ fontFamily: 'var(--mono)' }}>{fmtEur(c.splits.reduce((sum, s) => sum + (calcSplitCost(c, s, dept) || 0), 0))}</strong>
                    </span>
                  </div>
                )}

                {/* Add buttons */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button className="btn btn-sm" onClick={() => { addSplit(c, 'project'); setExpandedId(c.id) }}>+ Project Split</button>
                  <button className="btn btn-sm" style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}
                    onClick={() => { addSplit(c, 'standby'); setExpandedId(c.id) }}>+ Standby Period</button>
                  {!hasSplits && c.wbs && (
                    <span style={{ fontSize: '11px', color: 'var(--text3)', alignSelf: 'center' }}>
                      Cost flows to WBS <strong>{c.wbs}</strong> (no splits set)
                    </span>
                  )}
                </div>
              </div>

              {/* ── IMPORT / EXPORT FREIGHT ── */}
              <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', fontFamily: 'var(--mono)', fontWeight: 700, marginBottom: '10px' }}>
                  Freight Costs <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', color: 'var(--text3)' }}>— import charged to first project, export charged to last project</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ padding: '12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', borderLeft: '3px solid #0284c7' }}>
                    <div style={{ fontWeight: 600, fontSize: '11px', color: '#0284c7', marginBottom: '8px' }}>📥 Import Freight (Germany → Site)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                      <div className="fg" style={{ margin: 0 }}><label>Cost (EUR)</label>
                        <input type="number" className="input" min={0} step={0.01} value={c.import_cost_eur || ''} placeholder="0.00"
                          onChange={e => updateField(c.id, 'import_cost_eur', parseFloat(e.target.value) || null)} /></div>
                      <div className="fg" style={{ margin: 0 }}><label>Sell (EUR)</label>
                        <input type="number" className="input" min={0} step={0.01} value={c.import_sell_eur || ''} placeholder="0.00"
                          onChange={e => updateField(c.id, 'import_sell_eur', parseFloat(e.target.value) || null)} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <div className="fg" style={{ margin: 0 }}><label>Charged to Project</label>
                        <select className="input" value={c.import_project_id || ''} onChange={e => updateField(c.id, 'import_project_id', e.target.value || null)}>
                          <option value="">— First project —</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select></div>
                      <div className="fg" style={{ margin: 0 }}><label>WBS</label>
                        <select className="input" value={c.import_wbs || ''} onChange={e => updateField(c.id, 'import_wbs', e.target.value)}>
                          <option value="">— No WBS —</option>
                          {wbsList.map(w => <option key={w.code} value={w.code}>{w.code}</option>)}
                        </select></div>
                    </div>
                    {c.import_cost_eur && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                        AUD: <strong style={{ color: 'var(--text2)' }}>{fmtAud(c.import_cost_eur * fx)}</strong>
                        {c.import_sell_eur ? <> · Sell: <strong style={{ color: 'var(--green)' }}>{fmtAud(c.import_sell_eur * fx)}</strong></> : null}
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', borderLeft: '3px solid #d97706' }}>
                    <div style={{ fontWeight: 600, fontSize: '11px', color: '#d97706', marginBottom: '8px' }}>📤 Export Freight (Site → Germany)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                      <div className="fg" style={{ margin: 0 }}><label>Cost (EUR)</label>
                        <input type="number" className="input" min={0} step={0.01} value={c.export_cost_eur || ''} placeholder="0.00"
                          onChange={e => updateField(c.id, 'export_cost_eur', parseFloat(e.target.value) || null)} /></div>
                      <div className="fg" style={{ margin: 0 }}><label>Sell (EUR)</label>
                        <input type="number" className="input" min={0} step={0.01} value={c.export_sell_eur || ''} placeholder="0.00"
                          onChange={e => updateField(c.id, 'export_sell_eur', parseFloat(e.target.value) || null)} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <div className="fg" style={{ margin: 0 }}><label>Charged to Project</label>
                        <select className="input" value={c.export_project_id || ''} onChange={e => updateField(c.id, 'export_project_id', e.target.value || null)}>
                          <option value="">— Last project —</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select></div>
                      <div className="fg" style={{ margin: 0 }}><label>WBS</label>
                        <select className="input" value={c.export_wbs || ''} onChange={e => updateField(c.id, 'export_wbs', e.target.value)}>
                          <option value="">— No WBS —</option>
                          {wbsList.map(w => <option key={w.code} value={w.code}>{w.code}</option>)}
                        </select></div>
                    </div>
                    {c.export_cost_eur && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                        AUD: <strong style={{ color: 'var(--text2)' }}>{fmtAud(c.export_cost_eur * fx)}</strong>
                        {c.export_sell_eur ? <> · Sell: <strong style={{ color: 'var(--green)' }}>{fmtAud(c.export_sell_eur * fx)}</strong></> : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
