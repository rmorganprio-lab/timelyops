# TimelyOps — Audit Controls Implementation Plan

**Date:** March 25, 2026
**Branch:** `audit-controls`
**Purpose:** Add accounting-grade audit controls to all financial records

---

## Before You Start

Paste this into Claude Code first:

```
Check if there are any uncommitted changes in the repo. If there are, commit them with the message "Save current state before audit controls work". Then create a new branch called audit-controls and switch to it. Tell me what you did.
```

Wait for confirmation you're on `audit-controls` before continuing.

---

## Session 1: Database Schema Changes

Commit after this session before moving to Session 2.

```
I need a Supabase migration that makes the following schema changes. Write a single SQL migration file. Do NOT run it yet — just create the file so I can review it.

1. Sequential numbering
- Add a invoice_number integer column to the invoices table, auto-incrementing per org. Create a sequence or use a trigger so each org gets its own sequential count (INV-0001, INV-0002 etc). The number must never be reusable.
- Add a quote_number integer column to the quotes table, same pattern (QT-0001, QT-0002).
- Create a new credit_notes table with its own sequential credit_note_number per org (CN-0001, CN-0002). Columns: id (uuid), org_id, invoice_id (references invoices), credit_note_number, amount, tax_amount, total, reason (text, required), status (draft/sent/applied), created_by, created_at, updated_at.

2. Soft delete / void infrastructure
- Add a voided_at timestamp column to invoices (nullable, null = not voided)
- Add a voided_by uuid column to invoices (references users)
- Add a void_reason text column to invoices
- Add the same three columns to quotes
- Add reversed_at, reversed_by, reversal_reason, and reversal_payment_id (self-referencing — points to the new offsetting payment record) to the payments table
- Remove or disable any existing DELETE RLS policies on invoices, payments, and quotes. Replace with policies that prevent deletion entirely.

3. Payment-to-invoice linking
- Add an invoice_id column to the payments table (nullable, references invoices). This is in addition to any existing job linkage.

4. Tax fields
- Add default_tax_rate (decimal, nullable) and tax_label (text, default 'Tax') and vat_number (text, nullable) to the organisations table
- Add tax_rate (decimal, nullable) and tax_amount (decimal, default 0) to the invoices table
- Add tax_rate and tax_amount to the credit_notes table

5. Date locking preparation
- Add a sent_at timestamp column to invoices (nullable) — this marks when the invoice was actually sent, which triggers the date lock on issue date

Ensure all new columns have appropriate defaults and that RLS policies on the new credit_notes table match the pattern used on invoices (scoped by org_id). Include comments in the SQL explaining what each section does.
```

---

## Session 2: Database Triggers and Constraints

Commit after this session before moving to Session 3.

```
Write a second Supabase migration that adds triggers and constraints on top of the schema from Session 1. Again, create the file for review, don't run it yet.

1. Auto-assign sequential numbers
- Create a trigger on invoices that fires on INSERT and automatically assigns the next invoice_number for that org. Use a helper table or a SELECT MAX + 1 pattern with a lock to prevent race conditions. Format the display number as INV-XXXX (zero-padded to 4 digits) — store the integer, format in the app.
- Same trigger pattern for quotes (QT-XXXX) and credit_notes (CN-XXXX).

2. Prevent deletion
- Create a trigger on invoices, payments, and quotes that raises an exception on DELETE: 'Deletion of financial records is not permitted. Use void or reverse instead.'
- This is a safety net in case RLS policies are ever misconfigured.

3. Date locking
- Create a trigger on payments that prevents UPDATE of the received_date (or whatever the date column is called) after initial insert. If someone tries to change it, raise an exception: 'Payment date cannot be changed after recording. Reverse this payment and create a new one.'
- Create a trigger on invoices that prevents UPDATE of the issue date if sent_at is not null. Exception message: 'Invoice date cannot be changed after the invoice has been sent.'
- Create a trigger on jobs that prevents UPDATE of the completion date if any payment exists linked to that job.

4. Void/reverse constraints
- A voided invoice cannot be un-voided (trigger: if voided_at was not null and the update tries to set it back to null, reject)
- A reversed payment cannot be un-reversed (same pattern)
- Void reason is required (CHECK constraint: if voided_at is not null, void_reason must not be empty)
- Reversal reason is required (same pattern for payments)
```

---

## Session 3: Audit Log Wiring

Commit after this session before moving to Session 4.

```
The audit log infrastructure exists at src/lib/auditLog.js with a logAudit() helper, and the audit_log table is in Supabase. I need to wire this into every financial action across the app.

Find every place in the codebase where the following actions happen and add a logAudit() call:

- Invoice created
- Invoice status changed (draft → sent, sent → overdue, etc.)
- Invoice voided (new action, may not exist yet — add it)
- Payment recorded (through job completion flow AND through invoice payment flow AND manual)
- Payment reversed (new action)
- Quote created
- Quote status changed (draft → sent → approved → declined)
- Quote voided (new action)
- Credit note created (new entity from Session 1)

Each log entry should capture: user id, org_id, action type, entity type, entity id, and a changes object showing what changed (e.g. { status: { from: 'draft', to: 'sent' } }).

Don't refactor anything else — just add the audit logging calls.
```

---

## Session 4: Void and Reverse — Backend Logic

Commit after this session before moving to Session 5.

