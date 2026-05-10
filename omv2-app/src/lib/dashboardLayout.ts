/**
 * lib/dashboardLayout.ts
 *
 * Generic layout utilities shared by all dashboards.
 * Replaces the tileRegistry.ts helpers which were tied to the main registry.
 */

import type { TileDef, TileLayoutEntry } from '../types/dashboard'
import type { Module } from './permissions'

/** Build a fresh default layout from a registry */
export function getDefaultLayout(registry: TileDef[]): TileLayoutEntry[] {
  return registry.map((t, i) => ({
    id: t.id,
    visible: t.defaultVisible,
    order: i,
    size: t.defaultSize,
  }))
}

/**
 * Merge a saved layout with the current registry.
 * - Tiles removed from the registry are silently dropped.
 * - New tiles in the registry are appended at the end, hidden by default.
 */
export function mergeLayout(
  saved: TileLayoutEntry[],
  registry: TileDef[],
): TileLayoutEntry[] {
  const knownIds = new Set(registry.map(t => t.id))
  const maxOrder = saved.reduce((m, t) => Math.max(m, t.order), -1)
  const merged = saved.filter(t => knownIds.has(t.id))
  const savedIds = new Set(saved.map(t => t.id))
  let nextOrder = maxOrder + 1
  for (const tile of registry) {
    if (!savedIds.has(tile.id)) {
      merged.push({
        id: tile.id,
        visible: false,            // new tiles always start hidden — user opts in via picker
        order: nextOrder++,
        size: tile.defaultSize,
      })
    }
  }
  return merged.sort((a, b) => a.order - b.order)
}

/**
 * Filter a registry by user permissions and project applicability.
 * Uses canRead function from usePermissions() — avoids passing a raw permissions Record.
 */
export function filterRegistry(
  registry: TileDef[],
  canRead: (module: Module) => boolean,
  canWrite: (module: Module) => boolean,
  project: { site_id?: string | null; [key: string]: unknown } | null,
): TileDef[] {
  return registry.filter(t => {
    if (t.requiredPermissions) {
      for (const req of t.requiredPermissions) {
        const allowed = req.level === 'write' ? canWrite(req.module) : canRead(req.module)
        if (!allowed) return false
      }
    }
    if (project && t.isApplicable && !t.isApplicable(project)) return false
    return true
  })
}

/** Make a simple AUD currency formatter (used when project currency is unknown) */
export function makeAUDFormatter(): (n: number) => string {
  return (n: number) =>
    'A$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
