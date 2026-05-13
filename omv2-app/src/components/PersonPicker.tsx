/**
 * PersonPicker.tsx
 * Shared component for adding a person anywhere in the system.
 * Search existing persons → select → or create a new record inline.
 *
 * Usage:
 *   <PersonPicker
 *     onSelect={(person) => { ... link person to resource/slot/etc }}
 *     onClose={() => setShowPicker(false)}
 *     defaultCategory="trades"
 *     context="Adding to Stanwell U3"
 *   />
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { searchPersons, findOrCreatePerson, type Person } from '../lib/persons'
import { toast } from './ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonPickerProps {
  onSelect: (person: Person, isNew: boolean) => void
  onClose: () => void
  defaultCategory?: 'trades' | 'management' | 'seag' | 'subcontractor'
  defaultRole?: string
  context?: string                    // e.g. "Adding to Stanwell U3 — Mechanical Fitter DS"
  filterCategory?: string             // if set, filters search results by category
  title?: string
}

const CATEGORIES = ['trades', 'management', 'seag', 'subcontractor'] as const

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

const BLANK_CREATE = {
  full_name: '',
  email: '',
  phone: '',
  company: '',
  default_role: '',
  default_category: 'trades' as const,
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PersonResult({
  person,
  onSelect,
}: {
  person: Person
  onSelect: (p: Person) => void
}) {
  const cat = person.default_category
  const catStyle = cat ? (CAT_STYLE[cat] ?? { bg: 'var(--bg3)', color: 'var(--text3)' }) : null

  return (
    <button
      onClick={() => onSelect(person)}
      style={{
        width: '100%', textAlign: 'left', padding: '10px 14px',
        background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-light)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {/* Avatar initial */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: catStyle?.bg ?? 'var(--bg3)',
        color: catStyle?.color ?? 'var(--text3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700,
      }}>
        {person.full_name.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{person.full_name}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {person.default_role && (
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>{person.default_role}</span>
          )}
          {cat && catStyle && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, ...catStyle, textTransform: 'capitalize' }}>
              {cat}
            </span>
          )}
          {person.company && (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{person.company}</span>
          )}
          {person.email && (
            <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{person.email}</span>
          )}
        </div>
      </div>
      {person.gid && (
        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', flexShrink: 0 }}>
          {person.gid}
        </span>
      )}
      <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0 }}>›</span>
    </button>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PersonPicker({
  onSelect,
  onClose,
  defaultCategory = 'trades',
  defaultRole = '',
  context,
  filterCategory,
  title = 'Add Person',
}: PersonPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Person[]>([])
  const [searching, setSearching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    ...BLANK_CREATE,
    default_category: defaultCategory,
    default_role: defaultRole,
  })
  const [creating, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus()
    // Show all active persons initially
    doSearch('')
  }, [])

  const doSearch = useCallback(async (q: string) => {
    setSearching(true)
    const res = await searchPersons(q, 20)
    const filtered = filterCategory
      ? res.filter((p: Person) => p.default_category === filterCategory)
      : res
    setResults(filtered)
    setSearching(false)
  }, [filterCategory])

  function handleQueryChange(q: string) {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q), 200)
  }

  function handleSelect(person: Person) {
    onSelect(person, false)
    onClose()
  }

  async function handleCreate() {
    if (!createForm.full_name.trim()) return toast('Name is required', 'error')
    setSaving(true)
    try {
      const result = await findOrCreatePerson({
        full_name: createForm.full_name.trim(),
        email: createForm.email || null,
        phone: createForm.phone || null,
        company: createForm.company || null,
        default_role: createForm.default_role || null,
        default_category: createForm.default_category,
      })
      if (!result.created && result.matched_by !== 'created') {
        // Found an existing person — ask to use them
        if (confirm(`Found existing record: "${result.person.full_name}". Use this person?`)) {
          onSelect(result.person, false)
          onClose()
        } else {
          setSaving(false)
          return
        }
      } else {
        toast(`Created new person: ${result.person.full_name}`, 'success')
        onSelect(result.person, true)
        onClose()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create person', 'error')
    }
    setSaving(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 520, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 64px)',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        zIndex: 1001,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '14px 16px', background: 'var(--bg2)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
            {context && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{context}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="btn btn-sm btn-secondary"
            style={{ flexShrink: 0, padding: '3px 8px' }}
          >✕</button>
        </div>

        {!showCreate ? (
          <>
            {/* Search */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 14, color: 'var(--text3)', pointerEvents: 'none',
                }}>⌕</span>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Search by name, email, company, GID…"
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  style={{
                    width: '100%', paddingLeft: 28, fontSize: 13,
                    fontFamily: 'var(--sans)', border: '1px solid var(--border2)',
                    borderRadius: 'var(--radius)', padding: '7px 10px 7px 28px',
                    background: 'var(--bg3)', color: 'var(--text)', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border2)')}
                />
              </div>
              {filterCategory && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
                  Filtered to: <span style={{ ...CAT_STYLE[filterCategory], fontWeight: 600, padding: '1px 5px', borderRadius: 3, textTransform: 'capitalize' }}>{filterCategory}</span>
                </div>
              )}
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {searching ? (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <span className="spinner" style={{ width: 18, height: 18 }} />
                </div>
              ) : results.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>👤</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>
                    {query ? `No results for "${query}"` : 'No people found'}
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 12 }}>
                    {query ? 'Try a different search, or create a new record below.' : 'Create a new person record to get started.'}
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    setCreateForm(f => ({ ...f, full_name: query }))
                    setShowCreate(true)
                  }}>
                    + Create "{query || 'new person'}"
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ padding: '6px 14px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {results.length} {results.length === 1 ? 'person' : 'people'} found
                  </div>
                  {results.map(p => (
                    <PersonResult key={p.id} person={p} onSelect={handleSelect} />
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '10px 14px', borderTop: '1px solid var(--border)',
              background: 'var(--bg2)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                Not in the list?
              </span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setCreateForm(f => ({ ...f, full_name: query }))
                  setShowCreate(true)
                }}
              >
                + Create new person
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Create form */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <div style={{
                background: 'var(--accent-light)', border: '1px solid var(--accent)',
                borderRadius: 'var(--radius)', padding: '8px 12px', marginBottom: 14,
                fontSize: 12, color: 'var(--accent)', fontWeight: 500,
              }}>
                Creating a new person record. They'll be searchable in future for any project.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Full name */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
                    Full Name *
                  </label>
                  <input
                    className="input"
                    autoFocus
                    value={createForm.full_name}
                    onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="e.g. John Smith"
                  />
                </div>

                {/* Category */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
                    Category
                  </label>
                  <select
                    className="input"
                    value={createForm.default_category}
                    onChange={e => setCreateForm(f => ({ ...f, default_category: e.target.value as typeof CATEGORIES[number] }))}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Default role */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
                    Default Role
                  </label>
                  <input
                    className="input"
                    value={createForm.default_role}
                    onChange={e => setCreateForm(f => ({ ...f, default_role: e.target.value }))}
                    placeholder="e.g. Mechanical Fitter"
                  />
                </div>

                {/* Company */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
                    Company
                  </label>
                  <input
                    className="input"
                    value={createForm.company}
                    onChange={e => setCreateForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="e.g. Acme Contracting"
                  />
                </div>

                {/* Email */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
                    Email
                  </label>
                  <input
                    className="input"
                    type="email"
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="john@example.com"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
                    Phone
                  </label>
                  <input
                    className="input"
                    type="tel"
                    value={createForm.phone}
                    onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="0400 000 000"
                  />
                </div>
              </div>

              {/* Contractor note */}
              {createForm.default_category === 'subcontractor' && (
                <div style={{
                  marginTop: 12, padding: '8px 12px',
                  background: '#fef3c7', border: '1px solid #fbbf24',
                  borderRadius: 'var(--radius)', fontSize: 12, color: '#92400e',
                }}>
                  💡 Contractor records are searchable across all future projects. Their inductions will be matched automatically when a PM uploads the SE Learning register.
                </div>
              )}
            </div>

            {/* Create footer */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border)',
              background: 'var(--bg2)', flexShrink: 0,
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !createForm.full_name.trim()}
              >
                {creating ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
                Create & add person
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowCreate(false)}>
                ← Back to search
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
