import { LookaheadTile } from './LookaheadTile'
import { ForecastSnapshotTile } from './ForecastSnapshotTile'
import { PersonnelTileEntry } from './PersonnelTile'
import {
  CarsTile, AccommodationTile, ProcurementTile, VariationsTile,
  SparePartsTile, WorkOrdersTile, HireTile, ToolingTile,
  SubcontractorsTile, LogisticsTile, HardwareTile, ProjectStatusTile,
} from './SimpleTiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const MAIN_TILES: TileComponent[] = [
  LookaheadTile,
  ForecastSnapshotTile,
  ProjectStatusTile,
  PersonnelTileEntry,
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

export const MAIN_CATEGORIES = ['Project', 'People', 'Finance', 'Field', 'Commercial']
