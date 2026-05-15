import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileSearchBar } from '../../components/mobile/ui/MobileSearchBar'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { useRegisterRefresh } from '../../components/mobile/ui/RefreshContext'
import type { Resource, Project } from '../../types'

// ════════════════════════════════════════════════════════════════════════
// Types & constants — kept in sync with the desktop InductionsPanel so the
// induction_data / lessons_data JSON shapes match.
// ════════════════════════════════════════════════════════════════════════

interface CourseStatus {
  status: 'valid' | 'expired' | 'na'
  pass?: string
  exp?: string
  expISO?: string
  noExpiry?: boolean
}

interface InductionPerson {
  name: string
  courses: Record<string, CourseStatus>
  company?: string
  role?: string
}

// Same course definitions as desktop, but with a shortLabel suitable for
// mobile (no newlines, shorter where possible).
const INDUCTIONS: { key: string; label: string }[] = [
  { key: 'sep_trades',      label: 'SEP — Trades' },
  { key: 'sep_project',     label: 'SEP — Project' },
  { key: 'sep_contractors', label: 'SEP — Contractors' },
  { key: 'sqp_gt',          label: 'SQP — GT' },
  { key: 'sqp_gt_contr',    label: 'SQP — GT Contractors' },
  { key: 'sqp_project',     label: 'SQP — Project' },
  { key: 'sqp_trades',      label: 'SQP — Trades' },
  { key: 'sqp_contractors', label: 'SQP — Contractors' },
  { key: 'hydraulic',       label: 'Hydraulic Tensioning' },
  { key: 'rad_torque',      label: 'Rad Torque Safety' },
  { key: 'confined_space',  label: 'Confined Space Awareness' },
  { key: 'hytorc',          label: 'Hytorc Stealth' },
  { key: 'grinder',         label: 'Grinder Safety' },
]
const HRWL: { key: string; label: string }[] = [
  { key: 'white_card',    label: 'White Card' },
  { key: 'cs_licence',    label: 'Confined Space Licence' },
  { key: 'gas_test',      label: 'Gas Test Atmosphere' },
  { key: 'work_permit',   label: 'Issue Work Permit' },
  { key: 'breathing_app', label: 'Breathing Apparatus' },
  { key: 'cs_rescue',     label: 'Confined Space Rescue' },
  { key: 'wah_licence',   label: 'Working at Height' },
]

// ════════════════════════════════════════════════════════════════════════
// Name matching — identical to desktop so a person matched on desktop is
// also matched on mobile.
// ════════════════════════════════════════════════════════════════════════

function normName(s: string) { return s.toLowerCase().replace(/[^a-z]/g, '') }

function nameSimilarity(a: string, b: string): number {
  const na = normName(a), nb = normName(b)
  if (na === nb) return 1
  const ta = a.trim().split(/\s+/), tb = b.trim().split(/\s+/)
  if (ta.length >= 2 && tb.length >= 2) {
    const fm = normName(ta[0]) === normName(tb[0])
    const lm = normName(ta[ta.length-1]) === normName(tb[tb.length-1])
    if (fm && lm) return 0.95
    if (fm || lm) return 0.6
  }
  return 0
}

// ════════════════════════════════════════════════════════════════════════
// Status helpers — one source of truth for what colour a row should be.
// ════════════════════════════════════════════════════════════════════════

const EXPIRING_DAYS = 30

type CertState = 'valid' | 'expiring' | 'expired' | 'na' | 'unknown'

function certState(cs: CourseStatus | undefined, refDate: string): CertState {
  if (!cs || cs.status === 'na') return 'na'
  if (cs.noExpiry) return 'valid'
  if (!cs.expISO) return 'unknown'
  if (cs.expISO < refDate) return 'expired'
  // Expiring within EXPIRING_DAYS from refDate
  const d = new Date(refDate)
  d.setDate(d.getDate() + EXPIRING_DAYS)
  const cutoff = d.toISOString().slice(0, 10)
  if (cs.expISO < cutoff) return 'expiring'
  return 'valid'
}

const STATE_COLOR: Record<CertState, string> = {
  valid:    'var(--green)',
  expiring: 'var(--amber)',
  expired:  'var(--red)',
  na:       'var(--text3)',
  unknown:  'var(--text3)',
}

const STATE_ICON: Record<CertState, string> = {
  valid: '✓', expiring: '⚠', expired: '✗', na: '—', unknown: '—',
}

