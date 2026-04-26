import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import type { AppUser } from '../types'

export function useAuth() {
  const { currentUser, setCurrentUser } = useAppStore()

  useEffect(() => {
    const t0 = performance.now()
    const ms = () => `+${Math.round(performance.now() - t0)}ms`
    console.log(`[useAuth] ${ms()} effect mounted`)

    // NO getSession() call — it serializes through the same internal auth lock as the
    // token refresh that runs on cold start, causing all concurrent auth calls to hang
    // for 5+ seconds. The auth listener below covers both fresh signins (SIGNED_IN)
    // and page refreshes with stored sessions (INITIAL_SESSION) — that's all we need.

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[useAuth] ${ms()} auth event:`, event, '| uid:', session?.user?.id ?? 'NONE')
      if (event === 'SIGNED_IN' && session?.user) {
        await loadAppUser(session.user.id)
        // Update last_login (fire-and-forget — don't block on it)
        supabase
          .from('app_users')
          .update({ last_login: new Date().toISOString() })
          .eq('auth_id', session.user.id)
          .then(({ error }) => {
            if (error) console.warn('[useAuth] last_login update failed:', error.message)
          })
      } else if (event === 'INITIAL_SESSION' && session?.user) {
        // Fires on page refresh when a valid session is already in storage
        await loadAppUser(session.user.id)
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Token rolled over — no need to reload app_user, just keep listening
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadAppUser(authId: string, attempt = 1) {
    const t0 = performance.now()
    const ms = () => `+${Math.round(performance.now() - t0)}ms`
    console.log(`[useAuth] ${ms()} loadAppUser(${authId.slice(0, 8)}...) called (attempt ${attempt})`)
    // Use a tighter timeout on early attempts — if the JWT isn't ready, the query
    // will hang waiting on the auth lock, and we want to retry quickly rather than
    // spend 8s on a doomed first attempt.
    const timeoutMs = attempt === 1 ? 2000 : 8000
    const queryTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`loadAppUser query hung for ${timeoutMs}ms (attempt ${attempt})`)), timeoutMs)
    )
    try {
      const result = await Promise.race([
        supabase.from('app_users').select('*').eq('auth_id', authId).single(),
        queryTimeout,
      ])
      const { data, error } = result
      console.log(`[useAuth] ${ms()} loadAppUser query resolved | data:`, !!data, '| error:', error?.message ?? 'none')

      if (error || !data) {
        // First login — create app_user record
        const { data: authUser } = await supabase.auth.getUser()
        if (authUser?.user) {
          const newUser: Partial<AppUser> = {
            auth_id: authUser.user.id,
            email: authUser.user.email || '',
            name: authUser.user.user_metadata?.name || authUser.user.email || '',
            role: 'viewer',
            permissions: {},
            active: true,
          }
          const { data: created } = await supabase
            .from('app_users')
            .insert(newUser)
            .select()
            .single()
          if (created) setCurrentUser(created as AppUser)
        }
        return
      }

      setCurrentUser(data as AppUser)
      console.log(`[useAuth] ${ms()} currentUser set`)
    } catch (e) {
      console.warn(`[useAuth] ${ms()} loadAppUser attempt ${attempt} failed:`, (e as Error).message)
      if (attempt < 5) {
        // Exponential-ish backoff: 500ms, 1s, 2s, 3s — gives the token refresh
        // time to complete before retrying. Total max wait ~6.5s before giving up.
        const backoff = attempt === 1 ? 500 : attempt === 2 ? 1000 : attempt === 3 ? 2000 : 3000
        console.log(`[useAuth] ${ms()} retrying in ${backoff}ms...`)
        await new Promise(r => setTimeout(r, backoff))
        return loadAppUser(authId, attempt + 1)
      }
      console.error(`[useAuth] ${ms()} loadAppUser exhausted retries`)
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
    setCurrentUser(null)
  }

  async function sendMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) throw error
  }

  return { currentUser, signIn, signOut, sendMagicLink }
}
