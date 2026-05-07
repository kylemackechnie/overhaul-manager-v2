import { useEffect, useState } from 'react'

/**
 * Returns true when viewport is ≤900px wide. SSR-safe (defaults to false).
 * Updates on resize / device rotation.
 *
 * Used by App.tsx to swap shells (Header+Ribbon → MobileShell) and by
 * individual panels to render mobile-optimised layouts.
 */
export function useIsMobile(maxWidth: number = 900): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    // Modern browsers
    mq.addEventListener('change', handler)
    // Initial sync (in case constructor SSR mismatch)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [maxWidth])

  return isMobile
}
