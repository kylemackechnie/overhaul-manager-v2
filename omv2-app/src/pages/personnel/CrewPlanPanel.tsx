/**
 * CrewPlanPanel.tsx
 * Planning aid for expected internal Siemens roles on a project.
 * NOT authoritative over the resource list — purely informational.
 * Both PMs and Resource Managers can add/edit/remove slots.
 * Once a person is assigned, the slot shows their name.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../lib/permissions'
import { toast } from '../../components/ui/Toast'
import type { RateCard } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrewPlanSlot {
  id: string
  project_id: string
  role: string
  shift: string | null
  category: string | null
  wbs: string | null
  qty: number
  mob_in: string | null
  mob_out: string | null
  flight_required: boolean
  accom_required: boolean
  car_required: boolean
  rate_card_id: string | null
  source: string
  notes: string | null
  // Derived: how many resources rows link to this slot
  filled_count?: number
  assigned_names?: string[]
}

interface Props {
  projectId: string
  rateCards: RateCard[]
  wbsList: { code: string; name: string }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['trades', 'management', 'seag', 'subcontractor'] as const
const SHIFTS = ['day', 'night'] as const

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

const SOURCE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  manual:   { bg: 'var(--bg3)',  color: 'var(--text3)', label: 'Manual' },
  tender:   { bg: '#ede9fe',     color: '#5b21b6',       label: 'Tender' },
  imported: { bg: '#fef3c7',     color: '#92400e',       label: 'Imported' },
}

const BLANK_FORM = {
  role: '', shift: 'day', category: 'trades', wbs: '',
  qty: 1, mob_in: '', mob_out: '',
  flight_required: false, accom_required: false, car_required: false,
  rate_card_id: '', notes: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function FilledBadge({ filled, qty, names }: { filled: number; qty: number; names: string[] }) {
  const all = filled >= qty
  const none = filled === 0
  const bg = all ? '#d1fae5' : none ? '#fee2e2' : '#fef3c7'
  const color = all ? '#065f46' : none ? '#991b1b' : '#92400e'
  return (
    <span title={names.join(', ')} style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: bg, color, fontFamily: 'var(--mono)', cursor: names.length ? 'help' : 'default',
    }}>
      {filled}/{qty} filled
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function CrewPlanPanel({ projectId, rateCards, wbsList }: Props) {
  const [slots, setSlots] = useState<CrewPlanSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [saving, setSaving] = useState(false)
  const { canWrite } = usePermissions()
  const canEdit = canWrite('personnel')

  const load = useCallback(async () => {
    setLoading(true)
    // Load crew plan slots
    const { data: planData, error } = await supabase
      .from('crew_plan')
      .select('*')
      .eq('project_id', projectId)
      .order('category')
      .order('role')

    if (error) { toast(error.message, 'error'); setLoading(false); return }

    // Load resources linked to this project's crew plan slots to get fill counts
    const slotIds = (planData || []).map(s => s.id)
    let filledMap: Record<string, { count: number; names: string[] }> = {}

    if (slotIds.length > 0) {
      const { data: resData } = await supabase
        .from('resources')
        .select('crew_plan_id, name')
        .eq('project_id', projectId)
        .in('crew_plan_id', slotIds)

      for (const r of (resData || [])) {
        if (!r.crew_plan_id) continue
        if (!filledMap[r.crew_plan_id]) filledMap[r.crew_plan_id] = { count: 0, names: [] }
        filledMap[r.crew_plan_id].count++
        filledMap[r.crew_plan_id].names.push(r.name)
      }
    }

    setSlots((planData || []).map(s => ({
      ...s,
      filled_count: filledMap[s.id]?.count ?? 0,
      assigned_names: filledMap[s.id]?.names ?? [],
    })))
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditId(null)
    setForm({ ...BLANK_FORM })
    setShowForm(true)
  }

  function openEdit(slot: CrewPlanSlot) {
    setEditId(slot.id)
    setForm({
      role: slot.role,
      shift: slot.shift ?? 'day',
      category: slot.category ?? 'trades',
      wbs: slot.wbs ?? '',
      qty: slot.qty,
      mob_in: slot.mob_in ?? '',
      mob_out: slot.mob_out ?? '',
      flight_required: slot.flight_required,
      accom_required: slot.accom_required,
      car_required: slot.car_required,
      rate_card_id: slot.rate_card_id ?? '',
      notes: slot.notes ?? '',
    })
    setShowForm(true)
  }

  async function save() {
    if (!form.role.trim()) return toast('Role is required', 'error')
    setSaving(true)
    const payload = {
      project_id: projectId,
      role: form.role.trim(),
      shift: form.shift || null,
      category: form.category || null,
      wbs: form.wbs || null,
      qty: form.qty || 1,
      mob_in: form.mob_in || null,
      mob_out: form.mob_out || null,
      flight_required: form.flight_required,
      accom_required: form.accom_required,
      car_required: form.car_required,
      rate_card_id: form.rate_card_id || null,
      notes: form.notes || null,
      source: 'manual',
    }
    const { error } = editId
      ? await supabase.from('crew_plan').update(payload).eq('id', editId)
      : await supabase.from('crew_plan').insert(payload)

    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(editId ? 'Slot updated' : 'Slot added', 'success')
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function deleteSlot(id: string, filled: number) {
    if (filled > 0) {
      if (!confirm('This slot has people assigned. Deleting it won\'t remove them from the resource list. Continue?')) return
    } else {
      if (!confirm('Delete this crew plan slot?')) return
    }
    const { error } = await supabase.from('crew_plan').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    toast('Slot removed', 'success')
    load()
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalSlots = slots.reduce((acc, s) => acc + s.qty, 0)
  const totalFilled = slots.reduce((acc, s) => acc + (s.filled_count ?? 0), 0)
  const totalOpen = totalSlots - totalFilled

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: 'Total slots', val: totalSlots, color: 'var(--accent)' },
            { label: 'Filled', val: totalFilled, color: 'var(--green)' },
            { label: 'Open', val: totalOpen, color: totalOpen > 0 ? 'var(--red)' : 'var(--text3)' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '6px 12px',
              borderTop: `3px solid ${color}`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
            Planning aid only — does not constrain the resource list
          </span>
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={openNew}>
              + Add slot
            </button>
          )}
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="card" style={{ border: '1px solid var(--accent)', padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
            {editId ? 'Edit slot' : 'Add crew plan slot'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {/* Role */}
            <div style={{ gridColumn: '1 / span 2' }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Role *</label>
              <input className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                placeholder="e.g. Mechanical Fitter DS" autoFocus />
            </div>
            {/* Category */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Category</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>)}
              </select>
            </div>
            {/* Shift */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Shift</label>
              <select className="input" value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}>
                {SHIFTS.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s === 'day' ? 'Day Shift' : 'Night Shift'}</option>)}
              </select>
            </div>
            {/* Qty */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Quantity</label>
              <input className="input" type="number" min={1} max={50} value={form.qty}
                onChange={e => setForm(f => ({ ...f, qty: parseInt(e.target.value) || 1 }))} />
            </div>
            {/* WBS */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>WBS</label>
              <select className="input" value={form.wbs} onChange={e => setForm(f => ({ ...f, wbs: e.target.value }))}>
                <option value="">— Select WBS —</option>
                {wbsList.map(w => <option key={w.code} value={w.code}>{w.code} {w.name}</option>)}
              </select>
            </div>
            {/* Rate card */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Rate Card</label>
              <select className="input" value={form.rate_card_id} onChange={e => setForm(f => ({ ...f, rate_card_id: e.target.value }))}>
                <option value="">— None —</option>
                {rateCards.map(r => <option key={r.id} value={r.id}>{r.role}</option>)}
              </select>
            </div>
            {/* Mob dates */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Mob In</label>
              <input className="input" type="date" value={form.mob_in} onChange={e => setForm(f => ({ ...f, mob_in: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Mob Out</label>
              <input className="input" type="date" value={form.mob_out} onChange={e => setForm(f => ({ ...f, mob_out: e.target.value }))} />
            </div>
            {/* Requirements */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Requirements</label>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { key: 'flight_required', label: '✈ Flights' },
                  { key: 'accom_required', label: '🏨 Accommodation' },
                  { key: 'car_required', label: '🚗 Car' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>
                    <input type="checkbox"
                      checked={(form as Record<string, unknown>)[key] as boolean}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            {/* Notes */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Notes</label>
              <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes for this slot" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
              {editId ? 'Save changes' : 'Add slot'}
            </button>
            <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Slots table */}
      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading crew plan…</div>
      ) : slots.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>No crew plan slots yet</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
            Define the internal roles you expect to need for this project.<br />
            The resource list remains the authority — this is a planning reference only.
          </div>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add first slot</button>}
        </div>
      ) : (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)', borderBottom: '2px solid var(--border)' }}>
                {['Role', 'Category', 'Shift', 'WBS', 'Dates', 'Needs', 'Status', ''].map(h => (
                  <th key={h} style={{
                    padding: '8px 10px', fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'var(--text3)', textAlign: 'left', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, i) => {
                const catStyle = CAT_STYLE[slot.category ?? ''] ?? { bg: 'var(--bg3)', color: 'var(--text3)' }
                const sourceStyle = SOURCE_STYLE[slot.source ?? 'manual']
                const rowBg = i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)'
                return (
                  <tr key={slot.id} style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
                    {/* Role */}
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{slot.role}</div>
                      {slot.qty > 1 && <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>×{slot.qty}</div>}
                      {slot.source !== 'manual' && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, ...sourceStyle }}>
                          {sourceStyle.label}
                        </span>
                      )}
                    </td>
                    {/* Category */}
                    <td style={{ padding: '8px 10px' }}>
                      {slot.category
                        ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, ...catStyle, textTransform: 'capitalize' }}>{slot.category}</span>
                        : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                      }
                    </td>
                    {/* Shift */}
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                        background: slot.shift === 'night' ? '#1e1b4b' : '#e0f2fe',
                        color: slot.shift === 'night' ? '#a5b4fc' : '#0369a1',
                      }}>
                        {slot.shift === 'night' ? 'NS' : 'DS'}
                      </span>
                    </td>
                    {/* WBS */}
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                        {slot.wbs || <span style={{ color: 'var(--text3)' }}>—</span>}
                      </span>
                    </td>
                    {/* Dates */}
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {fmtDate(slot.mob_in)} → {fmtDate(slot.mob_out)}
                      </span>
                    </td>
                    {/* Needs */}
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {slot.flight_required && <span title="Flights required" style={{ fontSize: 12 }}>✈</span>}
                        {slot.accom_required && <span title="Accommodation required" style={{ fontSize: 12 }}>🏨</span>}
                        {slot.car_required && <span title="Car required" style={{ fontSize: 12 }}>🚗</span>}
                        {!slot.flight_required && !slot.accom_required && !slot.car_required && (
                          <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                        )}
                      </div>
                    </td>
                    {/* Fill status */}
                    <td style={{ padding: '8px 10px' }}>
                      <FilledBadge
                        filled={slot.filled_count ?? 0}
                        qty={slot.qty}
                        names={slot.assigned_names ?? []}
                      />
                      {(slot.assigned_names?.length ?? 0) > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {slot.assigned_names?.join(', ')}
                        </div>
                      )}
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm" onClick={() => openEdit(slot)}
                            style={{ padding: '2px 7px', fontSize: 11 }}>Edit</button>
                          <button className="btn btn-sm" onClick={() => deleteSlot(slot.id, slot.filled_count ?? 0)}
                            style={{ padding: '2px 7px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red)' }}>✕</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      {slots.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>💡</span>
          <span>
            Fill counts reflect resources linked to these slots. People added directly to the resource list without a slot link are not counted here — check the resource list for the full picture.
          </span>
        </div>
      )}
    </div>
  )
}
