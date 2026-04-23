interface Props {
  icon: string
  title: string
  subtitle?: string
}

export function PlaceholderPanel({ icon, title, subtitle }: Props) {
  return (
    <div style={{ padding: '32px' }}>
      <div className="empty-state">
        <div className="icon">{icon}</div>
        <h3>{title}</h3>
        <p style={{ color: 'var(--text3)' }}>
          {subtitle || 'This module is being built. Check back soon.'}
        </p>
      </div>
    </div>
  )
}
