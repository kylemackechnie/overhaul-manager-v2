/**
 * tileRegistry.ts
 *
 * Master list of all available dashboard tiles.
 * Each tile has a stable `id`, display metadata, and the default size/visibility.
 * The user's dashboard_layout pref is a sorted list of {id, visible, size} overrides.
 *
 * To add a new tile: add an entry here + handle the id in DashboardPanel.
 */

export interface TileDef {
  id: string
  icon: string
  title: string
  description: string           // shown in widget picker
  category: string              // groups tiles in the picker
  defaultSize: 'normal' | 'wide'
  defaultVisible: boolean
}

export const TILE_REGISTRY: TileDef[] = [
  // ── Project ──────────────────────────────────────────────────────────────────
  {
    id: 'lookahead',
    icon: '📅',
    title: '7-Day Lookahead',
    description: 'Upcoming arrivals, departures, hire on/off, and bookings',
    category: 'Project',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'forecast-snapshot',
    icon: '📈',
    title: 'Forecast Snapshot',
    description: 'Next 5 weeks of cost, sell, headcount and margin',
    category: 'Project',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'project-status',
    icon: '🗓',
    title: 'Project Status',
    description: 'Outage day counter, start/end dates, project WBS',
    category: 'Project',
    defaultSize: 'normal',
    defaultVisible: false,
  },

  // ── People ───────────────────────────────────────────────────────────────────
  {
    id: 'personnel',
    icon: '👥',
    title: 'Personnel',
    description: 'Resources, timesheets, cars and accommodation',
    category: 'People',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'cars',
    icon: '🚗',
    title: 'Cars',
    description: 'Car hire bookings and costs',
    category: 'People',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'accommodation',
    icon: '🏨',
    title: 'Accommodation',
    description: 'Room bookings and occupants',
    category: 'People',
    defaultSize: 'normal',
    defaultVisible: true,
  },

  // ── Finance ──────────────────────────────────────────────────────────────────
  {
    id: 'procurement',
    icon: '🧾',
    title: 'Procurement',
    description: 'Purchase orders, invoices and vendor payments',
    category: 'Finance',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'variations',
    icon: '🔀',
    title: 'Variations',
    description: 'Scope changes, cost lines and client approvals',
    category: 'Finance',
    defaultSize: 'normal',
    defaultVisible: true,
  },

  // ── Field ────────────────────────────────────────────────────────────────────
  {
    id: 'spare-parts',
    icon: '📦',
    title: 'Spare Parts',
    description: 'WOSIT export, receiving, inventory and kit issuing',
    category: 'Field',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'work-orders',
    icon: '🔩',
    title: 'Work Orders',
    description: 'WO tracking and actuals allocation',
    category: 'Field',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'hire',
    icon: '🚜',
    title: 'Equipment Hire',
    description: 'Dry, wet and local hire — rates, calendars and costs',
    category: 'Field',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'tooling',
    icon: '🔧',
    title: 'SE Rental Tooling',
    description: 'TV register, packages, costing and project splits',
    category: 'Field',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'subcontractors',
    icon: '🏗',
    title: 'Subcontractors',
    description: 'RFQs, contracts and subcon timesheets',
    category: 'Field',
    defaultSize: 'normal',
    defaultVisible: true,
  },
  {
    id: 'logistics',
    icon: '🚢',
    title: 'Logistics',
    description: 'Import and export shipments tracking',
    category: 'Field',
    defaultSize: 'normal',
    defaultVisible: true,
  },

  // ── Commercial ───────────────────────────────────────────────────────────────
  {
    id: 'hardware',
    icon: '💰',
    title: 'Hardware Pricing',
    description: 'Contract lines, escalation and customer offers',
    category: 'Commercial',
    defaultSize: 'normal',
    defaultVisible: true,
  },
]

/** All category names in display order */
export const TILE_CATEGORIES = ['Project', 'People', 'Finance', 'Field', 'Commercial']

/** Default layout — all defaultVisible tiles in registry order */
export function getDefaultLayout() {
  return TILE_REGISTRY.map((t, i) => ({
    id: t.id,
    visible: t.defaultVisible,
    order: i,
    size: t.defaultSize,
  }))
}

/** Merge a saved layout with the current registry.
 *  New tiles added to the registry appear at the end, hidden by default.
 *  Tiles removed from the registry are silently dropped. */
export function mergeLayout(
  saved: { id: string; visible: boolean; order: number; size: 'normal' | 'wide' }[]
) {
  const knownIds = new Set(TILE_REGISTRY.map(t => t.id))
  const maxOrder = saved.reduce((m, t) => Math.max(m, t.order), -1)

  // Keep saved entries that still exist in the registry
  const merged = saved.filter(t => knownIds.has(t.id))

  // Append new registry tiles that aren't in saved yet
  const savedIds = new Set(saved.map(t => t.id))
  let nextOrder = maxOrder + 1
  for (const tile of TILE_REGISTRY) {
    if (!savedIds.has(tile.id)) {
      merged.push({ id: tile.id, visible: false, order: nextOrder++, size: tile.defaultSize })
    }
  }

  return merged.sort((a, b) => a.order - b.order)
}
