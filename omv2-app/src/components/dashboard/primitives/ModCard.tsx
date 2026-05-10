/** ModCard — module summary card (icon + title + stats row). Matches existing main dashboard style. */

export interface ModCardProps {
  icon: string
  title: string
  sub?: string
  stats: { val: string | number; lbl: string; color?: string }[]
  accent?: string
  onClick?: () => void
}

export function ModCard({ icon, title, sub, stats, accent, onClick }: ModCardProps) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderTop: `3px solid ${accent || 'var(--accent)'}`,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        boxSizing: 'border-box',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '12px' }}>{title}</div>
          {sub && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{sub}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {stats.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 700,
                fontFamily: 'var(--mono)',
                color: s.color || 'var(--text)',
              }}
            >
              {s.val}
            </div>
            <div
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text3)',
                fontWeight: 600,
              }}
            >
              {s.lbl}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
