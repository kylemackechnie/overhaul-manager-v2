/**
 * PersonProfileDrawer.tsx — redesigned to match OMV2 design language.
 * Right-side drawer: Details | Inductions | Visas | Assets | History
 * All CSS via var(--) variables and inline styles. No Tailwind.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import { usePermissions } from '../../lib/permissions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonFull {
  id: string
  full_name: string
  legal_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  gid: string | null
  default_role: string | null
  default_category: string | null
  status: string | null
  home_address: string | null
  induction_ehs_date: string | null
  induction_qual_date: string | null
  induction_notes: string | null
  medical_date: string | null
  medical_notes: string | null
  availability_notes: string | null
  notes: string | null
}

interface Visa {
  id: string
  country: string | null
  visa_type: string | null
  project_name: string | null
  from_date: string | null
  to_date: string | null
  current_status: string | null
}

interface Asset {
  id: string
  asset_type: string
  asset_number: string | null
  asset_status: string | null
  start_date: string | null
  first_project: string | null
  notes: string | null
}

interface Deployment {
  id: string
  mob_in: string | null
  mob_out: string | null
  role: string | null
  project_id: string | null
  projects: { id: string; name: string; client: string | null }[] | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function inductionLight(date: string | null): 'current' | 'expiring' | 'expired' | 'missing' {
  if (!date) return 'missing'
  const d = new Date(date)
  const now = new Date()
  if (d < now) return 'expired'
  if ((d.getTime() - now.getTime()) / 86400000 < 90) return 'expiring'
  return 'current'
}

const IND_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  current:  { bg: '#d1fae5', color: '#065f46', label: 'Current' },
  expiring: { bg: '#fef3c7', color: '#92400e', label: 'Expiring' },
  expired:  { bg: '#fee2e2', color: '#991b1b', label: 'Expired' },
  missing:  { bg: 'var(--bg3)', color: 'var(--text3)', label: 'Missing' },
}

function IndBadge({ date }: { date: string | null }) {
  const s = inductionLight(date)
  const { bg, color, label } = IND_STYLE[s]
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: bg, color, fontFamily: 'var(--mono)' }}>
      {date ? fmtDate(date) : label}
    </span>
  )
}

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#ede9fe', color: '#5b21b6' },
  seag:          { bg: '#ffedd5', color: '#9a3412' },
  subcontractor: { bg: '#d1fae5', color: '#065f46' },
}

// ── Editable field ────────────────────────────────────────────────────────────

function EditField({ label, value, field, personId, onUpdated, type = 'text', options }: {
  label: string
  value: string | null
  field: string
  personId: string
  onUpdated: (field: string, value: string | null) => void
  type?: 'text' | 'date' | 'select' | 'textarea'
  options?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const { canWrite } = usePermissions()

  async function save() {
    const val = draft.trim() || null
    const { error } = await supabase.from('persons').update({ [field]: val }).eq('id', personId)
    if (error) { toast('Save failed: ' + error.message, 'error'); return }
    onUpdated(field, val)
    setEditing(false)
    toast('Saved', 'success')
  }

  const labelEl = (
    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
      {label}
    </div>
  )

  if (!canWrite('personnel')) {
    return (
      <div>
        {labelEl}
        <div style={{ fontSize: 12, color: 'var(--text)' }}>{value || <span style={{ color: 'var(--text3)' }}>—</span>}</div>
      </div>
    )
  }

  if (!editing) {
    return (
      <div>
        {labelEl}
        <div
          onClick={() => { setDraft(value || ''); setEditing(true) }}
          style={{
            fontSize: 12, color: value ? 'var(--text)' : 'var(--text3)',
            cursor: 'pointer', padding: '4px 6px', marginLeft: -6, borderRadius: 4,
            border: '1px solid transparent',
            fontStyle: value ? 'normal' : 'italic',
            transition: 'border-color 0.1s, background 0.1s',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = 'var(--border2)'
            el.style.background = 'var(--bg3)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = 'transparent'
            el.style.background = 'transparent'
          }}
        >
          {value || 'click to edit'}
        </div>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 12, fontFamily: 'var(--sans)',
    border: '1px solid var(--accent)', borderRadius: 4,
    padding: '5px 7px', background: 'var(--bg)',
    color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div>
      {labelEl}
      {type === 'select' && options ? (
        <select autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} style={inputStyle}>
          <option value="">—</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
          rows={3} style={{ ...inputStyle, resize: 'vertical' }}
        />
      ) : (
        <input
          autoFocus type={type} value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          style={inputStyle}
        />
      )}
    </div>
  )
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ label, active, badge, onClick }: {
  id?: string; label: string; active: boolean; badge?: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px', fontSize: 11, fontWeight: 600,
        background: 'none', border: 'none', cursor: 'pointer',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--accent)' : 'var(--text3)',
        transition: 'color 0.1s',
        display: 'flex', alignItems: 'center', gap: 5,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {label}
      {badge != null && badge > 0 && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
          background: active ? 'var(--accent)' : 'var(--bg3)',
          color: active ? '#fff' : 'var(--text3)',
          fontFamily: 'var(--mono)',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10,
    }}>
      {title && (
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
      {children}
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────

type Tab = 'details' | 'inductions' | 'visas' | 'assets' | 'history'

interface Props {
  personId: string
  onClose: () => void
  onNavigateToProject?: (projectId: string) => void
}

export function PersonProfileDrawer({ personId, onClose, onNavigateToProject }: Props) {
  const [person, setPerson] = useState<PersonFull | null>(null)
  const [visas, setVisas] = useState<Visa[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [tab, setTab] = useState<Tab>('details')
  const [loading, setLoading] = useState(true)
  const [registerCourses, setRegisterCourses] = useState<{ course_key: string; status: string; expiry_date: string | null }[]>([])
  const [registerLessons, setRegisterLessons] = useState<{ lesson_key: string; status: string; expiry_date: string | null }[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('persons').select('*').eq('id', personId).single(),
      supabase.from('person_visas').select('*').eq('person_id', personId).order('from_date', { ascending: false }),
      supabase.from('person_assets').select('*').eq('person_id', personId),
      supabase.from('resources')
        .select('id,mob_in,mob_out,role,project_id,projects(id,name,client)')
        .eq('person_id', personId)
        .order('mob_in', { ascending: false }),
      supabase.from('induction_courses').select('course_key, status, expiry_date').eq('person_id', personId),
      supabase.from('induction_lessons').select('lesson_key, status, expiry_date').eq('person_id', personId),
    ]).then(([p, v, a, d, ic, il]) => {
      if (p.data) setPerson(p.data as PersonFull)
      setVisas((v.data || []) as Visa[])
      setAssets((a.data || []) as Asset[])
      setDeployments((d.data || []) as unknown as Deployment[])
      setRegisterCourses((ic.data || []) as { course_key: string; status: string; expiry_date: string | null }[])
      setRegisterLessons((il.data || []) as { lesson_key: string; status: string; expiry_date: string | null }[])
      setLoading(false)
    })
  }, [personId])

  function handleUpdated(field: string, value: string | null) {
    setPerson(prev => prev ? { ...prev, [field]: value } : prev)
  }

  // Drawer shell
  const drawerStyle: React.CSSProperties = {
    position: 'fixed', top: 48, right: 0, bottom: 0, width: 460,
    background: 'var(--bg)', borderLeft: '1px solid var(--border)',
    boxShadow: 'var(--shadow-md)', zIndex: 50,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }

  if (loading || !person) {
    return (
      <div style={drawerStyle}>
        <div className="loading-center" style={{ flex: 1 }}>
          <div className="spinner" />
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
        </div>
      </div>
    )
  }

  const catStyle = CAT_STYLE[person.default_category ?? ''] ?? { bg: 'var(--bg3)', color: 'var(--text3)' }
  const ehsS  = inductionLight(person.induction_ehs_date)
  const qualS = inductionLight(person.induction_qual_date)
  const medS  = inductionLight(person.medical_date)

  return (
    <div style={drawerStyle}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em', marginBottom: 2 }}>
              {person.full_name}
            </div>
            {person.legal_name && person.legal_name !== person.full_name && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Legal: {person.legal_name}</div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {person.default_role && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text2)' }}>
                  {person.default_role}
                </span>
              )}
              {person.default_category && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, ...catStyle, textTransform: 'capitalize' }}>
                  {person.default_category}
                </span>
              )}
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                background: (person.status || 'active') === 'active' ? '#d1fae5' : 'var(--bg3)',
                color: (person.status || 'active') === 'active' ? '#065f46' : 'var(--text3)',
              }}>
                {person.status || 'active'}
              </span>
              {person.gid && (
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', letterSpacing: '0.03em' }}>
                  {person.gid}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-sm btn-secondary"
            style={{ flexShrink: 0, padding: '4px 8px', fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)', overflowX: 'auto', flexShrink: 0,
        paddingLeft: 4,
      }}>
        {([
          { id: 'details',    label: 'Details' },
          { id: 'inductions', label: 'Inductions' },
          { id: 'visas',      label: 'Visas',   badge: visas.length },
          { id: 'assets',     label: 'Assets',  badge: assets.length },
          { id: 'history',    label: 'History', badge: deployments.length },
        ] as { id: Tab; label: string; badge?: number }[]).map(t => (
          <TabBtn key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>

        {/* ── DETAILS ── */}
        {tab === 'details' && (
          <div>
            <Section title="Identity">
              <FieldGrid>
                <EditField label="Full Name"      value={person.full_name}      field="full_name"      personId={personId} onUpdated={handleUpdated} />
                <EditField label="Legal Name"     value={person.legal_name}     field="legal_name"     personId={personId} onUpdated={handleUpdated} />
                <EditField label="Preferred Name" value={person.preferred_name} field="preferred_name" personId={personId} onUpdated={handleUpdated} />
                <EditField label="GID"            value={person.gid}            field="gid"            personId={personId} onUpdated={handleUpdated} />
                <EditField label="Email"          value={person.email}          field="email"          personId={personId} onUpdated={handleUpdated} />
                <EditField label="Phone"          value={person.phone}          field="phone"          personId={personId} onUpdated={handleUpdated} />
              </FieldGrid>
            </Section>
            <Section title="Classification">
              <FieldGrid>
                <EditField label="Default Role" value={person.default_role} field="default_role" personId={personId} onUpdated={handleUpdated} />
                <EditField label="Category" value={person.default_category} field="default_category" personId={personId} onUpdated={handleUpdated} type="select" options={['trades','management','seag','subcontractor']} />
                <EditField label="Status" value={person.status} field="status" personId={personId} onUpdated={handleUpdated} type="select" options={['active','inactive']} />
              </FieldGrid>
            </Section>
            <Section title="Notes">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <EditField label="Home Address"       value={person.home_address}       field="home_address"       personId={personId} onUpdated={handleUpdated} type="textarea" />
                <EditField label="Availability Notes" value={person.availability_notes} field="availability_notes" personId={personId} onUpdated={handleUpdated} type="textarea" />
                <EditField label="General Notes"      value={person.notes}              field="notes"              personId={personId} onUpdated={handleUpdated} type="textarea" />
              </div>
            </Section>
          </div>
        )}

        {/* ── INDUCTIONS ── */}
        {tab === 'inductions' && (
          <div>
            {/* Global register — shown when upload data exists */}
            {(registerCourses.length > 0 || registerLessons.length > 0) ? (
              <>
                {registerCourses.length > 0 && (
                  <Section title="SE Passports (SE Learning)">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {registerCourses.map(c => {
                        const today = new Date().toISOString().slice(0, 10)
                        const soon  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
                        const isExpired  = c.expiry_date && c.expiry_date < today
                        const isExpiring = !isExpired && c.expiry_date && c.expiry_date <= soon
                        const noExpiry   = c.status === 'valid' && (!c.expiry_date || c.expiry_date === '9999-12-31')
                        const isNa       = c.status === 'na'
                        const bg    = isNa ? 'var(--bg3)' : isExpired ? '#fee2e2' : isExpiring ? '#fef3c7' : noExpiry ? '#e0f2fe' : '#d1fae5'
                        const color = isNa ? 'var(--text3)' : isExpired ? '#991b1b' : isExpiring ? '#92400e' : noExpiry ? '#0369a1' : '#065f46'
                        const pill  = isNa ? 'N/A' : isExpired ? 'Expired' : isExpiring ? 'Expiring' : noExpiry ? 'No expiry' : 'Current'
                        const label = c.course_key.replace(/_/g, ' ').replace(/\w/g, l => l.toUpperCase())
                        return (
                          <div key={c.course_key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg3)', borderRadius: 5, border: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{label}</span>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              {c.expiry_date && c.expiry_date !== '9999-12-31' && (
                                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                                  {new Date(c.expiry_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })}
                                </span>
                              )}
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: bg, color }}>{pill}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Section>
                )}
                {registerLessons.length > 0 && (
                  <Section title="HRWLs (SE Learning)">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {registerLessons.map(l => {
                        const today = new Date().toISOString().slice(0, 10)
                        const soon  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
                        const isExpired  = l.expiry_date && l.expiry_date < today
                        const isExpiring = !isExpired && l.expiry_date && l.expiry_date <= soon
                        const noExpiry   = l.status === 'valid' && (!l.expiry_date || l.expiry_date === '9999-12-31')
                        const isNa       = l.status === 'na'
                        const bg    = isNa ? 'var(--bg3)' : isExpired ? '#fee2e2' : isExpiring ? '#fef3c7' : noExpiry ? '#e0f2fe' : '#d1fae5'
                        const color = isNa ? 'var(--text3)' : isExpired ? '#991b1b' : isExpiring ? '#92400e' : noExpiry ? '#0369a1' : '#065f46'
                        const pill  = isNa ? 'N/A' : isExpired ? 'Expired' : isExpiring ? 'Expiring' : noExpiry ? 'No expiry' : 'Current'
                        const label = l.lesson_key.replace(/_/g, ' ').replace(/\w/g, c => c.toUpperCase())
                        return (
                          <div key={l.lesson_key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg3)', borderRadius: 5, border: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{label}</span>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              {l.expiry_date && l.expiry_date !== '9999-12-31' && (
                                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                                  {new Date(l.expiry_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })}
                                </span>
                              )}
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: bg, color }}>{pill}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Section>
                )}
              </>
            ) : (
              <Section title="SE Learning Register">
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: '8px 0' }}>
                  No register data yet for this person. Upload via Admin → Induction Register.
                </div>
              </Section>
            )}

            {/* Manual dates — legacy fallback, always editable */}
            <Section title="Manual Dates">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                {[
                  { label: 'EHS', status: ehsS, date: person.induction_ehs_date },
                  { label: 'QUAL', status: qualS, date: person.induction_qual_date },
                ].map(({ label, status, date }) => {
                  const { bg, color, label: sl } = IND_STYLE[status]
                  return (
                    <div key={label} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '10px 12px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
                      <IndBadge date={date} />
                      <div style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: bg, color }}>{sl}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: '10px 12px', border: '1px solid var(--border)', display: 'inline-block', marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Medical</div>
                <IndBadge date={person.medical_date} />
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, ...IND_STYLE[medS] }}>{IND_STYLE[medS].label}</span>
                </div>
              </div>
            </Section>
            <Section title="Edit Dates">
              <FieldGrid>
                <EditField label="EHS Date"     value={person.induction_ehs_date}  field="induction_ehs_date"  personId={personId} onUpdated={handleUpdated} type="date" />
                <EditField label="QUAL Date"    value={person.induction_qual_date} field="induction_qual_date" personId={personId} onUpdated={handleUpdated} type="date" />
                <EditField label="Medical Date" value={person.medical_date}        field="medical_date"        personId={personId} onUpdated={handleUpdated} type="date" />
              </FieldGrid>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <EditField label="Induction Notes" value={person.induction_notes} field="induction_notes" personId={personId} onUpdated={handleUpdated} type="textarea" />
                <EditField label="Medical Notes"   value={person.medical_notes}   field="medical_notes"   personId={personId} onUpdated={handleUpdated} type="textarea" />
              </div>
            </Section>
          </div>
        )}

        {/* ── VISAS ── */}
        {tab === 'visas' && (
          <div>
            {visas.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: 28, marginBottom: 6 }}>🛂</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>No visa records</div>
              </div>
            ) : visas.map(v => (
              <div key={v.id} style={{
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{v.country || '—'}</span>
                  {v.visa_type && (
                    <span className="badge">{v.visa_type}</span>
                  )}
                </div>
                {v.project_name && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>{v.project_name}</div>}
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                  {fmtDate(v.from_date)} → {fmtDate(v.to_date)}
                </div>
                {v.current_status && (
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                    {v.current_status}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── ASSETS ── */}
        {tab === 'assets' && (
          <div>
            {assets.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: 28, marginBottom: 6 }}>💻</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>No assets assigned</div>
              </div>
            ) : assets.map(a => (
              <div key={a.id} style={{
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{a.asset_type === 'laptop' ? '💻' : '📱'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>{a.asset_type}</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                    background: a.asset_status === 'active' ? '#d1fae5' : 'var(--bg3)',
                    color: a.asset_status === 'active' ? '#065f46' : 'var(--text3)',
                  }}>
                    {a.asset_status || 'active'}
                  </span>
                </div>
                {a.asset_number && <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)', marginBottom: 2 }}>{a.asset_number}</div>}
                {a.first_project && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Project: {a.first_project}</div>}
                {a.start_date && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Since: {fmtDate(a.start_date)}</div>}
                {a.notes && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4, fontStyle: 'italic' }}>{a.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <div>
            {deployments.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>No project deployments</div>
              </div>
            ) : deployments.map(d => {
              const proj = d.projects?.[0] ?? null
              return (
                <div
                  key={d.id}
                  onClick={() => proj && onNavigateToProject?.(proj.id)}
                  style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 6,
                    cursor: proj ? 'pointer' : 'default',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    transition: 'border-color 0.1s',
                  }}
                  onMouseEnter={e => proj && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                      {proj?.name || 'Unknown project'}
                    </div>
                    {proj?.client && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{proj.client}</div>}
                    {d.role && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, fontWeight: 500 }}>{d.role}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmtDate(d.mob_in)}</div>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmtDate(d.mob_out)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
