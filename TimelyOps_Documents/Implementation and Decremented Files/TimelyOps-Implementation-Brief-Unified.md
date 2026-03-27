# TimelyOps — Unified Implementation Brief

**Date:** March 25, 2026  
**Status:** Ready for implementation  
**Scope:** Structural data refactor + UI/UX improvements  

Work through the phases in order. Each phase depends on the one before it. Do not skip ahead.

---

## BEFORE STARTING: Git checkpoint

```
git add -A && git commit -m "pre-structural-refactor checkpoint"
```

Non-negotiable. If anything goes wrong, this lets you roll back to today's working state.

---

## Phase 1: Database Migration

Run all of this as a single SQL migration in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

### Important schema notes

- Workers are NOT in a separate table. They are rows in the `users` table with `role = 'worker'`. There is no `workers` table.
- Organisation settings (timezone, time_format, tax_rate, currency) are stored in a JSONB column called `settings` on the `organizations` table. They are NOT separate columns. Follow this existing pattern for all new settings.
- The `clients` table has a companion `client_properties` table (one-to-one) for property details. Address fields go on `clients`, not `client_properties`.

### 1A. Split client name into first_name + last_name

```sql
-- Add new columns
ALTER TABLE clients
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT;

-- Migrate existing data: split on the FIRST space
-- "Jane Smith" → first_name: "Jane", last_name: "Smith"
-- "Jane" (no space) → first_name: "Jane", last_name: NULL
UPDATE clients SET
  first_name = CASE
    WHEN position(' ' in name) > 0 THEN left(name, position(' ' in name) - 1)
    ELSE name
  END,
  last_name = CASE
    WHEN position(' ' in name) > 0 THEN substring(name from position(' ' in name) + 1)
    ELSE NULL
  END
WHERE name IS NOT NULL;

-- Make first_name required going forward
ALTER TABLE clients ALTER COLUMN first_name SET NOT NULL;

-- DO NOT drop the old 'name' column yet — keep it as a backup reference
```

### 1B. Break out client address into structured fields

```sql
ALTER TABLE clients
  ADD COLUMN address_line_1 TEXT,
  ADD COLUMN address_line_2 TEXT,
  ADD COLUMN city TEXT,
  ADD COLUMN state_province TEXT,
  ADD COLUMN postal_code TEXT,
  ADD COLUMN country TEXT DEFAULT 'US';

-- DO NOT attempt to parse existing freeform addresses.
-- Current data is test/example data. The old 'address' column stays as reference.
```

### 1C. Add address fields to the users table

Workers (and managers/owners) may need home addresses for route planning. Since workers live in the `users` table, that's where these fields go.

```sql
ALTER TABLE users
  ADD COLUMN address_line_1 TEXT,
  ADD COLUMN address_line_2 TEXT,
  ADD COLUMN city TEXT,
  ADD COLUMN state_province TEXT,
  ADD COLUMN postal_code TEXT,
  ADD COLUMN country TEXT DEFAULT 'US';
```

### 1D. Expand organisation settings with country and currency details

The `organizations.settings` JSONB already contains `currency`. We need to add `country`, `currency_symbol`, and `default_country_calling_code`. We also need to check what format `currency` is currently stored in and standardise it.

```sql
-- Add country, currency_symbol, and calling code to the settings JSONB
-- This preserves all existing settings values (timezone, time_format, tax_rate, currency)
UPDATE organizations
SET settings = settings
  || '{"country": "US"}'::jsonb
  || '{"currency_symbol": "$"}'::jsonb
  || '{"default_country_calling_code": "+1"}'::jsonb
WHERE NOT (settings ? 'country');
```

**NOTE TO CLAUDE CODE:** Before running any currency update, run this query first and show Rich the result:
```sql
SELECT id, name, settings->'currency' as current_currency FROM organizations;
```
This tells us what format currency is stored in so we don't break anything. If it's already "USD" format, leave it. If it's "$", update it to "USD" and rename the key to `currency_code`.

### 1E. Add configurable payment methods to organisations

