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

    // Get initial session — wrap in timeout so a hang surfaces in the console
    console.log(`[useAuth] ${ms()} calling getSession()...`)
    const sessionTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('useAuth getSession() hung for 5s')), 5000)
    )
    Promise.race([supabase.auth.getSession(), sessionTimeout])
      .then(({ data: { session } }) => {
        console.log(`[useAuth] ${ms()} getSession() resolved | uid:`, session?.user?.id ?? 'NONE')
        if (session?.user) {
          loadAppUser(session.user.id)
        }
      })
      .catch(err => {
        console.error(`[useAuth] ${ms()} getSession() failed:`, err.message)
      })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[useAuth] ${ms()} auth event:`, event, '| uid:', session?.user?.id ?? 'NONE')
      if (event === 'SIGNED_IN' && session?.user) {
        await loadAppUser(session.user.id)
        // Update last_login
        await supabase
          .from('app_users')
          .update({ last_login: new Date().toISOString() })
          .eq('auth_id', session.user.id)
      } else if (event === 'INITIAL_SESSION' && session?.user) {
        // On refresh, INITIAL_SESSION fires — must load app_user from this path too
        // (the getSession() call above may hang and never trigger loadAppUser)
        await loadAppUser(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadAppUser(authId: string) {
    const t0 = performance.now()
    const ms = () => `+${Math.round(performance.now() - t0)}ms`
    console.log(`[useAuth] ${ms()} loadAppUser(${authId.slice(0, 8)}...) called`)
    const queryTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('loadAppUser query hung for 8s')), 8000)
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
      console.error(`[useAuth] ${ms()} loadAppUser failed:`, e)
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
