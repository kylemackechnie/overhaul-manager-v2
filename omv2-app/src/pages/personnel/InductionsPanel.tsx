import * as XLSX from 'xlsx'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

// ── Course definitions ─────────────────────────────────────────────────────

const INDUCTION_COURSES = [
  { key: 'sep_trades',      label: 'SE Passport (Trades)',           shortLabel: 'SEP\nTrades',  col: 2  },
  { key: 'sep_project',     label: 'SE Passport (Project)',          shortLabel: 'SEP\nProject', col: 3  },
  { key: 'sep_contractors', label: 'SE Passport (Contractors)',      shortLabel: 'SEP\nContract',col: 4  },
  { key: 'sqp_gt',          label: 'Quality Passport (GT)',          shortLabel: 'SQP\nGT',      col: 5  },
  { key: 'sqp_project',     label: 'Quality Passport (Project)',     shortLabel: 'SQP\nProject', col: 6  },
  { key: 'sqp_trades',      label: 'Quality Passport (Trades)',      shortLabel: 'SQP\nTrades',  col: 7  },
  { key: 'sqp_contractors', label: 'Quality Passport (Contractors)', shortLabel: 'SQP\nContr',   col: 8  },
  { key: 'hydraulic',       label: 'Hydraulic Tensioning',           shortLabel: 'Hydraulic',    col: 10 },
  { key: 'rad_torque',      label: 'Rad Torque Safety',              shortLabel: 'Rad\nTorque',  col: 11 },
  { key: 'confined_space',  label: 'Confined Space',                 shortLabel: 'Confined\nSp', col: 12 },
  { key: 'hytorc',          label: 'Hytorc Stealth',                 shortLabel: 'Hytorc',       col: 13 },
  { key: 'grinder',         label: 'Grinder Safety',                 shortLabel: 'Grinder',      col: 14 },
]

// ── Types ──────────────────────────────────────────────────────────────────

interface CourseStatus { status: 'valid' | 'expired' | 'na'; pass?: string; exp?: string; expISO?: string; noExpiry?: boolean }
interface InductionPerson { name: string; courses: Record<string, CourseStatus>; company?: string; role?: string }
interface Resource { id: string; name: string; role?: string; mob_in?: string; mob_out?: string; company?: string }

// ── Helpers ────────────────────────────────────────────────────────────────

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

