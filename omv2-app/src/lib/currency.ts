/**
 * currency.ts — Multi-currency engine for Overhaul Manager V2
 *
 * Design rules:
 *  • Rate cards store amounts in their NATIVE currency (EUR for seag, AUD for everything else)
 *  • convertToBase() is the single conversion point — never hardcode 1.65
 *  • SE AG hours sell/cost are in EUR; allowances (FSA/camp) are always in AUD
 *  • EUR_CATS = { seag, tooling } — these categories need conversion before AUD totalling
 *  • Customer report mode: 'split' (AUD + EUR shown) | 'allAUD' (everything converted)
 */

import type { Project, RateCard } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

export const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: '$', USD: 'US$', GBP: '£', EUR: '€',
  SGD: 'S$', NZD: 'NZ$', JPY: '¥', CNY: '¥', CAD: 'CA$', CHF: 'Fr',
}

export const CURRENCY_NAMES: Record<string, string> = {
  AUD: 'Australian Dollar', USD: 'US Dollar', GBP: 'British Pound',
  EUR: 'Euro', SGD: 'Singapore Dollar', NZD: 'New Zealand Dollar',
  JPY: 'Japanese Yen', CNY: 'Chinese Yuan', CAD: 'Canadian Dollar', CHF: 'Swiss Franc',
}

export const ADDABLE_CURRENCIES = ['USD', 'EUR', 'GBP', 'NZD', 'SGD', 'JPY', 'CAD', 'CHF']

/** Categories whose stored amounts are in EUR, not the project base currency */
export const EUR_CATEGORIES = new Set<string>(['seag', 'tooling'])

export type CurrencyMode = 'split' | 'allAUD'

export interface CurrencyRate { code: string; name: string; rate: number; isBase?: boolean }

// ─── Core helpers ─────────────────────────────────────────────────────────────

/** Get the project base currency (default AUD) */
export function getBaseCurrency(project: Project | null): string {
  return project?.currency || 'AUD'
}

/** Get all currencies for a project (base + additional) */
export function getProjectCurrencies(project: Project | null): CurrencyRate[] {
  const base = getBaseCurrency(project)
  const stored: CurrencyRate[] = (project?.currency_rates as CurrencyRate[] | undefined) || []
  const list: CurrencyRate[] = [
    { code: base, name: CURRENCY_NAMES[base] || base, rate: 1, isBase: true },
    ...stored.filter(c => c.code !== base),
  ]
  return list
}

/**
 * Get the conversion rate for fromCode → project base.
 * Returns 1 if same currency or rate not found (safe fallback).
 */
export function fxRate(project: Project | null, fromCode: string): number {
  const base = getBaseCurrency(project)
  if (!fromCode || fromCode === base) return 1
  const rates = (project?.currency_rates as CurrencyRate[] | undefined) || []
  const found = rates.find(r => r.code === fromCode)
  return found?.rate ?? 1
}

/**
 * Convert amount from fromCode to project base currency.
 * This is the single conversion point — use everywhere.
 */
export function convertToBase(amount: number, fromCode: string, project: Project | null): number {
  if (!amount) return 0
  return amount * fxRate(project, fromCode)
}

/** Get the EUR → base rate (convenience helper used in many places) */
export function getEurToBase(project: Project | null): number {
  return fxRate(project, 'EUR')
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Format with the project base currency symbol */
export function fmt(amount: number, project: Project | null, opts?: { decimals?: number }): string {
  const currency = getBaseCurrency(project)
  const sym = CURRENCY_SYMBOLS[currency] ?? '$'
  const dec = opts?.decimals ?? 2
  return sym + Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  })
}

/** Format always as EUR */
export function fmtEUR(amount: number, opts?: { decimals?: number }): string {
  const dec = opts?.decimals ?? 2
  return '€' + Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  })
}

/** Format with explicit currency code */
export function fmtCurrencyCode(amount: number, code: string, opts?: { decimals?: number }): string {
  const sym = CURRENCY_SYMBOLS[code] ?? code
  const dec = opts?.decimals ?? 2
  return sym + Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  })
}

