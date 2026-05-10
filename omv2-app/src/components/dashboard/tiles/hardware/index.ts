import {
  ContractsTotalTile, ContractsActiveTile, CartsCountTile, TotalContractValueTile,
  ContractsByStatusTile, CurrencyExposureTile, TopContractsTile,
  TotalTransferValueTile, EscalationTableTile, ContractAgingTile,
} from './hardware-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const HARDWARE_TILES: TileComponent[] = [
  // Existing
  ContractsTotalTile, ContractsActiveTile, CartsCountTile, TotalContractValueTile,
  // New — visible by default
  ContractsByStatusTile, CurrencyExposureTile, TopContractsTile, EscalationTableTile,
  // New — hidden
  TotalTransferValueTile, ContractAgingTile,
]

export const HARDWARE_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(HARDWARE_TILES.map(t => [t.def.id, t]))

export const HARDWARE_REGISTRY: TileDef[] = HARDWARE_TILES.map(t => t.def)
export const HARDWARE_CATEGORIES = ['Summary', 'Finance']
