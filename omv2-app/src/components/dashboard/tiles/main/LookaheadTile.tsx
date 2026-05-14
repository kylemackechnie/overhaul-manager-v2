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

  // Build raw events first, then group by (date, kind, vendor) so that
  // "7 different containers all on-hire from Siemens Energy tomorrow" becomes
  // ONE row in the dashboard rather than 7 noisy rows.
  interface RawEvent {
    date: string; kind: string; icon: string; vendor: string; itemLabel: string; panel?: string
  }
  const raw: RawEvent[] = []

  // Mob ins / outs — already aggregated per-date by the original logic
  const arrMap: Record<string, string[]> = {}
  const depMap: Record<string, string[]> = {}
  for (const r of data.res) {
    if (inWindow(r.mob_in)) { arrMap[r.mob_in!] = [...(arrMap[r.mob_in!] || []), r.name || ''] }
    if (r.mob_out && inWindow(r.mob_out)) { depMap[r.mob_out] = [...(depMap[r.mob_out] || []), r.name || ''] }
  }
  for (const [d, names] of Object.entries(arrMap)) {
    raw.push({ date: d, kind: 'arrival', icon: '👤', vendor: '', itemLabel: `${names.length} person${names.length > 1 ? 's' : ''} arrive${names.length === 1 ? 's' : ''}`, panel: 'hr-resources' })
  }
  for (const [d, names] of Object.entries(depMap)) {
    raw.push({ date: d, kind: 'departure', icon: '👋', vendor: '', itemLabel: `${names.length} person${names.length > 1 ? 's' : ''} depart${names.length === 1 ? 's' : ''}`, panel: 'hr-resources' })
  }

  for (const h of data.hire) {
    const icon = h.hire_type === 'wet' ? '🏗️' : h.hire_type === 'local' ? '🧰' : '🚜'
    const panel = `hire-${h.hire_type}`
    if (inWindow(h.start_date)) raw.push({ date: h.start_date!, kind: `hire-on-${h.hire_type}`, icon, vendor: h.vendor || '', itemLabel: h.name || 'Equipment', panel })
    if (h.end_date && inWindow(h.end_date)) raw.push({ date: h.end_date, kind: `hire-off-${h.hire_type}`, icon, vendor: h.vendor || '', itemLabel: h.name || 'Equipment', panel })
  }
  for (const c of data.cars) {
    const lbl = c.vehicle_type ? `${c.vehicle_type}${c.rego ? ` (${c.rego})` : ''}` : 'Car hire'
    if (inWindow(c.start_date)) raw.push({ date: c.start_date!, kind: 'car-pickup', icon: '🚗', vendor: c.vendor || '', itemLabel: lbl, panel: 'hr-cars' })
    if (c.end_date && inWindow(c.end_date)) raw.push({ date: c.end_date, kind: 'car-return', icon: '🚗', vendor: c.vendor || '', itemLabel: lbl, panel: 'hr-cars' })
  }
  for (const a of data.accom) {
    const lbl = `${a.property || 'Accom'}${a.room ? ` · ${a.room}` : ''}`
    if (inWindow(a.check_in)) raw.push({ date: a.check_in!, kind: 'accom-in', icon: '🏨', vendor: '', itemLabel: lbl, panel: 'hr-accommodation' })
    if (a.check_out && inWindow(a.check_out)) raw.push({ date: a.check_out, kind: 'accom-out', icon: '🏨', vendor: '', itemLabel: lbl, panel: 'hr-accommodation' })
  }
  for (const tc of data.tooling) {
    if (inWindow(tc.charge_start)) raw.push({ date: tc.charge_start!, kind: 'tv-start', icon: '🔩', vendor: '', itemLabel: `TV${tc.tv_no} rental starts`, panel: 'tooling-tvs' })
    if (tc.charge_end && inWindow(tc.charge_end)) raw.push({ date: tc.charge_end, kind: 'tv-end', icon: '🔩', vendor: '', itemLabel: `TV${tc.tv_no} rental ends`, panel: 'tooling-tvs' })
  }

  // ── Group by (date | kind | vendor) ─────────────────────────────────────
  const KIND_LABEL: Record<string, { on: string; off?: string } | string> = {
    'arrival': '',
    'departure': '',
    'hire-on-dry': 'on-hire',  'hire-off-dry': 'off-hire',
    'hire-on-wet': 'on-hire',  'hire-off-wet': 'off-hire',
    'hire-on-local': 'on-hire','hire-off-local': 'off-hire',
    'car-pickup': 'pickup',    'car-return': 'return',
    'accom-in': 'check-in',    'accom-out': 'check-out',
    'tv-start': 'starts',      'tv-end': 'ends',
  }

  const groups = new Map<string, { date: string; icon: string; vendor: string; kind: string; items: string[]; panel?: string }>()
  for (const r of raw) {
    const key = `${r.date}|${r.kind}|${r.vendor}`
    const ex = groups.get(key)
    if (ex) ex.items.push(r.itemLabel)
    else groups.set(key, { date: r.date, icon: r.icon, vendor: r.vendor, kind: r.kind, items: [r.itemLabel], panel: r.panel })
  }

  const events: LookaheadEvent[] = []
  for (const g of groups.values()) {
    const verb = KIND_LABEL[g.kind] || ''
    const n = g.items.length
    let label: string
    let sub: string
    if (g.kind === 'arrival' || g.kind === 'departure') {
      // For mob events, items[0] is already a pre-formatted summary
      label = g.items[0]
      sub = ''
    } else if (n === 1) {
      label = `${g.items[0]} ${verb}`.trim()
      sub = g.vendor
    } else {
      // Multiple items on same date for same vendor → roll up
      const sample = g.items.slice(0, 2).join(', ')
      const more = n > 2 ? ` +${n - 2} more` : ''
      label = `${n} items ${verb}`.trim()
      sub = g.vendor ? `${g.vendor} · ${sample}${more}` : `${sample}${more}`
    }
    events.push({ date: g.date, icon: g.icon, label, sub, days: daysFrom(g.date), panel: g.panel })
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
