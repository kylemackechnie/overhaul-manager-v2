/**
 * Currency conversion utility
 * Uses FX rates stored on the project to convert to base currency
 */

import type { Project } from '../types'

export interface CurrencyRate { code: string; name: string; rate: number }

/**
 * Get the conversion rate from a foreign currency to the project base currency
 * Returns 1 if same currency or rate not found
 */
export function fxRate(project: Project | null, fromCurrency: string): number {
  if (!project) return 1
  const baseCurrency = project.currency || 'AUD'
  if (fromCurrency === baseCurrency) return 1
  const rates = (project.currency_rates as CurrencyRate[] | undefined) || []
  const found = rates.find(r => r.code === fromCurrency)
  return found?.rate || 1
}

/**
 * Convert an amount from a foreign currency to the project base currency
 */
export function convertToBase(amount: number, fromCurrency: string, project: Project | null): number {
  return amount * fxRate(project, fromCurrency)
}

/**
 * Format a currency amount with the project base symbol
 */
export function fmtCurrency(amount: number, project: Project | null, opts?: { decimals?: number }): string {
  const currency = project?.currency || 'AUD'
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
  return symbol + amount.toLocaleString('en-AU', { maximumFractionDigits: opts?.decimals ?? 0 })
}
