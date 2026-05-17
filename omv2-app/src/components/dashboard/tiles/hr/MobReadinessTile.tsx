/**
 * MobReadinessTile
 *
 * The single most action-driving tile in the app. For every resource arriving
 * in the next 14 days, shows a R/A/G row of their critical booking status:
 *   - ✈ Flight required & booked?
 *   - 🏨 Accommodation required & booked?
 *   - 🚗 Car required & booked?
 *   - 🪪 Inducted (within 365 days)?
 *
 * Each row clickable to jump to the resource detail.
 *
 * Default size: full (this is the action centrepiece).
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { TileLoading, TileEmpty } from '../../primitives'
import { useAppStore } from '../../../../store/appStore'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const def = {
  id: 'mob-readiness',
  icon: '🛬',
  title: 'Mob Readiness',
  description: 'Critical booking status (flight/accom/car/induction) for everyone arriving in the next 14 days',
  category: 'Alerts',
  defaultSize: 'full' as const,
  defaultVisible: true,
}

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

interface ReadinessRow {
  resource_id: string
  name: string
  mob_in: string
  daysAway: number
  category: string
  flight: 'ok' | 'pending' | 'na'
  accom: 'ok' | 'pending' | 'na'
  car: 'ok' | 'pending' | 'na'
  induction: 'ok' | 'pending' | 'na' | 'unknown'
  overallTone: 'red' | 'amber' | 'green'
  poLinked: 'ok' | 'pending' | 'na'
}

function MobReadinessComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()

  const { data, isLoading } = useQuery({
    queryKey: ['mob_readiness', ctx.projectId],
    queryFn: async () => {
      const todayStr = new Date().toISOString().slice(0, 10)
      const next14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      const [resR, accomR, carsR, flightsR] = await Promise.all([
        supabase.from('resources')
          .select('id,name,mob_in,mob_out,category,flight_required,accom_required,accom_booked,car_required,linked_po_id,person_id')
          .eq('project_id', ctx.projectId!)
          .gte('mob_in', todayStr)
          .lte('mob_in', next14)
          .order('mob_in'),
        // Match accommodation by person_id since not all systems set accom_booked flag
        supabase.from('accommodation')
          .select('person_id,occupants,check_in,check_out')
          .eq('project_id', ctx.projectId!),
        supabase.from('cars')
          .select('person_id,start_date,end_date')
          .eq('project_id', ctx.projectId!),
        // Operational signal: a non-cancelled outbound leg with a flight_number
        // entered = flight is confirmed and the readiness flag clears.
        // (linked_expense_id is a stricter reconciliation check used elsewhere.)
        supabase.from('flights')
          .select('resource_id,leg_type,status,flight_number')
          .eq('project_id', ctx.projectId!),
      ])
      return {
        resources: (resR.data || []) as ResourceRow[],
        accom: (accomR.data || []) as { person_id: string | null; occupants: unknown; check_in: string | null; check_out: string | null }[],
        cars: (carsR.data || []) as { person_id: string | null; start_date: string | null; end_date: string | null }[],
        flights: (flightsR.data || []) as { resource_id: string; leg_type: string; status: string; flight_number: string | null }[],
      }
    },
    enabled: !!ctx.projectId,
    staleTime: 60_000,
  })

  if (isLoading) return <TileLoading />
  if (!data || data.resources.length === 0) {
    return <TileEmpty icon="✅" label="No mobilisations in the next 14 days" />
  }

  // Build induction lookup — projects.induction_data keyed by person identifier
  // (legacy: name; modern: person_id). Treat induction as "ok" if dated within 365d.
  const inductionData = (activeProject?.induction_data as Array<{ name?: string; person_id?: string; date?: string }> | null) || []
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const inductedNames = new Set<string>()
  const inductedPersonIds = new Set<string>()
  for (const ind of inductionData) {
    if (!ind.date || ind.date < cutoff) continue
    if (ind.person_id) inductedPersonIds.add(ind.person_id)
    if (ind.name) inductedNames.add(ind.name.toLowerCase().trim())
  }

  const accomByPerson = new Map<string, { check_in: string; check_out: string | null }[]>()
  for (const a of data.accom) {
    if (!a.check_in) continue
    // Direct person_id link
    if (a.person_id) {
      const arr = accomByPerson.get(a.person_id) || []
      arr.push({ check_in: a.check_in, check_out: a.check_out })
      accomByPerson.set(a.person_id, arr)
    }
    // Fallback: occupants is a string[] of person_ids or names
    const occupants = Array.isArray(a.occupants) ? (a.occupants as string[]) : []
    for (const occ of occupants) {
      if (!occ) continue
      const arr = accomByPerson.get(occ) || []
      arr.push({ check_in: a.check_in, check_out: a.check_out })
      accomByPerson.set(occ, arr)
    }
  }

  const carsByPerson = new Map<string, { start_date: string; end_date: string | null }[]>()
  for (const c of data.cars) {
    if (!c.start_date || !c.person_id) continue
    const arr = carsByPerson.get(c.person_id) || []
    arr.push({ start_date: c.start_date, end_date: c.end_date })
    carsByPerson.set(c.person_id, arr)
  }

  // A resource is "flight ready" if their non-cancelled outbound leg has a
  // flight_number entered. Entering a flight number is the operational sign
  // the booking has been made; we don't wait for the receipt to be linked
  // (that's reconciliation, tracked separately).
  const flightBookedIds = new Set<string>()
  for (const f of data.flights) {
    if (f.status === 'cancelled') continue
    if (f.leg_type !== 'outbound') continue
    if (f.flight_number && f.flight_number.trim()) flightBookedIds.add(f.resource_id)
  }

  const rows: ReadinessRow[] = data.resources.map(r => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const daysAway = daysBetween(todayStr, r.mob_in!)
    const mobIn = r.mob_in!

    // Flight check: flight_required is the trigger; outbound leg with a
    // flight_number entered = booked. (See flightBookedIds construction.)
    const flight: ReadinessRow['flight'] = !r.flight_required
      ? 'na'
      : flightBookedIds.has(r.id) ? 'ok' : 'pending'

    // Accommodation: required → look for an accom booking that covers the mob period
    let accom: ReadinessRow['accom'] = 'na'
    if (r.accom_required) {
      const personAccom = (r.person_id ? accomByPerson.get(r.person_id) : undefined)
        || accomByPerson.get(r.id)
        || []
      const covered = personAccom.some(a =>
        a.check_in <= mobIn && (!a.check_out || a.check_out >= mobIn))
      // Also accept the explicit flag
      accom = r.accom_booked || covered ? 'ok' : 'pending'
    }

    // Car: required → look for car covering mob date
    let car: ReadinessRow['car'] = 'na'
    if (r.car_required) {
      const personCars = carsByPerson.get(r.id) || []
      const covered = personCars.some(c =>
        c.start_date <= mobIn && (!c.end_date || c.end_date >= mobIn))
      car = covered ? 'ok' : 'pending'
    }

    // Induction: ok if person was inducted within 365 days
    let induction: ReadinessRow['induction'] = 'unknown'
    if (r.person_id && inductedPersonIds.has(r.person_id)) induction = 'ok'
    else if (r.name && inductedNames.has(r.name.toLowerCase().trim())) induction = 'ok'
    else if (inductionData.length > 0) induction = 'pending'

    // Subcon PO link
    let poLinked: ReadinessRow['poLinked'] = 'na'
    if ((r.category || '') === 'subcontractor') {
      poLinked = r.linked_po_id ? 'ok' : 'pending'
    }

    // Overall tone
    const pendingCount = [flight, accom, car, induction, poLinked].filter(v => v === 'pending').length
    let overallTone: ReadinessRow['overallTone'] = 'green'
    if (pendingCount > 0) {
      overallTone = daysAway <= 3 ? 'red' : daysAway <= 7 ? 'amber' : 'amber'
      if (pendingCount >= 3 && daysAway <= 7) overallTone = 'red'
    }

    return {
      resource_id: r.id,
      name: r.name || '—',
      mob_in: r.mob_in!,
      daysAway,
      category: r.category || 'other',
      flight, accom, car, induction, poLinked,
      overallTone,
    }
  })

  rows.sort((a, b) => a.daysAway - b.daysAway)

  // Summary chips
  const redCount = rows.filter(r => r.overallTone === 'red').length
  const amberCount = rows.filter(r => r.overallTone === 'amber').length
  const greenCount = rows.filter(r => r.overallTone === 'green').length

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box', overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px' }}>🛬 Mob Readiness</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
            {rows.length} arrival{rows.length === 1 ? '' : 's'} in the next 14 days
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', fontSize: '10px', fontFamily: 'var(--mono)' }}>
          <Chip color="var(--red)" count={redCount} label="critical" />
          <Chip color="var(--amber)" count={amberCount} label="watch" />
          <Chip color="var(--green)" count={greenCount} label="ready" />
        </div>
      </div>

      {/* Compact readiness grid */}
      <div style={{ minWidth: '720px' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '120px 60px 1fr 40px 40px 40px 40px 40px', gap: '8px', fontSize: '9px', color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 6px', borderBottom: '1px solid var(--border2)' }}>
          <div>Person</div>
          <div>Mob</div>
          <div>Category</div>
          <div style={{ textAlign: 'center' }}>Flight</div>
          <div style={{ textAlign: 'center' }}>Accom</div>
          <div style={{ textAlign: 'center' }}>Car</div>
          <div style={{ textAlign: 'center' }}>Induct</div>
          <div style={{ textAlign: 'center' }}>PO</div>
        </div>
        {/* Rows */}
        {rows.slice(0, 18).map(r => (
          <div key={r.resource_id}
            onClick={() => ctx.setActivePanel('hr-resources')}
            style={{
              display: 'grid', gridTemplateColumns: '120px 60px 1fr 40px 40px 40px 40px 40px', gap: '8px',
              padding: '6px',
              borderLeft: `3px solid ${toneColor(r.overallTone)}`,
              marginTop: '2px',
              alignItems: 'center',
              cursor: 'pointer',
              background: 'var(--bg3)',
              borderRadius: '4px',
            }}>
            <div style={{ fontSize: '11px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <div style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: r.daysAway <= 3 ? 'var(--red)' : r.daysAway <= 7 ? 'var(--amber)' : 'var(--text3)', fontWeight: 700 }}>
              {r.daysAway === 0 ? 'today' : `+${r.daysAway}d`}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{r.category}</div>
            <StatusCell status={r.flight} />
            <StatusCell status={r.accom} />
            <StatusCell status={r.car} />
            <StatusCell status={r.induction} />
            <StatusCell status={r.poLinked} />
          </div>
        ))}
      </div>

      {rows.length > 18 && (
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '8px' }}>
          Showing 18 of {rows.length} arrivals — click any row to open Resources
        </div>
      )}
    </div>
  )
}

