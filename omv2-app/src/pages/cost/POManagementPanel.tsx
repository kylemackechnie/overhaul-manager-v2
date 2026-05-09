import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { buildForecast } from '../../engines/forecastEngine'
import type { PoBucket } from '../../engines/forecastEngine'
import type {
  PurchaseOrder, Resource, RateCard, HireItem, Car, Accommodation,
  Invoice, Project,
} from '../../types'

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (v: number) => {
  if (!v && v !== 0) return '—'
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(2) + 'k'
  return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtDate = (s?: string | null) => s ? s.split('-').reverse().join('/') : '—'
const pctBar = (value: number, total: number) => total > 0 ? Math.min(100, Math.round(value / total * 100)) : 0

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Draft',     color: '#64748b', bg: '#f1f5f9' },
  quoted:    { label: 'Quoted',    color: '#d97706', bg: '#fef3c7' },
  raised:    { label: 'Raised',    color: '#0369a1', bg: '#dbeafe' },
  active:    { label: 'Active',    color: '#059669', bg: '#d1fae5' },
  closed:    { label: 'Closed',    color: '#6b7280', bg: '#e5e7eb' },
  cancelled: { label: 'Cancelled', color: '#dc2626', bg: '#fee2e2' },
}

type Tab = 'overview' | 'labour' | 'equipment' | 'invoices'

interface ActualsRow {
  person_name: string
  role: string
  work_date: string
  week_start: string
  allocated_hours: number
  cost_labour: number
  cost_allowances: number
}

interface HireActual {
  id: string
  name: string
  hire_type: string
  start_date: string | null
  end_date: string | null
  hire_cost: number
  actualToDate: number
}

interface CarActual {
  id: string
  description: string
  start_date: string | null
  end_date: string | null
  total_cost: number
  actualToDate: number
}

interface AccomActual {
  id: string
  property: string
  room: string
  check_in: string | null
  check_out: string | null
  total_cost: number
  actualToDate: number
}

// Prorate a fixed cost to today based on date range
function prorateToDate(total: number, start: string | null, end: string | null): number {
  if (!start || !total) return 0
  const s = new Date(start + 'T12:00:00')
  const e = end ? new Date(end + 'T12:00:00') : new Date()
  const today = new Date()
  const totalDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000))
  const elapsed = Math.max(0, Math.min(totalDays, Math.round((today.getTime() - s.getTime()) / 86400000)))
  return (total / totalDays) * elapsed
}

