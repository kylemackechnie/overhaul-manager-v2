import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { ModCard, TileLoading, TileError } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const todayStr = new Date().toISOString().slice(0, 10)

const def = {
  id: 'personnel',
  icon: '👥',
  title: 'Personnel',
  description: 'Resources, timesheets, cars and accommodation',
  category: 'People',
  defaultSize: 'md' as const,
  defaultVisible: true,
}

function PersonnelTile({ ctx }: { ctx: DashboardContext }) {
  const { data: res, isLoading: l1, error: e1 } = useQuery({
    queryKey: ['resources', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('resources').select('mob_in,mob_out').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })

  const { data: ts, isLoading: l2, error: e2 } = useQuery({
    queryKey: ['weekly_timesheets', 'list', ctx.projectId],
    queryFn: async () => {
      const { data } = await supabase.from('weekly_timesheets').select('crew').eq('project_id', ctx.projectId!)
      return data || []
    },
    enabled: !!ctx.projectId,
  })

  if (l1 || l2) return <TileLoading />
  if (e1 || e2) return <TileError />

  const onsite = (res || []).filter(r => r.mob_in && r.mob_in <= todayStr && (!r.mob_out || r.mob_out >= todayStr)).length
  let tsHours = 0
  for (const sheet of (ts || [])) {
    const crew = (sheet.crew || []) as { days?: Record<string, { hours?: number }> }[]
    tsHours += crew.reduce((s, m) => s + Object.values(m.days || {}).reduce((ds, d) => ds + (d.hours || 0), 0), 0)
  }

  return (
    <ModCard
      icon={def.icon} title={def.title}
      sub="Resources, timesheets, cars & accommodation"
      accent="var(--mod-hr)"
      onClick={() => ctx.setActivePanel('hr-resources')}
      stats={[
        { val: (res || []).length, lbl: 'People', color: 'var(--mod-hr)' },
        { val: onsite, lbl: 'On Site', color: 'var(--green)' },
        { val: tsHours > 0 ? tsHours.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + 'h' : '0h', lbl: 'Hours', color: 'var(--green)' },
      ]}
    />
  )
}

export const PersonnelTileEntry: TileComponent = { def, Component: PersonnelTile }
