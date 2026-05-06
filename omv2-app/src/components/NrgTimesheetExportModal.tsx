/**
 * NrgTimesheetExportModal — zip/XML approach
 * Unzips the template, patches sheet1.xml + sharedStrings.xml, rezips.
 * All logos, formatting, styles preserved exactly.
 */
import { useState, useEffect } from 'react'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { toast } from './ui/Toast'
import type { NrgTceLine } from '../types'
import { NRG_TIMESHEET_TEMPLATE_B64 } from './nrgTimesheetTemplate'

interface TimesheetRow {
  id: string; week_start: string; scope_tracking: string; regime: string; crew: CrewMember[]
}
interface CrewMember {
  personId: string; name: string; role: string; days: Record<string, DayEntry>
}
interface DayEntry {
  dayType: string; shiftType: string; hours: number; nrgWoAllocations?: NrgAlloc[]
}
interface NrgAlloc { tceItemId?: string | null; wo?: string; hours: number }
interface PersonMeta {
  id: string; first_name: string | null; last_name: string | null
  full_name: string; nrg_employee_number: string | null
}
interface ExportRow {
  name: string; empNo: string; position: string; contract: string
  woTask: string; dateSerial: number; hours: number
}

const ROLE_MAP: Record<string, string> = {
  'Fitter': 'FITTER', 'Rigger': 'RIGGER', 'Crane Operator': 'CRANEOP',
  'Trades Assistant': 'TRADEASSIST', 'Administrator - Site': 'ADMIN',
  'Plant Supervisor': 'SUPERVISOR', 'Project Manager': 'PROJECTMGR',
  'QA / Project Engineer': 'QAENGINEER', 'Safety Officer': 'SAFETYOFF',
}

function toTradeLabel(role: string) {
  return ROLE_MAP[role] || role.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}
function getPayCode(dayType: string) {
  if (dayType === 'public_holiday' || dayType === 'sunday') return 'NT2.0'
  if (dayType === 'saturday') return 'DT1.5'
  return 'DT1.0'
}
function toExcelSerial(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
}
function xmlEsc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}

