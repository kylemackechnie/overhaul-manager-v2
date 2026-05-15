import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileFilterBar, type FilterChip } from '../../components/mobile/ui/MobileFilterBar'
import { MobileSearchBar, MobileFAB } from '../../components/mobile/ui/MobileSearchBar'
import { MobileCard } from '../../components/mobile/ui/MobileCard'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { MobileQtyStepper } from '../../components/mobile/ui/MobileQtyStepper'
import { useRegisterRefresh } from '../../components/mobile/ui/RefreshContext'
import type { Resource } from '../../types'

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  onsite:   { bg: '#d1fae5', color: '#065f46', label: 'On-site' },
  incoming: { bg: '#fef3c7', color: '#92400e', label: 'Incoming' },
  upcoming: { bg: '#dbeafe', color: '#1e40af', label: 'Upcoming' },
  departed: { bg: '#f1f5f9', color: '#64748b', label: 'Departed' },
  future:   { bg: '#f3e8ff', color: '#6b21a8', label: 'Future' },
  unknown:  { bg: '#f1f5f9', color: '#94a3b8', label: 'No dates' },
}

const STATUS_ACCENT: Record<string, string> = {
  onsite: '#10b981', incoming: '#f59e0b', upcoming: '#3b82f6',
  departed: '#94a3b8', future: '#a855f7', unknown: '#cbd5e1',
}

