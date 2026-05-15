import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileSearchBar } from '../../components/mobile/ui/MobileSearchBar'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { useRegisterRefresh } from '../../components/mobile/ui/RefreshContext'
import type { Car, Resource } from '../../types'

type Mode = 'list' | 'edit' | 'new'

interface FormState {
  vehicle_type: string
  rego: string
  vendor: string
  person_id: string
  start_date: string
  end_date: string
  pickup_loc: string
  return_loc: string
  reservation: string
  collected: boolean
  dropped_off: boolean
  notes: string
}

const EMPTY: FormState = {
  vehicle_type: '', rego: '', vendor: '', person_id: '',
  start_date: '', end_date: '',
  pickup_loc: '', return_loc: '', reservation: '',
  collected: false, dropped_off: false,
  notes: '',
}

function fmtDate(d: string): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

type Status = 'collected' | 'in_use' | 'returned' | 'pending' | 'no_dates'
function getStatus(c: Car): Status {
  if (!c.start_date || !c.end_date) return 'no_dates'
  const today = new Date().toISOString().slice(0, 10)
  if (c.dropped_off) return 'returned'
  if (c.collected) {
    if (c.end_date < today) return 'returned'  // past end date implies returned
    return 'in_use'
  }
  if (c.start_date <= today && c.end_date >= today) return 'collected'  // should-be-collected
  return 'pending'
}

const STATUS_LABEL: Record<Status, string> = {
  collected: 'Collect today',
  in_use: 'In use',
  returned: 'Returned',
  pending: 'Pending',
  no_dates: 'No dates',
}

/**
 * Mobile Cars panel.
 *
 * Field-critical features beyond Resources/Accom pattern:
 * - Inline collected / dropped-off toggle on each card without opening edit
 *   (the most common on-the-spot action at vehicle handover/return)
 * - Search by rego, vehicle type, driver name, vendor
 * - Filter chips by status — "Collect today" highlights vehicles that should
 *   have been collected by now but haven't been
 */
