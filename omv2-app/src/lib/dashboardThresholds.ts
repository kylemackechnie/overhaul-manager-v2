/**
 * dashboardThresholds.ts
 *
 * Single source of truth for R/A/G (Red/Amber/Green) thresholds across every
 * dashboard tile. Centralising these here means:
 *   1. Tiles all use the same colour rules — consistent across dashboards.
 *   2. Per-project tuning is one config update (future: load from project settings).
 *   3. Tests can assert on a single registry instead of scattered magic numbers.
 *
 * Naming conventions:
 *   - "higher is better" metrics (CPI, SPI, GM%): green ≥ goodAt, amber ≥ warnAt
 *   - "lower is better" metrics (variance %, days overdue): green ≤ goodAt, amber ≤ warnAt
 *
 * Helpers below convert raw values to a {tone, color} pair the UI can consume.
 */

export type Tone = 'green' | 'amber' | 'red' | 'neutral'

export const TONE_COLOR: Record<Tone, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  neutral: 'var(--text3)',
}

// ── Threshold definitions ────────────────────────────────────────────────────
// goodAt = the boundary between amber and green
// warnAt = the boundary between red and amber
// direction = whether higher or lower is better

export interface ThresholdRule {
  goodAt: number
  warnAt: number
  direction: 'higher_is_better' | 'lower_is_better'
}

export const THRESHOLDS = {
  // ─── Earned Value indices ───────────────────────────────────────────────
  /** Cost Performance Index = EV / AC. >1 means under budget */
  cpi: { goodAt: 1.0, warnAt: 0.9, direction: 'higher_is_better' } as ThresholdRule,
  /** Schedule Performance Index = EV / PV. >1 means ahead of schedule */
  spi: { goodAt: 1.0, warnAt: 0.9, direction: 'higher_is_better' } as ThresholdRule,
  /** To-Complete Performance Index. <1.05 means achievable, >1.10 means stretch */
  tcpi: { goodAt: 1.05, warnAt: 1.10, direction: 'lower_is_better' } as ThresholdRule,

  // ─── Financial deltas ───────────────────────────────────────────────────
  /** EAC variance vs BAC as a percentage. Negative = overrun */
  vacPct: { goodAt: 0, warnAt: -5, direction: 'higher_is_better' } as ThresholdRule,
  /** Gross margin % */
  gmPct: { goodAt: 35, warnAt: 25, direction: 'higher_is_better' } as ThresholdRule,
  /** % of TCE / budget consumed at a given point in time */
  budgetUsedPct: { goodAt: 85, warnAt: 100, direction: 'lower_is_better' } as ThresholdRule,

  // ─── Cashflow / invoicing ──────────────────────────────────────────────
  /** Days from invoice received to approved/paid */
  invoiceAgeDays: { goodAt: 30, warnAt: 60, direction: 'lower_is_better' } as ThresholdRule,
  /** % of invoiced value still unapproved */
  unapprovedInvoicePct: { goodAt: 15, warnAt: 30, direction: 'lower_is_better' } as ThresholdRule,

  // ─── Mob readiness ──────────────────────────────────────────────────────
  /** Days until mob — used in readiness checks */
  mobUrgencyDays: { goodAt: 14, warnAt: 7, direction: 'higher_is_better' } as ThresholdRule,
  /** % of mobs in next 14 days with everything booked */
  mobReadinessPct: { goodAt: 95, warnAt: 80, direction: 'higher_is_better' } as ThresholdRule,

  // ─── Personnel ──────────────────────────────────────────────────────────
  /** Inductions overdue (days since last induction) */
  inductionAgeDays: { goodAt: 330, warnAt: 365, direction: 'lower_is_better' } as ThresholdRule,
  /** % of resources with a linked PO (for subcons) */
  subconPoLinkedPct: { goodAt: 100, warnAt: 90, direction: 'higher_is_better' } as ThresholdRule,
  /** % of weekly timesheets in current week submitted */
  timesheetSubmissionPct: { goodAt: 95, warnAt: 80, direction: 'higher_is_better' } as ThresholdRule,

  // ─── Procurement ────────────────────────────────────────────────────────
  /** % of POs with a forecast date set */
  poForecastedPct: { goodAt: 95, warnAt: 80, direction: 'higher_is_better' } as ThresholdRule,
  /** RFQ response rate */
  rfqResponseRatePct: { goodAt: 60, warnAt: 40, direction: 'higher_is_better' } as ThresholdRule,

  // ─── Schedule / time-based ─────────────────────────────────────────────
  /** Pre-planning completion % */
  preplanCompletePct: { goodAt: 95, warnAt: 80, direction: 'higher_is_better' } as ThresholdRule,
  /** Pre-planning items overdue */
  preplanOverdueCount: { goodAt: 0, warnAt: 5, direction: 'lower_is_better' } as ThresholdRule,

  // ─── HSE ────────────────────────────────────────────────────────────────
  /** Days since last incident (higher is better) */
  daysSinceIncident: { goodAt: 30, warnAt: 7, direction: 'higher_is_better' } as ThresholdRule,
} as const

export type ThresholdKey = keyof typeof THRESHOLDS

// ── Tone derivation ──────────────────────────────────────────────────────────

/**
 * Convert a raw value to a tone using a threshold rule.
 * Returns 'neutral' if the value is null/undefined/NaN.
 */
export function toneFor(value: number | null | undefined, key: ThresholdKey): Tone {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  const rule = THRESHOLDS[key]
  if (rule.direction === 'higher_is_better') {
    if (value >= rule.goodAt) return 'green'
    if (value >= rule.warnAt) return 'amber'
    return 'red'
  } else {
    if (value <= rule.goodAt) return 'green'
    if (value <= rule.warnAt) return 'amber'
    return 'red'
  }
}

/** Convenience: return the CSS colour for the tone of a value under a rule */
export function colorFor(value: number | null | undefined, key: ThresholdKey): string {
  return TONE_COLOR[toneFor(value, key)]
}

/**
 * Inverse-tone — used when we want red to feel positive (e.g. "days since incident"
 * red means we just had an incident, but the metric is rendered with reverse colour
 * semantics elsewhere). Provided for completeness; rarely needed in tile code.
 */
export function inverseTone(t: Tone): Tone {
  if (t === 'green') return 'red'
  if (t === 'red') return 'green'
  return t
}