/** Format a rounded integer (no decimals) with project base symbol */
export function fmtK(amount: number, project: Project | null): string {
  const currency = getBaseCurrency(project)
  const sym = CURRENCY_SYMBOLS[currency] ?? '$'
  return sym + Math.round(amount || 0).toLocaleString('en-AU')
}

// ─── Customer report mode ─────────────────────────────────────────────────────

const CR_MODE_KEY = 'crCurrMode'

export function getCurrencyMode(): CurrencyMode {
  return (localStorage.getItem(CR_MODE_KEY) as CurrencyMode) ?? 'split'
}

export function setCurrencyMode(mode: CurrencyMode): void {
  localStorage.setItem(CR_MODE_KEY, mode)
}

/**
 * Format a EUR amount respecting the customer report mode:
 *  - 'split': show as €X.XX
 *  - 'allAUD': convert and show as $X.XX (AUD)
 */
export function fmtEURForMode(
  amount: number,
  mode: CurrencyMode,
  project: Project | null,
): string {
  if (mode === 'allAUD') {
    const aud = convertToBase(amount, 'EUR', project)
    return fmt(aud, project)
  }
  return fmtEUR(amount)
}

/** Label for EUR amounts in customer report mode */
export function eurLabel(mode: CurrencyMode, project: Project | null): string {
  if (mode === 'allAUD') {
    const rate = getEurToBase(project)
    return `AUD (conv. @ ${rate.toFixed(4)})`
  }
  return 'EUR'
}

// ─── Rate card currency ───────────────────────────────────────────────────────

/**
 * Determine the native currency for a rate card.
 * Explicit: rc.currency field (added in V2).
 * Fallback: seag category → EUR, everything else → project base.
 */
export function getRateCardCurrency(rc: RateCard | null, project: Project | null): string {
  if (!rc) return getBaseCurrency(project)
  // Explicit currency field (V2 schema)
  const rcAny = rc as unknown as { currency?: string }
  if (rcAny.currency) return rcAny.currency
  // Fallback: seag is implicitly EUR
  if (rc.category === 'seag') return 'EUR'
  return getBaseCurrency(project)
}

/**
 * Determine if a rate card's hours are priced in EUR.
 */
export function isEurRateCard(rc: RateCard | null, project: Project | null): boolean {
  return getRateCardCurrency(rc, project) === 'EUR'
}

/**
 * Get the default currency for a given category.
 * Used when creating new rate cards.
 */
export function defaultCurrencyForCategory(category: string, project: Project | null): string {
  if (category === 'seag') return 'EUR'
  return getBaseCurrency(project)
}

// ─── Forecast helpers ─────────────────────────────────────────────────────────

/**
 * Convert a category amount to base currency for forecast totalling.
 * EUR_CATEGORIES (seag, tooling) are stored in EUR.
 */
export function catToBase(amount: number, category: string, project: Project | null): number {
  if (EUR_CATEGORIES.has(category)) return convertToBase(amount, 'EUR', project)
  return amount
}

/**
 * Build a CurrencyMethods object — pass this to components that need currency ops
 * without needing the full project object.
 */
export interface CurrencyMethods {
  base: string
  eurToBase: number
  fmt: (n: number, decimals?: number) => string
  fmtEUR: (n: number, decimals?: number) => string
  fmtForMode: (n: number, isEUR: boolean, mode: CurrencyMode) => string
  convertToBase: (n: number, fromCode: string) => number
  getSymbol: (code?: string) => string
}

export function buildCurrencyMethods(project: Project | null): CurrencyMethods {
  const base = getBaseCurrency(project)
  const eurToBase = getEurToBase(project)
  return {
    base,
    eurToBase,
    fmt: (n, dec) => fmt(n, project, { decimals: dec }),
    fmtEUR: (n, dec) => fmtEUR(n, { decimals: dec }),
    fmtForMode: (n, isEUR, mode) =>
      isEUR ? fmtEURForMode(n, mode, project) : fmt(n, project),
    convertToBase: (n, code) => convertToBase(n, code, project),
    getSymbol: (code) => CURRENCY_SYMBOLS[code ?? base] ?? '$',
  }
}
