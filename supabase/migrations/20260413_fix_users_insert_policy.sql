-- Fix RLS INSERT policy on public.users
--
-- Gap: the existing "Org members can insert users" policy only checks
-- org_id = user_org_id(). It does not prevent an authenticated user from
-- inserting a row with is_platform_admin = true or role = 'ceo'.
--
-- Fix: add is_platform_admin = false and role IN ('worker', 'manager') to
-- the WITH CHECK clause. CEOs are only ever created by the platform admin
-- (via service role, which bypasses RLS), so this does not affect any
-- existing app flow.

DROP POLICY IF EXISTS "Org members can insert users" ON public.users;

CREATE POLICY "Org members can insert users"
  ON public.users
  FOR INSERT
  WITH CHECK (
    org_id = user_org_id()
    AND is_platform_admin = false
    AND role IN ('worker', 'manager')
  );