```sql
-- Add payment_methods as a JSONB array in the settings column
UPDATE organizations
SET settings = settings || '{"payment_methods": ["Cash", "Venmo", "Zelle", "Card", "Bank Transfer", "Check", "Other"]}'::jsonb
WHERE NOT (settings ? 'payment_methods');
```

Also check whether `payments.method` is an enum or text type:
```sql
SELECT data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'payments' AND column_name = 'method';
```

If it's an enum, convert it to text so custom payment methods work:
```sql
-- Only run this if the query above shows it's an enum
ALTER TABLE payments ALTER COLUMN method TYPE TEXT;
```

### 1F. Verify RLS still works

```sql
-- Quick check: can you still query clients scoped to an org?
SELECT first_name, last_name, city FROM clients
WHERE org_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' LIMIT 5;
```

(That's Hilda's org ID from the Product Briefing.)

---

## Phase 2: React App — Structural Updates

These are the data structure changes to the React app. Work through them in order.

### 2A. Create shared helper functions

Create two new utility files that will be used everywhere addresses, names, and currency are displayed.

**File: `src/lib/formatAddress.js`**

```javascript
/**
 * Formats structured address fields into a single-line display string.
 * Handles missing fields gracefully.
 *
 * US example: "123 Main St, Apt 4B, Sacramento, CA 95814"
 * NL example: "Keizersgracht 100, 1015 AA Amsterdam"
 */
export function formatAddress({ address_line_1, address_line_2, city, state_province, postal_code, country }) {
  const parts = [];
  if (address_line_1) parts.push(address_line_1);
  if (address_line_2) parts.push(address_line_2);

  if (country === 'NL') {
    // Dutch format: postal code before city
    const cityLine = [postal_code, city].filter(Boolean).join(' ');
    if (cityLine) parts.push(cityLine);
  } else {
    // US/default format: City, State ZIP
    const cityLine = [city, [state_province, postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (cityLine) parts.push(cityLine);
  }

  return parts.join(', ');
}

/**
 * Formats a multi-line address for PDFs and invoices.
 * Returns an array of lines.
 */
export function formatAddressLines({ address_line_1, address_line_2, city, state_province, postal_code, country }) {
  const lines = [];
  if (address_line_1) lines.push(address_line_1);
  if (address_line_2) lines.push(address_line_2);

  if (country === 'NL') {
    const cityLine = [postal_code, city].filter(Boolean).join(' ');
    if (cityLine) lines.push(cityLine);
  } else {
    const cityLine = [city, [state_province, postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (cityLine) lines.push(cityLine);
  }

  return lines;
}

/**
 * Formats first_name + last_name into a display name.
 */
export function formatName(first_name, last_name) {
  return [first_name, last_name].filter(Boolean).join(' ');
}
```

**File: `src/lib/formatCurrency.js`**

```javascript
/**
 * Formats a number as currency using the org's currency symbol.
 *
 * formatCurrency(150, '$') → "$150.00"
 * formatCurrency(150, '€') → "€150.00"
 */
export function formatCurrency(amount, currencySymbol = '$') {
  if (amount == null) return '';
  return `${currencySymbol}${Number(amount).toFixed(2)}`;
}
```

### 2B. Update the Client form (Clients.jsx)

1. Replace the single "Name" input with two fields side by side: **"First Name"** (required) and **"Last Name"**
2. Replace the single "Address" input with six fields:
   - Address Line 1 (full width)
   - Address Line 2 (full width, placeholder: "Apt, suite, unit, etc.")
   - City and State/Province (side by side, 50/50)
   - Postal Code and Country (side by side, 50/50)
   - Country should default to the organisation's `settings.country` value
3. Update all Supabase queries:
   - INSERT/UPDATE: write `first_name`, `last_name`, and all six address fields
   - SELECT: read the new fields
   - Search: search across `first_name`, `last_name`, `city`, `address_line_1` (not the old `name` and `address` fields)
4. Update the client list/table display to use `formatName()` and `formatAddress()`
5. Update the client detail view / client timeline to use the new fields

### 2C. Update the Workers form (Workers.jsx)

