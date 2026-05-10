/** KpiCard — single big number KPI tile */

export interface KpiCardProps {
  icon?: string
  label: string
  value: string | number
  sub?: string
  color?: string
  accent?: string
  trend?: { delta: number; direction: 'up' | 'down'; positive: boolean }
  onClick?: () => void
}

export function KpiCard({ icon, label, value, sub, color, accent, trend, onClick }: KpiCardProps) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderTop: `3px solid ${accent || color || 'var(--accent)'}`,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        boxSizing: 'border-box',
      }}
      onClick={onClick}
    >
      {icon && (
        <div style={{ fontSize: '20px', marginBottom: '6px' }}>{icon}</div>
      )}
      <div
        style={{
          fontSize: '24px',
          fontWeight: 800,
          fontFamily: 'var(--mono)',
          color: color || 'var(--text)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px', fontWeight: 600 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{sub}</div>
      )}
      {trend && (
        <div
          style={{
            fontSize: '10px',
            marginTop: '4px',
            color: trend.positive ? 'var(--green)' : 'var(--red)',
          }}
        >
          {trend.direction === 'up' ? '▲' : '▼'} {Math.abs(trend.delta).toFixed(1)}%
        </div>
      )}
    </div>
  )
}
