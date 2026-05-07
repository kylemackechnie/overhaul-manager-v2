import type { ReactNode } from 'react'

export interface FilterChip {
  id: string
  label: ReactNode
  count?: number
}

interface Props {
  chips: FilterChip[]
  active: string
  onChange: (id: string) => void
  /** Show counts in chips */
  showCounts?: boolean
}

export function MobileFilterBar({ chips, active, onChange, showCounts }: Props) {
  return (
    <div className="mobile-filterbar">
      {chips.map(chip => (
        <button
          key={chip.id}
          className={`mobile-filterchip ${chip.id === active ? 'mobile-filterchip-active' : ''}`}
          onClick={() => onChange(chip.id)}
        >
          <span>{chip.label}</span>
          {showCounts && typeof chip.count === 'number' && (
            <span className="mobile-filterchip-count">{chip.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
