import { createClient } from '@supabase/supabase-js'

// Use same-origin proxy in production to avoid Safari ITP blocking cross-origin requests
const isProd = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
const SUPABASE_URL = isProd
  ? window.location.origin + '/api/sb'
  : 'https://ewcbruqxhiehpdkaoimy.supabase.co'

const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Y2JydXF4aGllaHBka2FvaW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5ODQ2NjUsImV4cCI6MjA5MjU2MDY2NX0.v8986ii8IjJnTR7OJLLCZvRvuyXH7iZo3IQ92Q24g8M'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'om-v2-auth',
    storage: window.localStorage,
    detectSessionInUrl: true,
  }
})
