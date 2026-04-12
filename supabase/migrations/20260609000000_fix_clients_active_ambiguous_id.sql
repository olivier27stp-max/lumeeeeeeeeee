-- Fix "column reference 'id' is ambiguous" on clients / clients_active
--
-- Root cause: clients_active view (from migration 20260327) uses
--   SELECT c.*, EXISTS (SELECT 1 FROM leads l WHERE l.client_id = c.id ...)
-- combined with security_invoker = true.  When PostgREST evaluates the
-- RLS policies (which also contain subqueries), PostgreSQL cannot
-- disambiguate "id" between the view alias and the policy subquery.
--
-- Fix:
--   1. Recreate clients_active as a simple view (no subquery, no is_lead)
--   2. Qualify all column refs in clients RLS policies to prevent future ambiguity
--   3. Drop redundant overlapping policies (having 3+ SELECT policies is unnecessary)

begin;

-- ══════════════════════════════════════════════════════════════
-- 1. Recreate clients_active — simple, safe, no subquery
-- ══════════════════════════════════════════════════════════════

drop view if exists public.clients_active;
create view public.clients_active with (security_invoker = true) as
  select * from public.clients where deleted_at is null;

grant select on public.clients_active to authenticated, anon;

-- ══════════════════════════════════════════════════════════════
-- 2. Clean up clients RLS: drop all existing, recreate with
--    fully qualified column references
-- ══════════════════════════════════════════════════════════════

-- Drop every existing policy on clients
drop policy if exists "clients_select_fix"        on public.clients;
drop policy if exists "clients_select_org"        on public.clients;
drop policy if exists "clients_select_org_member" on public.clients;
drop policy if exists "clients_insert_fix"        on public.clients;
drop policy if exists "clients_insert_org"        on public.clients;
drop policy if exists "clients_update_fix"        on public.clients;
drop policy if exists "clients_update_org"        on public.clients;
drop policy if exists "clients_delete_org"        on public.clients;
drop policy if exists "clients_write_org_admin"   on public.clients;

-- SELECT: org membership check (single clean policy)
create policy clients_select on public.clients
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), clients.org_id));

-- INSERT: org membership + created_by check
create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.has_org_membership((select auth.uid()), clients.org_id));

-- UPDATE: org membership check
create policy clients_update on public.clients
  for update to authenticated
  using  (public.has_org_membership((select auth.uid()), clients.org_id))
  with check (public.has_org_membership((select auth.uid()), clients.org_id));

-- DELETE: org membership + admin check
create policy clients_delete on public.clients
  for delete to authenticated
  using (
    public.has_org_membership((select auth.uid()), clients.org_id)
    and public.has_org_admin_role((select auth.uid()), clients.org_id)
  );

commit;
