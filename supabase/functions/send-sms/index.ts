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
    // Auth check — same pattern as send-email
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

    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { to, message } = await req.json()

    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, message' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate phone format (E.164: + followed by 7–14 digits)
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number format. Use E.164 (e.g. +12125551234)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate message length
    if (message.length > 1600) {
      return new Response(JSON.stringify({ error: 'Message too long (max 1600 characters)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rate limit: max 5 SMS to same number per hour
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await adminClient
      .from('email_log')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_email', to)
      .eq('channel', 'sms')
      .gte('created_at', oneHourAgo)
    if ((count ?? 0) >= 5) {
      return new Response(JSON.stringify({ error: 'Rate limit: max 5 SMS per number per hour' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')!

    console.log('[send-sms] Sending to:', to, '| length:', message.length)

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: fromNumber, To: to, Body: message }).toString(),
      }
    )

    const data = await response.json()
    console.log('[send-sms] Twilio response:', JSON.stringify({ status: data.status, sid: data.sid, error: data.message }))

    if (!response.ok) {
      throw new Error(data.message || `Twilio error ${response.status}`)
    }

    // Log to email_log for audit trail and rate limiting
    const { data: callerUser } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', authUser.id)
      .single()
    await adminClient.from('email_log').insert({
      org_id: callerUser?.org_id || null,
      sent_by: authUser.id,
      recipient_email: to,
      email_type: 'sms',
      subject: message.substring(0, 100),
      twilio_message_sid: data.sid || null,
      status: 'sent',
      channel: 'sms',
    })

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[send-sms] Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
