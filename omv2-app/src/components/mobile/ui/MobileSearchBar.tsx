import { useEffect, useState } from 'react'

interface SearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Debounce delay in ms — useful for filtering large lists */
  debounce?: number
}

export function MobileSearchBar({ value, onChange, placeholder, debounce = 0 }: SearchProps) {
  const [local, setLocal] = useState(value)

  useEffect(() => { setLocal(value) }, [value])

  useEffect(() => {
    if (debounce <= 0) return
    const t = setTimeout(() => {
      if (local !== value) onChange(local)
    }, debounce)
    return () => clearTimeout(t)
  }, [local, debounce, onChange, value])

  return (
    <div className="mobile-searchbar">
      <span className="mobile-searchbar-icon">🔍</span>
      <input
        type="search"
        className="mobile-searchbar-input"
        placeholder={placeholder || 'Search…'}
        value={local}
        onChange={e => {
          setLocal(e.target.value)
          if (debounce <= 0) onChange(e.target.value)
        }}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {local && (
        <button
          className="mobile-searchbar-clear"
          onClick={() => { setLocal(''); onChange('') }}
          aria-label="Clear search"
        >✕</button>
      )}
    </div>
  )
}

interface FABProps {
  icon?: string
  label?: string
  onClick: () => void
}

export function MobileFAB({ icon = '+', label, onClick }: FABProps) {
  return (
    <button
      className="mobile-fab"
      onClick={onClick}
      aria-label={label || 'Add new'}
    >
      <span className="mobile-fab-icon">{icon}</span>
      {label && <span className="mobile-fab-label">{label}</span>}
    </button>
  )
}
