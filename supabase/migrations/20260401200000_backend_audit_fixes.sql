-- ORDER_HINT: 2/2 — timestamp collision with 20260401200000_advanced_automation_presets.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

/* ═══════════════════════════════════════════════════════════════
   Migration — Backend Audit Fixes (Comprehensive)

   Fixes identified during full backend audit:
   1. RLS: team_members INSERT too permissive
   2. pipeline_deals stage constraint mismatch with frontend
   3. Duplicate trigger on jobs
   4. Missing DELETE policies (contacts, teams, notifications)
   5. Contacts org_id should be NOT NULL for new rows
   6. Missing unique constraint on invoice per job
   7. Concurrent invoice creation guard
   ═══════════════════════════════════════════════════════════════ */

-- ═══════════════════════════════════════════════════════════════
-- 1. FIX: team_members INSERT policy (SECURITY CRITICAL)
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  -- Drop the overly permissive INSERT policy
  DROP POLICY IF EXISTS "Users can insert team members" ON public.team_members;
  DROP POLICY IF EXISTS "team_members_insert_org" ON public.team_members;

  -- Recreate with proper org scope
  CREATE POLICY "team_members_insert_org" ON public.team_members
    FOR INSERT TO authenticated
    WITH CHECK (
      org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid())
    );

  RAISE NOTICE 'Fixed team_members INSERT policy';
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'team_members table does not exist, skipping';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. FIX: pipeline_deals stage constraint
--    Accept BOTH frontend (lowercase) and legacy (Title Case) values
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_deals
  DROP CONSTRAINT IF EXISTS pipeline_deals_stage_check;

ALTER TABLE public.pipeline_deals
  ADD CONSTRAINT pipeline_deals_stage_check
  CHECK (LOWER(stage) IN (
    'new', 'follow_up_1', 'follow_up_2', 'follow_up_3',
    'closed', 'lost',
    -- legacy values (normalized by set_deal_stage RPC)
    'qualified', 'contact', 'quote sent', 'quote_sent'
  ));

-- Normalize existing rows to lowercase
UPDATE public.pipeline_deals
SET stage = LOWER(stage)
WHERE stage IS DISTINCT FROM LOWER(stage);

-- ═══════════════════════════════════════════════════════════════
-- 3. FIX: Remove duplicate trigger on jobs
-- ═══════════════════════════════════════════════════════════════

-- Keep only trg_jobs_set_updated_at (standard pattern), drop the custom one
DROP TRIGGER IF EXISTS set_jobs_updated_at ON public.jobs;
-- Ensure the standard one exists
DROP TRIGGER IF EXISTS trg_jobs_set_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_set_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 4. FIX: Missing DELETE policies
-- ═══════════════════════════════════════════════════════════════

-- contacts: add DELETE policy
DO $$ BEGIN
  DROP POLICY IF EXISTS "contacts_delete_org" ON public.contacts;
  CREATE POLICY "contacts_delete_org" ON public.contacts
    FOR DELETE TO authenticated
    USING (org_id IS NOT NULL AND org_id IN (
      SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()
    ));
  RAISE NOTICE 'Added contacts DELETE policy';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- teams: add DELETE policy
DO $$ BEGIN
  DROP POLICY IF EXISTS "teams_delete_org" ON public.teams;
  CREATE POLICY "teams_delete_org" ON public.teams
    FOR DELETE TO authenticated
    USING (org_id IN (
      SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()
    ));
  RAISE NOTICE 'Added teams DELETE policy';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- notifications: add DELETE policy
DO $$ BEGIN
  DROP POLICY IF EXISTS "notifications_delete_org" ON public.notifications;
  CREATE POLICY "notifications_delete_org" ON public.notifications
    FOR DELETE TO authenticated
    USING (org_id IN (
      SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()
    ));
  RAISE NOTICE 'Added notifications DELETE policy';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 5. FIX: Prevent duplicate invoices per job
-- ═══════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_per_job
  ON public.invoices (job_id)
  WHERE job_id IS NOT NULL AND deleted_at IS NULL AND status <> 'void';

-- ═══════════════════════════════════════════════════════════════
-- 6. FIX: leads status constraint — align with pipeline stages
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN (
    'new', 'contacted', 'estimate_sent', 'follow_up',
    'follow_up_1', 'follow_up_2', 'follow_up_3',
    'qualified', 'won', 'closed', 'lost', 'archived',
    -- legacy values
    'lead', 'proposal', 'negotiation', 'quote_sent'
  ));

-- ═══════════════════════════════════════════════════════════════
-- 7. SERVICE ROLE policies for tables that need backend access
-- ═══════════════════════════════════════════════════════════════

-- Ensure service_role can operate on all core tables
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'clients', 'leads', 'jobs', 'schedule_events', 'pipeline_deals',
    'invoices', 'invoice_items', 'payments', 'notifications', 'tasks',
    'teams', 'contacts', 'job_line_items', 'job_intents'
  ]) LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS "%s_service_all" ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY "%s_service_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t
      );
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 8. FIX: invoice_sequences policy (was using ALL, should be specific)
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  DROP POLICY IF EXISTS "invoice_sequences_update_org" ON public.invoice_sequences;
  DROP POLICY IF EXISTS "invoice_sequences_select_org" ON public.invoice_sequences;
  DROP POLICY IF EXISTS "invoice_sequences_upsert_org" ON public.invoice_sequences;
  DROP POLICY IF EXISTS "invoice_sequences_update_only" ON public.invoice_sequences;

  CREATE POLICY "invoice_sequences_select_org" ON public.invoice_sequences
    FOR SELECT TO authenticated
    USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

  CREATE POLICY "invoice_sequences_upsert_org" ON public.invoice_sequences
    FOR INSERT TO authenticated
    WITH CHECK (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));

  CREATE POLICY "invoice_sequences_update_only" ON public.invoice_sequences
    FOR UPDATE TO authenticated
    USING (org_id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = auth.uid()));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
