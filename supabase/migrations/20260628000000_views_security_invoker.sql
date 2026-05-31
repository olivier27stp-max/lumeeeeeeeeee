-- ============================================================================
-- Force RLS-respecting views (security_invoker = on)
-- ----------------------------------------------------------------------------
-- Context: views run with the VIEW OWNER's privileges by default, which
-- BYPASSES row-level security on the underlying tables. On a multi-tenant CRM
-- this lets any authenticated user read other organizations' rows through a
-- view, even though the base table is correctly protected by RLS.
--
-- These two views were flagged as bypassing RLS:
--   * public.tasks_active     -> reads public.tasks (org-scoped, RLS enabled)
--                                queried directly from the frontend (anon key)
--   * public.org_a2p_status   -> reads public.a2p_registrations (RLS enabled)
--
-- Setting security_invoker = on makes each view enforce the querying user's
-- RLS, so a user only ever sees rows from their own organization. The base
-- tables already have RLS enabled + org-membership policies, so this is the
-- complete fix. Idempotent and safe to re-run.
-- ============================================================================

alter view if exists public.tasks_active   set (security_invoker = on);
alter view if exists public.org_a2p_status set (security_invoker = on);
