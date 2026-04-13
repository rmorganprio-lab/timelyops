-- Fix mutable search_path security advisory
-- Adds SET search_path = public to all affected functions.
-- No logic, parameters, return types, or SECURITY DEFINER settings are changed.

-- ─── user_org_id ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_org_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $function$
  select org_id from public.users where id = auth.uid()
$function$;


-- ─── user_role ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $function$
  SELECT role FROM public.users WHERE id = auth.uid()
$function$;


-- ─── fn_set_invoice_number ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_set_invoice_number()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
DECLARE
  next_val integer;
BEGIN
  -- Atomically upsert the counter and return the new value
  INSERT INTO org_sequences (org_id, sequence_name, current_value)
    VALUES (NEW.org_id, 'invoice', 1)
    ON CONFLICT (org_id, sequence_name)
    DO UPDATE SET current_value = org_sequences.current_value + 1
    RETURNING current_value INTO next_val;

  NEW.invoice_seq    := next_val;
  NEW.invoice_number := 'INV-' || LPAD(next_val::text, 4, '0');
  RETURN NEW;
END;
$function$;


-- ─── fn_set_quote_number ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_set_quote_number()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
DECLARE
  next_val integer;
BEGIN
  INSERT INTO org_sequences (org_id, sequence_name, current_value)
    VALUES (NEW.org_id, 'quote', 1)
    ON CONFLICT (org_id, sequence_name)
    DO UPDATE SET current_value = org_sequences.current_value + 1
    RETURNING current_value INTO next_val;

  NEW.quote_seq    := next_val;
  NEW.quote_number := 'QT-' || LPAD(next_val::text, 4, '0');
  RETURN NEW;
END;
$function$;


-- ─── fn_set_credit_note_number ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_set_credit_note_number()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
DECLARE
  next_val integer;
BEGIN
  INSERT INTO org_sequences (org_id, sequence_name, current_value)
    VALUES (NEW.org_id, 'credit_note', 1)
    ON CONFLICT (org_id, sequence_name)
    DO UPDATE SET current_value = org_sequences.current_value + 1
    RETURNING current_value INTO next_val;

  NEW.credit_note_seq    := next_val;
  NEW.credit_note_number := 'CN-' || LPAD(next_val::text, 4, '0');
  RETURN NEW;
END;
$function$;


-- ─── fn_update_credit_notes_updated_at ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_update_credit_notes_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;


-- ─── fn_prevent_financial_delete ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_prevent_financial_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION
    'Deletion of financial records is not permitted. Use void or reverse instead.'
    USING ERRCODE = 'restrict_violation';
END;
$function$;


-- ─── fn_lock_payment_date ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_lock_payment_date()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  IF NEW.date IS DISTINCT FROM OLD.date THEN
    RAISE EXCEPTION
      'Payment date cannot be changed after recording. Reverse this payment and create a new one.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;


-- ─── fn_lock_invoice_issue_date ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_lock_invoice_issue_date()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  IF NEW.issue_date IS DISTINCT FROM OLD.issue_date
     AND OLD.sent_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Invoice date cannot be changed after the invoice has been sent.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;


-- ─── fn_lock_job_completed_at ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_lock_job_completed_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
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
$function$;


-- ─── fn_prevent_unvoid_invoice ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_prevent_unvoid_invoice()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS NULL THEN
    RAISE EXCEPTION
      'A voided invoice cannot be un-voided. Create a new invoice instead.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;


-- ─── fn_prevent_unreverse_payment ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_prevent_unreverse_payment()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS NULL THEN
    RAISE EXCEPTION
      'A reversed payment cannot be un-reversed. Create a new payment instead.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;
