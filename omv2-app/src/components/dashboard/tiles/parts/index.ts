import {
  TotalPartsTile, ReceivedPartsTile, RequiredPartsTile, IssuedQtyTile, NotRequiredTile,
  ReceivingProgressTile, CrateBreakdownTile, RecentIssuesTile,
  DaysToRFCTile, PartsByWOTile,
} from './parts-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const PARTS_TILES: TileComponent[] = [
  TotalPartsTile, ReceivedPartsTile, RequiredPartsTile, IssuedQtyTile, NotRequiredTile,
  ReceivingProgressTile, CrateBreakdownTile, RecentIssuesTile,
  DaysToRFCTile, PartsByWOTile,
]

export const PARTS_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(PARTS_TILES.map(t => [t.def.id, t]))

export const PARTS_REGISTRY: TileDef[] = PARTS_TILES.map(t => t.def)
export const PARTS_CATEGORIES = ['Status', 'Detail']
