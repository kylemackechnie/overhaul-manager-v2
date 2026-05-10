import {
  TVsOnProjectTile, KollosPackagesTile, TotalTVDaysTile, AwaitingDatesTile,
  GrossMarginToolingTile, TotalCostEURTile, TotalSellEURTile,
  TVRegisterTableTile,
  TVsNoDeptTile, EurAudImpactTile, ChargeTimelineTile,
} from './tooling-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const TOOLING_TILES: TileComponent[] = [
  TVsOnProjectTile, KollosPackagesTile, TotalTVDaysTile, AwaitingDatesTile,
  GrossMarginToolingTile, TotalCostEURTile, TotalSellEURTile,
  TVRegisterTableTile,
  ChargeTimelineTile,
  TVsNoDeptTile, EurAudImpactTile,
]

export const TOOLING_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(TOOLING_TILES.map(t => [t.def.id, t]))

export const TOOLING_REGISTRY: TileDef[] = TOOLING_TILES.map(t => t.def)
export const TOOLING_CATEGORIES = ['Summary', 'Finance', 'Detail', 'Alerts']
