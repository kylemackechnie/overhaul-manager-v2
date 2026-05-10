/** TileLoading — skeleton shimmer shown while query is in flight */
export function TileLoading() {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {[60, 40, 80].map((w, i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? '24px' : '12px',
            width: `${w}%`,
            background: 'var(--border2)',
            borderRadius: '4px',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}

/** TileEmpty — shown when a query returns no data */
export interface TileEmptyProps {
  icon?: string
  label?: string
  ctaLabel?: string
  onCta?: () => void
}

export function TileEmpty({ icon = '📭', label = 'No data yet', ctaLabel, onCta }: TileEmptyProps) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        color: 'var(--text3)',
      }}
    >
      <div style={{ fontSize: '24px' }}>{icon}</div>
      <div style={{ fontSize: '12px' }}>{label}</div>
      {ctaLabel && onCta && (
        <button className="btn btn-sm" onClick={onCta}>{ctaLabel}</button>
      )}
    </div>
  )
}

/** TileError — shown when a query throws */
export interface TileErrorProps {
  message?: string
  onRetry?: () => void
}

export function TileError({ message = 'Failed to load', onRetry }: TileErrorProps) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        color: 'var(--red)',
      }}
    >
      <div style={{ fontSize: '20px' }}>⚠</div>
      <div style={{ fontSize: '12px' }}>{message}</div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}
