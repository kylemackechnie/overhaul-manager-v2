/**
 * roleAliases.ts — resource-import role normalisation.
 *
 * Mirrors the HTML's resolveImportRole / resolveImportShift. Used at import
 * time only — once a resource is in the DB its role is the rate-card role
 * verbatim, so every downstream lookup is a plain exact match.
 *
 * If you need to look up a rate card by raw role string at runtime, you're
 * doing it wrong — fix the import instead.
 */

import type { RateCard, RoleAlias } from '../types'

// Built-in alias map. Mirrors the HTML's ALIASES exactly. Match priority is:
// (1) exact, (2) strip shift suffix and exact, (3) project alias,
// (4) built-in alias by exact / prefix / suffix on stripped form.
const BUILTIN_ALIASES: Record<string, string> = {
  // Fitter variants
  'mechanical fitter':     'Fitter',
  'mech fitter':           'Fitter',
  'lh fitter':             'LH Fitter',
  'leading hand fitter':   'LH Fitter',
  'lgh fitter':            'LH Fitter',
  'lgt fitter':            'LH Fitter',
  // Crane
  'crane driver':          'Crane Operator',
  'crane operator':        'Crane Operator',
  // Trade assistant
  'trade assistant':       'Trades Assistant',
  'trades assistant':      'Trades Assistant',
  // Electrician
  'electrician':           'Electrician',
  // Admin
  'admin':                 'Administrator - Site',
  'site admin':            'Administrator - Site',
  'administrator - site':  'Administrator - Site',
  'office admin':          'Administrator - Office',
  'administrator - office':'Administrator - Office',
  // Combustion → Fitter
  'combustion chamber':    'Fitter',
  'combustion':            'Fitter',
  // Management
  'supervisor':            'Plant Supervisor',
  'project manager':       'Project Manager',
  'project engineer':      'QA / Project Engineer',
  'safety officer':        'Administrator - Site',
  'fact finder':           'Specialist Engineer',
  'specialist engineer nz':'Specialist Engineer NZ',
  'site engineer':         'QA / Project Engineer',
}

const SHIFT_SUFFIX_RE = /\s+(ds|ns|day shift|night shift|day|night)\s*$/i

/**
 * Resolve a raw imported role name (e.g. "Mechanical Fitter DS Valve") to
 * a known rate-card role (e.g. "Fitter"). Returns the raw role unchanged
 * if nothing matches — caller decides whether to flag as unmapped.
 */
export function resolveImportRole(
  rawRole: string | null | undefined,
  rateCards: RateCard[],
  projectAliases: RoleAlias[] = [],
): string {
  if (!rawRole) return ''
  const needle = rawRole.toLowerCase().trim()
  if (!needle) return ''

  // 1. Exact match (case-insensitive)
  const exact = rateCards.find(rc => rc.role.toLowerCase() === needle)
  if (exact) return exact.role

  // 2. Strip shift suffix and re-match
  const stripped = needle.replace(SHIFT_SUFFIX_RE, '').trim()
  if (stripped !== needle) {
    const exactStripped = rateCards.find(rc => rc.role.toLowerCase() === stripped)
    if (exactStripped) return exactStripped.role
  }

  // 3. Project-level custom aliases — exact key match against stripped or raw
  for (const alias of projectAliases) {
    const aFrom = (alias.from || '').toLowerCase().trim()
    if (!aFrom) continue
    if (stripped === aFrom || needle === aFrom) {
      const match = rateCards.find(rc => rc.role === alias.to)
      if (match) return match.role
    }
  }

  // 4. Built-in alias map — exact, prefix, or suffix on stripped form
  const aliasKey = Object.keys(BUILTIN_ALIASES).find(k =>
    stripped === k || stripped.startsWith(k + ' ') || stripped.endsWith(' ' + k),
  )
  if (aliasKey) {
    const target = BUILTIN_ALIASES[aliasKey]
    const match = rateCards.find(rc => rc.role === target)
    if (match) return match.role
  }

  // No match — keep the raw role so the unmapped resource shows up clearly
  // in the resource list. Better visible-and-broken than silently zeroed.
  return rawRole.trim()
}

/**
 * Detect shift from role-name suffix. Mirrors HTML resolveImportShift.
 *   "Mechanical Fitter DS Valve"  → 'day'
 *   "Crane Driver NS"             → 'night'
 *   "Rigger Night Shift"          → 'night'
 *   "LH Fitter"                   → 'day'
 */
export function resolveImportShift(rawRole: string | null | undefined): 'day' | 'night' {
  if (!rawRole) return 'day'
  const r = rawRole.trim().toUpperCase()
  if (/\bNS\b/.test(r) || r.includes('NIGHT')) return 'night'
  return 'day'
}