function buildXlsx(rows: ExportRow[]): Uint8Array {
  // Decode template
  const binary = atob(NRG_TIMESHEET_TEMPLATE_B64)
  const templateBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) templateBytes[i] = binary.charCodeAt(i)

  const files = unzipSync(templateBytes)
  const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml'])
  const ssXml    = strFromU8(files['xl/sharedStrings.xml'])

  // Parse shared strings
  const strings: string[] = [...ssXml.matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)]
    .map(m => m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'"))
  const strMap: Record<string,number> = {}
  strings.forEach((s,i) => { strMap[s] = i })
  function getOrAdd(s: string) {
    if (strMap[s] === undefined) { strMap[s] = strings.length; strings.push(s) }
    return strMap[s]
  }

  // Build new data rows — style indices from template row 6: A=27,B=26,C=27,D=28,E=32,G=29,J=28
  const dataRowsXml = rows.map((row, i) => {
    const r = 6 + i
    return (
      `<row r="${r}" spans="1:16">` +
      `<c r="A${r}" s="27" t="s"><v>${getOrAdd(row.name)}</v></c>` +
      `<c r="B${r}" s="26" t="s"><v>${getOrAdd(row.empNo)}</v></c>` +
      `<c r="C${r}" s="27" t="s"><v>${getOrAdd(row.position)}</v></c>` +
      `<c r="D${r}" s="28" t="s"><v>${getOrAdd(row.contract)}</v></c>` +
      `<c r="E${r}" s="32" t="s"><v>${getOrAdd(row.woTask)}</v></c>` +
      `<c r="G${r}" s="29"><v>${row.dateSerial}</v></c>` +
      `<c r="J${r}" s="28"><v>${row.hours}</v></c>` +
      `</row>`
    )
  }).join('')

  // Splice into sheetData: keep rows 1-5 verbatim, replace 6+
  const sdOpen  = sheetXml.indexOf('<sheetData>')
  const sdClose = sheetXml.indexOf('</sheetData>') + '</sheetData>'.length
  const sdInner = sheetXml.slice(sdOpen + '<sheetData>'.length, sheetXml.indexOf('</sheetData>'))

  let headerRowsXml = ''
  for (let rn = 1; rn <= 5; rn++) {
    const m = sdInner.match(new RegExp(`<row r="${rn}"[\\s\\S]*?</row>`))
    if (m) headerRowsXml += m[0]
  }

  let newSheetXml = (
    sheetXml.slice(0, sdOpen) +
    `<sheetData>${headerRowsXml}${dataRowsXml}</sheetData>` +
    sheetXml.slice(sdClose)
  ).replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:J${5 + rows.length}"/>`)

  // Rebuild sharedStrings
  const count = strings.length
  const newSiEntries = strings.map(s => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')
  const newSsXml = ssXml
    .replace(/(<sst[^>]*count=")[^"]*(")/,       `$1${count}$2`)
    .replace(/(<sst[^>]*uniqueCount=")[^"]*(")/,  `$1${count}$2`)
    .replace(/<si>[\s\S]*?<\/si>/g, '')
    .replace('</sst>', newSiEntries + '</sst>')

  // Rezip
  const outFiles: Record<string,Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) {
    if (name === 'xl/worksheets/sheet1.xml') outFiles[name] = strToU8(newSheetXml)
    else if (name === 'xl/sharedStrings.xml') outFiles[name] = strToU8(newSsXml)
    else outFiles[name] = data as Uint8Array
  }
  return zipSync(outFiles, { level: 6 })
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

interface Props { onClose: () => void }

export function NrgTimesheetExportModal({ onClose }: Props) {
  const { activeProject } = useAppStore()
  const pid = activeProject?.id || ''

  const [loading, setLoading]               = useState(true)
  const [generating, setGenerating]         = useState(false)
  const [timesheets, setTimesheets]         = useState<TimesheetRow[]>([])
  const [tceLines, setTceLines]             = useState<NrgTceLine[]>([])
  const [personMeta, setPersonMeta]         = useState<Record<string,PersonMeta>>({})
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [contractPrefix, setContractPrefix] = useState('')

  useEffect(() => { if (pid) load() }, [pid])

  async function load() {
    setLoading(true)
    const [tsRes, tceRes] = await Promise.all([
      supabase.from('weekly_timesheets').select('id,week_start,scope_tracking,regime,crew')
        .eq('project_id', pid).eq('scope_tracking', 'nrg_tce').order('week_start', { ascending: false }),
      supabase.from('nrg_tce_lines').select('id,item_id,work_order,contract_scope,source,description')
        .eq('project_id', pid),
    ])
    const tsList = (tsRes.data || []) as TimesheetRow[]
    const lines  = (tceRes.data || []) as NrgTceLine[]
    setTimesheets(tsList)
    setTceLines(lines)

    const firstSkilled = lines.find(l => l.source === 'skilled' && l.contract_scope?.trim())
    if (firstSkilled) setContractPrefix(firstSkilled.contract_scope.trim().replace(/^0+/,'').split('/')[0])

    // Collect all unique personIds from crew (these are resource IDs, not persons IDs)
    const resourceIds = new Set<string>()
    for (const ts of tsList) for (const cm of (ts.crew||[])) if (cm.personId) resourceIds.add(cm.personId)
    if (resourceIds.size > 0) {
      // Resolve resource IDs → person_id, then fetch persons records
      const { data: resData } = await supabase
        .from('resources')
        .select('id,person_id')
        .in('id', Array.from(resourceIds))
      // Build map: resourceId → personId
      const resourceToPersonId: Record<string, string> = {}
      for (const r of (resData || [])) if (r.person_id) resourceToPersonId[r.id] = r.person_id
      const personIds = [...new Set(Object.values(resourceToPersonId))]
      const { data } = await supabase.from('persons')
        .select('id,full_name,first_name,last_name,nrg_employee_number').in('id', personIds)
      // Build final map: resourceId → PersonMeta
      const personById: Record<string, PersonMeta> = {}
      for (const p of (data||[])) personById[p.id] = p as PersonMeta
      const map: Record<string,PersonMeta> = {}
      for (const [resId, persId] of Object.entries(resourceToPersonId)) map[resId] = personById[persId]
      // Also index directly by personId in case some crew entries use person ID directly
      for (const p of (data||[])) if (!map[p.id]) map[p.id] = p as PersonMeta
      setPersonMeta(map)
    }
    setLoading(false)
  }

  const tceByItemId: Record<string,{contract:string;wo:string}> = {}
  const tceByWo:     Record<string,{contract:string;wo:string}> = {}
  // Only skilled lines appear in the TAStK export
  const skilledItemIds = new Set<string>()
  const skilledWos     = new Set<string>()
  for (const l of tceLines) {
    if (l.item_id)    tceByItemId[l.item_id]    = { contract: l.contract_scope||'', wo: l.work_order||'' }
    if (l.work_order) tceByWo[l.work_order]      = { contract: l.contract_scope||'', wo: l.work_order }
    if (l.source === 'skilled') {
      if (l.item_id)    skilledItemIds.add(l.item_id)
      if (l.work_order) skilledWos.add(l.work_order)
    }
  }

  function isSkilled(a: NrgAlloc): boolean {
    if (a.tceItemId && skilledItemIds.has(a.tceItemId)) return true
    if (a.wo && skilledWos.has(a.wo)) return true
    // WO-only allocs (no tceItemId resolved yet): check if any skilled line has this WO
    return false
  }

  function resolveContractWo(a: NrgAlloc) {
    if (a.tceItemId && tceByItemId[a.tceItemId]) { const e=tceByItemId[a.tceItemId]; return { contract:e.contract, woTask:e.wo } }
    if (a.wo && tceByWo[a.wo])                   { const e=tceByWo[a.wo];            return { contract:e.contract, woTask:e.wo } }
    return { contract:'', woTask: a.wo||'' }
  }

  function buildRows(from: string, to: string): ExportRow[] {
    const rows: ExportRow[] = []
    for (const ts of timesheets) {
      // Skip timesheets whose entire week is outside range
      const weekEnd = (() => { const d = new Date(ts.week_start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0,10) })()
      if (weekEnd < from || ts.week_start > to) continue
      for (const cm of (ts.crew||[])) {
        const meta     = personMeta[cm.personId]
        const empNo    = meta?.nrg_employee_number || ''
        const trade    = toTradeLabel(cm.role)
        const fullName = meta
          ? [meta.first_name||'', meta.last_name||''].filter(Boolean).join(' ') || meta.full_name
          : cm.name
        for (const [dateStr, day] of Object.entries(cm.days)) {
          // Filter individual days by the date range
          if (dateStr < from || dateStr > to) continue
          if (!day || day.hours <= 0) continue
          const allocs = (day.nrgWoAllocations || []).filter(a => isSkilled(a))
          if (allocs.length === 0) continue
          const dateSerial = toExcelSerial(dateStr)
          for (const alloc of allocs) {
            if (alloc.hours <= 0) continue
            const payCode = (alloc as {payCode?: string}).payCode || getPayCode(day.dayType)
            const position = contractPrefix ? `${contractPrefix}-${trade}-${payCode}` : `${trade}-${payCode}`
            const { contract, woTask } = resolveContractWo(alloc)
            rows.push({ name:fullName, empNo, position, contract, woTask, dateSerial, hours:alloc.hours })
          }
        }
      }
    }
    return rows.sort((a,b) => a.dateSerial - b.dateSerial || a.name.localeCompare(b.name))
  }

  const hasRange = dateFrom && dateTo && dateFrom <= dateTo

  function generate() {
    if (!hasRange) { toast('Select a valid date range', 'info'); return }
    setGenerating(true)
    try {
      const rows = buildRows(dateFrom, dateTo)
      if (rows.length === 0) { toast('No allocation data found for selected date range', 'info'); setGenerating(false); return }
      const bytes = buildXlsx(rows)
      // Filename: from and to dates
      const fmtFile = (d: string) => { const [y,_m,dd] = d.split('-'); return `${dd}-${new Date(d+'T00:00:00Z').toLocaleDateString('en-AU',{month:'short',timeZone:'UTC'})}-${y}` }
      const suffix = dateFrom === dateTo ? fmtFile(dateFrom) : `${fmtFile(dateFrom)}_to_${fmtFile(dateTo)}`
      downloadBytes(bytes, `NRG_Timesheet_${suffix}.xlsx`)
      toast(`Exported ${rows.length} rows`, 'success')
      onClose()
    } catch(e) { console.error(e); toast('Export failed — see console', 'error') }
    setGenerating(false)
  }

  const missingEmpNo = (() => {
    if (!hasRange) return []
    const seen = new Set<string>(); const missing: string[] = []
    for (const ts of timesheets) {
      const weekEnd = (() => { const d = new Date(ts.week_start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0,10) })()
      if (weekEnd < dateFrom || ts.week_start > dateTo) continue
      for (const cm of (ts.crew||[])) {
        if (!seen.has(cm.personId)) { seen.add(cm.personId); if (!personMeta[cm.personId]?.nrg_employee_number) missing.push(cm.name) }
      }
    }
    return missing
  })()

  const previewCount = hasRange ? buildRows(dateFrom, dateTo).length : 0

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:800 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--bg)', borderRadius:10, width:520, maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 8px 40px rgba(0,0,0,0.25)', overflow:'hidden' }}>
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <h2 style={{ fontSize:15, fontWeight:700, margin:0 }}>Export NRG Weekly Timesheet</h2>
              <p style={{ fontSize:12, color:'var(--text3)', margin:'3px 0 0' }}>Produces client-facing XLSX in the NRG TAStK format</p>
            </div>
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>

        <div style={{ flex:1, overflow:'auto', padding:'18px 20px' }}>
          {loading ? <div className="loading-center"><span className="spinner"/></div> : <>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:4 }}>NRG Contract Prefix</label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input className="input" style={{ width:120, fontSize:13 }} value={contractPrefix}
                  onChange={e => setContractPrefix(e.target.value.trim())} placeholder="e.g. 173164"/>
                <span style={{ fontSize:11, color:'var(--text3)' }}>
                  Position: <code style={{ background:'var(--bg3)', padding:'1px 5px', borderRadius:3 }}>
                    {contractPrefix||'______'}-FITTER-DT1.0
                  </code>
                </span>
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:8 }}>Date Range</label>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:3 }}>From</div>
                  <input type="date" className="input" style={{ width:'100%', fontSize:13 }}
                    value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div style={{ paddingTop:16, color:'var(--text3)', fontSize:13 }}>→</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:3 }}>To</div>
                  <input type="date" className="input" style={{ width:'100%', fontSize:13 }}
                    value={dateTo} onChange={e => setDateTo(e.target.value)}
                    min={dateFrom || undefined} />
                </div>
              </div>
              {dateFrom && dateTo && dateFrom > dateTo && (
                <div style={{ fontSize:11, color:'var(--red)', marginTop:6 }}>End date must be on or after start date</div>
              )}
              {/* Quick-select buttons */}
              <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
                {(() => {
                  const btn = (label: string, from: string, to: string) => (
                    <button key={label} className="btn btn-sm" style={{ fontSize:10 }}
                      onClick={() => { setDateFrom(from); setDateTo(to) }}>{label}</button>
                  )
                  const today = new Date()
                  const iso = (d: Date) => d.toISOString().slice(0,10)
                  // Most recent week
                  const monOffset = (today.getDay() + 6) % 7
                  const mon = new Date(today); mon.setDate(today.getDate() - monOffset)
                  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
                  // Previous week
                  const prevMon = new Date(mon); prevMon.setDate(mon.getDate() - 7)
                  const prevSun = new Date(prevMon); prevSun.setDate(prevMon.getDate() + 6)
                  // This month
                  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
                  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0)
                  // Available week ranges from timesheets
                  const allWeeks = [...new Set(timesheets.map(t => t.week_start))].sort()
                  const firstWeek = allWeeks[0]
                  const lastWeek  = allWeeks[allWeeks.length - 1]
                  const lastWeekEnd = lastWeek ? (() => { const d = new Date(lastWeek+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+6); return iso(d) })() : ''
                  return [
                    btn('This week',  iso(mon), iso(sun)),
                    btn('Last week',  iso(prevMon), iso(prevSun)),
                    btn('This month', iso(monthStart), iso(monthEnd)),
                    ...(firstWeek && lastWeekEnd ? [btn('All data', firstWeek, lastWeekEnd)] : []),
                  ]
                })()}
              </div>
            </div>

            {hasRange && missingEmpNo.length > 0 && (
              <div style={{ background:'#fef9c3', border:'1px solid #fde047', borderRadius:6, padding:'10px 12px', marginBottom:12, fontSize:12 }}>
                <div style={{ fontWeight:600, color:'#854d0e', marginBottom:4 }}>⚠ {missingEmpNo.length} person{missingEmpNo.length!==1?'s':''} missing NRG Employee Number</div>
                <div style={{ color:'#92400e', lineHeight:1.5 }}>{missingEmpNo.join(', ')}</div>
                <div style={{ color:'#a16207', marginTop:4, fontSize:11 }}>Set via Resources → person icon → Profile Fields. Export proceeds with blank Employee No.</div>
              </div>
            )}

            {hasRange && (
              <div style={{ background:'var(--bg3)', borderRadius:6, padding:'8px 12px', fontSize:12, color:'var(--text2)' }}>
                {previewCount === 0 ? 'No allocation rows found for this date range — check timesheets have TCE scope allocated.'
                  : <><strong>{previewCount}</strong> rows will be exported</>}
              </div>
            )}
          </>}
        </div>

        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', flexShrink:0, display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={generating||loading||!hasRange} onClick={generate}>
            {generating ? 'Generating…' : '⬇ Download XLSX'}
          </button>
        </div>
      </div>
    </div>
  )
}
