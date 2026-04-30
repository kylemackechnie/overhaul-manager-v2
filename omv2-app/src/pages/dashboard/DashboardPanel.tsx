import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { useUserPrefs } from '../../hooks/useUserPrefs'
import { WidgetPicker } from '../../components/dashboard/WidgetPicker'
import { getDefaultLayout, mergeLayout, TILE_REGISTRY } from '../../components/dashboard/tileRegistry'
import type { DashboardTileConfig } from '../../types'

// ── Formatters ────────────────────────────────────────────────────────────────
const todayStr = new Date().toISOString().slice(0, 10)
const fmt = (n: number) => 'A$' + Math.round(n).toLocaleString('en-AU')
const fmtH = (n: number) => Math.round(n).toLocaleString() + 'h'

function daysUntil(date: string | null | undefined) {
  if (!date) return null
  return Math.ceil((new Date(date + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000)
}

// ── Mini stat ─────────────────────────────────────────────────────────────────
function MTS({ val, lbl, color }: { val: string | number; lbl: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)', color: color || 'var(--text)' }}>{val}</div>
      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', fontWeight: 600 }}>{lbl}</div>
    </div>
  )
}

// ── Module card ───────────────────────────────────────────────────────────────
function ModCard({ icon, title, sub, stats, panel, accent }: {
  icon: string; title: string; sub?: string
  stats: { val: string | number; lbl: string; color?: string }[]
  panel?: string; accent?: string
}) {
  const { setActivePanel } = useAppStore()
  return (
    <div className="card" style={{ padding: '14px 16px', borderTop: `3px solid ${accent || 'var(--accent)'}`, cursor: panel ? 'pointer' : 'default', height: '100%', boxSizing: 'border-box' }}
      onClick={() => panel && setActivePanel(panel)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '12px' }}>{title}</div>
          {sub && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{sub}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px' }}>
        {stats.map((s, i) => <MTS key={i} val={s.val} lbl={s.lbl} color={s.color} />)}
      </div>
    </div>
  )
}

// ── Sortable tile wrapper ─────────────────────────────────────────────────────
function SortableTile({ tile, editMode, children }: {
  tile: DashboardTileConfig
  editMode: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id })
  return (
    <div
      ref={setNodeRef}
      style={{
        gridColumn: tile.size === 'wide' ? 'span 2' : 'span 1',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        position: 'relative',
      }}
    >
      {editMode && (
        <div
          {...attributes}
          {...listeners}
          style={{
            position: 'absolute', top: 6, left: 6, zIndex: 10,
            background: 'rgba(0,0,0,0.6)', borderRadius: '4px',
            padding: '3px 6px', cursor: 'grab', fontSize: '13px', color: '#fff',
            userSelect: 'none', lineHeight: 1,
          }}
          title="Drag to reorder"
        >⠿</div>
      )}
      {children}
    </div>
  )
}

// ── Lookahead event type ──────────────────────────────────────────────────────
interface LookaheadEvent {
  date: string; icon: string; label: string; sub: string; days: number | null; panel?: string
}

