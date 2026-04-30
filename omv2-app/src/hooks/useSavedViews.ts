/**
 * useSavedViews
 *
 * Named filter presets per panel. Completely additive — no effect on
 * existing filter state or persistence. Max 10 views per panel.
 *
 * Usage:
 *   const sv = useSavedViews('nrg-tce')
 *   // Save current filters:
 *   sv.save('Overhead Only', { sourceFilter: 'overhead', hideUnused: true })
 *   // Load a view (caller applies the filters):
 *   const view = sv.views[0]
 *   setSourceFilter(view.filters.sourceFilter as string)
 */

import { useCallback } from 'react'
import { useUserPrefs } from './useUserPrefs'

const MAX_VIEWS = 10

export interface SavedView {
  name: string
  filters: Record<string, unknown>
}

export function useSavedViews(panelId: string) {
  const { prefs, setPref } = useUserPrefs()

  const allViews = (prefs.saved_views ?? {}) as Record<string, SavedView[]>
  const views: SavedView[] = allViews[panelId] ?? []

  const save = useCallback((name: string, filters: Record<string, unknown>) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const current = (prefs.saved_views ?? {}) as Record<string, SavedView[]>
    const existing = current[panelId] ?? []
    // Replace if same name exists, otherwise append (cap at MAX_VIEWS)
    const idx = existing.findIndex(v => v.name === trimmed)
    let next: SavedView[]
    if (idx >= 0) {
      next = existing.map((v, i) => i === idx ? { name: trimmed, filters } : v)
    } else {
      next = [...existing, { name: trimmed, filters }].slice(-MAX_VIEWS)
    }
    setPref('saved_views', { ...current, [panelId]: next })
  }, [prefs.saved_views, panelId, setPref])

  const remove = useCallback((name: string) => {
    const current = (prefs.saved_views ?? {}) as Record<string, SavedView[]>
    const existing = current[panelId] ?? []
    setPref('saved_views', { ...current, [panelId]: existing.filter(v => v.name !== name) })
  }, [prefs.saved_views, panelId, setPref])

  return { views, save, remove }
}
