import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── HTML Template Helpers ────────────────────────────────────

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
        <!-- Header -->
        <tr>
          <td style="background-color:#047857;padding:24px 32px;">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${orgName}</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
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

function lineItemsTable(items: Array<{ description: string; quantity: number; unit_price: number; total?: number }>): string {
  const rows = items.map(li => {
    const lineTotal = li.total ?? (li.quantity * li.unit_price)
    return `<tr>
      <td style="padding:10px 0;font-size:14px;color:#44403c;border-bottom:1px solid #f5f5f4;">${li.description}</td>
      <td style="padding:10px 0;font-size:14px;color:#78716c;text-align:right;border-bottom:1px solid #f5f5f4;">${li.quantity}</td>
      <td style="padding:10px 0;font-size:14px;color:#78716c;text-align:right;border-bottom:1px solid #f5f5f4;">$${Number(li.unit_price).toFixed(2)}</td>
      <td style="padding:10px 0;font-size:14px;color:#1c1917;font-weight:600;text-align:right;border-bottom:1px solid #f5f5f4;">$${Number(lineTotal).toFixed(2)}</td>
    </tr>`
  }).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
    <tr>
      <th style="text-align:left;padding:6px 0;font-size:11px;color:#a8a29e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e7e5e4;">Description</th>
      <th style="text-align:right;padding:6px 0;font-size:11px;color:#a8a29e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e7e5e4;">Qty</th>
      <th style="text-align:right;padding:6px 0;font-size:11px;color:#a8a29e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e7e5e4;">Price</th>
      <th style="text-align:right;padding:6px 0;font-size:11px;color:#a8a29e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e7e5e4;">Total</th>
    </tr>
    ${rows}
  </table>`
}

function totalsBlock(subtotal: number, taxAmount: number, total: number): string {
  const tax = taxAmount > 0 ? `<tr>
    <td colspan="2"></td>
    <td style="padding:4px 0;font-size:13px;color:#78716c;text-align:right;padding-right:16px;">Tax</td>
    <td style="padding:4px 0;font-size:13px;color:#44403c;text-align:right;">$${Number(taxAmount).toFixed(2)}</td>
  </tr>` : ''
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
    <tr>
      <td colspan="2"></td>
      <td style="padding:4px 0;font-size:13px;color:#78716c;text-align:right;padding-right:16px;">Subtotal</td>
      <td style="padding:4px 0;font-size:13px;color:#44403c;text-align:right;">$${Number(subtotal).toFixed(2)}</td>
    </tr>
    ${tax}
    <tr>
      <td colspan="2"></td>
      <td style="padding:8px 0;font-size:16px;font-weight:700;color:#1c1917;text-align:right;padding-right:16px;border-top:2px solid #e7e5e4;">Total</td>
      <td style="padding:8px 0;font-size:16px;font-weight:700;color:#047857;text-align:right;border-top:2px solid #e7e5e4;">$${Number(total).toFixed(2)}</td>
    </tr>
  </table>`
}

function btn(label: string, url: string, color = '#047857'): string {
  return `<a href="${url}" style="display:inline-block;background-color:${color};color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;text-align:center;">${label}</a>`
}

function fmtDate(d: string): string {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
}

// ─── Templates ────────────────────────────────────────────────

function templateQuoteSent(org: { name: string }, data: Record<string, unknown>): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const firstName = clientName.split(' ')[0] || clientName
  const quoteNumber = String(data.quote_number || '')
  const token = String(data.approval_token || '')
  const baseUrl = 'https://timelyops.com'
  const approveUrl = `${baseUrl}/approve/${token}`

  const subject = `Quote from ${org.name} — #${quoteNumber}`

  const body = `
    <p style="font-size:15px;color:#44403c;margin:0 0 8px 0;">Hi ${firstName},</p>
    <p style="font-size:15px;color:#44403c;margin:0 0 24px 0;">Here's a quote for your review:</p>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Quote #${quoteNumber}</div>
      <div style="font-size:13px;color:#78716c;">Date: ${fmtDate(String(data.quote_date || ''))}</div>
      ${data.valid_until ? `<div style="font-size:13px;color:#78716c;margin-top:4px;">Valid until: ${fmtDate(String(data.valid_until))}</div>` : ''}
    </div>

    ${lineItemsTable(data.line_items as Array<{ description: string; quantity: number; unit_price: number; total?: number }>)}
    ${totalsBlock(Number(data.subtotal), Number(data.tax_amount || 0), Number(data.total))}

    ${data.notes ? `<div style="margin:20px 0;padding:16px;background-color:#f5f5f4;border-radius:8px;font-size:14px;color:#57534e;">${String(data.notes)}</div>` : ''}

    <div style="margin:28px 0;text-align:center;">
      ${btn('Approve Quote', `${approveUrl}?action=approve`)}
      &nbsp;&nbsp;
      <a href="${approveUrl}?action=decline" style="display:inline-block;background-color:#f5f5f4;color:#57534e;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;">Decline Quote</a>
    </div>

    <p style="font-size:13px;color:#a8a29e;margin:24px 0 0 0;text-align:center;">
      If you have questions, reply to this email — it goes directly to ${org.name}.
    </p>`

  return { subject, html: emailWrapper(org.name, body) }
}

