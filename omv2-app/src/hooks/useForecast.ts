/**
 * useForecast
 *
 * React Query hook that fetches all forecast inputs and runs buildForecast.
 * staleTime is 5 minutes — the forecast is expensive to compute but
 * doesn't change without a user action (resource/hire/rate card edit).
 *
 * Tiles and panels can both call this; React Query deduplicates the fetch.
 */

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/appStore'
import { supabase } from '../lib/supabase'
import { buildForecast, weekKey, weekLabel, bucketTotalBase } from '../engines/forecastEngine'
import type { ForecastData } from '../engines/forecastEngine'
import type {
  Resource, RateCard, BackOfficeHour, HireItem, Car,
  Accommodation, ToolingCosting, Expense, GlobalTV, GlobalDepartment, Flight,
} from '../types'

export interface ForecastWeekSummary {
  key: string
  label: string
  cost: number
  sell: number
  hours: number
  headcount: number
  gm: number
}

export function useForecast(projectId: string | undefined) {
  const { activeProject } = useAppStore()

  return useQuery<ForecastData>({
    queryKey: ['forecast', projectId],
    queryFn: async () => {
      const pid = projectId!
      const [resData, rcData, boData, hireData, carData, acData, tcData, expData, tvsData, deptsData, flData] =
        await Promise.all([
          supabase.from('resources').select('*').eq('project_id', pid),
          supabase.from('rate_cards').select('*').eq('project_id', pid),
          supabase.from('back_office_hours').select('*').eq('project_id', pid),
          supabase.from('hire_items').select('*').eq('project_id', pid),
          supabase.from('cars').select('*').eq('project_id', pid),
          supabase.from('accommodation').select('*').eq('project_id', pid),
          supabase.from('tooling_costings').select('*').eq('project_id', pid),
          supabase.from('expenses').select('*').eq('project_id', pid),
          supabase.from('global_tvs').select('*'),
          supabase.from('global_departments').select('*'),
          supabase.from('flights').select('*').eq('project_id', pid),
        ])

      const proj = activeProject!
      const stdHours = (proj.std_hours as { day: Record<string, number>; night: Record<string, number> }) || { day: {}, night: {} }
      const publicHolidays = (proj.public_holidays as { date: string }[]) || []
      const fxRates = (proj.currency_rates as { code: string; rate: number }[] | undefined) || []

      return buildForecast(
        (resData.data || []) as Resource[],
        (rcData.data || []) as RateCard[],
        (boData.data || []) as BackOfficeHour[],
        (hireData.data || []) as HireItem[],
        (carData.data || []) as Car[],
        (acData.data || []) as Accommodation[],
        (tcData.data || []) as ToolingCosting[],
        stdHours,
        publicHolidays,
        proj.start_date,
        proj.end_date,
        fxRates,
        (expData.data || []) as Expense[],
        0,
        (tvsData.data || []) as GlobalTV[],
        (deptsData.data || []) as GlobalDepartment[],
        [],                                          // purchaseOrders — unused by dashboard tile
        [],                                          // invoices — unused by dashboard tile
        (flData.data || []) as Flight[],
      )
    },
    enabled: !!projectId && !!activeProject,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
}

/**
 * Derive the next N weeks of summary data from a ForecastData object.
 * Starts from today and walks forward, returning only weeks that have cost.
 */
export function getUpcomingWeeks(data: ForecastData, eurRate: number, n = 5): ForecastWeekSummary[] {
  const todayStr = new Date().toISOString().slice(0, 10)
  const weekMap: Record<string, ForecastWeekSummary> = {}

  for (const d of data.days) {
    if (d < todayStr) continue
    const key = weekKey(d)
    if (!weekMap[key]) {
      weekMap[key] = { key, label: weekLabel(key), cost: 0, sell: 0, hours: 0, headcount: 0, gm: 0 }
    }
    const b = data.byDay[d]
    if (!b) continue
    const { cost, sell } = bucketTotalBase(b, eurRate)
    weekMap[key].cost += cost
    weekMap[key].sell += sell
    weekMap[key].hours += b.trades.hours + b.mgmt.hours + b.seag.hours
    const hc = b.trades.headcount + b.mgmt.headcount + b.seag.headcount
    if (hc > weekMap[key].headcount) weekMap[key].headcount = hc
  }

  const weeks = Object.values(weekMap)
    .filter(w => w.cost > 0 || w.sell > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, n)

  for (const w of weeks) {
    w.gm = w.sell > 0.5 ? (w.sell - w.cost) / w.sell * 100 : 0
  }

  return weeks
}