Add an optional "Home Address" section to the worker creation/editing form. Same six fields as clients (address_line_1 through country). Label it "Home Address (optional — for route planning)". These fields write to the `users` table.

### 2D. Update Organisation Settings (Settings.jsx)

Add new fields to the existing Settings page:

1. **Country** — dropdown (US, NL, GB, CA, AU, DE, FR, ES, etc.)
2. **Currency Code** — auto-set when country changes (US→USD, NL→EUR, GB→GBP, etc.) but editable
3. **Currency Symbol** — auto-set when country changes (US→$, NL→€, GB→£, etc.) but editable
4. **Default Country Calling Code** — auto-set from country (+1, +31, +44, etc.) but editable
5. **Payment Methods** — a list showing which payment methods this org uses. Users can add/remove methods. Default set should change when country changes:
   - US: Cash, Venmo, Zelle, Card, Bank Transfer, Check, Other
   - NL: Cash, iDEAL, Tikkie, Card, Bank Transfer, Other
   - GB: Cash, Card, Bank Transfer, BACS, Other
   - AU: Cash, Card, Bank Transfer, PayID, Other
   - Default: Cash, Card, Bank Transfer, Other

All of these save to the `organizations.settings` JSONB column, following the existing pattern used by timezone, time_format, and tax_rate.

### 2E. Update payment method selection — tappable chips from org settings

This replaces BOTH the data source and the UI for payment method selection. Everywhere the app shows a payment method selector (job completion flow in Schedule.jsx, invoice payment recording in Invoices.jsx, manual payment in Payments.jsx):

1. **Data source:** Read the list from `organizations.settings.payment_methods` instead of a hardcoded array. Follow the same pattern used to access timezone and time_format.

2. **UI change:** Replace the dropdown/select with horizontally-arranged tappable chips. Each payment method gets a chip. Tapping a chip selects it (highlighted state). Only one can be selected at a time. This reduces the interaction from two taps to one and removes the need to scroll a dropdown list on mobile.

Design guidance for chips:
- Horizontal row, wrapping to next line if needed on small screens
- Unselected: light gray background, dark text
- Selected: brand color background (or dark background), white text
- Rounded corners, comfortable tap target (minimum 44px height)
- If the org has more than 6 methods, the chips should wrap naturally — no horizontal scroll

### 2F. Update currency display everywhere

Search the entire codebase for hardcoded `$` characters used in currency display. Replace with the org's `settings.currency_symbol`. Places to check:
- Dashboard.jsx (overdue payments, recent payments, stats)
- Quotes.jsx (quote totals, line items)
- Invoices.jsx (invoice totals, line items)
- Payments.jsx (payment amounts)
- Reports.jsx (revenue charts, totals)
- Schedule.jsx (job prices)
- PDF generation in Invoices.jsx (jsPDF code)

Use the `formatCurrency()` helper from 2A.

### 2G. Update all address and name displays

Everywhere a client address appears, use `formatAddress()` or `formatAddressLines()` instead of the old single field. Everywhere a client name appears, use `formatName(first_name, last_name)` instead of the old `name` field. Places to check:
- Dashboard.jsx (job cards showing client address and name)
- Schedule.jsx (job cards, job detail view)
- Clients.jsx (client list, client detail)
- Workers.jsx (worker list, worker detail)
- Quotes.jsx (quote detail showing client info)
- Invoices.jsx (invoice showing client name and address)
- Invoice PDF generation (jsPDF — use `formatAddressLines()` for multi-line)

### 2H. Update the CSV import logic (CSVImport.jsx / csv.js)

The client import parser needs to:
1. Expect new columns: First Name, Last Name, Address 1, Address 2, City, State/Province, Postal Code, Country
2. Map them to the new database fields (first_name, last_name, address_line_1, etc.)
3. Still detect duplicates by phone and email (unchanged)
4. Country should default to the org's country setting if not provided in the CSV

### 2I. Update the send-email Edge Function

The email templates in `supabase/functions/send-email/` build HTML that includes client names and addresses. Update them to:
1. Use `first_name` + `last_name` instead of `name`
2. Format addresses using structured fields (rebuild the formatting logic inline in the Edge Function since it runs in Deno, not the React app — cannot import from src/lib/)
3. Use the org's `currency_symbol` from settings instead of hardcoded "$"

