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
 * Usage:
 *   const { prefs, setPref } = useUserPrefs()
 *   setPref('col_widths', { ...prefs.col_widths, [tableId]: newWidths })
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

  // Load prefs on mount (once per userId per session)
  useEffect(() => {
    if (!currentUser) return
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
        // Merge: remote wins at the top level key, but we deep-merge col_widths
        // so locally-set widths for new tables aren't wiped by an older Supabase snapshot
        const merged: UserPrefs = {
          ...cached,
          ...remote,
          col_widths: { ...cached.col_widths, ...remote.col_widths },
        }
        setUserPrefs(merged)
        writeLS(uid, merged)
      })
  }, [currentUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear loaded flag when user changes (logout → new login)
  useEffect(() => {
    if (!currentUser) {
      // Reset so next login re-fetches
      // (don't clear _loadedFor globally — just on logout)
    }
  }, [currentUser?.id])

  const setPref = useCallback(
    <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => {
      if (!currentUser) return
      const uid = currentUser.id

      // Build next prefs — use store's current value (captured in callback)
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
