import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Mirror of tiers.js hasFeature — keeps Edge Function self-contained
function hasFeature(
  org: { subscription_tier: string; add_ons: unknown },
  slug: string
): boolean {
  const tierOrder = ['starter', 'professional', 'growth']
  const tierFeatures: Record<string, string[]> = {
    starter: ['dashboard', 'clients', 'workers', 'schedule', 'quotes', 'payments', 'invoices', 'reports_view', 'client_timeline', 'worker_checkin_time'],
    professional: ['reports_export', 'automated_reminders', 'job_checklists', 'worker_gps_checkin', 'auto_review_requests'],
    growth: ['ai_lead_agents', 'client_booking_portal', 'quickbooks_sync', 'supply_tracking'],
  }
  const orgTierIndex = tierOrder.indexOf(org.subscription_tier || 'starter')
  for (let i = 0; i <= orgTierIndex; i++) {
    if ((tierFeatures[tierOrder[i]] || []).includes(slug)) return true
  }
  const addOns = Array.isArray(org.add_ons) ? org.add_ons : []
  return addOns.includes(slug)
}

// Tool definitions passed to Claude
const TOOL_DEFINITIONS = [
  {
    name: 'get_service_types',
    description: 'Get the list of services offered by this business.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'check_availability',
    description: 'Check whether a specific date has open capacity for a new booking.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_pricing',
    description: 'Look up the price for a service based on size and frequency.',
    input_schema: {
      type: 'object',
      properties: {
        service_type_id: { type: 'string' },
        bedrooms: { type: 'number' },
        bathrooms: { type: 'number' },
        frequency: {
          type: 'string',
          description: 'one_time, weekly, biweekly, or monthly',
        },
      },
      required: ['service_type_id', 'bedrooms', 'bathrooms', 'frequency'],
    },
  },
  {
    name: 'create_pending_job',
    description:
      'Create the booking request once all required info is collected and the customer has confirmed the quote.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string', description: 'Empty string if unknown' },
        phone: { type: 'string', description: 'E.164 format, e.g. +12125551234' },
        address: { type: 'string', description: 'Full service address' },
        service_type_id: { type: 'string' },
        service_type_name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string', description: 'HH:MM or empty string if flexible' },
        bedrooms: { type: 'number' },
        bathrooms: { type: 'number' },
        frequency: { type: 'string' },
        price: { type: 'number', description: 'Agreed price in dollars' },
        notes: { type: 'string', description: 'Additional notes from the customer' },
      },
      required: [
        'first_name', 'phone', 'service_type_id', 'service_type_name',
        'date', 'bedrooms', 'bathrooms', 'frequency', 'price',
      ],
    },
  },
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!

  const db = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const body = await req.json()
    const { org_slug, conversation_id: existingConvId, message } = body

    if (!org_slug || !message?.trim()) {
      return json({ error: 'org_slug and message are required' }, 400)
    }

    // ── Resolve org ──────────────────────────────────────────────
    const { data: org, error: orgError } = await db
      .from('organizations')
      .select('id, name, subscription_tier, add_ons, subscription_status')
      .eq('slug', org_slug)
      .single()

    if (orgError || !org) {
      return json({ error: 'Organization not found' }, 404)
    }

    if (!hasFeature(org, 'ai_lead_agents')) {
      return json({ error: 'Booking agent not available for this organization.' }, 403)
    }

    // ── Load or create conversation ───────────────────────────────
    type Message = { role: string; content: string; ts: string }
    type ConvState = Record<string, unknown>
    type Conversation = {
      id: string
      org_id: string
      messages: Message[]
      state: ConvState
      job_id: string | null
    }

    let conv: Conversation | null = null

    if (existingConvId) {
      const { data } = await db
        .from('booking_conversations')
        .select('*')
        .eq('id', existingConvId)
        .eq('org_id', org.id)
        .single()
      conv = data
    }

    if (!conv) {
      const { data: newConv, error: createErr } = await db
        .from('booking_conversations')
        .insert({ org_id: org.id, channel: 'web', messages: [], state: {} })
        .select()
        .single()
      if (createErr || !newConv) throw new Error('Failed to create conversation')
      conv = newConv as Conversation
    }

    // Rate limit: max 10 messages per conversation
    const history = (conv.messages || []) as Message[]
    if (history.length >= 10) {
      return json(
        { error: 'Conversation limit reached. Please contact us directly to book.' },
        429
      )
    }

    // ── Fetch service types for context ──────────────────────────
    const { data: serviceTypes } = await db
      .from('service_types')
      .select('id, name, default_duration_minutes')
      .eq('org_id', org.id)
      .eq('is_active', true)

    const serviceList = (serviceTypes || [])
      .map((s: { id: string; name: string }) => `- ${s.name} (id: ${s.id})`)
      .join('\n')

    // ── Build system prompt ───────────────────────────────────────
    const stateDesc =
      Object.keys(conv.state).length > 0
        ? `\nAlready collected:\n${JSON.stringify(conv.state, null, 2)}`
        : ''

    const today = new Date().toISOString().slice(0, 10)

    const systemPrompt = `You are a friendly booking assistant for ${org.name}, a professional cleaning service. Help the customer book a cleaning appointment.

Today's date is ${today}. Use this to resolve relative date references like "next Tuesday" or "this weekend" — convert them to YYYY-MM-DD before calling any tool.

Available services:
${serviceList || '(use get_service_types to load services)'}
${stateDesc}

Your goal is to collect the following naturally through conversation:
- Service type (e.g. standard clean, deep clean)
- Home size: bedrooms and bathrooms
- Frequency (one_time, weekly, biweekly, or monthly)
- Preferred date — accept anything like "next Friday", "the 15th", "sometime next week"
- Customer's first name and phone number

Do NOT ask for their address. It will be collected later when the team confirms.

Conversational rules:
- Write in plain prose, never use bullet points or numbered lists in your responses
- Pick up multiple pieces of info from a single message when the customer volunteers them — don't ask again for things they already said
- Ask for at most 2 pieces of information at a time
- Keep responses short and warm
- When you have service type, size, and frequency, call get_pricing and share the quote
- After the customer agrees to the price, ask for their name and phone number, then call create_pending_job
- After create_pending_job succeeds, tell them their request is submitted and ${org.name} will confirm shortly`

    // ── Build initial Claude API messages from history ────────────
    const baseMessages: Array<{ role: string; content: unknown }> = history.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    baseMessages.push({ role: 'user', content: message.trim() })

    // ── Agentic loop ──────────────────────────────────────────────
    let reply = ''
    let jobCreated = false
    let updatedState = { ...conv.state }
    const loopMessages = [...baseMessages]

    async function executeTool(
      toolName: string,
      input: Record<string, unknown>
    ): Promise<unknown> {
      // ── get_service_types ──
      if (toolName === 'get_service_types') {
        const { data } = await db
          .from('service_types')
          .select('id, name, default_duration_minutes')
          .eq('org_id', org.id)
          .eq('is_active', true)
        return { service_types: data || [] }
      }

      // ── check_availability ──
      if (toolName === 'check_availability') {
        const date = input.date as string
        const { data: jobs } = await db
          .from('jobs')
          .select('start_time, duration_minutes')
          .eq('org_id', org.id)
          .eq('date', date)
          .not('status', 'in', '(cancelled,pending_confirmation)')
        const slots = (jobs || []).map((j: { start_time: string; duration_minutes: number }) => ({
          start: j.start_time,
          duration_minutes: j.duration_minutes,
        }))
        return {
          date,
          booked_slots: slots,
          summary:
            slots.length === 0
              ? 'Date looks open.'
              : `${slots.length} booking(s) already scheduled this day.`,
        }
      }

      // ── get_pricing ──
      if (toolName === 'get_pricing') {
        const { service_type_id, bedrooms, bathrooms, frequency } = input as {
          service_type_id: string
          bedrooms: number
          bathrooms: number
          frequency: string
        }
        const { data: row } = await db
          .from('pricing_matrix')
          .select('price')
          .eq('org_id', org.id)
          .eq('service_type_id', service_type_id)
          .eq('bedrooms', bedrooms)
          .eq('bathrooms', bathrooms)
          .eq('frequency', frequency)
          .maybeSingle()

        if (row) {
          updatedState = { ...updatedState, price_quoted: row.price }
          return { price: row.price, found: true }
        }
        return {
          found: false,
          message: 'No price configured for this combination. Tell the customer the team will confirm pricing.',
        }
      }

      // ── create_pending_job ──
      if (toolName === 'create_pending_job') {
        const {
          first_name, last_name, phone,
          service_type_id, service_type_name,
          date, start_time,
          bedrooms, bathrooms, frequency, price, notes,
        } = input as Record<string, string | number>
        const address = (input.address as string | undefined) ?? null

        // Create client record (lead status)
        const fullName = last_name ? `${first_name} ${last_name}` : String(first_name)
        const { data: client, error: clientErr } = await db
          .from('clients')
          .insert({
            org_id: org.id,
            first_name: String(first_name),
            last_name: last_name ? String(last_name) : null,
            name: fullName,
            phone: String(phone),
            address: address ?? null,
            status: 'lead',
            notes: 'Created via AI booking agent',
          })
          .select('id')
          .single()

        if (clientErr || !client) {
          console.error('[booking-agent] Client insert error:', clientErr?.message)
          return { success: false, error: `Failed to create client: ${clientErr?.message}` }
        }

        // Create job
        const jobTitle = `${service_type_name} — ${bedrooms}bd/${bathrooms}ba`
        const { data: job, error: jobErr } = await db
          .from('jobs')
          .insert({
            org_id: org.id,
            client_id: client.id,
            service_type_id: String(service_type_id),
            title: jobTitle,
            date: String(date),
            start_time: start_time ? String(start_time) : null,
            status: 'pending_confirmation',
            source: 'web_booking',
            price: Number(price),
            frequency: String(frequency),
            notes: notes
              ? `Booked via web agent. ${notes}`
              : 'Booked via web agent.',
          })
          .select('id')
          .single()

        if (jobErr || !job) {
          console.error('[booking-agent] Job insert error:', jobErr?.message)
          return { success: false, error: `Failed to create job: ${jobErr?.message}` }
        }

        jobCreated = true
        updatedState = { ...updatedState, job_created: true }

        // Link job to conversation
        await db
          .from('booking_conversations')
          .update({
            job_id: job.id,
            contact_name: fullName,
            contact_phone: String(phone),
            state: updatedState,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conv!.id)

        // Notify org owners via SMS
        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
        const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
        const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

        if (accountSid && authToken && fromNumber) {
          const { data: owners } = await db
            .from('users')
            .select('phone')
            .eq('org_id', org.id)
            .eq('role', 'owner')
            .not('phone', 'is', null)

          const smsBody = [
            `New booking request via ${org.name} website!`,
            `${fullName} | ${phone}`,
            `${service_type_name}, ${bedrooms}bd/${bathrooms}ba, ${frequency}`,
            `Date: ${date}${start_time ? ' at ' + start_time : ''}`,
            address ? `Address: ${address}` : null,
            `Price: $${price}`,
            `Log in to TimelyOps to confirm.`,
          ].filter(Boolean).join('\n')

          for (const owner of owners || []) {
            if (!owner.phone) continue
            try {
              await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: 'Basic ' + btoa(`${accountSid}:${authToken}`),
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({
                    From: fromNumber,
                    To: owner.phone,
                    Body: smsBody,
                  }).toString(),
                }
              )
            } catch (e) {
              console.error('[booking-agent] Owner SMS failed:', e)
            }
          }
        }

        return {
          success: true,
          job_id: job.id,
          message: 'Booking request created. The team will confirm shortly.',
        }
      }

      return { error: `Unknown tool: ${toolName}` }
    }

    // Up to 6 Claude calls (5 tool rounds + final response)
    for (let i = 0; i < 6; i++) {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          tools: TOOL_DEFINITIONS,
          messages: loopMessages,
        }),
      })

      if (!claudeRes.ok) {
        const errText = await claudeRes.text()
        throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
      }

      const claudeData = await claudeRes.json()

      if (claudeData.stop_reason === 'end_turn') {
        reply = (claudeData.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('')
        break
      }

      if (claudeData.stop_reason === 'tool_use') {
        const toolUseBlocks = (claudeData.content as Array<{
          type: string
          id: string
          name: string
          input: Record<string, unknown>
        }>).filter((b) => b.type === 'tool_use')

        // Add assistant turn (includes tool_use blocks)
        loopMessages.push({ role: 'assistant', content: claudeData.content })

        // Execute tools and collect results
        const toolResults = []
        for (const block of toolUseBlocks) {
          const result = await executeTool(block.name, block.input)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        }

        // Add tool results as user turn
        loopMessages.push({ role: 'user', content: toolResults })
        continue
      }

      // Unexpected stop — extract any text and bail
      reply = (claudeData.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
      break
    }

    if (!reply) reply = "I'm sorry, I ran into an issue. Please try again or contact us directly."

    // ── Save updated conversation ─────────────────────────────────
    const now = new Date().toISOString()
    const updatedMessages: Message[] = [
      ...history,
      { role: 'user', content: message.trim(), ts: now },
      { role: 'assistant', content: reply, ts: now },
    ]

    await db
      .from('booking_conversations')
      .update({ messages: updatedMessages, state: updatedState, updated_at: now })
      .eq('id', conv.id)

    return json({ conversation_id: conv.id, reply, job_created: jobCreated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[booking-agent] Error:', msg)
    return json({ error: msg }, 500)
  }
})
