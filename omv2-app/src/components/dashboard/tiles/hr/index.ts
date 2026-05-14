import { LabourSCurveTile } from './SCurveTile'
import { MobDemobStripTile } from './MobDemobStripTile'
import { MobReadinessTile } from './MobReadinessTile'
import { ProductivityIndexTile } from '../ExtraTiles'
import {
  TotalPeopleTile, OnSiteNowTile, Incoming7dTile, HoursToDateTile, LabourSellToDateTile,
  TradesHeadcountTile, MgmtHeadcountTile, SeagHeadcountTile, SubconHeadcountTile,
  TradesTimesheetsTile, MgmtTimesheetsTile,
  CarsBookingsTile, AccomRoomsTile,
  AllowanceBreakdownTile, SubconWithoutPOTile, ResourcesNoRateCardTile,
  HRInductionsOverdueTile, UtilisationTile, DraftTimesheetsTile,
} from './hr-tiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const HR_TILES: TileComponent[] = [
  // ─── Hero — actionable readiness (NEW, default visible) ─────────────────
  MobReadinessTile,
  // ─── Top KPIs ───────────────────────────────────────────────────────────
  TotalPeopleTile, OnSiteNowTile, Incoming7dTile, HoursToDateTile, LabourSellToDateTile,
  // ─── Productivity (NEW) ─────────────────────────────────────────────────
  ProductivityIndexTile,
  // S-curve (wide tile)
  LabourSCurveTile,
  // Mob/demob strip (wide tile)
  MobDemobStripTile,
  // Category headcounts
  TradesHeadcountTile, MgmtHeadcountTile, SeagHeadcountTile, SubconHeadcountTile,
  // Timesheet summaries
  TradesTimesheetsTile, MgmtTimesheetsTile,
  // Allowances & labour detail
  AllowanceBreakdownTile, DraftTimesheetsTile,
  // Support
  CarsBookingsTile, AccomRoomsTile, UtilisationTile,
  // Alerts
  SubconWithoutPOTile, ResourcesNoRateCardTile, HRInductionsOverdueTile,
]

export const HR_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(HR_TILES.map(t => [t.def.id, t]))

export const HR_REGISTRY: TileDef[] = HR_TILES.map(t => t.def)

export const HR_CATEGORIES = ['Alerts', 'Headcount', 'Labour', 'Support']
