-- SECURITY FIX 2026-05-12: drop RLS policies that grant `anon` role
-- unrestricted SELECT (USING true) on tenant-scoped tables. With the
-- public anon JWT (present in every JS bundle), an unauthenticated
-- attacker could `curl` and dump every row across every tenant.
-- Notifiable-breach material under Loi 25 / LPRPDE.
--
-- Affected tables:
--   - public.clients   (every client across every org leaked)
--   - public.leads     (every lead across every org leaked)
--   - public.company_settings (every org's business info leaked)
--
-- These policies were named `*_public_quote_view` and were probably
-- intended to support the unauthenticated `/q/:token` quote view.
-- That flow MUST run via a SECURITY DEFINER RPC or the service-role
-- server route with token-scoped lookups instead of broad anon RLS.
-- If a regression appears on the public quote viewer, the correct
-- fix is to add a token-validated RPC, not to restore these policies.

DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS clients_public_quote_view ON public.clients';
  END IF;
  IF to_regclass('public.leads') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS leads_public_quote_view ON public.leads';
  END IF;
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS company_settings_public_read ON public.company_settings';
  END IF;
  -- failed_login_attempts: anon INSERT allows rate-limit table poisoning.
  IF to_regclass('public.failed_login_attempts') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS failed_login_attempts_public_insert ON public.failed_login_attempts';
  END IF;
  -- Tighten surveys_update_anon if the table exists.
  IF to_regclass('public.surveys') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS surveys_update_anon ON public.surveys';
  END IF;
END $$;
