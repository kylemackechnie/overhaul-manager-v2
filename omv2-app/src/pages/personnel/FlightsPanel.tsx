import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Flight, Resource, Expense, PurchaseOrder } from '../../types'
import { HelpButton } from '../../components/HelpButton'

/**
 * FlightsPanel — Walk-Away Module 1 Step 4b
 *
 * Operational tracker for resource flight legs. Rows grouped by person,
 * with each leg (outbound, return, custom) as an expandable child.
 *
 * Architecture:
 *   - Each Flight row carries `planned_cost` + metadata (vendor, flight #, dates).
 *   - Actual cost is NOT stored here — it lives on a linked expense in the
 *     existing `expenses` table (category='Flight', resource_id set).
 *   - "Link expense" modal lists matching expenses, admin picks one,
 *     flights.linked_expense_id is set, the leg renders with the expense's
 *     amount/currency/receipt as derived display.
 *
 * Auto-backfill:
 *   - On page load, for any resource with flight_required = true and no
 *     existing flight rows on this project, create the default 2 legs
 *     (outbound + return at planned_cost = flight_cost_each, currency from
 *     category). One-shot per resource; once rows exist, no re-creation.
 *
 * What the forecast engine reads (Step 4d, not this file):
 *   - For every flight_required resource, treat outbound + return legs
 *     with linked_expense_id IS NOT NULL as actualised and skip the
 *     resource-level $500 estimate for those legs. Custom legs ignored.
 */

type LegType = 'outbound' | 'return' | 'custom'
type FlightStatus = 'pending' | 'booked' | 'cancelled'

interface FlightForm {
  id?: string
  resource_id: string
  leg_type: LegType
  leg_label: string
  vendor: string
  flight_number: string
  depart_date: string  // YYYY-MM-DD
  depart_time: string  // HH:MM (24h)
  origin: string
  destination: string
  planned_cost: number
  planned_currency: string
  status: FlightStatus
  linked_expense_id: string | null
  notes: string
}

const EMPTY_FORM: FlightForm = {
  resource_id: '',
  leg_type: 'outbound',
  leg_label: '',
  vendor: '',
  flight_number: '',
  depart_date: '',
  depart_time: '',
  origin: '',
  destination: '',
  planned_cost: 0,
  planned_currency: 'AUD',
  status: 'pending',
  linked_expense_id: null,
  notes: '',
}

const LEG_LABEL: Record<LegType, string> = {
  outbound: '✈ Outbound',
  return: '✈ Return',
  custom: '✈ Custom',
}

const STATUS_STYLE: Record<FlightStatus, { bg: string; color: string; label: string }> = {
  pending:   { bg: '#fef3c7', color: '#92400e', label: '⏳ Pending' },
  booked:    { bg: '#d1fae5', color: '#065f46', label: '✅ Booked' },
  cancelled: { bg: '#fee2e2', color: '#991b1b', label: '✗ Cancelled' },
}

// Format a number with currency symbol. Currency is the resource's expected
// currency at creation time — engine handles FX to AUD where needed.
function fmtMoney(amount: number, ccy: string): string {
  const sign = ccy === 'EUR' ? '€' : '$'
  return `${sign}${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${ccy}`
}

// Combine date + time strings into ISO timestamptz. Time optional.
function combineDepart(date: string, time: string): string | null {
  if (!date) return null
  const t = time && /^\d{1,2}:\d{2}$/.test(time) ? time : '00:00'
  return `${date}T${t}:00`
}

// Split an ISO timestamp back into date + time for the form.
function splitDepart(ts: string | null): { date: string; time: string } {
  if (!ts) return { date: '', time: '' }
  const d = new Date(ts)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  const date = d.toISOString().slice(0, 10)
  const time = d.toISOString().slice(11, 16)
  return { date, time }
}

