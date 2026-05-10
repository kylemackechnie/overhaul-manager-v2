import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const def = {
  id: 'lookahead',
  icon: '📅',
  title: '7-Day Lookahead',
  description: 'Upcoming arrivals, departures, hire on/off, and bookings',
  category: 'Project',
  defaultSize: 'md' as const,
  defaultVisible: true,
}

interface LookaheadEvent {
  date: string; icon: string; label: string; sub: string; days: number; panel?: string
}

function LookaheadTileComp({ ctx }: { ctx: DashboardContext }) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const inWindow = (d: string | null | undefined) => d && d >= todayStr && d <= next7
  const daysFrom = (d: string) =>
    Math.round((new Date(d + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000)

  const { data, isLoading, error } = useQuery({
    queryKey: ['lookahead', ctx.projectId],
    queryFn: async () => {
      const pid = ctx.projectId!
      const [res, hire, cars, accom, tooling] = await Promise.all([
        supabase.from('resources').select('name,mob_in,mob_out').eq('project_id', pid),
        supabase.from('hire_items').select('name,vendor,hire_type,start_date,end_date').eq('project_id', pid),
        supabase.from('cars').select('vehicle_type,rego,vendor,start_date,end_date').eq('project_id', pid),
        supabase.from('accommodation').select('property,room,check_in,check_out,occupants').eq('project_id', pid),
        supabase.from('tooling_costings').select('tv_no,charge_start,charge_end').eq('project_id', pid),
      ])
      return {
        res: res.data || [],
        hire: hire.data || [],
        cars: cars.data || [],
        accom: accom.data || [],
        tooling: tooling.data || [],
      }
    },
    enabled: !!ctx.projectId,
  })

  if (isLoading) return <TileLoading />
  if (error) return <TileError />
  if (!data) return <TileEmpty icon="📅" label="No project selected" />

  const events: LookaheadEvent[] = []

  // Mob ins / outs
  const arrMap: Record<string, string[]> = {}
  const depMap: Record<string, string[]> = {}
  for (const r of data.res) {
    if (inWindow(r.mob_in)) { arrMap[r.mob_in!] = [...(arrMap[r.mob_in!] || []), r.name || ''] }
    if (r.mob_out && inWindow(r.mob_out)) { depMap[r.mob_out] = [...(depMap[r.mob_out] || []), r.name || ''] }
  }
  for (const [d, names] of Object.entries(arrMap)) {
    events.push({ date: d, icon: '👤', label: `${names.length} person${names.length > 1 ? 's' : ''} arrive${names.length === 1 ? 's' : ''}`, sub: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''), days: daysFrom(d), panel: 'hr-resources' })
  }
  for (const [d, names] of Object.entries(depMap)) {
    events.push({ date: d, icon: '👋', label: `${names.length} person${names.length > 1 ? 's' : ''} depart${names.length === 1 ? 's' : ''}`, sub: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''), days: daysFrom(d), panel: 'hr-resources' })
  }
  // Hire
  for (const h of data.hire) {
    const icon = h.hire_type === 'wet' ? '🏗️' : h.hire_type === 'local' ? '🧰' : '🚜'
    const panel = `hire-${h.hire_type}`
    if (inWindow(h.start_date)) events.push({ date: h.start_date!, icon, label: `${h.name || 'Equipment'} on-hire`, sub: h.vendor || '', days: daysFrom(h.start_date!), panel })
    if (h.end_date && inWindow(h.end_date)) events.push({ date: h.end_date, icon, label: `${h.name || 'Equipment'} off-hire`, sub: h.vendor || '', days: daysFrom(h.end_date), panel })
  }
  // Cars
  for (const c of data.cars) {
    const lbl = c.vehicle_type ? `${c.vehicle_type}${c.rego ? ` (${c.rego})` : ''}` : 'Car hire'
    if (inWindow(c.start_date)) events.push({ date: c.start_date!, icon: '🚗', label: `${lbl} pickup`, sub: c.vendor || '', days: daysFrom(c.start_date!), panel: 'hr-cars' })
    if (c.end_date && inWindow(c.end_date)) events.push({ date: c.end_date, icon: '🚗', label: `${lbl} return`, sub: c.vendor || '', days: daysFrom(c.end_date), panel: 'hr-cars' })
  }
  // Accommodation
  for (const a of data.accom) {
    const lbl = `${a.property || 'Accom'}${a.room ? ` · ${a.room}` : ''}`
    const occ = ((a.occupants as string[]) || []).length
    if (inWindow(a.check_in)) events.push({ date: a.check_in!, icon: '🏨', label: `${lbl} check-in`, sub: `${occ} occupant${occ !== 1 ? 's' : ''}`, days: daysFrom(a.check_in!), panel: 'hr-accommodation' })
    if (a.check_out && inWindow(a.check_out)) events.push({ date: a.check_out, icon: '🏨', label: `${lbl} check-out`, sub: `${occ} occupant${occ !== 1 ? 's' : ''}`, days: daysFrom(a.check_out), panel: 'hr-accommodation' })
  }
  // Tooling
  for (const tc of data.tooling) {
    if (inWindow(tc.charge_start)) events.push({ date: tc.charge_start!, icon: '🔩', label: `TV${tc.tv_no} rental starts`, sub: 'Charge period begins', days: daysFrom(tc.charge_start!), panel: 'tooling-tvs' })
    if (tc.charge_end && inWindow(tc.charge_end)) events.push({ date: tc.charge_end, icon: '🔩', label: `TV${tc.tv_no} rental ends`, sub: 'Return to Germany', days: daysFrom(tc.charge_end), panel: 'tooling-tvs' })
  }
  events.sort((a, b) => a.days - b.days)

  const fmtDay = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short' })

  const todayLabel = new Date(todayStr).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
  const endLabel = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px' }}>7-Day Lookahead</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{todayLabel} – {endLabel}</div>
      </div>
      {events.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: '12px', padding: '12px 0' }}>No events in the next 7 days.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {events.slice(0, 8).map((ev, i) => (
            <div key={i}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: '5px', background: 'var(--bg3)', cursor: ev.panel ? 'pointer' : 'default' }}
              onClick={() => ev.panel && ctx.setActivePanel(ev.panel)}
            >
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
}

export const LookaheadTile: TileComponent = { def, Component: LookaheadTileComp }
