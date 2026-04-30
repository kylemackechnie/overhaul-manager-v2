/**
 * WidgetPicker
 *
 * iPhone-style modal that shows all available tiles grouped by category.
 * Active tiles shown at top. Tap any tile to toggle visibility.
 * Also exposes size toggle (normal / wide) on active tiles.
 */

import { useState } from 'react'
import { TILE_REGISTRY, TILE_CATEGORIES } from './tileRegistry'
import type { DashboardTileConfig } from '../../types'

interface Props {
  layout: DashboardTileConfig[]
  onClose: () => void
  onToggle: (id: string) => void
  onSizeChange: (id: string, size: 'normal' | 'wide') => void
}

export function WidgetPicker({ layout, onClose, onToggle, onSizeChange }: Props) {
  const [search, setSearch] = useState('')
  const visibleIds = new Set(layout.filter(t => t.visible).map(t => t.id))

  const getSizeFor = (id: string): 'normal' | 'wide' => {
    return layout.find(t => t.id === id)?.size ?? 'normal'
  }

  const activeTiles = layout
    .filter(t => t.visible)
    .map(t => TILE_REGISTRY.find(r => r.id === t.id)!)
    .filter(Boolean)

  const q = search.toLowerCase()
  const filteredRegistry = search
    ? TILE_REGISTRY.filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    : null

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(3px)',
  }

  const sheetStyle: React.CSSProperties = {
    background: 'var(--bg2)', borderRadius: '14px', width: '560px', maxWidth: '95vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
    border: '1px solid var(--border)',
  }

  const headerStyle: React.CSSProperties = {
    padding: '18px 20px 12px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
    flexShrink: 0,
  }

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

  const renderTileCard = (tile: typeof TILE_REGISTRY[0]) => {
    const active = visibleIds.has(tile.id)
    const size = getSizeFor(tile.id)
    return (
      <div key={tile.id} style={tileCardStyle(active)} onClick={() => onToggle(tile.id)}>
        <span style={{ fontSize: '22px', flexShrink: 0 }}>{tile.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {tile.title}
            {active && (
              <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 500 }}>✓ Active</span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '1px' }}>{tile.description}</div>
        </div>
        {active && (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <span style={pillStyle(size === 'normal')} onClick={() => onSizeChange(tile.id, 'normal')}>Normal</span>
            <span style={pillStyle(size === 'wide')} onClick={() => onSizeChange(tile.id, 'wide')}>Wide</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>Widgets</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
              Tap to add or remove · set size on active tiles
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search widgets…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', width: '160px',
              }}
              autoFocus
            />
            <button className="btn btn-sm" onClick={onClose}>Done</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Search results */}
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

          {/* Active tiles */}
          {!filteredRegistry && activeTiles.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '8px' }}>
                On Your Dashboard ({activeTiles.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activeTiles.map(renderTileCard)}
              </div>
            </div>
          )}

          {/* All tiles by category */}
          {!filteredRegistry && TILE_CATEGORIES.map(cat => {
            const tiles = TILE_REGISTRY.filter(t => t.category === cat && !visibleIds.has(t.id))
            if (tiles.length === 0) return null
            return (
              <div key={cat}>
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '8px' }}>
                  {cat}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {tiles.map(renderTileCard)}
                </div>
              </div>
            )
          })}

        </div>
      </div>
    </div>
  )
}
