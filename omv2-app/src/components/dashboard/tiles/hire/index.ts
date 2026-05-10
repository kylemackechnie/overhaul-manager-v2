import {
  TotalItemsTile, CurrentlyActiveTile, TotalCostHireTile, CustomerChargeTile,
  DrySummaryTile, WetSummaryTile, LocalSummaryTile,
  GmBarTile, ActiveTableTile,
  VendorExposureTile, NoPOAlertTile, Offhire14dTile,
} from './hire-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const HIRE_TILES: TileComponent[] = [
  TotalItemsTile, CurrentlyActiveTile, TotalCostHireTile, CustomerChargeTile,
  DrySummaryTile, WetSummaryTile, LocalSummaryTile,
  GmBarTile, ActiveTableTile,
  VendorExposureTile, NoPOAlertTile, Offhire14dTile,
]

export const HIRE_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(HIRE_TILES.map(t => [t.def.id, t]))

export const HIRE_REGISTRY: TileDef[] = HIRE_TILES.map(t => t.def)
export const HIRE_CATEGORIES = ['Summary', 'By Type', 'Finance', 'Detail', 'Alerts']
