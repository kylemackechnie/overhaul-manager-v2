/**
 * WidgetPicker
 *
 * Generic tile picker modal. Accepts registry and categories as props so it
 * works for all dashboards. The existing main dashboard imports this with its
 * own registry; all other dashboards supply theirs.
 *
 * Closes on Esc key and overlay click.
 */

import { useEffect, useRef, useState } from 'react'
import type { TileDef, TileLayoutEntry, TileSize } from '../../types/dashboard'

interface Props {
  registry: TileDef[]
  categories: string[]
  layout: TileLayoutEntry[]
  onClose: () => void
  onToggle: (id: string) => void
  onSizeChange: (id: string, size: TileSize) => void
}

const PHASE1_SIZES: { key: TileSize; label: string }[] = [
  { key: 'md', label: 'Normal' },
  { key: 'lg', label: 'Wide' },
]

export function WidgetPicker({ registry, categories, layout, onClose, onToggle, onSizeChange }: Props) {
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const visibleIds = new Set(layout.filter(t => t.visible).map(t => t.id))
  const getSizeFor = (id: string): TileSize => layout.find(t => t.id === id)?.size ?? 'md'

  const activeTiles = layout
    .filter(t => t.visible)
    .map(t => registry.find(r => r.id === t.id)!)
    .filter(Boolean)

  const q = search.toLowerCase()
  const filteredRegistry = search
    ? registry.filter(
        t =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q),
      )
    : null

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tileCardStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 12px', borderRadius: '8px',
    background: active ? 'var(--accent-dim, rgba(99,102,241,0.12))' : 'var(--bg3)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    cursor: 'pointer', transition: 'all 0.15s ease',
  })

  const pillStyle = (on: boolean): React.CSSProperties => ({
    padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
    background: on ? 'var(--accent)' : 'var(--bg)',
    color: on ? '#fff' : 'var(--text3)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    userSelect: 'none',
  })

  const renderTileCard = (tile: TileDef) => {
    const active = visibleIds.has(tile.id)
    const size = getSizeFor(tile.id)
    return (
      <div key={tile.id} style={tileCardStyle(active)} onClick={() => onToggle(tile.id)}>
        <span style={{ fontSize: '22px', flexShrink: 0 }}>{tile.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {tile.title}
            {active && <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 500 }}>✓ Active</span>}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '1px' }}>{tile.description}</div>
        </div>
        {active && (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {PHASE1_SIZES.map(({ key, label }) => (
              <span key={key} style={pillStyle(size === key)} onClick={() => onSizeChange(tile.id, key)}>
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg2)', borderRadius: '14px', width: '560px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>Widgets</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Tap to add or remove · set size on active tiles</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search widgets…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', width: '160px' }}
            />
            <button className="btn btn-sm" onClick={onClose}>Done</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {filteredRegistry && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '8px' }}>
                Search results ({filteredRegistry.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredRegistry.length === 0
                  ? <div style={{ fontSize: '12px', color: 'var(--text3)' }}>No widgets match "{search}"</div>
                  : filteredRegistry.map(renderTileCard)}
              </div>
            </div>
          )}
          {!filteredRegistry && activeTiles.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '8px' }}>
                On Your Dashboard ({activeTiles.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>{activeTiles.map(renderTileCard)}</div>
            </div>
          )}
          {!filteredRegistry && categories.map(cat => {
            const tiles = registry.filter(t => t.category === cat && !visibleIds.has(t.id))
            if (tiles.length === 0) return null
            return (
              <div key={cat}>
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '8px' }}>{cat}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>{tiles.map(renderTileCard)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
