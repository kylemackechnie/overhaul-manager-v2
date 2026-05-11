import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import type { HelpNews, HelpDismissal } from '../types'

export interface NewsItemWithDismissed extends HelpNews {
  dismissed: boolean
}

interface UseHelpNewsResult {
  items: NewsItemWithDismissed[]
  unreadCount: number
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  dismiss: (newsId: string) => Promise<void>
  undismiss: (newsId: string) => Promise<void>
  // Admin-only mutations — caller is responsible for permission gating in UI
  create: (payload: { title: string; body_md: string; category: HelpNews['category']; pinned: boolean; published: boolean }) => Promise<HelpNews | null>
  update: (id: string, patch: Partial<Pick<HelpNews, 'title' | 'body_md' | 'category' | 'pinned' | 'published'>>) => Promise<HelpNews | null>
  remove: (id: string) => Promise<boolean>
}

/**
 * useHelpNews — fetches help_news + user's dismissals, merges them.
 *
 * Admins see drafts (where published = false) as well as published items;
 * non-admins only see published items (RLS enforces this, we don't filter client-side).
 */
export function useHelpNews(): UseHelpNewsResult {
  const { currentUser } = useAppStore()
  const [news, setNews] = useState<HelpNews[]>([])
  const [dismissals, setDismissals] = useState<HelpDismissal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    setError(null)
    try {
      const [newsRes, dismissRes] = await Promise.all([
        supabase
          .from('help_news')
          .select('*')
          // Pinned posts first (within published), then newest. Drafts (admin-only) fall last.
          .order('published', { ascending: false })
          .order('pinned', { ascending: false })
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('help_dismissals')
          .select('*')
          .eq('app_user_id', currentUser.id),
      ])
      if (newsRes.error) throw newsRes.error
      if (dismissRes.error) throw dismissRes.error
      setNews((newsRes.data ?? []) as HelpNews[])
      setDismissals((dismissRes.data ?? []) as HelpDismissal[])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load help news'
      setError(msg)
      console.error('[useHelpNews]', msg)
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const dismissedIds = new Set(dismissals.map(d => d.news_id))
  const items: NewsItemWithDismissed[] = news.map(n => ({ ...n, dismissed: dismissedIds.has(n.id) }))
  const unreadCount = items.filter(n => n.published && !n.dismissed).length

  const dismiss = useCallback(async (newsId: string) => {
    if (!currentUser) return
    // Optimistic
    setDismissals(prev => [...prev, { app_user_id: currentUser.id, news_id: newsId, dismissed_at: new Date().toISOString() }])
    const { error: err } = await supabase
      .from('help_dismissals')
      .insert({ app_user_id: currentUser.id, news_id: newsId })
    if (err) {
      // Roll back optimistic update
      setDismissals(prev => prev.filter(d => d.news_id !== newsId))
      console.error('[useHelpNews] dismiss failed:', err.message)
    }
  }, [currentUser])

  const undismiss = useCallback(async (newsId: string) => {
    if (!currentUser) return
    const prev = dismissals
    setDismissals(d => d.filter(x => x.news_id !== newsId))
    const { error: err } = await supabase
      .from('help_dismissals')
      .delete()
      .eq('app_user_id', currentUser.id)
      .eq('news_id', newsId)
    if (err) {
      setDismissals(prev)
      console.error('[useHelpNews] undismiss failed:', err.message)
    }
  }, [currentUser, dismissals])

  const create: UseHelpNewsResult['create'] = useCallback(async (payload) => {
    if (!currentUser) return null
    const row = {
      title: payload.title,
      body_md: payload.body_md,
      category: payload.category,
      pinned: payload.pinned,
      published: payload.published,
      published_at: payload.published ? new Date().toISOString() : null,
      created_by: currentUser.id,
    }
    const { data, error: err } = await supabase
      .from('help_news')
      .insert(row)
      .select()
      .single()
    if (err) {
      setError(err.message)
      return null
    }
    await refresh()
    return data as HelpNews
  }, [currentUser, refresh])

  const update: UseHelpNewsResult['update'] = useCallback(async (id, patch) => {
    // If toggling published from false→true and published_at is null, set it.
    // We need the current row to make that decision without a refresh.
    const current = news.find(n => n.id === id)
    const updates: Record<string, unknown> = { ...patch }
    if (current && patch.published === true && !current.published && !current.published_at) {
      updates.published_at = new Date().toISOString()
    }
    const { data, error: err } = await supabase
      .from('help_news')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (err) {
      setError(err.message)
      return null
    }
    await refresh()
    return data as HelpNews
  }, [news, refresh])

  const remove = useCallback(async (id: string) => {
    const { error: err } = await supabase
      .from('help_news')
      .delete()
      .eq('id', id)
    if (err) {
      setError(err.message)
      return false
    }
    await refresh()
    return true
  }, [refresh])

  return { items, unreadCount, loading, error, refresh, dismiss, undismiss, create, update, remove }
}