function templateInvoiceSent(org: { name: string }, data: Record<string, unknown>): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const firstName = clientName.split(' ')[0] || clientName
  const invoiceNumber = String(data.invoice_number || '')
  const token = String(data.view_token || '')
  const viewUrl = `https://timelyops.com/invoice/${token}`

  const subject = `Invoice from ${org.name} — #${invoiceNumber}`

  const body = `
    <p style="font-size:15px;color:#44403c;margin:0 0 8px 0;">Hi ${firstName},</p>
    <p style="font-size:15px;color:#44403c;margin:0 0 24px 0;">Here's your invoice:</p>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Invoice #${invoiceNumber}</div>
      <div style="font-size:13px;color:#78716c;">Issued: ${fmtDate(String(data.issue_date || ''))}</div>
      ${data.due_date ? `<div style="font-size:14px;font-weight:600;color:#dc2626;margin-top:6px;">Due: ${fmtDate(String(data.due_date))}</div>` : ''}
    </div>

    ${lineItemsTable(data.line_items as Array<{ description: string; quantity: number; unit_price: number; total?: number }>)}
    ${totalsBlock(Number(data.subtotal), Number(data.tax_amount || 0), Number(data.total))}

    ${data.notes ? `<div style="margin:20px 0;padding:16px;background-color:#f5f5f4;border-radius:8px;font-size:14px;color:#57534e;">${String(data.notes)}</div>` : ''}

    <div style="margin:28px 0;text-align:center;">
      ${btn('View Invoice', viewUrl)}
    </div>

    <p style="font-size:13px;color:#a8a29e;margin:24px 0 0 0;text-align:center;">
      If you have questions, reply to this email — it goes directly to ${org.name}.
    </p>`

  return { subject, html: emailWrapper(org.name, body) }
}

