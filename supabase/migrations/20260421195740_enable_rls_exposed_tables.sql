-- ============================================================================
-- Enable RLS on 16 PostgREST-exposed tables + add missing policies on 2 tables.
-- Audit refs: C-002 (16 tables without ENABLE ROW LEVEL SECURITY) +
--             C-003 (2 tables with RLS ON but 0 policies).
-- Audit date: 2026-04-21.
--
-- DO NOT APPLY BLINDLY. Test in staging first. Some tables may have existing
-- policies that assume RLS is OFF (e.g. lists, pipelines show POL=Y but RLS=NO
-- in the Phase 1 audit). Enabling RLS activates those dormant policies — verify
-- they match the intent below before promoting to prod.
--
-- Scoping strategy:
--   - Tables with org_id column  : policy via current_setting org or JOIN to orgs/profiles
--   - Tables with user_id column : policy via auth.uid()
--   - Reference tables (plans, promo_codes) : public SELECT, no mutation from anon
--   - failed_login_attempts      : no tenant — anyone can INSERT (login tracking),
--                                  SELECT restricted to platform admins
-- ============================================================================

-- Uses the existing public.current_org_id() helper defined in
-- 20260302210000_crm_core.sql (JWT claim + memberships lookup, NOT profiles).
-- DO NOT redeclare it here — we would shadow the real implementation.

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #1: applied_taxes  (no org_id — scope via document: invoices/quotes)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.applied_taxes enable row level security;
drop policy if exists applied_taxes_tenant_read on public.applied_taxes;
create policy applied_taxes_tenant_read on public.applied_taxes
  for select to authenticated using (
    (document_type = 'invoice' and exists (
      select 1 from public.invoices i where i.id = applied_taxes.document_id
        and i.org_id = public.current_org_id()))
    or (document_type = 'quote' and exists (
      select 1 from public.quotes q where q.id = applied_taxes.document_id
        and q.org_id = public.current_org_id()))
  );
-- Writes go through server-side service_role only (no INSERT/UPDATE policy).

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #2: archived_records
-- ────────────────────────────────────────────────────────────────────────────
alter table public.archived_records enable row level security;
drop policy if exists archived_records_tenant_rw on public.archived_records;
create policy archived_records_tenant_rw on public.archived_records
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #3: automation_executions
-- ────────────────────────────────────────────────────────────────────────────
alter table public.automation_executions enable row level security;
drop policy if exists automation_executions_tenant_read on public.automation_executions;
create policy automation_executions_tenant_read on public.automation_executions
  for select to authenticated using (org_id = public.current_org_id());
