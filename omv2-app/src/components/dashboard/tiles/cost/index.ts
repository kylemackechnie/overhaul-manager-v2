import {
  InvoiceTotalTile, ApprovedPaidTile, PendingInvoicesTile, DisputedInvoicesTile,
  ActivePOsTile, PendingPOCommitmentTile, WbsCodesTile, SapReconStatusTile,
  TradesHoursTile, TradesCostTile, MgmtHoursTile, BackOfficeCostTile,
  HireEquipmentTile, ExpensesTotalTile, CarsTotalTile, AccomTotalTile,
  VariationsApprovedTile, ToolingEurCostTile, ExpenseByCategoryTile,
} from './cost-tiles'
import {
  CPITile, SPITile, EACTile, TCPITile, CashConversionTile,
  WbsHeatStripTile, InvoiceAgeingTile, SpendVelocityTile, VariationImpactTile,
} from './cost-hero-tiles'
import { VendorConcentrationTile } from '../ExtraTiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const COST_TILES: TileComponent[] = [
  // ─── Hero tier: Earned Value indices (visible by default) ───────────────
  CPITile, SPITile, EACTile, TCPITile,
  // ─── Hero tier: cashflow ─────────────────────────────────────────────────
  CashConversionTile,
  // ─── Detail tier: full-width WBS heat strip ──────────────────────────────
  WbsHeatStripTile,
  // ─── Detail tier: focused signals (visible by default) ───────────────────
  InvoiceAgeingTile, SpendVelocityTile, VariationImpactTile, VendorConcentrationTile,
  // ─── Reference tier: granular KPI cards (hidden by default) ──────────────
  InvoiceTotalTile, ApprovedPaidTile, PendingInvoicesTile, DisputedInvoicesTile,
  ActivePOsTile, PendingPOCommitmentTile, WbsCodesTile, SapReconStatusTile,
  TradesHoursTile, TradesCostTile, MgmtHoursTile, BackOfficeCostTile,
  HireEquipmentTile, ExpensesTotalTile, CarsTotalTile, AccomTotalTile, ToolingEurCostTile,
  VariationsApprovedTile, ExpenseByCategoryTile,
]

export const COST_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(COST_TILES.map(t => [t.def.id, t]))

export const COST_REGISTRY: TileDef[] = COST_TILES.map(t => t.def)

export const COST_CATEGORIES = ['Earned Value', 'Cashflow', 'Variations', 'Procurement', 'Labour', 'Other Costs']
