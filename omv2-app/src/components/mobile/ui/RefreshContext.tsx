import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Pull-to-refresh registration context.
 *
 * Architecture:
 * - MobileShell owns the single scrollable container (.mobile-content) and
 *   the gesture listeners + visual indicator.
 * - Each panel that has refreshable data calls useRegisterRefresh(load),
 *   which registers its loader. When the user pulls and releases, the
 *   shell calls the currently-registered loader and awaits its result.
 * - Panels without registered handlers fall back to a no-op (the spinner
 *   still appears briefly but nothing reloads — keeps the gesture from
 *   feeling broken on hub pages or unfinished panels).
 *
 * Only one handler is active at a time — when a panel mounts it overwrites
 * the previous handler, and the cleanup function clears it when unmounted.
 * That avoids having to coordinate across multiple panels that might be
 * mounted at once (shouldn't happen but defensive).
 */

type RefreshHandler = () => Promise<void> | void

interface Ctx {
  setHandler: (fn: RefreshHandler | null) => void
}

export const RefreshContext = createContext<Ctx | null>(null)

/**
 * Hook for panels to register a refresh handler. Pass the function that
 * reloads your data (your existing `load()` is fine — it just has to
 * trigger a re-fetch).
 *
 * Usage:
 *   useRegisterRefresh(load)
 *
 * Returns nothing — fire-and-forget.
 */
export function useRegisterRefresh(handler: RefreshHandler) {
  const ctx = useContext(RefreshContext)
  // Stash latest handler in a ref so we don't re-register on every render
  // (which would require devs to pass useCallback-stable refs)
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!ctx) return
    const fn = () => ref.current()
    ctx.setHandler(fn)
    return () => ctx.setHandler(null)
  }, [ctx])
}
