/**
 * HSE Dashboard tiles
 * Existing tiles: induction-progress, total-hse-hours, toolbox-talks,
 *   safety-observations, incidents, co2-entries, people-inducted
 * New tiles: days-since-incident, inductions-overdue, hse-compliance
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../../lib/supabase'
import { useAppStore } from '../../../../store/appStore'
import { KpiCard, ProgressBarCard, TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const COLOR = '#059669'
const todayStr = new Date().toISOString().slice(0, 10)

// ── Shared data hook ──────────────────────────────────────────────────────────
// HSE tiles share two queries — React Query deduplicates them.

function useResources(projectId: string | undefined) {
  return useQuery({
    queryKey: ['resources', 'mob', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('resources').select('id,mob_in,mob_out').eq('project_id', projectId!)
      return data || []
    },
    enabled: !!projectId,
  })
}

function useHseHours(projectId: string | undefined) {
  return useQuery({
    queryKey: ['hse_hours', 'list', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('hse_hours').select('category,hours').eq('project_id', projectId!)
      return data || []
    },
    enabled: !!projectId,
  })
}

// ── Induction Progress ─────────────────────────────────────────────────────────
function InductionProgressComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const { data: res, isLoading } = useResources(ctx.projectId)
  if (isLoading) return <TileLoading />

  const inducted = (activeProject?.induction_data as unknown[] | null)?.length || 0
  const onsite = (res || []).filter(r => r.mob_in && r.mob_in <= todayStr && (!r.mob_out || r.mob_out >= todayStr)).length
  const pct = Math.max(inducted, onsite) > 0
    ? Math.round(inducted / Math.max(inducted, onsite) * 100)
    : 0

  return (
    <ProgressBarCard
      icon="✅"
      label="Induction Status"
      pct={pct}
      valueText={`${inducted} inducted · ${onsite} on-site`}
      onClick={() => ctx.setActivePanel('hr-inductions')}
    />
  )
}
export const InductionProgressTile: TileComponent = {
  def: {
    id: 'induction-progress', icon: '✅', title: 'Induction Progress',
    description: 'Inducted vs on-site headcount with percentage bar',
    category: 'Safety', defaultSize: 'lg', defaultVisible: true,
  },
  Component: InductionProgressComp,
}

// ── Total HSE Hours ────────────────────────────────────────────────────────────
function HseHoursComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error } = useHseHours(ctx.projectId)
  if (isLoading) return <TileLoading />
  if (error) return <TileError />
  const total = (data || []).reduce((s, h) => s + (h.hours || 0), 0)
  return (
    <KpiCard icon="⏱" label="Total HSE Hours" value={total.toFixed(1) + 'h'}
      color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('hse-hours')} />
  )
}
export const HseHoursTile: TileComponent = {
  def: {
    id: 'total-hse-hours', icon: '⏱', title: 'Total HSE Hours',
    description: 'Sum of all logged HSE hours',
    category: 'Activity', defaultSize: 'md', defaultVisible: true,
  },
  Component: HseHoursComp,
}

// ── Toolbox Talks ─────────────────────────────────────────────────────────────
function ToolboxTalksComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHseHours(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(h => h.category === 'Toolbox Talk').length
  return (
    <KpiCard icon="📋" label="Toolbox Talks" value={count}
      color="#0284c7" accent="#0284c7" onClick={() => ctx.setActivePanel('hse-hours')} />
  )
}
export const ToolboxTalksTile: TileComponent = {
  def: {
    id: 'toolbox-talks', icon: '📋', title: 'Toolbox Talks',
    description: 'Number of toolbox talk entries logged',
    category: 'Activity', defaultSize: 'md', defaultVisible: true,
  },
  Component: ToolboxTalksComp,
}

// ── Safety Observations ───────────────────────────────────────────────────────
function SafetyObsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHseHours(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(h => h.category === 'Safety Observation').length
  return (
    <KpiCard icon="👁" label="Safety Observations" value={count}
      color="#7c3aed" accent="#7c3aed" onClick={() => ctx.setActivePanel('hse-hours')} />
  )
}
export const SafetyObservationsTile: TileComponent = {
  def: {
    id: 'safety-observations', icon: '👁', title: 'Safety Observations',
    description: 'Count of safety observation entries',
    category: 'Activity', defaultSize: 'md', defaultVisible: true,
  },
  Component: SafetyObsComp,
}

// ── Incidents ──────────────────────────────────────────────────────────────────
function IncidentsComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useHseHours(ctx.projectId)
  if (isLoading) return <TileLoading />
  const count = (data || []).filter(h => h.category === 'Incident Investigation').length
  return (
    <KpiCard icon="⚠" label="Incident Investigations" value={count}
      color={count > 0 ? 'var(--red)' : 'var(--text3)'}
      accent={count > 0 ? 'var(--red)' : 'var(--border)'}
      onClick={() => ctx.setActivePanel('hse-hours')} />
  )
}
export const IncidentsTile: TileComponent = {
  def: {
    id: 'incidents', icon: '⚠', title: 'Incident Investigations',
    description: 'Count of recorded incident investigations',
    category: 'Activity', defaultSize: 'md', defaultVisible: true,
  },
  Component: IncidentsComp,
}

// ── CO₂ Entries ────────────────────────────────────────────────────────────────
function Co2Comp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const count = ((activeProject?.co2_config as { entries?: unknown[] } | null)?.entries || []).length
  return (
    <KpiCard icon="🌿" label="CO₂ Emission Entries" value={count}
      color={COLOR} accent={COLOR} onClick={() => ctx.setActivePanel('hse-co2')} />
  )
}
export const Co2EntriesTile: TileComponent = {
  def: {
    id: 'co2-entries', icon: '🌿', title: 'CO₂ Entries',
    description: 'Number of emission entries logged in CO₂ tracking',
    category: 'Environmental', defaultSize: 'md', defaultVisible: true,
  },
  Component: Co2Comp,
}

// ── People Inducted ────────────────────────────────────────────────────────────
function PeopleInductedComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const count = (activeProject?.induction_data as unknown[] | null)?.length || 0
  return (
    <KpiCard icon="🪪" label="People Inducted" value={count}
      color="#64748b" accent="#64748b" onClick={() => ctx.setActivePanel('hr-inductions')} />
  )
}
export const PeopleInductedTile: TileComponent = {
  def: {
    id: 'people-inducted', icon: '🪪', title: 'People Inducted',
    description: 'Total headcount in the site induction register',
    category: 'Safety', defaultSize: 'md', defaultVisible: true,
  },
  Component: PeopleInductedComp,
}

// ── Days Since Incident (NEW) ──────────────────────────────────────────────────
function DaysSinceIncidentComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const lastIncident = (activeProject as unknown as { last_incident_date?: string | null })?.last_incident_date

  if (!lastIncident) {
    return <TileEmpty icon="🏆" label="No incident date recorded" ctaLabel="Update in Settings" onCta={() => ctx.setActivePanel('project-settings')} />
  }

  const days = Math.floor(
    (new Date(todayStr).getTime() - new Date(lastIncident + 'T00:00:00').getTime()) / 86400000
  )
  const color = days >= 30 ? 'var(--green)' : days >= 7 ? 'var(--amber)' : 'var(--red)'

  return (
    <KpiCard icon="🏆" label="Days Since Last Incident" value={days}
      sub={`Last: ${lastIncident}`} color={color} accent={color} />
  )
}
export const DaysSinceIncidentTile: TileComponent = {
  def: {
    id: 'days-since-incident', icon: '🏆', title: 'Days Since Incident',
    description: 'Days elapsed since last recorded incident',
    category: 'Safety', defaultSize: 'md', defaultVisible: true,
  },
  Component: DaysSinceIncidentComp,
}

// ── Inductions Overdue (NEW) ───────────────────────────────────────────────────
// Re-induction is due if original induction was > 365 days ago.
// Uses induction_data[].date field if present.
function InductionsOverdueComp({ ctx }: { ctx: DashboardContext }) {
  const { activeProject } = useAppStore()
  const inductions = (activeProject?.induction_data as { date?: string }[] | null) || []
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const overdue = inductions.filter(p => p.date && p.date < cutoff).length

  return (
    <KpiCard icon="🔄" label="Re-inductions Overdue"
      value={overdue}
      sub={overdue > 0 ? 'Inducted > 365 days ago' : 'All inductions current'}
      color={overdue > 0 ? 'var(--red)' : 'var(--green)'}
      accent={overdue > 0 ? 'var(--red)' : 'var(--green)'}
      onClick={() => ctx.setActivePanel('hr-inductions')} />
  )
}
export const InductionsOverdueTile: TileComponent = {
  def: {
    id: 'inductions-overdue', icon: '🔄', title: 'Re-inductions Overdue',
    description: 'People inducted more than 365 days ago who need renewal',
    category: 'Safety', defaultSize: 'md', defaultVisible: true,
  },
  Component: InductionsOverdueComp,
}

// ── HSE Compliance (NEW) ───────────────────────────────────────────────────────
// Toolbox talks per week as a % of target (1 per FTE per week).
function HseComplianceComp({ ctx }: { ctx: DashboardContext }) {
  const { data: hse, isLoading: l1 } = useHseHours(ctx.projectId)
  const { data: res, isLoading: l2 } = useResources(ctx.projectId)

  if (l1 || l2) return <TileLoading />

  const talks = (hse || []).filter(h => h.category === 'Toolbox Talk').length
  const onsite = (res || []).filter(r => r.mob_in && r.mob_in <= todayStr && (!r.mob_out || r.mob_out >= todayStr)).length

  if (onsite === 0) {
    return <TileEmpty icon="📊" label="No resources on site" />
  }

  // Rough: 1 toolbox talk per person on-site per week (target = onsite)
  const pct = Math.min(100, Math.round((talks / Math.max(onsite, 1)) * 100))

  return (
    <ProgressBarCard
      icon="📊"
      label="Toolbox Talks / Headcount"
      pct={pct}
      valueText={`${talks} talks · ${onsite} on-site`}
      onClick={() => ctx.setActivePanel('hse-hours')}
    />
  )
}
export const HseComplianceTile: TileComponent = {
  def: {
    id: 'hse-compliance', icon: '📊', title: 'HSE Compliance',
    description: 'Toolbox talks vs on-site headcount ratio',
    category: 'Activity', defaultSize: 'md', defaultVisible: false,
  },
  Component: HseComplianceComp,
}
