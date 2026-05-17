/**
 * WalkAwayPanel — Sandbox › Walk-Away Analysis
 *
 * Picks a date D and answers: "if we stopped the project on D, what's the bill?"
 *
 * Every dollar in EAC classifies into one of four buckets:
 *   - Sunk          — already spent, irrecoverable as of D
 *   - Locked        — committed, paid even if we stop on D (inside notice period or contracted)
 *   - Avoidable     — currently forecast but recoverable if we decide to stop by D
 *   - Discretionary — future cost, no commitment yet, full discretion to skip
 *
 * Sunk + Locked + Avoidable + Discretionary = current EAC (within rounding).
 *
 * Notice periods (per cost source) live on projects.walk_away_settings.notice_days
 * and are editable from this panel.
 *
 * Status: stub scaffold. Engine and UI built incrementally:
 *   - Step 3: types + engine skeleton (flights + expenses)
 *   - Step 4: sanity check vs Stanwell data
 *   - Step 5: KPI strip + notice-period popover
 *   - Step 6-8: remaining cost sources
 *   - Step 9: compare mode
 *   - Step 10: drill-down + WBS view
 *   - Step 11: help article + tour
 */

import { useAppStore } from '../../store/appStore'
import { HelpButton } from '../../components/HelpButton'

export function WalkAwayPanel() {
  const { activeProject } = useAppStore()

  if (!activeProject) {
    return <div style={{ padding: '24px' }}>Select a project to run Walk-Away analysis.</div>
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>🚪 Walk-Away Analysis</h1>
        <HelpButton panelId="sandbox-walkaway" />
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text2)', maxWidth: '720px' }}>
        Pick a date and see what the project would cost if we stopped there. Each cost
        source is classified into <strong>Sunk</strong> (already spent), <strong>Locked</strong> (committed),
        <strong> Avoidable</strong> (still cancellable), or <strong>Discretionary</strong> (no commitment yet).
      </p>
      <div style={{
        padding: '24px',
        background: 'var(--bg2)',
        border: '1px dashed var(--border)',
        borderRadius: '8px',
        marginTop: '20px',
        textAlign: 'center',
        color: 'var(--text3)',
      }}>
        Engine and breakdown UI under construction. Coming soon: KPI strip,
        stacked bar, breakdown by cost source, compare-two-dates mode, and
        drill-down to contributing line items.
      </div>
    </div>
  )
}