interface ResourceRow {
  id: string; name: string | null; mob_in: string | null; mob_out: string | null;
  category: string | null; flight_required: boolean | null;
  accom_required: boolean | null; accom_booked: boolean | null; car_required: boolean | null;
  linked_po_id: string | null; person_id: string | null;
}

function toneColor(t: 'red' | 'amber' | 'green') {
  return t === 'red' ? 'var(--red)' : t === 'amber' ? 'var(--amber)' : 'var(--green)'
}

function Chip({ color, count, label }: { color: string; count: number; label: string }) {
  if (count === 0) return null
  return (
    <span style={{ background: color, color: 'white', borderRadius: '11px', padding: '2px 8px', fontWeight: 700 }}>
      {count} {label}
    </span>
  )
}

function StatusCell({ status }: { status: 'ok' | 'pending' | 'na' | 'unknown' }) {
  if (status === 'na') return <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text3)' }}>—</div>
  if (status === 'unknown') return <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text3)' }}>?</div>
  const color = status === 'ok' ? 'var(--green)' : 'var(--red)'
  const icon = status === 'ok' ? '✓' : '✕'
  return (
    <div style={{ textAlign: 'center', fontSize: '13px', color, fontWeight: 800 }}>
      {icon}
    </div>
  )
}

export const MobReadinessTile: TileComponent = { def, Component: MobReadinessComp }