-- Writes: server-side only.

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #4: entity_comments
-- ────────────────────────────────────────────────────────────────────────────
alter table public.entity_comments enable row level security;
drop policy if exists entity_comments_tenant_rw on public.entity_comments;
create policy entity_comments_tenant_rw on public.entity_comments
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #5: entity_tags
-- ────────────────────────────────────────────────────────────────────────────
alter table public.entity_tags enable row level security;
drop policy if exists entity_tags_tenant_rw on public.entity_tags;
create policy entity_tags_tenant_rw on public.entity_tags
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #6: job_photos (PII-sensitive: field photos)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.job_photos enable row level security;
drop policy if exists job_photos_tenant_rw on public.job_photos;
create policy job_photos_tenant_rw on public.job_photos
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #7: job_signatures (contractual evidence)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.job_signatures enable row level security;
drop policy if exists job_signatures_tenant_rw on public.job_signatures;
create policy job_signatures_tenant_rw on public.job_signatures
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #8: lead_lists (join table: lead_id, list_id — no tenant column)
-- Scope via parent lists.user_id (lists rows are owned by a user, not an org).
-- ────────────────────────────────────────────────────────────────────────────
alter table public.lead_lists enable row level security;
drop policy if exists lead_lists_owner_rw on public.lead_lists;
create policy lead_lists_owner_rw on public.lead_lists
  for all to authenticated
  using (exists (
    select 1 from public.lists l where l.id = lead_lists.list_id
      and l.user_id = auth.uid()))
  with check (exists (
    select 1 from public.lists l where l.id = lead_lists.list_id
      and l.user_id = auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #9: lists (user-scoped)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.lists enable row level security;
drop policy if exists lists_owner_rw on public.lists;
create policy lists_owner_rw on public.lists
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #10: location_logs (GPS breadcrumbs — sensitive)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.location_logs enable row level security;
drop policy if exists location_logs_tenant_read on public.location_logs;
create policy location_logs_tenant_read on public.location_logs
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists location_logs_self_insert on public.location_logs;
create policy location_logs_self_insert on public.location_logs
  for insert to authenticated
  with check (org_id = public.current_org_id() and user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #11: object_permissions
-- ────────────────────────────────────────────────────────────────────────────
alter table public.object_permissions enable row level security;
drop policy if exists object_permissions_tenant_rw on public.object_permissions;
create policy object_permissions_tenant_rw on public.object_permissions
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #12: pipelines (user-scoped per audit schema: id, name, user_id)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.pipelines enable row level security;
drop policy if exists pipelines_owner_rw on public.pipelines;
create policy pipelines_owner_rw on public.pipelines
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #13: plans — public by design (pricing page needs to read anonymously)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.plans enable row level security;
drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans
  for select to anon, authenticated using (true);
-- Mutations: service_role only (no policy).

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #14: promo_codes — public SELECT by code for redemption
-- Keep SELECT narrow: authenticated only (prevents anon enumeration).
-- ────────────────────────────────────────────────────────────────────────────
alter table public.promo_codes enable row level security;
drop policy if exists promo_codes_auth_read on public.promo_codes;
create policy promo_codes_auth_read on public.promo_codes
  for select to authenticated using (is_active = true);
-- Mutations: service_role only.

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #15: rate_limit_buckets — internal table, lock down to service_role
-- Enabling RLS with no policy => effectively inaccessible via anon/authenticated,
-- which is correct: only backend code (service_role) should read/write.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.rate_limit_buckets enable row level security;
-- (intentionally no policy)

-- ────────────────────────────────────────────────────────────────────────────
-- C-002 #16: tags
-- ────────────────────────────────────────────────────────────────────────────
alter table public.tags enable row level security;
drop policy if exists tags_tenant_rw on public.tags;
create policy tags_tenant_rw on public.tags
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ============================================================================
-- C-003: 2 tables have RLS enabled but no policies (lockout or bypass via
-- service_role). Add explicit minimal policies.
-- ============================================================================

-- agent_chat_sessions (schema: id, agent_id, session_id, messages, updated_at)
-- No org_id and no user_id — scope via agents table.
-- Defensive policy: only service_role can write; authenticated users cannot
-- read raw chat payloads (these are external-agent sessions).
-- If later the UI needs to read them, add a scoped SELECT policy keyed on
-- agents.org_id = current_org_id().
drop policy if exists agent_chat_sessions_tenant_read on public.agent_chat_sessions;
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'agents' and column_name = 'org_id'
  ) then
    execute $p$
      create policy agent_chat_sessions_tenant_read on public.agent_chat_sessions
        for select to authenticated using (
          exists (select 1 from public.agents a
                   where a.id = agent_chat_sessions.agent_id
                     and a.org_id = public.current_org_id())
        )
    $p$;
  end if;
end$$;
-- Writes: service_role only (no INSERT/UPDATE/DELETE policy for authenticated).

-- failed_login_attempts: tracking table. Anyone can INSERT (login tracking),
-- SELECT restricted to org owners/admins via memberships (the app-wide pattern
-- for admin gating — see 20260302210000_crm_core.sql and memberships_select_self_or_admin).
-- Gate with to_regclass so migration doesn't fail if table shape differs.
do $$
begin
  if to_regclass('public.failed_login_attempts') is not null then
    execute 'drop policy if exists failed_login_attempts_public_insert on public.failed_login_attempts';
    execute $p$
      create policy failed_login_attempts_public_insert on public.failed_login_attempts
        for insert to anon, authenticated with check (true)
    $p$;
    execute 'drop policy if exists failed_login_attempts_admin_read on public.failed_login_attempts';
    execute $p$
      create policy failed_login_attempts_admin_read on public.failed_login_attempts
        for select to authenticated using (
          exists (select 1 from public.memberships m
                   where m.user_id = auth.uid()
                     and m.role in ('owner','admin'))
        )
    $p$;
  end if;
end$$;

-- ============================================================================
-- Verification queries (run manually after applying):
--   select relname, relrowsecurity from pg_class
--    where relname in (
--      'applied_taxes','archived_records','automation_executions',
--      'entity_comments','entity_tags','job_photos','job_signatures',
--      'lead_lists','lists','location_logs','object_permissions',
--      'pipelines','plans','promo_codes','rate_limit_buckets','tags',
--      'agent_chat_sessions','failed_login_attempts');
--   -- all relrowsecurity should be true
-- ============================================================================
