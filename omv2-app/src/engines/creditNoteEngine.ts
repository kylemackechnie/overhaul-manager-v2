/**
 * creditNoteEngine.ts
 *
 * Applies credit notes against the database for all three credit types:
 *   'reallocate'       — moves hours from one scope to another
 *   'credit_only'      — reduces sell_labour on cost lines (client-facing only)
 *   'adjust_timesheet' — reduces hours in the timesheet AND cost lines
 *
 * Single source of truth: timesheet_cost_lines.
 * Invoicing reads from there, so mutations here flow automatically into invoicing.
 */

import { supabase } from '../lib/supabase'
import { writeTimesheetCostLines } from './timesheetCostEngine'
import type { RateCard, WeeklyTimesheet, Project } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

/** A frozen snapshot of one allocation row at credit-issue time */
export interface SourceLine {
  tsId: string
  weekStart: string
  personId: string       // resource ID
  personName: string
  empNo: string
  role: string
  date: string
  dayType: string
  payCode: string
  scopeKey: string       // tceItemId or wo
  scopeType: 'tce' | 'wo'
  contract: string
  woTask: string
  description: string
  hours: number
}

/** For 'reallocate': one target scope per source line */
export interface ReallocationTarget {
  /** Matches SourceLine by index */
  sourceLineIndex: number
  targets: {
    tceItemId: string | null
    wo: string
    hours: number
    description: string
  }[]
}

export interface CreditNotePayload {
  projectId: string
  creditType: 'reallocate' | 'credit_only' | 'adjust_timesheet'
  reference: string
  reason: string
  sourceLines: SourceLine[]
  createdBy?: string
  /** 'reallocate' only */
  reallocationTargets?: ReallocationTarget[]
  /** 'credit_only' | 'adjust_timesheet': hours to credit per line index */
  creditHoursPerLine?: Record<number, number>
}