After updating, redeploy:
```
cd ~/Desktop/TimelyOps
supabase functions deploy send-email --no-verify-jwt --project-ref vrssqhzzdhlqnptengju
```

---

## Phase 3: Update Import Templates

### 3A. Client Import Template (TOClientImportTemplate.xlsx)

Update the Clients sheet columns to:

| First Name * | Last Name | Phone | Email | Address 1 | Address 2 | City | State/Province | Postal Code | Country | Tags | Notes | Property Type | Bedrooms | Bathrooms | Square Footage | Pet Details | Parking Instructions | Alarm Code | Key Info | Supply Location | Special Notes |

Update example rows:

Row 1: Jane | Smith | +16505550101 | jane@email.com | 123 Main St | Apt 4B | San Jose | CA | 95120 | US | weekly | Prefers mornings | residential | 3 | 2 | 1800 | 1 dog (friendly) | Driveway, park on left | 1234 | Under doormat | Hall closet | No shoes inside

Row 2: Bob | Johnson | +14085550202 | bob@email.com | 456 Oak Ave | | Palo Alto | CA | 94301 | US | biweekly | Key lockbox | residential | 4 | 3 | 2400 | 2 cats | Street parking only | | Lockbox code 5678 | Garage shelf | Use green cleaning products

Update the Instructions sheet: replace all "AllBookd" references with "TimelyOps" and update column descriptions to match the new structure.

### 3B. Worker Import Template (TOWorkerImportTemplate.xlsx)

Add optional address columns:

| Name * | Phone | Email | Role | Availability | Address 1 | Address 2 | City | State/Province | Postal Code | Country |

Update the Instructions sheet: replace "AllBookd" with "TimelyOps".

Note: We are NOT splitting the worker name field. Workers are typically referred to by first name in the app, and splitting adds form complexity without clear benefit at this stage.

---

## Phase 4: UI/UX Improvements

These changes are independent of the structural refactor but should be done after it, in the same session, while the codebase context is fresh. They touch different parts of the code than Phases 1–3.

### 4A. Worker assignment required on job creation (Schedule.jsx)

Two changes to the job creation flow:

**Change 1 — Make worker assignment an explicit choice:**

When creating a new job, the worker field must not be left blank by accident. Two options must be presented:
- Select a specific worker from the list (as it works now)
- Explicitly choose **"Unassigned — assign before job date"**

The job cannot be saved without one of these two choices. If "Unassigned" is chosen:
- The job should display with the existing yellow card styling (already in place)
- A reminder notification should be triggered to the owner 24 hours before the job date. Implementation note: this reminder needs the automated reminders system, which is not yet built. For now, add a `needs_assignment_reminder` boolean flag on the job record set to `true` when "Unassigned" is chosen. The actual reminder notification will be wired up when the reminders system is built in a future phase. Surface a TODO comment in the code noting this.

**Change 2 — Recurring job series worker assignment:**

When creating a recurring job series and a worker is selected, immediately after worker selection show a prompt:

> "Assign [worker name] to all occurrences in this series?"
> [Yes — assign to all] [No — this job only]

If "Yes", all generated recurring instances get that worker. If "No", only the first instance gets the worker and the rest are created as unassigned (with `needs_assignment_reminder = true` on each).

### 4B. Pricing matrix empty state prompt (Quotes.jsx)

When a quote is being created and the pricing matrix has no entries for the selected service type (or no entries at all), show a visible prompt above or near the price field:

> "Your pricing matrix isn't set up yet — prices won't auto-fill until you add your rates."
> [Set up pricing matrix →]

The link should navigate to wherever the pricing matrix is configured (check the existing app for where this lives — it may be in Settings or a dedicated admin section). If there's no dedicated pricing matrix page yet, link to Settings with a note.

