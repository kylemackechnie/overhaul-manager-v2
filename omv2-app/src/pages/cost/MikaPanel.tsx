import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface MikaLine {
  wbs: string; desc: string; level: number
  pm80tot: number; pm100: number; actuals: number; forecast: number
  monthly?: Record<string, number>
}
interface MikaData {
  projectNo: string; projectName: string; period: string
  importedAt: string; lines: MikaLine[]
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (c === '"') {
      if (inQuote && next === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (c === ',' && !inQuote) { row.push(cur); cur = '' }
    else if ((c === '\n' || (c === '\r' && next === '\n')) && !inQuote) {
      if (c === '\r') i++
      row.push(cur); cur = ''; rows.push(row); row = []
    } else if (c === '\r' && !inQuote) { row.push(cur); cur = ''; rows.push(row); row = [] }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

function parseCurrency(s: string | undefined): number {
  if (!s) return 0
  return parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0
}

const fmt = (n: number) => n === 0 ? '—' : '$' + Math.round(n).toLocaleString('en-AU')
const fmtPct = (n: number) => n === 0 ? '—' : n + '%'

export function MikaPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [mika, setMika] = useState<MikaData | null>(null)
  const [preview, setPreview] = useState<MikaData | null>(null)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('3')
  const [status, setStatus] = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [variations, setVariations] = useState<{ status: string; line_items: unknown[] }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!activeProject) return
    const m = (activeProject as typeof activeProject & { mika_data?: MikaData }).mika_data
    setMika(m || null)
    loadMikaLines()
    // Load variation_lines (not line_items blob) for VN columns
    supabase.from('variation_lines').select('variation_id,wbs,sell_total')
      .eq('project_id', activeProject.id)
      .then(r => {
        // Also load variation statuses to know approved vs pending
        supabase.from('variations').select('id,status').eq('project_id', activeProject.id)
          .then(vr => {
            const statusMap = new Map((vr.data||[]).map((v: {id:string;status:string}) => [v.id, v.status]))
            setVariations(((r.data||[]) as {variation_id:string;wbs:string;sell_total:number}[]).map(l => ({
              status: statusMap.get(l.variation_id)||'draft',
              line_items: [{ wbs: l.wbs, sell: l.sell_total }],
            })))
          })
      })
  }, [activeProject?.id])

  async function loadMikaLines() {
    if (!activeProject) return
    const { data } = await supabase.from('mika_wbs_lines')
      .select('*').eq('project_id', activeProject.id).order('sort_order')
    if (data && data.length > 0) {
      const rows = data as {wbs:string;description:string;level:number|null;pm80:number|null;pm100:number|null;forecast_tc:number|null}[]

      // Fetch live actuals from DB function for each WBS row.
      // get_mika_live_actuals(project_id, wbs) handles child prefix rollup:
      // costs tagged to 50OP.P.02.01 show up in 50OP.P.02 and 50OP.P too.
      // Covers: expenses, hire items, cars, accommodation, back_office hours.
      // Labour (timesheet) actuals require WBS on the timesheet — zero until that's populated.
      const actualsResults = await Promise.allSettled(
        rows.map(r => supabase.rpc('get_mika_live_actuals', {
          p_project_id: activeProject.id,
          p_wbs: r.wbs,
        }))
      )

      const dbLines: MikaLine[] = rows.map((r, i) => {
        const result = actualsResults[i]
        const actuals = result.status === 'fulfilled' && result.value.data !== null
          ? Number(result.value.data) : 0
        return {
          wbs: r.wbs, desc: r.description, level: r.level||1,
          pm80tot: r.pm80||0, pm100: r.pm100||0,
          actuals,
          forecast: r.forecast_tc||0,
        }
      })
      setMika(prev => prev ? { ...prev, lines: dbLines } : { projectNo:'', projectName:'', period:'', importedAt:'', lines: dbLines })
    }
  }

  function handleFile(file: File) {
    setStatus({ msg: '⏳ Reading CSV…', type: 'info' })
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const text = e.target!.result as string
        const rows = parseCSV(text)
        if (!rows.length) { setStatus({ msg: '✗ Empty file', type: 'error' }); return }

        // Find WBS Element header row
        let headerIdx = -1
        for (let i = 0; i < rows.length; i++) {
          if (rows[i][0]?.trim() === 'WBS Element') { headerIdx = i; break }
        }
        if (headerIdx < 0) { setStatus({ msg: '✗ Could not find WBS Element header row — is this a MIKA export?', type: 'error' }); return }

        const header = rows[headerIdx]
        const parentRow = headerIdx > 0 ? rows[headerIdx - 1] : []
        const getP = (i: number) => (parentRow[i] || '').trim().toLowerCase()
        const getS = (i: number) => (header[i] || '').trim().toLowerCase()

        let iPM80 = -1, iPM100 = -1, iActuals = -1, iFC = -1
        for (let i = 2; i < header.length; i++) {
          const p = getP(i), s = getS(i)
          if (iPM80 < 0 && (p.includes('pm80') || p.includes('pm080')) && s.includes('planned')) iPM80 = i
          else if (iPM100 < 0 && p.includes('pm100') && s.includes('planned')) iPM100 = i
          if (iActuals < 0 && p.includes('ptd') && s.includes('actuals')) iActuals = i
          if (iFC < 0 && (p.includes('cost-to-complete') || p.includes('cost to complete')) && s.includes('forecast')) iFC = i
        }
        if (iActuals < 0) { for (let i = 2; i < header.length; i++) { if (getS(i) === 'actuals' && iActuals < 0) iActuals = i } }
        if (iFC < 0)      { for (let i = 2; i < header.length; i++) { if (getS(i) === 'forecast' && iFC < 0) iFC = i } }
        if (iPM80 < 0) iPM80 = 2
        if (iPM100 < 0) iPM100 = 3
        if (iActuals < 0) iActuals = 9
        if (iFC < 0) iFC = 10

        // Extract meta
        let projectNo = '', projectName = '', period = ''
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const r = rows[i]
          if (r[0]?.includes('Project') && r[1]) projectName = r[1].trim()
          if (r[0]?.trim() === 'Period') period = r[1]?.trim() || ''
        }

        // Parse WBS rows
        const lines: MikaLine[] = []
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i]
          const wbs = (r[0] || '').trim()
          if (!wbs || !wbs.includes('-')) continue
          const desc = (r[1] || '').trim()
          const pm80tot = parseCurrency(r[iPM80])
          const pm100 = parseCurrency(r[iPM100])
          const actuals = parseCurrency(r[iActuals])
          const forecast = parseCurrency(r[iFC])
          const level = wbs.split('.').length - 1
          lines.push({ wbs, desc, level, pm80tot, pm100, actuals, forecast })
        }

        if (!lines.length) { setStatus({ msg: '✗ No WBS data rows found', type: 'error' }); return }

        const p: MikaData = { projectNo, projectName, period, importedAt: new Date().toISOString(), lines }
        setPreview(p)
        setStatus({ msg: `✓ Parsed ${lines.length} WBS lines — confirm to save`, type: 'success' })
      } catch (err) {
        setStatus({ msg: '✗ Parse error: ' + (err as Error).message, type: 'error' })
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  async function confirmImport() {
    if (!preview || !activeProject) return
    setSaving(true)

    // Delete existing MIKA lines for this project, then insert fresh batch
    const batchId = crypto.randomUUID()
    await supabase.from('mika_wbs_lines').delete().eq('project_id', activeProject.id)

    const inserts = preview.lines.map((l, i) => ({
      project_id: activeProject.id,
      import_batch_id: batchId,
      wbs: l.wbs, description: l.desc, level: l.level,
      pm80: l.pm80tot, pm100: l.pm100, forecast_tc: l.forecast,
      monthly_forecast: {}, sort_order: i,
    }))

    const { error } = await supabase.from('mika_wbs_lines').insert(inserts)
    if (error) { setStatus({ msg: '✗ Save error: ' + error.message, type: 'error' }); setSaving(false); return }

    // Also keep a lightweight meta blob on projects for dashboard display
    const meta = { projectNo: preview.projectNo, projectName: preview.projectName, period: preview.period, importedAt: preview.importedAt, lineCount: preview.lines.length }
    await supabase.from('projects').update({ mika_data: meta }).eq('id', activeProject.id)

    setMika(preview)
    setPreview(null)
    setStatus({ msg: `✓ Saved ${preview.lines.length} WBS lines to mika_wbs_lines`, type: 'success' })
    setSaving(false)
    // Reload WBS lines
    loadMikaLines()
  }

  async function clearMika() {
    if (!activeProject || !confirm('Clear MIKA data? This cannot be undone.')) return
    await Promise.all([
      supabase.from('mika_wbs_lines').delete().eq('project_id', activeProject.id),
      supabase.from('projects').update({ mika_data: null }).eq('id', activeProject.id),
    ])
    setMika(null)
    setActiveProject({ ...activeProject, mika_data: null } as unknown as typeof activeProject)
  }

  // VN lookups
  const vnByWbs: Record<string, { approved: number; pending: number }> = {}
  for (const v of variations) {
    const lines = (v.line_items as { wbs?: string; sell?: number }[]) || []
    for (const l of lines) {
      if (!l.wbs) continue
      if (!vnByWbs[l.wbs]) vnByWbs[l.wbs] = { approved: 0, pending: 0 }
      if (v.status === 'approved') vnByWbs[l.wbs].approved += l.sell || 0
      else if (v.status === 'draft' || v.status === 'submitted') vnByWbs[l.wbs].pending += l.sell || 0
    }
  }
  function getVn(wbs: string) {
    let approved = 0, pending = 0
    for (const [k, vn] of Object.entries(vnByWbs)) {
      if (k === wbs || k.startsWith(wbs + '.')) { approved += vn.approved; pending += vn.pending }
    }
    return { approved, pending }
  }

  // Filtered lines
  const lines = mika?.lines || []
  const q = search.toLowerCase()
  let filtered = lines.filter(l => l.level >= 1)
  if (q) filtered = filtered.filter(l => l.wbs.toLowerCase().includes(q) || l.desc.toLowerCase().includes(q))
  if (levelFilter !== 'all') filtered = filtered.filter(l => l.level <= parseInt(levelFilter))

  // Top-level KPIs
  const topLines = lines.filter(l => l.level === 1)
  const totPM80    = topLines.reduce((s, l) => s + l.pm80tot, 0)
  const totPM100   = topLines.reduce((s, l) => s + l.pm100, 0)
  const totActuals = topLines.reduce((s, l) => s + l.actuals, 0)
  const totFC      = topLines.reduce((s, l) => s + l.forecast, 0)
  const totEAC     = totActuals + totFC
  const totVar     = totPM100 - totEAC

  const statusColors = { info: 'var(--text2)', success: 'var(--green)', error: 'var(--red)' }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>MIKA Cost Plan</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Full WBS breakdown — all lines</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {mika && <button className="btn btn-sm" onClick={clearMika} style={{ color: 'var(--red)' }}>✕ Clear</button>}
          <button className="btn btn-sm" onClick={() => {
            const csv = ['WBS,Description,Level,PM80,PM100,Actuals,Forecast,EAC,Variance']
            for (const l of lines) {
              const eac = l.actuals + l.forecast
              csv.push([l.wbs, `"${l.desc}"`, l.level, l.pm80tot, l.pm100, l.actuals, l.forecast, eac, l.pm100 - eac].join(','))
            }
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv.join('\n')], { type: 'text/csv' }))
            a.download = `mika_${activeProject?.name || 'export'}.csv`; a.click()
          }} disabled={!mika}>⬇ Export CSV</button>
        </div>
      </div>

      {/* Import zone — always visible at top */}
      <div style={{ display: 'grid', gridTemplateColumns: preview ? '1fr 1fr' : '1fr', gap: '16px', marginBottom: '16px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Import MIKA Cost Plan</div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
            Upload the MIKA CSV export (Project Planning main tab). Imports WBS structure, PM80 baseline, PM100 approved budget, and PTD actuals. <strong>Replaces existing MIKA data.</strong>
          </p>
          <div
            style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius)', padding: '24px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg3)' }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)' }}
            onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
            onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          >
            <div style={{ fontSize: '28px', marginBottom: '6px' }}>📊</div>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Drop MIKA CSV here or click to browse</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>.csv — MIKA Project Planning export</div>
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
          {status && <div style={{ marginTop: '10px', fontSize: '12px', color: statusColors[status.type] }}>{status.msg}</div>}
        </div>

        {preview && (
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Preview — {preview.lines.length} WBS lines</div>
              <button className="btn btn-primary btn-sm" onClick={confirmImport} disabled={saving}>
                {saving ? '⏳ Saving…' : '✓ Confirm Import'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'PM80 Baseline', val: totPM80, color: 'var(--accent)' },
                { label: 'PM100 Budget', val: totPM100, color: '#3b82f6' },
                { label: 'PTD Actuals', val: totActuals, color: 'var(--green)' },
                { label: 'Forecast TC', val: totFC, color: 'var(--amber)' },
              ].map(k => (
                <div key={k.label} style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius)', borderTop: `2px solid ${k.color}` }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--mono)', color: k.color }}>{fmt(k.val)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{k.label}</div>
                </div>
              ))}
            </div>
            <div style={{ maxHeight: '240px', overflowY: 'auto', fontSize: '11px' }}>
              <table>
                <thead><tr><th>WBS</th><th>Description</th><th>Lvl</th><th style={{ textAlign: 'right' }}>PM80</th><th style={{ textAlign: 'right' }}>PM100</th><th style={{ textAlign: 'right' }}>Actuals</th><th style={{ textAlign: 'right' }}>Variance</th></tr></thead>
                <tbody>
                  {preview.lines.slice(0, 50).map((l, i) => {
                    const indent = '\u00a0'.repeat(Math.max(0, l.level - 1) * 3)
                    const variance = l.pm100 - l.actuals - l.forecast
                    return (
                      <tr key={i} style={{ fontWeight: l.level <= 2 ? 600 : 400 }}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{l.wbs}</td>
                        <td>{indent}{l.desc || l.wbs}</td>
                        <td style={{ textAlign: 'center', color: 'var(--text3)' }}>{l.level}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(l.pm80tot)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(l.pm100)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(l.actuals)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: variance >= 0 ? 'var(--green)' : 'var(--red)' }}>{l.pm100 ? fmt(variance) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* KPI cards when MIKA data exists */}
      {mika && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'PM80 Baseline', val: totPM80, color: 'var(--accent)' },
              { label: 'PM100 Budget', val: totPM100, color: '#3b82f6' },
              { label: 'PTD Actuals', val: totActuals, color: 'var(--green)' },
              { label: 'Forecast TC', val: totFC, color: 'var(--amber)' },
              { label: 'Budget Variance', val: totVar, color: totVar >= 0 ? 'var(--green)' : 'var(--red)' },
            ].map(k => (
              <div key={k.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${k.color}` }}>
                <div style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'var(--mono)', color: k.color }}>{fmt(k.val)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '12px' }}>
            {mika.projectNo && <span>{mika.projectNo} </span>}
            {mika.period && <span>· {mika.period} </span>}
            · Imported {mika.importedAt ? new Date(mika.importedAt).toLocaleDateString('en-AU') : ''}
            · {mika.lines.length} WBS lines
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', alignItems: 'center' }}>
            <input className="input" style={{ width: '260px' }} placeholder="Search WBS or description…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input" style={{ width: '160px' }} value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
              <option value="all">All levels</option>
              <option value="2">L2 — Top level</option>
              <option value="3">L3 — Summary</option>
              <option value="4">L4 — Detail</option>
              <option value="5">L5 — Full</option>
            </select>
            <span style={{ fontSize: '12px', color: 'var(--text3)', marginLeft: 'auto' }}>{filtered.length} rows</span>
          </div>

          {/* Full MIKA table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '11px', minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th>WBS</th><th>Description</th><th>Lvl</th>
                    <th style={{ textAlign: 'right' }}>PM80 Budget</th>
                    <th style={{ textAlign: 'right' }}>PM100 Budget</th>
                    <th style={{ textAlign: 'right', color: '#d97706' }}>Approved VNs</th>
                    <th style={{ textAlign: 'right', color: '#d97706' }}>Pending VNs</th>
                    <th style={{ textAlign: 'right', color: '#7c3aed' }}>Revised Budget</th>
                    <th style={{ textAlign: 'right' }}>PTD Actuals</th>
                    <th style={{ textAlign: 'right' }}>Forecast TC</th>
                    <th style={{ textAlign: 'right' }}>EAC</th>
                    <th style={{ textAlign: 'right' }}>Variance</th>
                    <th style={{ textAlign: 'right' }}>% Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l, i) => {
                    const vn = getVn(l.wbs)
                    const revisedBudget = l.pm100 + vn.approved
                    const eac = l.actuals + l.forecast
                    const variance = (revisedBudget || l.pm100) - eac
                    const pct = l.actuals && (revisedBudget || l.pm100) ? Math.round(l.actuals / (revisedBudget || l.pm100) * 100) : 0
                    const indent = '\u00a0'.repeat(Math.max(0, l.level - 1) * 3)
                    const bold = l.level <= 2 ? 600 : 400
                    const hasVns = vn.approved > 0 || vn.pending > 0
                    return (
                      <tr key={i} style={{ fontWeight: bold, background: hasVns ? 'rgba(245,158,11,0.04)' : 'transparent' }}>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{l.wbs}</td>
                        <td>{indent}{l.desc || '—'}</td>
                        <td style={{ textAlign: 'center', color: 'var(--text3)' }}>{l.level}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(l.pm80tot)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#3b82f6' }}>{fmt(l.pm100)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: vn.approved > 0 ? '#d97706' : 'var(--text3)' }}>{vn.approved > 0 ? fmt(vn.approved) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: vn.pending > 0 ? '#d97706' : 'var(--text3)' }}>{vn.pending > 0 ? fmt(vn.pending) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed', fontWeight: hasVns ? 700 : bold }}>{hasVns ? fmt(revisedBudget) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(l.actuals)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmt(l.forecast)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(eac)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: variance >= 0 ? 'var(--green)' : 'var(--red)' }}>{l.pm100 ? fmt(variance) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: pct > 100 ? 'var(--red)' : pct > 85 ? 'var(--amber)' : 'var(--text2)' }}>{l.pm100 ? fmtPct(pct) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!mika && !preview && (
        <div className="empty-state">
          <div className="icon">📊</div>
          <h3>No MIKA data imported yet</h3>
          <p>Upload a MIKA CSV above to get started.</p>
        </div>
      )}
    </div>
  )
}
