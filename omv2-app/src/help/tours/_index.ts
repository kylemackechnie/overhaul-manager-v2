/**
 * Auto-registry for help walkthrough tours.
 *
 * Drop a .ts file in this folder that exports a Tour as default —
 * it appears in the Walkthroughs tab automatically.
 *
 * Example:
 *   // src/help/tours/tce-register-tour.ts
 *   import type { Tour } from './_types'
 *   const tour: Tour = { id: 'tce-register-tour', ... }
 *   export default tour
 */

import type { Tour } from './_types'

// _types and _index are excluded from the glob by their leading underscore.
const modules = import.meta.glob<{ default: Tour }>('./*.ts', { eager: true })

const tours: Tour[] = []
for (const path in modules) {
  // Skip files we don't want included
  if (path.endsWith('/_types.ts') || path.endsWith('/_index.ts')) continue
  const mod = modules[path]
  if (mod && mod.default && typeof mod.default === 'object' && 'id' in mod.default) {
    tours.push(mod.default)
  } else if (import.meta.env.DEV) {
    console.warn(`[help/tours] Skipping ${path} — no default Tour export`)
  }
}

// Stable sort: module then title
tours.sort((a, b) => {
  if (a.module !== b.module) return a.module.localeCompare(b.module)
  return a.title.localeCompare(b.title)
})

export const ALL_TOURS: Tour[] = tours

export function getTour(id: string): Tour | undefined {
  return tours.find(t => t.id === id)
}

export function getToursByModule(): { module: string; tours: Tour[] }[] {
  const map = new Map<string, Tour[]>()
  for (const t of tours) {
    const list = map.get(t.module) ?? []
    list.push(t)
    map.set(t.module, list)
  }
  return Array.from(map.entries()).map(([module, tours]) => ({ module, tours }))
}

export type { Tour, TourStep } from './_types'
