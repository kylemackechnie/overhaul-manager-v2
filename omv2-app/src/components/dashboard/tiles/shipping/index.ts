import {
  TotalShipmentsTile, ImportsTile, ExportsTile, InTransitTile,
  InCustomsTile, DeliveredTile, DGShipmentsTile, RecentListTile,
  EtaOverdueTile, DGAtRiskTile, CustomsDelayedTile,
  RouteBreakdownTile, AirVsSeaTile,
} from './shipping-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const SHIPPING_TILES: TileComponent[] = [
  TotalShipmentsTile, ImportsTile, ExportsTile,
  InTransitTile, InCustomsTile, DeliveredTile, DGShipmentsTile,
  RecentListTile,
  EtaOverdueTile, DGAtRiskTile, CustomsDelayedTile,
  RouteBreakdownTile, AirVsSeaTile,
]

export const SHIPPING_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(SHIPPING_TILES.map(t => [t.def.id, t]))

export const SHIPPING_REGISTRY: TileDef[] = SHIPPING_TILES.map(t => t.def)
export const SHIPPING_CATEGORIES = ['Overview', 'Alerts', 'Detail']
