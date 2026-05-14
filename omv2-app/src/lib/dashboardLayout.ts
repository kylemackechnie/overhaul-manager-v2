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
 * v3 = Phase B (Cost CPI/SPI/EAC/TCPI etc) + Phase C (Mob Readiness,
 *      PreplanProgress, VendorConcentration, ProductivityIndex)
 * v4 = Re-trigger of v3 migration after fixing the persistence race where the
 *      version bump fired before the merged layout was saved, hiding the new
 *      tiles on subsequent loads.
 */
export const DASHBOARD_LAYOUT_VERSIONS: Record<string, number> = {
  main: 4,
  cost: 4,
  hr: 3,
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
 * - For users with an outdated layout version:
 *   - NEW tiles in the registry are added at the front, visible if defaultVisible.
 *   - EXISTING tiles in the saved layout that are currently hidden but have
 *     defaultVisible=true in the registry are RE-PROMOTED to visible. This
 *     recovers users whose previous migration ran with broken logic (e.g.
 *     race condition that saved them as hidden).
 * - For users at the current version: saved layout is preserved as-is.
 */
export function mergeLayout(
  saved: TileLayoutEntry[],
  registry: TileDef[],
  layoutVersion: number = 1,
  currentVersion: number = 1,
): TileLayoutEntry[] {
  const knownIds = new Set(registry.map(t => t.id))
  const maxOrder = saved.reduce((m, t) => Math.max(m, t.order), -1)
  const savedIds = new Set(saved.map(t => t.id))
  const isOutdated = layoutVersion < currentVersion

  // Build a lookup of registry defaults for re-promotion logic
  const regByDef = new Map<string, TileDef>()
  for (const t of registry) regByDef.set(t.id, t)

  // 1. Keep saved tiles that still exist in the registry.
  //    If outdated AND the tile is currently hidden but should be visible by
  //    default, re-promote it. This recovers users from a broken prior migration.
  const merged: TileLayoutEntry[] = saved
    .filter(t => knownIds.has(t.id))
    .map(t => {
      if (!isOutdated) return t
      const def = regByDef.get(t.id)
      if (!def) return t
      if (!t.visible && def.defaultVisible) {
        // Re-promote: bring to the front
        return { ...t, visible: true, order: -1 }
      }
      return t
    })

  // 2. Append new tiles. If outdated AND defaultVisible, add at the front
  //    (negative order) so heroes appear before existing tiles. Otherwise
  //    append at the end, hidden.
  let nextOrder = maxOrder + 1
  for (const tile of registry) {
    if (!savedIds.has(tile.id)) {
      const visible = isOutdated && tile.defaultVisible
      merged.push({
        id: tile.id,
        visible,
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