function resourceStatus(r: Resource): 'onsite'|'incoming'|'upcoming'|'departed'|'future'|'unknown' {
  const today = new Date().toISOString().slice(0,10)
  if (!r.mob_in) return 'unknown'
  if (r.mob_out && r.mob_out < today) return 'departed'
  if (r.mob_in <= today && (!r.mob_out || r.mob_out >= today)) return 'onsite'
  const daysOut = (new Date(r.mob_in).getTime() - new Date(today).getTime()) / 86400000
  if (daysOut <= 7) return 'incoming'
  if (daysOut <= 30) return 'upcoming'
  return 'future'
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function categoryLabel(c: string): string {
  return c === 'management' ? 'Mgmt'
    : c === 'subcontractor' ? 'Subcon'
    : c === 'seag' ? 'SE AG'
    : c.charAt(0).toUpperCase() + c.slice(1)
}

// ════════════════════════════════════════════════════════════════════════
// Mobile edit form — only the fields a site sup / PM needs in the field.
// Advanced fields (rate card, shift phases, WBS, PO link, transport, etc.)
// stay desktop-only and are flagged in the sheet as such.
// ════════════════════════════════════════════════════════════════════════

interface FormState {
  name: string
  role: string
  category: Resource['category']
  shift: Resource['shift']
  company: string
  phone: string
  email: string
  mob_in: string
  mob_out: string
  travel_days: number
  allow_laha: boolean
  allow_meal: boolean
  allow_fsa: boolean
  notes: string
}

const EMPTY: FormState = {
  name: '', role: '', category: 'trades', shift: 'day',
  company: '', phone: '', email: '',
  mob_in: '', mob_out: '', travel_days: 0,
  allow_laha: false, allow_meal: false, allow_fsa: false,
  notes: '',
}

function fromResource(r: Resource): FormState {
  return {
    name: r.name || '',
    role: r.role || '',
    category: r.category || 'trades',
    shift: r.shift || 'day',
    company: r.company || '',
    phone: r.phone || '',
    email: r.email || '',
    mob_in: r.mob_in || '',
    mob_out: r.mob_out || '',
    travel_days: r.travel_days || 0,
    allow_laha: !!r.allow_laha,
    allow_meal: !!r.allow_meal,
    allow_fsa: !!r.allow_fsa,
    notes: r.notes || '',
  }
}

interface Props {
  resources: Resource[]
  loading: boolean
  search: string
  onSearchChange: (v: string) => void
  catFilter: string
  onCatFilterChange: (v: string) => void
  statusFilter: string
  onStatusFilterChange: (v: string) => void
  /** Called after any save/delete so the parent reloads the list */
  onChange: () => void
  canWrite: boolean
  /** project_id used for INSERT */
  projectId: string
}

export function ResourcesMobile({
  resources, loading, search, onSearchChange,
  catFilter, onCatFilterChange,
  statusFilter, onStatusFilterChange,
  onChange, canWrite, projectId,
}: Props) {

  // Pull-to-refresh: reload the parent panel's data via onChange
  useRegisterRefresh(onChange)

  // Edit / new sheet state — owned by mobile, doesn't touch desktop modal
  const [mode, setMode]       = useState<'list' | 'edit' | 'new'>('list')
  const [editing, setEditing] = useState<Resource | null>(null)
  const [form, setForm]       = useState<FormState>(EMPTY)
  const [saving, setSaving]   = useState(false)

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setMode('new')
  }

  function openEdit(r: Resource) {
    setEditing(r)
    setForm(fromResource(r))
    setMode('edit')
  }

  function closeSheet() {
    if (saving) return
    setMode('list')
    setEditing(null)
  }

  async function save() {
    if (!form.name.trim()) { toast('Name required', 'error'); return }
    if (!form.role.trim()) { toast('Role required', 'error'); return }
    setSaving(true)
    // Build payload — only the mobile-editable fields. Other fields keep
    // their existing values from the DB row (we don't overwrite them).
    const payload = {
      project_id: projectId,
      name: form.name.trim(),
      role: form.role.trim(),
      category: form.category,
      shift: form.shift,
      company: form.company.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      mob_in: form.mob_in || null,
      mob_out: form.mob_out || null,
      travel_days: form.travel_days || 0,
      allow_laha: form.allow_laha,
      allow_meal: form.allow_meal,
      allow_fsa: form.allow_fsa,
      notes: form.notes,
    }
    let err
    if (mode === 'new') {
      ({ error: err } = await supabase.from('resources').insert(payload))
    } else if (editing) {
      ({ error: err } = await supabase.from('resources').update(payload).eq('id', editing.id))
    }
    setSaving(false)
    if (err) { toast(err.message, 'error'); return }
    toast(mode === 'new' ? 'Person added' : 'Saved', 'success')
    closeSheet()
    onChange()
  }

  async function deletePerson() {
    if (!editing) return
    if (!confirm(`Delete "${editing.name}"? This will also remove timesheets, accom occupancies, and any other links.`)) return
    setSaving(true)
    const { error } = await supabase.from('resources').delete().eq('id', editing.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Deleted', 'info')
    closeSheet()
    onChange()
  }

  // Filter pipeline — must match desktop
  const filtered = useMemo(() => {
    return resources
      .filter(r => catFilter === 'all' || r.category === catFilter)
      .filter(r => statusFilter === 'all' || resourceStatus(r) === statusFilter)
      .filter(r => !search || [r.name, r.role, r.company || '', r.email || '']
        .some(f => f.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => {
        const order: Record<string, number> = {onsite:0, incoming:1, upcoming:2, future:3, departed:4, unknown:5}
        const sa = order[resourceStatus(a)] ?? 9
        const sb = order[resourceStatus(b)] ?? 9
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name)
      })
  }, [resources, catFilter, statusFilter, search])

  // Status chips with counts (counts BEFORE status filter applied)
  const statusChips: FilterChip[] = useMemo(() => {
    const base = resources
      .filter(r => catFilter === 'all' || r.category === catFilter)
      .filter(r => !search || [r.name, r.role, r.company || '', r.email || '']
        .some(f => f.toLowerCase().includes(search.toLowerCase())))
    const c: Record<string, number> = { onsite:0, incoming:0, upcoming:0, departed:0, future:0, unknown:0 }
    for (const r of base) c[resourceStatus(r)]++
    return [
      { id: 'all',      label: `All (${base.length})` },
      { id: 'onsite',   label: `On-site (${c.onsite})` },
      { id: 'incoming', label: `Incoming (${c.incoming})` },
      { id: 'upcoming', label: `Upcoming (${c.upcoming})` },
      { id: 'future',   label: `Future (${c.future})` },
      { id: 'departed', label: `Departed (${c.departed})` },
      { id: 'unknown',  label: `No dates (${c.unknown})` },
    ]
  }, [resources, catFilter, search])

  const catChips: FilterChip[] = useMemo(() => {
    const c: Record<string, number> = { trades:0, management:0, seag:0, subcontractor:0 }
    for (const r of resources) c[r.category] = (c[r.category] || 0) + 1
    return [
      { id: 'all',           label: `All (${resources.length})` },
      { id: 'trades',        label: `Trades (${c.trades})` },
      { id: 'management',    label: `Mgmt (${c.management})` },
      { id: 'seag',          label: `SE AG (${c.seag})` },
      { id: 'subcontractor', label: `Subcon (${c.subcontractor})` },
    ]
  }, [resources])

  return (
    <>
      <MobilePanelHeader title="Resources" subtitle={`${resources.length} people`} />

      <MobileFilterBar chips={catChips} active={catFilter} onChange={onCatFilterChange} />
      <MobileFilterBar chips={statusChips} active={statusFilter} onChange={onStatusFilterChange} />

      <div style={{ padding: '10px 14px', background: 'var(--bg)' }}>
        <MobileSearchBar value={search} onChange={onSearchChange} placeholder="Name, role, company, email…" />
      </div>

      {loading ? (
        <div className="mobile-loading"><span className="spinner" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <div className="mobile-empty-icon">👤</div>
          <h3>{search ? 'No matches' : 'No resources'}</h3>
          <p>{search ? 'Try a different search.' : 'Tap + to add the first person.'}</p>
        </div>
      ) : (
        <div className="mobile-list">
          {filtered.map(r => {
            const status = resourceStatus(r)
            const sty = STATUS_STYLE[status]
            const accent = STATUS_ACCENT[status]
            const dateStr = r.mob_in || r.mob_out
              ? `${fmtDate(r.mob_in)} → ${fmtDate(r.mob_out)}`
              : 'No dates set'
            const allowFlags: string[] = []
            if (r.allow_laha) allowFlags.push('LAHA')
            if (r.allow_meal) allowFlags.push('Meal')
            if (r.allow_fsa)  allowFlags.push('FSA')

            return (
              <MobileCard
                key={r.id}
                accent={accent}
                title={r.name || '(no name)'}
                subtitle={
                  <>
                    {r.role || '—'}
                    {r.company && ` · ${r.company}`}
                    {r.shift && r.shift !== 'day' && ` · ${r.shift} shift`}
                  </>
                }
                meta={
                  <span className="mobile-pill" style={{ background: sty.bg, color: sty.color }}>
                    {sty.label}
                  </span>
                }
                metaSub={dateStr}
                footer={allowFlags.length > 0 ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {allowFlags.map(f => (
                      <span key={f} style={{
                        fontSize: 10, padding: '2px 6px',
                        background: 'var(--bg3)', border: '1px solid var(--border)',
                        borderRadius: 4, color: 'var(--text2)', fontWeight: 500,
                      }}>{f}</span>
                    ))}
                    {r.category && (
                      <span style={{
                        fontSize: 10, padding: '2px 6px',
                        background: 'var(--accent-light)', border: '1px solid var(--accent)',
                        borderRadius: 4, color: 'var(--accent2)', fontWeight: 500,
                      }}>{categoryLabel(r.category)}</span>
                    )}
                  </div>
                ) : (r.category ? (
                  <div>
                    <span style={{
                      fontSize: 10, padding: '2px 6px',
                      background: 'var(--accent-light)', border: '1px solid var(--accent)',
                      borderRadius: 4, color: 'var(--accent2)', fontWeight: 500,
                    }}>{categoryLabel(r.category)}</span>
                  </div>
                ) : undefined)}
                onClick={() => openEdit(r)}
              />
            )
          })}
        </div>
      )}

      {canWrite && <MobileFAB icon="+" label="Person" onClick={openNew} />}

      {/* Mobile edit / new sheet */}
      <MobileBottomSheet
        open={mode !== 'list'}
        onClose={closeSheet}
        title={mode === 'new' ? 'New person' : (editing?.name || 'Edit person')}
        preventBackdropClose={saving}
        height="full"
        footer={(
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'edit' && canWrite && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: 48 }}
                onClick={deletePerson}
                disabled={saving}
                title="Delete person"
              >
                🗑
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, height: 48, fontWeight: 600 }}
              onClick={save}
              disabled={saving || !form.name.trim() || !form.role.trim() || !canWrite}
            >
              {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (mode === 'new' ? 'Add person' : 'Save')}
            </button>
          </div>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!canWrite && (
            <div style={{ fontSize: 12, color: 'var(--amber)', padding: '8px 10px', background: '#fef3c7', borderRadius: 6 }}>
              You don't have write permission. Fields are read-only.
            </div>
          )}

          <div>
            <label className="mobile-form-label">Full name *</label>
            <input
              className="input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Anton Martin"
              style={{ width: '100%', height: 44 }}
              disabled={!canWrite}
              autoFocus={mode === 'new'}
            />
          </div>

          <div>
            <label className="mobile-form-label">Role *</label>
            <input
              className="input"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              placeholder="e.g. QA / Project Engineer"
              style={{ width: '100%', height: 44 }}
              disabled={!canWrite}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Category</label>
              <select
                className="input"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as FormState['category'] }))}
                style={{ width: '100%', height: 44 }}
                disabled={!canWrite}
              >
                <option value="trades">Trades</option>
                <option value="management">Management</option>
                <option value="seag">SE AG</option>
                <option value="subcontractor">Subcontractor</option>
              </select>
            </div>
            <div>
              <label className="mobile-form-label">Shift</label>
              <select
                className="input"
                value={form.shift}
                onChange={e => setForm(f => ({ ...f, shift: e.target.value as FormState['shift'] }))}
                style={{ width: '100%', height: 44 }}
                disabled={!canWrite}
              >
                <option value="day">Day</option>
                <option value="night">Night</option>
                <option value="both">Both / mixed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Company</label>
            <input
              className="input"
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              placeholder="Siemens Energy, etc."
              style={{ width: '100%', height: 44 }}
              disabled={!canWrite}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Phone</label>
              <input
                type="tel"
                className="input"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                style={{ width: '100%', height: 44 }}
                disabled={!canWrite}
              />
            </div>
            <div>
              <label className="mobile-form-label">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                style={{ width: '100%', height: 44 }}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={!canWrite}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Mob in</label>
              <input
                type="date"
                className="input"
                value={form.mob_in}
                onChange={e => setForm(f => ({ ...f, mob_in: e.target.value }))}
                style={{ width: '100%', height: 44 }}
                disabled={!canWrite}
              />
            </div>
            <div>
              <label className="mobile-form-label">Mob out</label>
              <input
                type="date"
                className="input"
                value={form.mob_out}
                onChange={e => setForm(f => ({ ...f, mob_out: e.target.value }))}
                style={{ width: '100%', height: 44 }}
                disabled={!canWrite}
              />
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Travel days</label>
            <MobileQtyStepper
              value={form.travel_days}
              onChange={n => setForm(f => ({ ...f, travel_days: n }))}
              min={0}
              max={30}
              disabled={!canWrite}
            />
          </div>

          <div>
            <label className="mobile-form-label">Allowances</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`mobile-toggle-pill ${form.allow_laha ? 'mobile-toggle-pill-on' : ''}`}
                onClick={() => canWrite && setForm(f => ({ ...f, allow_laha: !f.allow_laha }))}
                disabled={!canWrite}
              >
                {form.allow_laha ? '✓' : '○'} LAHA
              </button>
              <button
                type="button"
                className={`mobile-toggle-pill ${form.allow_meal ? 'mobile-toggle-pill-on' : ''}`}
                onClick={() => canWrite && setForm(f => ({ ...f, allow_meal: !f.allow_meal }))}
                disabled={!canWrite}
              >
                {form.allow_meal ? '✓' : '○'} Meal
              </button>
              <button
                type="button"
                className={`mobile-toggle-pill ${form.allow_fsa ? 'mobile-toggle-pill-on' : ''}`}
                onClick={() => canWrite && setForm(f => ({ ...f, allow_fsa: !f.allow_fsa }))}
                disabled={!canWrite}
              >
                {form.allow_fsa ? '✓' : '○'} FSA
              </button>
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Notes</label>
            <textarea
              className="input"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              style={{ width: '100%', resize: 'vertical', minHeight: 60 }}
              disabled={!canWrite}
            />
          </div>

          {mode === 'edit' && editing && (
            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
              💡 Rate card, shift phases, WBS, PO links, and transport must be edited on desktop.
              {editing.rate_card_id ? <> Currently has a rate card assigned.</> : <> No rate card assigned.</>}
            </div>
          )}
        </div>
      </MobileBottomSheet>
    </>
  )
}
