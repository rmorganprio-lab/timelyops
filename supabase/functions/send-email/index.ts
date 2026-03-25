import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── HTML Helpers ─────────────────────────────────────────────

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${escapeHtml(orgName)}</span>
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

function formatClientName(firstName: string | null | undefined, lastName: string | null | undefined, fallback = ''): string {
  return [firstName, lastName].filter(Boolean).join(' ') || fallback
}

function formatClientAddress(client: Record<string, unknown>): string[] {
  const lines: string[] = []
  if (client.address_line_1) lines.push(String(client.address_line_1))
  if (client.address_line_2) lines.push(String(client.address_line_2))
  const city = client.city ? String(client.city) : ''
  const state = client.state_province ? String(client.state_province) : ''
  const zip = client.postal_code ? String(client.postal_code) : ''
  const cityLine = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (cityLine) lines.push(cityLine)
  if (lines.length === 0 && client.address) lines.push(String(client.address))
  return lines
}

function lineItemsTable(items: Array<{ description: string; quantity: number; unit_price: number; total?: number }>, sym = '$'): string {
  const rows = items.map(li => {
    const lineTotal = li.total ?? (li.quantity * li.unit_price)
    return `<tr>
      <td style="padding:10px 0;font-size:14px;color:#44403c;border-bottom:1px solid #f5f5f4;">${escapeHtml(li.description)}</td>
      <td style="padding:10px 0;font-size:14px;color:#78716c;text-align:right;border-bottom:1px solid #f5f5f4;">${li.quantity}</td>
      <td style="padding:10px 0;font-size:14px;color:#78716c;text-align:right;border-bottom:1px solid #f5f5f4;">${sym}${Number(li.unit_price).toFixed(2)}</td>
      <td style="padding:10px 0;font-size:14px;color:#1c1917;font-weight:600;text-align:right;border-bottom:1px solid #f5f5f4;">${sym}${Number(lineTotal).toFixed(2)}</td>
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

function totalsBlock(subtotal: number, taxAmount: number, total: number, sym = '$'): string {
  const tax = taxAmount > 0 ? `<tr>
    <td colspan="2"></td>
    <td style="padding:4px 0;font-size:13px;color:#78716c;text-align:right;padding-right:16px;">Tax</td>
    <td style="padding:4px 0;font-size:13px;color:#44403c;text-align:right;">${sym}${Number(taxAmount).toFixed(2)}</td>
  </tr>` : ''
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
    <tr>
      <td colspan="2"></td>
      <td style="padding:4px 0;font-size:13px;color:#78716c;text-align:right;padding-right:16px;">Subtotal</td>
      <td style="padding:4px 0;font-size:13px;color:#44403c;text-align:right;">${sym}${Number(subtotal).toFixed(2)}</td>
    </tr>
    ${tax}
    <tr>
      <td colspan="2"></td>
      <td style="padding:8px 0;font-size:16px;font-weight:700;color:#1c1917;text-align:right;padding-right:16px;border-top:2px solid #e7e5e4;">Total</td>
      <td style="padding:8px 0;font-size:16px;font-weight:700;color:#047857;text-align:right;border-top:2px solid #e7e5e4;">${sym}${Number(total).toFixed(2)}</td>
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

function templateQuoteSent(org: { name: string }, data: Record<string, unknown>, sym = '$'): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const firstName = String(data.client_first_name || clientName.split(' ')[0] || clientName)
  const quoteNumber = String(data.quote_number || '')
  const token = String(data.approval_token || '')
  const baseUrl = 'https://timelyops.com'
  const approveUrl = `${baseUrl}/approve/${token}`

  const subject = `Quote from ${org.name} — #${quoteNumber}`

  const addrLines = formatClientAddress(data.client as Record<string, unknown> || {})

  const body = `
    <p style="font-size:15px;color:#44403c;margin:0 0 8px 0;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:15px;color:#44403c;margin:0 0 24px 0;">Here's a quote for your review:</p>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;color:#a8a29e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Prepared for</div>
      <div style="font-size:14px;font-weight:600;color:#1c1917;">${escapeHtml(clientName)}</div>
      ${addrLines.map(l => `<div style="font-size:13px;color:#78716c;">${escapeHtml(l)}</div>`).join('')}
      <div style="border-top:1px solid #e7e5e4;margin:10px 0;"></div>
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Quote #${escapeHtml(quoteNumber)}</div>
      <div style="font-size:13px;color:#78716c;">Date: ${fmtDate(String(data.quote_date || ''))}</div>
      ${data.valid_until ? `<div style="font-size:13px;color:#78716c;margin-top:4px;">Valid until: ${fmtDate(String(data.valid_until))}</div>` : ''}
    </div>

    ${lineItemsTable(data.line_items as Array<{ description: string; quantity: number; unit_price: number; total?: number }>, sym)}
    ${totalsBlock(Number(data.subtotal), Number(data.tax_amount || 0), Number(data.total), sym)}

    ${data.notes ? `<div style="margin:20px 0;padding:16px;background-color:#f5f5f4;border-radius:8px;font-size:14px;color:#57534e;">${escapeHtml(String(data.notes))}</div>` : ''}

    <div style="margin:28px 0;text-align:center;">
      ${btn('Approve Quote', `${approveUrl}?action=approve`)}
      &nbsp;&nbsp;
      <a href="${approveUrl}?action=decline" style="display:inline-block;background-color:#f5f5f4;color:#57534e;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;">Decline Quote</a>
    </div>

    <p style="font-size:13px;color:#a8a29e;margin:24px 0 0 0;text-align:center;">
      If you have questions, reply to this email — it goes directly to ${escapeHtml(org.name)}.
    </p>`

  return { subject, html: emailWrapper(org.name, body) }
}

function templateInvoiceSent(org: { name: string }, data: Record<string, unknown>, sym = '$'): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const firstName = String(data.client_first_name || clientName.split(' ')[0] || clientName)
  const invoiceNumber = String(data.invoice_number || '')
  const token = String(data.view_token || '')
  const viewUrl = `https://timelyops.com/invoice/${token}`
  const addrLines = formatClientAddress(data.client as Record<string, unknown> || {})

  const subject = `Invoice from ${org.name} — #${invoiceNumber}`

  const body = `
    <p style="font-size:15px;color:#44403c;margin:0 0 8px 0;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:15px;color:#44403c;margin:0 0 24px 0;">Here's your invoice:</p>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;color:#a8a29e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Billed to</div>
      <div style="font-size:14px;font-weight:600;color:#1c1917;">${escapeHtml(clientName)}</div>
      ${addrLines.map(l => `<div style="font-size:13px;color:#78716c;">${escapeHtml(l)}</div>`).join('')}
      <div style="border-top:1px solid #e7e5e4;margin:10px 0;"></div>
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Invoice #${escapeHtml(invoiceNumber)}</div>
      <div style="font-size:13px;color:#78716c;">Issued: ${fmtDate(String(data.issue_date || ''))}</div>
      ${data.due_date ? `<div style="font-size:14px;font-weight:600;color:#dc2626;margin-top:6px;">Due: ${fmtDate(String(data.due_date))}</div>` : ''}
    </div>

    ${lineItemsTable(data.line_items as Array<{ description: string; quantity: number; unit_price: number; total?: number }>, sym)}
    ${totalsBlock(Number(data.subtotal), Number(data.tax_amount || 0), Number(data.total), sym)}

    ${data.notes ? `<div style="margin:20px 0;padding:16px;background-color:#f5f5f4;border-radius:8px;font-size:14px;color:#57534e;">${escapeHtml(String(data.notes))}</div>` : ''}

    <div style="margin:28px 0;text-align:center;">
      ${btn('View Invoice', viewUrl)}
    </div>

    <p style="font-size:13px;color:#a8a29e;margin:24px 0 0 0;text-align:center;">
      If you have questions, reply to this email — it goes directly to ${escapeHtml(org.name)}.
    </p>`

  return { subject, html: emailWrapper(org.name, body) }
}

function templatePaymentReceipt(org: { name: string }, data: Record<string, unknown>, sym = '$'): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const firstName = String(data.client_first_name || clientName.split(' ')[0] || clientName)
  const invoiceNumber = String(data.invoice_number || '')
  const amount = Number(data.payment_amount || 0)
  const invoiceTotal = Number(data.invoice_total || 0)
  const remaining = invoiceTotal > 0 ? invoiceTotal - amount : 0
  const isPaidInFull = remaining <= 0.005

  const subject = `Payment received — Thank you! (#${invoiceNumber})`

  const body = `
    <p style="font-size:15px;color:#44403c;margin:0 0 8px 0;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:15px;color:#44403c;margin:0 0 24px 0;">Thank you for your payment!</p>

    <div style="background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;font-weight:700;color:#047857;margin-bottom:4px;">${sym}${amount.toFixed(2)}</div>
      <div style="font-size:14px;color:#059669;">Payment received</div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;border-bottom:1px solid #f5f5f4;">Date</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;border-bottom:1px solid #f5f5f4;">${fmtDate(String(data.payment_date || ''))}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;border-bottom:1px solid #f5f5f4;">Method</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;border-bottom:1px solid #f5f5f4;text-transform:capitalize;">${escapeHtml(String(data.payment_method || ''))}</td>
      </tr>
      ${invoiceNumber ? `<tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;border-bottom:1px solid #f5f5f4;">Invoice</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;border-bottom:1px solid #f5f5f4;">#${invoiceNumber}</td>
      </tr>` : ''}
      ${invoiceTotal > 0 ? `<tr>
        <td style="padding:8px 0;font-size:13px;color:#78716c;">Invoice total</td>
        <td style="padding:8px 0;font-size:13px;color:#44403c;text-align:right;">${sym}${invoiceTotal.toFixed(2)}</td>
      </tr>` : ''}
    </table>

    ${isPaidInFull
      ? `<div style="background-color:#ecfdf5;border-radius:8px;padding:14px;text-align:center;font-size:14px;font-weight:600;color:#047857;">✓ This invoice is now paid in full.</div>`
      : `<div style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;text-align:center;font-size:14px;color:#c2410c;">Remaining balance: <strong>${sym}${remaining.toFixed(2)}</strong></div>`
    }`

  return { subject, html: emailWrapper(org.name, body) }
}

function templateQuoteApproved(org: { name: string }, data: Record<string, unknown>, sym = '$'): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const quoteNumber = String(data.quote_number || '')
  const total = Number(data.total || 0)

  const subject = `${clientName} approved your quote #${quoteNumber}`

  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;background-color:#ecfdf5;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:16px;">✓</div>
      <h2 style="margin:0 0 8px 0;font-size:20px;color:#1c1917;">Great news!</h2>
      <p style="margin:0;font-size:15px;color:#57534e;"><strong>${escapeHtml(clientName)}</strong> has approved your quote.</p>
    </div>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Quote #${escapeHtml(quoteNumber)}</div>
      <div style="font-size:22px;font-weight:700;color:#047857;">${sym}${total.toFixed(2)}</div>
    </div>

    <p style="font-size:14px;color:#57534e;text-align:center;margin-bottom:24px;">Log in to TimelyOps to schedule the job.</p>

    <div style="text-align:center;">
      ${btn('View Quote', 'https://timelyops.com/quotes')}
    </div>`

  return { subject, html: emailWrapper(org.name, body) }
}

function templateQuoteDeclined(org: { name: string }, data: Record<string, unknown>, sym = '$'): { subject: string; html: string } {
  const clientName = String(data.client_name || '')
  const quoteNumber = String(data.quote_number || '')
  const total = Number(data.total || 0)
  const reason = data.decline_reason ? String(data.decline_reason) : null

  const subject = `${clientName} declined your quote #${quoteNumber}`

  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;color:#1c1917;">Quote declined</h2>
    <p style="font-size:15px;color:#57534e;margin:0 0 20px 0;"><strong>${escapeHtml(clientName)}</strong> has declined your quote.</p>

    <div style="background-color:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="font-size:13px;color:#78716c;margin-bottom:4px;">Quote #${escapeHtml(quoteNumber)}</div>
      <div style="font-size:18px;font-weight:700;color:#44403c;">${sym}${total.toFixed(2)}</div>
    </div>

    ${reason ? `<div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:600;color:#991b1b;text-transform:uppercase;margin-bottom:6px;">Reason provided</div>
      <div style="font-size:14px;color:#7f1d1d;">${escapeHtml(reason)}</div>
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
    // Verify JWT manually (deployed with --no-verify-jwt)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!

    console.log('[send-email] SUPABASE_URL set:', !!supabaseUrl)
    console.log('[send-email] SUPABASE_SERVICE_ROLE_KEY set:', !!supabaseServiceKey)
    console.log('[send-email] SUPABASE_ANON_KEY set:', !!supabaseAnonKey)

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

    // Fetch caller's org_id for ownership checks
    const { data: callerUser } = await adminClient
      .from('users')
      .select('org_id, is_platform_admin')
      .eq('id', authUser.id)
      .single()
    const callerOrgId = callerUser?.org_id
    const callerIsAdmin = callerUser?.is_platform_admin === true

    const body = await req.json()
    const { type } = body
    if (!type) throw new Error('Missing required field: type')

    let subject = ''
    let html = ''
    let to = ''
    let orgId: string | null = null
    let orgName = ''
    let orgEmail: string | null = null

    switch (type) {
      case 'quote': {
        const { quote_id } = body
        if (!quote_id) throw new Error('Missing quote_id')

        console.log('[send-email] Fetching quote:', quote_id)
        let quoteQuery = adminClient
          .from('quotes')
          .select('*, clients(name, first_name, last_name, email, address, address_line_1, address_line_2, city, state_province, postal_code), organizations(name, settings), quote_line_items(*)')
          .eq('id', quote_id)
        if (!callerIsAdmin) quoteQuery = quoteQuery.eq('org_id', callerOrgId)
        const { data: quote, error } = await quoteQuery.single()
        console.log('[send-email] Quote query result — data:', JSON.stringify(quote), 'error:', JSON.stringify(error))
        if (error || !quote) throw new Error(`Quote not found: ${error?.message || error?.code || 'no data'}`)
        if (!quote.clients?.email) throw new Error('Client has no email address')

        to = quote.clients.email
        orgId = quote.org_id
        orgName = quote.organizations.name
        const quoteSym = quote.organizations.settings?.currency_symbol || '$'
        // orgEmail resolved after switch via users table

        const lineItems = (quote.quote_line_items || [])
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (Number(a.sort_order) ?? 0) - (Number(b.sort_order) ?? 0))
        ;({ subject, html } = templateQuoteSent({ name: orgName }, {
          client_name: formatClientName(quote.clients.first_name, quote.clients.last_name, quote.clients.name),
          client_first_name: quote.clients.first_name || quote.clients.name?.split(' ')[0],
          client: quote.clients,
          quote_number: quote.quote_number,
          quote_date: quote.created_at,
          valid_until: quote.valid_until,
          approval_token: quote.approval_token,
          line_items: lineItems,
          subtotal: quote.subtotal,
          tax_amount: quote.tax_amount,
          total: quote.total,
          notes: quote.notes,
        }, quoteSym))
        break
      }

      case 'invoice': {
        const { invoice_id } = body
        if (!invoice_id) throw new Error('Missing invoice_id')

        console.log('[send-email] Fetching invoice:', invoice_id)
        let invoiceQuery = adminClient
          .from('invoices')
          .select('*, clients(name, first_name, last_name, email, address, address_line_1, address_line_2, city, state_province, postal_code), organizations(name, settings), invoice_line_items(*)')
          .eq('id', invoice_id)
        if (!callerIsAdmin) invoiceQuery = invoiceQuery.eq('org_id', callerOrgId)
        const { data: invoice, error: invError } = await invoiceQuery.single()
        console.log('[send-email] Invoice query result — data:', JSON.stringify(invoice), 'error:', JSON.stringify(invError))
        if (invError || !invoice) throw new Error(`Invoice not found: ${invError?.message || invError?.code || 'no data'}`)
        if (!invoice.clients?.email) throw new Error('Client has no email address')

        to = invoice.clients.email
        orgId = invoice.org_id
        orgName = invoice.organizations.name
        const invoiceSym = invoice.organizations.settings?.currency_symbol || '$'
        // orgEmail resolved after switch via users table

        const lineItems = (invoice.invoice_line_items || [])
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (Number(a.sort_order) ?? 0) - (Number(b.sort_order) ?? 0))
        ;({ subject, html } = templateInvoiceSent({ name: orgName }, {
          client_name: formatClientName(invoice.clients.first_name, invoice.clients.last_name, invoice.clients.name),
          client_first_name: invoice.clients.first_name || invoice.clients.name?.split(' ')[0],
          client: invoice.clients,
          invoice_number: invoice.invoice_number,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          view_token: invoice.view_token,
          line_items: lineItems,
          subtotal: invoice.subtotal,
          tax_amount: invoice.tax_amount,
          total: invoice.total,
          notes: invoice.notes,
        }, invoiceSym))
        break
      }

      case 'payment_receipt': {
        const { payment_id } = body
        if (!payment_id) throw new Error('Missing payment_id')

        console.log('[send-email] Fetching payment:', payment_id)
        let paymentQuery = adminClient
          .from('payments')
          .select('*, clients(name, first_name, last_name, email), invoices(invoice_number, total), organizations(name, settings)')
          .eq('id', payment_id)
        if (!callerIsAdmin) paymentQuery = paymentQuery.eq('org_id', callerOrgId)
        const { data: payment, error: payError } = await paymentQuery.single()
        console.log('[send-email] Payment query result — data:', JSON.stringify(payment), 'error:', JSON.stringify(payError))
        if (payError || !payment) throw new Error(`Payment not found: ${payError?.message || payError?.code || 'no data'}`)
        if (!payment.clients?.email) throw new Error('Client has no email address')

        to = payment.clients.email
        orgId = payment.org_id
        orgName = payment.organizations.name
        const receiptSym = payment.organizations.settings?.currency_symbol || '$'
        // orgEmail resolved after switch via users table

        ;({ subject, html } = templatePaymentReceipt({ name: orgName }, {
          client_name: formatClientName(payment.clients.first_name, payment.clients.last_name, payment.clients.name),
          client_first_name: payment.clients.first_name || payment.clients.name?.split(' ')[0],
          invoice_number: payment.invoices?.invoice_number || null,
          payment_amount: payment.amount,
          invoice_total: payment.invoices?.total || 0,
          payment_date: payment.date,
          payment_method: payment.method,
        }, receiptSym))
        break
      }

      default:
        throw new Error(`Unknown email type: ${type}`)
    }

    // Rate limit: block if same recipient+type sent in last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
    const { data: recentSend } = await adminClient
      .from('email_log')
      .select('id')
      .eq('recipient_email', to)
      .eq('email_type', type)
      .eq('status', 'sent')
      .gte('created_at', oneMinuteAgo)
      .limit(1)
      .maybeSingle()
    if (recentSend) {
      return new Response(JSON.stringify({ error: 'Rate limit: this email was sent recently. Please wait a moment before sending again.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Resolve org owner email from users table (organizations has no email column)
    if (orgId && !orgEmail) {
      const { data: owner } = await adminClient
        .from('users')
        .select('email')
        .eq('org_id', orgId)
        .eq('role', 'ceo')
        .maybeSingle()
      orgEmail = owner?.email || null
    }

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${orgName} via TimelyOps <notifications@timelyops.com>`,
        reply_to: orgEmail || undefined,
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
    await adminClient.from('email_log').insert({
      org_id: orgId,
      sent_by: authUser.id,
      recipient_email: to,
      email_type: type,
      subject,
      resend_message_id: resendData.id || null,
      status: 'sent',
      channel: 'email',
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