This prompt should:
- Only appear when the matrix is empty for the relevant service type
- Disappear once the user manually enters a price (don't block the flow)
- Not appear if the matrix has entries and the price auto-fills successfully

### 4C. Worker job card — surface property details (Schedule.jsx or Dashboard.jsx)

When a worker taps to open/expand a job card (in either the Dashboard "My Jobs" view or the Schedule day view), the first thing visible should be critical property details pulled from the `client_properties` table:

Display these fields (in this order) above the Arrived button:
1. **Alarm Code** — if present
2. **Key/Access Info** — if present
3. **Parking Instructions** — if present
4. **Pet Details** — if present
5. **Special Notes** — if present (from client_properties.special_notes)

Design guidance:
- Use a compact, card-like section with a subtle background (light gray or light blue)
- Each field on its own line with a label in bold and value next to it
- If ALL of these fields are empty for the client, omit the entire section — don't show an empty card
- This data comes from `client_properties` joined on `client_id`. The query that loads job data for workers needs to include this join (or a separate lookup when the job card is expanded).

---

## Phase 5: Test and Verify

### 5A. Structural refactor tests (Phases 1–3)

1. Open Settings → confirm country, currency, currency symbol, calling code, and payment method fields appear and save correctly
2. Change payment methods in Settings → confirm the chips update on the payment recording screen
3. Create a new client with structured name and address fields → confirm it saves and displays correctly
4. Create a quote for that client → confirm the quote shows formatted name and address with the org's currency symbol
5. Send the quote via email → confirm the email shows the correct name, address, and currency
6. Approve the quote → schedule a job → confirm the job card shows formatted address
7. Complete the job → record payment using tappable chips → confirm chips work and payment saves
8. Create an invoice → download PDF → confirm PDF shows structured address (multi-line) and correct currency symbol
9. Import a test CSV with the new column format → confirm it parses correctly

### 5B. UI/UX improvement tests (Phase 4)

10. Create a new job WITHOUT selecting a worker → confirm you're forced to explicitly choose "Unassigned"
11. Create a recurring job series WITH a worker → confirm the "assign to all?" prompt appears and works for both Yes and No
12. Create a quote when the pricing matrix is empty → confirm the setup prompt appears with a link
13. Create a quote when the pricing matrix IS populated → confirm the prompt does NOT appear and the price auto-fills
14. Log in as a worker → open a job card for a client that HAS property details → confirm alarm code, parking, pets, etc. appear above the Arrived button
15. Open a job card for a client with NO property details → confirm the section is simply not shown

### 5C. Update project documentation

After all changes are working, update memory.md to reflect:
- New columns on clients table (first_name, last_name, address fields, note old columns kept as deprecated)
- New columns on users table (address fields)
- New settings keys in organizations.settings JSONB (country, currency_symbol, currency_code, default_country_calling_code, payment_methods)
- Updated import template structure
- Job creation now requires explicit worker assignment or "Unassigned" choice
- `needs_assignment_reminder` flag on jobs (reminder system not yet wired)
- Worker job cards now surface client property details
- Payment method UI changed from dropdown to tappable chips
- Pricing matrix shows empty-state prompt on quote creation

### 5D. Do NOT drop old columns yet

Keep `clients.name` and `clients.address` in the database as backup. Schedule removal after 2 weeks of stable operation with real data.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Country-agnostic address fields | Founder is in NL, first customer in US, product will expand internationally |
| Country default on org, not per-client | Reduces data entry — most clients for a given business are in the same country |
| Payment methods in settings JSONB, not enum | Different countries use different methods; follows existing settings pattern |
| Currency settings in JSONB | Follows existing pattern for timezone, time_format, tax_rate |
| Address fields on users table | Workers ARE users — no separate workers table exists |
| Worker name NOT split (yet) | Lower priority; workers referred to by first name; revisit later |
| Keep old columns temporarily | Zero-risk rollback; drop after 2 weeks of stable operation |
| Payment chips instead of dropdown | Faster interaction on mobile; built at same time as data source change to avoid double work |
| needs_assignment_reminder flag (no notification yet) | Reminder system doesn't exist yet; flag captures the intent so it can be wired later |
| Property details above Arrived button | Workers need this info before starting work, not after navigating elsewhere |
