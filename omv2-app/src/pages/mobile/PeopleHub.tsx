import { useAppStore } from '../../store/appStore'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'

interface HubItem {
  panel: string
  icon: string
  label: string
  description: string
}

const ITEMS: HubItem[] = [
  { panel: 'hr-resources',     icon: '👤', label: 'Resources',     description: 'Names, roles, mob in/out dates' },
  { panel: 'hr-accommodation', icon: '🏨', label: 'Accommodation', description: 'Hotel bookings and occupants' },
  { panel: 'hr-cars',          icon: '🚗', label: 'Cars',          description: 'Vehicle hires and handovers' },
  { panel: 'hr-inductions',    icon: '📋', label: 'Inductions',    description: 'Gate-check certifications' },
]

/**
 * Mobile-only landing page for the "People" bottom tab. Without this the
 * People tap would either dead-end at a missing dashboard or have to pick
 * one panel as default (no obvious choice). A hub page lets the user pick.
 *
 * Lives outside PanelRouter to keep desktop unaffected — only reachable
 * via the mobile bottom tab.
 */
export function PeopleHub() {
  const { setActivePanel } = useAppStore()

  return (
    <>
      <MobilePanelHeader title="People" subtitle="Personnel management" />
      <div className="mobile-hub-list">
        {ITEMS.map(item => (
          <button
            key={item.panel}
            type="button"
            className="mobile-hub-item"
            onClick={() => setActivePanel(item.panel)}
          >
            <div className="mobile-hub-item-icon">{item.icon}</div>
            <div className="mobile-hub-item-text">
              <div className="mobile-hub-item-label">{item.label}</div>
              <div className="mobile-hub-item-desc">{item.description}</div>
            </div>
            <div className="mobile-hub-item-chevron">›</div>
          </button>
        ))}
      </div>
    </>
  )
}
