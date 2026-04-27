// invite-user — sends a Supabase auth invite email using the service role.
//
// The browser anon key cannot call admin.inviteUserByEmail. signInWithOtp
// requires "Allow new signups" to be enabled, which we don't want for a
// closed tool. This function bridges that gap: it uses the service role
// to send the invite, but only after verifying the caller is an active
// admin via their forwarded JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface InvitePayload {
  email: string
  name?: string
  role?: string  // for the metadata payload, not for app_users (that's already been written)
  redirect_to?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify caller — extract JWT, look up their app_users row, check admin
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization header' }, 401)
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userRes, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userRes?.user) {
      return json({ error: 'Invalid token' }, 401)
    }
    const callerAuthId = userRes.user.id

    // Check the caller is an active admin (use service role here so RLS
    // can't accidentally hide the row — e.g. if policies are tightened later)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: callerRow, error: callerErr } = await admin
      .from('app_users')
      .select('role,active')
      .eq('auth_id', callerAuthId)
      .single()
    if (callerErr || !callerRow || callerRow.role !== 'admin' || !callerRow.active) {
      return json({ error: 'Admin only' }, 403)
    }

    // Parse payload
    const body = (await req.json().catch(() => null)) as InvitePayload | null
    if (!body?.email) {
      return json({ error: 'email is required' }, 400)
    }
    const email = body.email.trim().toLowerCase()
    if (!email.includes('@')) {
      return json({ error: 'Invalid email' }, 400)
    }

    // Send the invite — Supabase emails the user a link that lets them set
    // a password and sign in. This creates the auth.users row server-side
    // (no signup-allowed setting needed).
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        data: { name: body.name || '', invited_role: body.role || 'member' },
        redirectTo: body.redirect_to,
      }
    )
    if (invErr) {
      return json({ error: invErr.message }, 400)
    }

    return json({ ok: true, user_id: invited?.user?.id ?? null }, 200)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
