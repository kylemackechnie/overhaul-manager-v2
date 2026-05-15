import { useState, type ReactNode } from 'react'
import { MobileTopBar } from './MobileTopBar'
import { MobileBottomTabs } from './MobileBottomTabs'
import { MobileNavSheet } from './MobileNavSheet'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Props {
  /** Main content area (the active panel) */
  children: ReactNode
  onOpenPicker: () => void
  onOpenSearch: () => void
}

/**
 * Top-level mobile chrome:
 *   ┌──────────────────────────┐
 *   │  Top bar (project pill)  │  ← single line, just the active project
 *   ├──────────────────────────┤
 *   │                          │
 *   │  Panel content           │
 *   │  (scrollable)            │
 *   │                          │
 *   ├──────────────────────────┤
 *   │  Bottom tab bar (fixed)  │
 *   └──────────────────────────┘
 *
 * MobileNavSheet slides up from bottom when "More" is tapped, and contains:
 *  - Search at top
 *  - Module panels in middle
 *  - Project picker + user actions at bottom
 *
 * Search and profile were originally in the topbar but moved into the
 * sheet to declutter the visible chrome on small phones.
 */
export function MobileShell({ children, onOpenPicker, onOpenSearch }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const { setActivePanel } = useAppStore()

  function openProfile() {
    setActivePanel('profile')
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="mobile-shell">
      <MobileTopBar onOpenPicker={onOpenPicker} />
      <main className="mobile-content">
        {children}
      </main>
      <MobileBottomTabs onMoreOpen={() => setSheetOpen(true)} />
      <MobileNavSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onOpenSearch={onOpenSearch}
        onOpenPicker={onOpenPicker}
        onOpenProfile={openProfile}
        onSignOut={signOut}
      />
    </div>
  )
}
