/**
 * lib/dashboardLayout.ts
 *
 * Generic layout utilities shared by all dashboards.
 * Replaces the tileRegistry.ts helpers which were tied to the main registry.
 */

import type { TileDef, TileLayoutEntry } from '../types/dashboard'
import type { Module } from './permissions'

/**
 * Current layout schema version per dashboard. Bump when:
 *   1. A NEW default-visible tile is added that existing users should see, OR
 *   2. A meaningful re-ordering needs to apply to everyone (rare — usually keep
 *      individual customisations).
 *
 * When a user's stored version is < the current version, mergeLayout makes the
 * new defaultVisible tiles visible on next load (instead of appending hidden).
 *
 * v1 = original launch
 * v2 = Phase A hero tiles + AttentionFeed (Project Health, Cost Snapshot,
 *      Day Counter, Headcount Plan, Cash Position, Needs Attention) — May 2026
 */
export const DASHBOARD_LAYOUT_VERSIONS: Record<string, number> = {
  main: 3,
  cost: 3,
  hr: 2,
  hse: 1,
  hire: 1,
  tooling: 1,
  subcon: 1,
  hardware: 1,
  shipping: 1,
  parts: 1,
}

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
 * - New tiles in the registry are appended at the end.
 *   - If layoutVersion < currentVersion AND tile.defaultVisible: visible = true
 *     (so existing users see the new hero tiles).
 *   - Otherwise: visible = false (user opts in via picker).
 */
export function mergeLayout(
  saved: TileLayoutEntry[],
  registry: TileDef[],
  layoutVersion: number = 1,
  currentVersion: number = 1,
): TileLayoutEntry[] {
  const knownIds = new Set(registry.map(t => t.id))
  const maxOrder = saved.reduce((m, t) => Math.max(m, t.order), -1)
  const merged = saved.filter(t => knownIds.has(t.id))
  const savedIds = new Set(saved.map(t => t.id))
  let nextOrder = maxOrder + 1
  const isOutdated = layoutVersion < currentVersion
  for (const tile of registry) {
    if (!savedIds.has(tile.id)) {
      // New tile: visible if user's layout pre-dates a version bump AND tile is default-visible
      const visible = isOutdated && tile.defaultVisible
      merged.push({
        id: tile.id,
        visible,
        // New default-visible tiles slot in at the FRONT of the layout for
        // outdated users so heroes appear first. Otherwise append.
        order: visible ? -saved.length + nextOrder : nextOrder,
        size: tile.defaultSize,
      })
      nextOrder++
    }
  }
  return merged.sort((a, b) => a.order - b.order).map((t, i) => ({ ...t, order: i }))
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
