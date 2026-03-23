# TimelyOps — Project Memory

Last updated: 2026-03-23 (email system added)

---

## What's been built

### Auth
- Phone OTP via Twilio + Supabase (primary)
- Email OTP as fallback
- First-time login links `auth.uid` to existing `users` row by phone, then email
- Known issue: Twilio trial blocks SMS to NL numbers — use email OTP when testing from NL

### Core pages
All pages receive `user` as a prop. Multi-tenancy enforced via Supabase RLS + explicit `org_id` filters.

| Page | Route |
|------|-------|
| Dashboard | / |
| Clients | /clients |
| Workers | /workers |
| Schedule | /schedule |
| Quotes | /quotes |
| Invoices | /invoices |
| Payments | /payments |
| Reports | /reports |

Workers (CEO/manager only) see full nav. Workers see only My Jobs + Clients.

### Admin panel
Routes: `/admin`, `/admin/orgs`, `/admin/users`, `/admin/audit`
- Guarded by `is_platform_admin` on `users` table
- RLS uses a `SECURITY DEFINER` function to avoid recursion when checking admin status
- Admin can "View org data" — scopes all data queries to the selected org without changing identity
- All admin actions logged to `audit_log` table

### Outbound email (Resend)
- Edge Function `send-email` (JWT required): 5 types — `quote`, `invoice`, `payment_receipt`, `quote_approved`, `quote_declined`
- Edge Function `quote-action` (no JWT, deploy with `--no-verify-jwt`): token-based actions for public pages — `get_quote`, `approve_quote`, `decline_quote`, `get_invoice`
- Public pages: `/approve/:token` (QuoteApproval.jsx), `/invoice/:token` (InvoiceView.jsx) — no auth required
- DB columns: `quotes.approval_token`, `quotes.approved_at`, `quotes.declined_at`, `quotes.decline_reason`; `invoices.view_token`; `email_log` table
- Send buttons: Quotes (draft→Send Quote, sent→Resend Quote), Invoices (draft→Send Invoice, sent→Resend Invoice), Payments (Send Receipt)
- From: `{Org Name} via TimelyOps <notifications@timelyops.com>`; Reply-To: org owner email
- Requires: `RESEND_API_KEY` env var in Supabase Edge Functions settings

### Subscription / feature gating
- Tiers: Starter ($79), Professional ($119), Growth ($249)
- Defined in `src/lib/tiers.js`
- `SubscriptionContext` provides `hasFeature(slug)` throughout the app
- `<FeatureGate feature="...">` component wraps premium features
- Hilda (first customer) is on Growth

---

## Key architecture decisions

### Admin org scoping (not impersonation)
Admin switches which org they *view* (via `AdminOrgContext`) while staying logged in as themselves. All data pages derive:
```js
const effectiveOrgId = adminViewOrg?.id ?? user?.org_id
```
This keeps the audit trail clean — every action is attributed to the real user.

### Audit log
Table: `audit_log` — append-only (no update/delete policies).
Helper: `src/lib/auditLog.js` → `logAudit({ supabase, user, adminViewOrg, action, entityType, entityId, changes, metadata })`
Currently wired to: org setting changes, role changes, user creates/updates, org creation, platform admin toggle.
TODO: wire to client/invoice/payment/quote creates in core pages.

### Auth credential updates
Edge Function `admin-update-auth-user` (deployed, ACTIVE v1) handles updating `auth.users` email/phone using the service role key. Called from `AdminUsers.jsx` when `user.auth_linked && (emailChanged || phoneChanged)`.

---

## Supabase
- Project: `allbookd` / ID: `vrssqhzzdhlqnptengju`
- URL: `https://vrssqhzzdhlqnptengju.supabase.co`

---

## Repo / deployment
- GitHub: `rmorganprio-lab/allbookd`
- Vercel: `timelyops.com`
- Branch: `main` → auto-deploys to Vercel on push

---

## TODO / open items
- [ ] Deploy Edge Functions: `supabase functions deploy send-email` and `supabase functions deploy quote-action --no-verify-jwt`
- [ ] Add `RESEND_API_KEY` to Supabase Edge Function environment variables
- [ ] Wire `logAudit()` to client/invoice/payment/quote creates in core pages
- [ ] Upgrade Twilio from trial to remove NL SMS block
- [ ] Growth tier AI agent system (inbound/outbound comms via Claude API + Twilio)
- [ ] Online booking page (Professional tier)
- [ ] Automated reminders (Professional tier)
- [ ] Online payment (Stripe) for invoice view page
