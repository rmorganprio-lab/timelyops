# TimelyOps — Project Status Board

Last updated: 2026-03-25

---

## Routes & page status

| Route | File | Status | Notes |
|-------|------|--------|-------|
| `/` | Dashboard.jsx | ✅ Full | Owner + worker views; today's jobs, overdue invoices, recent payments, stats |
| `/clients` | Clients.jsx | ✅ Full | CRUD, CSV import, client timeline, property details, preferred_contact |
| `/workers` | Workers.jsx | ✅ Full | CRUD, CSV import, availability toggle, skills |
| `/schedule` | Schedule.jsx | ✅ Full | Month/week/day calendar, job completion flow, auto-receipt on payment |
| `/quotes` | Quotes.jsx | ✅ Full | CRUD, line items, delivery modal, approval token, convert to job |
| `/invoices` | Invoices.jsx | ✅ Full | CRUD, line items, delivery modal, PDF generation, inline payment |
| `/payments` | Payments.jsx | ✅ Full | Log payments, delivery modal, filter by method/client/period |
| `/reports` | Reports.jsx | ✅ Full | Charts (Recharts), export modal (XLSX/CSV zip), feature-gated |
| `/settings` | Settings.jsx | ✅ Full | Org name, timezone, time format (12h/24h), tax rate — ceo only |
| `/login` | Login.jsx | ✅ Full | Phone OTP primary, email magic link fallback |
| `/approve/:token` | QuoteApproval.jsx | ✅ Full | Public, no auth; approve/decline with reason |
| `/invoice/:token` | InvoiceView.jsx | ✅ Full | Public, no auth; shows invoice with line items |
| `/receipt/:token` | PaymentReceipt.jsx | ✅ Full | Public, no auth; shows payment receipt |
| `/admin` | AdminDashboard.jsx | ✅ Full | Platform-wide stats, tier breakdown |
| `/admin/orgs` | AdminOrgs.jsx | ✅ Full | Org CRUD, tier/status changes, add users, "View As" org scoping |
| `/admin/users` | AdminUsers.jsx | ✅ Full | User directory, platform admin toggle, credential updates |
| `/admin/audit` | AdminAudit.jsx | ✅ Full | Filterable audit log, 50/page |

---

## Database schema

### `organizations`
id, name, slug, industry, settings (jsonb: `{ timezone, time_format, tax_rate, currency }`), created_at, subscription_tier, add_ons (jsonb array), subscription_status, trial_ends_at, is_founding_customer

**RLS:** SELECT (own org), UPDATE (ceo only), ALL (platform admin)

### `users`
id (= auth.uid after linking), org_id, name, phone, email, role (`ceo`/`manager`/`worker`), is_active, created_at, availability (`available`/`unavailable`/`vacation`), skills (text array), auth_linked, is_platform_admin

**RLS:** standard org scoping; platform admins can see/update all

### `clients`
id, org_id, name, email, phone, address, notes, tags, status (`active`/`inactive`/`vip`), preferred_contact (`email`/`sms`/`whatsapp`/`phone`), created_at

**Has child:** `client_properties` (one-to-one), `client_timeline`

### `client_properties`
id, client_id, property_type (`residential`/`commercial`/`office`/`other`), bedrooms, bathrooms, square_footage, alarm_code, key_info, pet_details, parking_instructions, supply_location, special_notes

### `client_timeline`
id, org_id, client_id, event_type, summary, created_by, created_at

**RLS:** append-only style (no delete)

### `jobs`
id, org_id, client_id, title, date, start_time, end_time, price, status (`scheduled`/`in_progress`/`completed`/`cancelled`), notes, recurrence_group_id, frequency, invoice_id (FK → invoices **SET NULL**), created_at

**Has child:** `job_assignments` (CASCADE delete)

**RLS DELETE:** ceo + manager only (inline subquery, platform admin bypass)

### `job_assignments`
id, job_id (FK → jobs CASCADE), user_id

### `service_types`
id, org_id, name, description, base_price, is_active

### `pricing_matrix`
id, org_id, service_type_id, property_type, bedrooms, bathrooms, price

### `quotes`
id, org_id, client_id, quote_number, subtotal, tax_amount, total, status (`draft`/`sent`/`approved`/`declined`/`expired`), valid_until, sent_at, approved_at, notes, converted_job_id, created_at, approval_token, declined_at, decline_reason

### `quote_line_items`
id, quote_id, service_type_id, description, quantity, unit_price, total, sort_order, frequency

### `invoices`
id, org_id, client_id, quote_id, invoice_number, subtotal, tax_amount, total, status (`draft`/`sent`/`paid`/`overdue`), issue_date, due_date, paid_date, notes, created_at, view_token

**RLS DELETE:** ceo only (inline subquery, platform admin bypass)

### `invoice_line_items`
id, invoice_id (FK → invoices CASCADE), description, quantity, unit_price, total, job_id (FK → jobs **SET NULL**)

### `payments`
id, org_id, client_id, invoice_id (FK → invoices **SET NULL**), job_id (FK → jobs **SET NULL**), amount, method (`cash`/`venmo`/`zelle`/`card`/`bank_transfer`/`check`/`other`), date, notes, view_token, created_at

**RLS DELETE:** ceo only (inline subquery, platform admin bypass)

