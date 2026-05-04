import * as XLSX from 'xlsx'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

// ── Types ──────────────────────────────────────────────────────────────────

interface SapRow {
  costElement: string; wbsElement: string; coName: string
  docNumber: string; name: string; value: number
  docDate: string; postingDate: string; hours: number
}

interface Resource { id: string; name: string; role: string }

type Tab = 'person' | 'category' | 'wbs' | 'raw'

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number) => '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtH = (n: number) => n.toFixed(1)

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, '').trim()
}

function nameSimilarity(a: string, b: string): number {
  const na = normName(a), nb = normName(b)
  if (na === nb) return 1
  // Check if both contain same first+last token
  const ta = a.trim().split(/\s+/), tb = b.trim().split(/\s+/)
  if (ta.length >= 2 && tb.length >= 2) {
    const firstMatch = normName(ta[0]) === normName(tb[0])
    const lastMatch  = normName(ta[ta.length-1]) === normName(tb[tb.length-1])
    if (firstMatch && lastMatch) return 0.95
    if (firstMatch || lastMatch) return 0.6
  }
  if (na.includes(nb) || nb.includes(na)) return 0.8
  return 0
}

// ── Main component ─────────────────────────────────────────────────────────

export function SapReconPanel() {
  const { activeProject } = useAppStore()
  const [allRows,   setAllRows]   = useState<SapRow[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [wbsList,   setWbsList]   = useState<{code:string;name:string}[]>([])
  const [loading,   setLoading]   = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileName,  setFileName]  = useState('')
  const [importDate, setImportDate] = useState('')
  const [fromDate,  setFromDate]  = useState('')
  const [toDate,    setToDate]    = useState('')
  const [tab,       setTab]       = useState<Tab>('person')

  // BO import modal
  const [boModal,   setBoModal]   = useState(false)
  const [boSel,     setBoSel]     = useState<Set<string>>(new Set())

  // load project context (resources + wbs) when needed
  async function loadContext() {
    if (!activeProject) return
    const pid = activeProject.id
    const [rRes, wRes] = await Promise.all([
      supabase.from('resources').select('id,name,role').eq('project_id', pid),
      supabase.from('wbs_list').select('code,name').eq('project_id', pid),
    ])
    setResources((rRes.data || []) as Resource[])
    setWbsList((wRes.data || []) as {code:string;name:string}[])
  }

  // ── File parsing ─────────────────────────────────────────────────────────

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    if (!file.name.toLowerCase().endsWith('.xlsx')) { toast('Please select a .xlsx file', 'error'); return }
    setFileName(file.name); setLoading(true)
    await loadContext()

    const buf = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]

      const rows: SapRow[] = raw.map(r => ({
        costElement: String(r['Cost Element'] || '').replace(/\.0$/, ''),
        wbsElement:  String(r['WBS Element'] || ''),
        coName:      String(r['CO object name'] || ''),
        docNumber:   String(r['Document Number'] || ''),
        name:        String(r['Name'] || ''),
        value:       parseFloat(String(r['Val/COArea Crcy'] || '0')) || 0,
        docDate:     r['Document Date'] instanceof Date
          ? (r['Document Date'] as Date).toISOString().slice(0, 10)
          : String(r['Document Date'] || '').slice(0, 10),
        postingDate: r['Posting Date'] instanceof Date
          ? (r['Posting Date'] as Date).toISOString().slice(0, 10)
          : String(r['Posting Date'] || '').slice(0, 10),
        hours:       parseFloat(String(r['Total quantity'] || '0')) || 0,
      })).filter(r => {
        if (r.value === 0 && r.hours === 0) return false
        if (/recovery/i.test(r.name)) return false
        if (r.costElement === '66790000') return false
        return true
      })

      const dates = rows.map(r => r.docDate).filter(Boolean).sort()
      setFromDate(dates[0] || '')
      setToDate(dates[dates.length - 1] || '')
      setAllRows(rows)
      setImportDate(new Date().toISOString().slice(0, 10))
      toast(`Loaded ${rows.length} rows from ${file.name}`, 'success')
    } catch {
      toast('Failed to parse file. Ensure it is a valid SAP XLSX export.', 'error')
    }
    setLoading(false)
    e.target.value = ''
  }

  // ── Filtered rows ─────────────────────────────────────────────────────────

  const rows = allRows.filter(r => {
    if (fromDate && r.docDate < fromDate) return false
    if (toDate   && r.docDate > toDate)   return false
    return true
  })

  const sapTotal = rows.reduce((s, r) => s + r.value, 0)
  const sapHours = rows.filter(r => r.costElement === '61800160').reduce((s, r) => s + r.hours, 0)

  // ── By Person tab ─────────────────────────────────────────────────────────

  const labourRows = rows.filter(r => r.costElement === '61800160')
  const sapByPerson: Record<string, { hours: number; cost: number; coNames: Set<string> }> = {}
  labourRows.forEach(r => {
    if (!sapByPerson[r.name]) sapByPerson[r.name] = { hours: 0, cost: 0, coNames: new Set() }
    sapByPerson[r.name].hours += r.hours
    sapByPerson[r.name].cost  += r.value
    sapByPerson[r.name].coNames.add(r.coName)
  })

  // ── By Category tab ───────────────────────────────────────────────────────

  const sapByCat: Record<string, number> = {}
  rows.forEach(r => {
    const cat = r.coName || r.costElement || 'Unknown'
    sapByCat[cat] = (sapByCat[cat] || 0) + r.value
  })

  // ── By WBS tab ────────────────────────────────────────────────────────────

  const sapByWbs: Record<string, number> = {}
  rows.forEach(r => { sapByWbs[r.wbsElement] = (sapByWbs[r.wbsElement] || 0) + r.value })

  function matchOurWbs(sapWbs: string): string | null {
    for (const w of wbsList) { if (sapWbs.includes(w.code)) return w.code }
    return null
  }

  // ── Back office import ────────────────────────────────────────────────────

  const boPersons = Object.entries(sapByPerson).map(([name, data]) => {
    const rates = labourRows.filter(r => r.name === name && r.hours > 0).map(r => r.value / r.hours).sort((a, b) => a - b)
    const impliedRate = rates.length ? rates[Math.floor(rates.length / 2)] : 0
    return { name, hours: data.hours, cost: data.cost, impliedRate, lines: labourRows.filter(r => r.name === name).length }
  }).sort((a, b) => a.name.localeCompare(b.name))

  async function confirmBoImport() {
    const pid = activeProject!.id
    const toImport = boPersons.filter(p => boSel.has(p.name))
    if (!toImport.length) { toast('Select at least one person', 'error'); return }
    setImporting(true)

    // Find best matching role from resources
    function bestRole(name: string): string {
      let best = '', score = 0
      resources.forEach(r => {
        const s = nameSimilarity(name, r.name)
        if (s > score) { score = s; best = r.role }
      })
      return best || 'Back Office'
    }

    const entries = toImport.map(p => ({
      project_id: pid,
      name: p.name, role: bestRole(p.name),
      hours: p.hours, cost: p.cost,
      date: fromDate || toDate || new Date().toISOString().slice(0, 10),
      source: 'sap_import', notes: `Imported from SAP — ${p.lines} lines, implied rate $${p.impliedRate.toFixed(2)}/hr`,
    }))

    const { error } = await supabase.from('back_office_hours').insert(entries)
    if (error) { toast(error.message, 'error'); setImporting(false); return }
    toast(`${entries.length} back-office entries imported`, 'success')
    setImporting(false); setBoModal(false)
  }

  // ── Export CSV ────────────────────────────────────────────────────────────

  function exportCsv() {
    const lines = [['Cost Element', 'WBS Element', 'CO Name', 'Doc Number', 'Name', 'Value', 'Hours', 'Doc Date']]
    rows.forEach(r => lines.push([r.costElement, r.wbsElement, r.coName, r.docNumber, r.name, String(r.value), String(r.hours), r.docDate]))
    const csv = lines.map(l => l.map(c => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'sap-export.csv'; a.click()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: 'person',   label: '👤 By Person (Labour)' },
    { key: 'category', label: '📂 By Category' },
    { key: 'wbs',      label: '🗂 By WBS' },
    { key: 'raw',      label: `📄 Raw (${rows.length})` },
  ]

  const BADGE = {
    ok:   { background: 'rgba(16,185,129,.15)', color: '#059669' },
    warn: { background: 'rgba(245,158,11,.15)',  color: '#d97706' },
    err:  { background: 'rgba(239,68,68,.15)',   color: '#dc2626' },
    info: { background: 'rgba(99,102,241,.15)',  color: '#4f46e5' },
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>🔍 SAP Reconciliation</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            Compare SAP cost exports against internally tracked costs
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {rows.length > 0 && labourRows.length > 0 && (
            <button className="btn btn-secondary" onClick={() => { setBoModal(true); setBoSel(new Set(boPersons.map(p => p.name))) }}>
              📥 Import BO Hours
            </button>
          )}
          {rows.length > 0 && <button className="btn btn-sm" onClick={exportCsv}>⬇ CSV</button>}
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            📂 Load SAP Export (.xlsx)
            <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>

      {/* Cards row */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>

        {/* Import info */}
        {fileName && (
          <div className="card" style={{ flex: '0 0 300px', padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '8px' }}>📄 Loaded File</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '4px' }}>✓ <strong>{fileName}</strong></div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
              {importDate} · {allRows.length} rows · {fmt(allRows.reduce((s,r)=>s+r.value,0))}
            </div>
          </div>
        )}

        {/* Date filter */}
        {allRows.length > 0 && (
          <div className="card" style={{ flex: '0 0 260px', padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '8px' }}>📅 Date Range Filter</div>
            <div className="fg-row" style={{ gap: '8px' }}>
              <div className="fg" style={{ margin: 0 }}>
                <label style={{ fontSize: '10px' }}>From</label>
                <input type="date" className="input" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ fontSize: '11px' }} />
              </div>
              <div className="fg" style={{ margin: 0 }}>
                <label style={{ fontSize: '10px' }}>To</label>
                <input type="date" className="input" value={toDate} onChange={e => setToDate(e.target.value)} style={{ fontSize: '11px' }} />
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        {rows.length > 0 && (
          <div className="card" style={{ flex: '1 1 220px', padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '8px' }}>📊 Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ padding: '8px', background: 'var(--bg3)', borderRadius: '5px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text3)' }}>SAP TOTAL</div>
                <div style={{ fontSize: '15px', fontWeight: 700 }}>{fmt(sapTotal)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{rows.length} rows</div>
              </div>
              <div style={{ padding: '8px', background: 'var(--bg3)', borderRadius: '5px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text3)' }}>LABOUR HRS</div>
                <div style={{ fontSize: '15px', fontWeight: 700 }}>{fmtH(sapHours)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)' }}>cost elem. 61800160</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && <div className="loading-center"><span className="spinner" /> Parsing SAP export...</div>}

      {!loading && allRows.length === 0 && (
        <div className="empty-state">
          <div className="icon">🔄</div>
          <h3>No data loaded</h3>
          <p>Upload an SAP export XLSX. The parser detects columns: Cost Element, WBS Element, CO object name, Document Number, Name, Val/COArea Crcy, Total quantity, Document Date.</p>
        </div>
      )}

      {/* Tabs */}
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '2px', borderBottom: '2px solid var(--border)', marginBottom: '0' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '8px 16px', fontSize: '12px', fontWeight: 600, border: 'none',
                background: tab === t.key ? 'var(--bg2)' : 'transparent',
                color: tab === t.key ? 'var(--accent)' : 'var(--text2)',
                borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: '-2px', cursor: 'pointer', borderRadius: '6px 6px 0 0',
              }}>{t.label}</button>
            ))}
          </div>

          <div style={{ paddingTop: '12px' }}>

            {/* BY PERSON */}
            {tab === 'person' && (() => {
              const personRows = Object.keys(sapByPerson).sort().map(sapName => {
                const sap = sapByPerson[sapName]
                // match against resources
                let bestRes: Resource | null = null, bestScore = 0
                resources.forEach(r => {
                  const s = nameSimilarity(sapName, r.name)
                  if (s > bestScore) { bestScore = s; bestRes = r }
                })
                const matched = bestScore >= 0.6 ? bestRes : null
                const dCost = matched ? sap.cost - 0 : sap.cost // we don't have per-person cost from DB here
                let badge: keyof typeof BADGE, status: string
                if (!matched) { badge = 'err'; status = '❌ No resource match' }
                else if (bestScore >= 0.95) { badge = 'ok'; status = '✅ Matched' }
                else { badge = 'warn'; status = '⚠️ Fuzzy match' }
                return { sapName, sap, matched, bestScore, badge, status, cats: [...sap.coNames].join(', '), dCost }
              })

              return (
                <div className="table-scroll-x">
                  <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px' }}>
                    Matching SAP labour entries (cost element 61800160) against project resources.
                  </p>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name (SAP)</th><th>Category</th>
                        <th style={{ textAlign: 'right' }}>SAP Hrs</th>
                        <th style={{ textAlign: 'right' }}>SAP Cost</th>
                        <th>Matched Resource</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personRows.map(r => (
                        <tr key={r.sapName}>
                          <td style={{ fontWeight: 600, fontSize: '12px' }}>{r.sapName}</td>
                          <td style={{ fontSize: '11px', color: 'var(--text3)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cats || '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmtH(r.sap.hours)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.sap.cost)}</td>
                          <td style={{ fontSize: '11px', color: r.matched ? 'var(--text)' : 'var(--text3)' }}>
                            {r.matched ? <>{(r.matched as Resource).name}<span style={{ fontSize: '10px', color: 'var(--text3)', marginLeft: '4px' }}>({Math.round(r.bestScore * 100)}%)</span></> : '—'}
                          </td>
                          <td><span className="badge" style={BADGE[r.badge]}>{r.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg3)' }}>
                        <td colSpan={2}>TOTALS ({personRows.length} people)</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtH(personRows.reduce((s, r) => s + r.sap.hours, 0))}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(personRows.reduce((s, r) => s + r.sap.cost, 0))}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })()}

            {/* BY CATEGORY */}
            {tab === 'category' && (() => {
              const catRows = Object.entries(sapByCat).sort(([,a],[,b]) => b - a)
              const catTotal = catRows.reduce((s,[,v]) => s + v, 0)
              return (
                <div className="table-scroll-x">
                  <table className="data-table">
                    <thead><tr><th>CO Object Name / Category</th><th style={{ textAlign: 'right' }}>SAP Value</th><th style={{ textAlign: 'right' }}>% of Total</th></tr></thead>
                    <tbody>
                      {catRows.map(([cat, val]) => (
                        <tr key={cat}>
                          <td style={{ fontSize: '12px' }}>{cat || '(Unknown)'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>{fmt(val)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>
                            {catTotal > 0 ? (val / catTotal * 100).toFixed(1) + '%' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg3)' }}>
                        <td>TOTAL ({catRows.length} categories)</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(catTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })()}

            {/* BY WBS */}
            {tab === 'wbs' && (() => {
              const wbsRows = Object.entries(sapByWbs).sort(([,a],[,b]) => b - a).map(([wbs, sapVal]) => {
                const ourKey = matchOurWbs(wbs)
                const wbsInfo = wbsList.find(w => wbs.includes(w.code) || w.code === wbs)
                const delta = sapVal // we don't have per-WBS cost from timesheets in this view
                let badge: keyof typeof BADGE = 'info', status = '— No WBS match'
                if (ourKey) { badge = 'ok'; status = `✅ → ${ourKey}` }
                else if (sapVal > 500) { badge = 'warn'; status = '⚠️ No match' }
                return { wbs, wbsName: wbsInfo?.name || '', ourKey, sapVal, delta, badge, status }
              })
              const wbsTotal = wbsRows.reduce((s, r) => s + r.sapVal, 0)
              return (
                <div className="table-scroll-x">
                  <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px' }}>
                    SAP uses full WBS paths (e.g. 50OC-0002031.01.01.01). Our codes match inner segments.
                  </p>
                  <table className="data-table">
                    <thead><tr><th>SAP WBS Element</th><th>Name</th><th>Our WBS</th><th style={{ textAlign: 'right' }}>SAP Total</th><th>Status</th></tr></thead>
                    <tbody>
                      {wbsRows.map(r => (
                        <tr key={r.wbs}>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{r.wbs}</td>
                          <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{r.wbsName || '—'}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: r.ourKey ? 'var(--text)' : 'var(--text3)' }}>{r.ourKey || '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>{fmt(r.sapVal)}</td>
                          <td><span className="badge" style={BADGE[r.badge]}>{r.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg3)' }}>
                        <td colSpan={3}>TOTAL ({wbsRows.length} WBS elements)</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(wbsTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })()}

            {/* RAW */}
            {tab === 'raw' && (
              <div className="table-scroll-x">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cost Element</th><th>WBS</th><th>Name</th><th>CO Name</th>
                      <th style={{ textAlign: 'right' }}>Value</th>
                      <th style={{ textAlign: 'right' }}>Hours</th>
                      <th>Doc Date</th><th>Doc #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{r.costElement}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{r.wbsElement}</td>
                        <td style={{ fontSize: '11px', fontWeight: 500 }}>{r.name || '—'}</td>
                        <td style={{ fontSize: '10px', color: 'var(--text3)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.coName}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600, color: r.value < 0 ? 'var(--red)' : undefined }}>{fmt(r.value)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{r.hours ? fmtH(r.hours) : '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{r.docDate || r.postingDate || '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{r.docNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* BO Import Modal */}
      {boModal && (
        <div className="modal-overlay open">
          <div className="modal" style={{ maxWidth: '620px', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">📥 Import Back Office Hours from SAP</div>
            <p className="text-muted mb-14">
              Select the people whose SAP labour lines you want to import into Back Office Hours.
              Roles are matched from existing project resources.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button className="btn btn-secondary btn-xs" onClick={() => setBoSel(new Set(boPersons.map(p => p.name)))}>Select All</button>
              <button className="btn btn-secondary btn-xs" onClick={() => setBoSel(new Set())}>None</button>
            </div>
            <table className="data-table" style={{ marginBottom: '12px' }}>
              <thead><tr><th style={{ width: '36px' }}></th><th>Name</th><th style={{ textAlign: 'right' }}>Hrs</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Implied Rate</th></tr></thead>
              <tbody>
                {boPersons.map(p => (
                  <tr key={p.name}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={boSel.has(p.name)}
                        onChange={() => setBoSel(s => { const n = new Set(s); s.has(p.name) ? n.delete(p.name) : n.add(p.name); return n })} />
                    </td>
                    <td style={{ fontWeight: 600, fontSize: '12px' }}>{p.name}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmtH(p.hours)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(p.cost)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>${p.impliedRate.toFixed(2)}/hr</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-footer">
              <span style={{ fontSize: '11px', color: 'var(--text3)', marginRight: 'auto' }}>Role matched from closest resource name</span>
              <button className="btn btn-secondary" onClick={() => setBoModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={importing || boSel.size === 0} onClick={confirmBoImport}>
                {importing ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null}
                Import {boSel.size} Selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
