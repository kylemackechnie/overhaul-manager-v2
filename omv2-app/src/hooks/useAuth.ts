import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import type { AppUser } from '../types'

export function useAuth() {
  const { currentUser, setCurrentUser } = useAppStore()

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadAppUser(session.user.id)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await loadAppUser(session.user.id)
        // Update last_login
        await supabase
          .from('app_users')
          .update({ last_login: new Date().toISOString() })
          .eq('auth_id', session.user.id)
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadAppUser(authId: string) {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('auth_id', authId)
      .single()

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
