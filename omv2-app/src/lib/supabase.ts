import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ewcbruqxhiehpdkaoimy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Y2JydXF4aGllaHBka2FvaW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5ODQ2NjUsImV4cCI6MjA5MjU2MDY2NX0.v8986ii8IjJnTR7OJLLCZvRvuyXH7iZo3IQ92Q24g8M'

// Test if localStorage is available — tracking prevention can block it
function getStorage(): Storage | undefined {
  try {
    const test = '__om_test__'
    window.localStorage.setItem(test, '1')
    window.localStorage.removeItem(test)
    return window.localStorage
  } catch {
    // localStorage blocked — fall back to sessionStorage, then memory
    try {
      const test = '__om_test__'
      window.sessionStorage.setItem(test, '1')
      window.sessionStorage.removeItem(test)
      console.warn('localStorage blocked — using sessionStorage for auth (session will not persist across tabs)')
      return window.sessionStorage
    } catch {
      console.warn('Both localStorage and sessionStorage blocked — auth will not persist')
      return undefined
    }
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'om-v2-auth',
    storage: getStorage(),
  }
})