```
Create helper functions for voiding invoices, reversing payments, and creating credit notes. Put them in a new file src/lib/financialActions.js (or .ts if the project uses TypeScript).

voidInvoice({ supabase, invoiceId, reason, user, adminViewOrg })
- Sets voided_at, voided_by, void_reason on the invoice
- Changes status to 'voided'
- Logs the action to audit log
- Returns the updated invoice
- Throws if invoice is already voided
- Throws if reason is empty

reversePayment({ supabase, paymentId, reason, user, adminViewOrg })
- Creates a NEW payment record with the same amount but negative (or a specific type: 'reversal' field — check what makes sense with the existing payment schema)
- Sets reversed_at, reversed_by, reversal_reason on the original payment
- Links the original and the reversal via reversal_payment_id
- Logs both actions to audit log
- Returns both records
- Throws if payment is already reversed

voidQuote({ supabase, quoteId, reason, user, adminViewOrg })
- Same pattern as voidInvoice

createCreditNote({ supabase, invoiceId, amount, reason, user, adminViewOrg })
- Creates a credit note record linked to the invoice
- The tax amount should be calculated using the invoice's tax rate
- Logs to audit log
- Returns the credit note
- Throws if amount exceeds remaining invoice balance

Each function should use the existing logAudit() helper. Follow the existing code patterns for Supabase queries in the codebase.
```

---

## Session 5: Tax Calculation Logic

Commit after this session before moving to Session 6.

```
Add tax calculation support to the application.

Organisation settings:
- On the organisation settings page (find where org settings are edited), add fields for: default tax rate (percentage), tax label (defaults to "Tax", could be "VAT", "Sales Tax", etc.), and VAT number (optional, text field).

Invoice creation:
- When an invoice is created, pull the org's default_tax_rate and apply it. Calculate: subtotal (existing price), tax_amount (subtotal × rate), total (subtotal + tax_amount). Store all three.
- If the org has no tax rate set, tax_amount is 0 and total equals subtotal (backward compatible).

Invoice display and PDF:
- Update the invoice detail view to show subtotal, tax line (with the org's tax_label and rate), and total
- Update the PDF generator (jsPDF) to show the same breakdown. If the org has a vat_number, display it on the PDF.

Quote creation:
- Apply the same tax logic to quotes so the client sees the tax-inclusive price before approving

Credit notes:
- Credit notes inherit the tax rate from their parent invoice and calculate proportionally
```

---

## Session 6: UI Changes — Replace Delete, Add Void/Reverse

Commit after this session before moving to Session 7.

```
Make the following UI changes across the app. Do NOT change any business logic — the functions from Session 4 already handle that. This is purely about what buttons appear and what they do.

Invoices:
- Remove any "Delete" button on invoices entirely
- Add a "Void Invoice" button that only appears on invoices that are NOT already voided and NOT already fully paid. It should open a modal asking for a void reason (required text field), then call voidInvoice() from src/lib/financialActions.js
- Voided invoices should display with a clear visual indicator (red "VOIDED" badge, strikethrough, or greyed out — whatever fits the existing design)
- Show the invoice number (INV-0001 format) prominently on the invoice detail and list views

Payments:
- Remove any "Delete" button on payments
- Add a "Reverse Payment" button on payment records that are not already reversed. Opens a modal asking for reason, then calls reversePayment()
- Reversed payments show with a "REVERSED" badge. The offsetting reversal record shows as a linked entry
- The payment date field should be read-only after creation (the trigger enforces this at DB level, but the UI should also grey it out)

Quotes:
- Remove any "Delete" button
- Add "Void Quote" with same pattern as invoices
- Show quote number (QT-0001 format)

Credit Notes:
- Add a "Create Credit Note" button on invoice detail view (only on non-voided invoices that have a balance)
- Create a credit notes list view accessible from the sidebar (or a tab within Invoices — check what fits the existing navigation)
- Show credit note number (CN-0001 format)

Date fields:
- Invoice issue date: make read-only if invoice has been sent (sent_at is not null)
- Payment date: always read-only after creation
- Job completion date: read-only if any payment is linked to the job
```

---

## Session 7: Testing and Validation

```
Walk through each of these scenarios and verify the behavior. Tell me if anything fails or behaves unexpectedly:

1. Create an invoice — does it get an auto-assigned sequential number?
2. Create a second invoice — is the number one higher?
3. Try to delete an invoice via Supabase client — does the trigger block it?
4. Void an invoice — does it show as voided? Can you un-void it?
5. Try to void without a reason — does it reject?
6. Record a payment — is the date locked after save?
7. Reverse a payment — does the reversal record appear? Is the original marked?
8. Create an invoice with a tax rate set on the org — does the PDF show subtotal/tax/total?
9. Create a credit note against an invoice — does the balance update correctly?
10. Check the audit log — are all the above actions recorded with who/what/when?
```

---

## After All Sessions

Once everything passes testing, merge back to main:

```
All audit control sessions are complete and tested. Switch back to the main branch, merge the audit-controls branch into main, and push to origin. Tell me what you did.
```

This push will trigger Vercel to deploy the changes to the live site.

---

## Quick Reference: What Each Session Does

| Session | What | Depends On |
|---------|------|------------|
| 1 | Schema changes (new columns, tables) | Nothing — do first |
| 2 | Triggers and constraints (DB-level rules) | Session 1 |
| 3 | Audit log wiring (logging all financial events) | Session 1 |
| 4 | Void/reverse functions (backend logic) | Sessions 1, 2, 3 |
| 5 | Tax calculation (org settings, invoice display, PDF) | Session 1 |
| 6 | UI changes (buttons, modals, badges, read-only fields) | Sessions 4, 5 |
| 7 | Testing (verify all 10 scenarios) | All above |
