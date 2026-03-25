# TimelyOps — Project Status Board

Last updated: 2026-03-25 (Phase 2–4 complete: structural refactor + UI/UX updates)

---

## Routes & page status

| Route | File | Status | Notes |
|-------|------|--------|-------|
| `/` | Dashboard.jsx | ✅ Full | Owner + worker views; today's jobs, overdue invoices, recent payments, stats. Clicking a job navigates to Schedule day view with that job's detail modal open. |
| `/clients` | Clients.jsx | ✅ Full | CRUD, CSV import (XLSX template), client timeline, property details, preferred_contact |
| `/workers` | Workers.jsx | ✅ Full | CRUD, CSV import (XLSX template), availability toggle, skills, address fields |
| `/schedule` | Schedule.jsx | ✅ Full | Month/week/day calendar, job completion flow, auto-receipt on payment. Worker assignment required on create. Property details shown on job cards for workers. |
| `/quotes` | Quotes.jsx | ✅ Full | CRUD, line items, delivery modal, approval token, convert to job. Pricing matrix empty-state prompt with link to /settings. |
| `/invoices` | Invoices.jsx | ✅ Full | CRUD, line items, delivery modal, PDF generation, inline payment |
| `/payments` | Payments.jsx | ✅ Full | Log payments, delivery modal, filter by method/client/period |
| `/reports` | Reports.jsx | ✅ Full | Charts (Recharts), export modal (XLSX/CSV zip), feature-gated |
| `/settings` | Settings.jsx | ✅ Full | Org name, timezone, time format (12h/24h), tax rate — ceo + platform_admin |
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
id, name, slug, industry, settings (jsonb: `{ timezone, time_format, tax_rate, currency_symbol, payment_methods }`), created_at, subscription_tier, add_ons (jsonb array), subscription_status, trial_ends_at, is_founding_customer

**RLS:** SELECT (own org), UPDATE (ceo only), ALL (platform admin)

### `users`
id (= auth.uid after linking), org_id, name, phone, email, role (`ceo`/`manager`/`worker`), is_active, created_at, availability (`available`/`unavailable`/`vacation`), skills (text array), auth_linked, is_platform_admin, address_line_1, address_line_2, city, state_province, postal_code, country

**RLS:** standard org scoping; platform admins can see/update all

### `clients`
id, org_id, name (legacy display field), first_name, last_name, email, phone, address (legacy single-line), address_line_1, address_line_2, city, state_province, postal_code, country, notes, tags (text array), status (`active`/`inactive`/`vip`), preferred_contact (`email`/`sms`/`whatsapp`/`phone`), created_at

**Note:** `name` and `address` have no NOT NULL constraint (dropped in Phase 2 migration). All new clients are created with `first_name`/`last_name` only.

**Name display:** Always use `formatName(first_name, last_name)` from `src/lib/formatAddress.js`, falling back to legacy `name`. Queries should `select('id, name, first_name, last_name')` and `.order('first_name')`.

**Address display:** `formatAddress(client)` returns single-line string (compact, for cards). `formatAddressLines(client)` returns `string[]` (multi-line, for detail views). Both in `src/lib/formatAddress.js`, fall back to legacy `address`.

**Has child:** `client_properties` (one-to-one), `client_timeline`

### `client_properties`
id, client_id, org_id, property_type (`residential`/`commercial`/`office`/`other`), bedrooms, bathrooms, square_footage, alarm_code, key_info, pet_details, parking_instructions, supply_location, special_notes

### `client_timeline`
id, org_id, client_id, event_type, summary, created_by, created_at

**RLS:** append-only style (no delete)

### `jobs`
id, org_id, client_id, service_type_id (FK → service_types), title, date, start_time, duration_minutes, price, status (`scheduled`/`in_progress`/`completed`/`cancelled`), notes, frequency (`one_time`/`weekly`/`biweekly`/`monthly`), recurrence_group_id, recurrence_rule (jsonb), arrived_at, completed_at, invoice_id (FK → invoices **SET NULL**), needs_assignment_reminder (boolean, default false), created_at

