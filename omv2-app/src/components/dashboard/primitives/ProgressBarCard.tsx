/** ProgressBarCard — label + percentage bar + value text */

export interface ProgressBarCardProps {
  icon?: string
  label: string
  pct: number           // 0–100
  valueText?: string    // shown below bar; defaults to "X%"
  color?: string
  accent?: string
  onClick?: () => void
}

export function ProgressBarCard({ icon, label, pct, valueText, color, accent, onClick }: ProgressBarCardProps) {
  const clampedPct = Math.min(100, Math.max(0, pct))
  const barColor = color || (clampedPct >= 100 ? 'var(--green)' : clampedPct >= 80 ? 'var(--amber)' : 'var(--red)')

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderTop: `3px solid ${accent || barColor}`,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        boxSizing: 'border-box',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        {icon && <span style={{ fontSize: '16px' }}>{icon}</span>}
        <div style={{ fontWeight: 600, fontSize: '12px' }}>{label}</div>
      </div>
      <div
        style={{
          background: 'var(--border2)',
          borderRadius: '4px',
          height: '8px',
          overflow: 'hidden',
          marginBottom: '6px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: clampedPct + '%',
            background: barColor,
            borderRadius: '4px',
            transition: 'width 0.3s',
          }}
        />
      </div>
      <div
        style={{
          fontSize: '22px',
          fontWeight: 700,
          fontFamily: 'var(--mono)',
          color: barColor,
        }}
      >
        {valueText ?? `${clampedPct.toFixed(0)}%`}
      </div>
    </div>
  )
}
