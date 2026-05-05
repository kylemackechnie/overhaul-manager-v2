/**
 * NrgTimesheetExportModal
 *
 * Generates the NRG client weekly timesheet XLSX from OMV2 timesheet data.
 * One row per (person × TCE/WO allocation × day). Clones a fixed header
 * template embedded as a base64 string and fills data rows via SheetJS.
 *
 * Column mapping (matches NRG template exactly):
 *   A  Contractor Name (First Last — kept combined per NRG format)
 *   B  Employee Number  (persons.nrg_employee_number)
 *   C  Position         ({contractPrefix}-{TRADE}-{payCode})
 *   D  Contract         (nrg_tce_lines.contract_scope)
 *   E  Work Order-Task  (nrg_tce_lines.work_order or alloc.wo)
 *   F  Spare            (blank)
 *   G  Date             (DD/MM/YYYY)
 *   H  Start Time       (blank — not captured)
 *   I  End Time         (blank — not captured)
 *   J  Hours Worked
 */
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { toast } from './ui/Toast'
import type { NrgTceLine } from '../types'
import { NRG_TIMESHEET_TEMPLATE_B64 } from './nrgTimesheetTemplate'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimesheetRow {
  id: string
  week_start: string
  scope_tracking: string
  regime: string
  crew: CrewMember[]
}

interface CrewMember {
  personId: string
  name: string
  role: string
  days: Record<string, DayEntry>
}

interface DayEntry {
  dayType: string
  shiftType: string
  hours: number
  nrgWoAllocations?: NrgAlloc[]
}

interface NrgAlloc {
  tceItemId?: string | null
  wo?: string
  hours: number
}

interface PersonMeta {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  nrg_employee_number: string | null
}

interface ExportRow {
  name: string
  empNo: string
  position: string
  contract: string
  woTask: string
  date: Date
  hours: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, string> = {
  'Fitter':                  'FITTER',
  'Rigger':                  'RIGGER',
  'Crane Operator':          'CRANEOP',
  'Trades Assistant':        'TRADEASSIST',
  'Administrator - Site':    'ADMIN',
  'Plant Supervisor':        'SUPERVISOR',
  'Project Manager':         'PROJECTMGR',
  'QA / Project Engineer':   'QAENGINEER',
  'Safety Officer':          'SAFETYOFF',
  'Supervisor':              'SUPERVISOR',
}

function toTradeLabel(role: string): string {
  return ROLE_MAP[role] || role.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function getPayCode(dayType: string): string {
  if (dayType === 'public_holiday') return 'NT2.0'
  if (dayType === 'sunday')         return 'NT2.0'
  if (dayType === 'saturday')       return 'DT1.5'
  return 'DT1.0'
}

function formatDateDMY(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function weekEndingLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function weekEndingFilename(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 6)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mon = d.toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' })
  return `${dd}-${mon}-${d.getUTCFullYear()}`
}

// ─── Build workbook from embedded template ────────────────────────────────────
// Load the original NRG template (preserves logos, colours, merged cells,
// formatting exactly), clear data rows 6+, write new rows in.
// Data rows start at row index 5 (0-based) = row 6 in Excel.

const DATA_START_ROW = 5 // 0-based index = Excel row 6

function buildWorkbook(rows: ExportRow[], weekStart: string): XLSX.WorkBook {
  // Decode the embedded template
  const binary = atob(NRG_TIMESHEET_TEMPLATE_B64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true })

  const ws = wb.Sheets[wb.SheetNames[0]]

  // Clear all existing data rows (keep header rows 1-5)
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:J469')
  for (let r = DATA_START_ROW; r <= range.e.r; r++) {
    for (let c = 0; c <= 9; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (ws[addr]) {
        // Preserve style, just clear value
        ws[addr].v = undefined
        ws[addr].w = undefined
        ws[addr].t = 'z'
      }
    }
  }

  // Write data rows
  rows.forEach((row, ri) => {
    const r = DATA_START_ROW + ri

    const set = (c: number, v: string | number, t: 's' | 'n') => {
      const addr = XLSX.utils.encode_cell({ r, c })
      // Copy style from corresponding template row 6 cell (DATA_START_ROW)
      const tmplAddr = XLSX.utils.encode_cell({ r: DATA_START_ROW, c })
      const style = ws[tmplAddr]?.s
      ws[addr] = { v, t, ...(style ? { s: style } : {}) }
    }

    set(0, row.name,              's')
    set(1, row.empNo,             's')
    set(2, row.position,          's')
    set(3, row.contract,          's')
    set(4, row.woTask,            's')
    set(5, '',                    's')
    set(6, formatDateDMY(row.date),'s')
    set(7, '',                    's')
    set(8, '',                    's')
    set(9, row.hours,             'n')
  })

  // Update sheet ref to cover actual data
  const lastRow = DATA_START_ROW + rows.length - 1
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(lastRow, range.e.r), c: range.e.c } })

  // Rename sheet tab to match week
  const oldName = wb.SheetNames[0]
  const sheetName = `NRG WE ${weekEndingLabel(weekStart)}`.slice(0, 31)
  wb.SheetNames[0] = sheetName
  wb.Sheets[sheetName] = ws
  if (oldName !== sheetName) delete wb.Sheets[oldName]

  return wb
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { onClose: () => void }

