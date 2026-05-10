/**
 * useLabourStats
 *
 * React Query hook that computes labour cost/sell/hours from weekly_timesheets
 * + rate_cards. Single query key per project — both Cost and HR tiles reuse it
 * with zero duplicate network requests.
 *
 * Uses the same simplified splitHours approximation as the existing dashboard
 * panels. The canonical engine (timesheetCostEngine) is the source of truth
 * for invoicing; this is a KPI rollup.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Simplified split — same approximation used by CostDashboardPanel + HRDashboardPanel
function splitHours(h: number, dayType: string, shift: string) {
  if (h <= 0) return { dnt: 0, dt15: 0, ddt: 0, nnt: 0, ndt: 0 }
  if (dayType === 'sunday' || dayType === 'public_holiday')
    return { dnt: 0, dt15: 0, ddt: h, nnt: 0, ndt: 0 }
  if (dayType === 'saturday')
    return { dnt: 0, dt15: Math.min(h, 2), ddt: Math.max(0, h - 2), nnt: 0, ndt: 0 }
  if (shift === 'night')
    return { dnt: 0, dt15: 0, ddt: 0, nnt: Math.min(h, 8), ndt: Math.max(0, h - 8) }
  return { dnt: Math.min(h, 7.6), dt15: Math.min(Math.max(0, h - 7.6), 2.4), ddt: Math.max(0, h - 10), nnt: 0, ndt: 0 }
}

export interface LabourStats {
  tradesHours: number
  tradesCost: number
  tradesSell: number
  tradesWeeks: number
  mgmtHours: number
  mgmtCost: number
  mgmtSell: number
  mgmtWeeks: number
  // Per-week data for S-curve
  byWeek: { week: string; tradesHrs: number; mgmtHrs: number; tradeSell: number; mgmtSell: number }[]
  // Allowance breakdown
  lahaCount: number
  mealCount: number
  fsaCount: number
  travelDays: number
}

type RcMap = Record<string, {
  rates: { cost: Record<string, number>; sell: Record<string, number> }
  laha_cost: number; laha_sell: number
  fsa_cost: number; fsa_sell: number
  meal_cost: number; meal_sell: number
}>

export function useLabourStats(projectId: string | undefined) {
  return useQuery<LabourStats>({
    queryKey: ['labour_stats', projectId],
    queryFn: async () => {
      const pid = projectId!
      const [tsResp, rcResp] = await Promise.all([
        supabase.from('weekly_timesheets').select('week_start,type,crew').eq('project_id', pid).order('week_start'),
        supabase.from('rate_cards').select('role,rates,laha_cost,laha_sell,fsa_cost,fsa_sell,meal_cost,meal_sell').eq('project_id', pid),
      ])

      const sheets = (tsResp.data || []) as {
        week_start: string
        type: string
        crew: {
          role?: string
          days?: Record<string, { hours?: number; dayType?: string; shiftType?: string; laha?: boolean; meal?: boolean }>
        }[]
      }[]

      const rcMap: RcMap = {}
      for (const rc of (rcResp.data || [])) {
        rcMap[(rc.role as string).toLowerCase()] = rc as unknown as RcMap[string]
      }

      let tradesHours = 0, tradesCost = 0, tradesSell = 0, tradesWeeks = 0
      let mgmtHours = 0, mgmtCost = 0, mgmtSell = 0, mgmtWeeks = 0
      let lahaCount = 0, mealCount = 0, fsaCount = 0, travelDays = 0

      const weekMap: Record<string, { tradesHrs: number; mgmtHrs: number; tradeSell: number; mgmtSell: number }> = {}

      for (const sheet of sheets) {
        const isTrades = sheet.type === 'trades' || sheet.type === 'subcon'
        const isMgmt = sheet.type === 'mgmt' || sheet.type === 'seag'
        if (isTrades) tradesWeeks++
        else if (isMgmt) mgmtWeeks++

        if (!weekMap[sheet.week_start])
          weekMap[sheet.week_start] = { tradesHrs: 0, mgmtHrs: 0, tradeSell: 0, mgmtSell: 0 }
        const wk = weekMap[sheet.week_start]

        for (const member of (sheet.crew || [])) {
          const rc = rcMap[(member.role || '').toLowerCase()]
          const cr = rc?.rates?.cost || {}
          const sr = rc?.rates?.sell || {}

          for (const [, d] of Object.entries(member.days || {})) {
            const h = d.hours || 0
            if (!h) continue
            const split = splitHours(h, d.dayType || 'weekday', d.shiftType || 'day')
            let cost = 0, sell = 0
            for (const [b, bh] of Object.entries(split)) {
              cost += bh * ((cr as Record<string, number>)[b] || 0)
              sell += bh * ((sr as Record<string, number>)[b] || 0)
            }
            if (d.laha) { cost += rc?.laha_cost || 0; sell += rc?.laha_sell || 0; lahaCount++ }
            if (d.meal) { cost += rc?.meal_cost || 0; sell += rc?.meal_sell || 0; mealCount++ }

            if (isTrades) {
              tradesHours += h; tradesCost += cost; tradesSell += sell
              wk.tradesHrs += h; wk.tradeSell += sell
            } else {
              mgmtHours += h; mgmtCost += cost; mgmtSell += sell
              wk.mgmtHrs += h; wk.mgmtSell += sell
            }
          }

          // FSA for mgmt/seag
          if (!isTrades && rc?.fsa_sell) {
            const workedDays = Object.values(member.days || {}).filter(d => (d.hours || 0) > 0).length
            mgmtSell += workedDays * (rc.fsa_sell || 0)
            mgmtCost += workedDays * (rc.fsa_cost || 0)
            fsaCount += workedDays
          }
        }
      }

      const byWeek = Object.entries(weekMap).sort().map(([week, v]) => ({ week, ...v }))

      return {
        tradesHours, tradesCost, tradesSell, tradesWeeks,
        mgmtHours, mgmtCost, mgmtSell, mgmtWeeks,
        byWeek, lahaCount, mealCount, fsaCount, travelDays,
      }
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}
