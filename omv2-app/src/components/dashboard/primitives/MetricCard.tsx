/**
 * MetricCard — KPI tile with delta, target, optional sparkline, and R/A/G tone.
 *
 * Designed to replace KpiCard for any tile where the value alone isn't a signal —
 * you also want to see "how does this compare to plan / target / last period?"
 *
 * Usage examples:
 *   <MetricCard label="CPI" value={0.94} format="ratio" tone="amber"
 *               target={1.0} sub="EV / AC" />
 *
 *   <MetricCard label="EAC" value={ctx.fmt(eac)} delta={vacPct} deltaSuffix="%"
 *               tone={toneFor(vacPct, 'vacPct')} target={`BAC ${ctx.fmt(bac)}`} />
 *
 *   <MetricCard label="Spend Rate" value="$42k/wk" sparkline={weeklyTotals}
 *               tone="green" />
 *
 * KpiCard stays for cases where a single number is the whole story.
 */

import type { Tone } from '../../../lib/dashboardThresholds'
import { TONE_COLOR } from '../../../lib/dashboardThresholds'

export interface MetricCardProps {
  /** Optional emoji icon at top-left */
  icon?: string
  /** Bottom label, e.g. "CPI" or "Pending Invoices" */
  label: string
  /** Main value — string for pre-formatted, number for raw display */
  value: string | number
  /** Tiny sub-label under the main label */
  sub?: string
  /**
   * Tone drives the top border colour and (optionally) the value colour.
   * Use toneFor(rawValue, 'cpi') from dashboardThresholds to derive this.
   */
  tone?: Tone
  /**
   * Delta vs target / baseline / last period.
   * Sign drives arrow direction. Combined with `deltaPositive` to colour.
   */
  delta?: number
  /** Suffix on the delta — e.g. "%", "h", "$". Default "%" if omitted */
  deltaSuffix?: string
  /**
   * Whether a positive delta means "good". Defaults true (e.g. higher CPI = good).
   * Set false for metrics where lower is better (overdue invoices, days behind).
   */
  deltaPositive?: boolean
  /** Optional explicit target / baseline shown in the corner */
  target?: string | number
  /** Optional small inline sparkline — values normalised, no axes */
  sparkline?: number[]
  /** Override the value's text colour. Defaults to tone colour, then var(--text) */
  valueColor?: string
  /** Click handler — usually routes to the source panel */
  onClick?: () => void
}

const MAX_SPARK_POINTS = 24

export function MetricCard({
  icon, label, value, sub, tone = 'neutral',
  delta, deltaSuffix = '%', deltaPositive = true,
  target, sparkline, valueColor, onClick,
}: MetricCardProps) {
  const accent = TONE_COLOR[tone]
  const numericDelta = typeof delta === 'number' && Number.isFinite(delta) ? delta : null
  const deltaIsPositive = numericDelta != null && numericDelta > 0
  const deltaGood =
    numericDelta == null
      ? false
      : (deltaPositive ? deltaIsPositive : !deltaIsPositive)

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderTop: `3px solid ${accent}`,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
      onClick={onClick}
    >
      {/* Top row: icon + optional target chip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {icon ? (
          <div style={{ fontSize: '18px', lineHeight: 1 }}>{icon}</div>
        ) : <div />}
        {target != null && (
          <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            target {typeof target === 'number' ? target.toString() : target}
          </div>
        )}
      </div>

      {/* Big value */}
      <div
        style={{
          fontSize: '24px',
          fontWeight: 800,
          fontFamily: 'var(--mono)',
          color: valueColor || (tone === 'neutral' ? 'var(--text)' : accent),
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>

      {/* Label + sub */}
      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{sub}</div>}

      {/* Delta + sparkline row */}
      {(numericDelta != null || (sparkline && sparkline.length > 1)) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
            paddingTop: '6px',
            gap: '8px',
          }}
        >
          {numericDelta != null ? (
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: deltaGood ? 'var(--green)' : 'var(--red)',
                fontFamily: 'var(--mono)',
              }}
            >
              {deltaIsPositive ? '▲' : '▼'} {Math.abs(numericDelta).toFixed(1)}{deltaSuffix}
            </div>
          ) : <div />}
          {sparkline && sparkline.length > 1 && (
            <Sparkline values={sparkline} color={accent} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Inline sparkline ─────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const pts = values.slice(-MAX_SPARK_POINTS)
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1
  const W = 72
  const H = 22
  const stepX = W / (pts.length - 1)
  const path = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={W} height={H} style={{ overflow: 'visible', flexShrink: 0 }} aria-hidden>
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
