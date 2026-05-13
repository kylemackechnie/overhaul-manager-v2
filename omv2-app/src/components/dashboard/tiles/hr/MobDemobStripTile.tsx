/**
 * MobDemobStripTile — 14-day Gantt-style mob/demob strip
 * Shows each resource as a horizontal bar across the next 14 days,
 * coloured by whether they're arriving, on-site, or departing.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { TileLoading, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const def = {
  id: 'mobdemob-14d-strip',
  icon: '🗓',
  title: 'Mob / Demob Strip',
  description: '14-day Gantt strip showing resource arrivals and departures',
  category: 'Headcount',
  defaultSize: 'full' as const,
  defaultVisible: true,
}

function MobDemobStripComp({ ctx }: { ctx: DashboardContext }) {
  const todayStr = new Date().toISOString().slice(0, 10)

  const { data, isLoading } = useQuery({
    queryKey: ['resources', 'mobdemob', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('resources').select('name,mob_in,mob_out,category').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })

  if (isLoading) return <TileLoading />

  // Build 14-day window
  const days: string[] = []
  for (let i = -2; i < 12; i++) {
    const d = new Date(Date.now() + i * 86400000)
    days.push(d.toISOString().slice(0, 10))
  }

  // Only resources active within the window
  const windowStart = days[0]
  const windowEnd = days[days.length - 1]
  const visible = (data || []).filter(r => {
    const mobin = r.mob_in || ''
    const mobout = r.mob_out || '9999-99-99'
    return mobin <= windowEnd && mobout >= windowStart
  }).slice(0, 20) // cap at 20 rows

  if (visible.length === 0) {
    return <TileEmpty icon="🗓" label="No resources active in the next 14 days" />
  }

  const catColor: Record<string, string> = {
    trades: 'var(--mod-hr)', management: '#6366f1', seag: '#92400e', subcontractor: '#7c3aed',
  }

  const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box', overflowX: 'auto' }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}>
        🗓 Mob / Demob Strip
        <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--text3)', marginLeft: '8px' }}>
          {fmtDay(days[0])} – {fmtDay(days[days.length - 1])}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${days.length}, 1fr)`, gap: '2px', minWidth: '600px' }}>
        {/* Header row */}
        <div />
        {days.map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: '9px', color: d === todayStr ? 'var(--accent)' : 'var(--text3)',
            fontWeight: d === todayStr ? 700 : 400, paddingBottom: '4px',
          }}>
            {new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit' })}
          </div>
        ))}
        {/* Resource rows */}
        {visible.map(r => {
          const mobin = r.mob_in || windowStart
          const mobout = r.mob_out || windowEnd
          const color = catColor[(r.category as string) || 'trades'] || 'var(--mod-hr)'
          return (
            <>
              <div key={r.name + '_label'} style={{ fontSize: '10px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px', paddingRight: '4px' }}>
                {r.name || '—'}
              </div>
              {days.map(d => {
                const active = d >= mobin && d <= mobout
                const arriving = d === mobin
                const departing = d === mobout
                return (
                  <div key={d} style={{
                    height: '16px',
                    background: active ? color : 'var(--bg3)',
                    opacity: active ? 1 : 0.2,
                    borderRadius: arriving ? '4px 0 0 4px' : departing ? '0 4px 4px 0' : '0',
                    borderLeft: arriving ? `2px solid ${color}` : undefined,
                    borderRight: departing ? `2px solid ${color}` : undefined,
                  }} />
                )
              })}
            </>
          )
        })}
      </div>
      {(data || []).length > 20 && (
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '8px' }}>
          Showing 20 of {(data || []).length} resources · <button className="btn btn-sm" onClick={() => ctx.setActivePanel('hr-resources')} style={{ fontSize: '10px' }}>View all →</button>
        </div>
      )}
    </div>
  )
}

export const MobDemobStripTile: TileComponent = { def, Component: MobDemobStripComp }