export function FlightsPanel() {
  const { activeProject } = useAppStore()
  const projectId = activeProject?.id

  const [loading, setLoading] = useState(true)
  const [flights, setFlights] = useState<Flight[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])

  // Project FX rate, for the AUD-equivalent total at the bottom strip
  const eurRate = useMemo(() => {
    const rates = (activeProject?.currency_rates as { code: string; rate: number }[] | undefined) || []
    return rates.find(r => r.code === 'EUR')?.rate ?? 1.65
  }, [activeProject])

  // Expanded groups — keyed by resource_id. Default: all expanded with pending legs.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Modals
  const [flightModal, setFlightModal] = useState<'new' | Flight | null>(null)
  const [form, setForm] = useState<FlightForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [linkModal, setLinkModal] = useState<Flight | null>(null)

  const [search, setSearch] = useState('')

  async function load() {
    if (!projectId) return
    setLoading(true)
    const [flightsR, resR, expR, poR] = await Promise.all([
      supabase.from('flights').select('*').eq('project_id', projectId).order('leg_order'),
      supabase.from('resources').select('*').eq('project_id', projectId).order('name'),
      supabase.from('expenses').select('*').eq('project_id', projectId),
      supabase.from('purchase_orders').select('*').eq('project_id', projectId),
    ])
    if (flightsR.error) { toast(flightsR.error.message, 'error'); setLoading(false); return }
    if (resR.error)     { toast(resR.error.message,     'error'); setLoading(false); return }
    if (expR.error)     { toast(expR.error.message,     'error'); setLoading(false); return }
    if (poR.error)      { toast(poR.error.message,      'error'); setLoading(false); return }

    const allFlights = (flightsR.data || []) as Flight[]
    const allResources = (resR.data || []) as Resource[]
    setExpenses((expR.data || []) as Expense[])
    setPurchaseOrders((poR.data || []) as PurchaseOrder[])

    // ── Auto-backfill: for any flight_required resource without flight rows,
    //    create the default 2 legs (outbound + return). Runs once per resource;
    //    once rows exist, this branch is a no-op.
    const resWithFlights = new Set(allFlights.map(f => f.resource_id))
    const toBackfill = allResources.filter(r => r.flight_required && !resWithFlights.has(r.id))
    if (toBackfill.length) {
      const inserts: Partial<Flight>[] = []
      for (const r of toBackfill) {
        const currency = r.category === 'seag' ? 'EUR' : 'AUD'
        const cost = typeof r.flight_cost_each === 'number' ? r.flight_cost_each : 500
        inserts.push({
          project_id: projectId, resource_id: r.id,
          leg_type: 'outbound', leg_order: 0,
          planned_cost: cost, planned_currency: currency, status: 'pending',
        })
        inserts.push({
          project_id: projectId, resource_id: r.id,
          leg_type: 'return', leg_order: 1,
          planned_cost: cost, planned_currency: currency, status: 'pending',
        })
      }
      const { data: inserted, error: insErr } = await supabase
        .from('flights').insert(inserts).select('*')
      if (insErr) {
        toast(`Backfill error: ${insErr.message}`, 'error')
      } else {
        allFlights.push(...((inserted || []) as Flight[]))
        if (toBackfill.length === 1) toast(`Created flight legs for ${toBackfill[0].name}`, 'success')
        else toast(`Created flight legs for ${toBackfill.length} resources`, 'success')
      }
    }

    setFlights(allFlights)
    setResources(allResources)

    // Default expansion: any group that has at least one non-cancelled pending leg
    const pendingResIds = new Set(
      allFlights.filter(f => f.status === 'pending').map(f => f.resource_id),
    )
    setExpanded(pendingResIds)

    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  // Group flights by resource. Only resources with flight_required = true OR
  // existing flight rows are listed (legacy untick + still has rows = banner case).
  const grouped = useMemo(() => {
    const byRes: Record<string, { resource: Resource; legs: Flight[] }> = {}
    for (const r of resources) {
      if (r.flight_required) byRes[r.id] = { resource: r, legs: [] }
    }
    for (const f of flights) {
      if (!byRes[f.resource_id]) {
        // Orphan: resource has flights but flag was unticked. Still show.
        const r = resources.find(rr => rr.id === f.resource_id)
        if (r) byRes[f.resource_id] = { resource: r, legs: [] }
      }
      byRes[f.resource_id]?.legs.push(f)
    }
    // Sort legs within group
    for (const g of Object.values(byRes)) {
      g.legs.sort((a, b) => a.leg_order - b.leg_order)
    }
    // Apply search filter to person name
    const needle = search.trim().toLowerCase()
    const groups = Object.values(byRes).filter(g =>
      !needle || g.resource.name.toLowerCase().includes(needle)
    )
    // Sort: groups with pending legs first, then alphabetical
    groups.sort((a, b) => {
      const aPending = a.legs.some(l => l.status === 'pending')
      const bPending = b.legs.some(l => l.status === 'pending')
      if (aPending !== bPending) return aPending ? -1 : 1
      return a.resource.name.localeCompare(b.resource.name)
    })
    return groups
  }, [flights, resources, search])

  // Totals strip — convert EUR planned to AUD for the rollup
  const totals = useMemo(() => {
    let plannedAud = 0, actualAud = 0, plannedLegs = 0, actualisedLegs = 0
    for (const g of grouped) {
      for (const f of g.legs) {
        if (f.status === 'cancelled') continue
        plannedLegs++
        const fx = f.planned_currency === 'EUR' ? eurRate : 1
        plannedAud += (f.planned_cost || 0) * fx
        if (f.linked_expense_id) {
          actualisedLegs++
          const exp = expenses.find(e => e.id === f.linked_expense_id)
          if (exp) {
            const expFx = exp.currency === 'EUR' ? eurRate : 1
            actualAud += (exp.cost_ex_gst || exp.amount || 0) * expFx
          }
        }
      }
    }
    return { plannedAud, actualAud, varianceAud: actualAud - plannedAud, plannedLegs, actualisedLegs }
  }, [grouped, expenses, eurRate])

  // Orphan banner: resources with no flight_required flag but still have rows
  const orphanedGroups = grouped.filter(g => !g.resource.flight_required)

  // ── Modal: new flight or edit existing ─────────────────────────────────────
  function openNew(prefillResourceId?: string, prefillLeg?: LegType) {
    if (prefillResourceId) {
      const r = resources.find(rr => rr.id === prefillResourceId)
      if (r) {
        const currency = r.category === 'seag' ? 'EUR' : 'AUD'
        setForm({
          ...EMPTY_FORM,
          resource_id: r.id,
          leg_type: prefillLeg || 'custom',
          planned_cost: typeof r.flight_cost_each === 'number' ? r.flight_cost_each : 500,
          planned_currency: currency,
        })
      } else {
        setForm(EMPTY_FORM)
      }
    } else {
      setForm(EMPTY_FORM)
    }
    setFlightModal('new')
  }

  function openEdit(f: Flight) {
    const { date, time } = splitDepart(f.depart_at)
    setForm({
      id: f.id,
      resource_id: f.resource_id,
      leg_type: f.leg_type,
      leg_label: f.leg_label || '',
      vendor: f.vendor || '',
      flight_number: f.flight_number || '',
      depart_date: date,
      depart_time: time,
      origin: f.origin || '',
      destination: f.destination || '',
      planned_cost: f.planned_cost,
      planned_currency: f.planned_currency,
      status: f.status,
      linked_expense_id: f.linked_expense_id,
      notes: f.notes || '',
    })
    setFlightModal(f)
  }

  async function saveFlight() {
    if (!projectId || !form.resource_id) { toast('Person required', 'error'); return }
    if (form.leg_type === 'custom' && !form.leg_label.trim()) {
      toast('Custom legs need a label (e.g. "Home visit return")', 'error'); return
    }
    setSaving(true)

    const payload: Partial<Flight> = {
      project_id: projectId,
      resource_id: form.resource_id,
      leg_type: form.leg_type,
      leg_label: form.leg_type === 'custom' ? form.leg_label.trim() : null,
      vendor: form.vendor.trim(),
      flight_number: form.flight_number.trim(),
      depart_at: combineDepart(form.depart_date, form.depart_time),
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      planned_cost: form.planned_cost,
      planned_currency: form.planned_currency,
      status: form.status,
      notes: form.notes,
    }

    // For new custom legs, compute leg_order = max existing for this person + 1.
    // Outbound/return legs keep their conventional 0/1 ordering.
    if (!form.id) {
      if (form.leg_type === 'custom') {
        const existing = flights.filter(f => f.resource_id === form.resource_id)
        const maxOrder = existing.reduce((m, f) => Math.max(m, f.leg_order), -1)
        ;(payload as Flight).leg_order = maxOrder + 1
      } else {
        ;(payload as Flight).leg_order = form.leg_type === 'outbound' ? 0 : 1
      }
    }

    const { error } = form.id
      ? await supabase.from('flights').update(payload).eq('id', form.id)
      : await supabase.from('flights').insert(payload)
    if (error) { toast(error.message, 'error'); setSaving(false); return }

    toast(form.id ? 'Flight saved' : 'Flight added', 'success')
    setSaving(false); setFlightModal(null); load()
  }

  async function deleteFlight(f: Flight) {
    if (!confirm(`Delete this ${f.leg_type} leg for ${resourceName(f.resource_id)}?`)) return
    const { error } = await supabase.from('flights').delete().eq('id', f.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Flight deleted', 'success'); load()
  }

  function resourceName(id: string): string {
    return resources.find(r => r.id === id)?.name || '—'
  }

  // ── Link expense modal ─────────────────────────────────────────────────────
  async function linkExpense(flight: Flight, expenseId: string) {
    const { error } = await supabase.from('flights').update({ linked_expense_id: expenseId, status: 'booked' }).eq('id', flight.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Expense linked', 'success'); setLinkModal(null); load()
  }

  async function unlinkExpense(flight: Flight) {
    if (!confirm('Unlink this expense from the flight leg? The expense itself is not deleted.')) return
    const { error } = await supabase.from('flights').update({ linked_expense_id: null }).eq('id', flight.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Expense unlinked', 'success'); load()
  }

  // Candidate expenses for the link modal: category='Flight', resource_id matches,
  // not already linked to another flight leg.
  const linkCandidates = useMemo(() => {
    if (!linkModal) return []
    const linkedIds = new Set(flights.filter(f => f.id !== linkModal.id && f.linked_expense_id).map(f => f.linked_expense_id))
    return expenses.filter(e =>
      e.category === 'Flight' &&
      e.resource_id === linkModal.resource_id &&
      !linkedIds.has(e.id)
    )
  }, [linkModal, expenses, flights])

  function toggleExpand(resourceId: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(resourceId)) n.delete(resourceId)
      else n.add(resourceId)
      return n
    })
  }

  function expandAll()   { setExpanded(new Set(grouped.map(g => g.resource.id))) }
  function collapseAll() { setExpanded(new Set()) }

  if (loading) {
    return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /> Loading flights...</div></div>
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Flights</h1>
            <HelpButton panelId="hr-flights" />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {grouped.length} {grouped.length === 1 ? 'person' : 'people'} · {totals.plannedLegs} legs · {totals.actualisedLegs} actualised
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input"
            placeholder="Search person..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '200px' }}
          />
          <button className="btn btn-sm" onClick={expandAll}>Expand all</button>
          <button className="btn btn-sm" onClick={collapseAll}>Collapse all</button>
          <button className="btn btn-primary" onClick={() => openNew()}>+ Add Flight Leg</button>
        </div>
      </div>

      {orphanedGroups.length > 0 && (
        <div style={{
          padding: '10px 14px', marginBottom: '12px',
          background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: '6px',
          color: '#92400e', fontSize: '12px',
        }}>
          ⚠ {orphanedGroups.length} {orphanedGroups.length === 1 ? 'resource has' : 'resources have'} flight legs but <strong>Flight Required</strong> is unticked on their resource record. Either re-tick the flag or delete the legs.
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="empty-state">
          <div className="icon">✈️</div>
          <h3>No flights to track</h3>
          <p>Tick <strong>Flight Required</strong> on a resource and the page will auto-create outbound + return legs.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '32px' }}></th>
                <th>Person</th>
                <th style={{ textAlign: 'center' }}>Legs</th>
                <th style={{ textAlign: 'right' }}>Planned</th>
                <th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Variance</th>
                <th>Booked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(g => {
                const isExpanded = expanded.has(g.resource.id)
                const activeLegs = g.legs.filter(l => l.status !== 'cancelled')
                const bookedCount = activeLegs.filter(l => l.linked_expense_id).length
                const fx = (ccy: string) => ccy === 'EUR' ? eurRate : 1
                const plannedAud = activeLegs.reduce((s, l) => s + l.planned_cost * fx(l.planned_currency), 0)
                let actualAud = 0
                for (const l of activeLegs) {
                  if (!l.linked_expense_id) continue
                  const e = expenses.find(x => x.id === l.linked_expense_id)
                  if (!e) continue
                  actualAud += (e.cost_ex_gst || e.amount || 0) * fx(e.currency || 'AUD')
                }
                const varianceAud = bookedCount === activeLegs.length ? actualAud - plannedAud : null

                return (
                  <FlightGroup
                    key={g.resource.id}
                    resource={g.resource}
                    legs={g.legs}
                    expenses={expenses}
                    purchaseOrders={purchaseOrders}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(g.resource.id)}
                    bookedCount={bookedCount}
                    totalActiveLegs={activeLegs.length}
                    plannedAud={plannedAud}
                    actualAud={actualAud}
                    varianceAud={varianceAud}
                    onEditLeg={openEdit}
                    onDeleteLeg={deleteFlight}
                    onLinkExpense={f => setLinkModal(f)}
                    onUnlinkExpense={unlinkExpense}
                    onAddLeg={() => openNew(g.resource.id, 'custom')}
                  />
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: '10px 12px' }}>
                  Totals (AUD, EUR converted at {eurRate.toFixed(2)})
                </td>
                <td style={{ textAlign: 'right' }}>${totals.plannedAud.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                <td style={{ textAlign: 'right' }}>${totals.actualAud.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                <td style={{ textAlign: 'right', color: totals.varianceAud < 0 ? 'var(--mod-hr)' : totals.varianceAud > 0 ? 'var(--amber)' : undefined }}>
                  {totals.varianceAud === 0 ? '—' : `${totals.varianceAud < 0 ? '−' : '+'}$${Math.abs(totals.varianceAud).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </td>
                <td colSpan={2}>{totals.actualisedLegs} of {totals.plannedLegs}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Add/Edit Flight modal ──────────────────────────────────────────── */}
      {flightModal && (
        <div className="modal-overlay" onClick={() => !saving && setFlightModal(null)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{flightModal === 'new' ? 'New Flight Leg' : 'Edit Flight Leg'}</h2>
              <button className="btn-icon" onClick={() => setFlightModal(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="fg">
                <label>Person *</label>
                <select className="input" value={form.resource_id} onChange={e => {
                  const id = e.target.value
                  const r = resources.find(rr => rr.id === id)
                  setForm(f => ({
                    ...f, resource_id: id,
                    planned_cost: r && typeof r.flight_cost_each === 'number' ? r.flight_cost_each : f.planned_cost,
                    planned_currency: r ? (r.category === 'seag' ? 'EUR' : 'AUD') : f.planned_currency,
                  }))
                }}>
                  <option value="">— select —</option>
                  {resources.filter(r => r.flight_required).map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.category})</option>
                  ))}
                </select>
              </div>

              <div className="fg">
                <label>Leg type *</label>
                <div style={{ display: 'flex', gap: '14px', fontSize: '13px' }}>
                  {(['outbound', 'return', 'custom'] as LegType[]).map(t => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input type="radio" checked={form.leg_type === t} onChange={() => setForm(f => ({ ...f, leg_type: t }))} />
                      {LEG_LABEL[t]}
                    </label>
                  ))}
                </div>
              </div>

              {form.leg_type === 'custom' && (
                <div className="fg">
                  <label>Custom leg label *</label>
                  <input type="text" className="input" placeholder='e.g. "Home visit return"'
                    value={form.leg_label} onChange={e => setForm(f => ({ ...f, leg_label: e.target.value }))} />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="fg">
                  <label>Vendor</label>
                  <input type="text" className="input" placeholder="e.g. Qantas"
                    value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Flight number</label>
                  <input type="text" className="input" placeholder="e.g. QF734"
                    value={form.flight_number} onChange={e => setForm(f => ({ ...f, flight_number: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="fg">
                  <label>Depart date</label>
                  <input type="date" className="input"
                    value={form.depart_date} onChange={e => setForm(f => ({ ...f, depart_date: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Depart time</label>
                  <input type="time" className="input"
                    value={form.depart_time} onChange={e => setForm(f => ({ ...f, depart_time: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="fg">
                  <label>From (origin)</label>
                  <input type="text" className="input" placeholder="e.g. SYD"
                    value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>To (destination)</label>
                  <input type="text" className="input" placeholder="e.g. ROK"
                    value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '12px', alignItems: 'end' }}>
                <div className="fg">
                  <label>Planned cost</label>
                  <input type="number" className="input" min={0} step={50}
                    value={form.planned_cost}
                    onChange={e => setForm(f => ({ ...f, planned_cost: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.planned_currency}
                    onChange={e => setForm(f => ({ ...f, planned_currency: e.target.value }))}>
                    <option value="AUD">AUD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <div className="fg">
                <label>Status</label>
                <select className="input" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as FlightStatus }))}>
                  <option value="pending">⏳ Pending</option>
                  <option value="booked">✅ Booked</option>
                  <option value="cancelled">✗ Cancelled</option>
                </select>
              </div>

              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2}
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setFlightModal(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={saveFlight} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link Expense modal ─────────────────────────────────────────────── */}
      {linkModal && (
        <div className="modal-overlay" onClick={() => setLinkModal(null)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Link Expense — {resourceName(linkModal.resource_id)}, {LEG_LABEL[linkModal.leg_type]}{linkModal.leg_label ? ` (${linkModal.leg_label})` : ''}</h2>
              <button className="btn-icon" onClick={() => setLinkModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                Showing unlinked expenses with category <strong>Flight</strong> for this person:
              </p>
              {linkCandidates.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text3)' }}>
                  No matching expenses yet.
                  <br /><br />
                  <em>Add the expense from the Expenses page first — set category to Flight and select this person as the resource.</em>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {linkCandidates.map(e => (
                    <div key={e.id} style={{
                      padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '6px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.vendor || '—'} · {fmtMoney(e.cost_ex_gst || e.amount || 0, e.currency || 'AUD')}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
                          {e.date || '—'} · {e.description || ''} {e.wbs ? `· WBS ${e.wbs}` : ''} {e.receipt_paths?.length ? '· 📎' : ''}
                        </div>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={() => linkExpense(linkModal, e.id)}>
                        Link
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setLinkModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Group row component ───────────────────────────────────────────────────────

interface FlightGroupProps {
  resource: Resource
  legs: Flight[]
  expenses: Expense[]
  purchaseOrders: PurchaseOrder[]
  isExpanded: boolean
  onToggle: () => void
  bookedCount: number
  totalActiveLegs: number
  plannedAud: number
  actualAud: number
  varianceAud: number | null
  onEditLeg: (f: Flight) => void
  onDeleteLeg: (f: Flight) => void
  onLinkExpense: (f: Flight) => void
  onUnlinkExpense: (f: Flight) => void
  onAddLeg: () => void
}

function FlightGroup(props: FlightGroupProps) {
  const { resource, legs, expenses, isExpanded, onToggle, bookedCount, totalActiveLegs, plannedAud, actualAud, varianceAud, onEditLeg, onDeleteLeg, onLinkExpense, onUnlinkExpense, onAddLeg } = props

  // Group row colour reflects readiness state
  const allBooked = bookedCount === totalActiveLegs && totalActiveLegs > 0
  const someBooked = bookedCount > 0 && !allBooked
  const groupColor = allBooked ? 'var(--mod-hr)' : someBooked ? 'var(--amber)' : 'var(--text3)'

  return (
    <>
      <tr style={{ background: 'var(--bg2)', cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ textAlign: 'center', fontSize: '14px' }}>{isExpanded ? '▼' : '▶'}</td>
        <td>
          <div style={{ fontWeight: 600 }}>{resource.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
            {resource.category} {resource.home_city ? `· ${resource.home_city}` : ''}
            {!resource.flight_required && <span style={{ color: 'var(--amber)' }}> · flight_required OFF</span>}
          </div>
        </td>
        <td style={{ textAlign: 'center' }}>{legs.length}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>${plannedAud.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{actualAud > 0 ? `$${actualAud.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: varianceAud !== null && varianceAud < 0 ? 'var(--mod-hr)' : varianceAud !== null && varianceAud > 0 ? 'var(--amber)' : undefined }}>
          {varianceAud === null ? '—' : `${varianceAud < 0 ? '−' : '+'}$${Math.abs(varianceAud).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        </td>
        <td style={{ color: groupColor, fontWeight: 600, fontSize: '12px' }}>
          {bookedCount} of {totalActiveLegs}
        </td>
        <td></td>
      </tr>

      {isExpanded && legs.map(leg => {
        const linkedExp = leg.linked_expense_id ? expenses.find(e => e.id === leg.linked_expense_id) : null
        return (
          <tr key={leg.id} style={{ background: leg.status === 'cancelled' ? '#f1f5f9' : undefined, opacity: leg.status === 'cancelled' ? 0.6 : 1 }}>
            <td></td>
            <td style={{ paddingLeft: '28px', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{LEG_LABEL[leg.leg_type]}{leg.leg_label ? ` · ${leg.leg_label}` : ''}</span>
                <span style={{
                  display: 'inline-block', padding: '2px 6px', borderRadius: '3px',
                  background: STATUS_STYLE[leg.status].bg, color: STATUS_STYLE[leg.status].color,
                  fontSize: '10px', fontWeight: 600,
                }}>
                  {STATUS_STYLE[leg.status].label}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
                {leg.vendor || '—'} {leg.flight_number || ''} {leg.depart_at ? `· ${new Date(leg.depart_at).toLocaleString()}` : ''} {leg.origin && leg.destination ? `· ${leg.origin}→${leg.destination}` : ''}
              </div>
            </td>
            <td colSpan={1}></td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>
              {fmtMoney(leg.planned_cost, leg.planned_currency)}
            </td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>
              {linkedExp ? fmtMoney(linkedExp.cost_ex_gst || linkedExp.amount || 0, linkedExp.currency || 'AUD') : '—'}
            </td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>
              {linkedExp ? (() => {
                const planned = leg.planned_currency === linkedExp.currency
                  ? leg.planned_cost
                  : 0  // currencies differ — variance not meaningful at the leg level
                if (!planned) return '—'
                const actual = linkedExp.cost_ex_gst || linkedExp.amount || 0
                const v = actual - planned
                return <span style={{ color: v < 0 ? 'var(--mod-hr)' : v > 0 ? 'var(--amber)' : undefined }}>{v < 0 ? '−' : '+'}{fmtMoney(Math.abs(v), leg.planned_currency)}</span>
              })() : '—'}
            </td>
            <td style={{ fontSize: '11px' }}>
              {linkedExp ? (
                <span style={{ color: 'var(--mod-hr)' }}>✓ Linked</span>
              ) : (
                <button className="btn btn-sm" onClick={() => onLinkExpense(leg)}>🔗 Link expense</button>
              )}
            </td>
            <td style={{ fontSize: '11px' }}>
              <button className="btn btn-sm" onClick={() => onEditLeg(leg)}>Edit</button>
              {linkedExp && <button className="btn btn-sm" onClick={() => onUnlinkExpense(leg)} title="Unlink the expense from this leg">Unlink</button>}
              <button className="btn btn-sm" onClick={() => onDeleteLeg(leg)}>Delete</button>
            </td>
          </tr>
        )
      })}

      {isExpanded && (
        <tr>
          <td></td>
          <td colSpan={7} style={{ paddingLeft: '28px', paddingTop: '6px', paddingBottom: '10px' }}>
            <button className="btn btn-sm" onClick={onAddLeg}>+ Add leg for {resource.name}</button>
          </td>
        </tr>
      )}
    </>
  )
}