function templatePaymentReceipt(org: { name: string }, data: Record<string, unknown>): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const firstName = clientName.split(' ')[0] || clientName
  const invoiceNumber = String(data.invoice_number || '')
  const amount = Number(data.payment_amount || 0)
  const invoiceTotal = Number(data.invoice_total || 0)
  const remaining = invoiceTotal > 0 ? invoiceTotal - amount : 0
  const isPaidInFull = remaining <= 0.005

  const subject = `Payment received — Thank you! (#${invoiceNumber})`

  const body = `
    <p style="font-size:15px;color:#44403c;margin:0 0 8px 0;">Hi ${firstName},</p>
    <p style="font-size:15px;color:#44403c;margin:0 0 24px 0;">Thank you for your payment!</p>

    <div style="background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;font-weight:700;color:#047857;margin-bottom:4px;">$${amount.toFixed(2)}</div>
      <div style="font-size:14px;color:#059669;">Payment received</div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;border-bottom:1px solid #f5f5f4;">Date</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;border-bottom:1px solid #f5f5f4;">${fmtDate(String(data.payment_date || ''))}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;border-bottom:1px solid #f5f5f4;">Method</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;border-bottom:1px solid #f5f5f4;text-transform:capitalize;">${String(data.payment_method || '')}</td>
      </tr>
      ${invoiceNumber ? `<tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;border-bottom:1px solid #f5f5f4;">Invoice</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;border-bottom:1px solid #f5f5f4;">#${invoiceNumber}</td>
      </tr>` : ''}
      ${invoiceTotal > 0 ? `<tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;">Invoice total</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;">$${invoiceTotal.toFixed(2)}</td>
      </tr>` : ''}
    </table>

    ${isPaidInFull
      ? `<div style="background-color:#ecfdf5;border-radius:8px;padding:14px;text-align:center;font-size:14px;font-weight:600;color:#047857;">✓ This invoice is now paid in full.</div>`
      : `<div style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;text-align:center;font-size:14px;color:#c2410c;">Remaining balance: <strong>$${remaining.toFixed(2)}</strong></div>`
    }`

  return { subject, html: emailWrapper(org.name, body) }
}

function templateQuoteApproved(org: { name: string }, data: Record<string, unknown>): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const quoteNumber = String(data.quote_number || '')
  const total = Number(data.total || 0)

  const subject = `${clientName} approved your quote #${quoteNumber}`

  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;background-color:#ecfdf5;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:16px;">✓</div>
      <h2 style="margin:0 0 8px 0;font-size:20px;color:#1c1917;">Great news!</h2>
      <p style="margin:0;font-size:15px;color:#57534e;"><strong>${clientName}</strong> has approved your quote.</p>
    </div>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Quote #${quoteNumber}</div>
      <div style="font-size:22px;font-weight:700;color:#047857;">$${total.toFixed(2)}</div>
    </div>

    <p style="font-size:14px;color:#57534e;text-align:center;margin-bottom:24px;">Log in to TimelyOps to schedule the job.</p>

    <div style="text-align:center;">
      ${btn('View Quote', 'https://timelyops.com/quotes')}
    </div>`

  return { subject, html: emailWrapper(org.name, body) }
}

function templateQuoteDeclined(org: { name: string }, data: Record<string, unknown>): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const quoteNumber = String(data.quote_number || '')
  const total = Number(data.total || 0)
  const reason = data.decline_reason ? String(data.decline_reason) : null

  const subject = `${clientName} declined your quote #${quoteNumber}`

  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;color:#1c1917;">Quote declined</h2>
    <p style="font-size:15px;color:#57534e;margin:0 0 20px 0;"><strong>${clientName}</strong> has declined your quote.</p>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Quote #${quoteNumber}</div>
      <div style="font-size:18px;font-weight:700;color:#44403c;">$${total.toFixed(2)}</div>
    </div>

    ${reason ? `<div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:600;color:#991b1b;text-transform:uppercase;margin-bottom:6px;">Reason provided</div>
      <div style="font-size:14px;color:#7f1d1d;">${reason}</div>
    </div>` : ''}

    <p style="font-size:14px;color:#57534e;margin-bottom:24px;">Log in to TimelyOps to follow up or revise the quote.</p>

    <div style="text-align:center;">
      ${btn('View Quote', 'https://timelyops.com/quotes', '#57534e')}
    </div>`

  return { subject, html: emailWrapper(org.name, body) }
}

// ─── Main Handler ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!

    const anonClient = createClient(supabaseUrl, supabaseAnonKey)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !authUser) throw new Error('Invalid JWT')

    // Fetch the caller's user row for org info
    const { data: callerUser } = await adminClient
      .from('users')
      .select('*, organizations(*)')
      .eq('id', authUser.id)
      .single()

    const body = await req.json()
    const { type, to, org, data } = body

    if (!type || !to) throw new Error('Missing required fields: type, to')
    if (!org?.name) throw new Error('Missing org.name')

    // Build email
    let subject = ''
    let html = ''

    switch (type) {
      case 'quote':
        ;({ subject, html } = templateQuoteSent(org, data))
        break
      case 'invoice':
        ;({ subject, html } = templateInvoiceSent(org, data))
        break
      case 'payment_receipt':
        ;({ subject, html } = templatePaymentReceipt(org, data))
        break
      case 'quote_approved':
        ;({ subject, html } = templateQuoteApproved(org, data))
        break
      case 'quote_declined':
        ;({ subject, html } = templateQuoteDeclined(org, data))
        break
      default:
        throw new Error(`Unknown email type: ${type}`)
    }

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${org.name} via TimelyOps <notifications@timelyops.com>`,
        reply_to: org.email || undefined,
        to: [to],
        subject,
        html,
      }),
    })

    const resendData = await resendResponse.json()

    if (!resendResponse.ok) {
      throw new Error(resendData.message || 'Resend API error')
    }

    // Log to email_log
    const orgId = callerUser?.org_id || null
    await adminClient.from('email_log').insert({
      org_id: orgId,
      sent_by: authUser.id,
      recipient_email: to,
      email_type: type,
      subject,
      related_entity_type: data?.entity_type || null,
      related_entity_id: data?.entity_id || null,
      resend_message_id: resendData.id || null,
      status: 'sent',
    })

    return new Response(JSON.stringify({ success: true, message_id: resendData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Attempt to log failure (best effort)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (supabaseUrl && supabaseServiceKey) {
        const adminClient = createClient(supabaseUrl, supabaseServiceKey)
        const body = await req.clone().json().catch(() => ({}))
        await adminClient.from('email_log').insert({
          org_id: null,
          sent_by: null,
          recipient_email: body?.to || 'unknown',
          email_type: body?.type || 'unknown',
          subject: 'FAILED',
          status: 'failed',
          error_message: message,
        })
      }
    } catch { /* silent */ }

    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
