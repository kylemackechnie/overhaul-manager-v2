import type { ReactNode } from 'react'
import { useAppStore } from '../../store/appStore'

interface PanelHeaderProps {
  title: string
  subtitle?: string
  /** Right-side action button (e.g. "+ Add", "Filter") */
  action?: ReactNode
  /** If true, shows a back chevron that returns to module dashboard */
  showBack?: boolean
  /** Override default back behaviour */
  onBack?: () => void
  /** Default panel to navigate to when back is tapped */
  backTo?: string
}

/**
 * Sticky per-panel header. Sits below MobileTopBar.
 * Shows title + optional back chevron + optional right action button.
 */
export function MobilePanelHeader({
  title, subtitle, action, showBack, onBack, backTo,
}: PanelHeaderProps) {
  const { setActivePanel } = useAppStore()

  function handleBack() {
    if (onBack) { onBack(); return }
    if (backTo) { setActivePanel(backTo); return }
    setActivePanel('dashboard')
  }

  return (
    <div className="mobile-panel-header">
      <div className="mobile-panel-header-left">
        {showBack && (
          <button
            className="mobile-panel-header-back"
            onClick={handleBack}
            aria-label="Back"
          >‹</button>
        )}
        <div>
          <h1 className="mobile-panel-header-title">{title}</h1>
          {subtitle && <div className="mobile-panel-header-subtitle">{subtitle}</div>}
        </div>
      </div>
      {action && <div className="mobile-panel-header-action">{action}</div>}
    </div>
  )
}

interface DesktopOnlyProps {
  panelName: string
}

/**
 * Block screen shown when a non-mobile-optimised panel is opened on mobile.
 * Hard-block: user must navigate elsewhere or open desktop.
 */
export function MobileDesktopOnly({ panelName }: DesktopOnlyProps) {
  const { setActivePanel } = useAppStore()

  return (
    <div className="mobile-desktop-only">
      <div className="mobile-desktop-only-icon">🖥️</div>
      <h2>Open on desktop</h2>
      <p>
        <strong>{panelName}</strong> uses dense tables and reports that don't fit
        on a phone screen. Please open Overhaul Manager on your laptop or tablet
        to use this view.
      </p>
      <div className="mobile-desktop-only-actions">
        <button
          className="btn btn-primary"
          onClick={() => setActivePanel('dashboard')}
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
  )
}
