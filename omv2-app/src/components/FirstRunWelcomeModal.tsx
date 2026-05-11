/**
 * FirstRunWelcomeModal
 *
 * Shown ONCE per user on first successful login after this feature ships.
 * Gated by userPrefs.help_first_run_completed.
 *
 * Offers two paths:
 *   - "Take the tour" → kicks off the Getting Started walkthrough
 *   - "Skip" / × / Escape / backdrop click → close, mark complete
 *
 * All paths mark the modal as complete — it never shows again for this user.
 *
 * Mounted in App.tsx near the top of the tree so it shows over whatever
 * panel is active. Self-gating: the component decides if/when to show itself.
 */

import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useUserPrefs } from '../hooks/useUserPrefs'
import { getTour } from '../help/tours/_index'
import { runTour } from '../help/tours/runner'

const WELCOME_TOUR_ID = 'getting-started-tour'

export function FirstRunWelcomeModal() {
  const { prefs, setPref } = useUserPrefs()
  const currentUser = useAppStore(s => s.currentUser)
  const activeProject = useAppStore(s => s.activeProject)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const [visible, setVisible] = useState(false)

  // Decide whether to show. Conditions:
  //   - User is signed in
  //   - User has a project selected (avoid "your active project" pointing at a picker)
  //   - help_first_run_completed is not yet set
  //
  // Wait 2 animation frames before showing so the app finishes mounting first
  // (avoids a flash where the modal renders against a half-loaded background).
  useEffect(() => {
    if (!currentUser || !activeProject) return
    if (prefs.help_first_run_completed) return
    let cancelled = false
    let rafId = 0
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        if (!cancelled) setVisible(true)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [currentUser, activeProject, prefs.help_first_run_completed])

  // Close on Escape (treated as Skip)
  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleSkip()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible) return null

  function markComplete() {
    setPref('help_first_run_completed', true)
    setVisible(false)
  }

  function handleSkip() {
    markComplete()
  }

  function handleTakeTour() {
    markComplete()
    const tour = getTour(WELCOME_TOUR_ID)
    if (tour) {
      // Small delay so the modal unmounts and clears the overlay before the
      // tour overlay paints over the same elements.
      requestAnimationFrame(() => {
        runTour(tour, { setActivePanel })
      })
    }
  }

  const userName = currentUser?.name?.split(' ')[0] ?? 'there'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={handleSkip}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          borderRadius: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          maxWidth: 500,
          width: '100%',
          padding: 28,
          position: 'relative',
        }}
      >
        <button
          onClick={handleSkip}
          aria-label="Close welcome dialog"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            fontSize: 22,
            cursor: 'pointer',
            color: 'var(--text3)',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ fontSize: 36, marginBottom: 8 }}>👋</div>
        <h2 id="welcome-title" style={{
          fontSize: 20,
          fontWeight: 700,
          margin: 0,
          marginBottom: 8,
          color: 'var(--text)',
        }}>
          Welcome to Overhaul Manager, {userName}
        </h2>
        <p style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--text2)',
          margin: 0,
          marginBottom: 20,
        }}>
          New here? A 90-second interactive tour will show you the ribbon, the
          File menu, project switching, and where to find help. You can take it
          now or skip and come back to it any time from the Help button.
        </p>

        <div style={{
          display: 'flex',
          gap: 10,
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}>
          <button
            className="btn"
            onClick={handleSkip}
          >
            Skip for now
          </button>
          <button
            className="btn btn-primary"
            onClick={handleTakeTour}
          >
            ▶ Take the tour
          </button>
        </div>

        <div style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text3)',
          textAlign: 'center',
        }}>
          You won't see this again. Help is always available from the ❓ button in the title bar.
        </div>
      </div>
    </div>
  )
}
