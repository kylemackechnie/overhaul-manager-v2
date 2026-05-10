/** AlertBanner — colored strip with icon, message, and optional CTA button */

export interface AlertBannerProps {
  icon?: string
  message: React.ReactNode
  color?: string              // border and tint color; defaults to amber
  ctaLabel?: string
  onCta?: () => void
}

export function AlertBanner({ icon, message, color, ctaLabel, onCta }: AlertBannerProps) {
  const c = color || 'var(--amber)'
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: '6px',
        background: 'var(--bg2)',
        borderLeft: `4px solid ${c}`,
        fontSize: '13px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <span>
        {icon && <>{icon} </>}
        {message}
      </span>
      {ctaLabel && onCta && (
        <button className="btn btn-sm" onClick={onCta} style={{ flexShrink: 0 }}>
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
