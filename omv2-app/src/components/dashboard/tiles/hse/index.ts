import {
  InductionProgressTile,
  HseHoursTile,
  ToolboxTalksTile,
  SafetyObservationsTile,
  IncidentsTile,
  Co2EntriesTile,
  PeopleInductedTile,
  DaysSinceIncidentTile,
  InductionsOverdueTile,
  HseComplianceTile,
} from './HseTiles'
import type { TileComponent, TileDef } from '../../../../types/dashboard'

export const HSE_TILES: TileComponent[] = [
  InductionProgressTile,
  HseHoursTile,
  ToolboxTalksTile,
  SafetyObservationsTile,
  IncidentsTile,
  Co2EntriesTile,
  PeopleInductedTile,
  DaysSinceIncidentTile,
  InductionsOverdueTile,
  HseComplianceTile,
]

export const HSE_TILE_MAP: Record<string, TileComponent> =
  Object.fromEntries(HSE_TILES.map(t => [t.def.id, t]))

export const HSE_REGISTRY: TileDef[] = HSE_TILES.map(t => t.def)

export const HSE_CATEGORIES = ['Safety', 'Activity', 'Environmental']
