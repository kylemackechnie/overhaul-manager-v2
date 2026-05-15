import { useState, type ReactNode } from 'react'
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
 *   │                          │
 *   │  Panel content           │  ← panel header (set by each panel)
 *   │  (scrollable)            │     handles its own title + back chevron
 *   │                          │
 *   ├──────────────────────────┤
 *   │  Bottom tab bar (fixed)  │
 *   └──────────────────────────┘
 *
 * No persistent top bar — each panel renders its own MobilePanelHeader so
 * vertical space stays maximised. Search, project switching, and the user
 * account live in the More sheet.
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
