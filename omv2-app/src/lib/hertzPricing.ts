/**
 * Hertz pricing engine — pure functions, no side effects.
 *
 * Computes the cost of a Hertz vehicle hire from a rate-card row, a date range,
 * a location type, and a few optional inputs (location fee, km estimate, optional
 * waivers). All rates and conditions are sourced from the Siemens Energy /
 * Hertz Global Pricing Rate Sheet 2024–26, mirrored into the
 * `hertz_vehicle_rates` and `hertz_locations` tables.
 *
 * Cost order (matches the locked-in plan):
 *   1. Base                = daily_rate × days
 *   2. Daily surcharge     = surcharge_for(location_type) × days
 *   3. Location fee        = % of (base + surcharge) OR fixed_daily × days
 *   4. Excess km (if any)  = max(0, estimated_km − (km_included × days)) × excess_km_rate
 *   5. LDW/MDW (optional)  = per-day rates entered at booking × days
 *   6. Weekend surcharge   = rate.weekend_surcharge_amount  (L6 rule today)
 *   7. One-way fee         = manually entered, additive
 *   8. GST 10%             = applied at the end (rates are GST-exclusive)
 *
 * Known PDF cases to validate against (all ex-GST):
 *   - Mazda CX5 (IFAR) 5 days metro Sydney CBD (8% LF):
 *       5 × 56.97 = 284.85 base + 0 surcharge + 22.79 LF = 307.64
 *   - Toyota Prado (FFBR) 14 days Mt Isa (high_remote, 11.6% LF):
 *       14 × 72.29 = 1012.06 base + 14 × 30 = 420 surcharge
 *       + (1012.06 + 420) × 0.116 = 166.12 LF = 1598.18
 *   - Polestar 2 (RSAC) 3 days Burnie Airport (metro, $25/day fixed LF):
 *       3 × 74.90 = 224.70 base + 0 surcharge + 75 LF = 299.70
 */

import type {
  HertzVehicleRate,
  HertzLocation,
  HertzRateTier,
  HertzLocationFeeType,
  VehicleLocationType,
} from '../types'
import { daysBetween as calcDaysBetween } from './calculations'

// ─── Pure helpers ──────────────────────────────────────────────────────────

/**
 * Picks the rate tier for a given duration in calendar days.
 * Days 0–2 → '1-2', 3–6 → '3-6', 7–29 → '7-29', 30+ → '30+'.
 */
export function getRateTier(days: number): HertzRateTier {
  if (days <= 2) return '1-2'
  if (days <= 6) return '3-6'
  if (days <= 29) return '7-29'
  return '30+'
}

export function getRateForTier(rate: HertzVehicleRate, tier: HertzRateTier): number {
  switch (tier) {
    case '1-2': return rate.rate_1_2_days
    case '3-6': return rate.rate_3_6_days
    case '7-29': return rate.rate_7_29_days
    case '30+': return rate.rate_30_plus_days
  }
}

/**
 * Returns the daily surcharge ($/day) for the given location type.
 * Metro = 0 (unlimited km, no surcharge per rate sheet conditions).
 */
export function getDailySurcharge(rate: HertzVehicleRate, locationType: VehicleLocationType): number {
  switch (locationType) {
    case 'metro': return 0
    case 'country': return rate.surcharge_country
    case 'remote': return rate.surcharge_remote
    case 'high_remote': return rate.surcharge_high_remote
  }
}

/**
 * Returns the km included per day for the given location type.
 * Null means unlimited (metro).
 */
export function getKmIncludedPerDay(rate: HertzVehicleRate, locationType: VehicleLocationType): number | null {
  if (locationType === 'metro') return null
  if (locationType === 'country') return rate.km_included_country
  // remote and high_remote share the same km allowance
  return rate.km_included_remote
}

/**
 * Day-of-week of an ISO date (yyyy-mm-dd). 0 = Sun, 5 = Fri, 6 = Sat.
 */
export function getDayOfWeek(isoDate: string): number {
  return new Date(isoDate + 'T00:00:00').getDay()
}