export interface CreditNoteResult {
  success: boolean
  creditNoteId?: string
  error?: string
  warnings?: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchTimesheetFull(tsId: string): Promise<WeeklyTimesheet | null> {
  const { data } = await supabase.from('weekly_timesheets').select('*').eq('id', tsId).single()
  return data as WeeklyTimesheet | null
}

async function fetchRateCards(projectId: string): Promise<RateCard[]> {
  const { data } = await supabase.from('rate_cards').select('*').eq('project_id', projectId)
  return (data || []) as RateCard[]
}

async function fetchTceLines(projectId: string) {
  const { data } = await supabase.from('nrg_tce_lines')
    .select('id,item_id,work_order,contract_scope,source,line_type,tce_total')
    .eq('project_id', projectId)
  return data || []
}

async function fetchResources(projectId: string) {
  const { data } = await supabase.from('resources').select('id,wbs').eq('project_id', projectId)
  return (data || []) as { id: string; wbs?: string | null }[]
}

async function fetchProject(projectId: string): Promise<Project | null> {
  const { data } = await supabase.from('projects').select('*').eq('id', projectId).single()
  return data as Project | null
}

async function getNextReference(projectId: string): Promise<string> {
  const { data } = await supabase
    .from('nrg_credit_notes')
    .select('reference')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(20)
  const existing = (data || []).map(r => r.reference as string)
  const nums = existing
    .map(r => { const m = r.match(/CN-(\d+)/i); return m ? parseInt(m[1]) : 0 })
    .filter(n => n > 0)
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `CN-${String(next).padStart(3, '0')}`
}

export { getNextReference }

// ─── Main apply function ──────────────────────────────────────────────────────

export async function applyCreditNote(payload: CreditNotePayload): Promise<CreditNoteResult> {
  const warnings: string[] = []
  const affectedTimesheetIds = new Set<string>()

  try {
    const [rateCards, tceLines, resources, project] = await Promise.all([
      fetchRateCards(payload.projectId),
      fetchTceLines(payload.projectId),
      fetchResources(payload.projectId),
      fetchProject(payload.projectId),
    ])

    if (payload.creditType === 'reallocate') {
      await applyReallocate(payload, tceLines, rateCards, resources, project, affectedTimesheetIds, warnings)
    } else if (payload.creditType === 'credit_only') {
      await applyCreditOnly(payload, warnings, affectedTimesheetIds)
    } else if (payload.creditType === 'adjust_timesheet') {
      await applyAdjustTimesheet(payload, tceLines, rateCards, resources, project, affectedTimesheetIds, warnings)
    }

    // Write the credit note record
    const { data: cnData, error: cnErr } = await supabase.from('nrg_credit_notes').insert({
      project_id:             payload.projectId,
      created_by:             payload.createdBy || null,
      credit_type:            payload.creditType,
      status:                 'applied',
      reference:              payload.reference,
      reason:                 payload.reason || null,
      source_lines:           payload.sourceLines,
      reallocation_targets:   payload.reallocationTargets || null,
      credit_hours_per_line:  payload.creditHoursPerLine || null,
      affected_timesheet_ids: Array.from(affectedTimesheetIds),
    }).select('id').single()

    if (cnErr) throw new Error(`Credit note record failed: ${cnErr.message}`)

    return { success: true, creditNoteId: cnData.id, warnings }
  } catch (err) {
    return { success: false, error: (err as Error).message, warnings }
  }
}

// ─── Reallocate ───────────────────────────────────────────────────────────────

async function applyReallocate(
  payload: CreditNotePayload,
  tceLines: Record<string, unknown>[],
  rateCards: RateCard[],
  resources: { id: string; wbs?: string | null }[],
  project: Project | null,
  affectedTimesheetIds: Set<string>,
  warnings: string[],
) {
  if (!payload.reallocationTargets) throw new Error('Reallocation targets missing')

  for (const src of payload.sourceLines) {
    const targetEntry = payload.reallocationTargets.find(
      t => t.sourceLineIndex === payload.sourceLines.indexOf(src)
    )
    if (!targetEntry) continue

    // 1. Update the timesheet crew nrgWoAllocations for this person/date/scope
    const ts = await fetchTimesheetFull(src.tsId)
    if (!ts) { warnings.push(`Timesheet ${src.tsId} not found — skipped`); continue }

    const updatedCrew = (ts.crew as unknown as Record<string, unknown>[]).map((cm) => {
      if (cm.personId !== src.personId) return cm
      const days = { ...(cm.days as Record<string, unknown>) }
      const day  = { ...(days[src.date] as Record<string, unknown> | undefined || {}) }
      const allocs = [...((day.nrgWoAllocations as Record<string, unknown>[]) || [])]

      // Remove the source allocation
      const srcIdx = allocs.findIndex(a => {
        const matchesTce = src.scopeType === 'tce' && a.tceItemId === src.scopeKey
        const matchesWo  = src.scopeType === 'wo'  && a.wo === src.scopeKey
        return (matchesTce || matchesWo) && Math.abs((a.hours as number) - src.hours) < 0.01
      })
      if (srcIdx === -1) {
        warnings.push(`Could not find matching allocation for ${src.personName} ${src.date} ${src.scopeKey} — timesheet may have been edited`)
      } else {
        allocs.splice(srcIdx, 1)
      }

      // Add replacement allocations
      for (const t of targetEntry.targets) {
        allocs.push({
          wo: t.wo || '',
          tceItemId: t.tceItemId || null,
          _tceMode: true,
          hours: t.hours,
          label: t.description,
          payCode: src.payCode,
        })
      }

      days[src.date] = { ...day, nrgWoAllocations: allocs }
      return { ...cm, days }
    })

    const { error: tsErr } = await supabase
      .from('weekly_timesheets')
      .update({ crew: updatedCrew })
      .eq('id', src.tsId)
    if (tsErr) throw new Error(`Timesheet update failed: ${tsErr.message}`)

    // 2. Rewrite cost lines for this timesheet
    const updatedTs = { ...ts, crew: updatedCrew } as unknown as WeeklyTimesheet
    const { error: clErr } = await writeTimesheetCostLines(updatedTs, payload.projectId, rateCards, tceLines as unknown as Parameters<typeof writeTimesheetCostLines>[3], resources, project)
    if (clErr) warnings.push(`Cost lines rewrite warning: ${clErr}`)

    affectedTimesheetIds.add(src.tsId)

    if (ts.status === 'approved') {
      warnings.push(`${src.personName} ${src.date}: timesheet was approved — cost lines recalculated but timesheet status unchanged`)
    }
  }
}

// ─── Credit Only ──────────────────────────────────────────────────────────────

async function applyCreditOnly(
  payload: CreditNotePayload,
  warnings: string[],
  affectedTimesheetIds: Set<string>,
) {
  if (!payload.creditHoursPerLine) throw new Error('Credit hours per line missing')

  // creditHoursPerLine keys may be strings or numbers depending on JSON serialisation
  const hoursForLine = (i: number): number => {
    const byNum = (payload.creditHoursPerLine as Record<string | number, number>)[i]
    const byStr = (payload.creditHoursPerLine as Record<string | number, number>)[String(i)]
    const v = byNum ?? byStr
    return v !== undefined ? Number(v) : payload.sourceLines[i].hours
  }

  for (let i = 0; i < payload.sourceLines.length; i++) {
    const src         = payload.sourceLines[i]
    const creditHours = hoursForLine(i)

    if (creditHours <= 0) continue

    // Find matching cost lines
    let clQuery = supabase
      .from('timesheet_cost_lines')
      .select('id,tce_item_id,work_order,allocated_hours,sell_labour,cost_labour,sell_allowances,cost_allowances')
      .eq('timesheet_id', src.tsId)
      .eq('work_date', src.date)
      .eq('person_id', src.personId)

    if (src.scopeType === 'tce') clQuery = clQuery.eq('tce_item_id', src.scopeKey)
    else clQuery = clQuery.eq('work_order', src.scopeKey)

    const { data: cls, error: clFetchErr } = await clQuery

    if (clFetchErr) { warnings.push(`Could not fetch cost lines for ${src.personName} ${src.date}: ${clFetchErr.message}`); continue }

    const matchedLines = cls || []

    if (matchedLines.length === 0) {
      warnings.push(`No cost lines found for ${src.personName} ${src.date} ${src.scopeKey} — may already be credited`)
      continue
    }

    // Total allocated hours across all matched cost lines for this scope
    const totalAllocHours = matchedLines.reduce((s, cl) => s + (Number(cl.allocated_hours) || 0), 0)
    if (totalAllocHours <= 0) { warnings.push(`Zero allocated hours on cost lines for ${src.personName} ${src.date}`); continue }

    // Direct subtraction from SOURCE hours (the timesheet alloc), not cost line hours.
    // Cost line hours may differ from source alloc hours due to engine rounding/splitting.
    // Intent: source=1.5h, credit=0.5h → new effective hours = 1.0h
    const sourceHours = src.hours
    const remainingSourceHours = Math.max(0, sourceHours - creditHours)

    for (const cl of matchedLines) {
      const clHours = Number(cl.allocated_hours) || 0
      // Set new hours proportionally: this cost line's share of remaining source hours
      const clShareOfSource = totalAllocHours > 0 ? clHours / totalAllocHours : 1
      const newAllocHours     = parseFloat((remainingSourceHours * clShareOfSource).toFixed(4))
      const sellRatio         = clHours > 0 ? newAllocHours / clHours : 0
      const newSellLabour     = parseFloat((Number(cl.sell_labour)     * sellRatio).toFixed(4))
      const newSellAllowances = parseFloat((Number(cl.sell_allowances) * sellRatio).toFixed(4))

      const { data: updData, error: updErr } = await supabase
        .from('timesheet_cost_lines')
        .update({
          allocated_hours: newAllocHours,
          sell_labour:     newSellLabour,
          sell_allowances: newSellAllowances,
        })
        .eq('id', cl.id)
        .select('id')

      if (updErr) throw new Error(`Cost line update failed: ${updErr.message}`)
      if (!updData || updData.length === 0) {
        warnings.push(`Cost line ${cl.id} not updated — RLS may have blocked it or row not found`)
      }
    }

    affectedTimesheetIds.add(src.tsId)
  }
}

// ─── Adjust Timesheet ─────────────────────────────────────────────────────────

async function applyAdjustTimesheet(
  payload: CreditNotePayload,
  tceLines: Record<string, unknown>[],
  rateCards: RateCard[],
  resources: { id: string; wbs?: string | null }[],
  project: Project | null,
  affectedTimesheetIds: Set<string>,
  warnings: string[],
) {
  if (!payload.creditHoursPerLine) throw new Error('Credit hours per line missing')

  const hoursForLine = (i: number): number => {
    const byNum = (payload.creditHoursPerLine as Record<string | number, number>)[i]
    const byStr = (payload.creditHoursPerLine as Record<string | number, number>)[String(i)]
    const v = byNum ?? byStr
    return v !== undefined ? Number(v) : payload.sourceLines[i].hours
  }

  // Group source lines by timesheet so we batch all changes per ts
  const byTs: Record<string, { src: SourceLine; creditHours: number }[]> = {}
  for (let i = 0; i < payload.sourceLines.length; i++) {
    const src         = payload.sourceLines[i]
    const creditHours = hoursForLine(i)
    if (creditHours <= 0) continue
    if (!byTs[src.tsId]) byTs[src.tsId] = []
    byTs[src.tsId].push({ src, creditHours })
  }

  for (const [tsId, entries] of Object.entries(byTs)) {
    const ts = await fetchTimesheetFull(tsId)
    if (!ts) { warnings.push(`Timesheet ${tsId} not found — skipped`); continue }

    let updatedCrew = (ts.crew as unknown as Record<string, unknown>[]).map(cm => cm)

    for (const { src, creditHours } of entries) {
      updatedCrew = updatedCrew.map((cm) => {
        if (cm.personId !== src.personId) return cm
        const days = { ...(cm.days as Record<string, unknown>) }
        const day  = { ...(days[src.date] as Record<string, unknown> | undefined || {}) }
        const allocs = [...((day.nrgWoAllocations as Record<string, unknown>[]) || [])]
        const currentDayHours = Number(day.hours) || 0

        // Find and reduce or remove the source allocation
        const srcIdx = allocs.findIndex(a => {
          const matchesTce = src.scopeType === 'tce' && a.tceItemId === src.scopeKey
          const matchesWo  = src.scopeType === 'wo'  && a.wo === src.scopeKey
          return (matchesTce || matchesWo) && Math.abs((a.hours as number) - src.hours) < 0.01
        })

        if (srcIdx === -1) {
          warnings.push(`Could not find allocation for ${src.personName} ${src.date} ${src.scopeKey}`)
        } else {
          const allocHours = Number(allocs[srcIdx].hours)
          const newAllocHours = parseFloat((allocHours - creditHours).toFixed(4))
          if (newAllocHours <= 0.001) {
            allocs.splice(srcIdx, 1)
          } else {
            allocs[srcIdx] = { ...allocs[srcIdx], hours: newAllocHours }
          }
        }

        // Reduce day.hours by the credited amount
        const newDayHours = Math.max(0, parseFloat((currentDayHours - creditHours).toFixed(4)))
        days[src.date] = { ...day, hours: newDayHours, nrgWoAllocations: allocs }
        return { ...cm, days }
      })
    }

    const { error: tsErr } = await supabase
      .from('weekly_timesheets')
      .update({ crew: updatedCrew })
      .eq('id', tsId)
    if (tsErr) throw new Error(`Timesheet update failed: ${tsErr.message}`)

    // Rewrite cost lines (recalculates both cost and sell)
    const updatedTs = { ...ts, crew: updatedCrew } as unknown as WeeklyTimesheet
    const { error: clErr } = await writeTimesheetCostLines(updatedTs, payload.projectId, rateCards, tceLines as unknown as Parameters<typeof writeTimesheetCostLines>[3], resources, project)
    if (clErr) warnings.push(`Cost lines rewrite warning: ${clErr}`)

    affectedTimesheetIds.add(tsId)

    if (ts.status === 'approved') {
      warnings.push(`Timesheet ${ts.week_start} was approved. Hours adjusted but status not changed — review and re-approve if required.`)
    }
  }
}

// ─── Reversal ─────────────────────────────────────────────────────────────────

export interface CreditNoteReversal {
  success: boolean
  error?: string
  warnings?: string[]
}

/**
 * reverseCreditNote — undoes the effects of an applied credit note, then deletes the record.
 *
 * credit_only:       adds credited hours back to cost lines (sell_labour, allocated_hours)
 * adjust_timesheet:  restores hours in timesheet crew JSON, then rewrites cost lines
 * reallocate:        re-runs writeTimesheetCostLines from the original timesheet state
 *                    (the reallocate already modified the timesheet JSON, so reverting
 *                    requires restoring the original nrgWoAllocations — we do this by
 *                    swapping target allocs back to source allocs using the snapshot)
 */
export async function reverseCreditNote(creditNoteId: string, projectId: string): Promise<CreditNoteReversal> {
  const warnings: string[] = []

  // Load the credit note record
  const { data: cn, error: cnErr } = await supabase
    .from('nrg_credit_notes')
    .select('*')
    .eq('id', creditNoteId)
    .single()

  if (cnErr || !cn) return { success: false, error: 'Credit note not found' }

  const sourceLines: SourceLine[] = cn.source_lines || []
  const creditHoursPerLine: Record<string, number> = cn.credit_hours_per_line || {}
  const creditType: string = cn.credit_type

  const hoursForLine = (i: number): number => {
    const v = creditHoursPerLine[i] ?? creditHoursPerLine[String(i)]
    return v !== undefined ? Number(v) : sourceLines[i]?.hours || 0
  }

  try {
    if (creditType === 'credit_only') {
      // Add credited hours back to cost lines
      for (let i = 0; i < sourceLines.length; i++) {
        const src         = sourceLines[i]
        const creditHours = hoursForLine(i)
        if (creditHours <= 0) continue

        let clQuery = supabase
          .from('timesheet_cost_lines')
          .select('id,tce_item_id,work_order,allocated_hours,sell_labour,sell_allowances')
          .eq('timesheet_id', src.tsId)
          .eq('work_date', src.date)
          .eq('person_id', src.personId)

        if (src.scopeType === 'tce') clQuery = clQuery.eq('tce_item_id', src.scopeKey)
        else clQuery = clQuery.eq('work_order', src.scopeKey)

        const { data: cls } = await clQuery
        if (!cls || cls.length === 0) {
          warnings.push(`No cost lines found for ${src.personName} ${src.date} — skipped`)
          continue
        }

        for (const cl of cls) {
          const clHours = Number(cl.allocated_hours) || 0
          // Reverse: restore by adding back the credit. Use source hours to derive original.
          const remainingSource = src.hours - creditHours   // what it was set to
          const originalSource  = src.hours                  // what it should return to
          const clShareOfSource = 1 / cls.length            // equal share if multiple
          const newAllocHours   = parseFloat((originalSource * clShareOfSource).toFixed(4))
          // Sell ratio: restore sell proportional to hour increase
          const sellRatio       = clHours > 0 ? newAllocHours / clHours : 1
          const newSellLabour   = parseFloat((Number(cl.sell_labour)     * sellRatio).toFixed(4))
          const newSellAllowances = parseFloat((Number(cl.sell_allowances) * sellRatio).toFixed(4))

          const { data: upd, error: updErr } = await supabase
            .from('timesheet_cost_lines')
            .update({ allocated_hours: newAllocHours, sell_labour: newSellLabour, sell_allowances: newSellAllowances })
            .eq('id', cl.id)
            .select('id')
          if (updErr) throw new Error(`Reversal update failed: ${updErr.message}`)
          if (!upd || upd.length === 0) warnings.push(`Cost line ${cl.id} not updated during reversal`)
        }
      }
    } else if (creditType === 'adjust_timesheet' || creditType === 'reallocate') {
      // For adjust and reallocate, re-run writeTimesheetCostLines after restoring the timesheet JSON
      const [rateCards, tceLines, resources, project] = await Promise.all([
        fetchRateCards(projectId),
        fetchTceLines(projectId),
        fetchResources(projectId),
        fetchProject(projectId),
      ])

      const tsIds = [...new Set(sourceLines.map(l => l.tsId))]
      for (const tsId of tsIds) {
        const ts = await fetchTimesheetFull(tsId)
        if (!ts) { warnings.push(`Timesheet ${tsId} not found`); continue }

        if (creditType === 'adjust_timesheet') {
          // Restore hours in crew JSON by adding back credited hours
          const linesForTs = sourceLines.map((s, i) => ({ src: s, creditHours: hoursForLine(i) }))
            .filter(({ src }) => src.tsId === tsId)

          let restoredCrew = (ts.crew as unknown as Record<string, unknown>[]).map(cm => cm)
          for (const { src, creditHours } of linesForTs) {
            restoredCrew = restoredCrew.map(cm => {
              if (cm.personId !== src.personId) return cm
              const days = { ...(cm.days as Record<string, unknown>) }
              const day  = { ...(days[src.date] as Record<string, unknown> | undefined || {}) }
              const allocs = [...((day.nrgWoAllocations as Record<string, unknown>[]) || [])]
              const currentDayHours = Number(day.hours) || 0

              // Find the (possibly-reduced) alloc and restore it
              const idx = allocs.findIndex(a => {
                const matchesTce = src.scopeType === 'tce' && a.tceItemId === src.scopeKey
                const matchesWo  = src.scopeType === 'wo'  && a.wo === src.scopeKey
                return matchesTce || matchesWo
              })
              if (idx === -1) {
                // Alloc was fully removed — add it back
                allocs.push({ wo: src.woTask || '', tceItemId: src.scopeType === 'tce' ? src.scopeKey : null, _tceMode: true, hours: src.hours, label: src.description, payCode: src.payCode })
              } else {
                // Alloc was reduced — restore to original hours
                allocs[idx] = { ...allocs[idx], hours: src.hours }
              }
              const newDayHours = parseFloat((currentDayHours + creditHours).toFixed(4))
              days[src.date] = { ...day, hours: newDayHours, nrgWoAllocations: allocs }
              return { ...cm, days }
            })
          }

          await supabase.from('weekly_timesheets').update({ crew: restoredCrew }).eq('id', tsId)
          const updatedTs = { ...ts, crew: restoredCrew } as unknown as WeeklyTimesheet
          const { error: clErr } = await writeTimesheetCostLines(updatedTs, projectId, rateCards, tceLines as unknown as Parameters<typeof writeTimesheetCostLines>[3], resources, project)
          if (clErr) warnings.push(`Cost lines reversal warning: ${clErr}`)

        } else if (creditType === 'reallocate') {
          // For reallocate: the timesheet JSON was already modified (targets written in).
          // Reverse by finding the target allocs and replacing them back with the source allocs.
          const reallocationTargets = cn.reallocation_targets || []
          const linesForTs = sourceLines.map((s, i) => ({ src: s, targets: reallocationTargets.find((rt: {sourceLineIndex: number}) => rt.sourceLineIndex === i)?.targets || [] }))
            .filter(({ src }) => src.tsId === tsId)

          let restoredCrew = (ts.crew as unknown as Record<string, unknown>[]).map(cm => cm)
          for (const { src, targets } of linesForTs) {
            restoredCrew = restoredCrew.map(cm => {
              if (cm.personId !== src.personId) return cm
              const days = { ...(cm.days as Record<string, unknown>) }
              const day  = { ...(days[src.date] as Record<string, unknown> | undefined || {}) }
              let allocs = [...((day.nrgWoAllocations as Record<string, unknown>[]) || [])]

              // Remove target allocs
              for (const t of targets) {
                const ti = allocs.findIndex(a => (a.wo === t.wo || a.tceItemId === t.tceItemId) && Math.abs((a.hours as number) - t.hours) < 0.01)
                if (ti !== -1) allocs.splice(ti, 1)
              }
              // Add source alloc back
              allocs.push({ wo: src.woTask || '', tceItemId: src.scopeType === 'tce' ? src.scopeKey : null, _tceMode: true, hours: src.hours, label: src.description, payCode: src.payCode })
              days[src.date] = { ...day, nrgWoAllocations: allocs }
              return { ...cm, days }
            })
          }

          await supabase.from('weekly_timesheets').update({ crew: restoredCrew }).eq('id', tsId)
          const updatedTs = { ...ts, crew: restoredCrew } as unknown as WeeklyTimesheet
          const { error: clErr } = await writeTimesheetCostLines(updatedTs, projectId, rateCards, tceLines as unknown as Parameters<typeof writeTimesheetCostLines>[3], resources, project)
          if (clErr) warnings.push(`Cost lines reversal warning: ${clErr}`)
        }
      }
    }

    // Delete the credit note record
    const { error: delErr } = await supabase.from('nrg_credit_notes').delete().eq('id', creditNoteId)
    if (delErr) throw new Error(`Failed to delete credit note record: ${delErr.message}`)

    return { success: true, warnings }
  } catch (err) {
    return { success: false, error: (err as Error).message, warnings }
  }
}