// ════════════════════════════════════════════════════════════════════════
// Aggregate status for a person — what colour the card pill is.
//
// Logic mirrors the field-relevance hierarchy:
// 1. has-expired = red (cannot work)
// 2. missing-induction = orange (no SEP/SQP at all)
// 3. expiring-soon = amber (warn — needs renewal)
// 4. all-valid = green
// 5. no-data-found = grey (resource has no matching induction record)
// ════════════════════════════════════════════════════════════════════════

type RowStatus = 'expired' | 'missing' | 'expiring' | 'valid' | 'no_data'

interface Summary {
  status: RowStatus
  expiredCount: number
  expiringCount: number
  validCount: number
}

const SEP_SQP_KEYS = new Set([
  'sep_trades', 'sep_project', 'sep_contractors',
  'sqp_gt', 'sqp_gt_contr', 'sqp_project', 'sqp_trades', 'sqp_contractors',
])

function summarise(person: InductionPerson | null, refDate: string): Summary {
  if (!person) return { status: 'no_data', expiredCount: 0, expiringCount: 0, validCount: 0 }
  let expired = 0, expiring = 0, valid = 0
  const allKeys = [...INDUCTIONS.map(c => c.key), ...HRWL.map(c => c.key)]
  for (const key of allKeys) {
    const s = certState(person.courses[key], refDate)
    if (s === 'expired')  expired++
    else if (s === 'expiring') expiring++
    else if (s === 'valid')    valid++
  }
  // Does the person hold ANY SEP/SQP?
  const hasAnyPassport = [...SEP_SQP_KEYS].some(k => {
    const s = certState(person.courses[k], refDate)
    return s === 'valid' || s === 'expiring'
  })
  let status: RowStatus
  if (expired > 0)        status = 'expired'
  else if (!hasAnyPassport) status = 'missing'
  else if (expiring > 0)    status = 'expiring'
  else                      status = 'valid'
  return { status, expiredCount: expired, expiringCount: expiring, validCount: valid }
}

const STATUS_PILL: Record<RowStatus, { bg: string; fg: string; label: string }> = {
  expired:  { bg: '#fee2e2', fg: '#991b1b', label: 'EXPIRED' },
  missing:  { bg: '#ffedd5', fg: '#9a3412', label: 'NO PASSPORT' },
  expiring: { bg: '#fef3c7', fg: '#92400e', label: 'EXPIRING' },
  valid:    { bg: '#dcfce7', fg: '#166534', label: 'CLEARED' },
  no_data:  { bg: '#f1f5f9', fg: '#475569', label: 'NO RECORD' },
}

interface Row {
  resource: Resource
  person: InductionPerson | null
  matchScore: number
  summary: Summary
}

/**
 * Mobile Inductions — gate-check lookup.
 *
 * Designed for a site supervisor at the gate: type a name, instantly see
 * whether the person is cleared to work. Status filter chips support
 * pre-shift triage ('who needs to be turned away today?').
 *
 * The Excel import / wall sheet / HSE report features stay desktop-only.
 * This is a read-only lookup view.
 */