function toISO(s: string): string | null {
  if (!s) return null
  const p = s.trim().split('-')
  if (p.length !== 3) return null
  return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`
}

function parseCourseVal(val: unknown, today: string): CourseStatus {
  const str = val ? String(val).trim() : ''
  if (!str || str === 'N/A') return { status: 'na' }
  const m = str.match(/Pass:\s*([\d-]+)\s*\/\s*Exp:\s*([\d-]+|N\/A)/i)
  if (!m) return { status: 'na' }
  const expRaw = m[2].trim().toUpperCase()
  if (expRaw === 'N/A') return { status: 'valid', pass: m[1], exp: 'No expiry', expISO: '9999-12-31', noExpiry: true }
  const expISO = toISO(m[2])
  if (!expISO) return { status: 'na' }
  return { status: expISO < today ? 'expired' : 'valid', pass: m[1], exp: m[2], expISO }
}

// ── Component ──────────────────────────────────────────────────────────────

export function InductionsPanel() {
  const { activeProject } = useAppStore()
  const [resources, setResources]         = useState<Resource[]>([])
  const [inductionData, setInductionData] = useState<InductionPerson[]>([])
  const [fileName, setFileName]           = useState('')
  const [refDate, setRefDate]             = useState(() => new Date().toISOString().slice(0,10))
  const today = new Date().toISOString().slice(0,10)

  useEffect(() => {
    if (!activeProject) return
    supabase.from('resources').select('id,name,role,mob_in,mob_out,company')
      .eq('project_id', activeProject.id)
      .then(({ data }) => setResources(data || []))
  }, [activeProject?.id])

  // ── File parse ───────────────────────────────────────────────────────────

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setFileName(file.name)
    const buf = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      if (rows.length < 2) { toast('No data in file', 'error'); return }

      const header = (rows[0] as string[]).map(h => String(h||'').toUpperCase().trim())
      const colFor = (kw: string) => header.findIndex(h => h.includes(kw))

      const people: InductionPerson[] = []
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        const name = String(r[0]||'').trim()
        if (!name) continue
        const courses: Record<string, CourseStatus> = {}
        INDUCTION_COURSES.forEach(c => {
          const colIdx = colFor(c.label.toUpperCase()) > -1 ? colFor(c.label.toUpperCase()) : c.col
          courses[c.key] = parseCourseVal(r[colIdx], today)
        })
        people.push({ name, courses, company: String(r[colFor('COMPANY')]||''), role: String(r[colFor('ROLE')]||'') })
      }
      setInductionData(people)
      toast(`Loaded ${people.length} people from ${file.name}`, 'success')
    } catch {
      toast('Failed to parse file', 'error')
    }
    e.target.value = ''
  }

  // ── Matching ─────────────────────────────────────────────────────────────

  const matched = resources.map(r => {
    let best: InductionPerson | null = null, bestScore = 0
    inductionData.forEach(p => {
      const s = nameSimilarity(r.name, p.name)
      if (s > bestScore) { bestScore = s; best = p }
    })
    return { resource: r, match: bestScore >= 0.6 ? best : null, score: bestScore }
  })

  // ── Status counting ───────────────────────────────────────────────────────

  const isExpiredAt = (c: CourseStatus, date: string) =>
    c.status !== 'na' && !c.noExpiry && c.expISO ? c.expISO < date : false

  let allValid = 0, someExpired = 0, notFound = 0
  const expiringOnSite: { name: string; mobOut: string; courses: string[] }[] = []

  matched.forEach(m => {
    if (!m.match) { notFound++; return }
    const p = m.match as InductionPerson
    const anyExpired = INDUCTION_COURSES.some(c => isExpiredAt(p.courses[c.key] || { status: 'na' }, refDate))
    if (anyExpired) someExpired++
    else allValid++
    if (m.resource.mob_out) {
      const expCourses = INDUCTION_COURSES.filter(c => {
        const cs = p.courses[c.key]
        return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO >= today && cs.expISO < m.resource.mob_out!
      }).map(c => `${c.shortLabel.replace('\n',' ')} (${p.courses[c.key]?.exp})`)
      if (expCourses.length) expiringOnSite.push({ name: m.resource.name, mobOut: m.resource.mob_out, courses: expCourses })
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────

  const BADGE = {
    valid:   { background: 'rgba(16,185,129,.15)', color: '#059669' },
    expired: { background: 'rgba(239,68,68,.15)',  color: '#dc2626' },
    warning: { background: 'rgba(245,158,11,.15)', color: '#d97706' },
    na:      { background: 'transparent',           color: 'var(--text3)' },
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>🎓 Inductions</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            Match SE Learning induction export against project resources
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Ref date</label>
            <input type="date" className="input" value={refDate} onChange={e => setRefDate(e.target.value)}
              style={{ fontSize: '11px', width: '140px' }} />
          </div>
          {refDate !== today && (
            <button className="btn btn-xs btn-secondary" onClick={() => setRefDate(today)}>Today</button>
          )}
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            📂 Load Induction Report
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>

      {/* File info */}
      {fileName && <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '12px' }}>Loaded: {fileName} · {inductionData.length} people</div>}

      {/* KPIs */}
      {resources.length > 0 && inductionData.length > 0 && (
        <div className="kpi-grid" style={{ marginBottom: '16px' }}>
          <div className="kpi-card" style={{ borderTopColor: 'var(--green)' }}>
            <div className="kpi-val" style={{ color: 'var(--green)' }}>{allValid}</div>
            <div className="kpi-lbl">All Valid{refDate !== today ? ' at ref' : ''}</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor: 'var(--red)' }}>
            <div className="kpi-val" style={{ color: 'var(--red)' }}>{someExpired}</div>
            <div className="kpi-lbl">Has Expired{refDate !== today ? ' at ref' : ''}</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor: 'var(--amber)' }}>
            <div className="kpi-val" style={{ color: 'var(--amber)' }}>{notFound}</div>
            <div className="kpi-lbl">Not Found</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor: 'var(--amber)' }}>
            <div className="kpi-val" style={{ color: 'var(--amber)' }}>{expiringOnSite.length}</div>
            <div className="kpi-lbl">Expiring On Site</div>
          </div>
        </div>
      )}

      {/* Expiring-on-site alert */}
      {expiringOnSite.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '6px' }}>
            ⚠ {expiringOnSite.length} person{expiringOnSite.length !== 1 ? 's' : ''} have inductions expiring before mob-out
          </div>
          {expiringOnSite.map(w => (
            <div key={w.name} style={{ fontSize: '12px', color: '#78350f' }}>
              <strong>{w.name}</strong> (off site {w.mobOut}) — {w.courses.join(', ')}
            </div>
          ))}
        </div>
      )}

      {/* Empty states */}
      {resources.length === 0 && (
        <div className="empty-state"><div className="icon">👥</div><h3>No resources</h3><p>Add people to Resources first.</p></div>
      )}
      {resources.length > 0 && inductionData.length === 0 && (
        <div className="empty-state"><div className="icon">📄</div><h3>No induction data</h3>
          <p>Export from SE Learning and load the .xlsx file above. The parser detects columns automatically.</p>
        </div>
      )}

      {/* Table */}
      {resources.length > 0 && inductionData.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ textAlign: 'left', padding: '8px', position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1, minWidth: '160px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '8px', minWidth: '100px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px', minWidth: '110px' }}>Mob In → Out</th>
                {INDUCTION_COURSES.map(c => (
                  <th key={c.key} style={{ textAlign: 'center', padding: '4px 6px', fontSize: '9px', fontWeight: 600, minWidth: '58px', whiteSpace: 'pre-line', lineHeight: '1.2' }}>
                    {c.shortLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matched.map(m => {
                const p = m.match as InductionPerson | null
                const rowBg = !p ? '#fef2f2' : undefined
                return (
                  <tr key={m.resource.id} style={{ borderBottom: '1px solid var(--border)', background: rowBg }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600, position: 'sticky', left: 0, background: rowBg || 'var(--bg)', zIndex: 1 }}>
                      {m.resource.name}
                      {p && m.score < 1 && (
                        <span style={{ fontSize: '9px', color: 'var(--amber)', marginLeft: '4px' }}>≈ {(p as InductionPerson).name}</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text3)', fontSize: '10px' }}>{m.resource.role || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text3)', fontSize: '10px', whiteSpace: 'nowrap' }}>
                      {m.resource.mob_in || '—'} → {m.resource.mob_out || '—'}
                    </td>
                    {INDUCTION_COURSES.map(c => {
                      if (!p) return (
                        <td key={c.key} style={{ textAlign: 'center', padding: '4px' }}>
                          <span className="badge" style={{ fontSize: '9px', background: 'var(--bg3)', color: 'var(--text3)' }}>—</span>
                        </td>
                      )
                      const cs = (p as InductionPerson).courses[c.key] || { status: 'na' }
                      if (cs.status === 'na') return <td key={c.key} style={{ textAlign: 'center', padding: '4px', color: 'var(--text3)' }}>—</td>
                      const expired = isExpiredAt(cs, refDate)
                      const expiredToday = isExpiredAt(cs, today)
                      const style = expired ? (expiredToday ? BADGE.expired : BADGE.warning) : BADGE.valid
                      const label = expired ? (expiredToday ? 'EXPIRED' : 'EXPIRING') : 'VALID'
                      return (
                        <td key={c.key} style={{ textAlign: 'center', padding: '4px' }}>
                          <span className="badge" style={{ ...style, fontSize: '8px', display: 'block', lineHeight: '1.3' }}
                            title={`${label} — ${cs.noExpiry ? 'No expiry' : cs.exp}`}>
                            {label}<br />{cs.noExpiry ? '∞' : cs.exp}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
