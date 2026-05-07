import { useEffect, useRef } from 'react'

interface Props {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  /** Show the underlying input for direct typing */
  allowTyping?: boolean
  /** Visual size — 'md' standard, 'lg' for primary qty entry */
  size?: 'md' | 'lg'
  /** Disabled state */
  disabled?: boolean
  /** Indicate validation issue (e.g. > available) */
  invalid?: boolean
}

/**
 * Big-tap-target quantity stepper: [−] N [+]
 *
 * - Long-press on +/− accelerates after 500ms
 * - Allows typed input (mobile keypad numeric)
 * - Clamped to min/max with visual feedback
 * - 44px minimum tap targets per Apple HIG
 *
 * Used in: Issue qty entry, Receive qty entry, (future) Timesheet hours
 */
export function MobileQtyStepper({
  value, onChange,
  min = 0, max = Infinity, step = 1,
  allowTyping = true, size = 'md', disabled = false, invalid = false,
}: Props) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatTimer    = useRef<ReturnType<typeof setInterval> | null>(null)

  function clamp(n: number) {
    if (Number.isNaN(n)) return min
    return Math.max(min, Math.min(max, n))
  }

  function nudge(dir: 1 | -1) {
    onChange(clamp(value + dir * step))
  }

  function startLongPress(dir: 1 | -1) {
    if (disabled) return
    nudge(dir)
    longPressTimer.current = setTimeout(() => {
      // After 500ms hold, repeat every 100ms
      repeatTimer.current = setInterval(() => nudge(dir), 100)
    }, 500)
  }

  function endLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    if (repeatTimer.current)    clearInterval(repeatTimer.current)
    longPressTimer.current = null
    repeatTimer.current    = null
  }

  // Cleanup on unmount in case the user taps and navigates away mid-long-press
  useEffect(() => () => endLongPress(), [])

  const cls = `mobile-qty-stepper mobile-qty-stepper-${size}${invalid ? ' mobile-qty-stepper-invalid' : ''}${disabled ? ' mobile-qty-stepper-disabled' : ''}`
  const canDecrement = !disabled && value > min
  const canIncrement = !disabled && value < max

  return (
    <div className={cls}>
      <button
        type="button"
        className="mobile-qty-stepper-btn"
        aria-label="Decrease"
        disabled={!canDecrement}
        onPointerDown={() => startLongPress(-1)}
        onPointerUp={endLongPress}
        onPointerLeave={endLongPress}
        onPointerCancel={endLongPress}
      >
        −
      </button>
      {allowTyping ? (
        <input
          className="mobile-qty-stepper-input"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          min={min}
          max={Number.isFinite(max) ? max : undefined}
          step={step}
          disabled={disabled}
          onChange={e => onChange(clamp(parseInt(e.target.value, 10)))}
          // Select all on focus — easier to overwrite
          onFocus={e => e.currentTarget.select()}
        />
      ) : (
        <div className="mobile-qty-stepper-value">{value}</div>
      )}
      <button
        type="button"
        className="mobile-qty-stepper-btn"
        aria-label="Increase"
        disabled={!canIncrement}
        onPointerDown={() => startLongPress(1)}
        onPointerUp={endLongPress}
        onPointerLeave={endLongPress}
        onPointerCancel={endLongPress}
      >
        +
      </button>
    </div>
  )
}