**`needs_assignment_reminder`:** Set to `true` when a job is created as Unassigned or when a recurring series worker is assigned "first job only". Intended to trigger a 24h-before-date notification to the org owner — reminder system not yet built (TODO in Schedule.jsx `handleSave`).

**Has child:** `job_assignments` (CASCADE delete)

**RLS DELETE:** ceo + manager only (inline subquery, platform admin bypass)

### `job_assignments`
id, job_id (FK → jobs CASCADE), user_id

### `service_types`
id, org_id, name, description, default_price, default_duration_minutes, is_active

### `pricing_matrix`
id, org_id, service_type_id, bedrooms, bathrooms, frequency, price

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
id, org_id, client_id, invoice_id (FK → invoices **SET NULL**), job_id (FK → jobs **SET NULL**), amount, method (display name string — stored as entered, e.g. "Cash", "Venmo"; legacy rows may have lowercase slugs like `cash`/`venmo`), date, notes, view_token, created_at

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

### `send-email` (v12)
**What:** Sends transactional emails via Resend API. Accepts `{ type, quote_id | invoice_id | payment_id }`, looks up all data from DB using service role key, builds HTML email, sends, logs to `email_log`.
**Types:** `quote_sent`, `invoice_sent`, `payment_receipt`, `quote_approved_notification`
**From:** `{Org Name} via TimelyOps <notifications@timelyops.com>`
**Reply-To:** org owner email (looked up from users where role='ceo')
**Env vars:** `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
**Auth:** Manual JWT verify via `supabase.auth.getUser(token)` — callers must pass `Authorization: Bearer <session.access_token>`
**Currency:** DB queries include `organizations(name, settings)` — `currency_symbol` extracted from `org.settings?.currency_symbol || '$'` and passed to template helpers.
**Client names:** Uses `formatClientName(first_name, last_name, fallback)` helper — joins structured name fields with space, falls back to legacy `name`.
**Client address:** `formatClientAddress(client)` helper in Edge Function (Deno-native, no imports) returns `string[]` from structured fields, falls back to legacy `address`. Used in quote "Prepared for" and invoice "Billed to" blocks. DB queries for quote/invoice include `clients(name, first_name, last_name, email, address, address_line_1, address_line_2, city, state_province, postal_code)`.

### `send-sms`
**What:** Sends SMS via Twilio API. Accepts `{ to, message }`.
**Env vars:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

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

### Utility libraries (Phase 2 refactor)
- `src/lib/formatAddress.js` — exports:
  - `formatName(first, last)` — joins with space, trims, used everywhere instead of `client.name`
  - `formatAddress(client)` — single-line string from structured fields, falls back to `client.address`
  - `formatAddressLines(client)` — returns `string[]` for multi-line rendering in detail views
- `src/lib/formatCurrency.js` — exports `formatCurrency(amount, symbol)` (2 decimal places with symbol prefix, handles null/undefined)

Both are used across all data pages. Never hardcode `$` or build display names from `client.name` directly.

### Import templates (Phase 3)
Templates are XLSX files with a **Data** sheet (headers + 2 sample rows) and an **Instructions** sheet. Generated by `downloadXLSXTemplate(filename, templateDef)` in `src/lib/csv.js` via dynamic import of `xlsx` library (already a dependency). `CSVImport.jsx` uses XLSX download when `templateDef.instructions` is present, falls back to CSV for templates without it.

**Client template columns:** first_name*, last_name, phone, email, address_1, address_2, city, state_province, postal_code, country, tags, notes, property_type, bedrooms, bathrooms, square_footage, pet_details, parking_instructions, alarm_code, key_info, supply_location, special_notes

**Worker template columns:** name*, phone, email, role, availability, address_1, address_2, city, state_province, postal_code, country

Import handler in Clients.jsx maps `address_1` → `address_line_1`, `key_info` → `key_info`, `parking_instructions` → `parking_instructions`, `supply_location` → `supply_location`.

### Worker assignment required (Phase 4A)
Job creation in Schedule.jsx requires an explicit assignment choice before saving:
- Select one or more workers from the list, OR
- Click "Unassigned — assign before job date" (sets `needs_assignment_reminder = true`)

For recurring series with a worker selected, an inline prompt asks "Assign to all occurrences?" [Yes — all] / [No — this job only]. "No" leaves future instances unassigned with `needs_assignment_reminder = true`. Reminder notification system is not yet built — wired up when automated reminders are added.

### Pricing matrix empty state (Phase 4B)
In the quote add/edit form, an amber banner appears above line items when `pricingMatrix.length === 0`, with a link to `/settings`. Per-line amber highlight + note appears when the matrix has entries but none for the selected service type and price is still 0.

### Worker property details on job cards (Phase 4C)
Jobs query includes `clients(... , client_properties(*))` nested join. In the job view modal, a "Property Details" card (sky blue) shows alarm code, key/access, parking, pets, special notes above the Arrived/Completed buttons — only when at least one field is populated. In DayView, the same details appear inline on each job card when `isWorker = true`.

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

### After quote creation, delivery modal opens immediately
In Quotes.jsx `handleSave` (add mode), after the quote is saved, a fresh DB fetch retrieves the full quote with client join and immediately opens the DeliveryModal. No need to navigate away and back.

### Settings stored in JSONB
`organizations.settings` JSONB holds: `timezone`, `time_format` (`12h`/`24h`), `tax_rate`, `currency_symbol` (e.g. `$`, `€`, `£`), `payment_methods` (string array of display names, e.g. `["Cash","Venmo","Zelle","Check"]`). Not separate columns. After saving settings, page reloads to propagate new values.

**Currency:** All pages derive `const currencySymbol = user?.organizations?.settings?.currency_symbol || '$'` and pass it to `formatCurrency(amount, currencySymbol)` from `src/lib/formatCurrency.js`.
**Payment methods:** All pages derive `const paymentMethods = user?.organizations?.settings?.payment_methods || ['Cash','Venmo','Zelle','Card','Check']`. Method chips in Quotes/Invoices/Payments forms render from this array. Badge colors use `methodColor(method)` helper (case-insensitive, backward-compatible with old lowercase slug values).

### ToastContext action button
`showToast(message, type, { label, onClick })` — optional third arg adds an action button to the toast (used for "Copy link" fallback on failed receipt sends).

### Audit log
`src/lib/auditLog.js` → `logAudit()`. Currently wired to admin actions only. Core pages (clients, invoices, payments, quotes) do NOT yet call `logAudit()`.

### Dashboard → Schedule job navigation
Clicking a job card on the Dashboard calls `routerNavigate('/schedule', { state: { jobId: job.id } })`. Schedule reads `location.state?.jobId` via a `useRef` (prevents re-trigger on jobs reload), finds the job, switches to day view for that date, and calls `openView(job)` to open the detail modal directly.

---

## Known issues / blockers

- **Audit log gaps** — `logAudit()` not wired to core page actions (client creates/edits, invoice creates, quote sends, payments). Only admin actions are logged.
- **No automated reminders** — Professional tier feature. `needs_assignment_reminder` flag is stored on jobs but notification system not built. TODO comment in Schedule.jsx `handleSave`.
- **No online payments** — Invoice view page shows balance but has no Stripe integration. Outstanding invoices require manual payment recording.

---

## TODO / open items

- [ ] Wire `logAudit()` to core page actions (clients, invoices, payments, quotes)
- [ ] Automated reminders system (Professional tier) — wire `needs_assignment_reminder` to 24h-before notification
- [ ] Stripe integration for online payment on `/invoice/:token` page
- [ ] Growth tier AI agent system (inbound/outbound comms via Claude API + Twilio)
- [ ] Client booking portal (Professional tier)
- [ ] Worker GPS check-in (Professional tier)
- [ ] Auto review requests (Professional tier)
- [ ] QuickBooks sync (Growth tier)
- [ ] Supply tracking (Growth tier)