export function POManagementPanel() {
  const { activeProject, activePOManagerId, setActivePOManagerId, setActivePanel } = useAppStore()

  const [pos, setPos]           = useState<PurchaseOrder[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [hireItems, setHireItems] = useState<HireItem[]>([])
  const [cars, setCars]         = useState<Car[]>([])
  const [accom, setAccom]       = useState<Accommodation[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [actuals, setActuals]   = useState<ActualsRow[]>([])
  const [holidays, setHolidays] = useState<{ date: string }[]>([])
  const [loading, setLoading]   = useState(true)

  const [activePO, setActivePO]   = useState<PurchaseOrder | null>(null)
  const [tab, setTab]             = useState<Tab>('overview')
  const [search, setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  useEffect(() => {
    if (activePOManagerId && pos.length > 0) {
      const po = pos.find(p => p.id === activePOManagerId)
      if (po) { setActivePO(po); setActivePOManagerId(null) }
    }
  }, [activePOManagerId, pos])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [poR, rcR, resR, hireR, carR, acR, invR, phR, actR] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
      supabase.from('resources').select('*').eq('project_id', pid),
      supabase.from('hire_items').select('*').eq('project_id', pid),
      supabase.from('cars').select('*').eq('project_id', pid),
      supabase.from('accommodation').select('*').eq('project_id', pid),
      supabase.from('invoices').select('*').eq('project_id', pid),
      supabase.from('public_holidays').select('date').eq('project_id', pid),
      supabase.from('timesheet_cost_lines')
        .select('person_name,role,work_date,week_start,allocated_hours,cost_labour,cost_allowances,po_id')
        .eq('project_id', pid)
        .eq('timesheet_status', 'approved'),
    ])
    setPos((poR.data || []) as PurchaseOrder[])
    setRateCards((rcR.data || []) as RateCard[])
    setResources((resR.data || []) as Resource[])
    setHireItems((hireR.data || []) as HireItem[])
    setCars((carR.data || []) as Car[])
    setAccom((acR.data || []) as Accommodation[])
    setInvoices((invR.data || []) as Invoice[])
    setHolidays((phR.data || []) as { date: string }[])
    setActuals((actR.data || []) as ActualsRow[])
    setLoading(false)
  }

  // Build forecast engine output — memoised, expensive
  const forecast = useMemo(() => {
    if (!resources.length && !hireItems.length) return null
    const proj = activeProject as Project
    const stdHours = proj?.std_hours || { day: { mon: 10, tue: 10, wed: 10, thu: 10, fri: 10, sat: 10, sun: 0 }, night: {} }
    return buildForecast(
      resources, rateCards, [], hireItems, cars, accom, [], stdHours,
      holidays, proj?.start_date || null, proj?.end_date || null, [], [], 0, [], [],
    )
  }, [resources, rateCards, hireItems, cars, accom, holidays, activeProject])

  // PO-level helpers
  function getPoBucket(poId: string): PoBucket | null {
    return forecast?.byPo[poId] ?? null
  }

  function getPoValue(po: PurchaseOrder): number {
    const lines = (po as PurchaseOrder & { line_items?: { value: number }[] }).line_items || []
    const linesTotal = lines.reduce((s, l) => s + (l.value || 0), 0)
    return linesTotal || (po as unknown as { po_value?: number }).po_value || 0
  }

  function getInvoiced(poId: string) {
    const inv = invoices.filter(i => (i as Invoice & { po_id?: string }).po_id === poId)
    return {
      total: inv.reduce((s, i) => s + (i.amount || 0), 0),
      count: inv.length,
    }
  }

  function getLabourActuals(poId: string) {
    return actuals.filter(a => (a as ActualsRow & { po_id?: string }).po_id === poId)
  }

  function getHireActuals(poId: string): HireActual[] {
    return hireItems
      .filter(h => (h as HireItem & { linked_po_id?: string }).linked_po_id === poId)
      .map(h => ({
        id: h.id,
        name: (h as HireItem & { name?: string }).name || 'Hire item',
        hire_type: h.hire_type,
        start_date: (h as HireItem & { start_date?: string }).start_date || null,
        end_date: (h as HireItem & { end_date?: string }).end_date || null,
        hire_cost: h.hire_cost || 0,
        actualToDate: prorateToDate(h.hire_cost || 0, (h as HireItem & { start_date?: string }).start_date || null, (h as HireItem & { end_date?: string }).end_date || null),
      }))
  }

  function getCarActuals(poId: string): CarActual[] {
    return cars
      .filter(c => (c as Car & { linked_po_id?: string }).linked_po_id === poId)
      .map(c => ({
        id: c.id,
        description: (c as Car & { description?: string }).description || (c as Car & { vehicle_type?: string }).vehicle_type || 'Car',
        start_date: (c as Car & { start_date?: string }).start_date || null,
        end_date: (c as Car & { end_date?: string }).end_date || null,
        total_cost: c.total_cost || 0,
        actualToDate: prorateToDate(c.total_cost || 0, (c as Car & { start_date?: string }).start_date || null, (c as Car & { end_date?: string }).end_date || null),
      }))
  }

  function getAccomActuals(poId: string): AccomActual[] {
    return accom
      .filter(a => (a as Accommodation & { linked_po_id?: string }).linked_po_id === poId)
      .map(a => ({
        id: a.id,
        property: (a as Accommodation & { property?: string }).property || 'Accommodation',
        room: (a as Accommodation & { room?: string }).room || '',
        check_in: (a as Accommodation & { check_in?: string }).check_in || null,
        check_out: (a as Accommodation & { check_out?: string }).check_out || null,
        total_cost: a.total_cost || 0,
        actualToDate: prorateToDate(a.total_cost || 0, (a as Accommodation & { check_in?: string }).check_in || null, (a as Accommodation & { check_out?: string }).check_out || null),
      }))
  }

  // Filtered PO list
  const filteredPos = pos.filter(po => {
    const q = search.toLowerCase()
    if (q && !(
      (po as PurchaseOrder & { po_number?: string }).po_number?.toLowerCase().includes(q) ||
      (po as PurchaseOrder & { vendor?: string }).vendor?.toLowerCase().includes(q) ||
      (po as PurchaseOrder & { description?: string }).description?.toLowerCase().includes(q)
    )) return false
    if (filterStatus !== 'all' && po.status !== filterStatus) return false
    return true
  })

  if (loading) return <div className="loading-center"><span className="spinner" /> Loading PO Manager…</div>

  // ── PO Detail view ────────────────────────────────────────────────────────
  if (activePO) {
    const po = activePO
    const bucket = getPoBucket(po.id)
    const budget = getPoValue(po)
    const planned = bucket?.total ?? 0
    const labActuals = getLabourActuals(po.id)
    const hireActuals = getHireActuals(po.id)
    const carActuals = getCarActuals(po.id)
    const accomActuals = getAccomActuals(po.id)
    const { total: invoiced } = getInvoiced(po.id)

    const labActualTotal = labActuals.reduce((s, r) => s + (r.cost_labour || 0) + (r.cost_allowances || 0), 0)
    const hireActualTotal = hireActuals.reduce((s, h) => s + h.actualToDate, 0)
    const carActualTotal = carActuals.reduce((s, c) => s + c.actualToDate, 0)
    const accomActualTotal = accomActuals.reduce((s, a) => s + a.actualToDate, 0)
    const totalActuals = labActualTotal + hireActualTotal + carActualTotal + accomActualTotal

    const varianceToDate = budget - totalActuals
    const forecastVariance = budget - planned

    const statusMeta = STATUS_STYLE[po.status] || STATUS_STYLE.draft

    // Group labour actuals by person
    const byPerson: Record<string, { hours: number; cost: number; rows: ActualsRow[] }> = {}
    for (const r of labActuals) {
      if (!byPerson[r.person_name]) byPerson[r.person_name] = { hours: 0, cost: 0, rows: [] }
      byPerson[r.person_name].hours += r.allocated_hours || 0
      byPerson[r.person_name].cost += (r.cost_labour || 0) + (r.cost_allowances || 0)
      byPerson[r.person_name].rows.push(r)
    }

    // Linked resources from resources list
    const linkedResources = resources.filter(r =>
      (r as Resource & { linked_po_id?: string }).linked_po_id === po.id
    )

    const poInvoices = invoices.filter(i => (i as Invoice & { po_id?: string }).po_id === po.id)

    const TH = { padding: '6px 10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)' }
    const TD = { padding: '8px 10px', fontSize: '12px', borderBottom: '1px solid var(--border)' }
    const TDR = { ...TD, textAlign: 'right' as const, fontFamily: 'var(--mono)' }

    return (
      <div style={{ padding: '20px', maxWidth: '100%' }}>
        {/* Back + header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <button className="btn btn-sm" onClick={() => setActivePO(null)}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>
                {(po as PurchaseOrder & { po_number?: string }).po_number || 'PO'} — {(po as PurchaseOrder & { vendor?: string }).vendor || '—'}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: statusMeta.bg, color: statusMeta.color }}>{statusMeta.label}</span>
              <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{(po as PurchaseOrder & { po_type?: string }).po_type || ''}</span>
            </div>
            {(po as PurchaseOrder & { description?: string }).description && (
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{(po as PurchaseOrder & { description?: string }).description}</div>
            )}
          </div>
          <button className="btn btn-sm" onClick={() => { setActivePanel('purchase-orders') }}>Open in POs</button>
        </div>

        {/* Summary KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '8px', marginBottom: '16px' }}>
          {[
            { label: 'Budget (PO Value)', value: fmt(budget), color: 'var(--text)' },
            { label: 'Planned Cost', value: fmt(planned), color: 'var(--mod-hr)' },
            { label: 'Actuals to Date', value: fmt(totalActuals), color: planned > 0 && totalActuals > planned ? 'var(--red)' : 'var(--green)' },
            { label: 'Invoiced to Date', value: fmt(invoiced), color: 'var(--text2)' },
            { label: 'Variance to Date', value: fmt(varianceToDate), color: varianceToDate < 0 ? 'var(--red)' : 'var(--green)' },
            { label: 'Forecast Variance', value: fmt(forecastVariance), color: forecastVariance < 0 ? 'var(--red)' : 'var(--text2)' },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{k.label}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'var(--mono)', color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Budget consumption bar */}
        {budget > 0 && (
          <div className="card" style={{ padding: '10px 14px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text3)', marginBottom: '6px' }}>
              <span>Budget consumed (actuals)</span>
              <span>{pctBar(totalActuals, budget)}% — {fmt(totalActuals)} of {fmt(budget)}</span>
            </div>
            <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: pctBar(totalActuals, budget) + '%', background: totalActuals > budget ? 'var(--red)' : 'var(--accent)', borderRadius: '3px', transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>
              <span>Planned: {fmt(planned)} ({pctBar(planned, budget)}% of budget)</span>
              <span>Invoiced: {fmt(invoiced)} ({pctBar(invoiced, budget)}%)</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
          {(['overview', 'labour', 'equipment', 'invoices'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: tab === t ? 700 : 400, border: 'none', background: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t ? 'var(--accent)' : 'var(--text2)', cursor: 'pointer', marginBottom: '-1px', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW tab ── */}
        {tab === 'overview' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg2)' }}>
                  <th style={{ ...TH, textAlign: 'left' }}>Category</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Planned</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Actuals to Date</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Variance to Date</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: '👷 Labour', planned: bucket?.labour.cost ?? 0, actual: labActualTotal },
                  { label: '🚜 Dry Hire', planned: bucket?.dryHire.cost ?? 0, actual: hireActuals.filter(h => h.hire_type === 'dry').reduce((s, h) => s + h.actualToDate, 0) },
                  { label: '🏗️ Wet Hire', planned: bucket?.wetHire.cost ?? 0, actual: hireActuals.filter(h => h.hire_type === 'wet').reduce((s, h) => s + h.actualToDate, 0) },
                  { label: '🧰 Local Hire', planned: bucket?.localHire.cost ?? 0, actual: hireActuals.filter(h => h.hire_type === 'local').reduce((s, h) => s + h.actualToDate, 0) },
                  { label: '🚗 Cars', planned: bucket?.cars.cost ?? 0, actual: carActualTotal },
                  { label: '🏠 Accommodation', planned: bucket?.accom.cost ?? 0, actual: accomActualTotal },
                ].filter(row => row.planned > 0 || row.actual > 0).map(row => {
                  const v = row.planned - row.actual
                  return (
                    <tr key={row.label} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={TD}>{row.label}</td>
                      <td style={TDR}>{fmt(row.planned)}</td>
                      <td style={TDR}>{fmt(row.actual)}</td>
                      <td style={{ ...TDR, color: v < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{v >= 0 ? '+' : ''}{fmt(v)}</td>
                    </tr>
                  )
                })}
                <tr style={{ background: 'var(--bg2)', fontWeight: 700 }}>
                  <td style={{ ...TD }}>Total</td>
                  <td style={TDR}>{fmt(planned)}</td>
                  <td style={TDR}>{fmt(totalActuals)}</td>
                  <td style={{ ...TDR, color: varianceToDate < 0 ? 'var(--red)' : 'var(--green)' }}>{varianceToDate >= 0 ? '+' : ''}{fmt(varianceToDate)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── LABOUR tab ── */}
        {tab === 'labour' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Linked resources */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'var(--bg2)', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)' }}>
                Linked Resources ({linkedResources.length})
              </div>
              {linkedResources.length === 0 ? (
                <div style={{ padding: '20px', color: 'var(--text3)', fontSize: '12px', textAlign: 'center' }}>
                  No resources linked to this PO. Link them via Personnel → Resources → More.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg2)' }}>
                      {['Name', 'Role', 'Mob In', 'Mob Out', 'Shift', 'Planned Cost', 'Actual Cost', 'Actual Hours'].map(h => (
                        <th key={h} style={{ ...TH, textAlign: h.includes('Cost') || h.includes('Hours') ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linkedResources.map(r => {
                      const pb = bucket?.labour.people.find(p => p.resourceId === r.id)
                      const pa = byPerson[r.name]
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={TD}><span style={{ fontWeight: 600 }}>{r.name}</span></td>
                          <td style={TD}>{r.role}</td>
                          <td style={TD}>{fmtDate((r as Resource & { mob_in?: string }).mob_in)}</td>
                          <td style={TD}>{fmtDate((r as Resource & { mob_out?: string }).mob_out)}</td>
                          <td style={TD}>{r.shift || 'day'}</td>
                          <td style={TDR}>{fmt(pb?.totalCost ?? 0)}</td>
                          <td style={TDR}>{pa ? fmt(pa.cost) : '—'}</td>
                          <td style={TDR}>{pa ? pa.hours.toFixed(2) + 'h' : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Timesheet actuals breakdown */}
            {labActuals.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: 'var(--bg2)', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)' }}>
                  Timesheet Actuals — Approved Only
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      {['Date', 'Person', 'Role', 'Hours', 'Labour Cost', 'Allowances', 'Total'].map(h => (
                        <th key={h} style={{ ...TH, textAlign: h !== 'Date' && h !== 'Person' && h !== 'Role' ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {labActuals.sort((a, b) => a.work_date.localeCompare(b.work_date) || a.person_name.localeCompare(b.person_name)).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ ...TD, fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>
                          {new Date(r.work_date + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                        </td>
                        <td style={TD}>{r.person_name}</td>
                        <td style={{ ...TD, color: 'var(--text3)' }}>{r.role}</td>
                        <td style={TDR}>{(r.allocated_hours || 0).toFixed(2)}h</td>
                        <td style={TDR}>{fmt(r.cost_labour || 0)}</td>
                        <td style={TDR}>{r.cost_allowances > 0 ? fmt(r.cost_allowances) : '—'}</td>
                        <td style={{ ...TDR, fontWeight: 600 }}>{fmt((r.cost_labour || 0) + (r.cost_allowances || 0))}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--bg2)', fontWeight: 700 }}>
                      <td colSpan={3} style={TD}>Total</td>
                      <td style={TDR}>{labActuals.reduce((s, r) => s + (r.allocated_hours || 0), 0).toFixed(2)}h</td>
                      <td style={TDR}>{fmt(labActuals.reduce((s, r) => s + (r.cost_labour || 0), 0))}</td>
                      <td style={TDR}>{fmt(labActuals.reduce((s, r) => s + (r.cost_allowances || 0), 0))}</td>
                      <td style={TDR}>{fmt(labActualTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── EQUIPMENT tab ── */}
        {tab === 'equipment' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {hireActuals.length === 0 && carActuals.length === 0 && accomActuals.length === 0 ? (
              <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
                No hire, car, or accommodation linked to this PO.
              </div>
            ) : (
              <>
                {hireActuals.length > 0 && (
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg2)', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)' }}>Hire Items</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr>{['Item', 'Type', 'Start', 'End', 'Contract Value', 'Actual to Date'].map(h => (
                          <th key={h} style={{ ...TH, textAlign: h.includes('Value') || h.includes('Date') ? 'right' : 'left' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {hireActuals.map(h => (
                          <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={TD}>{h.name}</td>
                            <td style={TD}><span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'var(--bg2)' }}>{h.hire_type}</span></td>
                            <td style={TD}>{fmtDate(h.start_date)}</td>
                            <td style={TD}>{fmtDate(h.end_date)}</td>
                            <td style={TDR}>{fmt(h.hire_cost)}</td>
                            <td style={{ ...TDR, color: 'var(--mod-hr)' }}>{fmt(h.actualToDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {carActuals.length > 0 && (
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg2)', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)' }}>Cars</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr>{['Description', 'Start', 'End', 'Contract Value', 'Actual to Date'].map(h => (
                          <th key={h} style={{ ...TH, textAlign: h.includes('Value') || h.includes('Date') ? 'right' : 'left' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {carActuals.map(c => (
                          <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={TD}>{c.description}</td>
                            <td style={TD}>{fmtDate(c.start_date)}</td>
                            <td style={TD}>{fmtDate(c.end_date)}</td>
                            <td style={TDR}>{fmt(c.total_cost)}</td>
                            <td style={{ ...TDR, color: 'var(--mod-hr)' }}>{fmt(c.actualToDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {accomActuals.length > 0 && (
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg2)', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)' }}>Accommodation</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr>{['Property', 'Room', 'Check In', 'Check Out', 'Contract Value', 'Actual to Date'].map(h => (
                          <th key={h} style={{ ...TH, textAlign: h.includes('Value') || h.includes('Date') ? 'right' : 'left' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {accomActuals.map(a => (
                          <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={TD}>{a.property}</td>
                            <td style={TD}>{a.room}</td>
                            <td style={TD}>{fmtDate(a.check_in)}</td>
                            <td style={TD}>{fmtDate(a.check_out)}</td>
                            <td style={TDR}>{fmt(a.total_cost)}</td>
                            <td style={{ ...TDR, color: 'var(--mod-hr)' }}>{fmt(a.actualToDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── INVOICES tab ── */}
        {tab === 'invoices' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {poInvoices.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
                No invoices linked to this PO. Link invoices via Cost Tracking → Invoices.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {['Reference', 'Date', 'Amount', 'Status', '% of Budget'].map(h => (
                      <th key={h} style={{ ...TH, textAlign: h === 'Amount' || h === '% of Budget' ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {poInvoices.map((inv, i) => {
                    const invAny = inv as Invoice & { invoice_ref?: string; invoice_date?: string; po_id?: string }
                    const pct = budget > 0 ? ((inv.amount || 0) / budget * 100).toFixed(1) : '—'
                    return (
                      <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={TD}>{invAny.invoice_ref || `Invoice ${i + 1}`}</td>
                        <td style={TD}>{fmtDate(invAny.invoice_date)}</td>
                        <td style={TDR}>{fmt(inv.amount || 0)}</td>
                        <td style={TD}>
                          <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: inv.status === 'approved' ? '#d1fae5' : inv.status === 'paid' ? '#dbeafe' : '#fef3c7', color: inv.status === 'approved' ? '#065f46' : inv.status === 'paid' ? '#1e40af' : '#92400e', fontWeight: 600 }}>
                            {inv.status}
                          </span>
                        </td>
                        <td style={TDR}>{pct}%</td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: 'var(--bg2)', fontWeight: 700 }}>
                    <td colSpan={2} style={TD}>Total Invoiced</td>
                    <td style={TDR}>{fmt(invoiced)}</td>
                    <td style={TD} />
                    <td style={TDR}>{budget > 0 ? (invoiced / budget * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── PO Register (list view) ────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px', maxWidth: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0 }}>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>PO Manager</span>
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{pos.length} purchase orders</span>
        </div>
        <div style={{ width: '0.5px', height: '28px', background: 'var(--border)', flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: '0 0 200px' }}>
          <span style={{ position: 'absolute', left: '7px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: 'var(--text3)', pointerEvents: 'none' }}>⌕</span>
          <input className="input" style={{ paddingLeft: '24px', height: '28px', fontSize: '12px', width: '100%' }}
            placeholder="PO number, vendor, description…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {['all', ...Object.keys(STATUS_STYLE)].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '20px', border: `0.5px solid ${filterStatus === s ? 'var(--accent)' : 'var(--border)'}`, background: filterStatus === s ? 'var(--accent)' : 'transparent', color: filterStatus === s ? '#fff' : 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {s === 'all' ? `All ${pos.length}` : STATUS_STYLE[s].label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setActivePanel('purchase-orders')} style={{ fontSize: '11px' }}>Manage POs →</button>
      </div>

      {/* List */}
      {filteredPos.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📄</div>
          <h3>No purchase orders</h3>
          <p>{search || filterStatus !== 'all' ? 'No matches.' : 'Create POs in Cost Tracking → Purchase Orders.'}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                {['PO Number', 'Vendor', 'Description', 'Status', 'Budget', 'Planned', 'Actuals', 'Invoiced', 'Variance', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', textAlign: ['Budget', 'Planned', 'Actuals', 'Invoiced', 'Variance'].includes(h) ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPos.map(po => {
                const bucket = getPoBucket(po.id)
                const budget = getPoValue(po)
                const planned = bucket?.total ?? 0
                const labAct = getLabourActuals(po.id).reduce((s, r) => s + (r.cost_labour || 0) + (r.cost_allowances || 0), 0)
                const hireAct = getHireActuals(po.id).reduce((s, h) => s + h.actualToDate, 0)
                const carAct = getCarActuals(po.id).reduce((s, c) => s + c.actualToDate, 0)
                const acAct = getAccomActuals(po.id).reduce((s, a) => s + a.actualToDate, 0)
                const actuals = labAct + hireAct + carAct + acAct
                const { total: invoiced } = getInvoiced(po.id)
                const variance = budget - actuals
                const meta = STATUS_STYLE[po.status] || STATUS_STYLE.draft
                return (
                  <tr key={po.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setActivePO(po); setTab('overview') }}>
                    <td style={{ padding: '9px 10px', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600 }}>{(po as PurchaseOrder & { po_number?: string }).po_number || '—'}</td>
                    <td style={{ padding: '9px 10px', fontWeight: 500 }}>{(po as PurchaseOrder & { vendor?: string }).vendor || '—'}</td>
                    <td style={{ padding: '9px 10px', color: 'var(--text3)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(po as PurchaseOrder & { description?: string }).description || '—'}</td>
                    <td style={{ padding: '9px 10px' }}><span style={{ padding: '2px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, background: meta.bg, color: meta.color }}>{meta.label}</span></td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(budget)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmt(planned)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(actuals)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmt(invoiced)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: variance < 0 ? 'var(--red)' : 'var(--green)' }}>{variance >= 0 ? '+' : ''}{fmt(variance)}</td>
                    <td style={{ padding: '9px 10px' }}><button className="btn btn-sm" style={{ fontSize: '10px' }} onClick={e => { e.stopPropagation(); setActivePO(po); setTab('overview') }}>Open →</button></td>
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
