-- ============================================================
-- MIGRATION: 20260512170200_tighten_payments_rls.sql
-- Tighten RLS on connected_accounts and payment_requests so that
-- INSERT/UPDATE require admin/owner role, not just org membership.
--
-- Previous policies (20260405000000_lume_payments_connect.sql:47-59
-- and :107-119) allowed any org member to clobber stripe_account_id
-- or mark a payment_request as 'paid' via direct PostgREST. (F-18/F-19)
--
-- SELECT policies are left untouched — regular members may still
-- view payments + connected accounts in the UI.
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── connected_accounts ───────────────────────────────────────

drop policy if exists "connected_accounts_insert_org" on public.connected_accounts;
create policy "connected_accounts_insert_org" on public.connected_accounts
  for insert
  with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists "connected_accounts_update_org" on public.connected_accounts;
create policy "connected_accounts_update_org" on public.connected_accounts
  for update
  using (public.has_org_admin_role(auth.uid(), org_id))
  with check (public.has_org_admin_role(auth.uid(), org_id));

-- ── payment_requests ─────────────────────────────────────────

drop policy if exists "payment_requests_insert_org" on public.payment_requests;
create policy "payment_requests_insert_org" on public.payment_requests
  for insert
  with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists "payment_requests_update_org" on public.payment_requests;
create policy "payment_requests_update_org" on public.payment_requests
  for update
  using (public.has_org_admin_role(auth.uid(), org_id))
  with check (public.has_org_admin_role(auth.uid(), org_id));
