/**
 * NrgScopeAllocationsPanel
 *
 * Flat table of every individual TCE scope allocation across all timesheets
 * for the project. One row per (person, date, scope, pay code, hours) —
 * the same granularity as the TAStK XLSX export rows.
 *
 * Resolves: resource ID → persons → nrg_employee_number, first/last name
 *           wo/tceItemId → nrg_tce_lines → contract_scope, work_order, description
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { downloadCSV } from '../../lib/csv'

interface NrgAlloc {
  tceItemId?: string | null
  wo?: string
  hours: number
  payCode?: string
  _tceMode?: boolean
}

interface DayEntry {
  dayType: string
  hours: number
  nrgWoAllocations?: NrgAlloc[]
}

interface CrewMember {
  personId: string
  name: string
  role: string
  days: Record<string, DayEntry>
}

interface Timesheet {
  id: string
  week_start: string
  crew: CrewMember[]
}

interface PersonMeta {
  first_name: string | null
  last_name: string | null
  full_name: string
  nrg_employee_number: string | null
}

interface TceLine {
  item_id: string | null
  work_order: string
  contract_scope: string
  description: string
}

interface AllocRow {
  // Identity
  tsId: string
  weekStart: string
  personId: string   // resource ID
  personName: string
  empNo: string
  role: string
  // Day
  date: string
  dayType: string
  // Allocation
  payCode: string
  scopeKey: string   // tceItemId or wo
  scopeType: 'tce' | 'wo'
  contract: string
  woTask: string
  description: string
  hours: number
}

function getPayCode(dayType: string): string {
  if (dayType === 'public_holiday' || dayType === 'sunday') return 'NT2.0'
  if (dayType === 'saturday') return 'DT1.5'
  return 'DT1.0'
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PAY_CODE_STYLE: Record<string, { bg: string; color: string }> = {
  'DT1.0': { bg: '#dbeafe', color: '#1e40af' },
  'DT1.5': { bg: '#fef3c7', color: '#92400e' },
  'DT2.0': { bg: '#fce7f3', color: '#9d174d' },
  'NT2.0': { bg: '#f0fdf4', color: '#166534' },
}

export function NrgScopeAllocationsPanel() {
  const { activeProject } = useAppStore()
  const pid = activeProject?.id || ''

  const [rows, setRows]         = useState<AllocRow[]>([])
  const [loading, setLoading]   = useState(false)

  // Filters
  const [search, setSearch]         = useState('')
  const [filterPayCode, setFilterPayCode] = useState('all')
  const [filterScopeType, setFilterScopeType] = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [sortCol, setSortCol]       = useState<keyof AllocRow>('date')
  const [sortAsc, setSortAsc]       = useState(true)

  useEffect(() => { if (pid) load() }, [pid])

  async function load() {
    setLoading(true)

    const [tsRes, tceRes] = await Promise.all([
      supabase.from('weekly_timesheets')
        .select('id,week_start,crew')
        .eq('project_id', pid)
        .eq('scope_tracking', 'nrg_tce')
        .order('week_start', { ascending: false }),
      supabase.from('nrg_tce_lines')
        .select('item_id,work_order,contract_scope,description')
        .eq('project_id', pid),
    ])

    const tsList = (tsRes.data || []) as Timesheet[]
    const lines  = (tceRes.data || []) as TceLine[]

    // Build TCE lookups
    const byItemId: Record<string, TceLine> = {}
    const byWo:     Record<string, TceLine> = {}
    for (const l of lines) {
      if (l.item_id)    byItemId[l.item_id]    = l
      if (l.work_order) byWo[l.work_order]      = l
    }

    // Collect resource IDs → persons
    const resourceIds = new Set<string>()
    for (const ts of tsList) for (const cm of ts.crew) if (cm.personId) resourceIds.add(cm.personId)

    const personMeta: Record<string, PersonMeta> = {}
    if (resourceIds.size > 0) {
      const { data: resData } = await supabase.from('resources').select('id,person_id').in('id', Array.from(resourceIds))
      const r2p: Record<string, string> = {}
      for (const r of (resData || [])) if (r.person_id) r2p[r.id] = r.person_id
      const personIds = [...new Set(Object.values(r2p))]
      if (personIds.length > 0) {
        const { data: pData } = await supabase.from('persons')
          .select('id,full_name,first_name,last_name,nrg_employee_number').in('id', personIds)
        const byId: Record<string, PersonMeta> = {}
        for (const p of (pData || [])) byId[p.id] = p as PersonMeta
        for (const [rId, pId] of Object.entries(r2p)) personMeta[rId] = byId[pId]
        for (const p of (pData || [])) if (!personMeta[p.id]) personMeta[p.id] = p as PersonMeta
      }
    }

    // Flatten all allocations
    const allRows: AllocRow[] = []
    for (const ts of tsList) {
      for (const cm of ts.crew) {
        const meta = personMeta[cm.personId]
        const firstName = meta?.first_name || ''
        const lastName  = meta?.last_name  || ''
        const personName = (firstName || lastName)
          ? [firstName, lastName].filter(Boolean).join(' ')
          : meta?.full_name || cm.name
        const empNo = meta?.nrg_employee_number || ''

        for (const [dateStr, day] of Object.entries(cm.days)) {
          if (!day || day.hours <= 0) continue
          const allocs = (day.nrgWoAllocations || []).filter(
            a => a.tceItemId || a.wo
          )
          if (allocs.length === 0) continue

          for (const alloc of allocs) {
            if (alloc.hours <= 0) continue
            const payCode = alloc.payCode || getPayCode(day.dayType)

            let scopeKey = '', scopeType: 'tce' | 'wo' = 'wo'
            let contract = '', woTask = '', description = ''

            if (alloc.tceItemId && byItemId[alloc.tceItemId]) {
              const l = byItemId[alloc.tceItemId]
              scopeKey    = alloc.tceItemId
              scopeType   = 'tce'
              contract    = l.contract_scope
              woTask      = l.work_order
              description = l.description
            } else if (alloc.wo && byWo[alloc.wo]) {
              const l = byWo[alloc.wo]
              scopeKey    = alloc.wo
              scopeType   = 'wo'
              contract    = l.contract_scope
              woTask      = alloc.wo
              description = l.description
            } else if (alloc.wo) {
              scopeKey  = alloc.wo
              scopeType = 'wo'
              woTask    = alloc.wo
            } else if (alloc.tceItemId) {
              scopeKey  = alloc.tceItemId
              scopeType = 'tce'
            }

            allRows.push({
              tsId: ts.id, weekStart: ts.week_start,
              personId: cm.personId, personName, empNo, role: cm.role,
              date: dateStr, dayType: day.dayType,
              payCode, scopeKey, scopeType,
              contract, woTask, description,
              hours: alloc.hours,
            })
          }
        }
      }
    }

    setRows(allRows)
    setLoading(false)
  }

  // Filtering
  const filtered = rows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    if (filterPayCode !== 'all' && r.payCode !== filterPayCode) return false
    if (filterScopeType !== 'all' && r.scopeType !== filterScopeType) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(r.personName.toLowerCase().includes(q) ||
            r.woTask.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.contract.toLowerCase().includes(q) ||
            r.scopeKey.toLowerCase().includes(q))) return false
    }
    return true
  })

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortCol] ?? ''
    const bv = b[sortCol] ?? ''
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
    return sortAsc ? cmp : -cmp
  })

  function doSort(col: keyof AllocRow) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  const SortIcon = ({ col }: { col: keyof AllocRow }) => (
    <span style={{ fontSize: 9, marginLeft: 3, color: sortCol === col ? 'var(--accent)' : 'var(--border2)' }}>
      {sortCol === col ? (sortAsc ? '↑' : '↓') : '↕'}
    </span>
  )

  const totalHours = filtered.reduce((s, r) => s + r.hours, 0)
  const uniquePeople = new Set(filtered.map(r => r.personId)).size

  // Pay codes present
  const payCodes = [...new Set(rows.map(r => r.payCode))].sort()

  function exportCSV() {
    const header = ['Week Start', 'Date', 'Person', 'Emp #', 'Role', 'Pay Code', 'Scope Key', 'Scope Type', 'Contract', 'WO / Task', 'Description', 'Hours']
    const data = sorted.map(r => [r.weekStart, r.date, r.personName, r.empNo, r.role, r.payCode, r.scopeKey, r.scopeType, r.contract, r.woTask, r.description, r.hours])
    downloadCSV([header, ...data], `nrg_scope_allocations_${activeProject?.name || 'project'}`)
  }

  const TH = ({ col, label, right }: { col: keyof AllocRow; label: string; right?: boolean }) => (
    <th onClick={() => doSort(col)} style={{ padding: '7px 10px', textAlign: right ? 'right' : 'left', cursor: 'pointer', userSelect: 'none', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10, whiteSpace: 'nowrap' }}>
      {label}<SortIcon col={col} />
    </th>
  )

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Scope Allocations</h1>
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
          Every individual TCE scope allocation across all approved and draft timesheets.
        </p>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <input className="input" style={{ maxWidth: 220, fontSize: 12 }} placeholder="Search name, WO, scope, description…"
          value={search} onChange={e => setSearch(e.target.value)} />

        <input type="date" className="input" style={{ fontSize: 12, width: 140 }} value={dateFrom}
          onChange={e => setDateFrom(e.target.value)} placeholder="From" />
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>→</span>
        <input type="date" className="input" style={{ fontSize: 12, width: 140 }} value={dateTo}
          onChange={e => setDateTo(e.target.value)} placeholder="To" />

        <select className="input" style={{ fontSize: 12, width: 110 }} value={filterPayCode}
          onChange={e => setFilterPayCode(e.target.value)}>
          <option value="all">All pay codes</option>
          {payCodes.map(pc => <option key={pc} value={pc}>{pc}</option>)}
        </select>

        <select className="input" style={{ fontSize: 12, width: 120 }} value={filterScopeType}
          onChange={e => setFilterScopeType(e.target.value)}>
          <option value="all">All types</option>
          <option value="wo">Work Orders</option>
          <option value="tce">TCE Item IDs</option>
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* Summary strip */}
      {!loading && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>
          <span><strong style={{ fontFamily: 'var(--mono)' }}>{sorted.length}</strong> rows</span>
          <span><strong style={{ fontFamily: 'var(--mono)' }}>{uniquePeople}</strong> people</span>
          <span><strong style={{ fontFamily: 'var(--mono)' }}>{totalHours.toLocaleString('en-AU', { maximumFractionDigits: 1 })}</strong> hours</span>
          {(search || dateFrom || dateTo || filterPayCode !== 'all' || filterScopeType !== 'all') && (
            <button className="btn btn-sm" style={{ fontSize: 10 }} onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setFilterPayCode('all'); setFilterScopeType('all') }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-center"><span className="spinner" /></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto', flex: 1 }}>
          <table style={{ fontSize: 12, minWidth: 1100, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <TH col="date"        label="Date"         />
                <TH col="weekStart"   label="Week"         />
                <TH col="personName"  label="Person"       />
                <TH col="empNo"       label="Emp #"        />
                <TH col="role"        label="Role"         />
                <TH col="payCode"     label="Pay Code"     />
                <TH col="contract"    label="Contract"     />
                <TH col="woTask"      label="WO / Task"    />
                <TH col="description" label="Description"  />
                <TH col="hours"       label="Hours" right  />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const pcStyle = PAY_CODE_STYLE[r.payCode] || { bg: 'var(--bg3)', color: 'var(--text2)' }
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                      WE {fmtDate((() => { const d = new Date(r.weekStart + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10) })())}
                    </td>
                    <td style={{ padding: '6px 10px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.personName}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{r.empNo || '—'}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.role}</td>
                    <td style={{ padding: '6px 10px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', padding: '2px 6px', borderRadius: 4, background: pcStyle.bg, color: pcStyle.color }}>
                        {r.payCode}
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.contract || '—'}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.woTask || '—'}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description || '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{r.hours}</td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>
                  {rows.length === 0 ? 'No TCE scope allocations found for this project.' : 'No rows match current filters.'}
                </td></tr>
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                  <td colSpan={9} style={{ padding: '7px 10px', fontSize: 12 }}>
                    Total — {sorted.length} rows · {uniquePeople} people
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                    {totalHours.toLocaleString('en-AU', { maximumFractionDigits: 1 })}h
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