### `email_log`
id, org_id, sent_by, recipient_email, email_type, subject, resend_message_id, status, channel (`email`), twilio_message_sid, created_at

### `audit_log`
id, org_id, user_id, user_name, user_role, is_admin_action, action (`create`/`update`/`delete`), entity_type, entity_id, changes (jsonb), metadata (jsonb), created_at

**RLS:** no UPDATE/DELETE policy — append-only

### Key DB helper functions (SECURITY DEFINER)
- `user_org_id()` — returns caller's org_id from users table
- `user_role()` — returns caller's role from users table

### FK delete behaviour (SET NULL, not RESTRICT)
Deleting a job NULLs: `payments.job_id`, `invoice_line_items.job_id`, `jobs.invoice_id`
Deleting an invoice NULLs: `payments.invoice_id`, `jobs.invoice_id`

---

## Edge Functions (all deployed `--no-verify-jwt`)

### `send-email`
**What:** Sends transactional emails via Resend API. Accepts `{ type, quote_id | invoice_id | payment_id }`, looks up all data from DB using service role key, builds HTML email, sends, logs to `email_log`.
**Types:** `quote_sent`, `invoice_sent`, `payment_receipt`, `quote_approved_notification`
**From:** `{Org Name} via TimelyOps <notifications@timelyops.com>`
**Reply-To:** org owner email (looked up from users where role='ceo')
**Env vars:** `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
**Auth:** Manual JWT verify via `supabase.auth.getUser(token)` — callers must pass `Authorization: Bearer <session.access_token>`

### `send-sms`
**What:** Sends SMS via Twilio API. Accepts `{ to, message }`.
**Env vars:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
**Known issue:** Twilio trial account blocks SMS to Netherlands numbers (+31)

### `quote-action`
**What:** Handles all public (unauthenticated) token-based actions. Uses service role key for all DB access.
**Actions:** `get_quote` (by approval_token), `approve_quote`, `decline_quote`, `get_invoice` (by view_token), `get_receipt` (by payment view_token)
**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### `admin-update-auth-user`
**What:** Updates email/phone in `auth.users` using service role. Called from AdminUsers.jsx when a user's credentials change.
**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Live integrations

| Service | What it does | Credentials location |
|---------|-------------|---------------------|
| Supabase | DB, Auth, RLS, Edge Functions | `src/lib/supabase.js` (anon key), Edge Function env vars (service role) |
| Resend | Transactional email | `RESEND_API_KEY` in Supabase Edge Function settings |
| Twilio | SMS delivery | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in Supabase Edge Function settings |
| Vercel | Hosting + CI/CD | Auto-deploy on push to `main` |
| GitHub | Source control | `rmorganprio-lab/allbookd` |

---

## Key architecture decisions

### Admin org scoping (not impersonation)
Admin uses `AdminOrgContext` to scope views to another org while staying logged in as themselves. Every data page reads:
```js
const effectiveOrgId = adminViewOrg?.id ?? user?.org_id
```
Keeps audit trail clean — every action attributed to the real user, not the org being viewed.

### Receipt delivery (job completion flow)
After payment is recorded in Schedule.jsx, `sendReceiptAuto()` fires silently with fallback logic:
- `preferred_contact = email` → try email → fall back to SMS → fall back to copy link
- `preferred_contact = sms` → try SMS → fall back to email → fall back to copy link
- `preferred_contact = whatsapp/phone` → always copy link (no direct integration)
Toast always describes what actually happened.

### Delivery modal (manual sends)
Quotes, Invoices, Payments pages use `<DeliveryModal>` for manual sends. Pre-selects channel based on `client.preferred_contact` with fallback. Workers can switch channel before sending.

### Settings stored in JSONB
`organizations.settings` JSONB holds: `timezone`, `time_format` (`12h`/`24h`), `tax_rate`, `currency`. Not separate columns. After saving settings, page reloads to propagate new values.

### ToastContext action button
`showToast(message, type, { label, onClick })` — optional third arg adds an action button to the toast (used for "Copy link" fallback on failed receipt sends).

### Audit log
`src/lib/auditLog.js` → `logAudit()`. Currently wired to admin actions only. Core pages (clients, invoices, payments, quotes) do NOT yet call `logAudit()`.

---

## Known issues / blockers

- **Twilio trial account** — SMS to Netherlands (+31) numbers blocked. Upgrade to paid Twilio to fix. Workaround: use email OTP when testing from NL.
- **Audit log gaps** — `logAudit()` not wired to core page actions (client creates/edits, invoice creates, quote sends, payments). Only admin actions are logged.
- **No automated reminders** — Professional tier feature, UI exists in tier definitions but system not built.
- **No online payments** — Invoice view page shows balance but has no Stripe integration. Outstanding invoices require manual payment recording.

---

## TODO / open items

- [ ] Upgrade Twilio from trial account (remove NL SMS block)
- [ ] Wire `logAudit()` to core page actions (clients, invoices, payments, quotes)
- [ ] Stripe integration for online payment on `/invoice/:token` page
- [ ] Automated reminders system (Professional tier)
- [ ] Growth tier AI agent system (inbound/outbound comms via Claude API + Twilio)
- [ ] Client booking portal (Professional tier)
- [ ] Worker GPS check-in (Professional tier)
- [ ] Auto review requests (Professional tier)
- [ ] QuickBooks sync (Growth tier)
- [ ] Supply tracking (Growth tier)
