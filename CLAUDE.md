# TimelyOps — Claude Code Project Context

## What this is
TimelyOps is a multi-tenant business management SaaS for small service businesses, starting with housecleaning. Built by a solo founder (Rich) with a stealth first customer (Hilda) already lined up on the Growth tier.

The product name in branding is **TimelyOps**. The GitHub repo and Supabase project are named `allbookd` (previous name — do not rename).

## Tech stack
- **Frontend:** React 19 + Vite 7 + Tailwind CSS 4 — JSX, not TypeScript
- **Backend/DB:** Supabase (Postgres, Auth, RLS, Edge Functions)
- **Hosting:** Vercel — `timelyops.com`, auto-deploy from `main`
- **Email:** Resend API (`RESEND_API_KEY`) — from `notifications@timelyops.com`
- **SMS:** Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`)
- **Auth:** Supabase Auth — phone OTP via Twilio (primary), email magic link (fallback)
- **Charts:** Recharts
- **PDF:** jsPDF
- **Excel export:** XLSX (SheetJS)
- **i18n:** react-i18next — `useTranslation()` hook, `t()` calls throughout; locale files at `src/locales/en.json` and `src/locales/es.json`

Not yet integrated (planned): Claude API (Growth tier AI agents), Stripe (online payments), QuickBooks.

## Supabase project
- **Project ID:** `vrssqhzzdhlqnptengju`
- **URL:** `https://vrssqhzzdhlqnptengju.supabase.co`
- **Anon key:** in `src/lib/supabase.js`
- Deploy Edge Functions: `supabase functions deploy <name> --no-verify-jwt --project-ref vrssqhzzdhlqnptengju`

## Multi-tenancy model
- All user data is scoped by `org_id` on every table
- RLS enforces org isolation — every SELECT/INSERT/UPDATE/DELETE policy checks `org_id = user_org_id()`
- `user_org_id()` — SECURITY DEFINER function: `SELECT org_id FROM users WHERE id = auth.uid()`
- `user_role()` — SECURITY DEFINER function: `SELECT role FROM users WHERE id = auth.uid()`
- Platform admins (`is_platform_admin = true`) bypass RLS via a separate ALL policy
- All data pages derive effective org via: `const effectiveOrgId = adminViewOrg?.id ?? user?.org_id`

## Architecture principles
- Keep it simple and shippable — MVP with a real first customer
- Favour Supabase built-ins (RLS, auth, Edge Functions) over custom backend code
- Don't over-engineer; Rich is building solo
- Edge Functions for external service calls (Resend, Twilio) — never call third-party APIs from the frontend
- Feature gating: `SubscriptionContext` + `<FeatureGate>` component + `hasFeature(slug)` — don't hard-code tier checks inline

## File structure
```
src/
  App.jsx               — routes, auth state, user loading
  pages/
    Dashboard.jsx
    Clients.jsx
    Workers.jsx
    Schedule.jsx
    Quotes.jsx
    Invoices.jsx
    Payments.jsx
    Reports.jsx
    Settings.jsx
    Login.jsx
    QuoteApproval.jsx   — public, no auth, /approve/:token
    InvoiceView.jsx     — public, no auth, /invoice/:token
    PaymentReceipt.jsx  — public, no auth, /receipt/:token
    admin/
      AdminDashboard.jsx
      AdminOrgs.jsx
      AdminUsers.jsx
      AdminAudit.jsx
  components/
    Layout.jsx          — nav, mobile menu, admin banner
    DeliveryModal.jsx   — email/SMS/copy-link picker
    FeatureGate.jsx     — tier gate wrapper
    CSVImport.jsx       — multi-step CSV import flow
    ExportModal.jsx     — multi-table data export
  lib/
    supabase.js         — Supabase client
    tiers.js            — tier/feature definitions, hasFeature()
    csv.js              — parse, validate, template, download
    timezone.js         — formatting, timezone math, US_TIMEZONES list
    auditLog.js         — logAudit() helper
    i18n.js             — i18next init (reads localStorage language on startup)
  locales/
    en.json             — English strings
    es.json             — Spanish strings
  contexts/
    SubscriptionContext.jsx
    ToastContext.jsx    — showToast(message, type?, action?)
    AdminOrgContext.jsx — admin org scoping
supabase/functions/
  send-email/           — Resend email, all 4 email types
  send-sms/             — Twilio SMS
  quote-action/         — public token actions + get_receipt
  admin-update-auth-user/ — update Supabase auth credentials
public/
  landing.html          — static landing page
  favicon.ico + PNGs    — favicons (committed to git)
  site.webmanifest
```

## Coding conventions
- **JSX, not TypeScript** — files are `.jsx` / `.js`, not `.tsx` / `.ts`
- Tailwind for all styling — no separate CSS files
- All data pages take `user` as a prop from App.jsx
- Multi-tenancy: always filter by `org_id` in DB queries, use `effectiveOrgId` pattern
- Toast notifications: `const { showToast } = useToast()` — never use `alert()`
- Admin scoping: `const { adminViewOrg } = useAdminOrg()` — all pages that touch data must implement this
- Error handling on Supabase writes: always capture `{ error }` and show a toast, never silent fail
- Use US English spelling throughout — code, comments, UI text, and documentation (e.g., "organization" not "organisation", "color" not "colour")
- **i18n:** All user-facing strings use `t()` from `useTranslation()` (react-i18next). Add strings to `src/locales/en.json` and `src/locales/es.json` under a page/component namespace (e.g. `clients.*`, `reports.*`). Common strings live in `common.*`. Language persists via `localStorage('timelyops_language')` and is set on login. `landing.html` uses a plain JS `data-i18n` / `applyLang()` system (no React).

## Pricing tiers
Defined in `src/lib/tiers.js`:
- **Essentials** $99/mo, up to 5 staff — dashboard, clients, workers, schedule, quotes, payments, invoices, reports view, client timeline, worker check-in time, AI inbound agent
- **Pro** $149/mo, up to 10 staff — adds reports export, automated reminders, job checklists, worker GPS check-in, auto review requests, route planning
- **Add-ons** available per `ADD_ONS` in tiers.js
- $500 implementation fee for all new customers
- Founding customer discount structure in place (Hilda)

## How to work with Rich
- Rich is the founder — not a developer. He understands processes 
  and logic extremely well but needs technical steps explained in 
  plain language with context (what it does and why, not just how)
- Always use Plan mode for anything that touches multiple files or 
  the database schema
- Commit working code to git before starting any large change
- Surface trade-offs clearly rather than just picking one approach 
  silently
- If something is ambiguous, ask one focused question rather than 
  listing five options
- Be direct and skip encouragement — get to the point

## Keeping documentation current
After completing any task that adds, removes, or changes a feature, 
database table, Edge Function, or integration, update memory.md to 
reflect the change before committing. If a change affects the tech 
stack, architecture, or coding conventions, update CLAUDE.md too.
