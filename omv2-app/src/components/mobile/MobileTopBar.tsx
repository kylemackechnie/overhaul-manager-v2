import { useAppStore } from '../../store/appStore'

interface Props {
  onOpenPicker: () => void
}

/**
 * Mobile sticky top bar — single-purpose, just shows the active project
 * and lets the user switch projects.
 *
 * Search and profile/sign-out moved to the More sheet (search at top,
 * profile + project picker mirror at bottom). Decluttering the topbar
 * gives more vertical space to panel content on small phones.
 */
export function MobileTopBar({ onOpenPicker }: Props) {
  const { activeProject } = useAppStore()

  return (
    <div className="mobile-topbar">
      <button
        className="mobile-topbar-project mobile-topbar-project-wide"
        onClick={onOpenPicker}
        aria-label="Switch project"
      >
        <span className="mobile-topbar-logo">⚙️</span>
        <span className="mobile-topbar-project-name">
          {activeProject?.name || 'Select project'}
        </span>
        <span className="mobile-topbar-chevron">▾</span>
      </button>
    </div>
  )
}
