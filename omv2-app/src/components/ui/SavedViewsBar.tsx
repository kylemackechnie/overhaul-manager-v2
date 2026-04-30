/**
 * SavedViewsBar
 *
 * A 🔖 button + dropdown for saving and loading named filter presets.
 * Completely self-contained — existing filter logic is untouched.
 *
 * Usage:
 *   <SavedViewsBar
 *     panelId="nrg-tce"
 *     currentFilters={{ sourceFilter, hideUnused, showWeekly }}
 *     onLoad={filters => {
 *       if (filters.sourceFilter !== undefined) setSourceFilter(filters.sourceFilter as string)
 *       if (filters.hideUnused !== undefined) setHideUnused(filters.hideUnused as boolean)
 *     }}
 *   />
 */

import { useState, useRef, useEffect } from 'react'
import { useSavedViews } from '../../hooks/useSavedViews'

interface Props {
  panelId: string
  currentFilters: Record<string, unknown>
  onLoad: (filters: Record<string, unknown>) => void
}

export function SavedViewsBar({ panelId, currentFilters, onLoad }: Props) {
  const { views, save, remove } = useSavedViews(panelId)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus input when save panel opens
  useEffect(() => {
    if (saving) setTimeout(() => inputRef.current?.focus(), 50)
  }, [saving])

  function handleSave() {
    if (!name.trim()) return
    save(name, currentFilters)
    setName('')
    setSaving(false)
  }

  return (
    <div ref={dropRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-sm"
        onClick={() => { setOpen(o => !o); setSaving(false) }}
        title={views.length > 0 ? `${views.length} saved view${views.length > 1 ? 's' : ''}` : 'Save current filters as a named view'}
        style={{ position: 'relative' }}
      >
        🔖{views.length > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: 'var(--accent)', color: '#fff',
            borderRadius: '9px', fontSize: '9px', fontWeight: 700,
            minWidth: '14px', height: '14px', lineHeight: '14px',
            textAlign: 'center', padding: '0 2px',
          }}>{views.length}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 400,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          minWidth: '220px', padding: '8px',
        }}>

          {/* Saved views list */}
          {views.length === 0 && !saving && (
            <div style={{ fontSize: '12px', color: 'var(--text3)', padding: '6px 4px' }}>No saved views yet</div>
          )}

          {views.map(v => (
            <div key={v.name} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 6px', borderRadius: '5px', cursor: 'pointer',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span
                style={{ flex: 1, fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onClick={() => { onLoad(v.filters); setOpen(false) }}
                title={`Load: ${v.name}`}
              >
                {v.name}
              </span>
              <button
                onClick={e => { e.stopPropagation(); remove(v.name) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: '12px', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                title="Delete view"
              >✕</button>
            </div>
          ))}

          {/* Divider */}
          {views.length > 0 && <div style={{ height: '1px', background: 'var(--border)', margin: '6px 0' }} />}

          {/* Save current as new view */}
          {saving ? (
            <div style={{ display: 'flex', gap: '4px', padding: '4px 0' }}>
              <input
                ref={inputRef}
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false) }}
                placeholder="View name…"
                style={{
                  flex: 1, fontSize: '12px', padding: '4px 6px',
                  border: '1px solid var(--accent)', borderRadius: '4px',
                  background: 'var(--bg)', color: 'var(--text)', outline: 'none',
                }}
              />
              <button className="btn btn-sm" onClick={handleSave} disabled={!name.trim()}>Save</button>
              <button className="btn btn-sm" onClick={() => { setSaving(false); setName('') }}>✕</button>
            </div>
          ) : (
            <button
              className="btn btn-sm"
              style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
              onClick={() => setSaving(true)}
            >
              + Save current filters…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