export function InductionsMobile() {
  const { activeProject, setActiveProject } = useAppStore()
  const [resources, setResources]   = useState<Resource[]>([])
  const [people, setPeople]         = useState<InductionPerson[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState<'all' | RowStatus>('all')
  const today                       = new Date().toISOString().slice(0, 10)
  const [refDate, setRefDate]       = useState(today)
  const [activeRow, setActiveRow]   = useState<Row | null>(null)

  // Restore last-used refDate from localStorage (same key as desktop, so
  // the choice carries across shells)
  useEffect(() => {
    if (!activeProject) return
    const k = `inductions_refdate_${activeProject.id}`
    const saved = localStorage.getItem(k)
    setRefDate(saved || today)
  }, [activeProject?.id])

  function updateRefDate(d: string) {
    setRefDate(d)
    if (activeProject) {
      localStorage.setItem(`inductions_refdate_${activeProject.id}`, d)
    }
  }

  /**
   * Load people + resources. Re-fetches the project record from Supabase
   * so a fresh induction file upload (done on another device or by another
   * user on desktop) is reflected on pull-to-refresh. Without that fetch
   * we'd just rebuild from the same in-memory data.
   */
  async function load() {
    if (!activeProject) return
    setLoading(true)
    const [projRes, resRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', activeProject.id).single(),
      supabase.from('resources').select('id,name,role,mob_in,mob_out,company,category,shift')
        .eq('project_id', activeProject.id).order('name'),
    ])

    // Update Zustand if the project record changed (e.g. fresh induction
    // file upload from desktop). This way the rest of the app sees the
    // refreshed data too.
    const project = (projRes.data || activeProject) as Project
    if (projRes.data) setActiveProject(project)

    const inductionData = (project.induction_data || []) as unknown as InductionPerson[]
    const lessonsData   = (project.lessons_data   || []) as unknown as InductionPerson[]

    // Merge induction + lessons by name. Lessons data has the high-risk
    // work licence courses; induction data has the SEP/SQP + site certs.
    const merged: Record<string, InductionPerson> = {}
    for (const p of inductionData) merged[normName(p.name)] = { ...p }
    for (const p of lessonsData) {
      const k = normName(p.name)
      if (merged[k]) {
        merged[k].courses = { ...merged[k].courses, ...p.courses }
      } else {
        merged[k] = { ...p }
      }
    }
    setPeople(Object.values(merged))
    setResources((resRes.data || []) as Resource[])
    setLoading(false)
  }

  useEffect(() => { load() }, [activeProject?.id])
  useRegisterRefresh(load)

  // Build rows — match resources to induction people via nameSimilarity
  const rows = useMemo<Row[]>(() => {
    return resources.map(r => {
      let best: InductionPerson | null = null
      let bestScore = 0
      for (const p of people) {
        const s = nameSimilarity(r.name, p.name)
        if (s > bestScore) { bestScore = s; best = p }
      }
      const person = bestScore >= 0.6 ? best : null
      return {
        resource: r,
        person,
        matchScore: bestScore,
        summary: summarise(person, refDate),
      }
    })
  }, [resources, people, refDate])

  // Apply status filter + name search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows
    if (filter !== 'all') {
      list = list.filter(r => r.summary.status === filter)
    }
    if (q) {
      // Rank by combined: matches in name beat matches in role
      list = list
        .map(r => {
          const name = r.resource.name.toLowerCase()
          const role = (r.resource.role || '').toLowerCase()
          let score = 0
          if (name.startsWith(q))      score = 100
          else if (name.includes(q))   score = 50
          else if (role.includes(q))   score = 20
          return { row: r, score }
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(x => x.row)
    }
    return list
  }, [rows, search, filter])

  const statusCounts = useMemo(() => {
    const c: Record<RowStatus, number> = { expired: 0, missing: 0, expiring: 0, valid: 0, no_data: 0 }
    for (const r of rows) c[r.summary.status]++
    return c
  }, [rows])

  const noData = people.length === 0

  return (
    <>
      <MobilePanelHeader
        title="Inductions"
        subtitle={noData ? 'No induction data uploaded' : `${people.length} records · ${resources.length} resources`}
      />

      {noData ? (
        <div className="mobile-empty">
          <div className="mobile-empty-icon">📋</div>
          <h3>No induction data</h3>
          <p>Upload an induction file on desktop first. Once uploaded, this view will show resource clearance status.</p>
        </div>
      ) : (
        <>
          {/* Status filter chips */}
          <div className="mobile-filter-chips">
            <button className={`mobile-chip ${filter === 'all' ? 'mobile-chip-active' : ''}`} onClick={() => setFilter('all')}>
              All ({rows.length})
            </button>
            <button className={`mobile-chip ${filter === 'expired' ? 'mobile-chip-active mobile-chip-red' : 'mobile-chip-red-out'}`} onClick={() => setFilter('expired')}>
              ✗ Expired ({statusCounts.expired})
            </button>
            <button className={`mobile-chip ${filter === 'missing' ? 'mobile-chip-active mobile-chip-orange' : 'mobile-chip-orange-out'}`} onClick={() => setFilter('missing')}>
              ◆ No passport ({statusCounts.missing})
            </button>
            <button className={`mobile-chip ${filter === 'expiring' ? 'mobile-chip-active mobile-chip-amber' : 'mobile-chip-amber-out'}`} onClick={() => setFilter('expiring')}>
              ⚠ Expiring ({statusCounts.expiring})
            </button>
            <button className={`mobile-chip ${filter === 'valid' ? 'mobile-chip-active mobile-chip-green' : 'mobile-chip-green-out'}`} onClick={() => setFilter('valid')}>
              ✓ Cleared ({statusCounts.valid})
            </button>
          </div>

          <div style={{ padding: '10px 14px', background: 'var(--bg)' }}>
            <MobileSearchBar value={search} onChange={setSearch} placeholder="Name or role…" />
          </div>

          {/* Reference date picker */}
          <div style={{ padding: '0 14px 10px', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Check status as of:</span>
            <input
              type="date"
              className="input"
              value={refDate}
              onChange={e => updateRefDate(e.target.value)}
              style={{ height: 32, padding: '0 8px', fontSize: 13 }}
            />
            {refDate !== today && (
              <button
                type="button"
                onClick={() => updateRefDate(today)}
                style={{ fontSize: 11, color: 'var(--accent)', background: 'transparent', border: 0, cursor: 'pointer' }}
              >
                Today
              </button>
            )}
          </div>

          {loading ? (
            <div className="mobile-loading"><span className="spinner" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="mobile-empty">
              <div className="mobile-empty-icon">🔍</div>
              <h3>No matches</h3>
              <p>{search ? 'Try a different name.' : 'No resources match this filter.'}</p>
            </div>
          ) : (
            <div className="mobile-list">
              {filtered.map(row => {
                const pill = STATUS_PILL[row.summary.status]
                return (
                  <button
                    key={row.resource.id}
                    className="mobile-card mobile-induct-card"
                    onClick={() => setActiveRow(row)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{row.resource.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                          {row.resource.role || 'No role'}
                          {row.resource.company ? <span style={{ color: 'var(--text3)' }}> · {row.resource.company}</span> : null}
                        </div>
                      </div>
                      <span
                        className="mobile-status-pill"
                        style={{ background: pill.bg, color: pill.fg }}
                      >
                        {pill.label}
                      </span>
                    </div>
                    {row.person && (row.summary.expiredCount + row.summary.expiringCount + row.summary.validCount > 0) && (
                      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
                        {row.summary.validCount    > 0 && <span>✓ {row.summary.validCount} valid</span>}
                        {row.summary.expiringCount > 0 && <span style={{ color: 'var(--amber)' }}>⚠ {row.summary.expiringCount} expiring</span>}
                        {row.summary.expiredCount  > 0 && <span style={{ color: 'var(--red)' }}>✗ {row.summary.expiredCount} expired</span>}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Detail sheet */}
      <MobileBottomSheet
        open={!!activeRow}
        onClose={() => setActiveRow(null)}
        title={activeRow?.resource.name || ''}
        height="full"
      >
        {activeRow && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Header summary */}
            <div style={{ background: 'var(--bg3)', borderLeft: `4px solid ${STATUS_PILL[activeRow.summary.status].fg}`, borderRadius: 6, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: STATUS_PILL[activeRow.summary.status].fg }}>
                {STATUS_PILL[activeRow.summary.status].label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                {activeRow.resource.role || 'No role'}
                {activeRow.resource.company ? ` · ${activeRow.resource.company}` : ''}
              </div>
              {activeRow.matchScore > 0 && activeRow.matchScore < 1 && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontStyle: 'italic' }}>
                  Fuzzy name match — verify identity ({Math.round(activeRow.matchScore * 100)}%)
                </div>
              )}
              {!activeRow.person && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  No induction record matched this resource by name. Worker may not have completed inductions, or may be in the file under a different spelling.
                </div>
              )}
            </div>

            {activeRow.person && (
              <>
                {/* Inductions section */}
                <div>
                  <div className="mobile-induct-section">Inductions</div>
                  <div className="mobile-induct-list">
                    {INDUCTIONS.map(c => (
                      <CertRow key={c.key} label={c.label} cs={activeRow.person!.courses[c.key]} refDate={refDate} />
                    ))}
                  </div>
                </div>

                {/* HRWL section */}
                <div>
                  <div className="mobile-induct-section">High-risk work licences</div>
                  <div className="mobile-induct-list">
                    {HRWL.map(c => (
                      <CertRow key={c.key} label={c.label} cs={activeRow.person!.courses[c.key]} refDate={refDate} />
                    ))}
                  </div>
                </div>
              </>
            )}

            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6 }}>
              💡 To update induction records, upload a fresh file on desktop (Personnel → Inductions).
            </div>
          </div>
        )}
      </MobileBottomSheet>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════
// CertRow — one cert in the detail sheet
// ════════════════════════════════════════════════════════════════════════

function CertRow({ label, cs, refDate }: { label: string; cs: CourseStatus | undefined; refDate: string }) {
  const state = certState(cs, refDate)
  const color = STATE_COLOR[state]
  const icon  = STATE_ICON[state]

  let detail = ''
  if (!cs || cs.status === 'na') detail = 'Not held'
  else if (cs.noExpiry) detail = 'No expiry'
  else if (cs.exp) detail = `Expires ${cs.exp}`
  else if (cs.expISO) detail = `Expires ${cs.expISO}`

  return (
    <div className="mobile-induct-row">
      <span style={{ color, fontSize: 16, fontWeight: 700, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, color: state === 'na' ? 'var(--text3)' : 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 12, color: state === 'expired' ? 'var(--red)' : state === 'expiring' ? 'var(--amber)' : 'var(--text2)', whiteSpace: 'nowrap' }}>
        {detail}
      </span>
    </div>
  )
}
