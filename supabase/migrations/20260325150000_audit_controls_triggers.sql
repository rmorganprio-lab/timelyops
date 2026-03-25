-- ============================================================
-- Migration: audit_controls_triggers
-- 2026-03-25
--
-- Builds on top of 20260325140000_audit_controls_schema.sql.
--
-- Covers:
--   1. Sequential numbering  — ALREADY DONE in Session 1.
--      (trg_set_invoice_number, trg_set_quote_number,
--       trg_set_credit_note_number all exist.) No action here.
--   2. Hard-delete prevention triggers (belt-and-suspenders
--      on top of the RLS policy removal in Session 1)
--   3. Date locking triggers (payment date, invoice issue date,
--      job completion date)
--   4. Void / reverse immutability triggers + CHECK constraints
-- ============================================================


-- ============================================================
-- SECTION 1: SEQUENTIAL NUMBERING
--
-- Triggers created in migration 20260325140000:
--   trg_set_invoice_number   (invoices,     BEFORE INSERT)
--   trg_set_quote_number     (quotes,        BEFORE INSERT)
--   trg_set_credit_note_number (credit_notes, BEFORE INSERT)
--
-- No action required in this migration.
-- ============================================================


-- ============================================================
-- SECTION 2: HARD-DELETE PREVENTION TRIGGERS
--
-- Even if an RLS policy is accidentally added back, these
-- triggers make it impossible to DELETE from financial tables
-- at the database level. The exception message tells the caller
-- what to do instead.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_prevent_financial_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Deletion of financial records is not permitted. Use void or reverse instead.'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Invoices
CREATE TRIGGER trg_prevent_invoice_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_financial_delete();

-- Payments
CREATE TRIGGER trg_prevent_payment_delete
  BEFORE DELETE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_financial_delete();

-- Quotes
CREATE TRIGGER trg_prevent_quote_delete
  BEFORE DELETE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_financial_delete();


-- ============================================================
-- SECTION 3A: DATE LOCKING — PAYMENTS
--
-- The `date` column on payments is the recorded payment date.
-- Once a payment is saved, its date is immutable. To correct a
-- date error the user must reverse the payment and re-enter it.
--
-- Only fires if `date` actually changed — ordinary updates to
-- notes, reference, etc. are unaffected.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_lock_payment_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date IS DISTINCT FROM OLD.date THEN
    RAISE EXCEPTION
      'Payment date cannot be changed after recording. Reverse this payment and create a new one.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_payment_date
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION fn_lock_payment_date();


-- ============================================================
-- SECTION 3B: DATE LOCKING — INVOICES
--
-- Once an invoice has been sent (sent_at is not null), the
-- issue_date becomes locked. Changing the date on a document
-- the client has already received would be misleading.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_lock_invoice_issue_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issue_date IS DISTINCT FROM OLD.issue_date
     AND OLD.sent_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Invoice date cannot be changed after the invoice has been sent.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_invoice_issue_date
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_lock_invoice_issue_date();


-- ============================================================
-- SECTION 3C: DATE LOCKING — JOBS
--
-- If a payment is linked to a job, that job's completion date
-- (completed_at) cannot be changed. Altering the completion
-- date after payment would corrupt audit trails.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_lock_job_completed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    IF EXISTS (
      SELECT 1 FROM payments WHERE job_id = NEW.id LIMIT 1
    ) THEN
      RAISE EXCEPTION
        'Job completion date cannot be changed after a payment has been recorded against this job.'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_job_completed_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION fn_lock_job_completed_at();


-- ============================================================
-- SECTION 4A: VOID IMMUTABILITY — INVOICES
--
-- Once voided_at is set on an invoice it cannot be cleared.
-- Voids are permanent; if a void was made in error, a new
-- invoice must be created.
--
-- Only blocks attempts to set voided_at back to NULL. Normal
-- updates (changing notes, status, etc.) are unaffected.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_prevent_unvoid_invoice()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS NULL THEN
    RAISE EXCEPTION
      'A voided invoice cannot be un-voided. Create a new invoice instead.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_unvoid_invoice
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_unvoid_invoice();


-- ============================================================
-- SECTION 4B: REVERSAL IMMUTABILITY — PAYMENTS
--
-- Once reversed_at is set on a payment it cannot be cleared.
-- Same principle as void: reversals are permanent.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_prevent_unreverse_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS NULL THEN
    RAISE EXCEPTION
      'A reversed payment cannot be un-reversed. Create a new payment instead.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_unreverse_payment
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_unreverse_payment();


-- ============================================================
-- SECTION 4C: VOID REASON REQUIRED — INVOICES & QUOTES
--
-- CHECK constraints enforce that void_reason is non-empty
-- whenever voided_at is set. This is enforced at the DB level
-- so no application code can accidentally void without a reason.
-- ============================================================

ALTER TABLE invoices
  ADD CONSTRAINT invoices_void_reason_required
  CHECK (
    voided_at IS NULL
    OR (void_reason IS NOT NULL AND void_reason <> '')
  );

ALTER TABLE quotes
  ADD CONSTRAINT quotes_void_reason_required
  CHECK (
    voided_at IS NULL
    OR (void_reason IS NOT NULL AND void_reason <> '')
  );


-- ============================================================
-- SECTION 4D: REVERSAL REASON REQUIRED — PAYMENTS
--
-- Same pattern: reversal_reason must be non-empty whenever
-- reversed_at is set.
-- ============================================================

ALTER TABLE payments
  ADD CONSTRAINT payments_reversal_reason_required
  CHECK (
    reversed_at IS NULL
    OR (reversal_reason IS NOT NULL AND reversal_reason <> '')
  );
