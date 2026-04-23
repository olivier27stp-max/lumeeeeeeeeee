-- ORDER_HINT: 1/2 — timestamp collision with 20260405100000_courses_category_visibility.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ============================================================
-- MIGRATION: 20260405100000_audit_fixes.sql
-- All remaining audit fixes — idempotent, safe to re-run
-- ============================================================

-- ── 1. contacts.org_id NOT NULL ──
ALTER TABLE public.contacts ALTER COLUMN org_id SET NOT NULL;

-- ── 2. DELETE policies for Lume Payments tables ──
DO $$ BEGIN
  CREATE POLICY connected_accounts_delete_org ON public.connected_accounts
    FOR DELETE USING (
      org_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = auth.uid() AND m.org_id = connected_accounts.org_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY payment_requests_delete_org ON public.payment_requests
    FOR DELETE USING (
      org_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = auth.uid() AND m.org_id = payment_requests.org_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. Invoice void constraint ──
DO $$ BEGIN
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_void_zero_paid
    CHECK (status != 'void' OR paid_cents = 0 OR paid_cents IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. Money non-negative constraints ──
DO $$ BEGIN
  ALTER TABLE public.payments ADD CONSTRAINT payments_amount_nonneg
    CHECK (amount_cents IS NULL OR amount_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.payment_requests ADD CONSTRAINT pr_amount_nonneg
    CHECK (amount_cents > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. Soft delete columns (consistency) ──
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.connected_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── 6. Performance indexes ──
CREATE INDEX IF NOT EXISTS invoices_org_status_idx ON public.invoices (org_id, status);
CREATE INDEX IF NOT EXISTS payments_org_invoice_idx ON public.payments (org_id, invoice_id);
CREATE INDEX IF NOT EXISTS pr_org_invoice_idx ON public.payment_requests (org_id, invoice_id);

-- ── 7. Ensure exec_sql is gone ──
DROP FUNCTION IF EXISTS public.exec_sql(text) CASCADE;
