import { useAppStore } from '../../store/appStore'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'

interface HubItem {
  panel: string
  icon: string
  label: string
  description: string
}

const ITEMS: HubItem[] = [
  { panel: 'parts-receiving', icon: '📥', label: 'Receive parts', description: 'Scan or type material # to receive' },
  { panel: 'parts-issue',     icon: '📤', label: 'Issue parts',   description: 'Issue stock to a work order' },
]

/**
 * Mobile-only landing page for the "Parts" bottom tab. Same pattern as
 * PeopleHub — lets the user pick between the two parts flows without
 * having to default to one.
 */
export function PartsHub() {
  const { setActivePanel } = useAppStore()

  return (
    <>
      <MobilePanelHeader title="Parts" subtitle="Spare parts management" />
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
