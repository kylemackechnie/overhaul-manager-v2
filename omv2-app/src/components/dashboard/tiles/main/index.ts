import { LookaheadTile } from './LookaheadTile'
import { ForecastSnapshotTile } from './ForecastSnapshotTile'
import { PersonnelTileEntry } from './PersonnelTile'
import {
  ProjectHealthTile, CostSnapshotTile, DayCountTile,
  HeadcountPlanTile, CashPositionTile,
} from './HeroTiles'
import { AttentionFeedTile } from './AttentionFeedTile'
import {
  CarsTile, AccommodationTile, ProcurementTile, VariationsTile,
  SparePartsTile, WorkOrdersTile, HireTile, ToolingTile,
  SubcontractorsTile, LogisticsTile, HardwareTile, ProjectStatusTile,
} from './SimpleTiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const MAIN_TILES: TileComponent[] = [
  // ─── Hero tier — health & signals (visible by default) ───────────────────
  ProjectHealthTile,
  CostSnapshotTile,
  DayCountTile,
  HeadcountPlanTile,
  CashPositionTile,
  // ─── Action tier ─────────────────────────────────────────────────────────
  AttentionFeedTile,
  LookaheadTile,
  ForecastSnapshotTile,
  PersonnelTileEntry,
  // ─── Reference tier — module navigation cards (hidden by default) ────────
  ProjectStatusTile,
  CarsTile,
  AccommodationTile,
  ProcurementTile,
  VariationsTile,
  SparePartsTile,
  WorkOrdersTile,
  HireTile,
  ToolingTile,
  SubcontractorsTile,
  LogisticsTile,
  HardwareTile,
]

export const MAIN_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(MAIN_TILES.map(t => [t.def.id, t]))

export const MAIN_REGISTRY: TileDef[] = MAIN_TILES.map(t => t.def)

export const MAIN_CATEGORIES = ['Health', 'Finance', 'Schedule', 'People', 'Project', 'Field', 'Commercial']
