/**
 * MainDashboardHeader + MainDashboardAlerts
 *
 * These are passed as `header` and `alerts` props to CustomisableDashboard.
 * Keeping them here avoids bloating the collapsed DashboardPanel wrapper.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useAppStore } from '../../../../store/appStore'
import { AlertBanner } from '../../primitives'
import { HelpButton } from '../../../HelpButton'

const todayStr = new Date().toISOString().slice(0, 10)
const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

export function MainDashboardHeader() {
  const { activeProject } = useAppStore()
  if (!activeProject) {
    return (
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>No project selected</h1>
      </div>
    )
  }

  // Day counter and days-until-start moved into DayCountTile (richer + drag-able).
  // Project mobilisation alerts moved into AttentionFeedTile.
  // Header now just identifies the project — info-density goes in the tiles.

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{activeProject.name}</h1>
        <HelpButton panelId="dashboard" />
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
        {activeProject.wbs && <span>{activeProject.wbs}</span>}
        {activeProject.start_date && (
          <span>
            {' '}· {activeProject.start_date}
            {activeProject.end_date ? ` → ${activeProject.end_date}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

export function MainDashboardAlerts() {
  const { activeProject, setActivePanel } = useAppStore()

  const { data: resources } = useQuery({
    queryKey: ['resources', 'mob', activeProject?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('resources')
        .select('mob_in')
        .eq('project_id', activeProject!.id)
      return data || []
    },
    enabled: !!activeProject?.id,
  })

  const { data: invoices } = useQuery({
    queryKey: ['invoices', 'list', activeProject?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('invoices')
        .select('amount,status')
        .eq('project_id', activeProject!.id)
      return data || []
    },
    enabled: !!activeProject?.id,
  })

  const incoming = (resources || []).filter(r => r.mob_in && r.mob_in > todayStr && r.mob_in <= next7).length
  const pendingTotal = (invoices || [])
    .filter(i => i.status === 'received' || i.status === 'checked')
    .reduce((s, i) => s + (i.amount || 0), 0)

  const fmt = (n: number) =>
    'A$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <>
      {incoming > 0 && (
        <AlertBanner
          icon="⚠"
          message={<><strong>{incoming} person{incoming > 1 ? 's' : ''}</strong> mobbing in the next 7 days</>}
          ctaLabel="View Resources →"
          onCta={() => setActivePanel('hr-resources')}
        />
      )}
      {pendingTotal > 0 && (
        <AlertBanner
          icon="🧾"
          message={<><strong>{fmt(pendingTotal)}</strong> in invoices pending approval</>}
          color="#f97316"
          ctaLabel="View Invoices →"
          onCta={() => setActivePanel('invoices')}
        />
      )}
    </>
  )
}
