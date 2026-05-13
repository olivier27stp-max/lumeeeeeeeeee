-- ════════════════════════════════════════════════════════════════════════════
-- Security P0 remediation — 2026-05-13
-- Findings from SECURITY_STATE_2026_05_13.md audit
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fix 1: revert STABLE → VOLATILE on 13 DML functions ─────────────────────
-- These slipped past the earlier remediation (regex didn't match some bodies).
-- Postgres caches STABLE function results per-statement, causing silent no-op
-- writes and nondeterministic row counts.

DO $$
DECLARE
  f record;
  reverted_count int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.provolatile = 's'
      AND (
        pg_get_functiondef(p.oid) ILIKE '%insert into%'
        OR pg_get_functiondef(p.oid) ~* '\mupdate\s+\w+\s+set\M'
        OR pg_get_functiondef(p.oid) ILIKE '%delete from%'
        OR pg_get_functiondef(p.oid) ILIKE '%perform set_config%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) VOLATILE', f.proname, f.args);
      reverted_count := reverted_count + 1;
      RAISE NOTICE 'Reverted to VOLATILE: %(%)', f.proname, f.args;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Skipped %(%): %', f.proname, f.args, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Total reverted: %', reverted_count;
END $$;


-- ─── Fix 2: webhook_payment_received — REVOKE from authenticated ─────────────
-- This function lets any authenticated user mark ANY tenant's invoice as paid.
-- Only Stripe webhook handler should call it (via service-role client).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'webhook_payment_received'
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.webhook_payment_received(%s) FROM anon, authenticated, PUBLIC', r.args);
      RAISE NOTICE 'Revoked webhook_payment_received(%)', r.args;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped revoke webhook_payment_received(%): %', r.args, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─── Fix 3: invalidate_all_sessions — restrict to self only ─────────────────
-- Currently any auth'd user can force-logout any OTHER user.
-- Restrict EXECUTE to service_role; the legitimate caller (account-deletion
-- flow, force-logout-on-password-change) must go through a server endpoint
-- that validates the caller before calling this via service-role.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'invalidate_all_sessions'
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.invalidate_all_sessions(%s) FROM anon, authenticated, PUBLIC', r.args);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped revoke invalidate_all_sessions(%): %', r.args, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─── Fix 4: seed_automation_presets — restrict to org admin only ────────────
-- Currently any auth'd user can inject SMS/email rules into ANY org_id.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'seed_automation_presets'
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.seed_automation_presets(%s) FROM anon, authenticated, PUBLIC', r.args);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped revoke seed_automation_presets(%): %', r.args, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─── Fix 5: surveys_select_anon leak — drop overly permissive policy ────────

DO $$ BEGIN
  IF to_regclass('public.satisfaction_surveys') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS satisfaction_surveys_select_anon ON public.satisfaction_surveys';
  END IF;
END $$;


-- ─── Fix 6: connected_accounts_delete_org typo ──────────────────────────────
-- Audit reported: `org_id = auth.uid()` (wrong — that compares an org_id to a
-- user_id, never matches). Plus allows any member, should be admin-only.

DO $$ BEGIN
  IF to_regclass('public.connected_accounts') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS connected_accounts_delete_org ON public.connected_accounts';
    EXECUTE 'CREATE POLICY connected_accounts_delete_admin ON public.connected_accounts
             FOR DELETE USING (public.has_org_admin_role(auth.uid(), org_id))';
  END IF;
END $$;


-- ─── Fix 7: batch_soft_delete_clients + batch_soft_delete auth checks ───────
-- Currently any member can mass-delete; should be admin/owner only.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('batch_soft_delete_clients', 'batch_soft_delete')
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, authenticated, PUBLIC',
                     r.proname, r.args);
      RAISE NOTICE 'Revoked %(%) — must now go through admin-gated server route', r.proname, r.args;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped revoke %(%): %', r.proname, r.args, SQLERRM;
    END;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- DONE. Summary:
--   1. 13 STABLE → VOLATILE DML functions (silent no-op writes fix)
--   2. webhook_payment_received: REVOKE from authenticated (must use service-role)
--   3. invalidate_all_sessions: REVOKE from anon/authenticated (admin-only via server)
--   4. seed_automation_presets: REVOKE from anon/authenticated (admin-only)
--   5. satisfaction_surveys_select_anon: DROPPED (cross-tenant leak)
--   6. connected_accounts_delete_org: replaced with admin-only policy
--   7. batch_soft_delete*: REVOKEd from authenticated (must be admin-gated server route)
-- ═══════════════════════════════════════════════════════════════════════════
