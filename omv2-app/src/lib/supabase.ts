import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ewcbruqxhiehpdkaoimy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Y2JydXF4aGllaHBka2FvaW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5ODQ2NjUsImV4cCI6MjA5MjU2MDY2NX0.v8986ii8IjJnTR7OJLLCZvRvuyXH7iZo3IQ92Q24g8M'

// In-memory storage fallback — satisfies Supabase's Storage interface
// Used when localStorage/sessionStorage are blocked by tracking prevention
const memoryStore: Record<string, string> = {}
const inMemoryStorage: Storage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => { memoryStore[key] = value },
  removeItem: (key: string) => { delete memoryStore[key] },
  clear: () => { Object.keys(memoryStore).forEach(k => delete memoryStore[k]) },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  get length() { return Object.keys(memoryStore).length },
}

// Pick the best available storage — localStorage > sessionStorage > memory
function getBestStorage(): Storage {
  try {
    const t = '__om__'
    window.localStorage.setItem(t, '1')
    window.localStorage.removeItem(t)
    return window.localStorage
  } catch { /* blocked */ }
  try {
    const t = '__om__'
    window.sessionStorage.setItem(t, '1')
    window.sessionStorage.removeItem(t)
    return window.sessionStorage
  } catch { /* blocked */ }
  return inMemoryStorage
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'om-v2-auth',
    storage: getBestStorage(),
  }
})

