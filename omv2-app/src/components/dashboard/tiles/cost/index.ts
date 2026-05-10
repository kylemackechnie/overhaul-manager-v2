import {
  InvoiceTotalTile, ApprovedPaidTile, PendingInvoicesTile, DisputedInvoicesTile,
  ActivePOsTile, PendingPOCommitmentTile, WbsCodesTile, SapReconStatusTile,
  TradesHoursTile, TradesCostTile, MgmtHoursTile, BackOfficeCostTile,
  HireEquipmentTile, ExpensesTotalTile, CarsTotalTile, AccomTotalTile,
  VariationsApprovedTile, ToolingEurCostTile, ExpenseByCategoryTile,
} from './cost-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const COST_TILES: TileComponent[] = [
  // Procurement
  InvoiceTotalTile, ApprovedPaidTile, PendingInvoicesTile, DisputedInvoicesTile,
  ActivePOsTile, PendingPOCommitmentTile, WbsCodesTile, SapReconStatusTile,
  // Labour
  TradesHoursTile, TradesCostTile, MgmtHoursTile, BackOfficeCostTile,
  // Other Costs
  HireEquipmentTile, ExpensesTotalTile, CarsTotalTile, AccomTotalTile, ToolingEurCostTile,
  // Variations & Other
  VariationsApprovedTile, ExpenseByCategoryTile,
]

export const COST_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(COST_TILES.map(t => [t.def.id, t]))

export const COST_REGISTRY: TileDef[] = COST_TILES.map(t => t.def)

export const COST_CATEGORIES = ['Procurement', 'Labour', 'Other Costs', 'Variations']
