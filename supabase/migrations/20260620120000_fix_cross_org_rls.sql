-- ============================================================
-- SECURITY FIX — cross-workspace (cross-org) data isolation
-- ============================================================
-- Several tables shipped with an RLS policy of
--   USING (auth.uid() IS NOT NULL)
-- which lets ANY authenticated user read/write EVERY org's rows.
-- This replaces them with strict org-membership checks, matching
-- the rest of the schema (has_org_membership(auth.uid(), org_id)).
--
-- Tables fixed: company_settings, automations, time_entries,
-- notifications (org_id-scoped) and quote_views (scoped via its
-- parent invoice). Idempotent: drops the old policy, creates the
-- correct one. Server-side service_role calls bypass RLS and are
-- unaffected.
-- ============================================================

-- ── company_settings ──────────────────────────────────────
DROP POLICY IF EXISTS company_settings_auth ON public.company_settings;
CREATE POLICY company_settings_org ON public.company_settings
  FOR ALL TO authenticated
  USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

-- ── automations ───────────────────────────────────────────
DROP POLICY IF EXISTS automations_auth ON public.automations;
CREATE POLICY automations_org ON public.automations
  FOR ALL TO authenticated
  USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

-- ── time_entries ──────────────────────────────────────────
DROP POLICY IF EXISTS time_entries_auth ON public.time_entries;
CREATE POLICY time_entries_org ON public.time_entries
  FOR ALL TO authenticated
  USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

-- ── notifications ─────────────────────────────────────────
DROP POLICY IF EXISTS notifications_auth ON public.notifications;
CREATE POLICY notifications_org ON public.notifications
  FOR ALL TO authenticated
  USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

-- ── quote_views (no org_id; scope via parent invoice) ─────
DROP POLICY IF EXISTS quote_views_auth ON public.quote_views;
CREATE POLICY quote_views_org ON public.quote_views
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = quote_views.invoice_id
        AND public.has_org_membership(auth.uid(), i.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = quote_views.invoice_id
        AND public.has_org_membership(auth.uid(), i.org_id)
    )
  );

-- ============================================================
-- SECURITY FIX — invoice_next_number: authorize the org.
-- SECURITY DEFINER function that mutated a sequence for ANY
-- org id passed in, with no membership check. Block authenticated
-- callers from targeting another org. (auth.uid() IS NULL means a
-- trusted server/service_role context — left unaffected.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.invoice_next_number(p_org uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_next integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_org_membership(auth.uid(), p_org) THEN
    RAISE EXCEPTION 'Not allowed for this organization';
  END IF;

  INSERT INTO public.invoice_sequences (org_id, last_value)
  VALUES (p_org, 0)
  ON CONFLICT (org_id) DO NOTHING;

  UPDATE public.invoice_sequences
  SET last_value = last_value + 1,
      updated_at = now()
  WHERE org_id = p_org
  RETURNING last_value INTO v_next;

  RETURN 'INV-' || lpad(v_next::text, 6, '0');
END;
$fn$;
