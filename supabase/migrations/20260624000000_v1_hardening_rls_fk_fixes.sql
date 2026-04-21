-- ============================================================================
-- V1 Hardening — RLS dead-code cleanup, FK fix, permissive policy scoping
-- Idempotent: safe to run multiple times
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix FK: company_operating_profile.org_id must reference orgs(id), not auth.users(id)
-- ---------------------------------------------------------------------------
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.company_operating_profile'::regclass
    and contype  = 'f'
    and conkey   = (
      select array_agg(attnum)
      from pg_attribute
      where attrelid = 'public.company_operating_profile'::regclass
        and attname  = 'org_id'
    );

  if v_conname is not null then
    execute format('alter table public.company_operating_profile drop constraint %I', v_conname);
  end if;

  alter table public.company_operating_profile
    add constraint company_operating_profile_org_id_fkey
    foreign key (org_id) references public.orgs(id) on delete cascade;
exception
  when undefined_table then
    null; -- table does not exist in this environment, skip
end $$;

-- ---------------------------------------------------------------------------
-- 2. Remove dead-code "org_id = auth.uid()" disjuncts in RLS policies.
--    The comparison is a type-valid but semantically-wrong check (org_id is
--    the organization's uuid, not a user uuid). Keeping it is confusing and
--    risks accidental coincidence. We replace the policies with the
--    membership-only version.
-- ---------------------------------------------------------------------------

-- connected_accounts
do $$ begin
  if to_regclass('public.connected_accounts') is not null then
    drop policy if exists "connected_accounts_select_org" on public.connected_accounts;
    drop policy if exists "connected_accounts_insert_org" on public.connected_accounts;
    drop policy if exists "connected_accounts_update_org" on public.connected_accounts;

    create policy "connected_accounts_select_org" on public.connected_accounts
      for select to authenticated
      using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = connected_accounts.org_id));

    create policy "connected_accounts_insert_org" on public.connected_accounts
      for insert to authenticated
      with check (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = connected_accounts.org_id));

    create policy "connected_accounts_update_org" on public.connected_accounts
      for update to authenticated
      using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = connected_accounts.org_id));
  end if;
end $$;

-- payment_requests
do $$ begin
  if to_regclass('public.payment_requests') is not null then
    drop policy if exists "payment_requests_select_org" on public.payment_requests;
    drop policy if exists "payment_requests_insert_org" on public.payment_requests;
    drop policy if exists "payment_requests_update_org" on public.payment_requests;

    create policy "payment_requests_select_org" on public.payment_requests
      for select to authenticated
      using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = payment_requests.org_id));

    create policy "payment_requests_insert_org" on public.payment_requests
      for insert to authenticated
      with check (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = payment_requests.org_id));

    create policy "payment_requests_update_org" on public.payment_requests
      for update to authenticated
      using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = payment_requests.org_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Scope permissive "service_full_access" policies (USING true) to the
--    service_role ONLY. Previously applied to every role — authenticated
--    users with a valid JWT could in principle bypass multi-tenancy.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'decision_outcomes',
    'confidence_calibration',
    'user_agent_preferences',
    'agent_corrections',
    'few_shot_examples'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "service_full_access" on public.%I', t);
      execute format(
        'create policy "service_full_access" on public.%I for all to service_role using (true) with check (true)',
        t
      );
    end if;
  end loop;
end $$;

-- email_templates and review_requests (from pending-migration.sql)
do $$ begin
  if to_regclass('public.email_templates') is not null then
    drop policy if exists "email_templates_service" on public.email_templates;
    create policy "email_templates_service" on public.email_templates
      for all to service_role using (true) with check (true);
  end if;

  if to_regclass('public.review_requests') is not null then
    drop policy if exists "review_requests_service" on public.review_requests;
    create policy "review_requests_service" on public.review_requests
      for all to service_role using (true) with check (true);
  end if;
end $$;
