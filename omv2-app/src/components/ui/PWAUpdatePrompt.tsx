import { usePWAUpdate } from '../../hooks/usePWAUpdate'

/**
 * Sticky bottom-right card that appears when a new app version is ready.
 * - Refresh: applies update + reloads (user-initiated, won't lose unsaved data
 *   from a silent reload)
 * - Later: dismisses for this session; reappears on next visit if still pending
 *
 * Mounts once at the App level. Invisible until needRefresh fires.
 * Sits above the mobile bottom-tab bar (z-index: 5000).
 */
export function PWAUpdatePrompt() {
  const { needRefresh, updateApp, dismiss } = usePWAUpdate()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))', // clear of mobile tabs
        right: '16px',
        left: '16px',
        maxWidth: '420px',
        marginLeft: 'auto',
        background: 'var(--bg2)',
        border: '1px solid var(--border2)',
        borderLeft: '4px solid var(--accent)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        padding: '12px 14px',
        zIndex: 5000,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '13px',
      }}
    >
      <div style={{ flex: 1, color: 'var(--text)', lineHeight: 1.4 }}>
        <strong style={{ display: 'block', marginBottom: '2px' }}>Update available</strong>
        <span style={{ color: 'var(--text2)', fontSize: '12px' }}>
          A new version of Overhaul Manager is ready.
        </span>
      </div>
      <button
        onClick={dismiss}
        className="btn btn-ghost"
        style={{ fontSize: '12px', padding: '6px 10px' }}
      >
        Later
      </button>
      <button
        onClick={() => updateApp()}
        className="btn btn-primary"
        style={{ fontSize: '12px', padding: '6px 12px' }}
      >
        Refresh
      </button>
    </div>
  )
}
