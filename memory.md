# TimelyOps — Project Status Board

Last updated: 2026-04-13 (landing page redesigned — value stack, comparison table, live founding-spots counter; founding-spots Edge Function not yet built)

---

## Internationalisation (i18n)

Fully implemented as of 2026-03-30.

- **Library:** react-i18next. Init in `src/lib/i18n.js`.
- **Languages:** English (`en`) and Spanish (`es`). Locale files: `src/locales/en.json` and `src/locales/es.json`.
- **Coverage:** Every user-facing string in all pages, components, App.jsx, and landing.html is translated.
- **Namespaces:** `login.*`, `common.*` (nav, actions, status, roles, toast, delivery, etc.), `dashboard.*`, `schedule.*`, `workers.*`, `clients.*`, `quotes.*`, `invoices.*`, `payments.*`, `reports.*`, `settings.*`, `csvimport.*`, `featuregate.*`, `app.*`, `terms.*`, `privacy.*`.
- **Language persistence:** Stored in `localStorage('timelyops_language')`. Set at login by reading `org.settings.language`. Changing in Settings writes localStorage and calls `i18n.changeLanguage()`, then reloads the page.
- **landing.html:** Plain JS system — `data-i18n="key"` / `data-i18n-html="key"` attributes on elements, `TRANSLATIONS` object, `applyLang(lang)` function called on load and on language switch. No React.
- **PDF text:** `generatePDF()` in Invoices.jsx intentionally kept as hardcoded English — PDFs are fixed-layout client documents.
- **Sub-components:** Each module-level sub-component calls its own `useTranslation()`. Inline sub-components (like `DeltaBadge` inside `MonthlyTab`) use the parent's `t` via closure.

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
| `/settings` | Settings.jsx | ✅ Full | Org name, timezone, time format (12h/24h), tax rate, language picker (en/es) — ceo + platform_admin |
| `/login` | Login.jsx | ✅ Full | Phone OTP primary, email magic link fallback. Footer links to /terms and /privacy. |
| `/approve/:token` | QuoteApproval.jsx | ✅ Full | Public, no auth; approve/decline with reason |
| `/invoice/:token` | InvoiceView.jsx | ✅ Full | Public, no auth; shows invoice with line items |
| `/receipt/:token` | PaymentReceipt.jsx | ✅ Full | Public, no auth; shows payment receipt |
| `/book/:slug` | BookingPage.jsx | ✅ Full | Public, no auth; web widget that drives the booking-agent Edge Function. All tiers (Essentials+). Teal chat UI (#1D9E75 user bubbles, #F0FAF5 agent bubbles). EN\|ES language toggle (localStorage). All strings i18n'd under `booking.*`. Agent responds in customer's language automatically. |
| `/terms` | Terms.jsx | ✅ Full | Public, no auth; Terms of Service (21 sections incl. 8A, v2 dated 2026-03-26). Section 8A: 30-day money-back guarantee — i18n keys `terms.guarantee_title` / `terms.guarantee_body`. |
| `/privacy` | Privacy.jsx | ✅ Full | Public, no auth; Privacy Policy (15 sections, v2 dated 2026-03-26, GDPR-compliant). |
| `/admin` | AdminDashboard.jsx | ✅ Full | Platform-wide stats, tier breakdown |
| `/admin/orgs` | AdminOrgs.jsx | ✅ Full | Org table with View As / Edit / Delete actions; OrgDetailPanel side panel (settings, subscription, users, service types, pricing matrix, industry profiles); Create org |
| `/admin/orgs/:id` | AdminOrgDetail.jsx | ✅ Full | Full-page org detail — two-column: left (settings/subscription), right (users/service types/pricing matrix) |
| `/admin/users` | AdminUsers.jsx | ✅ Full | User directory, "+ New User" modal with org selector |
| `/admin/users/:id` | AdminUserDetail.jsx | ✅ Full | Full-page user detail — edit profile, org, role; is_platform_admin toggle; auth credential update |
| `/admin/audit` | AdminAudit.jsx | ✅ Full | Filterable audit log, 50/page |
| `/admin/profiles` | AdminProfiles.jsx | ✅ Full | Industry profile management |

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

**Hilda's org (a1b2c3d4-…):** Standard Clean (11111111, 2hr), Deep Clean (22222222, 4hr), Move-in/Move-out Clean (33333333, 5hr)

### `pricing_matrix`
id, org_id, service_type_id, bedrooms, bathrooms, frequency (`weekly`/`biweekly`/`monthly`/`one_time`), price

**Hilda's org:** 49 rows of realistic pricing loaded 2026-03-26. Standard Clean: 1–4BR/1–3BA × 4 frequencies ($95–$350). Deep Clean: 1–4BR/1–3BA × one_time + monthly ($195–$525). Move-in/Out: 1–4BR/1–3BA × one_time only ($275–$620).

### `booking_conversations`
id, org_id, channel (`web`/`sms`), messages (jsonb array of `{role, content, ts}`), state (jsonb — accumulated booking info), job_id (FK → jobs, nullable), contact_name, contact_phone, updated_at

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
- `is_platform_admin()` — returns caller's is_platform_admin flag; SECURITY DEFINER to bypass RLS on users table (prevents infinite recursion in RLS policies)

### Platform admin RLS (migration 20260331000000_platform_admin_rls.sql — applied 2026-03-31)
All 23 tables have a `tablename_platform_admin` policy: `FOR ALL USING (is_platform_admin())`. Tables with older inline-lookup policies (org_sequences, credit_notes, booking_conversations) were updated to use the function.

### FK delete behaviour (SET NULL, not RESTRICT)
Deleting a job NULLs: `payments.job_id`, `invoice_line_items.job_id`, `jobs.invoice_id`
Deleting an invoice NULLs: `payments.invoice_id`, `jobs.invoice_id`

---

## Edge Functions (all deployed `--no-verify-jwt`)

### `send-email` (v13 — security hardened)
**What:** Sends transactional emails via Resend API. Accepts `{ type, quote_id | invoice_id | payment_id }`, looks up all data from DB using service role key, builds HTML email, sends, logs to `email_log`.
**Types:** `quote` (quote_sent), `invoice` (invoice_sent), `payment_receipt`. Note: `quote_approved`/`quote_declined` types removed — quote-action calls Resend directly for those notifications.
**Security:** Org ownership enforced — users can only send emails for their own org's records. Platform admins bypass this check. Rate limit: same recipient+type blocked within 60 seconds (checks email_log). All user data HTML-escaped via `escapeHtml()` before template interpolation.
**From:** `{Org Name} via TimelyOps <notifications@timelyops.com>`
**Reply-To:** org owner email (looked up from users where role='ceo')
**Env vars:** `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
**Auth:** Manual JWT verify via `supabase.auth.getUser(token)` — callers must pass `Authorization: Bearer <session.access_token>`

### `send-sms` (v2 — security hardened)
**What:** Sends SMS via Twilio API. Accepts `{ to, message }`.
**Security:** JWT auth required. Phone must be E.164 format (`+` + 7-14 digits). Message max 1600 chars. Rate limit: max 5 SMS/hour to same number (checks email_log). All sends logged to email_log (channel='sms').
**Env vars:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### `quote-action` (v2 — security hardened)
**What:** Handles all public (unauthenticated) token-based actions. Uses service role key for all DB access.
**Actions:** `get_quote` (by approval_token), `approve_quote`, `decline_quote`, `get_invoice` (by view_token), `get_receipt` (by payment view_token)
**Security:** Public responses stripped of client email/phone/id and org id — only display fields returned. `approve_quote` enforces `valid_until` expiry (returns 410 if expired). `decline_reason` capped at 1000 chars. All user data HTML-escaped in notification emails.
**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### `booking-agent` (v2 — language-matching added 2026-04-09)
**What:** AI-powered booking agent for the `/book/:slug` web widget. Accepts `{ org_slug, conversation_id?, message }`. Runs an agentic loop (up to 6 Claude calls) using tools: `get_service_types`, `check_availability`, `get_pricing` (looks up `pricing_matrix`), `create_pending_job` (creates client + job at status `pending_confirmation`, notifies org owner via SMS).
**Auth:** `--no-verify-jwt` — public endpoint. Gated by `hasFeature(org, 'ai_inbound_agent')` (Essentials tier — all orgs).
**Rate limit:** Max 10 messages per conversation.
**Model:** `claude-sonnet-4-6` (claude-sonnet-4-20250514)
**Language:** System prompt instructs agent to always respond in the customer's language — Spanish in → Spanish out; French in → French out. No comment on the language switch.
**Stores:** Conversation in `booking_conversations` table. Created jobs have `source = 'web_booking'`, `status = 'pending_confirmation'`.
**Env vars:** `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### `admin-update-auth-user` (v2 — create_user branch added 2026-04-13)
**What:** Two actions in one function:
1. **Update existing auth user** — accepts `{ auth_user_id, email?, phone? }`, calls `auth.admin.updateUserById()`. Called from AdminUserDetail.jsx when credentials change.
2. **Create new auth user** — accepts `{ create_user: true, user_id, phone }`. Calls `auth.admin.createUser({ phone, phone_confirm: true })`, then updates `public.users SET id = new_auth_uuid, auth_linked = true WHERE id = user_id` using service role. If the public.users update fails, the orphaned auth user is deleted. Called from AdminUsers.jsx new-user flow.
**Security:** Server-side `is_platform_admin` check — frontend cannot bypass. E.164 phone validation on both branches. Logs to `audit_log`.
**Phone normalization:** AdminUsers.jsx normalizes phone to E.164 before calling this function (strips formatting, prepends `+1` for 10-digit US numbers).
**Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### `link-auth-user` (v1 — new 2026-04-12)
**What:** Handles first-time phone OTP login. Accepts `{ phone }`. Finds the `users` row by phone where `auth_linked = false`, then updates its `id` to `auth.uid()` (from JWT) and sets `auth_linked = true`. Uses service role to bypass RLS — necessary because the existing row has a placeholder UUID as its `id`, not `auth.uid()`, so a frontend UPDATE would silently fail (RLS `USING (id = auth.uid())` filters it out).
**Called from:** `App.jsx` `loadUser(authId, session)` — on first login when user row is not found by id, or when row is found but `auth_linked = false`. The `session` object is passed directly from the caller (not re-fetched inside `loadUser`) to avoid a race condition where `supabase.auth.getSession()` can return null immediately after `onAuthStateChange` fires.
**Security:** JWT auth required (manual `auth.getUser()` check). Returns 404 if no unlinked row matches the phone.
**Replaces:** The old `invite-user` function (deleted) and the broken direct-update approach in App.jsx.
**Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### `founding-spots` (NOT YET BUILT — needed for landing page)
**What:** Public endpoint (no JWT) called by `landing.html` on every page load. Should return `{ remaining: N, total: 10 }` based on the live count of founding customers in the DB. Landing page shows "8 of 10" as a fallback while the fetch is in flight, and silently ignores failures.
**How to determine count:** Query `organizations` where `is_founding_customer = true` (or a dedicated config table/env var). `total` is always 10.
**Auth:** None — fully public. No sensitive data returned.
**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Landing page notes (public/landing.html)
- Fully static HTML — no React, no build step
- Sections: announcement banner → nav → hero → value stack (animated) → stats → problem → how it works → comparison table → pricing → testimonial → final CTA → footer
- **Value stack:** 9 rows animate in on scroll; running total counts up to $458/mo; price reveal card fades in after; savings calculated as $458 − $99 = $359/mo ($4,308/yr)
- **Founding spots counter:** Fetches live from `founding-spots` Edge Function; falls back to "8 of 10" if fetch fails or function not deployed
- **Vercel Analytics:** Loaded via `/_vercel/insights/script.js` script tag (same as React app uses `@vercel/analytics/react`)
- **Banner dismiss:** Persisted in `localStorage('timelyops_banner_dismissed')`

---

## Live integrations

| Service | What it does | Credentials location |
|---------|-------------|---------------------|
| Supabase | DB, Auth, RLS, Edge Functions | `src/lib/supabase.js` (anon key), Edge Function env vars (service role) |
| Resend | Transactional email | `RESEND_API_KEY` in Supabase Edge Function settings. Confirmed working in production — 5 emails delivered as of April 2026. |
| Twilio | SMS delivery | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in Supabase Edge Function settings |
| Vercel | Hosting + CI/CD + Analytics | Auto-deploy on push to `main`. Analytics active — `<Analytics />` in App.jsx (`@vercel/analytics/react`) + `/_vercel/insights/script.js` in landing.html. Routing: `vercel.json` sends `/` to `landing.html`; all other paths fall through to React app (`index.html`). |
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

## Landing page (public/landing.html)

Fully rewritten 2026-04-09 for cleaning-business-only positioning using a **Grand Slam Offer** framework.

**i18n system:** Plain JS `TRANSLATIONS` object with `data-i18n` / `data-i18n-html` attributes; `applyLang(lang)` applies on page load and language switch. Separate from the React `react-i18next` system used in the app.

**Announcement banner:** Slim teal (#1D9E75) banner above nav. Dismissible; state persisted to `localStorage('timelyops_banner_dismissed')`. "Founding offer" copy — free personal onboarding for first 10 customers.

**Section order (top to bottom):**
1. Announcement banner
2. Nav (sticky, blur backdrop)
3. Hero — "What if your cleaning business ran itself…" — guarantee-forward subhead; "Get started free" CTA (mailto)
4. Stats bar
5. Value stack (`id="value"`) — 6 items with value badges; dark reveal box: "Total value: $806/mo + $500 setup → Your price: $99/mo. Setup: $0."
6. Guarantee — shield icon, "Try it risk-free for 30 days", full refund promise
7. Problem — "Sound familiar?" — 3 pain-point cards
8. How it works — 6-step pipeline in 2×3 grid
9. Pricing — 2 tiers (Essentials $99/mo, Pro $149/mo)
10. Social proof — placeholder card
11. Final CTA — "Get started free"
12. Footer

Nav `#features` link replaced with `#value` to match new section id.

---

## Known issues / blockers

- **Audit log gaps** — `logAudit()` not wired to core page actions (client creates/edits, invoice creates, quote sends, payments). Only admin actions are logged.
- **No automated reminders** — Professional tier feature. `needs_assignment_reminder` flag is stored on jobs but notification system not built. TODO comment in Schedule.jsx `handleSave`.
- **No online payments** — Invoice view page shows balance but has no Stripe integration. Outstanding invoices require manual payment recording.

## Worker onboarding flow (updated 2026-04-12)

Workers are created via Workers.jsx or AdminUsers.jsx with `auth_linked: false` and `id = crypto.randomUUID()`. On creation, if a phone number is present, the `send-sms` Edge Function is called with: *"You've been added to [Org Name] on TimelyOps. Log in at timelyops.com — enter your phone number to get started."* SMS failure shows a warning toast but does not block the save.

On first phone OTP login, `App.jsx` `loadUser()` fails to find the row by `id = auth.uid()` (because the row still has a placeholder UUID). It then calls `link-auth-user` with `{ phone }`, which uses the service role to update the row's `id` to `auth.uid()` and sets `auth_linked = true`. The profile is then re-fetched and the user is set normally.

---

## Security posture (all 12 items verified live — 2026-04-09)

All items below confirmed in live codebase and live Supabase DB via pg_policies query.

- **Tokens:** `crypto.randomUUID()` everywhere — cryptographically secure UUIDs. ✓
- **Public pages:** QuoteApproval, InvoiceView, PaymentReceipt import no auth context. ✓
- **Public API responses:** Stripped to minimum needed fields (no client email/phone, no internal IDs). ✓
- **Quote expiry:** `approve_quote` returns 410 if `valid_until` is in the past. ✓
- **HTML escaping:** `escapeHtml()` applied to all user data in email templates (send-email, quote-action). ✓
- **Org ownership:** send-email verifies the requesting user's org_id matches the record's org_id before sending. ✓
- **Rate limiting:** send-email: 60s cooldown per recipient+type (checks email_log). send-sms: 5/hour per number (checks email_log, channel='sms'). ✓
- **Edge Function auth:** send-email, send-sms, admin-update-auth-user, link-auth-user all require valid JWT (manual auth.getUser() — deployed --no-verify-jwt). quote-action and booking-agent are intentionally public. ✓
- **RLS — users UPDATE:** Policy `"Users can update their own profile"` has WITH CHECK enforcing role, org_id, and is_platform_admin must equal current DB values. Self-escalation impossible. ✓
- **RLS — clients DELETE:** Policy `"Managers can delete clients"` — restricted to user_role() = ANY ('ceo','manager') within same org (+ platform admin). Workers blocked. ✓
- **RLS — quotes DELETE:** Hard-delete blocked entirely — policy dropped in audit_controls_schema migration. Void/reverse only. ✓
- **ErrorBoundary:** Wraps every individual route and the entire app in App.jsx. ✓
- **Session expiry:** onAuthStateChange detects unintentional drop; window.location.replace('/login?expired=1'). ✓

---

## TODO / open items

- [ ] Wire `logAudit()` to core page actions (clients, invoices, payments, quotes) — currently only admin actions logged
- [ ] Automated reminders system (Pro tier) — `needs_assignment_reminder` flag is stored on jobs; notification system not yet built (TODO comment in Schedule.jsx `handleSave`)
- [ ] Stripe integration for online payment on `/invoice/:token` page
- [ ] Before/after photo uploads — mentioned as Pro tier feature but NOT yet in `tiers.js` or UI; needs feature slug added and storage wired up
- [ ] AI outbound sequences add-on (`ai_outbound_agents`) — follow-ups, payment chasing
- [ ] Route planning (Pro tier) — feature slug in tiers.js, UI not yet built
- [ ] Client booking portal (add-on)
- [ ] Worker GPS check-in (Pro tier) — feature slug in tiers.js, UI not yet built
- [ ] Auto review requests (Pro tier) — feature slug in tiers.js, UI not yet built
- [ ] QuickBooks sync (add-on)
- [ ] Supply tracking (add-on)
- [ ] Social proof section on landing page — currently a placeholder card; needs real customer quote
