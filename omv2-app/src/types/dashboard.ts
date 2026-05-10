/**
 * types/dashboard.ts
 *
 * Framework types for the customisable dashboard system.
 * Used by CustomisableDashboard, tile components, and primitives.
 */

import type { ComponentType } from 'react'
import type { Module } from '../lib/permissions'

// ── Tile sizing ───────────────────────────────────────────────────────────────
// Phase 1 implements md (normal) and lg (wide) only.
// sm / xl / full documented now so the type doesn't need changing later.
export type TileSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

// ── Tile definition ───────────────────────────────────────────────────────────
export interface TileDef {
  id: string                         // stable, kebab-case, unique within registry
  icon: string                       // emoji
  title: string                      // shown in tile header + picker
  description: string                // shown in picker
  category: string                   // groups tiles in the picker

  defaultSize: TileSize
  defaultVisible: boolean

  allowedSizes?: TileSize[]          // restrict resize options (default: all Phase 1 sizes)

  requiredPermissions?: { module: Module; level: 'read' | 'write' }[]
  isApplicable?: (project: { site_id?: string | null; [key: string]: unknown }) => boolean
}

// ── Layout entry ──────────────────────────────────────────────────────────────
// Persisted in UserPrefs.dashboard_layouts[dashboardId]
export interface TileLayoutEntry {
  id: string
  visible: boolean
  order: number
  size: TileSize
}

// ── Dashboard context ──────────────────────────────────────────────────────────
// Passed down to every tile component via props.
export interface DashboardContext {
  projectId?: string
  userId: string
  timeWindow: { from: string; to: string; preset: string }
  fmt: (n: number) => string         // currency formatter for the project's currency
  setActivePanel: (panel: string) => void
}

// ── Tile component ──────────────────────────────────────────────────────────
// One tile = one TileComponent object (def + Component).
export interface TileComponent {
  def: TileDef
  Component: ComponentType<{ ctx: DashboardContext }>
}
