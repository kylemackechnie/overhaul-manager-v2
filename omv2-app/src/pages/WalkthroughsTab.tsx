import { useMemo } from 'react'
import { ALL_TOURS, getToursByModule, type Tour } from '../help/tours/_index'
import { runTour } from '../help/tours/runner'
import { useAppStore } from '../store/appStore'

interface WalkthroughsTabProps {
  /** Called when a tour finishes or is skipped, so the Help panel can close itself if desired. */
  onTourStarting?: () => void
}

export function WalkthroughsTab({ onTourStarting }: WalkthroughsTabProps) {
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const groups = useMemo(() => getToursByModule(), [])

  function handleRun(tour: Tour) {
    onTourStarting?.()
    runTour(tour, { setActivePanel })
  }

  if (ALL_TOURS.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎯</div>
        <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text2)' }}>No walkthroughs yet</div>
        <div>Interactive guided tours will appear here as they're built.</div>
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1, paddingRight: '8px' }}>
      <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '16px' }}>
        Interactive tours step you through workflows with on-screen guidance. They run on the live app, so what you see is what you'll get.
      </div>
      {groups.map(group => (
        <div key={group.module} style={{ marginBottom: '20px' }}>
          <div style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            marginBottom: '6px',
          }}>
            {group.module}
          </div>
          {group.tours.map(tour => (
            <div
              key={tour.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '12px 16px',
                marginBottom: '8px',
                background: 'var(--bg)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>
                  {tour.title}
                </div>
                {tour.description && (
                  <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '2px' }}>
                    {tour.description}
                  </div>
                )}
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>
                  {tour.steps.length} step{tour.steps.length !== 1 ? 's' : ''}
                  {tour.estimatedSeconds && ` • ~${tour.estimatedSeconds}s`}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleRun(tour)}
              >
                ▶ Run
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
