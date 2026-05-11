import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileSearchBar } from '../../components/mobile/ui/MobileSearchBar'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { MobileQtyStepper } from '../../components/mobile/ui/MobileQtyStepper'
import type { Accommodation, Resource } from '../../types'

type Mode = 'list' | 'edit' | 'new'

interface FormState {
  property: string
  room: string
  vendor: string
  check_in: string
  check_out: string
  nights: number
  occupant_ids: string[]
  notes: string
}

const EMPTY: FormState = {
  property: '', room: '', vendor: '', check_in: '', check_out: '', nights: 0,
  occupant_ids: [], notes: '',
}

function nightsBetween(a: string, b: string): number {
  if (!a || !b) return 0
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

function fmtDate(d: string): string {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function weekStartIso(d: string): string {
  // Group by ISO week (Mon start) for the section headers
  if (!d) return 'No check-in'
  const dt = new Date(d)
  const day = dt.getDay() || 7         // Sun=0 → 7
  if (day !== 1) dt.setDate(dt.getDate() - day + 1)
  return dt.toISOString().slice(0, 10)
}

function fmtWeekHeader(iso: string): string {
  if (iso === 'No check-in') return iso
  const start = new Date(iso)
  const end = new Date(start); end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `Week of ${start.toLocaleDateString('en-AU', opts)} – ${end.toLocaleDateString('en-AU', opts)}`
}

type Status = 'past' | 'current' | 'upcoming' | 'unscheduled'
function getStatus(a: Accommodation): Status {
  if (!a.check_in || !a.check_out) return 'unscheduled'
  const today = new Date().toISOString().slice(0, 10)
  if (a.check_out < today) return 'past'
  if (a.check_in > today) return 'upcoming'
  return 'current'
}

/**
 * Mobile Accommodation panel — search, week-grouped card list, tap-to-edit.
 *
 * Scope of editable fields on mobile is intentionally narrower than desktop:
 * property/room/vendor, dates, occupants, notes. GM%, customer pricing,
 * PO links, and fees are PM-level decisions that belong on desktop and
 * appear as read-only on the card / sheet.
 */
export function AccommodationMobile() {
  const { activeProject } = useAppStore()
  const [list, setList] = useState<Accommodation[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')

  const [mode, setMode] = useState<Mode>('list')
  const [editing, setEditing] = useState<Accommodation | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id
    const [aRes, rRes] = await Promise.all([
      supabase.from('accommodation').select('*').eq('project_id', pid).order('check_in'),
      supabase.from('resources').select('id,name,role').eq('project_id', pid).order('name'),
    ])
    setList((aRes.data || []) as Accommodation[])
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

  function openEdit(a: Accommodation) {
    setEditing(a)
    setForm({
      property: a.property || '',
      room: a.room || '',
      vendor: a.vendor || '',
      check_in: a.check_in || '',
      check_out: a.check_out || '',
      nights: a.nights || nightsBetween(a.check_in || '', a.check_out || ''),
      occupant_ids: (a.occupants as string[]) || [],
      notes: a.notes || '',
    })
    setMode('edit')
  }

  function closeSheet() {
    if (saving) return
    setMode('list')
    setEditing(null)
  }

  function setDate(field: 'check_in' | 'check_out', value: string) {
    setForm(f => {
      const next = { ...f, [field]: value }
      next.nights = nightsBetween(next.check_in, next.check_out)
      return next
    })
  }

  function toggleOccupant(id: string) {
    setForm(f => ({
      ...f,
      occupant_ids: f.occupant_ids.includes(id)
        ? f.occupant_ids.filter(x => x !== id)
        : [...f.occupant_ids, id],
    }))
  }

  async function save() {
    if (!form.property.trim()) { toast('Property required', 'error'); return }
    if (!activeProject) return
    setSaving(true)
    const payload = {
      project_id: activeProject.id,
      property: form.property.trim(),
      room: form.room.trim(),
      vendor: form.vendor.trim(),
      check_in: form.check_in || null,
      check_out: form.check_out || null,
      nights: form.nights || 0,
      occupants: form.occupant_ids,
      notes: form.notes,
    }
    let err
    if (mode === 'new') {
      ({ error: err } = await supabase.from('accommodation').insert(payload))
    } else if (editing) {
      ({ error: err } = await supabase.from('accommodation').update(payload).eq('id', editing.id))
    }
    setSaving(false)
    if (err) { toast(err.message, 'error'); return }
    toast(mode === 'new' ? 'Booking added' : 'Saved', 'success')
    closeSheet()
    load()
  }

  async function deleteBooking() {
    if (!editing) return
    if (!confirm(`Delete "${editing.property} — ${editing.room}"?`)) return
    setSaving(true)
    await supabase.from('accommodation').delete().eq('id', editing.id)
    setSaving(false)
    toast('Deleted', 'info')
    closeSheet()
    load()
  }

  // Filter + search
  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => list.filter(a => {
    if (filter !== 'all' && getStatus(a) !== filter) return false
    if (!q) return true
    const occNames = ((a.occupants as string[]) || [])
      .map(id => resMap[id]?.name || '')
      .join(' ').toLowerCase()
    return (a.property || '').toLowerCase().includes(q)
        || (a.room || '').toLowerCase().includes(q)
        || (a.vendor || '').toLowerCase().includes(q)
        || occNames.includes(q)
  }), [list, resMap, filter, q])

  // Group by week of check-in
  const grouped = useMemo(() => {
    const groups: Record<string, Accommodation[]> = {}
    for (const a of filtered) {
      const k = a.check_in ? weekStartIso(a.check_in) : 'No check-in'
      if (!groups[k]) groups[k] = []
      groups[k].push(a)
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'No check-in') return 1
      if (b === 'No check-in') return -1
      return a < b ? -1 : 1
    })
  }, [filtered])

  const statusCounts = useMemo(() => {
    const c = { current: 0, upcoming: 0, past: 0, unscheduled: 0 }
    for (const a of list) c[getStatus(a)]++
    return c
  }, [list])

  return (
    <>
      <MobilePanelHeader
        title="Accommodation"
        subtitle={`${list.length} booking${list.length === 1 ? '' : 's'}`}
      />

      {/* Status filter chips */}
      <div className="mobile-filter-chips">
        <button className={`mobile-chip ${filter === 'all' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('all')}>All ({list.length})</button>
        <button className={`mobile-chip ${filter === 'current' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('current')}>Current ({statusCounts.current})</button>
        <button className={`mobile-chip ${filter === 'upcoming' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('upcoming')}>Upcoming ({statusCounts.upcoming})</button>
        <button className={`mobile-chip ${filter === 'past' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('past')}>Past ({statusCounts.past})</button>
      </div>

      <div style={{ padding: '10px 14px', background: 'var(--bg)' }}>
        <MobileSearchBar value={search} onChange={setSearch} placeholder="Property, vendor, occupant…" />
      </div>

      {loading ? (
        <div className="mobile-loading"><span className="spinner" /> Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="mobile-empty">
          <div className="mobile-empty-icon">🏨</div>
          <h3>{q ? 'No matches' : 'No bookings yet'}</h3>
          <p>{q ? 'Try a different search.' : 'Tap + to add the first booking.'}</p>
        </div>
      ) : (
        <div className="mobile-list">
          {grouped.map(([weekIso, items]) => (
            <div key={weekIso}>
              <div className="mobile-section-header">{fmtWeekHeader(weekIso)}</div>
              {items.map(a => {
                const status = getStatus(a)
                const occupants = ((a.occupants as string[]) || [])
                  .map(id => resMap[id]?.name)
                  .filter(Boolean) as string[]
                return (
                  <button
                    key={a.id}
                    className="mobile-card mobile-accom-card"
                    onClick={() => openEdit(a)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{a.property || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                          {a.room ? a.room + ' · ' : ''}{a.vendor || 'No vendor'}
                        </div>
                      </div>
                      <span className={`mobile-status-pill mobile-status-${status}`}>{status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                      {a.check_in
                        ? `${fmtDate(a.check_in)} → ${fmtDate(a.check_out || '')} · ${a.nights || nightsBetween(a.check_in, a.check_out || '')} nights`
                        : 'Dates not set'}
                    </div>
                    {occupants.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {occupants.slice(0, 3).map((n, i) => (
                          <span key={i} className="mobile-occupant-chip">{n}</span>
                        ))}
                        {occupants.length > 3 && (
                          <span className="mobile-occupant-chip mobile-occupant-chip-more">+{occupants.length - 3}</span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        type="button"
        className="mobile-fab"
        onClick={openNew}
        aria-label="Add booking"
      >
        +
      </button>

      {/* Edit / new sheet */}
      <MobileBottomSheet
        open={mode !== 'list'}
        onClose={closeSheet}
        title={mode === 'new' ? 'New booking' : 'Edit booking'}
        preventBackdropClose={saving}
        height="full"
        footer={(
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: 48 }}
                onClick={deleteBooking}
                disabled={saving}
                title="Delete booking"
              >
                🗑
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, height: 48, fontWeight: 600 }}
              onClick={save}
              disabled={saving || !form.property.trim()}
            >
              {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (mode === 'new' ? 'Add booking' : 'Save')}
            </button>
          </div>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="mobile-form-label">Property *</label>
            <input
              className="input"
              value={form.property}
              onChange={e => setForm(f => ({ ...f, property: e.target.value }))}
              placeholder="Hotel / lodge / camp"
              style={{ width: '100%', height: 44 }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Room</label>
              <input
                className="input"
                value={form.room}
                onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
                placeholder="101"
                style={{ width: '100%', height: 44 }}
              />
            </div>
            <div>
              <label className="mobile-form-label">Vendor</label>
              <input
                className="input"
                value={form.vendor}
                onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                placeholder="Booking source"
                style={{ width: '100%', height: 44 }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Check in</label>
              <input
                type="date"
                className="input"
                value={form.check_in}
                onChange={e => setDate('check_in', e.target.value)}
                style={{ width: '100%', height: 44 }}
              />
            </div>
            <div>
              <label className="mobile-form-label">Check out</label>
              <input
                type="date"
                className="input"
                value={form.check_out}
                onChange={e => setDate('check_out', e.target.value)}
                style={{ width: '100%', height: 44 }}
              />
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Nights</label>
            <MobileQtyStepper value={form.nights} onChange={n => setForm(f => ({ ...f, nights: n }))} min={0} />
          </div>

          <div>
            <label className="mobile-form-label">Occupants ({form.occupant_ids.length})</label>
            <div className="mobile-occupant-picker">
              {resources.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', padding: '10px' }}>No resources in this project.</div>
              ) : resources.map(r => {
                const checked = form.occupant_ids.includes(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`mobile-occupant-row ${checked ? 'mobile-occupant-row-checked' : ''}`}
                    onClick={() => toggleOccupant(r.id)}
                  >
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text)' }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>{r.role || ''}</span>
                    </span>
                    {checked && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Notes</label>
            <textarea
              className="input"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Booking notes"
              rows={3}
              style={{ width: '100%', resize: 'vertical', minHeight: 60 }}
            />
          </div>

          {/* Note about desktop-only fields when editing existing */}
          {mode === 'edit' && editing && (
            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
              💡 Cost, GM %, PO links, and customer pricing must be edited on desktop.
              {editing.total_cost ? <> Current cost: <strong style={{ color: 'var(--text)' }}>${Number(editing.total_cost).toLocaleString('en-AU')}</strong>.</> : null}
            </div>
          )}
        </div>
      </MobileBottomSheet>
    </>
  )
}
