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

    // CRITICAL: On refresh, Supabase fires SIGNED_IN almost immediately with a
    // STALE session whose JWT is expired. PostgREST queries against that JWT will
    // hang on the auth lock until the token refresh completes (which can take
    // 30+ seconds on slow networks or when storage was cleared by tracking
    // prevention). The ONLY events that signal a usable JWT are:
    //   - INITIAL_SESSION (fires on refresh AFTER token refresh completes)
    //   - TOKEN_REFRESHED (fires when an active session refreshes its token)
    //   - SIGNED_IN with no prior INITIAL_SESSION (fresh login from LoginPage)
    //
    // We track whether we've seen INITIAL_SESSION yet — if not, we ignore the
    // first SIGNED_IN because it's a stale-token replay. Once INITIAL_SESSION
    // fires (which means the auth refresh has completed), subsequent SIGNED_IN
    // events are genuine fresh logins.
    let initialSessionSeen = false
    let hasLoaded = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[useAuth] ${ms()} auth event:`, event, '| uid:', session?.user?.id ?? 'NONE', '| initialSeen:', initialSessionSeen, '| hasLoaded:', hasLoaded)

      if (event === 'INITIAL_SESSION') {
        initialSessionSeen = true
        if (session?.user && !hasLoaded) {
          hasLoaded = true
          await loadAppUser(session.user.id)
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        if (!initialSessionSeen) {
          // Stale-token replay during cold-start refresh — ignore it.
          // The real INITIAL_SESSION event will fire after the token refresh
          // completes and we'll load app_user from there.
          console.log(`[useAuth] ${ms()} ignoring stale SIGNED_IN (waiting for INITIAL_SESSION)`)
          return
        }
        if (!hasLoaded) {
          hasLoaded = true
          await loadAppUser(session.user.id)
          // Update last_login (fire-and-forget)
          supabase
            .from('app_users')
            .update({ last_login: new Date().toISOString() })
            .eq('auth_id', session.user.id)
            .then(({ error }) => {
              if (error) console.warn('[useAuth] last_login update failed:', error.message)
            })
        }
      } else if (event === 'TOKEN_REFRESHED') {
        // No-op — token rolled, currentUser already loaded
      } else if (event === 'SIGNED_OUT') {
        hasLoaded = false
        setCurrentUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadAppUser(authId: string) {
    const t0 = performance.now()
    const ms = () => `+${Math.round(performance.now() - t0)}ms`
    console.log(`[useAuth] ${ms()} loadAppUser(${authId.slice(0, 8)}...) called`)
    // bootstrap_app_user() runs server-side (SECURITY DEFINER) and handles
    // all three cases in one shot:
    //   1. existing row → return it
    //   2. invited row with auth_id NULL → link and return
    //   3. brand-new auth user → create a viewer row and return
    // Doing this server-side bypasses the RLS edge cases that previously caused
    // silent failures (e.g. user logs in, has an auth row but no app_users row,
    // and the UI renders blank with no error surfaced).
    const queryTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('bootstrap_app_user query hung for 8s')), 8000)
    )
    try {
      const result = await Promise.race([
        supabase.rpc('bootstrap_app_user').single(),
        queryTimeout,
      ])
      const { data, error } = result
      console.log(`[useAuth] ${ms()} bootstrap resolved | data:`, !!data, '| error:', error?.message ?? 'none')

      if (error || !data) {
        console.error(`[useAuth] ${ms()} bootstrap failed:`, error?.message ?? 'no data')
        return
      }

      const user = data as AppUser & { force_password_reset?: boolean }
      if (user.force_password_reset) {
        sessionStorage.setItem('force_password_reset', '1')
      }
      setCurrentUser(user as AppUser)
      console.log(`[useAuth] ${ms()} currentUser set`)
    } catch (e) {
      console.error(`[useAuth] ${ms()} loadAppUser failed:`, (e as Error).message)
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
