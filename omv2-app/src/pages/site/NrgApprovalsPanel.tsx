/**
 * NrgApprovalsPanel
 *
 * Reconciles timesheet data from the DB (what we sent to NRG) against
 * the approvals spreadsheet NRG returns. Only the approvals file needs
 * to be uploaded — the sent data is derived live from the database.
 *
 * Matching key: employee_number + work_order-task + date + hours
 * (Approvals employee numbers are prefixed with 'S', e.g. S17 → 17)
 */
import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SentRow {
  name: string
  empNo: string
  payCode: string
  woTask: string
  contract: string
  date: string
  hours: number
}

interface ApprovalRow {
  firstName: string
  lastName: string
  name: string
  empNo: string
  woTask: string
  contract: string
  date: string
  hours: number
  rate: number
  total: number
  gst: number
  totalIncGst: number
  status: string
  resourceCode: string
  woTitle: string
}

type MatchStatus = 'matched' | 'missing' | 'extra'

interface ReconRow {
  status: MatchStatus
  sent?: SentRow
  appr?: ApprovalRow
}

interface NrgAlloc { tceItemId?: string | null; wo?: string; hours: number; payCode?: string }
interface DayEntry  { dayType: string; shiftType: string; hours: number; nrgWoAllocations?: NrgAlloc[] }
interface CrewMember { personId: string; name: string; role: string; days: Record<string, DayEntry> }
interface Timesheet  { id: string; week_start: string; scope_tracking: string; regime: string; crew: CrewMember[] }
interface PersonMeta { id: string; full_name: string; first_name: string | null; last_name: string | null; nrg_employee_number: string | null }
interface TceLine    { item_id: string | null; work_order: string; contract_scope: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function excelDateToISO(val: unknown): string {
  if (!val) return ''
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000)
    return d.toISOString().slice(0, 10)
  }
  return String(val).slice(0, 10)
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtCurrency(n: number): string {
  return n ? `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
}

function rowKey(empNo: string, woTask: string, date: string, hours: number): string {
  return `${empNo}|${woTask}|${date}|${hours}`
}

function getPayCode(dayType: string): string {
  if (dayType === 'public_holiday' || dayType === 'sunday') return 'NT2.0'
  if (dayType === 'saturday') return 'DT1.5'
  return 'DT1.0'
}


// ─── Derive sent rows from DB data (same logic as XLSX export) ────────────────

function buildSentRows(
  timesheets: Timesheet[],
  personMeta: Record<string, PersonMeta>,
  tceByItemId: Record<string, TceLine>,
  tceByWo: Record<string, TceLine>,
  dateFrom: string,
  dateTo: string,
): SentRow[] {
  const rows: SentRow[] = []
  for (const ts of timesheets) {
    const weekEnd = (() => { const d = new Date(ts.week_start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10) })()
    if (weekEnd < dateFrom || ts.week_start > dateTo) continue
    for (const cm of ts.crew) {
      const meta = personMeta[cm.personId]
      const empNo = meta?.nrg_employee_number || ''
      const fullName = meta
        ? [meta.first_name || '', meta.last_name || ''].filter(Boolean).join(' ') || meta.full_name
        : cm.name
      for (const [dateStr, day] of Object.entries(cm.days)) {
        if (dateStr < dateFrom || dateStr > dateTo) continue
        if (!day || day.hours <= 0) continue
        const allocs = (day.nrgWoAllocations || []).filter(a => (a as NrgAlloc & {_tceMode?:boolean}).tceItemId || (a as NrgAlloc & {_tceMode?:boolean}).wo || (a as NrgAlloc & {_tceMode?:boolean; tceItemId?: string | null}).tceItemId !== undefined)
        if (allocs.length === 0) continue
        for (const alloc of allocs) {
          if (alloc.hours <= 0) continue
          const payCode = alloc.payCode || getPayCode(day.dayType)
          let contract = '', woTask = ''
          if (alloc.tceItemId && tceByItemId[alloc.tceItemId]) {
            contract = tceByItemId[alloc.tceItemId].contract_scope
            woTask   = tceByItemId[alloc.tceItemId].work_order
          } else if (alloc.wo && tceByWo[alloc.wo]) {
            contract = tceByWo[alloc.wo].contract_scope
            woTask   = alloc.wo
          } else if (alloc.wo) {
            woTask = alloc.wo
          }
          rows.push({ name: fullName, empNo, payCode, woTask, contract, date: dateStr, hours: alloc.hours })
        }
      }
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

// ─── Parse NRG approvals XLSX ─────────────────────────────────────────────────

function parseApprovalsFile(wb: XLSX.WorkBook): ApprovalRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const rows: ApprovalRow[] = []
  for (const r of raw) {
    const empNoRaw = String(r['EMPLOYEE_NUMBER'] || '').trim()
    const empNo    = empNoRaw.replace(/^S0*/i, '')
    const refNbr   = r['REFERENCE_NBR'] ? String(Math.round(Number(r['REFERENCE_NBR']))) : ''
    const refSub   = r['REFERENCE_SUB_NBR'] ? String(Math.round(Number(r['REFERENCE_SUB_NBR']))).padStart(2, '0') : ''
    const woTask   = refNbr ? `${refNbr}-${refSub}` : ''
    const contract = r['CONTRACT_ID'] && r['CONTRACT_RELEASE'] ? `${r['CONTRACT_ID']}/${r['CONTRACT_RELEASE']}` : ''
    const hours    = parseFloat(String(r['HOURS_WORKED_REG'] || '0'))
    if (!empNo || isNaN(hours)) continue
    rows.push({
      firstName:    String(r['FIRST_NAME']  || '').trim(),
      lastName:     String(r['LAST_NAME']   || '').trim(),
      name:         `${String(r['FIRST_NAME'] || '').trim()} ${String(r['LAST_NAME'] || '').trim()}`.trim(),
      empNo, woTask, contract,
      date:         excelDateToISO(r['WORK_DATE']),
      hours,
      rate:         parseFloat(String(r['RESOURCE_RATE'] || '0')),
      total:        parseFloat(String(r['TOTAL'] || '0')),
      gst:          parseFloat(String(r['GST'] || '0')),
      totalIncGst:  parseFloat(String(r['TOTAL_INC_GST'] || '0')),
      status:       String(r['CONTR_AUTH_STATUS'] || '').trim(),
      resourceCode: String(r['RESOURCE_CODE'] || '').trim(),
      woTitle:      String(r['WR_TASK_TITLE'] || '').trim(),
    })
  }
  return rows
}

// ─── Reconcile ────────────────────────────────────────────────────────────────

function reconcile(sent: SentRow[], appr: ApprovalRow[]): ReconRow[] {
  const sentMap = new Map<string, SentRow>()
  for (const r of sent) sentMap.set(rowKey(r.empNo, r.woTask, r.date, r.hours), r)
  const apprMap = new Map<string, ApprovalRow>()
  for (const r of appr) apprMap.set(rowKey(r.empNo, r.woTask, r.date, r.hours), r)

  const rows: ReconRow[] = []
  const seen = new Set<string>()
  for (const [k, s] of sentMap) {
    seen.add(k)
    rows.push(apprMap.has(k) ? { status: 'matched', sent: s, appr: apprMap.get(k) } : { status: 'missing', sent: s })
  }
  for (const [k, a] of apprMap) {
    if (!seen.has(k)) rows.push({ status: 'extra', appr: a })
  }
  const order = { extra: 0, missing: 1, matched: 2 }
  return rows.sort((a, b) => {
    const os = order[a.status] - order[b.status]; if (os !== 0) return os
    const na = (a.sent?.name || a.appr?.name || '').toLowerCase()
    const nb = (b.sent?.name || b.appr?.name || '').toLowerCase()
    const nc = na.localeCompare(nb); if (nc !== 0) return nc
    return (a.sent?.date || a.appr?.date || '').localeCompare(b.sent?.date || b.appr?.date || '')
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  matched: { bg: '#d1fae5', color: '#065f46', label: 'Approved',           icon: '✓' },
  missing: { bg: '#fee2e2', color: '#991b1b', label: 'Not in approvals',   icon: '✗' },
  extra:   { bg: '#fef3c7', color: '#92400e', label: 'Extra in approvals', icon: '⚠' },
}

export function NrgApprovalsPanel() {
  const { activeProject } = useAppStore()
  const pid = activeProject?.id || ''

  const [loading, setLoading]           = useState(false)
  const [timesheets, setTimesheets]     = useState<Timesheet[]>([])
  const [personMeta, setPersonMeta]     = useState<Record<string, PersonMeta>>({})
  const [tceByItemId, setTceByItemId]   = useState<Record<string, TceLine>>({})
  const [tceByWo, setTceByWo]           = useState<Record<string, TceLine>>({})
  const [contractPrefix, setContractPrefix] = useState('')

  const [apprRows, setApprRows]         = useState<ApprovalRow[]>([])
  const [apprName, setApprName]         = useState('')
  const [recon, setRecon]               = useState<ReconRow[]>([])
  const [error, setError]               = useState('')

  // Date range — defaults to current month
  const today    = new Date()
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo,   setDateTo]   = useState(monthEnd)

  const [filter,     setFilter]     = useState<'all' | MatchStatus>('all')
  const [filterName, setFilterName] = useState('')
  const apprRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (pid) loadDB() }, [pid])

  async function loadDB() {
    setLoading(true)
    const [tsRes, tceRes] = await Promise.all([
      supabase.from('weekly_timesheets').select('id,week_start,scope_tracking,regime,crew')
        .eq('project_id', pid).eq('scope_tracking', 'nrg_tce').order('week_start', { ascending: false }),
      supabase.from('nrg_tce_lines').select('id,item_id,work_order,contract_scope,source')
        .eq('project_id', pid),
    ])
    const tsList = (tsRes.data || []) as Timesheet[]
    const lines  = (tceRes.data || []) as TceLine[]
    setTimesheets(tsList)

    // Build TCE lookups
    const byItemId: Record<string, TceLine> = {}
    const byWo:     Record<string, TceLine> = {}
    for (const l of lines) {
      if (l.item_id)    byItemId[l.item_id]    = l
      if (l.work_order) byWo[l.work_order]      = l
    }
    setTceByItemId(byItemId)
    setTceByWo(byWo)

    // Auto-derive contract prefix
    const firstSkilled = lines.find((l: TceLine & {source?: string}) => (l as TceLine & {source: string}).source === 'skilled' && l.contract_scope?.trim())
    if (firstSkilled) setContractPrefix(firstSkilled.contract_scope.trim().replace(/^0+/, '').split('/')[0])

    // Resolve resource IDs → persons
    const resourceIds = new Set<string>()
    for (const ts of tsList) for (const cm of ts.crew) if (cm.personId) resourceIds.add(cm.personId)
    if (resourceIds.size > 0) {
      const { data: resData } = await supabase.from('resources').select('id,person_id').in('id', Array.from(resourceIds))
      const r2p: Record<string, string> = {}
      for (const r of (resData || [])) if (r.person_id) r2p[r.id] = r.person_id
      const personIds = [...new Set(Object.values(r2p))]
      const { data: pData } = await supabase.from('persons').select('id,full_name,first_name,last_name,nrg_employee_number').in('id', personIds)
      const byId: Record<string, PersonMeta> = {}
      for (const p of (pData || [])) byId[p.id] = p as PersonMeta
      const map: Record<string, PersonMeta> = {}
      for (const [rId, pId] of Object.entries(r2p)) map[rId] = byId[pId]
      for (const p of (pData || [])) if (!map[p.id]) map[p.id] = p as PersonMeta
      setPersonMeta(map)
    }
    setLoading(false)
  }

  // Recompute recon whenever date range or approvals change
  const sentRows = buildSentRows(timesheets, personMeta, tceByItemId, tceByWo, dateFrom, dateTo)

  useEffect(() => {
    if (apprRows.length > 0) setRecon(reconcile(sentRows, apprRows))
    else setRecon([])
  }, [dateFrom, dateTo, apprRows, timesheets, personMeta])

  function loadApprFile(file: File) {
    setError('')
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const rows = parseApprovalsFile(wb)
        if (rows.length === 0) throw new Error('No data rows found — check this is the NRG approvals file')
        setApprRows(rows)
        setApprName(file.name)
      } catch (err) { setError((err as Error).message) }
    }
    reader.readAsArrayBuffer(file)
  }

  const displayed = recon.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false
    if (filterName) {
      const n = (r.sent?.name || r.appr?.name || '').toLowerCase()
      if (!n.includes(filterName.toLowerCase())) return false
    }
    return true
  })

  const counts = { matched: 0, missing: 0, extra: 0 }
  for (const r of recon) counts[r.status]++
  const totalApproved = recon.filter(r => r.status === 'matched').reduce((s, r) => s + (r.appr?.total || 0), 0)
  const totalMissing  = recon.filter(r => r.status === 'missing').reduce((s, r) => s + r.sent!.hours, 0)

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>NRG Timesheet Approvals Reconciliation</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
          Compares timesheet data from the system against NRG's approvals spreadsheet.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end', flexShrink: 0 }}>
        {/* Date range */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>Date Range</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" className="input" style={{ fontSize: 12, width: 140 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>→</span>
            <input type="date" className="input" style={{ fontSize: 12, width: 140 }} value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom} />
          </div>
        </div>

        {/* Contract prefix */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>Contract Prefix</div>
          <input className="input" style={{ width: 90, fontSize: 12 }} value={contractPrefix} onChange={e => setContractPrefix(e.target.value.trim())} placeholder="e.g. 173164" />
        </div>

        {/* System data status */}
        <div style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--bg2)', fontSize: 12, color: 'var(--text2)' }}>
          {loading ? <><span className="spinner" style={{ width: 12, height: 12, display: 'inline-block' }} /> Loading…</>
            : <><span style={{ color: 'var(--green)', marginRight: 4 }}>●</span>{sentRows.length} system rows for date range</>}
        </div>

        {/* Approvals file */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>NRG Approvals File</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {apprRows.length > 0
              ? <>
                  <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ {apprName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>({apprRows.length} rows)</span>
                  <button className="btn btn-sm" style={{ fontSize: 10 }} onClick={() => { setApprRows([]); setApprName(''); setRecon([]) }}>✕</button>
                </>
              : <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  📂 Upload approvals XLSX
                  <input ref={apprRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) loadApprFile(f); e.target.value = '' }} />
                </label>}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#991b1b', marginBottom: 12, flexShrink: 0 }}>
          ⚠ {error}
        </div>
      )}

      {recon.length > 0 && (<>
        {/* KPI tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12, flexShrink: 0 }}>
          {[
            { label: 'Total rows',             value: String(recon.length), color: 'var(--text)',  sub: '' },
            { label: 'Approved',               value: String(counts.matched), color: '#065f46', sub: fmtCurrency(totalApproved) },
            { label: 'Not in approvals',        value: String(counts.missing), color: '#991b1b', sub: `${totalMissing.toFixed(1)}h unaccounted` },
            { label: 'Extras in approvals',    value: String(counts.extra),   color: '#92400e', sub: 'NRG added / modified' },
          ].map(k => (
            <div key={k.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: k.color, fontFamily: 'var(--mono)' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{k.label}</div>
              {k.sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{k.sub}</div>}
            </div>
          ))}
        </div>

        {counts.missing > 0 && (
          <div style={{ background: '#fef2f2', border: '2px solid #fca5a5', borderRadius: 6, padding: '10px 14px', marginBottom: 8, fontSize: 12, color: '#7f1d1d', flexShrink: 0 }}>
            <strong>🚨 {counts.missing} rows submitted but not approved by NRG.</strong>
            {' '}Chase NRG for these or check the submitted file for errors.
          </div>
        )}
        {counts.extra > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 14px', marginBottom: 8, fontSize: 12, color: '#78350f', flexShrink: 0 }}>
            <strong>⚠ {counts.extra} rows in NRG approvals not matched in system.</strong>
            {' '}NRG may have added lines, corrected WO numbers, or approved a different date range. Review carefully.
          </div>
        )}

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          {(['all', 'missing', 'extra', 'matched'] as const).map(s => {
            const labels = { all: `All (${recon.length})`, missing: `Not Approved (${counts.missing})`, extra: `Extras (${counts.extra})`, matched: `Approved (${counts.matched})` }
            return (
              <button key={s} className="btn btn-sm"
                style={{ background: filter === s ? 'var(--accent)' : 'var(--bg)', color: filter === s ? '#fff' : 'var(--text)' }}
                onClick={() => setFilter(s)}>{labels[s]}</button>
            )
          })}
          <input className="input" style={{ maxWidth: 200, fontSize: 12 }} placeholder="Filter by name..."
            value={filterName} onChange={e => setFilterName(e.target.value)} />
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'auto', flex: 1 }}>
          <table style={{ fontSize: 12, minWidth: 1050, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {([['Status',80],['Name',140],['Emp #',55],['Date',100],['WO / Task',130],
                   ['Pay Code',72],['Hrs Sent',72],['Hrs Approved',84],['Δ Hrs',60],
                   ['Rate',60],['Total ex GST',105],['SIE Code',100],['NRG Status',90]] as [string,number][]).map(([label, w]) => (
                  <th key={label} style={{ width: w, padding: '7px 10px', textAlign: ['Hrs Sent','Hrs Approved','Δ Hrs','Rate','Total ex GST'].includes(label) ? 'right' : 'left', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10 }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((r, i) => {
                const st = STATUS_STYLE[r.status]
                const sentHrs = r.sent?.hours
                const apprHrs = r.appr?.hours
                const delta   = sentHrs !== undefined && apprHrs !== undefined ? +(apprHrs - sentHrs).toFixed(2) : undefined
                const name    = r.sent?.name  || r.appr?.name  || ''
                const date    = r.sent?.date  || r.appr?.date  || ''
                const wo      = r.sent?.woTask || r.appr?.woTask || ''
                const empNo   = r.sent?.empNo  || r.appr?.empNo  || ''
                const pc      = r.sent?.payCode || ''
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: st.bg, color: st.color }}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{empNo}</td>
                    <td style={{ padding: '6px 10px' }}>{fmtDate(date)}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.appr?.woTitle || wo}>{wo || '—'}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {pc && <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: 3,
                        background: pc === 'DT1.0' ? '#dbeafe' : pc === 'DT1.5' ? '#fef3c7' : pc === 'DT2.0' ? '#fce7f3' : '#f0fdf4',
                        color:      pc === 'DT1.0' ? '#1e40af' : pc === 'DT1.5' ? '#92400e' : pc === 'DT2.0' ? '#9d174d' : '#166534' }}>{pc}</span>}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{sentHrs ?? '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{apprHrs ?? '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: delta !== undefined && Math.abs(delta) > 0.01 ? 700 : 400, color: delta !== undefined && Math.abs(delta) > 0.01 ? '#dc2626' : 'var(--text3)' }}>
                      {delta !== undefined ? (delta > 0 ? `+${delta}` : String(delta)) : '—'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{r.appr?.rate ? `$${r.appr.rate}` : '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{r.appr?.total ? fmtCurrency(r.appr.total) : '—'}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{r.appr?.resourceCode || '—'}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {r.appr?.status && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                        background: r.appr.status === 'APPROVED' ? '#d1fae5' : '#fee2e2',
                        color:      r.appr.status === 'APPROVED' ? '#065f46' : '#991b1b' }}>{r.appr.status}</span>}
                    </td>
                  </tr>
                )
              })}
              {displayed.length === 0 && (
                <tr><td colSpan={13} style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>No rows match current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </>)}

      {!loading && recon.length === 0 && apprRows.length === 0 && (
        <div className="empty-state">
          <div className="icon">🔍</div>
          <h3>Upload the NRG approvals file</h3>
          <p>Set the date range to match your submission period, then upload<br />the approvals XLSX returned by NRG to see discrepancies.</p>
        </div>
      )}
    </div>
  )
}
