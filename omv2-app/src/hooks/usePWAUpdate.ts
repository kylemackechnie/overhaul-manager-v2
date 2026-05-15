import { useEffect, useState } from 'react'
// vite-plugin-pwa virtual module — provides registerSW with update callbacks.
// The plugin generates this at build time; in dev with PWA disabled it's a no-op.
// @ts-expect-error — virtual module, no static types
import { registerSW } from 'virtual:pwa-register'

/** How often to check for SW updates while the app is open. iOS PWAs stay
 *  in memory for days, so without this they only check on cold launch.
 *  10 minutes is a reasonable compromise between freshness and battery. */
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000

/**
 * Registers the service worker and exposes:
 * - needRefresh: true when a new SW is waiting (a new build was deployed)
 * - offlineReady: true once the SW has cached the shell (first install)
 * - updateApp(): triggers SW skipWaiting + reload to apply the new version
 *
 * Auto-update behaviour:
 * - Polls for new SWs every UPDATE_CHECK_INTERVAL_MS while the page is open
 * - Triggers a check on visibilitychange (returning to the PWA after switching
 *   to another app), so users get fresh code as soon as they come back
 *
 * Doesn't auto-reload — the user decides when to refresh, so they don't lose
 * unsaved form data mid-edit. The update toast surfaces the choice.
 */
export function usePWAUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [updateApp, setUpdateApp] = useState<() => Promise<void>>(() => async () => {})

  useEffect(() => {
    let swRegistration: ServiceWorkerRegistration | undefined

    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true)
      },
      onOfflineReady() {
        setOfflineReady(true)
      },
      onRegistered(reg: ServiceWorkerRegistration | undefined) {
        // Stash the registration so we can poll for updates
        swRegistration = reg
      },
      onRegisterError(err: unknown) {
        // SW registration failed — log but don't crash the app
        console.warn('[PWA] Service worker registration failed:', err)
      },
    })
    // `update` is a function: call with `true` to trigger reload after activation.
    // Wrap so the consumer just calls updateApp() with no args.
    setUpdateApp(() => async () => {
      await update(true)
    })

    // Periodically check for new SW versions. registration.update() asks
    // the browser to re-fetch the SW script; if it differs from the
    // installed one, the new SW is downloaded and onNeedRefresh fires.
    const interval = setInterval(() => {
      swRegistration?.update().catch(() => { /* offline — ignore */ })
    }, UPDATE_CHECK_INTERVAL_MS)

    // Also check when the app comes back to the foreground. iOS users
    // commonly leave the PWA in the app switcher for days — checking on
    // resume means they pick up new versions as soon as they come back.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        swRegistration?.update().catch(() => { /* offline — ignore */ })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return { needRefresh, offlineReady, updateApp, dismiss: () => setNeedRefresh(false) }
}