export function CarsMobile() {
  const { activeProject } = useAppStore()
  const [list, setList] = useState<Car[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')

  const [mode, setMode] = useState<Mode>('list')
  const [editing, setEditing] = useState<Car | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  // Optimistic update set — IDs currently mid-toggle. Prevents flicker.
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useRegisterRefresh(load)

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id
    const [cRes, rRes] = await Promise.all([
      supabase.from('cars').select('*').eq('project_id', pid).order('start_date'),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
    ])
    setList((cRes.data || []) as Car[])
    setResources((rRes.data || []) as Resource[])
    setLoading(false)
  }

  const resMap = useMemo(() => {
    const m: Record<string, Resource> = {}
    for (const r of resources) m[r.id] = r
    return m
  }, [resources])

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setMode('new')
  }

  function openEdit(c: Car) {
    setEditing(c)
    setForm({
      vehicle_type: c.vehicle_type || '',
      rego: c.rego || '',
      vendor: c.vendor || '',
      person_id: c.person_id || '',
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      pickup_loc: c.pickup_loc || '',
      return_loc: c.return_loc || '',
      reservation: c.reservation || '',
      collected: !!c.collected,
      dropped_off: !!c.dropped_off,
      notes: c.notes || '',
    })
    setMode('edit')
  }

  function closeSheet() {
    if (saving) return
    setMode('list')
    setEditing(null)
  }

  async function save() {
    if (!form.vendor.trim())       { toast('Vendor required', 'error');       return }
    if (!form.vehicle_type.trim()) { toast('Vehicle type required', 'error'); return }
    if (!activeProject) return
    setSaving(true)
    // NOT NULL text columns get '' when empty (matches DB defaults).
    // Same pattern as desktop save() — see desktop comment for context.
    const payload = {
      project_id: activeProject.id,
      vendor: form.vendor.trim(),
      vehicle_type: form.vehicle_type.trim(),
      rego: form.rego || '',
      person_id: form.person_id || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      pickup_loc: form.pickup_loc || '',
      return_loc: form.return_loc || '',
      reservation: form.reservation || '',
      collected: !!form.collected,
      dropped_off: !!form.dropped_off,
      notes: form.notes || '',
    }
    let err
    if (mode === 'new') {
      ({ error: err } = await supabase.from('cars').insert(payload))
    } else if (editing) {
      ({ error: err } = await supabase.from('cars').update(payload).eq('id', editing.id))
    }
    setSaving(false)
    if (err) { toast(err.message, 'error'); return }
    toast(mode === 'new' ? 'Vehicle added' : 'Saved', 'success')
    closeSheet()
    load()
  }

  async function deleteCar() {
    if (!editing) return
    if (!confirm(`Delete vehicle "${editing.vehicle_type} ${editing.rego || ''}"?`)) return
    setSaving(true)
    await supabase.from('cars').delete().eq('id', editing.id)
    setSaving(false)
    toast('Deleted', 'info')
    closeSheet()
    load()
  }

  /**
   * Inline toggle for collected / dropped_off. Optimistic update so the UI
   * responds instantly; rolls back on error. Stops event propagation so
   * tapping the toggle doesn't open the edit sheet.
   */
  async function toggleCollected(c: Car, e: React.MouseEvent) {
    e.stopPropagation()
    if (togglingIds.has(c.id)) return
    const next = !c.collected
    setTogglingIds(s => new Set(s).add(c.id))
    setList(list => list.map(x => x.id === c.id ? { ...x, collected: next } as Car : x))
    const { error } = await supabase.from('cars').update({ collected: next }).eq('id', c.id)
    setTogglingIds(s => { const n = new Set(s); n.delete(c.id); return n })
    if (error) {
      toast(`Failed: ${error.message}`, 'error')
      setList(list => list.map(x => x.id === c.id ? { ...x, collected: !next } as Car : x))  // rollback
    } else {
      toast(next ? 'Marked collected' : 'Unmarked collected', 'success')
    }
  }
  async function toggleDropped(c: Car, e: React.MouseEvent) {
    e.stopPropagation()
    if (togglingIds.has(c.id)) return
    const next = !c.dropped_off
    setTogglingIds(s => new Set(s).add(c.id))
    setList(list => list.map(x => x.id === c.id ? { ...x, dropped_off: next } as Car : x))
    const { error } = await supabase.from('cars').update({ dropped_off: next }).eq('id', c.id)
    setTogglingIds(s => { const n = new Set(s); n.delete(c.id); return n })
    if (error) {
      toast(`Failed: ${error.message}`, 'error')
      setList(list => list.map(x => x.id === c.id ? { ...x, dropped_off: !next } as Car : x))
    } else {
      toast(next ? 'Marked dropped off' : 'Unmarked dropped off', 'success')
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => list.filter(c => {
    if (filter !== 'all' && getStatus(c) !== filter) return false
    if (!q) return true
    const driver = c.person_id ? (resMap[c.person_id]?.name || '') : ''
    return (c.rego || '').toLowerCase().includes(q)
        || (c.vehicle_type || '').toLowerCase().includes(q)
        || (c.vendor || '').toLowerCase().includes(q)
        || driver.toLowerCase().includes(q)
  }), [list, resMap, filter, q])

  const statusCounts = useMemo(() => {
    const c = { collected: 0, in_use: 0, returned: 0, pending: 0, no_dates: 0 }
    for (const car of list) c[getStatus(car)]++
    return c
  }, [list])

  return (
    <>
      <MobilePanelHeader
        title="Cars"
        subtitle={`${list.length} vehicle${list.length === 1 ? '' : 's'}`}
      />

      <div className="mobile-filter-chips">
        <button className={`mobile-chip ${filter === 'all' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('all')}>All ({list.length})</button>
        <button className={`mobile-chip ${filter === 'collected' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('collected')}>Collect today ({statusCounts.collected})</button>
        <button className={`mobile-chip ${filter === 'in_use' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('in_use')}>In use ({statusCounts.in_use})</button>
        <button className={`mobile-chip ${filter === 'pending' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('pending')}>Pending ({statusCounts.pending})</button>
        <button className={`mobile-chip ${filter === 'returned' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('returned')}>Returned ({statusCounts.returned})</button>
      </div>

      <div style={{ padding: '10px 14px', background: 'var(--bg)' }}>
        <MobileSearchBar value={search} onChange={setSearch} placeholder="Rego, type, driver, vendor…" />
      </div>

      {loading ? (
        <div className="mobile-loading"><span className="spinner" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <div className="mobile-empty-icon">🚗</div>
          <h3>{q ? 'No matches' : 'No vehicles'}</h3>
          <p>{q ? 'Try a different search.' : 'Tap + to add the first vehicle.'}</p>
        </div>
      ) : (
        <div className="mobile-list">
          {filtered.map(c => {
            const status = getStatus(c)
            const driver = c.person_id ? resMap[c.person_id]?.name : null
            return (
              <button
                key={c.id}
                className="mobile-card mobile-car-card"
                onClick={() => openEdit(c)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{c.rego || '— no rego —'}</span>
                      <span style={{ fontSize: 13, color: 'var(--text2)' }}>{c.vehicle_type || 'Vehicle'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                      {driver || <span style={{ color: 'var(--text3)' }}>Unassigned</span>}
                      {c.vendor ? <span style={{ color: 'var(--text3)' }}> · {c.vendor}</span> : null}
                    </div>
                  </div>
                  <span className={`mobile-status-pill mobile-status-car-${status}`}>{STATUS_LABEL[status]}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  {c.start_date
                    ? `${fmtDate(c.start_date)} → ${fmtDate(c.end_date || '')}`
                    : 'Dates not set'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <span
                    className={`mobile-toggle-pill ${c.collected ? 'mobile-toggle-pill-on' : ''}`}
                    onClick={e => toggleCollected(c, e)}
                  >
                    {c.collected ? '✓' : '○'} Collected
                  </span>
                  <span
                    className={`mobile-toggle-pill ${c.dropped_off ? 'mobile-toggle-pill-on' : ''}`}
                    onClick={e => toggleDropped(c, e)}
                  >
                    {c.dropped_off ? '✓' : '○'} Dropped off
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        className="mobile-fab"
        onClick={openNew}
        aria-label="Add vehicle"
      >
        +
      </button>

      <MobileBottomSheet
        open={mode !== 'list'}
        onClose={closeSheet}
        title={mode === 'new' ? 'New vehicle' : 'Edit vehicle'}
        preventBackdropClose={saving}
        height="full"
        footer={(
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: 48 }}
                onClick={deleteCar}
                disabled={saving}
                title="Delete vehicle"
              >
                🗑
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, height: 48, fontWeight: 600 }}
              onClick={save}
              disabled={saving || !form.vendor.trim() || !form.vehicle_type.trim()}
            >
              {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (mode === 'new' ? 'Add vehicle' : 'Save')}
            </button>
          </div>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Vehicle type *</label>
              <input
                className="input"
                value={form.vehicle_type}
                onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}
                placeholder="e.g. Hilux"
                style={{ width: '100%', height: 44 }}
              />
            </div>
            <div>
              <label className="mobile-form-label">Rego</label>
              <input
                className="input"
                value={form.rego}
                onChange={e => setForm(f => ({ ...f, rego: e.target.value.toUpperCase() }))}
                placeholder="ABC123"
                style={{ width: '100%', height: 44, fontFamily: 'var(--mono)', textTransform: 'uppercase' }}
                autoCapitalize="characters"
              />
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Vendor *</label>
            <input
              className="input"
              value={form.vendor}
              onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
              placeholder="Hertz, Avis, etc."
              style={{ width: '100%', height: 44 }}
            />
          </div>

          <div>
            <label className="mobile-form-label">Driver</label>
            <select
              className="input"
              value={form.person_id}
              onChange={e => setForm(f => ({ ...f, person_id: e.target.value }))}
              style={{ width: '100%', height: 44 }}
            >
              <option value="">— Unassigned —</option>
              {resources.map(r => (
                <option key={r.id} value={r.id}>{r.name} {r.role ? `(${r.role})` : ''}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Start</label>
              <input
                type="date"
                className="input"
                value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                style={{ width: '100%', height: 44 }}
              />
            </div>
            <div>
              <label className="mobile-form-label">End</label>
              <input
                type="date"
                className="input"
                value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                style={{ width: '100%', height: 44 }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Pickup</label>
              <input
                className="input"
                value={form.pickup_loc}
                onChange={e => setForm(f => ({ ...f, pickup_loc: e.target.value }))}
                placeholder="Location"
                style={{ width: '100%', height: 44 }}
              />
            </div>
            <div>
              <label className="mobile-form-label">Return</label>
              <input
                className="input"
                value={form.return_loc}
                onChange={e => setForm(f => ({ ...f, return_loc: e.target.value }))}
                placeholder="Location"
                style={{ width: '100%', height: 44 }}
              />
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Reservation</label>
            <input
              className="input"
              value={form.reservation}
              onChange={e => setForm(f => ({ ...f, reservation: e.target.value }))}
              placeholder="Reservation / confirmation #"
              style={{ width: '100%', height: 44, fontFamily: 'var(--mono)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`mobile-toggle-pill mobile-toggle-pill-lg ${form.collected ? 'mobile-toggle-pill-on' : ''}`}
              onClick={() => setForm(f => ({ ...f, collected: !f.collected }))}
            >
              {form.collected ? '✓' : '○'} Collected
            </button>
            <button
              type="button"
              className={`mobile-toggle-pill mobile-toggle-pill-lg ${form.dropped_off ? 'mobile-toggle-pill-on' : ''}`}
              onClick={() => setForm(f => ({ ...f, dropped_off: !f.dropped_off }))}
            >
              {form.dropped_off ? '✓' : '○'} Dropped off
            </button>
          </div>

          <div>
            <label className="mobile-form-label">Notes</label>
            <textarea
              className="input"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              style={{ width: '100%', resize: 'vertical', minHeight: 60 }}
            />
          </div>

          {mode === 'edit' && editing && (
            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
              💡 Daily rate, GM %, location fees, and PO links must be edited on desktop.
              {editing.daily_rate ? <> Current rate: <strong style={{ color: 'var(--text)' }}>${Number(editing.daily_rate).toLocaleString('en-AU')}/day</strong>.</> : null}
            </div>
          )}
        </div>
      </MobileBottomSheet>
    </>
  )
}
