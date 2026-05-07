import { useAppStore } from '../../store/appStore'
import { useAuth } from '../../hooks/useAuth'

interface Props {
  onOpenPicker: () => void
  onOpenSearch: () => void
  onOpenProfile: () => void
}

/**
 * Mobile sticky top bar.
 * Layout: [Project pill ............................. 🔍] [👤]
 * Project pill: shows active project name, tap → project picker
 * Search icon: opens CommandPalette
 * Avatar: opens profile/sign out menu
 */
export function MobileTopBar({ onOpenPicker, onOpenSearch, onOpenProfile }: Props) {
  const { activeProject } = useAppStore()
  const { currentUser } = useAuth()
  const email = currentUser?.email || ''
  const initial = email.charAt(0).toUpperCase() || '?'

  return (
    <div className="mobile-topbar">
      <button
        className="mobile-topbar-project"
        onClick={onOpenPicker}
        aria-label="Switch project"
      >
        <span className="mobile-topbar-logo">⚙️</span>
        <span className="mobile-topbar-project-name">
          {activeProject?.name || 'Select project'}
        </span>
        <span className="mobile-topbar-chevron">▾</span>
      </button>
      <button
        className="mobile-topbar-icon"
        onClick={onOpenSearch}
        aria-label="Search"
      >
        🔍
      </button>
      <button
        className="mobile-topbar-avatar"
        onClick={onOpenProfile}
        aria-label="Profile"
      >
        {initial}
      </button>
    </div>
  )
}
