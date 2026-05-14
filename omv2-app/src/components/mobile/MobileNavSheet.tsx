import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { usePermissions, type Module } from '../../lib/permissions'
import { setMobileOverride } from '../../hooks/useIsMobile'
import { MOBILE_OPTIMISED } from '../../lib/mobilePanels'

interface NavItem {
  panel: string
  icon: string
  label: string
}

interface NavSection {
  key: string
  label: string
  module?: Module
  items: NavItem[]
}

/**
 * Full module list for the mobile More sheet.
 * Mirrors the desktop ribbon but flattened — one level instead of two.
 * People/Site/Cost are still in the bottom tab bar but their items are
 * also listed here for completeness.
 */
const SECTIONS: NavSection[] = [
  {
    key: 'project',
    label: 'Project',
    items: [
      { panel: 'dashboard',         icon: '📊', label: 'Dashboard' },
      { panel: 'calendar',          icon: '📅', label: 'Calendar' },
      { panel: 'gantt',             icon: '📋', label: 'Gantt' },
      { panel: 'project-settings',  icon: '⚙️', label: 'Settings' },
      { panel: 'public-holidays',   icon: '🗓️', label: 'Holidays' },
      { panel: 'wbs-list',          icon: '📍', label: 'WBS' },
      { panel: 'help',              icon: '❓', label: 'Help' },
    ],
  },
  {
    key: 'hardware',
    label: 'Hardware / Tooling / Hire',
    module: 'hardware',
    items: [
      { panel: 'hardware-dashboard', icon: '💰', label: 'Hardware Dashboard' },
      { panel: 'hardware-contract',  icon: '📃', label: 'Contracts' },
      { panel: 'hardware-carts',     icon: '🛒', label: 'Carts & Offers' },
      { panel: 'tooling-dashboard',  icon: '🔩', label: 'Tooling Dashboard' },
      { panel: 'tooling-tvs',        icon: '🧰', label: 'TV Register' },
      { panel: 'tooling-kollos',     icon: '📦', label: 'Kollos' },
      { panel: 'hire-dashboard',     icon: '📊', label: 'Hire Dashboard' },
      { panel: 'hire-dry',           icon: '🚜', label: 'Dry Hire' },
      { panel: 'hire-wet',           icon: '🏗️', label: 'Wet Hire' },
      { panel: 'hire-local',         icon: '🧰', label: 'SEA Local Tooling' },
    ],
  },
  {
    key: 'people',
    label: 'Personnel',
    module: 'personnel',
    items: [
      { panel: 'hr-dashboard',          icon: '👥', label: 'HR Dashboard' },
      { panel: 'hr-resources',          icon: '👤', label: 'Resources' },
      { panel: 'hr-ratecards',          icon: '💲', label: 'Rate Cards' },
      { panel: 'hr-timesheets-trades',  icon: '⏱️', label: 'Timesheets — Trades' },
      { panel: 'hr-timesheets-mgmt',    icon: '⏱️', label: 'Timesheets — Mgmt' },
      { panel: 'hr-timesheets-seag',    icon: '⏱️', label: 'Timesheets — SE AG' },
      { panel: 'hr-timesheets-subcon',  icon: '⏱️', label: 'Timesheets — Subcon' },
      { panel: 'hr-cars',               icon: '🚗', label: 'Cars' },
      { panel: 'hr-accommodation',      icon: '🏨', label: 'Accommodation' },
      { panel: 'hr-backoffice',         icon: '🏢', label: 'Back Office' },
      { panel: 'hr-utilisation',        icon: '📊', label: 'Utilisation' },
    ],
  },
  {
    key: 'site',
    label: 'Site Specific',
    module: 'site_specific',
    items: [
      { panel: 'site-dashboard',     icon: '🏭', label: 'Site Dashboard' },
      { panel: 'nrg-reports',        icon: '📑', label: 'NRG Reports' },
      { panel: 'parts-list',         icon: '🔩', label: 'Parts List' },
      { panel: 'parts-receiving',    icon: '📬', label: 'Receiving' },
      { panel: 'parts-issue',        icon: '📋', label: 'Issue Parts' },
      { panel: 'parts-search',       icon: '🔍', label: 'Parts Search' },
      { panel: 'parts-inventory',    icon: '🗄️', label: 'Inventory' },
      { panel: 'work-orders',        icon: '📋', label: 'Work Orders' },
      { panel: 'wo-actuals',         icon: '⏱', label: 'WO Actuals' },
      { panel: 'wo-progress',        icon: '📊', label: 'WO Progress' },
      { panel: 'nrg-dashboard',      icon: '📊', label: 'NRG Dashboard' },
      { panel: 'nrg-tce',            icon: '📋', label: 'NRG TCE' },
    ],
  },
  {
    key: 'cost',
    label: 'Cost Tracking',
    module: 'cost_tracking',
    items: [
      { panel: 'cost-dashboard',  icon: '💰', label: 'Cost Dashboard' },
      { panel: 'expenses',        icon: '🧾', label: 'Expenses' },
      { panel: 'purchase-orders', icon: '📄', label: 'Purchase Orders' },
      { panel: 'invoices',        icon: '💳', label: 'Invoices' },
      { panel: 'variations',      icon: '📝', label: 'Variations' },
      { panel: 'sap-recon',       icon: '🔄', label: 'SAP Recon' },
      { panel: 'cost-forecast',   icon: '📈', label: 'Forecast' },
      { panel: 'cost-scurve',     icon: '📉', label: 'S-Curve' },
      { panel: 'cost-mika',       icon: '📊', label: 'MIKA' },
    ],
  },
  {
    key: 'subcon',
    label: 'Subcontractors',
    module: 'subcontractors',
    items: [
      { panel: 'subcon-dashboard',     icon: '🏢', label: 'Dashboard' },
      { panel: 'subcon-rfq-doc',       icon: '📝', label: 'RFQ Document' },
      { panel: 'subcon-rfq-register',  icon: '📊', label: 'RFQ Register' },
    ],
  },
  {
    key: 'hse',
    label: 'HSE',
    module: 'hse',
    items: [
      { panel: 'hse-dashboard',  icon: '🦺', label: 'HSE Dashboard' },
      { panel: 'hr-inductions',  icon: '📋', label: 'Inductions' },
      { panel: 'hse-hours',      icon: '⏱️', label: 'HSE Hours' },
    ],
  },
  {
    key: 'logistics',
    label: 'Logistics',
    module: 'logistics',
    items: [
      { panel: 'shipping-dashboard', icon: '🚢', label: 'Shipping Dashboard' },
      { panel: 'shipping-inbound',   icon: '📦', label: 'Inbound' },
      { panel: 'shipping-outbound',  icon: '🚚', label: 'Outbound' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    items: [
      { panel: 'profile',          icon: '👤', label: 'Profile' },
      { panel: 'user-management',  icon: '👥', label: 'User Management' },
      { panel: 'audit-trail',      icon: '📋', label: 'Audit Trail' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
  onSignOut: () => void
}

export function MobileNavSheet({ open, onClose, onSignOut }: Props) {
  const { setActivePanel } = useAppStore()
  const { canRead } = usePermissions()
  // When false (default), only show mobile-ready panels in each section.
  // When true, show every panel — useful for occasional desktop-only lookups
  // (the soft-block will still appear if they tap one).
  const [showAll, setShowAll] = useState(false)

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  function navTo(panel: string) {
    setActivePanel(panel)
    onClose()
  }

  return (
    <div className="mobile-sheet-overlay" onClick={onClose}>
      <div
        className="mobile-sheet mobile-sheet-fullheight"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Navigation menu"
      >
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-header">
          <h2>All modules</h2>
          <button
            className="mobile-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >✕</button>
        </div>

        {/* Filter toggle — phone-ready vs all panels */}
        <div className="mobile-nav-filter">
          <button
            className={`mobile-nav-filter-btn ${!showAll ? 'mobile-nav-filter-btn-active' : ''}`}
            onClick={() => setShowAll(false)}
          >
            📱 Phone-ready
          </button>
          <button
            className={`mobile-nav-filter-btn ${showAll ? 'mobile-nav-filter-btn-active' : ''}`}
            onClick={() => setShowAll(true)}
          >
            All panels
          </button>
        </div>

        <div className="mobile-sheet-body">
          {SECTIONS.map(section => {
            // Permission gate: hide whole section if user can't read
            if (section.module && !canRead(section.module)) return null
            // Mobile-readiness filter: hide items not in MOBILE_OPTIMISED
            // unless the user opted into showing all panels.
            const visibleItems = showAll
              ? section.items
              : section.items.filter(item => MOBILE_OPTIMISED.has(item.panel))
            // If the section has no visible items after filtering, hide it.
            if (visibleItems.length === 0) return null
            return (
              <div key={section.key} className="mobile-nav-section">
                <h3 className="mobile-nav-section-label">{section.label}</h3>
                <div className="mobile-nav-grid">
                  {visibleItems.map(item => (
                    <button
                      key={item.panel}
                      className="mobile-nav-item"
                      onClick={() => navTo(item.panel)}
                    >
                      <span className="mobile-nav-item-icon">{item.icon}</span>
                      <span className="mobile-nav-item-label">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="mobile-nav-section">
            <button
              className="mobile-nav-item"
              onClick={() => { onClose(); setMobileOverride('desktop') }}
              style={{ width: '100%' }}
              title="Force desktop view. Tap again from desktop menu to return to auto-detect."
            >
              <span className="mobile-nav-item-icon">🖥️</span>
              <span className="mobile-nav-item-label">Switch to desktop view</span>
            </button>
            <button
              className="mobile-nav-signout"
              onClick={() => { onClose(); onSignOut() }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
