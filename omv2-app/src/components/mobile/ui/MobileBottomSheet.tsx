import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  /** Whether the sheet is visible */
  open: boolean
  /** Called when the user dismisses (backdrop tap, ESC, drag-down) */
  onClose: () => void
  /** Sheet title shown in the header */
  title?: ReactNode
  /** Optional right-side header action (e.g. "Save" button) */
  headerAction?: ReactNode
  /** Sheet body */
  children: ReactNode
  /** Sticky bottom action bar (e.g. confirm button) */
  footer?: ReactNode
  /** Initial height — 'auto' (content), 'half' (~50%), 'full' (~95%) */
  height?: 'auto' | 'half' | 'full'
  /** Disable backdrop tap to close (e.g. while saving) */
  preventBackdropClose?: boolean
}

/**
 * Bottom sheet modal for mobile flows. Slides up from the bottom, takes over
 * most of the screen, dismissed by tapping backdrop, ESC, or swipe-down on
 * the drag handle.
 *
 * Used by:
 * - Issue parts (tap-to-issue flow)
 * - (future) Accommodation/Cars edit
 * - (future) Timesheet day entry
 *
 * Accessibility: focus trap is NOT implemented yet — defer until we have a
 * sheet that contains complex form fields where keyboard nav matters.
 */
export function MobileBottomSheet({
  open, onClose, title, headerAction, children, footer,
  height = 'auto', preventBackdropClose = false,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef<number | null>(null)
  const dragOffset = useRef(0)

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !preventBackdropClose) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, preventBackdropClose])

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Drag-to-dismiss on the handle
  function onTouchStart(e: React.TouchEvent) {
    dragStartY.current = e.touches[0].clientY
    dragOffset.current = 0
  }
  function onTouchMove(e: React.TouchEvent) {
    if (dragStartY.current == null || !sheetRef.current) return
    const dy = e.touches[0].clientY - dragStartY.current
    if (dy < 0) return // ignore upward drag
    dragOffset.current = dy
    sheetRef.current.style.transform = `translateY(${dy}px)`
    sheetRef.current.style.transition = 'none'
  }
  function onTouchEnd() {
    if (!sheetRef.current) return
    sheetRef.current.style.transition = ''
    const threshold = sheetRef.current.offsetHeight * 0.25
    if (dragOffset.current > threshold) {
      onClose()
    } else {
      sheetRef.current.style.transform = ''
    }
    dragStartY.current = null
    dragOffset.current = 0
  }

  if (!open) return null

  return (
    <div
      className="mobile-sheet-backdrop"
      onClick={preventBackdropClose ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={sheetRef}
        className={`mobile-sheet mobile-sheet-${height}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle — visible affordance for swipe-down dismiss */}
        <div
          className="mobile-sheet-handle-wrap"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="mobile-sheet-handle" />
        </div>

        {(title || headerAction) && (
          <div className="mobile-sheet-header">
            <div className="mobile-sheet-title">{title}</div>
            {headerAction && <div className="mobile-sheet-header-action">{headerAction}</div>}
          </div>
        )}

        <div className="mobile-sheet-body">
          {children}
        </div>

        {footer && (
          <div className="mobile-sheet-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
