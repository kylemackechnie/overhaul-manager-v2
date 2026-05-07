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
    matchPanels: ['dashboard', 'calendar', 'gantt', 'project-settings'],
  },
  {
    id: 'people',
    icon: '👥',
    label: 'People',
    defaultPanel: 'hr-resources',
    matchPanels: ['hr-resources', 'hr-timesheets-trades', 'hr-timesheets-mgmt', 'hr-timesheets-seag', 'hr-timesheets-subcon', 'hr-cars', 'hr-accommodation', 'hr-dashboard', 'hr-ratecards', 'hr-inductions', 'hr-backoffice', 'hr-utilisation'],
  },
  {
    id: 'site',
    icon: '🏗',
    label: 'Site',
    defaultPanel: 'site-dashboard',
    matchPanels: ['site-dashboard', 'parts-list', 'parts-issue', 'parts-receiving', 'parts-search', 'parts-dashboard', 'parts-inventory', 'parts-reports', 'wo-dashboard', 'work-orders', 'wo-actuals', 'wo-progress', 'nrg-dashboard', 'nrg-tce', 'nrg-actuals', 'nrg-invoicing', 'nrg-ohf', 'nrg-kpi'],
  },
  {
    id: 'cost',
    icon: '💰',
    label: 'Cost',
    defaultPanel: 'cost-dashboard',
    matchPanels: ['cost-dashboard', 'purchase-orders', 'invoices', 'expenses', 'variations', 'cost-forecast', 'cost-mika', 'cost-scurve', 'cost-report', 'sap-recon'],
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
        const isActive = tab.matchPanels.includes(activePanel)
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
