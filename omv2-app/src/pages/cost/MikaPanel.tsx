import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { aggregateAllCostsByWbs, type SeSupportEntry } from '../../engines/wbsAggregator'
import { buildForecast } from '../../engines/forecastEngine'
import { buildPoCommitments, type PoCommitmentWarning } from '../../engines/poCommitmentsEngine'
import { HelpButton } from '../../components/HelpButton'
import type { Resource, RateCard, WeeklyTimesheet, ToolingCosting, GlobalTV, GlobalDepartment,
  HireItem, Car, Accommodation, Expense, BackOfficeHour, Variation, VariationLine,
  PurchaseOrder, Invoice, Flight, PlannedCost } from '../../types'

interface MikaLine {
  wbs: string; desc: string; level: number
  pm80tot: number; pm100: number; actuals: number; forecast: number
  poCommitted: number   // uninvoiced PO commitment for this WBS
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

const fmt = (n: number) => n === 0 ? '—' : '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n: number) => n === 0 ? '—' : n + '%'

export function MikaPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [mika, setMika] = useState<MikaData | null>(null)
  const [preview, setPreview] = useState<MikaData | null>(null)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [status, setStatus] = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [variations, setVariations] = useState<{ status: string; line_items: unknown[] }[]>([])
  const [poWarnings, setPoWarnings] = useState<PoCommitmentWarning[]>([])
  const [poList, setPoList] = useState<PurchaseOrder[]>([])
  const [wbsAgg, setWbsAgg] = useState<import('../../engines/wbsAggregator').WbsAggregate>({})
  const [committedMap, setCommittedMap] = useState<Record<string, number>>({})
  const [drillCell, setDrillCell] = useState<{ wbs: string; col: 'actuals' | 'committed' | 'forecast' | 'eac' } | null>(null)
  const [editingCell, setEditingCell] = useState<{ wbs: string; field: 'pm80tot' | 'pm100'; value: string } | null>(null)
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
    const pid = activeProject.id
    const { data } = await supabase.from('mika_wbs_lines')
      .select('*').eq('project_id', pid).order('sort_order')
    if (data && data.length > 0) {
      const rows = data as {wbs:string;description:string;level:number|null;pm80:number|null;pm100:number|null;forecast_tc:number|null}[]

      // Pull every cost-bearing collection in parallel and run the canonical aggregator.
      const [
        resourcesR, rateCardsR, timesheetsR,
        tcOwnedR, tcCrossR, tvsR, deptsR,
        hireR, carsR, accomR, expensesR, boR,
        varsR, varLinesR, holsR, costLinesR, seR,
        posR, invoicesR, flightsR, plannedR,
      ] = await Promise.all([
        supabase.from('resources').select('*').eq('project_id', pid),
        supabase.from('rate_cards').select('*').eq('project_id', pid),
        supabase.from('weekly_timesheets').select('*').eq('project_id', pid),
        supabase.from('tooling_costings').select('*').eq('project_id', pid),
        supabase.from('tooling_costings').select('*').neq('project_id', pid)
          .filter('splits', 'cs', `[{"projectId":"${pid}"}]`),
        supabase.from('global_tvs').select('*'),
        supabase.from('global_departments').select('*'),
        supabase.from('hire_items').select('*').eq('project_id', pid),
        supabase.from('cars').select('*').eq('project_id', pid),
        supabase.from('accommodation').select('*').eq('project_id', pid),
        supabase.from('expenses').select('*').eq('project_id', pid),
        supabase.from('back_office_hours').select('*').eq('project_id', pid),
        supabase.from('variations').select('*').eq('project_id', pid),
        supabase.from('variation_lines').select('*').eq('project_id', pid),
        supabase.from('public_holidays').select('date').eq('project_id', pid),
        supabase.from('timesheet_cost_lines')
          .select('category,wbs,cost_labour,sell_labour,cost_allowances,sell_allowances,person_name,work_date')
          .eq('project_id', pid),
        supabase.from('se_support_costs')
          .select('wbs,amount,sell_price,currency,person,description,date')
          .eq('project_id', pid),
        supabase.from('purchase_orders').select('*').eq('project_id', pid),
        supabase.from('invoices').select('*').eq('project_id', pid),
        supabase.from('flights').select('*').eq('project_id', pid),
        supabase.from('planned_costs').select('*').eq('project_id', pid),
      ])

      const poList = (posR.data || []) as PurchaseOrder[]
      setPoList(poList)
      const invoiceList = (invoicesR.data || []) as Invoice[]

      const agg = aggregateAllCostsByWbs({
        project: activeProject,
        resources: (resourcesR.data || []) as Resource[],
        rateCards: (rateCardsR.data || []) as RateCard[],
        timesheets: (timesheetsR.data || []) as WeeklyTimesheet[],
        timesheetCostLines: (costLinesR.data || []) as Parameters<typeof aggregateAllCostsByWbs>[0]['timesheetCostLines'],
        toolingCostings: [...(tcOwnedR.data || []), ...(tcCrossR.data || [])] as ToolingCosting[],
        globalTVs: (tvsR.data || []) as GlobalTV[],
        globalDepartments: (deptsR.data || []) as GlobalDepartment[],
        hireItems: (hireR.data || []) as HireItem[],
        cars: (carsR.data || []) as Car[],
        accommodation: (accomR.data || []) as Accommodation[],
        expenses: (expensesR.data || []) as Expense[],
        backOfficeHours: (boR.data || []) as BackOfficeHour[],
        seSupport: (seR.data || []) as SeSupportEntry[],
        variations: (varsR.data || []) as Variation[],
        variationLines: (varLinesR.data || []) as VariationLine[],
        invoices: invoiceList,
        purchaseOrders: poList,
        plannedCosts: (plannedR.data || []) as PlannedCost[],
        publicHolidays: ((holsR.data || []) as {date:string}[]).map(h => h.date),
        activeProjectId: pid,
      })

      // PO committed costs
      const { byWbs: committedByWbs, warnings } = buildPoCommitments(
        poList,
        invoiceList,
        (hireR.data || []) as HireItem[],
        (carsR.data || []) as Car[],
        (accomR.data || []) as Accommodation[],
        (resourcesR.data || []) as Parameters<typeof buildPoCommitments>[5],
        (activeProject || {}) as unknown as Parameters<typeof buildPoCommitments>[6],
      )
      setPoWarnings(warnings)
      setWbsAgg(agg)
      setCommittedMap(committedByWbs)

      // Parent-prefix rollup for both actuals and committed
      function rollup(map: Record<string, number>, code: string, value: number) {
        const parts = code.split('.')
        let prefix = parts[0]
        map[prefix] = (map[prefix] || 0) + value
        for (let i = 1; i < parts.length; i++) {
          prefix += '.' + parts[i]
          map[prefix] = (map[prefix] || 0) + value
        }
      }

      const actualsByWbs: Record<string, number> = {}
      const committedRolled: Record<string, number> = {}
      for (const [code, row] of Object.entries(agg)) {
        if (row.total) rollup(actualsByWbs, code, row.total)
      }
      for (const [code, val] of Object.entries(committedByWbs)) {
        if (val) rollup(committedRolled, code, val)
      }
      const stdHours = (activeProject?.std_hours as { day: Record<string,number>; night: Record<string,number> }) || { day: {}, night: {} }
      const fxRates = (activeProject?.currency_rates as { code: string; rate: number }[]) || []
      const publicHolidays = ((holsR.data || []) as {date:string}[])

      // Run the SAME engine the Forecast page uses — its byWbs map is the
      // authoritative per-WBS plan total. Sums to the Forecast page total.
      const forecast = buildForecast(
        (resourcesR.data || []) as Resource[],
        (rateCardsR.data || []) as RateCard[],
        (boR.data || []) as BackOfficeHour[],
        (hireR.data || []) as HireItem[],
        (carsR.data || []) as Car[],
        (accomR.data || []) as Accommodation[],
        [...(tcOwnedR.data || []), ...(tcCrossR.data || [])] as ToolingCosting[],
        stdHours, publicHolidays,
        activeProject?.start_date || null,
        activeProject?.end_date || null,
        fxRates,
        (expensesR.data || []) as Expense[],
        0,
        (tvsR.data || []) as GlobalTV[],
        (deptsR.data || []) as GlobalDepartment[],
        poList,
        invoiceList,
        (flightsR.data || []) as Flight[],
        (plannedR.data || []) as PlannedCost[],
      )
      // futureRolled: forward-only forecast (days >= today) — this is the EAC forward component.
      // Using byWbsFuture means: EAC = actuals (past timesheets) + committed + future engine calc,
      // which is the correct formula. byWbs (full plan) is kept for Reconcile panel use only.
      const futureRolled: Record<string, number> = {}
      for (const [code, val] of Object.entries(forecast.byWbsFuture)) {
        if (val) rollup(futureRolled, code, val)
      }

      // ForecastTC = forward-only engine calculation (days >= today per WBS).
      // EAC = Actuals (past timesheets) + PO Committed + ForecastTC (future engine).
      // This means as timesheets arrive for past weeks, they replace the forecast for those
      // weeks automatically — the engine never double-counts past dates in ForecastTC.
      const dbLines: MikaLine[] = rows.map(r => {
        const actuals = actualsByWbs[r.wbs] || 0
        const committed = committedRolled[r.wbs] || 0
        return {
          wbs: r.wbs,
          desc: r.description,
          level: r.level ?? 1,
          pm80tot: r.pm80 || 0,
          pm100: r.pm100 || 0,
          actuals,
          poCommitted: committed,
          forecast: futureRolled[r.wbs] || 0,
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
          lines.push({ wbs, desc, level, pm80tot, pm100, actuals, forecast, poCommitted: 0 })
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

    // Also sync to wbs_list so CostReport and other panels get WBS structure from MIKA
    const { error: wbsDelErr } = await supabase.from('wbs_list').delete().eq('project_id', activeProject.id)
    if (wbsDelErr) { console.warn('[MikaPanel] wbs_list delete failed:', wbsDelErr.message) }
    else {
      const seenCodes = new Set<string>()
      const wbsInserts = preview.lines
        .filter(l => l.wbs.includes('-') || l.wbs.includes('.'))
        .filter(l => { if (seenCodes.has(l.wbs)) return false; seenCodes.add(l.wbs); return true })
        .map((l, i) => ({
          project_id: activeProject.id,
          code: l.wbs, name: l.desc || l.wbs,
          level: String(l.level ?? 0), pm80: l.pm80tot, pm100: l.pm100,
          source: 'mika', sort_order: i,
        }))
      if (wbsInserts.length) {
        const { error: wbsErr } = await supabase.from('wbs_list').insert(wbsInserts)
        if (wbsErr) console.warn('[MikaPanel] wbs_list sync failed:', wbsErr.message)
      }
    }

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

  async function saveInlineEdit(wbs: string, field: 'pm80tot' | 'pm100', rawValue: string) {
    const value = parseFloat(rawValue.replace(/[^0-9.\-]/g, '')) || 0
    setEditingCell(null)

    // Build the full updated map with bottom-up rollup
    const prev = mika
    if (!prev) return
    let lines = prev.lines.map(l => l.wbs === wbs ? { ...l, [field]: value } : l)
    const map = Object.fromEntries(lines.map(l => [l.wbs, { ...l }]))
    const sorted = [...lines].sort((a, b) => b.wbs.split('.').length - a.wbs.split('.').length)
    for (const l of sorted) {
      const directChildren = Object.values(map).filter(c =>
        c.wbs !== l.wbs && c.wbs.startsWith(l.wbs + '.') &&
        c.wbs.slice(l.wbs.length + 1).split('.').length === 1
      )
      if (directChildren.length > 0) {
        if (field === 'pm80tot') map[l.wbs].pm80tot = directChildren.reduce((s, c) => s + map[c.wbs].pm80tot, 0)
        if (field === 'pm100')   map[l.wbs].pm100   = directChildren.reduce((s, c) => s + map[c.wbs].pm100,   0)
      }
    }
    lines = prev.lines.map(l => map[l.wbs] || l)

    // Update local state
    setMika({ ...prev, lines })

    // Persist ALL changed rows to DB (the edited leaf + any ancestors whose value changed)
    const dbField = field === 'pm80tot' ? 'pm80' : 'pm100'
    const pid = activeProject!.id
    const changed = lines.filter(l => {
      const orig = prev.lines.find(o => o.wbs === l.wbs)
      return orig && Math.abs((field === 'pm80tot' ? l.pm80tot : l.pm100) - (field === 'pm80tot' ? orig.pm80tot : orig.pm100)) > 0.001
    })
    await Promise.all(changed.map(l =>
      supabase.from('mika_wbs_lines')
        .update({ [dbField]: field === 'pm80tot' ? l.pm80tot : l.pm100 })
        .eq('project_id', pid)
        .eq('wbs', l.wbs)
    )).then(results => {
      const err = results.find(r => r.error)?.error
      if (err) toast(err.message, 'error')
    })
  }

  // Filtered lines
  const lines = (mika?.lines) || []
  const q = search.toLowerCase()
  let filtered = lines.filter(l => l.level >= 0)
  if (q) filtered = filtered.filter(l => l.wbs.toLowerCase().includes(q) || l.desc.toLowerCase().includes(q))
  if (levelFilter !== 'all') filtered = filtered.filter(l => l.level <= parseInt(levelFilter))

  // Top-level KPIs — use the minimum level rows only to avoid double-counting
  const minLevel = lines.length > 0 ? Math.min(...lines.map(l => l.level)) : 0
  const topLines = lines.filter(l => l.level === minLevel)
  const totPM80       = topLines.reduce((s, l) => s + l.pm80tot, 0)
  const totPM100      = topLines.reduce((s, l) => s + l.pm100, 0)
  const totActuals    = topLines.reduce((s, l) => s + l.actuals, 0)
  const totCommitted  = topLines.reduce((s, l) => s + l.poCommitted, 0)
  const totFC         = topLines.reduce((s, l) => s + l.forecast, 0)
  const totEAC        = totActuals + totCommitted + totFC
  const totVar        = totPM100 - totEAC

  const statusColors = { info: 'var(--text2)', success: 'var(--green)', error: 'var(--red)' }

  return (
    <div style={{ padding: '24px' }}>
      <div data-tour="mika-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>MIKA Cost Plan</h1>
            <HelpButton panelId="cost-mika" />
          </div>
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
        <div data-tour="mika-import" className="card" style={{ padding: '16px' }}>
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
                    const hasSignal = l.pm100 || l.actuals || l.forecast
                    return (
                      <tr key={i} style={{ fontWeight: l.level <= 2 ? 600 : 400 }}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{l.wbs}</td>
                        <td>{indent}{l.desc || l.wbs}</td>
                        <td style={{ textAlign: 'center', color: 'var(--text3)' }}>{l.level}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(l.pm80tot)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(l.pm100)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(l.actuals)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: variance >= 0 ? 'var(--green)' : 'var(--red)' }}>{hasSignal ? fmt(variance) : '—'}</td>
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
          <div data-tour="mika-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'PM80 Baseline',   val: totPM80,      color: 'var(--accent)' },
              { label: 'PM100 Budget',    val: totPM100,     color: '#3b82f6' },
              { label: 'PTD Actuals',     val: totActuals,   color: 'var(--green)' },
              { label: 'PO Committed',    val: totCommitted, color: '#f97316' },
              { label: 'EAC (calc)',      val: totEAC,       color: '#7c3aed' },
              { label: 'Variance',        val: totVar,       color: totVar >= 0 ? 'var(--green)' : 'var(--red)' },
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
            · {(mika.lines || []).length} WBS lines
          </div>

          {/* Filters */}
          <div data-tour="mika-filters" style={{ display: 'flex', gap: '10px', marginBottom: '12px', alignItems: 'center' }}>
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

          {/* Data quality warning strip */}
          {poWarnings.length > 0 && (
            <div style={{ marginBottom: '10px', padding: '8px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 'var(--radius)', fontSize: '11px' }}>
              <div style={{ fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>⚠ {poWarnings.length} cost item{poWarnings.length > 1 ? 's' : ''} missing WBS or forecast dates — excluded from EAC</div>
              {poWarnings.slice(0, 3).map((w, i) => (
                <div key={i} style={{ color: 'var(--text3)', marginTop: '2px' }}>{w.message}</div>
              ))}
              {poWarnings.length > 3 && <div style={{ color: 'var(--text3)', marginTop: '2px' }}>…and {poWarnings.length - 3} more</div>}
            </div>
          )}

          {/* Full MIKA table */}
          <div data-tour="mika-table" className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: '11px', width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th>WBS</th><th>Description</th><th>Lvl</th>
                    <th style={{ textAlign: 'right' }}>PM80 Budget</th>
                    <th style={{ textAlign: 'right' }}>PM100 Budget</th>
                    <th style={{ textAlign: 'right', color: '#d97706' }}>Approved VNs</th>
                    <th style={{ textAlign: 'right', color: '#d97706' }}>Pending VNs</th>
                    <th style={{ textAlign: 'right', color: '#7c3aed' }}>Revised Budget</th>
                    <th style={{ textAlign: 'right' }}>PTD Actuals</th>
                    <th style={{ textAlign: 'right', color: '#f97316' }}>PO Committed</th>
                    <th style={{ textAlign: 'right', color: 'var(--amber)' }}>Forecast TC</th>
                    <th style={{ textAlign: 'right', color: '#7c3aed' }}>EAC (calc)</th>
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
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '2px 4px' }}>
                          {editingCell?.wbs === l.wbs && editingCell.field === 'pm80tot' ? (
                            <input
                              autoFocus
                              style={{ width: '90px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', padding: '2px 4px', border: '1px solid var(--accent)', borderRadius: '3px', background: 'var(--bg)' }}
                              value={editingCell.value}
                              onChange={e => setEditingCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
                              onBlur={() => saveInlineEdit(l.wbs, 'pm80tot', editingCell.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(l.wbs, 'pm80tot', editingCell.value); if (e.key === 'Escape') setEditingCell(null) }}
                            />
                          ) : (
                            <span
                              title="Click to edit"
                              style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border)', paddingBottom: '1px' }}
                              onClick={() => setEditingCell({ wbs: l.wbs, field: 'pm80tot', value: String(l.pm80tot || 0) })}>
                              {fmt(l.pm80tot)}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#3b82f6', padding: '2px 4px' }}>
                          {editingCell?.wbs === l.wbs && editingCell.field === 'pm100' ? (
                            <input
                              autoFocus
                              style={{ width: '90px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', padding: '2px 4px', border: '1px solid #3b82f6', borderRadius: '3px', background: 'var(--bg)', color: '#3b82f6' }}
                              value={editingCell.value}
                              onChange={e => setEditingCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
                              onBlur={() => saveInlineEdit(l.wbs, 'pm100', editingCell.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(l.wbs, 'pm100', editingCell.value); if (e.key === 'Escape') setEditingCell(null) }}
                            />
                          ) : (
                            <span
                              title="Click to edit"
                              style={{ cursor: 'pointer', borderBottom: '1px dashed #3b82f6', paddingBottom: '1px' }}
                              onClick={() => setEditingCell({ wbs: l.wbs, field: 'pm100', value: String(l.pm100 || 0) })}>
                              {fmt(l.pm100)}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: vn.approved > 0 ? '#d97706' : 'var(--text3)' }}>{vn.approved > 0 ? fmt(vn.approved) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: vn.pending > 0 ? '#d97706' : 'var(--text3)' }}>{vn.pending > 0 ? fmt(vn.pending) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed', fontWeight: hasVns ? 700 : bold }}>{hasVns ? fmt(revisedBudget) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', cursor: l.actuals ? 'pointer' : 'default', textDecoration: l.actuals ? 'underline dotted' : 'none' }} onClick={() => l.actuals && setDrillCell({ wbs: l.wbs, col: 'actuals' })}>{l.actuals ? fmt(l.actuals) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: l.poCommitted ? '#f97316' : 'var(--text3)', cursor: l.poCommitted ? 'pointer' : 'default', textDecoration: l.poCommitted ? 'underline dotted' : 'none' }} onClick={() => l.poCommitted && setDrillCell({ wbs: l.wbs, col: 'committed' })}>{l.poCommitted ? fmt(l.poCommitted) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--amber)', cursor: l.forecast ? 'pointer' : 'default', textDecoration: l.forecast ? 'underline dotted' : 'none' }} onClick={() => l.forecast && setDrillCell({ wbs: l.wbs, col: 'forecast' })}>{l.forecast ? fmt(l.forecast) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: '#7c3aed', fontWeight: 600, cursor: eac ? 'pointer' : 'default', textDecoration: eac ? 'underline dotted' : 'none' }} onClick={() => eac && setDrillCell({ wbs: l.wbs, col: 'eac' })}>{fmt(eac)}</td>
                        {/* Variance column — show whenever there's signal (PM100 OR an EAC component).
                            Previously gated on l.pm100 alone, which hid real overrun on rows like a
                            Subcontractor child that has POs against it but no PM100 line in the
                            imported cost plan. The header total includes those rows in its variance
                            roll-up, so hiding them at the leaf level made the header inexplicably
                            larger than the visible children summed. */}
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: variance >= 0 ? 'var(--green)' : 'var(--red)' }}>{(l.pm100 || eac) ? fmt(variance) : '—'}</td>
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

      {/* Drill-down modal */}
      {drillCell && (() => {
        const { wbs, col } = drillCell
        const fmtD = (n: number) => '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        // Collect all agg rows for this WBS and its descendants
        const matchingAgg = Object.entries(wbsAgg).filter(([code]) =>
          code === wbs || code.startsWith(wbs + '.')
        )

        // Category labels for display
        const CAT_LABELS: Record<string, string> = {
          labourTrades: 'Labour — Trades', labourMgmt: 'Labour — Management',
          labourSeag: 'Labour — SE AG', labourSubcon: 'Labour — Subcon',
          hire: 'Hire', tooling: 'Tooling', hardware: 'Hardware',
          cars: 'Cars / Vehicles', accom: 'Accommodation',
          expenses: 'Expenses', backoffice: 'Back Office',
          se_support: 'SE Support', variations: 'Variations', invoices: 'Invoices',
        }
        const CAT_KEYS = Object.keys(CAT_LABELS) as (keyof typeof CAT_LABELS)[]

        // Aggregate actuals by category across all matching rows
        const actualsByCat: Record<string, number> = {}
        const allItems: { label: string; category: string; cost: number }[] = []
        for (const [, row] of matchingAgg) {
          for (const key of CAT_KEYS) {
            const val = row[key as keyof typeof row] as number
            if (val) actualsByCat[key] = (actualsByCat[key] || 0) + val
          }
          for (const item of row.items || []) {
            allItems.push({ label: item.label, category: String(item.category), cost: item.cost })
          }
        }

        // Forecast: collect contributing MIKA leaf rows
        const mikaLines = mika?.lines || []
        const forecastRows = mikaLines.filter(l =>
          (l.wbs === wbs || l.wbs.startsWith(wbs + '.')) && l.forecast > 0
        )
        const forecastTotal = forecastRows.reduce((s, l) => s + l.forecast, 0)

        // Committed: find leaf entries from committedMap
        const committedRows = Object.entries(committedMap).filter(([code]) =>
          code === wbs || code.startsWith(wbs + '.')
        )
        const committedTotal = committedRows.reduce((s, [, v]) => s + v, 0)

        const actualsTotal = matchingAgg.reduce((s, [, r]) => s + r.total, 0)
        const eacTotal = actualsTotal + forecastTotal

        const colTitle = { actuals: 'PTD Actuals', committed: 'PO Committed', forecast: 'Forecast TC', eac: 'EAC (Calc)' }[col]

        return (
          <div className="modal-overlay" onClick={() => setDrillCell(null)}>
            <div className="modal" style={{ maxWidth: '960px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2 style={{ fontSize: '14px', marginBottom: '2px' }}>{wbs}</h2>
                  <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{colTitle} breakdown</div>
                </div>
                <button className="btn-close" onClick={() => setDrillCell(null)}>×</button>
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>

                {/* PTD Actuals section */}
                {(col === 'actuals' || col === 'eac') && actualsTotal > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      PTD Actuals — {fmtD(actualsTotal)}
                    </div>
                    {CAT_KEYS.filter(k => (actualsByCat[k] || 0) > 0).map(k => {
                      const catItems = allItems.filter(i => i.category === k)
                      return (
                        <div key={k} style={{ marginBottom: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, padding: '4px 8px', background: 'var(--bg2)', borderRadius: '4px' }}>
                            <span>{CAT_LABELS[k]}</span>
                            <span style={{ fontFamily: 'var(--mono)' }}>{fmtD(actualsByCat[k])}</span>
                          </div>
                          {catItems.map((item, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text2)', padding: '2px 8px 2px 20px' }}>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>{item.label}</span>
                              <span style={{ fontFamily: 'var(--mono)', flexShrink: 0 }}>{fmtD(item.cost)}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    {Object.keys(actualsByCat).length === 0 && <div style={{ fontSize: '12px', color: 'var(--text3)' }}>No actuals data</div>}
                  </div>
                )}

                {/* PO Committed section */}
                {(col === 'committed' || col === 'eac') && committedTotal > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      PO Committed — {fmtD(committedTotal)}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg2)' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>WBS</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>PO Number</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Vendor</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, fontFamily: 'var(--mono)' }}>Committed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Build one row per (PO × line) for any line whose WBS sits
                          // under the drilled-down WBS. Previous version keyed a
                          // WBS→PO lookup map, which silently overwrote earlier POs
                          // when two POs both had lines on the same WBS, and rendered
                          // one row per WBS (collapsing multiple POs into one).
                          //
                          // Now: iterate every PO line, keep matches, render each
                          // individually with its own value. Multiple POs on the
                          // same WBS now show as separate rows that sum to the
                          // committed total shown in the header.
                          //
                          // Limitation: line value shown here is the gross PO line
                          // amount, not net-of-invoice. The header committed total
                          // (from the PO commitments engine) DOES subtract invoiced
                          // amounts, pro-rated across lines. As long as no PO on
                          // this WBS has any invoiced portion the two match
                          // exactly. Once they do diverge the drill rows can be
                          // refined; for now the row count and PO identification
                          // are what the user needs to see, and the totals tie out
                          // for the pre-invoice common case.
                          type PoLine = { wbs?: string; value?: number; description?: string }
                          const rows: { wbs: string; po_number: string; vendor: string; description: string; value: number }[] = []
                          for (const po of poList) {
                            const poAny = po as unknown as { po_number?: string; id: string; vendor?: string; description?: string; status?: string; line_items?: PoLine[] }
                            if (poAny.status === 'cancelled' || poAny.status === 'closed') continue
                            const lines = poAny.line_items || []
                            for (const l of lines) {
                              if (!l.wbs) continue
                              if (l.wbs !== wbs && !l.wbs.startsWith(wbs + '.')) continue
                              const lineVal = Number(l.value) || 0
                              if (lineVal <= 0) continue
                              rows.push({
                                wbs: l.wbs,
                                po_number: poAny.po_number || poAny.id,
                                vendor: poAny.vendor || '—',
                                description: l.description || poAny.description || '',
                                value: lineVal,
                              })
                            }
                          }
                          // Largest first
                          rows.sort((a, b) => b.value - a.value)
                          return rows.map((r, i) => (
                            <tr key={`${r.po_number}-${r.wbs}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '4px 8px', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: '10px' }}>{r.wbs}</td>
                              <td style={{ padding: '4px 8px', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: '10px', whiteSpace: 'nowrap' }}>{r.po_number}</td>
                              <td style={{ padding: '4px 8px', color: 'var(--text2)', fontSize: '11px', whiteSpace: 'nowrap' }}>{r.vendor}</td>
                              <td style={{ padding: '4px 8px', color: 'var(--text3)', fontSize: '11px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description || '—'}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: '#f97316' }}>{fmtD(r.value)}</td>
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Forecast TC section */}
                {(col === 'forecast' || col === 'eac') && forecastTotal > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      Forecast TC — {fmtD(forecastTotal)}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg2)' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>WBS</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, fontFamily: 'var(--mono)' }}>Forecast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecastRows.sort((a, b) => b.forecast - a.forecast).map(l => (
                          <tr key={l.wbs} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '4px 8px', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: '10px' }}>{l.wbs}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text2)' }}>{l.desc}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--amber)' }}>{fmtD(l.forecast)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* EAC total */}
                {col === 'eac' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 8px', background: 'var(--bg2)', borderRadius: '6px', fontWeight: 700, fontSize: '13px' }}>
                    <span style={{ color: '#7c3aed' }}>EAC Total</span>
                    <span style={{ fontFamily: 'var(--mono)', color: '#7c3aed' }}>{fmtD(eacTotal)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
