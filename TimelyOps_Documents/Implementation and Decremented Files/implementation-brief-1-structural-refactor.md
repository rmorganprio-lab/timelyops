# Implementation Brief #1: Structural Data Refactor

**Project:** TimelyOps  
**Date:** March 25, 2026  
**Status:** Ready for implementation  

---

## Why we're doing this

TimelyOps is about to receive its first real client data import (Hilda's client list). Before that happens, we need to fix six foundational data structure issues that will be exponentially harder to fix after real data is in the system.

The six issues:
1. Client name is a single field — can't sort by last name or address people by first name
2. Client address is a single freeform field — can't sort, filter, or format consistently
3. Users (workers/managers) have no home address — blocks future route optimization
4. Payment methods are hardcoded to US options — won't work for international orgs
5. Currency and country settings are incomplete — org needs country, currency symbol, and calling code
6. Import templates still say "AllBookd" and use the old single-field structure

---

## BEFORE STARTING: Git checkpoint

```
git add -A && git commit -m "pre-structural-refactor checkpoint"
```

This is non-negotiable. If anything goes wrong, this lets you roll back to today's working state.

---

## Phase 1: Database Migration

Run all of this as a single SQL migration in the Supabase SQL Editor (Dashboard → SQL Editor → New query). Run it all at once — the statements are written to execute in the correct order.

### Important schema notes for Claude Code

- Workers are NOT in a separate table. They are rows in the `users` table with `role = 'worker'`. There is no `workers` table.
- Organisation settings (timezone, time_format, tax_rate, currency) are stored in a JSONB column called `settings` on the `organizations` table. They are NOT separate columns. Follow this existing pattern.
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

-- If the existing 'currency' value is just a symbol like "$", 
-- rename it to currency_code and set it to "USD"
-- Claude Code: CHECK what the current value of settings->'currency' actually is 
-- before running this. If it's already "USD" format, just leave it.
-- If it's "$", update it:
-- UPDATE organizations SET settings = settings || '{"currency_code": "USD"}'::jsonb;
```

**NOTE TO CLAUDE CODE:** Before running the currency update, run this query first and show Rich the result:
```sql
SELECT id, name, settings->'currency' as current_currency FROM organizations;
```
This tells us what format currency is stored in so we don't break anything.

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
SELECT first_name, last_name, city FROM clients WHERE org_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' LIMIT 5;
```

(That's Hilda's org ID from the Product Briefing.)

---

## Phase 2: React App Updates

Work through these in order. Each step depends on the one before it.

### 2A. Create shared helper functions

Create two new utility files that will be used everywhere addresses, names, and currency are displayed.

**File: `src/lib/formatAddress.js`**

```javascript
/**
 * Formats structured address fields into a display string.
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

### 2E. Update payment method dropdowns everywhere

Anywhere the app shows a payment method selector (job completion flow in Schedule.jsx, invoice payment recording in Invoices.jsx, manual payment in Payments.jsx), read the list from `organizations.settings.payment_methods` instead of a hardcoded array.

The org settings should be available through the existing data flow — check how timezone and time_format are currently accessed and follow the same pattern.

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
2. Format addresses using structured fields (can't import the helper — rebuild the logic inline in the Edge Function since it runs in Deno, not the React app)
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

## Phase 4: Test and Verify

### 4A. End-to-end test (do this manually after all code changes)

1. Open Settings → confirm country, currency, and payment method fields appear and save correctly
2. Create a new client with structured name and address fields → confirm it saves and displays correctly
3. Create a quote for that client → confirm the quote shows formatted name and address, and uses the org's currency symbol
4. Send the quote via email → confirm the email shows the correct name, address, and currency
5. Approve the quote → schedule a job → confirm the job card shows formatted address
6. Complete the job → record payment → confirm the payment method dropdown shows the org's configured methods
7. Create an invoice → download PDF → confirm PDF shows structured address (multi-line) and correct currency symbol
8. Import a test CSV with the new column format → confirm it parses correctly

### 4B. Update project documentation

After all changes are working, update memory.md to reflect:
- New columns on clients table (first_name, last_name, address fields)
- New columns on users table (address fields)
- New settings keys in organizations.settings JSONB
- Updated import template structure
- Note that old `name` and `address` columns on clients are kept but deprecated

### 4C. Do NOT drop old columns yet

Keep `clients.name` and `clients.address` in the database as backup. Schedule removal after 2 weeks of stable operation with real data.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Country-agnostic address fields (not US-specific labels) | Founder is in NL, first customer in US, product will expand internationally |
| Country default on org, not per-client | Reduces data entry — most clients for a given business are in the same country |
| Payment methods in settings JSONB, not enum | Different countries use different methods; follows existing settings pattern; no code changes per country |
| Currency settings in JSONB (following existing pattern) | Org settings already use JSONB for timezone, time_format, tax_rate; stay consistent |
| Address fields on users table (not a separate workers table) | Workers ARE users — the users table is where worker data lives |
| Worker name NOT split (yet) | Lower priority; workers referred to by first name; revisit later if needed |
| Keep old columns temporarily | Zero-risk rollback; drop after 2 weeks of confirmed stable operation |
