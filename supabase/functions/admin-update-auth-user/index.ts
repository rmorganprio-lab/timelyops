import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const anonClient = createClient(supabaseUrl, supabaseAnonKey)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verify JWT
    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Server-side platform admin check — never trust the frontend
    const { data: callerUser } = await adminClient
      .from('users')
      .select('is_platform_admin, name, role')
      .eq('id', authUser.id)
      .single()

    if (!callerUser?.is_platform_admin) {
      return new Response(JSON.stringify({ error: 'Forbidden: platform admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { create_user, user_id, auth_user_id, email, phone } = body

    // ── Branch: create a new auth user and link the public.users row ──
    if (create_user) {
      if (!user_id || !phone) {
        return new Response(JSON.stringify({ error: 'create_user requires user_id and phone' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        return new Response(JSON.stringify({ error: 'Invalid phone format. Use E.164 (e.g. +12125551234)' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: newAuthUser, error: createError } = await adminClient.auth.admin.createUser({
        phone,
        phone_confirm: true,
      })

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Update public.users: set id to the real auth UUID and mark linked
      const { error: updateError } = await adminClient
        .from('users')
        .update({ id: newAuthUser.user.id, auth_linked: true })
        .eq('id', user_id)

      if (updateError) {
        // Auth user was created — clean it up to avoid orphan, then fail
        await adminClient.auth.admin.deleteUser(newAuthUser.user.id)
        return new Response(JSON.stringify({ error: 'Failed to link public.users row: ' + updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await adminClient.from('audit_log').insert({
        org_id: null,
        user_id: authUser.id,
        user_name: callerUser.name || 'Platform Admin',
        user_role: callerUser.role || 'admin',
        is_admin_action: true,
        action: 'create',
        entity_type: 'auth_user',
        entity_id: newAuthUser.user.id,
        changes: { phone, public_user_id: user_id },
        metadata: { source: 'admin_panel', performed_by: authUser.id },
      })

      return new Response(JSON.stringify({ success: true, auth_user_id: newAuthUser.user.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Branch: update an existing auth user ──
    if (!auth_user_id) {
      return new Response(JSON.stringify({ error: 'Missing required field: auth_user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!email && !phone) {
      return new Response(JSON.stringify({ error: 'Provide at least one of: email, phone' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate formats
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
      return new Response(JSON.stringify({ error: 'Invalid phone format. Use E.164 (e.g. +12125551234)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build update payload
    const updatePayload: { email?: string; phone?: string } = {}
    if (email) updatePayload.email = email.toLowerCase().trim()
    if (phone) updatePayload.phone = phone.trim()

    // Update auth.users via admin API
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      auth_user_id,
      updatePayload
    )

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Log to audit_log
    await adminClient.from('audit_log').insert({
      org_id: null,
      user_id: authUser.id,
      user_name: callerUser.name || 'Platform Admin',
      user_role: callerUser.role || 'admin',
      is_admin_action: true,
      action: 'update',
      entity_type: 'auth_user',
      entity_id: auth_user_id,
      changes: updatePayload,
      metadata: { source: 'admin_panel', performed_by: authUser.id },
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[admin-update-auth-user] Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
