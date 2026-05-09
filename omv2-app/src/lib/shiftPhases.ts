import type { Resource, ShiftPhase } from '../types'

/**
 * Resolve what shift a resource is on for a specific date.
 *
 * If the resource has shift_phases defined, find the phase whose [from, to]
 * range contains the date.  If no phase matches (gap or no phases), fall back
 * to r.shift.
 *
 * Phases are expected to be contiguous (no gaps) — the UI enforces this.
 * This function is deliberately lenient: a gap just falls back to r.shift.
 */
export function resolveShift(
  r: Pick<Resource, 'shift' | 'shift_phases'>,
  date: string,
): 'day' | 'night' | 'both' {
  const phases = r.shift_phases
  if (!phases || phases.length === 0) return r.shift || 'day'
  const phase = phases.find(p => date >= p.from && date <= p.to)
  return phase ? phase.shift : (r.shift || 'day')
}

/**
 * Returns true if the resource has more than one distinct shift across all phases
 * (or phase vs default shift), i.e. the resource has a mixed schedule.
 */
export function hasMixedShifts(r: Pick<Resource, 'shift' | 'shift_phases'>): boolean {
  const phases = r.shift_phases
  if (!phases || phases.length === 0) return false
  const allShifts = new Set([r.shift, ...phases.map(p => p.shift)])
  return allShifts.size > 1
}

/**
 * Returns the shift to display in the resource list for a given date.
 * For today: the active phase shift.
 * Falls back to r.shift for dates outside mob range or when no phases.
 */
export function displayShift(
  r: Pick<Resource, 'shift' | 'shift_phases'>,
  date: string,
): { shift: 'day' | 'night' | 'both'; mixed: boolean } {
  return {
    shift: resolveShift(r, date),
    mixed: hasMixedShifts(r),
  }
}

/** Validate phases: no gaps, no overlaps, all within mob period. Returns error string or null. */
export function validatePhases(
  phases: ShiftPhase[],
  mobIn: string | null,
  mobOut: string | null,
): string | null {
  if (phases.length === 0) return null

  const sorted = [...phases].sort((a, b) => a.from.localeCompare(b.from))

  // Check each phase is valid
  for (const p of sorted) {
    if (p.from > p.to) return `Phase starting ${p.from} has end date before start date`
  }

  // Check no overlaps or gaps between consecutive phases
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    // Next phase must start the day after previous ends
    const prevEndNext = nextDay(prev.to)
    if (curr.from !== prevEndNext) {
      return `Gap or overlap between ${prev.to} and ${curr.from} — phases must be contiguous`
    }
  }

  // Check first phase starts at mob_in and last ends at mob_out (if both set)
  if (mobIn && sorted[0].from !== mobIn) {
    return `First phase must start on mob-in date (${mobIn})`
  }
  if (mobOut && sorted[sorted.length - 1].to !== mobOut) {
    return `Last phase must end on mob-out date (${mobOut})`
  }

  return null
}

function nextDay(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export const SHIFT_LABELS: Record<string, string> = {
  day:   '☀️ Day',
  night: '🌙 Night',
  both:  '☀️🌙 Both',
}
