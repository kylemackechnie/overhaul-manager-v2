import { useEffect, useState } from 'react'

/**
 * Detects whether to render the mobile layout.
 *
 * **Detection strategy** — combines THREE signals to avoid false positives:
 *
 * 1. Viewport ≤ 900px
 * 2. Primary pointer is coarse (finger/stylus, not mouse)
 * 3. Device cannot hover
 *
 * All three must be true. This means a desktop user with a narrow window
 * (or DevTools open) does NOT get the mobile shell — that was the original
 * bug. Touch laptops with mouse + touchscreen also get desktop, which is
 * correct: if you have a keyboard and mouse, you don't want phone UI.
 *
 * **Override system** — three layers, in order of precedence:
 *
 * 1. URL param `?mobile=1` or `?mobile=0` — one-off testing, no persistence
 * 2. localStorage `om-mobile-override` set to 'mobile' or 'desktop' — sticky
 * 3. Auto-detection (default)
 *
 * Set the override programmatically with setMobileOverride() — used by a
 * dev toggle in the user menu (added in a follow-up).
 */

const OVERRIDE_KEY = 'om-mobile-override'

type Override = 'mobile' | 'desktop' | null

function readUrlOverride(): Override {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('mobile')
    if (v === '1' || v === 'true') return 'mobile'
    if (v === '0' || v === 'false') return 'desktop'
  } catch { /* malformed URL — ignore */ }
  return null
}

function readStorageOverride(): Override {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(OVERRIDE_KEY)
    if (v === 'mobile' || v === 'desktop') return v
  } catch { /* localStorage blocked — ignore */ }
  return null
}

function detectAuto(maxWidth: number): boolean {
  if (typeof window === 'undefined') return false
  // Combined query: only mobile if narrow AND coarse pointer AND no hover.
  // This is what distinguishes a phone from a desktop with a narrow window.
  const query = `(max-width: ${maxWidth}px) and (pointer: coarse) and (hover: none)`
  return window.matchMedia(query).matches
}

function compute(maxWidth: number): boolean {
  // URL param wins — useful for sharing test links
  const urlOv = readUrlOverride()
  if (urlOv) return urlOv === 'mobile'
  // Then sticky localStorage
  const storeOv = readStorageOverride()
  if (storeOv) return storeOv === 'mobile'
  // Otherwise detect
  return detectAuto(maxWidth)
}

/**
 * Programmatic override. Pass null to clear and return to auto-detection.
 * Triggers a re-render of all components using useIsMobile via a custom
 * event (because storage events don't fire in the same tab).
 */
export function setMobileOverride(value: Override) {
  if (typeof window === 'undefined') return
  try {
    if (value === null) {
      localStorage.removeItem(OVERRIDE_KEY)
    } else {
      localStorage.setItem(OVERRIDE_KEY, value)
    }
    window.dispatchEvent(new CustomEvent('om-mobile-override-change'))
  } catch { /* localStorage blocked — silently no-op */ }
}

/** Read current override (for UI display in a settings toggle). */
export function getMobileOverride(): Override {
  return readStorageOverride()
}

/**
 * Hook — returns true when the mobile layout should render.
 *
 * Re-evaluates on:
 * - Viewport changes (resize, orientation)
 * - Pointer capability changes (rare — e.g. user docks tablet)
 * - Override changes (custom event from setMobileOverride)
 */
export function useIsMobile(maxWidth: number = 900): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => compute(maxWidth))

  useEffect(() => {
    if (typeof window === 'undefined') return

    const recompute = () => setIsMobile(compute(maxWidth))

    // Listen to all three media queries, since any could flip independently.
    // Width changes most often (resize); pointer/hover almost never change
    // mid-session but we listen anyway for cases like a user plugging in
    // a Bluetooth mouse on a tablet.
    const queries = [
      window.matchMedia(`(max-width: ${maxWidth}px)`),
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(hover: none)'),
    ]
    queries.forEach(q => q.addEventListener('change', recompute))

    // Override changes (programmatic)
    window.addEventListener('om-mobile-override-change', recompute)

    // Initial sync — in case the SSR initial state mismatched
    recompute()

    return () => {
      queries.forEach(q => q.removeEventListener('change', recompute))
      window.removeEventListener('om-mobile-override-change', recompute)
    }
  }, [maxWidth])

  return isMobile
}
