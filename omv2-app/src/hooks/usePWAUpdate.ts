import { useEffect, useState } from 'react'
// vite-plugin-pwa virtual module — provides registerSW with update callbacks.
// The plugin generates this at build time; in dev with PWA disabled it's a no-op.
// @ts-expect-error — virtual module, no static types
import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the service worker and exposes:
 * - needRefresh: true when a new SW is waiting (a new build was deployed)
 * - offlineReady: true once the SW has cached the shell (first install)
 * - updateApp(): triggers SW skipWaiting + reload to apply the new version
 *
 * Used by the App-level update toast. Doesn't auto-reload — the user decides
 * when to refresh, so they don't lose unsaved form data mid-edit.
 */
export function usePWAUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [updateApp, setUpdateApp] = useState<() => Promise<void>>(() => async () => {})

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true)
      },
      onOfflineReady() {
        setOfflineReady(true)
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
  }, [])

  return { needRefresh, offlineReady, updateApp, dismiss: () => setNeedRefresh(false) }
}