// ─────────────────────────────────────────────────────────────────────────────
export function DashboardPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const { prefs, setPref } = useUserPrefs()

  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [lookahead, setLookahead] = useState<LookaheadEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  // ── Layout state ────────────────────────────────────────────────────────────
  const savedLayout = prefs.dashboard_layout
  const layout: DashboardTileConfig[] = useMemo(() => {
    if (savedLayout && savedLayout.length > 0) return mergeLayout(savedLayout)
    return getDefaultLayout()
  }, [savedLayout])

  const visibleTiles = layout.filter(t => t.visible)

  // ── Layout mutators ─────────────────────────────────────────────────────────
  function saveLayout(next: DashboardTileConfig[]) {
    setPref('dashboard_layout', next)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = layout.findIndex(t => t.id === active.id)
    const newIndex = layout.findIndex(t => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(layout, oldIndex, newIndex).map((t, i) => ({ ...t, order: i }))
    saveLayout(reordered)
  }

  function toggleTile(id: string) {
    const next = layout.map(t => t.id === id ? { ...t, visible: !t.visible } : t)
    saveLayout(next)
  }

  function setTileSize(id: string, size: 'normal' | 'wide') {
    const next = layout.map(t => t.id === id ? { ...t, size } : t)
    saveLayout(next)
  }

  function resetLayout() {
    saveLayout(getDefaultLayout())
  }

  // ── Data load ───────────────────────────────────────────────────────────────
  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    const [resData, invData, poData, tsData, varData, partsData, hireData, carData,
      accomData, shipData, subconData, woData, issuedData, toolData] = await Promise.all([
      supabase.from('resources').select('mob_in,mob_out,name,role,company').eq('project_id', pid),
      supabase.from('invoices').select('amount,status').eq('project_id', pid),
      supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      supabase.from('weekly_timesheets').select('crew,regime').eq('project_id', pid),
      supabase.from('variations').select('status,value').eq('project_id', pid),
      supabase.from('wosit_lines').select('status,qty_received').eq('project_id', pid),
      supabase.from('hire_items').select('id,hire_type,name,vendor,start_date,end_date').eq('project_id', pid),
      supabase.from('cars').select('id,vehicle_type,rego,vendor,start_date,end_date').eq('project_id', pid),
      supabase.from('accommodation').select('id,property,room,check_in,check_out,occupants').eq('project_id', pid),
      supabase.from('shipments').select('direction,status').eq('project_id', pid),
      supabase.from('rfq_documents').select('id,stage').eq('project_id', pid),
      supabase.from('work_orders').select('status').eq('project_id', pid),
      supabase.from('issued_log').select('qty').eq('project_id', pid),
      supabase.from('tooling_costings').select('tv_no,charge_start,charge_end').eq('project_id', pid),
    ])

    const res = resData.data || []
    const inv = invData.data || []
    const vars = varData.data || []
    const parts = partsData.data || []
    const hire = hireData.data || []
    const ships = shipData.data || []
    const wos = woData.data || []
    const issued = issuedData.data || []

    const onsite = res.filter(r => r.mob_in && r.mob_in <= todayStr && (!r.mob_out || r.mob_out >= todayStr))
    const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    let tsHours = 0
    for (const sheet of (tsData.data || [])) {
      const crew = (sheet.crew || []) as { days?: Record<string, { hours?: number }> }[]
      tsHours += crew.reduce((s, m) => s + Object.values(m.days || {}).reduce((ds, d) => ds + (d.hours || 0), 0), 0)
    }

    const invoiceTotal = inv.reduce((s, i) => s + (i.amount || 0), 0)
    const approvedTotal = inv.filter(i => ['approved', 'paid'].includes(i.status)).reduce((s, i) => s + (i.amount || 0), 0)
    const pendingTotal = inv.filter(i => ['received', 'checked'].includes(i.status)).reduce((s, i) => s + (i.amount || 0), 0)

    const dryHire = hire.filter(h => h.hire_type === 'dry').length
    const wetHire = hire.filter(h => h.hire_type === 'wet').length
    const localHire = hire.filter(h => h.hire_type === 'local').length

    const partsTotal = parts.length
    const partsReceived = parts.filter(p => p.status === 'received' || p.status === 'issued').length
    const partsIssued = (partsData.data || []).filter((p: { status?: string }) => p.status === 'issued').length

    const rfqDocs = (subconData.data || []) as { id: string; stage: string }[]
    const openRfqs = rfqDocs.filter(r => r.stage === 'issued' || r.stage === 'responses_in').length
    const contracts = rfqDocs.filter(r => r.stage === 'awarded' || r.stage === 'contracted').length

    const woTotal = wos.length
    const woInProg = wos.filter(w => w.status === 'in_progress').length

    const shipImports = ships.filter(s => s.direction === 'import').length
    const shipExports = ships.filter(s => s.direction === 'export').length
    const shipPending = ships.filter(s => s.status === 'pending' || s.status === 'in_transit').length

    const varApproved = vars.filter(v => v.status === 'approved')
    const varApprovedValue = varApproved.reduce((s, v) => s + (v.value || 0), 0)
    const issuedQty = (issued as unknown as { qty?: number }[]).reduce((s, e) => s + (e.qty || 0), 0)

    setData({
      onsite: onsite.length, resTotal: res.length,
      incoming: res.filter(r => r.mob_in && r.mob_in > todayStr && r.mob_in <= next7).length,
      tsWeeks: (tsData.data || []).length, tsHours,
      invoiceCount: inv.length, invoiceTotal, approvedTotal, pendingTotal,
      poCount: poData.count || 0,
      dryHire, wetHire, localHire,
      carCount: (carData.data || []).length,
      accomCount: (accomData.data || []).length,
      varCount: vars.length, varApproved: varApproved.length, varApprovedValue,
      partsTotal, partsReceived, partsIssued,
      partsPending: parts.filter(p => !p.status || p.status === 'pending').length,
      issuedQty,
      openRfqs, contracts,
      woTotal, woInProg,
      shipImports, shipExports, shipPending,
    })

    // 7-day lookahead
    const events: LookaheadEvent[] = []
    const inWindow = (d: string | null | undefined) => d && d >= todayStr && d <= next7
    const daysFrom = (d: string) => Math.round((new Date(d + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000)

    const arrMap: Record<string, string[]> = {}
    const depMap: Record<string, string[]> = {}
    for (const r of res) {
      if (inWindow(r.mob_in)) { if (!arrMap[r.mob_in!]) arrMap[r.mob_in!] = []; arrMap[r.mob_in!].push(r.name || '') }
      if (r.mob_out && inWindow(r.mob_out)) { if (!depMap[r.mob_out]) depMap[r.mob_out] = []; depMap[r.mob_out].push(r.name || '') }
    }
    for (const [d, names] of Object.entries(arrMap)) {
      events.push({ date: d, icon: '👤', label: `${names.length} person${names.length > 1 ? 's' : ''} arrive${names.length === 1 ? 's' : ''}`, sub: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''), days: daysFrom(d), panel: 'hr-resources' })
    }
    for (const [d, names] of Object.entries(depMap)) {
      events.push({ date: d, icon: '👋', label: `${names.length} person${names.length > 1 ? 's' : ''} depart${names.length === 1 ? 's' : ''}`, sub: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''), days: daysFrom(d), panel: 'hr-resources' })
    }
    for (const h of hire) {
      const icon = h.hire_type === 'wet' ? '🏗️' : h.hire_type === 'local' ? '🧰' : '🚜'
      const panel = `hire-${h.hire_type}`
      if (inWindow(h.start_date)) events.push({ date: h.start_date!, icon, label: `${h.name || 'Equipment'} on-hire`, sub: h.vendor || '', days: daysFrom(h.start_date!), panel })
      if (h.end_date && inWindow(h.end_date)) events.push({ date: h.end_date, icon, label: `${h.name || 'Equipment'} off-hire`, sub: h.vendor || '', days: daysFrom(h.end_date), panel })
    }
    for (const c of (carData.data || [])) {
      const lbl = c.vehicle_type ? `${c.vehicle_type}${c.rego ? ` (${c.rego})` : ''}` : 'Car hire'
      if (inWindow(c.start_date)) events.push({ date: c.start_date!, icon: '🚗', label: `${lbl} pickup`, sub: c.vendor || '', days: daysFrom(c.start_date!), panel: 'hr-cars' })
      if (c.end_date && inWindow(c.end_date)) events.push({ date: c.end_date, icon: '🚗', label: `${lbl} return`, sub: c.vendor || '', days: daysFrom(c.end_date), panel: 'hr-cars' })
    }
    for (const a of (accomData.data || [])) {
      const lbl = `${a.property || 'Accom'}${a.room ? ` · ${a.room}` : ''}`
      const occ = ((a.occupants as string[]) || []).length
      if (inWindow(a.check_in)) events.push({ date: a.check_in!, icon: '🏨', label: `${lbl} check-in`, sub: `${occ} occupant${occ !== 1 ? 's' : ''}`, days: daysFrom(a.check_in!), panel: 'hr-accommodation' })
      if (a.check_out && inWindow(a.check_out)) events.push({ date: a.check_out, icon: '🏨', label: `${lbl} check-out`, sub: `${occ} occupant${occ !== 1 ? 's' : ''}`, days: daysFrom(a.check_out), panel: 'hr-accommodation' })
    }
    for (const tc of (toolData.data || [])) {
      if (inWindow(tc.charge_start)) events.push({ date: tc.charge_start!, icon: '🔩', label: `TV${tc.tv_no} rental starts`, sub: 'Charge period begins', days: daysFrom(tc.charge_start!), panel: 'tooling-tvs' })
      if (tc.charge_end && inWindow(tc.charge_end)) events.push({ date: tc.charge_end, icon: '🔩', label: `TV${tc.tv_no} rental ends`, sub: 'Return to Germany', days: daysFrom(tc.charge_end), panel: 'tooling-tvs' })
    }
    events.sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
    setLookahead(events)
    setLoading(false)
  }

  // ── Tile renderer ───────────────────────────────────────────────────────────
  const d = data as Record<string, number> | null
  const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short' })

  function renderTile(tile: DashboardTileConfig) {
    if (!d) return null
    switch (tile.id) {

      case 'lookahead':
        return (
          <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>7-Day Lookahead</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
                {new Date(todayStr).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })} – {new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
              </div>
            </div>
            {lookahead.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: '12px', padding: '12px 0' }}>No events in the next 7 days.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {lookahead.slice(0, tile.size === 'wide' ? 12 : 8).map((ev, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: '5px', background: 'var(--bg3)', cursor: ev.panel ? 'pointer' : 'default' }}
                    onClick={() => ev.panel && setActivePanel(ev.panel)}>
                    <span style={{ fontSize: '16px', flexShrink: 0 }}>{ev.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.label}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.sub}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: ev.days === 0 ? 'var(--red)' : ev.days === 1 ? 'var(--amber)' : 'var(--text3)' }}>
                        {ev.days === 0 ? 'Today' : ev.days === 1 ? 'Tomorrow' : `In ${ev.days}d`}
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text3)' }}>{fmtDay(ev.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'forecast-snapshot':
        return (
          <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>Forecast Snapshot</div>
              <button className="btn btn-sm" onClick={() => setActivePanel('cost-forecast')}>Full Forecast →</button>
            </div>
            {d.forecastWeeks && ((d.forecastWeeks as unknown) as { week: string; hc: number; cost: number; sell: number; gm: number }[]).slice(0, 5).map((w, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: '11px' }}>{w.week}</span>
                <span style={{ color: 'var(--mod-hr)', fontSize: '11px' }}>HC {w.hc}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{fmt(w.cost)}</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(w.sell)}</span>
                <span style={{ fontSize: '10px', color: w.gm >= 15 ? 'var(--green)' : 'var(--amber)' }}>{w.gm.toFixed(0)}%</span>
              </div>
            ))}
            {(!d.forecastWeeks || ((d.forecastWeeks as unknown) as unknown[]).length === 0) && (
              <div style={{ color: 'var(--text3)', fontSize: '12px', padding: '12px 0' }}>
                No forecast data — add resources and open the full forecast.
                <br /><br />
                <button className="btn btn-sm" onClick={() => setActivePanel('cost-forecast')}>View Forecast</button>
              </div>
            )}
          </div>
        )

      case 'personnel':
        return <ModCard icon="👥" title="Personnel" sub="Resources, timesheets, cars & accommodation" accent="var(--mod-hr)" panel="hr-resources"
          stats={[
            { val: d.resTotal, lbl: 'People', color: 'var(--mod-hr)' },
            { val: d.onsite, lbl: 'On Site', color: 'var(--green)' },
            { val: d.tsWeeks > 0 ? fmtH(d.tsHours) : '0h', lbl: 'Labour Hours', color: 'var(--green)' },
          ]} />

      case 'cars':
        return <ModCard icon="🚗" title="Cars" sub="Car hire bookings & costs" accent="var(--mod-hr)" panel="hr-cars"
          stats={[{ val: d.carCount || '—', lbl: 'Bookings', color: 'var(--mod-hr)' }]} />

      case 'accommodation':
        return <ModCard icon="🏨" title="Accommodation" sub="Room bookings & occupants" accent="var(--mod-hr)" panel="hr-accommodation"
          stats={[{ val: d.accomCount || '—', lbl: 'Rooms', color: 'var(--mod-hr)' }]} />

      case 'procurement':
        return <ModCard icon="🧾" title="Procurement" sub="POs, invoices & vendor payments" accent="#0284c7" panel="invoices"
          stats={[
            { val: d.poCount, lbl: 'POs', color: '#0284c7' },
            { val: d.invoiceCount, lbl: 'Invoices', color: '#0284c7' },
            { val: d.invoiceTotal > 0 ? fmt(d.invoiceTotal) : '—', lbl: 'Total', color: 'var(--text2)' },
          ]} />

      case 'variations':
        return <ModCard icon="🔀" title="Variations" sub="Scope changes, cost lines, client approvals" accent="var(--amber)" panel="variations"
          stats={[
            { val: d.varCount, lbl: 'Total VNs', color: 'var(--amber)' },
            { val: d.varApproved, lbl: 'Approved', color: 'var(--green)' },
            { val: d.varApprovedValue > 0 ? fmt(d.varApprovedValue) : '—', lbl: 'Approved $', color: 'var(--green)' },
          ]} />

      case 'spare-parts':
        return <ModCard icon="📦" title="Spare Parts" sub="WOSIT export, receiving, inventory & kit issuing" accent="var(--mod-parts)" panel="parts-list"
          stats={[
            { val: d.partsTotal, lbl: 'WOSIT Lines', color: 'var(--mod-parts)' },
            { val: d.partsPending, lbl: 'Pending', color: 'var(--amber)' },
            { val: d.issuedQty, lbl: 'Issued', color: 'var(--red)' },
          ]} />

      case 'work-orders':
        return <ModCard icon="🔩" title="Work Orders" sub="WO tracking & actuals allocation" accent="var(--mod-wo)" panel="work-orders"
          stats={[
            { val: d.woTotal || '—', lbl: 'Total WOs', color: 'var(--mod-wo)' },
            { val: d.woInProg || '—', lbl: 'In Progress', color: 'var(--amber)' },
          ]} />

      case 'hire':
        return <ModCard icon="🚜" title="Equipment Hire" sub="Dry, wet & local hire — rates, calendars, costs" accent="var(--mod-hire)" panel="hire-dry"
          stats={[
            { val: d.dryHire, lbl: 'Dry', color: 'var(--mod-hire)' },
            { val: d.wetHire, lbl: 'Wet', color: 'var(--mod-hire)' },
            { val: d.localHire, lbl: 'Local', color: 'var(--text2)' },
          ]} />

      case 'tooling':
        return <ModCard icon="🔧" title="SE Rental Tooling" sub="TV register, packages, costing & project splits" accent="var(--mod-tooling)" panel="tooling-tvs"
          stats={[
            { val: '—', lbl: 'TVs', color: 'var(--mod-tooling)' },
            { val: '—', lbl: 'Costed', color: 'var(--amber)' },
            { val: '—', lbl: 'EUR Cost', color: 'var(--green)' },
          ]} />

      case 'subcontractors':
        return <ModCard icon="🏗" title="Subcontractors" sub="RFQs, contracts & subcon timesheets" accent="#4f46e5" panel="subcon-rfq"
          stats={[
            { val: d.openRfqs || '—', lbl: 'Issued RFQs', color: '#4f46e5' },
            { val: d.contracts || '—', lbl: 'Awarded', color: 'var(--green)' },
          ]} />

      case 'logistics':
        return <ModCard icon="🚢" title="Logistics" sub="Import & export shipments tracking" accent="#0891b2" panel="shipping-dashboard"
          stats={[
            { val: d.shipImports || '—', lbl: 'Imports', color: '#0284c7' },
            { val: d.shipExports || '—', lbl: 'Exports', color: '#d97706' },
            { val: d.shipPending || '—', lbl: 'Pending', color: 'var(--amber)' },
          ]} />

      case 'hardware':
        return <ModCard icon="💰" title="Hardware Pricing" sub="Contract lines, escalation & customer offers" accent="#0891b2" panel="hardware-dashboard"
          stats={[
            { val: '—', lbl: 'Lines', color: '#0891b2' },
            { val: '—', lbl: 'Value', color: 'var(--green)' },
            { val: '—', lbl: 'Carts', color: 'var(--text2)' },
          ]} />

      case 'project-status':
        return (
          <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '10px' }}>🗓 Project Status</div>
            <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{activeProject?.name}</div>
            {activeProject?.wbs && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>{activeProject.wbs}</div>}
          </div>
        )

      default:
        return null
    }
  }

  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // ── Project header stats ─────────────────────────────────────────────────────
  const dStart = daysUntil(activeProject?.start_date)
  const dEnd = daysUntil(activeProject?.end_date)
  const isLive = dStart !== null && dStart <= 0 && (dEnd === null || dEnd > 0)
  const outageDayNum = isLive && activeProject?.start_date
    ? Math.floor((new Date(todayStr).getTime() - new Date(activeProject.start_date + 'T00:00:00').getTime()) / 86400000) + 1
    : null

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>

      {/* Project header */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>{activeProject?.name || 'No project selected'}</h1>
          <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
            {activeProject?.wbs && <span>{activeProject.wbs}</span>}
            {activeProject?.start_date && <span> · {activeProject.start_date}{activeProject.end_date ? ` → ${activeProject.end_date}` : ''}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {d && (
            <div className="card" style={{ padding: '8px 16px', display: 'flex', gap: '24px', alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--mod-hr)' }}>{d.onsite}</div>
                <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>People On Site</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{fmtH(d.tsHours)}</div>
                <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Total Hours to Date</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: '#f472b6' }}>{d.approvedTotal > 0 ? fmt(d.approvedTotal) : '—'}</div>
                <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Invoice Approved</div>
              </div>
            </div>
          )}
          {outageDayNum !== null && (
            <div className="card" style={{ padding: '8px 16px', textAlign: 'center', borderTop: '3px solid #8b5cf6' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: '#8b5cf6' }}>Day {outageDayNum}</div>
              {dEnd !== null && dEnd > 0 && <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{dEnd}d left</div>}
            </div>
          )}
          {dStart !== null && dStart > 0 && (
            <div className="card" style={{ padding: '8px 16px', textAlign: 'center', borderTop: '3px solid var(--amber)' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{dStart}d</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Days Until Start</div>
            </div>
          )}
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div> : d && (<>

        {/* Alerts */}
        {d.incoming > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fef3c7', borderLeft: '4px solid var(--amber)', marginBottom: '10px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠ <strong>{d.incoming} person{d.incoming > 1 ? 's' : ''}</strong> mobbing in the next 7 days</span>
            <button className="btn btn-sm" onClick={() => setActivePanel('hr-resources')}>View Resources →</button>
          </div>
        )}
        {d.pendingTotal > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fff7ed', borderLeft: '4px solid #f97316', marginBottom: '10px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🧾 <strong>{fmt(d.pendingTotal)}</strong> in invoices pending approval</span>
            <button className="btn btn-sm" onClick={() => setActivePanel('invoices')}>View Invoices →</button>
          </div>
        )}

        {/* Edit mode toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
          {editMode ? (
            <>
              <button className="btn btn-sm" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => setShowPicker(true)}>
                + Add Widget
              </button>
              <button className="btn btn-sm" onClick={resetLayout}>Reset Layout</button>
              <button className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => setEditMode(false)}>
                ✓ Done
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setEditMode(true)} title="Customise dashboard layout">
              ✎ Customise
            </button>
          )}
        </div>

        {/* Sortable tile grid */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleTiles.map(t => t.id)} strategy={rectSortingStrategy}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', alignItems: 'start' }}>
              {visibleTiles.map(tile => (
                <SortableTile key={tile.id} tile={tile} editMode={editMode}>
                  <div style={{
                    position: 'relative',
                    outline: editMode ? '2px dashed var(--accent)' : 'none',
                    outlineOffset: '2px',
                    borderRadius: '6px',
                    height: '100%',
                  }}>
                    {renderTile(tile)}
                    {editMode && (
                      <button
                        onClick={() => toggleTile(tile.id)}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          background: 'rgba(239,68,68,0.85)', border: 'none', borderRadius: '50%',
                          width: 20, height: 20, cursor: 'pointer', color: '#fff',
                          fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          zIndex: 10,
                        }}
                        title="Remove widget"
                      >✕</button>
                    )}
                  </div>
                </SortableTile>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Quick links */}
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { label: '📋 Timesheets', panel: 'hr-timesheets-trades' },
            { label: '📦 Parts List', panel: 'parts-list' },
            { label: '📥 Import Parts', panel: 'parts-import' },
            { label: '💰 Cost Dashboard', panel: 'cost-dashboard' },
            { label: '📈 Forecast', panel: 'cost-forecast' },
            { label: '📝 Variations', panel: 'variations' },
            { label: '⚙ Project Settings', panel: 'project-settings' },
            { label: '✅ Pre-Planning', panel: 'pre-planning' },
          ].map(q => <button key={q.panel} className="btn btn-sm" onClick={() => setActivePanel(q.panel)}>{q.label}</button>)}
        </div>

      </>)}

      {/* Widget picker modal */}
      {showPicker && (
        <WidgetPicker
          layout={layout}
          onClose={() => setShowPicker(false)}
          onToggle={id => { toggleTile(id) }}
          onSizeChange={(id, size) => { setTileSize(id, size) }}
        />
      )}
    </div>
  )
}
