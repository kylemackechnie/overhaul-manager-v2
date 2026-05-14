/**
 * ResourceRequirementsPanel.tsx
 * Combined people + tooling requirements for a project.
 * Lives under Project → Planning → Resource Requirements.
 *
 * Two sections:
 *   1. Crew Plan (people) — crew_plan rows with slot_type='people'
 *   2. Tooling Requirements — crew_plan rows with slot_type='tooling'
 *
 * Both feed into the Resource Manager's Demand vs Supply views.
 * Neither constrains the resource list or equipment panel — planning aid only.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { usePermissions } from '../../lib/permissions'
import { toast } from '../../components/ui/Toast'
import type { RateCard } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrewSlot {
  id: string
  role: string
  shift: string | null
  category: string | null
  qty: number
  mob_in: string | null
  mob_out: string | null
  wbs: string | null
  rate_card_id: string | null
  flight_required: boolean
  accom_required: boolean
  car_required: boolean
  source: string
  notes: string | null
  filled_count: number
  assigned_names: string[]
}

interface ToolingSlot {
  id: string
  role: string           // tool type/description
  qty: number
  mob_in: string | null
  mob_out: string | null
  notes: string | null
  sea_asset_id: string | null
  asset_tag: string | null
  asset_name: string | null
  source: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

const BLANK_CREW = {
  role: '', shift: 'day', category: 'trades', qty: 1,
  wbs: '', rate_card_id: '', mob_in: '', mob_out: '',
  flight_required: false, accom_required: false, car_required: false, notes: '',
}

const BLANK_TOOL = {
  role: '', qty: 1, mob_in: '', mob_out: '', notes: '', sea_asset_id: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function FilledBadge({ filled, qty }: { filled: number; qty: number }) {
  const all = filled >= qty
  const none = filled === 0
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      fontFamily: 'var(--mono)',
      background: all ? '#d1fae5' : none ? '#fee2e2' : '#fef3c7',
      color: all ? '#065f46' : none ? '#991b1b' : '#92400e',
    }}>
      {filled}/{qty}
    </span>
  )
}

function SectionHeader({ icon, title, count, note }: { icon: string; title: string; count: number; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        {note && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{note}</div>}
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', padding: '2px 8px', borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', marginLeft: 4 }}>
        {count} slots
      </span>
    </div>
  )
}

// ── Label helper ──────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
      {children}
    </label>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function ResourceRequirementsPanel() {
  const { activeProject } = useAppStore()
  const { canWrite } = usePermissions()
  const canEdit = canWrite('personnel')

  const [crewSlots, setCrewSlots]   = useState<CrewSlot[]>([])
  const [toolSlots, setToolSlots]   = useState<ToolingSlot[]>([])
  const [rateCards, setRateCards]   = useState<RateCard[]>([])
  const [wbsList, setWbsList]       = useState<{ id: string; code: string; name: string }[]>([])
  const [seaAssets, setSeaAssets]   = useState<{ id: string; asset_tag: string; name: string; category: string | null }[]>([])
  const [loading, setLoading]       = useState(true)

  const [showCrewForm, setShowCrewForm]   = useState(false)
  const [showToolForm, setShowToolForm]   = useState(false)
  const [editCrewId, setEditCrewId]       = useState<string | null>(null)
  const [editToolId, setEditToolId]       = useState<string | null>(null)
  const [crewForm, setCrewForm]           = useState({ ...BLANK_CREW })
  const [toolForm, setToolForm]           = useState({ ...BLANK_TOOL })
  const [saving, setSaving]               = useState(false)

  const load = useCallback(async () => {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id

    const [planData, rcData, wbsData, assetData] = await Promise.all([
      supabase.from('crew_plan').select('*').eq('project_id', pid).order('slot_type').order('category').order('role'),
      supabase.from('rate_cards').select('id,role,category').eq('project_id', pid).order('role'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('sea_assets').select('id,asset_tag,name,category').order('category').order('name'),
    ])

    const allSlots = (planData.data || []) as Record<string, unknown>[]

    // For people slots — find fill counts
    const peopleSlotIds = allSlots.filter(s => (s.slot_type as string) !== 'tooling').map(s => s.id as string)
    let fillMap: Record<string, { count: number; names: string[] }> = {}

    if (peopleSlotIds.length > 0) {
      const { data: resData } = await supabase
        .from('resources')
        .select('crew_plan_id, name')
        .eq('project_id', pid)
        .in('crew_plan_id', peopleSlotIds)

      for (const r of (resData || [])) {
        if (!r.crew_plan_id) continue
        if (!fillMap[r.crew_plan_id]) fillMap[r.crew_plan_id] = { count: 0, names: [] }
        fillMap[r.crew_plan_id].count++
        fillMap[r.crew_plan_id].names.push(r.name)
      }
    }

    // For tooling slots — find assigned assets
    const toolSlotRows = allSlots.filter(s => (s.slot_type as string) === 'tooling')
    const assetIds = toolSlotRows.map(s => s.sea_asset_id as string).filter(Boolean)
    let assetMap: Record<string, { asset_tag: string; name: string }> = {}
    if (assetIds.length > 0) {
      const { data: aData } = await supabase.from('sea_assets').select('id,asset_tag,name').in('id', assetIds)
      for (const a of (aData || [])) assetMap[a.id] = { asset_tag: a.asset_tag, name: a.name }
    }

    // Build crew slots
    const crew: CrewSlot[] = allSlots
      .filter(s => (s.slot_type as string) !== 'tooling')
      .map(s => ({
        id:               s.id as string,
        role:             s.role as string,
        shift:            s.shift as string | null,
        category:         s.category as string | null,
        qty:              s.qty as number,
        mob_in:           s.mob_in as string | null,
        mob_out:          s.mob_out as string | null,
        wbs:              s.wbs as string | null,
        rate_card_id:     s.rate_card_id as string | null,
        flight_required:  (s.flight_required as boolean) ?? false,
        accom_required:   (s.accom_required as boolean) ?? false,
        car_required:     (s.car_required as boolean) ?? false,
        source:           s.source as string,
        notes:            s.notes as string | null,
        filled_count:     fillMap[s.id as string]?.count ?? 0,
        assigned_names:   fillMap[s.id as string]?.names ?? [],
      }))

    // Build tooling slots
    const tools: ToolingSlot[] = toolSlotRows.map(s => {
      const aid = s.sea_asset_id as string | null
      return {
        id:           s.id as string,
        role:         s.role as string,
        qty:          s.qty as number,
        mob_in:       s.mob_in as string | null,
        mob_out:      s.mob_out as string | null,
        notes:        s.notes as string | null,
        sea_asset_id: aid,
        asset_tag:    aid ? assetMap[aid]?.asset_tag ?? null : null,
        asset_name:   aid ? assetMap[aid]?.name ?? null : null,
        source:       s.source as string,
      }
    })

    setCrewSlots(crew)
    setToolSlots(tools)
    setRateCards((rcData.data || []) as RateCard[])
    setWbsList((wbsData.data || []) as { id: string; code: string; name: string }[])
    setSeaAssets((assetData.data || []) as { id: string; asset_tag: string; name: string; category: string | null }[])
    setLoading(false)
  }, [activeProject?.id])

  useEffect(() => { load() }, [load])

  // ── Crew slot save ────────────────────────────────────────────────────────

  async function saveCrew() {
    if (!activeProject || !crewForm.role.trim()) return toast('Role is required', 'error')
    setSaving(true)
    const payload = {
      project_id:       activeProject.id,
      slot_type:        'people',
      role:             crewForm.role.trim(),
      shift:            crewForm.shift || null,
      category:         crewForm.category || null,
      qty:              crewForm.qty || 1,
      wbs:              crewForm.wbs || null,
      rate_card_id:     crewForm.rate_card_id || null,
      mob_in:           crewForm.mob_in || null,
      mob_out:          crewForm.mob_out || null,
      flight_required:  crewForm.flight_required,
      accom_required:   crewForm.accom_required,
      car_required:     crewForm.car_required,
      notes:            crewForm.notes || null,
      source:           'manual',
    }
    const { error } = editCrewId
      ? await supabase.from('crew_plan').update(payload).eq('id', editCrewId)
      : await supabase.from('crew_plan').insert(payload)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(editCrewId ? 'Slot updated' : 'Slot added', 'success')
    setSaving(false); setShowCrewForm(false); setEditCrewId(null)
    setCrewForm({ ...BLANK_CREW }); load()
  }

  // ── Tooling slot save ─────────────────────────────────────────────────────

  async function saveTool() {
    if (!activeProject || !toolForm.role.trim()) return toast('Tool type/description required', 'error')
    setSaving(true)
    const payload = {
      project_id:   activeProject.id,
      slot_type:    'tooling',
      role:         toolForm.role.trim(),
      qty:          toolForm.qty || 1,
      mob_in:       toolForm.mob_in || null,
      mob_out:      toolForm.mob_out || null,
      notes:        toolForm.notes || null,
      sea_asset_id: toolForm.sea_asset_id || null,
      source:       'manual',
    }
    const { error } = editToolId
      ? await supabase.from('crew_plan').update(payload).eq('id', editToolId)
      : await supabase.from('crew_plan').insert(payload)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(editToolId ? 'Tool slot updated' : 'Tool slot added', 'success')
    setSaving(false); setShowToolForm(false); setEditToolId(null)
    setToolForm({ ...BLANK_TOOL }); load()
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function deleteSlot(id: string, type: 'crew' | 'tool', filled: number) {
    if (type === 'crew' && filled > 0) {
      if (!confirm('This slot has people assigned. Deleting it won\'t remove them from the resource list. Continue?')) return
    } else if (!confirm('Delete this requirement slot?')) return
    const { error } = await supabase.from('crew_plan').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    toast('Slot removed', 'success'); load()
  }

  // ── Summary stats ─────────────────────────────────────────────────────────

  const totalCrewSlots  = crewSlots.reduce((acc, s) => acc + s.qty, 0)
  const totalCrewFilled = crewSlots.reduce((acc, s) => acc + Math.min(s.qty, s.filled_count), 0)
  const totalToolSlots  = toolSlots.reduce((acc, s) => acc + s.qty, 0)
  const totalToolFilled = toolSlots.filter(s => s.sea_asset_id).length

  if (!activeProject) {
    return <div className="empty-state"><div style={{ fontSize: 13, color: 'var(--text3)' }}>Select a project to view resource requirements</div></div>
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em', marginBottom: 4 }}>
          Resource Requirements
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {activeProject.name} · Planning aid only — does not constrain the resource list or equipment panel
        </div>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        {[
          { label: 'Crew slots',   val: totalCrewSlots,  color: 'var(--accent)' },
          { label: 'Crew filled',  val: totalCrewFilled, color: 'var(--green)'  },
          { label: 'Crew open',    val: totalCrewSlots - totalCrewFilled, color: totalCrewSlots - totalCrewFilled > 0 ? 'var(--red)' : 'var(--text3)' },
          { label: 'Tool slots',   val: totalToolSlots,  color: 'var(--blue)'   },
          { label: 'Tools assigned', val: totalToolFilled, color: 'var(--green)' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 14px', borderTop: `3px solid ${color}`, minWidth: 100 }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /></div>
      ) : (
        <>
          {/* ── Section 1: Crew Plan ── */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <SectionHeader
                icon="👥"
                title="Crew Requirements"
                count={crewSlots.length}
                note="Internal Siemens roles expected for this project — Resource Manager assigns names"
              />
              {canEdit && (
                <button className="btn btn-primary btn-sm" onClick={() => { setEditCrewId(null); setCrewForm({ ...BLANK_CREW }); setShowCrewForm(s => !s) }}>
                  + Add role
                </button>
              )}
            </div>

            {/* Crew form */}
            {showCrewForm && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', marginBottom: 12 }}>
                  {editCrewId ? 'Edit role slot' : 'Add crew requirement'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                  <div style={{ gridColumn: '1 / span 2' }}>
                    <FieldLabel>Role *</FieldLabel>
                    <input className="input" value={crewForm.role} autoFocus
                      onChange={e => setCrewForm(f => ({ ...f, role: e.target.value }))}
                      placeholder="e.g. Mechanical Fitter DS" />
                  </div>
                  <div>
                    <FieldLabel>Category</FieldLabel>
                    <select className="input" value={crewForm.category} onChange={e => setCrewForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="trades">Trades</option>
                      <option value="management">Management</option>
                      <option value="seag">SE AG</option>
                      <option value="subcontractor">Subcontractor</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Shift</FieldLabel>
                    <select className="input" value={crewForm.shift} onChange={e => setCrewForm(f => ({ ...f, shift: e.target.value }))}>
                      <option value="day">Day Shift</option>
                      <option value="night">Night Shift</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Quantity</FieldLabel>
                    <input className="input" type="number" min={1} max={50} value={crewForm.qty}
                      onChange={e => setCrewForm(f => ({ ...f, qty: parseInt(e.target.value) || 1 }))} />
                  </div>
                  <div>
                    <FieldLabel>WBS</FieldLabel>
                    <select className="input" value={crewForm.wbs} onChange={e => setCrewForm(f => ({ ...f, wbs: e.target.value }))}>
                      <option value="">— None —</option>
                      {wbsList.map(w => <option key={w.id} value={w.code}>{w.code} {w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Rate Card</FieldLabel>
                    <select className="input" value={crewForm.rate_card_id} onChange={e => setCrewForm(f => ({ ...f, rate_card_id: e.target.value }))}>
                      <option value="">— None —</option>
                      {rateCards.map(r => <option key={r.id} value={r.id}>{r.role}</option>)}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Mob In</FieldLabel>
                    <input className="input" type="date" value={crewForm.mob_in} onChange={e => setCrewForm(f => ({ ...f, mob_in: e.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel>Mob Out</FieldLabel>
                    <input className="input" type="date" value={crewForm.mob_out} onChange={e => setCrewForm(f => ({ ...f, mob_out: e.target.value }))} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FieldLabel>Requirements</FieldLabel>
                    <div style={{ display: 'flex', gap: 16 }}>
                      {[['flight_required', '✈ Flights'], ['accom_required', '🏨 Accommodation'], ['car_required', '🚗 Car']].map(([key, label]) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>
                          <input type="checkbox"
                            checked={(crewForm as Record<string, unknown>)[key] as boolean}
                            onChange={e => setCrewForm(f => ({ ...f, [key]: e.target.checked }))} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FieldLabel>Notes</FieldLabel>
                    <input className="input" value={crewForm.notes} onChange={e => setCrewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={saveCrew} disabled={saving}>
                    {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
                    {editCrewId ? 'Save changes' : 'Add slot'}
                  </button>
                  <button className="btn btn-sm" onClick={() => { setShowCrewForm(false); setEditCrewId(null) }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Crew table */}
            {crewSlots.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                No crew requirements defined yet. {canEdit && 'Click "+ Add role" to start planning.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Role', 'Category', 'Shift', 'WBS', 'Dates', 'Qty', 'Needs', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crewSlots.map((slot, i) => {
                    const cat = slot.category
                    const catStyle = cat ? (CAT_STYLE[cat] ?? null) : null
                    return (
                      <tr key={slot.id} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                          {slot.role}
                          {slot.source !== 'manual' && <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: '#ede9fe', color: '#5b21b6' }}>{slot.source}</span>}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {cat && catStyle ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, textTransform: 'capitalize', ...catStyle }}>{cat}</span> : '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: slot.shift === 'night' ? '#1e1b4b' : '#e0f2fe', color: slot.shift === 'night' ? '#a5b4fc' : '#0369a1' }}>
                            {slot.shift === 'night' ? 'NS' : 'DS'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{slot.wbs || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(slot.mob_in)} → {fmtDate(slot.mob_out)}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'center' }}>×{slot.qty}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', gap: 3 }}>
                            {slot.flight_required && <span title="Flights" style={{ fontSize: 12 }}>✈</span>}
                            {slot.accom_required  && <span title="Accommodation" style={{ fontSize: 12 }}>🏨</span>}
                            {slot.car_required    && <span title="Car" style={{ fontSize: 12 }}>🚗</span>}
                            {!slot.flight_required && !slot.accom_required && !slot.car_required && <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <FilledBadge filled={slot.filled_count} qty={slot.qty} />
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canEdit && (
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button className="btn btn-sm" style={{ padding: '2px 7px', fontSize: 11 }}
                                onClick={() => {
                                  setEditCrewId(slot.id)
                                  setCrewForm({ role: slot.role, shift: slot.shift ?? 'day', category: slot.category ?? 'trades', qty: slot.qty, wbs: slot.wbs ?? '', rate_card_id: slot.rate_card_id ?? '', mob_in: slot.mob_in ?? '', mob_out: slot.mob_out ?? '', flight_required: slot.flight_required, accom_required: slot.accom_required, car_required: slot.car_required, notes: slot.notes ?? '' })
                                  setShowCrewForm(true)
                                }}>Edit</button>
                              <button className="btn btn-sm" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red)' }}
                                onClick={() => deleteSlot(slot.id, 'crew', slot.filled_count)}>✕</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {crewSlots.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, display: 'flex', gap: 6 }}>
                <span>💡</span>
                <span>Status counts only resources formally linked to a slot. Check the Resources panel for the full crew list.</span>
              </div>
            )}
          </div>

          {/* ── Section 2: Tooling Requirements ── */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <SectionHeader
                icon="🧰"
                title="Tooling Requirements"
                count={toolSlots.length}
                note="SEA-owned assets expected for this project — Warehouse assigns specific tags"
              />
              {canEdit && (
                <button className="btn btn-primary btn-sm" onClick={() => { setEditToolId(null); setToolForm({ ...BLANK_TOOL }); setShowToolForm(s => !s) }}>
                  + Add tool
                </button>
              )}
            </div>

            {/* Tooling form */}
            {showToolForm && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', marginBottom: 12 }}>
                  {editToolId ? 'Edit tooling slot' : 'Add tooling requirement'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                  <div style={{ gridColumn: '1 / span 2' }}>
                    <FieldLabel>Tool Type / Description *</FieldLabel>
                    <input className="input" value={toolForm.role} autoFocus
                      onChange={e => setToolForm(f => ({ ...f, role: e.target.value }))}
                      placeholder="e.g. Tool Container, Borescope, Hytorc Kit" />
                  </div>
                  <div>
                    <FieldLabel>Quantity</FieldLabel>
                    <input className="input" type="number" min={1} value={toolForm.qty}
                      onChange={e => setToolForm(f => ({ ...f, qty: parseInt(e.target.value) || 1 }))} />
                  </div>
                  <div>
                    <FieldLabel>Specific Asset (optional)</FieldLabel>
                    <select className="input" value={toolForm.sea_asset_id} onChange={e => setToolForm(f => ({ ...f, sea_asset_id: e.target.value }))}>
                      <option value="">— Any available —</option>
                      {seaAssets.map(a => <option key={a.id} value={a.id}>{a.asset_tag} · {a.name.slice(0, 30)}</option>)}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Required From</FieldLabel>
                    <input className="input" type="date" value={toolForm.mob_in} onChange={e => setToolForm(f => ({ ...f, mob_in: e.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel>Required Until</FieldLabel>
                    <input className="input" type="date" value={toolForm.mob_out} onChange={e => setToolForm(f => ({ ...f, mob_out: e.target.value }))} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FieldLabel>Notes</FieldLabel>
                    <input className="input" value={toolForm.notes} onChange={e => setToolForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Required for LP turbine lift — confirm with warehouse 3 weeks prior" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={saveTool} disabled={saving}>
                    {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
                    {editToolId ? 'Save changes' : 'Add slot'}
                  </button>
                  <button className="btn btn-sm" onClick={() => { setShowToolForm(false); setEditToolId(null) }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Tooling table */}
            {toolSlots.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                No tooling requirements defined yet. {canEdit && 'Click "+ Add tool" to list what you\'ll need.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Tool Type', 'Qty', 'Dates', 'Assigned Asset', 'Notes', ''].map(h => (
                      <th key={h} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {toolSlots.map((slot, i) => (
                    <tr key={slot.id} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{slot.role}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'center' }}>×{slot.qty}</td>
                      <td style={{ padding: '8px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(slot.mob_in)} → {fmtDate(slot.mob_out)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {slot.sea_asset_id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent-light)', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3 }}>
                            {slot.asset_tag} · {slot.asset_name?.slice(0, 20)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Not yet assigned</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.notes || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm" style={{ padding: '2px 7px', fontSize: 11 }}
                              onClick={() => {
                                setEditToolId(slot.id)
                                setToolForm({ role: slot.role, qty: slot.qty, mob_in: slot.mob_in ?? '', mob_out: slot.mob_out ?? '', notes: slot.notes ?? '', sea_asset_id: slot.sea_asset_id ?? '' })
                                setShowToolForm(true)
                              }}>Edit</button>
                            <button className="btn btn-sm" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red)' }}
                              onClick={() => deleteSlot(slot.id, 'tool', 0)}>✕</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {toolSlots.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, display: 'flex', gap: 6 }}>
                <span>💡</span>
                <span>Tooling assignments are managed by the warehouse via Resource Manager → Tooling Demand. Confirmed assignments also appear in Equipment → SEA Local Tooling.</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