export function NrgTimesheetExportModal({ onClose }: Props) {
  const { activeProject } = useAppStore()
  const pid = activeProject?.id || ''

  const [loading, setLoading]             = useState(true)
  const [generating, setGenerating]       = useState(false)
  const [timesheets, setTimesheets]       = useState<TimesheetRow[]>([])
  const [tceLines, setTceLines]           = useState<NrgTceLine[]>([])
  const [personMeta, setPersonMeta]       = useState<Record<string, PersonMeta>>({})
  const [selectedWeeks, setSelectedWeeks] = useState<Set<string>>(new Set())
  // Project-level NRG contract prefix — editable, derived from first skilled contract_scope
  const [contractPrefix, setContractPrefix] = useState<string>('')

  useEffect(() => { if (pid) load() }, [pid])

  async function load() {
    setLoading(true)
    const [tsRes, tceRes] = await Promise.all([
      supabase.from('weekly_timesheets')
        .select('id,week_start,scope_tracking,regime,crew')
        .eq('project_id', pid)
        .eq('scope_tracking', 'nrg_tce')
        .order('week_start', { ascending: false }),
      supabase.from('nrg_tce_lines')
        .select('id,item_id,work_order,contract_scope,source,description')
        .eq('project_id', pid),
    ])

    const tsList = (tsRes.data || []) as TimesheetRow[]
    const lines  = (tceRes.data || []) as NrgTceLine[]
    setTimesheets(tsList)
    setTceLines(lines)

    // Auto-derive contract prefix from first skilled line with a contract_scope
    const firstSkilled = lines.find(l => l.source === 'skilled' && l.contract_scope?.trim())
    if (firstSkilled) {
      // "00173164/00001" → "173164"
      const raw = firstSkilled.contract_scope.trim().replace(/^0+/, '').split('/')[0]
      setContractPrefix(raw)
    }

    // Collect all unique person IDs across all timesheets
    const personIds = new Set<string>()
    for (const ts of tsList) {
      for (const cm of (ts.crew || [])) {
        if (cm.personId) personIds.add(cm.personId)
      }
    }

    if (personIds.size > 0) {
      const { data } = await supabase
        .from('persons')
        .select('id,full_name,first_name,last_name,nrg_employee_number')
        .in('id', Array.from(personIds))
      const map: Record<string, PersonMeta> = {}
      for (const p of (data || [])) map[p.id] = p as PersonMeta
      setPersonMeta(map)
    }

    setLoading(false)
  }

  // Unique weeks with at least one timesheet
  const weeks = Array.from(new Set(timesheets.map(t => t.week_start))).sort().reverse()

  function toggleWeek(w: string) {
    setSelectedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(w)) next.delete(w); else next.add(w)
      return next
    })
  }

  // Build a lookup: item_id → {contract, wo} and wo → {contract, wo}
  const tceByItemId: Record<string, { contract: string; wo: string }> = {}
  const tceByWo:     Record<string, { contract: string; wo: string }> = {}
  for (const line of tceLines) {
    if (line.item_id) tceByItemId[line.item_id] = { contract: line.contract_scope || '', wo: line.work_order || '' }
    if (line.work_order) tceByWo[line.work_order] = { contract: line.contract_scope || '', wo: line.work_order }
  }

  function resolveContractWo(alloc: NrgAlloc): { contract: string; woTask: string } {
    if (alloc.tceItemId && tceByItemId[alloc.tceItemId]) {
      const e = tceByItemId[alloc.tceItemId]
      return { contract: e.contract, woTask: e.wo }
    }
    if (alloc.wo && tceByWo[alloc.wo]) {
      const e = tceByWo[alloc.wo]
      return { contract: e.contract, woTask: e.wo }
    }
    return { contract: '', woTask: alloc.wo || '' }
  }

  function buildRows(weekStarts: string[]): ExportRow[] {
    const weekSet = new Set(weekStarts)
    const rows: ExportRow[] = []

    for (const ts of timesheets) {
      if (!weekSet.has(ts.week_start)) continue

      for (const cm of (ts.crew || [])) {
        const meta = personMeta[cm.personId]
        const empNo = meta?.nrg_employee_number || ''
        const trade = toTradeLabel(cm.role)
        const fullName = meta
          ? [meta.first_name || '', meta.last_name || ''].filter(Boolean).join(' ') || meta.full_name
          : cm.name

        for (const [dateStr, day] of Object.entries(cm.days)) {
          if (!day || day.hours <= 0) continue
          const payCode = getPayCode(day.dayType)
          const position = contractPrefix ? `${contractPrefix}-${trade}-${payCode}` : `${trade}-${payCode}`
          const dateObj = new Date(dateStr + 'T00:00:00Z')
          const allocs = day.nrgWoAllocations || []

          if (allocs.length === 0) continue // no TCE allocations — skip

          for (const alloc of allocs) {
            if (alloc.hours <= 0) continue
            const { contract, woTask } = resolveContractWo(alloc)
            rows.push({ name: fullName, empNo, position, contract, woTask, date: dateObj, hours: alloc.hours })
          }
        }
      }
    }

    // Sort: by date, then name
    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name))
    return rows
  }

  function generate() {
    if (selectedWeeks.size === 0) { toast('Select at least one week', 'info'); return }
    setGenerating(true)
    try {
      const weekList = Array.from(selectedWeeks).sort()
      const rows = buildRows(weekList)
      if (rows.length === 0) { toast('No allocation data found for selected weeks', 'info'); setGenerating(false); return }

      // Use the earliest week_start as the sheet reference
      const primaryWeek = weekList[0]
      const wb = buildWorkbook(rows, primaryWeek)

      const suffix = weekList.length > 1
        ? `WE_${weekEndingFilename(weekList[0])}_to_${weekEndingFilename(weekList[weekList.length - 1])}`
        : `WE_${weekEndingFilename(primaryWeek)}`

      XLSX.writeFile(wb, `NRG_Timesheet_${suffix}.xlsx`)
      toast(`Exported ${rows.length} rows`, 'success')
      onClose()
    } catch (e) {
      toast('Export failed — see console', 'error')
      console.error(e)
    }
    setGenerating(false)
  }

  // Count people missing NRG employee number (across selected timesheets)
  const missingEmpNo = (() => {
    const seen = new Set<string>()
    const missing: string[] = []
    for (const ts of timesheets) {
      if (selectedWeeks.size > 0 && !selectedWeeks.has(ts.week_start)) continue
      for (const cm of (ts.crew || [])) {
        if (!seen.has(cm.personId)) {
          seen.add(cm.personId)
          if (!personMeta[cm.personId]?.nrg_employee_number) missing.push(cm.name)
        }
      }
    }
    return missing
  })()

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 800,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg)', borderRadius: 10, width: 520, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Export NRG Weekly Timesheet</h2>
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: '3px 0 0' }}>
                Produces client-facing XLSX in the NRG TAStK format
              </p>
            </div>
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px' }}>
          {loading ? (
            <div className="loading-center"><span className="spinner" /></div>
          ) : <>
            {/* Contract prefix */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                NRG Contract Prefix
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="input" style={{ width: 120, fontSize: 13 }}
                  value={contractPrefix} onChange={e => setContractPrefix(e.target.value.trim())}
                  placeholder="e.g. 173164" />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  Used in Position field: <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3 }}>
                    {contractPrefix || '______'}-FITTER-DT1.0
                  </code>
                </span>
              </div>
            </div>

            {/* Week picker */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Select Week(s)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" style={{ fontSize: 10 }}
                    onClick={() => setSelectedWeeks(new Set(weeks))}>All</button>
                  <button className="btn btn-sm" style={{ fontSize: 10 }}
                    onClick={() => setSelectedWeeks(new Set())}>None</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflow: 'auto',
                border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px' }}>
                {weeks.length === 0 && (
                  <div style={{ color: 'var(--text3)', fontSize: 12, padding: '8px 0' }}>
                    No NRG TCE timesheets found for this project.
                  </div>
                )}
                {weeks.map(w => {
                  const tsCount = timesheets.filter(t => t.week_start === w).length
                  const crewCount = timesheets.filter(t => t.week_start === w)
                    .reduce((s, t) => s + (t.crew?.length || 0), 0)
                  return (
                    <label key={w} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px',
                      cursor: 'pointer', borderRadius: 4,
                      background: selectedWeeks.has(w) ? 'var(--accent-bg)' : 'transparent' }}>
                      <input type="checkbox" checked={selectedWeeks.has(w)} onChange={() => toggleWeek(w)} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>
                        WE {weekEndingLabel(w)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
                        {tsCount} sheet{tsCount !== 1 ? 's' : ''} · {crewCount} people
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Missing employee numbers warning */}
            {selectedWeeks.size > 0 && missingEmpNo.length > 0 && (
              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6,
                padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#854d0e', marginBottom: 4 }}>
                  ⚠ {missingEmpNo.length} person{missingEmpNo.length !== 1 ? 's' : ''} missing NRG Employee Number
                </div>
                <div style={{ color: '#92400e', lineHeight: 1.5 }}>
                  {missingEmpNo.join(', ')}
                </div>
                <div style={{ color: '#a16207', marginTop: 4, fontSize: 11 }}>
                  Set via Resources → person icon → Profile Fields. Export will still proceed with blank Employee No.
                </div>
              </div>
            )}

            {/* Preview row count */}
            {selectedWeeks.size > 0 && (() => {
              const rows = buildRows(Array.from(selectedWeeks))
              return (
                <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>
                  {rows.length === 0
                    ? 'No allocation rows found — timesheets may not have TCE scope allocated.'
                    : <><strong>{rows.length}</strong> rows will be exported</>}
                </div>
              )
            })()}
          </>}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={generating || loading || selectedWeeks.size === 0} onClick={generate}>
            {generating ? 'Generating…' : '⬇ Download XLSX'}
          </button>
        </div>
      </div>
    </div>
  )
}
