import { useAppStore } from '../../store/appStore'

interface Tab {
  id: string
  icon: string
  label: string
  /** Default panel to navigate to when tapped */
  defaultPanel: string
  /** Match these panels to highlight this tab as active */
  matchPanels: string[]
}

const TABS: Tab[] = [
  {
    id: 'dashboard',
    icon: '🏠',
    label: 'Home',
    defaultPanel: 'dashboard',
    // Home also covers project-level admin / profile pages
    matchPanels: ['dashboard', 'profile', 'project-settings', 'help'],
  },
  {
    id: 'people',
    icon: '👥',
    label: 'People',
    defaultPanel: 'mobile-people-hub',
    // Highlight when on the hub OR any sub-panel
    matchPanels: ['mobile-people-hub', 'hr-resources', 'hr-accommodation', 'hr-cars', 'hr-inductions'],
  },
  {
    id: 'expenses',
    icon: '🧾',
    label: 'Expenses',
    defaultPanel: 'expenses',
    matchPanels: ['expenses'],
  },
  {
    id: 'parts',
    icon: '📦',
    label: 'Parts',
    defaultPanel: 'mobile-parts-hub',
    matchPanels: ['mobile-parts-hub', 'parts-issue', 'parts-receiving'],
  },
  {
    id: 'more',
    icon: '☰',
    label: 'More',
    defaultPanel: '__more__',
    matchPanels: [],
  },
]

interface Props {
  onMoreOpen: () => void
}

export function MobileBottomTabs({ onMoreOpen }: Props) {
  const { activePanel, setActivePanel } = useAppStore()

  function handleTap(tab: Tab) {
    if (tab.id === 'more') {
      onMoreOpen()
      return
    }
    setActivePanel(tab.defaultPanel)
  }

  return (
    <nav className="mobile-bottomtabs" aria-label="Main navigation">
      {TABS.map(tab => {
        const isActive = tab.matchPanels.includes(activePanel ?? '')
        return (
          <button
            key={tab.id}
            className={`mobile-bottomtab ${isActive ? 'mobile-bottomtab-active' : ''}`}
            onClick={() => handleTap(tab)}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="mobile-bottomtab-icon">{tab.icon}</span>
            <span className="mobile-bottomtab-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
