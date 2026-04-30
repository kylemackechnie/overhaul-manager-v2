/**
 * useUserPrefs
 *
 * User preference storage with two-tier persistence:
 *   1. localStorage (namespaced by userId) — instant reads/writes, survives refresh
 *   2. Supabase app_users.preferences — syncs across devices, debounced 2s after last write
 *
 * On first mount for a given user:
 *   a) Reads localStorage immediately (no flash)
 *   b) Fetches Supabase in background; Supabase wins on conflict (source of truth)
 *
 * Multiple components can call useUserPrefs() — the module-level _loadedFor set
 * prevents redundant Supabase fetches within a single page session.
 *
 * Bugs fixed:
 *   - _loadedFor now cleared on logout so next login re-fetches from Supabase
 *   - debounce timer cancelled on unmount so no stale writes fire after logout
 */

import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import type { UserPrefs } from '../types'

// Module-level: track which userIds have already been loaded from Supabase this session
const _loadedFor = new Set<string>()

function lsKey(userId: string) {
  return `omv2_prefs_${userId}`
}

function readLS(userId: string): UserPrefs {
  try {
    const raw = localStorage.getItem(lsKey(userId))
    if (raw) return JSON.parse(raw) as UserPrefs
  } catch { /* ignore */ }
  return {}
}

function writeLS(userId: string, prefs: UserPrefs) {
  try {
    localStorage.setItem(lsKey(userId), JSON.stringify(prefs))
  } catch { /* ignore */ }
}

export function useUserPrefs() {
  const { currentUser, userPrefs, setUserPrefs } = useAppStore()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Cancel debounce on unmount (prevents stale writes after logout) ─────────
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // ── Clear loaded flag on logout so next login re-fetches from Supabase ──────
  useEffect(() => {
    if (!currentUser) {
      _loadedFor.clear()
      return
    }

    const uid = currentUser.id

    // Immediately apply localStorage cache so UI is never blank
    const cached = readLS(uid)
    if (Object.keys(cached).length > 0) {
      setUserPrefs(cached)
    }

    if (_loadedFor.has(uid)) return
    _loadedFor.add(uid)

    // Fetch from Supabase, merge with localStorage (Supabase wins)
    supabase
      .from('app_users')
      .select('preferences')
      .eq('id', uid)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return
        const remote = (data.preferences as UserPrefs) || {}
        if (Object.keys(remote).length === 0) return
        // Merge: remote wins at top level key, but deep-merge col_widths so
        // locally-set widths for new tables aren't wiped by an older Supabase snapshot
        const merged: UserPrefs = {
          ...cached,
          ...remote,
          col_widths:    { ...cached.col_widths,    ...remote.col_widths },
          col_widths_v2: { ...cached.col_widths_v2, ...remote.col_widths_v2 },
          hidden_cols:   { ...cached.hidden_cols,   ...remote.hidden_cols },
          // ribbon_tabs: remote wins entirely (it's a full ordered list)
          ribbon_tabs: remote.ribbon_tabs ?? cached.ribbon_tabs,
        }
        setUserPrefs(merged)
        writeLS(uid, merged)
      })
  }, [currentUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPref = useCallback(
    <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => {
      if (!currentUser) return
      const uid = currentUser.id

      // Always read from store at call time — avoids stale closure issue when
      // multiple components write prefs in rapid succession
      const next: UserPrefs = { ...useAppStore.getState().userPrefs, [key]: value }

      // 1. Immediate in-memory update
      setUserPrefs(next)

      // 2. Immediate localStorage write
      writeLS(uid, next)

      // 3. Debounced Supabase write (2s)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        supabase
          .from('app_users')
          .update({ preferences: next })
          .eq('id', uid)
          .then(({ error }) => {
            if (error) console.warn('[useUserPrefs] Supabase sync failed:', error.message)
          })
      }, 2000)
    },
    [currentUser, setUserPrefs],
  )

  return { prefs: userPrefs, setPref }
}