export function isWeekendStart(isoDate: string): boolean {
  const dow = getDayOfWeek(isoDate)
  return dow === 5 || dow === 6 || dow === 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Main cost calculation ─────────────────────────────────────────────────

export interface HertzCostInput {
  rate: HertzVehicleRate
  pickupDate: string  // ISO yyyy-mm-dd
  returnDate: string  // ISO yyyy-mm-dd
  locationType: VehicleLocationType
  locationFeeType?: HertzLocationFeeType
  locationFeeValue?: number
  estimatedKm?: number
  ldwDailyRate?: number
  mdwDailyRate?: number
  oneWayFee?: number
}

export interface HertzCostBreakdown {
  days: number
  tier: HertzRateTier
  dailyRate: number
  baseCost: number
  dailySurcharge: number
  surchargeTotal: number
  locationFeeAmount: number
  excessKmAllowed: number | null  // null = unlimited (metro)
  excessKmEstimated: number
  excessKmCost: number
  ldwTotal: number
  mdwTotal: number
  weekendSurcharge: number
  oneWayFee: number
  totalCostExGst: number
  totalCostInclGst: number
  warnings: string[]
}

/**
 * Full Hertz cost calculation. Returns a structured breakdown so the UI can
 * show each line discretely. Days are calendar days (matches the existing
 * CarsPanel daysBetween() convention).
 */
export function calculateHertzCost(input: HertzCostInput): HertzCostBreakdown {
  const warnings: string[] = []
  const rawDays = calcDaysBetween(input.pickupDate, input.returnDate)
  const days = Math.max(1, rawDays)

  const tier = getRateTier(days)
  const dailyRate = getRateForTier(input.rate, tier)

  // 1. Base
  const baseCost = round2(dailyRate * days)

  // 2. Daily surcharge
  const dailySurcharge = getDailySurcharge(input.rate, input.locationType)
  const surchargeTotal = round2(dailySurcharge * days)

  // 3. Location fee — applies to (base + surcharge) only, per the locked rule
  let locationFeeAmount = 0
  if (input.locationFeeType === 'percentage' && input.locationFeeValue) {
    locationFeeAmount = round2((baseCost + surchargeTotal) * (input.locationFeeValue / 100))
  } else if (input.locationFeeType === 'fixed_daily' && input.locationFeeValue) {
    locationFeeAmount = round2(input.locationFeeValue * days)
  }

  // 4. Excess km — only matters outside metro (metro = unlimited)
  let excessKmAllowed: number | null = null
  let excessKmCost = 0
  if (input.locationType !== 'metro') {
    const kmPerDay = getKmIncludedPerDay(input.rate, input.locationType)
    excessKmAllowed = (kmPerDay ?? 0) * days
    const estimated = input.estimatedKm ?? 0
    if (estimated > excessKmAllowed && input.rate.excess_km_rate) {
      excessKmCost = round2((estimated - excessKmAllowed) * input.rate.excess_km_rate)
    }
  }

  // 5. Optional waivers (per-day, user-entered at booking)
  const ldwTotal = round2((input.ldwDailyRate ?? 0) * days)
  const mdwTotal = round2((input.mdwDailyRate ?? 0) * days)

  // 6. Weekend short-rental surcharge (L6 rule: $30 Fri/Sat/Sun start, ≤24h)
  let weekendSurcharge = 0
  if (
    input.rate.weekend_surcharge_amount &&
    input.rate.weekend_surcharge_max_hours &&
    days <= 1 &&
    isWeekendStart(input.pickupDate)
  ) {
    weekendSurcharge = round2(input.rate.weekend_surcharge_amount)
  }

  // 7. One-way fee (kept for legacy / manual entry)
  const oneWayFee = round2(input.oneWayFee ?? 0)

  // Warnings (non-blocking, surfaced in the UI)
  if (
    (input.locationType === 'remote' || input.locationType === 'high_remote') &&
    !input.rate.remote_available
  ) {
    warnings.push('This vehicle is not available in remote locations per Hertz policy.')
  }
  if (input.locationType !== 'metro' && (input.estimatedKm ?? 0) === 0) {
    warnings.push('Excess km not estimated — actual cost may differ if daily km allowance is exceeded.')
  }

  const totalCostExGst = round2(
    baseCost + surchargeTotal + locationFeeAmount + excessKmCost +
    ldwTotal + mdwTotal + weekendSurcharge + oneWayFee
  )
  const totalCostInclGst = round2(totalCostExGst * 1.1)

  return {
    days,
    tier,
    dailyRate,
    baseCost,
    dailySurcharge,
    surchargeTotal,
    locationFeeAmount,
    excessKmAllowed,
    excessKmEstimated: input.estimatedKm ?? 0,
    excessKmCost,
    ldwTotal,
    mdwTotal,
    weekendSurcharge,
    oneWayFee,
    totalCostExGst,
    totalCostInclGst,
    warnings,
  }
}

// ─── Convenience derivations for the booking form ──────────────────────────

/**
 * Resolves location_type for a given Hertz location row. Pure passthrough
 * but provided for API symmetry — callers shouldn't reach into the row.
 */
export function locationTypeFor(loc: HertzLocation): VehicleLocationType {
  return loc.location_type
}

/**
 * Convenience formatter for the tier label.
 */
export function tierLabel(tier: HertzRateTier): string {
  switch (tier) {
    case '1-2': return '1–2 days'
    case '3-6': return '3–6 days'
    case '7-29': return '7–29 days'
    case '30+': return '30+ days'
  }
}

/**
 * Convenience formatter for the vehicle category label.
 */
export function vehicleCategoryLabel(cat: string): string {
  switch (cat) {
    case 'electric_hybrid': return 'Electric & Hybrid'
    case 'passenger': return 'Passenger'
    case 'prestige': return 'Prestige'
    case '4wd': return '4WD'
    case 'bus': return 'Bus'
    case 'commercial': return 'Commercial'
    default: return cat
  }
}

/**
 * Convenience formatter for location_type.
 */
export function locationTypeLabel(t: VehicleLocationType): string {
  switch (t) {
    case 'metro': return 'Metropolitan'
    case 'country': return 'Country'
    case 'remote': return 'Remote'
    case 'high_remote': return 'Remote (BH / Mt Isa / Weipa)'
  }
}
