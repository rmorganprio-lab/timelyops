import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Resend email helper ─────────────────────────────────────────

async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  fromName: string
  replyTo?: string
}): Promise<{ id?: string; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${opts.fromName} via TimelyOps <notifications@timelyops.com>`,
      to: [opts.to],
      reply_to: opts.replyTo,
      subject: opts.subject,
      html: opts.html,
    }),
  })
  const data = await res.json()
  if (!res.ok) return { error: data.message ?? 'Resend error' }
  return { id: data.id }
}

// ─── Email templates ─────────────────────────────────────────────

function emailWrapper(orgName: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f4;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr>
          <td style="background-color:#047857;padding:24px 32px;">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${orgName}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;background-color:#fafaf9;border-top:1px solid #e7e5e4;text-align:center;">
            <span style="font-size:12px;color:#a8a29e;">
              Powered by <a href="https://timelyops.com" style="color:#047857;text-decoration:none;font-weight:600;">TimelyOps</a>
            </span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

function templateQuoteApprovedNotification(orgName: string, quoteNumber: string, clientName: string, total: number): string {
  return emailWrapper(escapeHtml(orgName), `
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1c1917;">Quote approved</p>
    <p style="margin:0 0 24px;font-size:15px;color:#57534e;">${escapeHtml(clientName)} has approved Quote #${escapeHtml(quoteNumber)} (${fmtCurrency(total)}).</p>
    <p style="margin:0;font-size:14px;color:#78716c;">Log in to TimelyOps to create an invoice or schedule the work.</p>
  `)
}

function templateQuoteDeclinedNotification(orgName: string, quoteNumber: string, clientName: string, total: number, reason?: string): string {
  const reasonBlock = reason
    ? `<div style="margin:16px 0 0;padding:12px 16px;background-color:#fef2f2;border-left:3px solid #f87171;border-radius:4px;"><p style="margin:0;font-size:13px;color:#991b1b;font-style:italic;">"${escapeHtml(reason)}"</p></div>`
    : ''
  return emailWrapper(escapeHtml(orgName), `
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1c1917;">Quote declined</p>
    <p style="margin:0 0 4px;font-size:15px;color:#57534e;">${escapeHtml(clientName)} has declined Quote #${escapeHtml(quoteNumber)} (${fmtCurrency(total)}).</p>
    ${reasonBlock}
    <p style="margin:16px 0 0;font-size:14px;color:#78716c;">Log in to TimelyOps to follow up or revise the quote.</p>
  `)
}

// ─── Main handler ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const { action, token, reason } = body

    if (!action || !token) {
      return new Response(JSON.stringify({ error: 'action and token are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── get_invoice ──────────────────────────────────────────────
    if (action === 'get_invoice') {
      const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, status, issue_date, due_date, total, subtotal, tax_amount,
          notes, view_token,
          clients(id, name),
          organizations(name),
          invoice_line_items(id, description, quantity, unit_price, total)
        `)
        .eq('view_token', token)
        .single()

      console.log('[quote-action] get_invoice result:', JSON.stringify({ data: !!invoice, error }))
      if (error || !invoice) {
        return new Response(JSON.stringify({ error: 'Invoice not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ invoice }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── get_quote ────────────────────────────────────────────────
    if (action === 'get_quote') {
      const { data: quote, error } = await supabase
        .from('quotes')
        .select(`
          id, quote_number, status, created_at, valid_until, total, subtotal, tax_amount,
          notes, approval_token, approved_at, declined_at, decline_reason,
          clients(id, name),
          organizations(name),
          quote_line_items(id, description, quantity, unit_price, total, sort_order)
        `)
        .eq('approval_token', token)
        .single()

      console.log('[quote-action] get_quote result:', JSON.stringify({ data: !!quote, error }))
      if (error || !quote) {
        return new Response(JSON.stringify({ error: 'Quote not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ quote }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── approve_quote ────────────────────────────────────────────
    if (action === 'approve_quote') {
      // Fetch quote first to validate token and check current state
      const { data: quote, error: fetchError } = await supabase
        .from('quotes')
        .select(`
          id, quote_number, status, total, approval_token, approved_at, declined_at, valid_until,
          clients(name),
          organizations(id, name)
        `)
        .eq('approval_token', token)
        .single()

      console.log('[quote-action] approve_quote result:', JSON.stringify({ data: !!quote, error: fetchError }))
      if (fetchError || !quote) {
        return new Response(JSON.stringify({ error: 'Quote not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (quote.approved_at) {
        return new Response(JSON.stringify({ error: 'already_approved' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (quote.declined_at) {
        return new Response(JSON.stringify({ error: 'already_declined' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
        return new Response(JSON.stringify({ error: 'quote_expired' }), {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error: updateError } = await supabase
        .from('quotes')
        .update({ approved_at: new Date().toISOString(), status: 'approved' })
        .eq('id', quote.id)

      if (updateError) {
        return new Response(JSON.stringify({ error: 'Failed to update quote' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Notify org owner
      const org = quote.organizations as any
      const client = quote.clients as any
      const { data: owner } = await supabase
        .from('users')
        .select('email')
        .eq('org_id', org.id)
        .eq('role', 'ceo')
        .maybeSingle()
      if (owner?.email) {
        const html = templateQuoteApprovedNotification(org.name, quote.quote_number, client.name, quote.total)
        await sendEmail({
          to: owner.email,
          subject: `Quote #${quote.quote_number} approved by ${client.name}`,
          html,
          fromName: org.name,
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── decline_quote ────────────────────────────────────────────
    if (action === 'decline_quote') {
      // Validate decline_reason length
      if (reason && String(reason).length > 1000) {
        return new Response(JSON.stringify({ error: 'Decline reason is too long (max 1000 characters)' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: quote, error: fetchError } = await supabase
        .from('quotes')
        .select(`
          id, quote_number, status, total, approval_token, approved_at, declined_at,
          clients(name),
          organizations(id, name)
        `)
        .eq('approval_token', token)
        .single()

      console.log('[quote-action] decline_quote result:', JSON.stringify({ data: !!quote, error: fetchError }))
      if (fetchError || !quote) {
        return new Response(JSON.stringify({ error: 'Quote not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (quote.approved_at) {
        return new Response(JSON.stringify({ error: 'already_approved' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (quote.declined_at) {
        return new Response(JSON.stringify({ error: 'already_declined' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error: updateError } = await supabase
        .from('quotes')
        .update({
          declined_at: new Date().toISOString(),
          status: 'declined',
          decline_reason: reason ?? null,
        })
        .eq('id', quote.id)

      if (updateError) {
        return new Response(JSON.stringify({ error: 'Failed to update quote' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Notify org owner
      const org = quote.organizations as any
      const client = quote.clients as any
      const { data: owner } = await supabase
        .from('users')
        .select('email')
        .eq('org_id', org.id)
        .eq('role', 'ceo')
        .maybeSingle()
      if (owner?.email) {
        const html = templateQuoteDeclinedNotification(org.name, quote.quote_number, client.name, quote.total, reason)
        await sendEmail({
          to: owner.email,
          subject: `Quote #${quote.quote_number} declined by ${client.name}`,
          html,
          fromName: org.name,
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── get_receipt ──────────────────────────────────────────────
    if (action === 'get_receipt') {
      const { data: payment, error } = await supabase
        .from('payments')
        .select(`
          id, amount, method, date, view_token,
          clients(name),
          invoices(id, invoice_number, total),
          organizations(name)
        `)
        .eq('view_token', token)
        .single()

      console.log('[quote-action] get_receipt result:', JSON.stringify({ data: !!payment, error }))
      if (error || !payment) {
        return new Response(JSON.stringify({ error: 'Receipt not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ receipt: payment }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('quote-action error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
