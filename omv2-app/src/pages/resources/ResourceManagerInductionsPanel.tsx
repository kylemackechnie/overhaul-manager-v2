/**
 * ResourceManagerInductionsPanel.tsx
 * Upload panel for the Resource Manager to update the global induction register.
 * Same two-file format as the PM's Inductions panel (Courses + Lessons).
 * One upload covers all 2000 SE Learning employees — no project context needed.
 * Writes directly to induction_courses + induction_lessons tables.
 * PM uploads also write there as a side-effect (via writeToGlobalRegister).
 */
import * as XLSX from 'xlsx'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { writeToGlobalRegister } from '../personnel/InductionsPanel'
import { toast } from '../../components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UploadLog {
  id: string
  uploaded_at: string
  upload_type: string
  rows_processed: number | null
  rows_upserted: number | null
  rows_matched: number | null
  notes: string | null
  source_project_id: string | null
  project_name?: string | null
}

interface GlobalStats {
  courses_total: number
  lessons_total: number
  people_with_courses: number
  people_matched: number
  last_upload: string | null
}

// ── Helpers (mirrors InductionsPanel parse logic) ─────────────────────────────

const INDUCTION_COURSES_META = [
  { key: 'sep_trades',      labels: ['SIEMENS ENERGY PASSPORT (TRADES)'],                                       isLesson: false },
  { key: 'sep_project',     labels: ['SIEMENS ENERGY PASSPORT (PROJECT PERSONNEL)'],                            isLesson: false },
  { key: 'sep_contractors', labels: ['SIEMENS ENERGY PASSPORT (CONTRACTORS)'],                                  isLesson: false },
  { key: 'sqp_gt',          labels: ['SIEMENS QUALITY PASSPORT (GT PROJECT PERSONNEL)'],                        isLesson: false },
  { key: 'sqp_gt_contr',    labels: ['SIEMENS QUALITY PASSPORT (GT CONTRACTORS)'],                              isLesson: false },
  { key: 'sqp_project',     labels: ['SIEMENS QUALITY PASSPORT (PROJECT PERSONNEL)'],                           isLesson: false },
  { key: 'sqp_trades',      labels: ['SIEMENS QUALITY PASSPORT (TRADES)'],                                      isLesson: false },
  { key: 'sqp_contractors', labels: ['SIEMENS QUALITY PASSPORT (CONTRACTORS)'],                                 isLesson: false },
  { key: 'hydraulic',       labels: ['HYDRAULIC TENSIONING'],                                                   isLesson: false },
  { key: 'rad_torque',      labels: ['RAD TORQUE SAFETY'],                                                      isLesson: false },
  { key: 'confined_space',  labels: ['CONFINED SPACE AWARENESS (SIEMENS ENERGY)', 'CONFINED SPACE AWARENESS'], isLesson: false },
  { key: 'hytorc',          labels: ['HYTORC STEALTH'],                                                         isLesson: false },
  { key: 'grinder',         labels: ['GRINDER SAFETY'],                                                         isLesson: false },
  { key: 'white_card',      labels: ['WHITE CARD (NO EXPIRY)', 'WHITE CARD'],                                   isLesson: true  },
  { key: 'cs_licence',      labels: ['CONFINED SPACE (REFRESH EVERY 2 YEARS)', 'CONFINED SPACE RESCUE'],        isLesson: true  },
  { key: 'gas_test',        labels: ['GAS TEST ATMOSPHERE'],                                                    isLesson: true  },
  { key: 'work_permit',     labels: ['ISSUE WORK PERMIT'],                                                      isLesson: true  },
  { key: 'breathing_app',   labels: ['OPERATE BREATHING APPARATUS'],                                            isLesson: true  },
  { key: 'cs_rescue',       labels: ['CONFINED SPACE RESCUE'],                                                  isLesson: true  },
  { key: 'wah_licence',     labels: ['WORKING AT HEIGHT (REFRESH EVERY 2 YRS)', 'WORKING AT HEIGHT'],           isLesson: true  },
]

