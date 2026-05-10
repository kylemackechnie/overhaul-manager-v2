import {
  TotalRFQsTile, IssuedRFQsTile, AwardedRFQsTile,
  SubconActivePOsTile, TotalPOValueTile, RecentRFQsTile,
  ResponsesOverdueTile, VendorShortlistTile,
} from './subcon-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const SUBCON_TILES: TileComponent[] = [
  TotalRFQsTile, IssuedRFQsTile, AwardedRFQsTile,
  SubconActivePOsTile, TotalPOValueTile,
  RecentRFQsTile,
  ResponsesOverdueTile, VendorShortlistTile,
]

export const SUBCON_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(SUBCON_TILES.map(t => [t.def.id, t]))

export const SUBCON_REGISTRY: TileDef[] = SUBCON_TILES.map(t => t.def)
export const SUBCON_CATEGORIES = ['RFQs', 'POs']
