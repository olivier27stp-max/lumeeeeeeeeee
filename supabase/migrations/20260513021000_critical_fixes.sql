-- ════════════════════════════════════════════════════════════════════════════
-- Critical fixes from 2026-05-13 audit
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. ADD missing stripe_subscription_id column ───────────────────────────
-- 5 webhook handlers + cancel-subscription reference this column but it
-- doesn't exist. Cancellation returns 500, renewals silently fail.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_cus_idx
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;


-- ─── 2. Add stripe_charge_id column to payments (for dispute matching) ──────

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_charge_id text;

CREATE INDEX IF NOT EXISTS payments_stripe_charge_idx
  ON public.payments (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;


-- ─── 3. Tighten quotes_public_view_token RLS ────────────────────────────────
-- Currently: any authenticated user can SELECT any quote with view_token != null.
-- Should only allow: anon role with view_token claim, OR org members.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND policyname='quotes_public_view_token'
  ) THEN
    DROP POLICY quotes_public_view_token ON public.quotes;
  END IF;
END $$;

-- Re-create scoped to anon role only (public quote view via token).
-- Authenticated users use the normal org-membership policy.
CREATE POLICY quotes_public_view_token ON public.quotes
  FOR SELECT
  TO anon
  USING (view_token IS NOT NULL AND deleted_at IS NULL);


-- ─── 4. Fix jobs.client_id + invoices.client_id ON DELETE behavior ──────────
-- ON DELETE CASCADE on client_id would wipe paid invoices/jobs if a client
-- is deleted via service-role. Change to SET NULL (keep historical data).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'f'
      AND connamespace = 'public'::regnamespace
      AND conrelid::regclass::text IN ('public.jobs', 'public.invoices')
      AND pg_get_constraintdef(oid) ILIKE '%client_id%REFERENCES%public.clients%ON DELETE CASCADE%'
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL',
        r.tbl, r.conname
      );
      RAISE NOTICE 'Changed % FK to ON DELETE SET NULL', r.conname;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped % on %: %', r.conname, r.tbl, SQLERRM;
    END;
  END LOOP;
END $$;
