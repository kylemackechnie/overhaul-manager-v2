import type { ReactNode, MouseEvent } from 'react'

interface Props {
  /** Primary text — left side, top */
  title: ReactNode
  /** Optional secondary text — left side, below title */
  subtitle?: ReactNode
  /** Optional metadata — right side, top (e.g. status pill) */
  meta?: ReactNode
  /** Optional metadata — right side, below meta (e.g. dates, $) */
  metaSub?: ReactNode
  /** Status indicator stripe colour on left edge */
  accent?: string
  /** Tap handler — shows chevron when set */
  onClick?: () => void
  /** If true, renders chevron on right */
  chevron?: boolean
  /** Free-form footer area below title block (chips, tags, etc) */
  footer?: ReactNode
  /** Selection checkbox */
  selected?: boolean
  onSelect?: (e: MouseEvent) => void
}

export function MobileCard({
  title, subtitle, meta, metaSub, accent, onClick, chevron = true, footer, selected, onSelect,
}: Props) {
  const isInteractive = !!onClick
  return (
    <div
      className={`mobile-card ${isInteractive ? 'mobile-card-interactive' : ''} ${selected ? 'mobile-card-selected' : ''}`}
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={isInteractive ? e => { if (e.key === 'Enter') onClick?.() } : undefined}
    >
      {accent && <div className="mobile-card-accent" style={{ background: accent }} />}
      {onSelect && (
        <div className="mobile-card-checkbox" onClick={e => { e.stopPropagation(); onSelect(e) }}>
          <input type="checkbox" checked={selected || false} readOnly />
        </div>
      )}
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <div className="mobile-card-text">
            <div className="mobile-card-title">{title}</div>
            {subtitle && <div className="mobile-card-subtitle">{subtitle}</div>}
          </div>
          {(meta || metaSub) && (
            <div className="mobile-card-meta">
              {meta && <div className="mobile-card-meta-top">{meta}</div>}
              {metaSub && <div className="mobile-card-meta-sub">{metaSub}</div>}
            </div>
          )}
        </div>
        {footer && <div className="mobile-card-footer">{footer}</div>}
      </div>
      {chevron && isInteractive && <div className="mobile-card-chevron">›</div>}
    </div>
  )
}