function toISO(s: string): string | null {
  if (!s) return null
  const p = s.trim().split('-')
  if (p.length !== 3) return null
  return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`
}

function parseCourseVal(val: unknown): { status: string; expISO?: string; noExpiry?: boolean } {
  const today = new Date().toISOString().slice(0, 10)
  const str = val ? String(val).trim() : ''
  if (!str || str === 'N/A') return { status: 'na' }
  const m = str.match(/Pass:\s*[\d-]+\s*\/\s*Exp:\s*([\d-]+|N\/A)/i)
  if (!m) return { status: 'na' }
  if (m[1].toUpperCase() === 'N/A') return { status: 'valid', expISO: '9999-12-31', noExpiry: true }
  const expISO = toISO(m[1])
  if (!expISO) return { status: 'na' }
  return { status: expISO < today ? 'expired' : 'valid', expISO }
}

function parseLessonVal(val: unknown): { status: string; expISO?: string; noExpiry?: boolean } {
  const today = new Date().toISOString().slice(0, 10)
  const str = val ? String(val).trim() : ''
  if (!str) return { status: 'na' }
  if (/does not expir/i.test(str)) return { status: 'valid', expISO: '9999-12-31', noExpiry: true }
  const m = str.match(/Exp:\s*([\d-]+)/i)
  if (!m) return { status: 'na' }
  const expISO = toISO(m[1])
  if (!expISO) return { status: 'na' }
  const year = parseInt(expISO.slice(0, 4), 10)
  if (year < 1900 || year > 2200) return { status: 'valid', expISO: '9999-12-31', noExpiry: true }
  return { status: expISO < today ? 'expired' : 'valid', expISO }
}

function parseFile(buf: ArrayBuffer, fileType: 'courses' | 'lessons') {
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  if (rows.length < 2) return []

  const header = (rows[0] as string[]).map(h => String(h || '').toUpperCase().trim())
  const colFor = (...keywords: string[]) => {
    for (const kw of keywords) {
      const idx = header.findIndex(h => h.includes(kw.toUpperCase()))
      if (idx > -1) return idx
    }
    return -1
  }

  const relevant = INDUCTION_COURSES_META.filter(c => c.isLesson === (fileType === 'lessons'))
  const colMap: Record<string, number> = {}
  relevant.forEach(c => { colMap[c.key] = colFor(...c.labels) })

  const people = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[]
    const name = String(r[0] || '').trim()
    if (!name) continue
    const courses: Record<string, { status: string; expISO?: string; noExpiry?: boolean }> = {}
    relevant.forEach(c => {
      const colIdx = colMap[c.key]
      if (colIdx < 0) { courses[c.key] = { status: 'na' }; return }
      courses[c.key] = fileType === 'lessons'
        ? parseLessonVal(r[colIdx])
        : parseCourseVal(r[colIdx])
    })
    people.push({ name, courses })
  }
  return people
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ResourceManagerInductionsPanel() {
  const [coursesFile, setCoursesFile] = useState<string | null>(null)
  const [lessonsFile, setLessonsFile] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'courses' | 'lessons' | null>(null)
  const [logs, setLogs] = useState<UploadLog[]>([])
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  async function loadStats() {
    setLoadingStats(true)
    const [coursesRes, , logsRes] = await Promise.all([
      supabase.from('induction_courses').select('person_name, person_id, uploaded_at').order('uploaded_at', { ascending: false }).limit(1),
      supabase.from('induction_lessons').select('id', { count: 'exact', head: true }),
      supabase.from('induction_upload_log').select('*, projects:source_project_id(name)').order('uploaded_at', { ascending: false }).limit(10),
    ])

    // Get counts separately
    const [cCount, lCount, cPeople, cMatched] = await Promise.all([
      supabase.from('induction_courses').select('id', { count: 'exact', head: true }),
      supabase.from('induction_lessons').select('id', { count: 'exact', head: true }),
      supabase.from('induction_courses').select('person_name', { count: 'exact', head: true }),
      supabase.from('induction_courses').select('id', { count: 'exact', head: true }).not('person_id', 'is', null),
    ])

    setStats({
      courses_total: cCount.count ?? 0,
      lessons_total: lCount.count ?? 0,
      people_with_courses: cPeople.count ?? 0,
      people_matched: cMatched.count ?? 0,
      last_upload: coursesRes.data?.[0]?.uploaded_at ?? null,
    })

    const logRows = (logsRes.data || []) as Record<string, unknown>[]
    setLogs(logRows.map(r => ({
      id: r.id as string,
      uploaded_at: r.uploaded_at as string,
      upload_type: r.upload_type as string,
      rows_processed: r.rows_processed as number | null,
      rows_upserted: r.rows_upserted as number | null,
      rows_matched: r.rows_matched as number | null,
      notes: r.notes as string | null,
      source_project_id: r.source_project_id as string | null,
      project_name: (r.projects as { name: string } | null)?.name ?? null,
    })))

    setLoadingStats(false)
  }

  useEffect(() => { loadStats() }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, fileType: 'courses' | 'lessons') {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(fileType)
    try {
      const buf = await file.arrayBuffer()
      const people = parseFile(buf, fileType)
      if (people.length === 0) { toast('No data found in file', 'error'); setUploading(null); return }

      const { upserted, matched } = await writeToGlobalRegister(people, fileType)

      // Log the upload
      await supabase.from('induction_upload_log').insert({
        upload_type: fileType,
        rows_processed: people.length,
        rows_upserted: upserted,
        rows_matched: matched,
        notes: `Global upload from Resource Manager — ${file.name}`,
        source_project_id: null,
      })

      if (fileType === 'courses') setCoursesFile(file.name)
      else setLessonsFile(file.name)

      toast(`${people.length} people processed · ${upserted} records upserted · ${matched} matched to persons`, 'success')
      loadStats()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error')
    }
    setUploading(null)
    e.target.value = ''
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 20, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Global Induction Register</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
          Upload the SE Learning Courses and Lessons exports to update compliance records for all 2000+ employees.
          PM uploads from the project Inductions panel also update this register automatically.
        </div>
      </div>

      {/* Stats */}
      {loadingStats ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, color: 'var(--text3)', fontSize: 12 }}>
          <span className="spinner" style={{ width: 14, height: 14 }} /> Loading register stats…
        </div>
      ) : stats && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Course records', val: stats.courses_total.toLocaleString(), color: 'var(--accent)' },
            { label: 'Lesson records', val: stats.lessons_total.toLocaleString(), color: 'var(--blue)' },
            { label: 'Persons matched', val: stats.people_matched.toLocaleString(), color: 'var(--green)' },
            { label: 'Last upload', val: stats.last_upload ? fmtDate(stats.last_upload).split(',')[0] : 'Never', color: 'var(--border2)' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', borderTop: `3px solid ${color}`, minWidth: 130 }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Upload cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
        {/* Courses */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Courses File</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>SE Passports + site certs (SEP, SQP, Hydraulic, etc.)</div>
            </div>
          </div>
          {coursesFile && (
            <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 8, fontFamily: 'var(--mono)' }}>✓ {coursesFile}</div>
          )}
          <label className={`btn btn-primary${uploading === 'courses' ? ' disabled' : ''}`} style={{ cursor: uploading ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {uploading === 'courses'
              ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Uploading…</>
              : '⬆ Upload Courses file'
            }
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => handleFile(e, 'courses')} disabled={uploading !== null} />
          </label>
        </div>

        {/* Lessons */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>🪪</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Lessons File</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>HRWLs — White Card, WAH, CS Licence, Gas Test, etc.</div>
            </div>
          </div>
          {lessonsFile && (
            <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 8, fontFamily: 'var(--mono)' }}>✓ {lessonsFile}</div>
          )}
          <label className={`btn btn-primary${uploading === 'lessons' ? ' disabled' : ''}`} style={{ cursor: uploading ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {uploading === 'lessons'
              ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Uploading…</>
              : '⬆ Upload Lessons file'
            }
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => handleFile(e, 'lessons')} disabled={uploading !== null} />
          </label>
        </div>
      </div>

      {/* Info strip */}
      <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 24, fontSize: 12, color: 'var(--accent)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>How this works</div>
        <ul style={{ paddingLeft: 16, lineHeight: 1.7 }}>
          <li>Upload covers all SE Learning employees — no need to filter by project</li>
          <li>Records are upserted: existing rows are updated, new ones created</li>
          <li>Names are matched to the Persons directory — unmatched names are still stored</li>
          <li>PM uploads from the project Inductions panel also update this register as a side-effect</li>
          <li>The Resource Board compliance dots read from this register via person_id</li>
        </ul>
      </div>

      {/* Upload log */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Upload History</div>
      {logs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No uploads yet</div>
      ) : (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Type', 'Source', 'Processed', 'Upserted', 'Matched', 'Notes'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id} style={{ background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                    {fmtDate(log.uploaded_at)}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3, background: log.upload_type === 'courses' ? '#dbeafe' : '#d1fae5', color: log.upload_type === 'courses' ? '#1e40af' : '#065f46', textTransform: 'capitalize' }}>
                      {log.upload_type}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text3)', fontSize: 11 }}>
                    {log.project_name ?? 'Resource Manager'}
                  </td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: 'var(--text2)', textAlign: 'right' }}>{log.rows_processed ?? '—'}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: 'var(--accent)', textAlign: 'right' }}>{log.rows_upserted ?? '—'}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: 'var(--green)', textAlign: 'right' }}>{log.rows_matched ?? '—'}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--text3)', fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.notes ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
