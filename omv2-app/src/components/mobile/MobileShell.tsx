import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MobileBottomTabs } from './MobileBottomTabs'
import { MobileNavSheet } from './MobileNavSheet'
import { RefreshContext } from './ui/RefreshContext'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Props {
  /** Main content area (the active panel) */
  children: ReactNode
  onOpenPicker: () => void
  onOpenSearch: () => void
}

const PTR_THRESHOLD = 70  // px the user must pull before release triggers refresh

type PtrPhase =
  | { phase: 'idle' }
  | { phase: 'pulling'; dist: number }
  | { phase: 'refreshing' }

/**
 * Top-level mobile chrome:
 *   ┌──────────────────────────┐
 *   │                          │
 *   │  Panel content           │  ← scrollable, with pull-to-refresh
 *   │  (scrollable)            │     gesture handled here
 *   │                          │
 *   ├──────────────────────────┤
 *   │  Bottom tab bar (fixed)  │
 *   └──────────────────────────┘
 *
 * No persistent top bar — each panel renders its own MobilePanelHeader.
 *
 * Pull-to-refresh is implemented here (not as a per-panel wrapper) so the
 * gesture stays attached to the single scrollable container. Panels opt
 * in by calling useRegisterRefresh(load) — see RefreshContext.tsx.
 */
export function MobileShell({ children, onOpenPicker, onOpenSearch }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const { setActivePanel } = useAppStore()

  // Pull-to-refresh state
  const contentRef = useRef<HTMLElement>(null)
  const startY = useRef<number | null>(null)
  const [ptr, setPtr] = useState<PtrPhase>({ phase: 'idle' })
  // Handler ref — updated when panels register/unregister
  const refreshHandler = useRef<(() => Promise<void> | void) | null>(null)
  // Stable setHandler so the Provider value doesn't change every render
  // (which would otherwise re-fire panel registration effects unnecessarily)
  const setHandlerRef = useRef((fn: (() => Promise<void> | void) | null) => {
    refreshHandler.current = fn
  })
  const refreshCtxValue = useRef({ setHandler: setHandlerRef.current }).current
  // Keep latest PTR state in a ref so touchend's closure reads it without
  // re-binding listeners on every render
  const ptrRef = useRef(ptr)
  ptrRef.current = ptr

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      // Only start a pull if the user touches at the top of the scroll
      if (!el || el.scrollTop > 0) {
        startY.current = null
        return
      }
      // Don't engage if the touch starts inside an open sheet or modal —
      // sheets have their own drag-handle for dismissal, and pulling down
      // on a sheet must not also trigger a refresh of the underlying panel.
      const target = e.target as HTMLElement | null
      if (target?.closest('.mobile-sheet-backdrop, .mobile-sheet-overlay, .modal-overlay, .mobile-scanner-overlay')) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) {
        // Upward — user is scrolling, not pulling. Cancel.
        setPtr({ phase: 'idle' })
        return
      }
      // Resistance: 1/2 mapping, capped at 1.6x threshold to keep it visible
      const dist = Math.min(dy * 0.5, PTR_THRESHOLD * 1.6)
      setPtr({ phase: 'pulling', dist })
      // Block default scroll only once clearly in pull territory
      if (dist > 6 && e.cancelable) {
        e.preventDefault()
      }
    }

    async function onTouchEnd() {
      const s = ptrRef.current
      startY.current = null
      if (s.phase === 'pulling' && s.dist >= PTR_THRESHOLD) {
        setPtr({ phase: 'refreshing' })
        try {
          if (refreshHandler.current) {
            await Promise.resolve(refreshHandler.current())
          } else {
            // Panel didn't register a handler — show the spinner briefly so
            // the gesture doesn't feel broken, but do nothing.
            await new Promise(r => setTimeout(r, 300))
          }
        } finally {
          // Hold the spinner a beat so it feels deliberate even on fast loads
          setTimeout(() => setPtr({ phase: 'idle' }), 300)
        }
      } else {
        setPtr({ phase: 'idle' })
      }
    }

    el.addEventListener('touchstart',  onTouchStart, { passive: true })
    el.addEventListener('touchmove',   onTouchMove,  { passive: false })
    el.addEventListener('touchend',    onTouchEnd,   { passive: true })
    el.addEventListener('touchcancel', onTouchEnd,   { passive: true })

    return () => {
      el.removeEventListener('touchstart',  onTouchStart)
      el.removeEventListener('touchmove',   onTouchMove)
      el.removeEventListener('touchend',    onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  // Visual derivation
  const refreshing = ptr.phase === 'refreshing'
  const pullDist   = ptr.phase === 'pulling' ? ptr.dist : 0
  const yOffset    = refreshing ? PTR_THRESHOLD : pullDist
  const armed      = pullDist >= PTR_THRESHOLD
  const progress   = Math.min(pullDist / PTR_THRESHOLD, 1)
  const ptrVisible = pullDist > 0 || refreshing

  function openProfile() {
    setActivePanel('profile')
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="mobile-shell">
      <main ref={contentRef} className="mobile-content">
        {/* Pull-to-refresh indicator. Sits absolute at the very top, slides
            down with the pull, fades in by progress. */}
        {ptrVisible && (
          <div
            className={`mobile-ptr-indicator ${refreshing ? 'mobile-ptr-spinning' : ''}`}
            style={{
              transform: `translate(-50%, ${Math.max(yOffset - PTR_THRESHOLD + 8, -32)}px)`,
              opacity: Math.min(progress * 1.4, 1),
            }}
            aria-live="polite"
          >
            {refreshing ? (
              <>
                <span className="mobile-ptr-spinner" aria-label="Refreshing" />
                <span className="mobile-ptr-label">Refreshing…</span>
              </>
            ) : (
              <>
                <span
                  className="mobile-ptr-arrow"
                  style={{ transform: `rotate(${armed ? 180 : 0}deg)` }}
                  aria-hidden="true"
                >
                  ↓
                </span>
                <span className="mobile-ptr-label">
                  {armed ? 'Release to refresh' : 'Pull to refresh'}
                </span>
              </>
            )}
          </div>
        )}
        {/* Content stays stationary; only the indicator animates. Wrapping
            content in a transform created a containing block that broke
            position:fixed for descendant overlays (MobileBottomSheet). */}
        <RefreshContext.Provider value={refreshCtxValue}>
          {children}
        </RefreshContext.Provider>
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
