-- =====================================================================
-- Compliance Hardening — 2026-04-21
-- Bloc 1 sécurité technique : isolation multi-tenant + rétention audit
--
-- Ref: compliance_audit.md §10
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. contacts.org_id NOT NULL
--    Fix cross-tenant leak: current RLS allows "org_id IS NULL OR has_org_membership()"
-- ---------------------------------------------------------------------

-- 1.a Backfill orphan contacts (org_id null) by copying from linked lead/client if exists
do $$
declare
  v_orphans int;
begin
  update public.contacts c
     set org_id = sub.org_id
    from (
      select co.id, coalesce(
        (select l.org_id from public.leads l where l.contact_id = co.id and l.org_id is not null limit 1),
        (select cl.org_id from public.clients cl where cl.contact_id = co.id and cl.org_id is not null limit 1)
      ) as org_id
      from public.contacts co
      where co.org_id is null
    ) sub
   where c.id = sub.id and sub.org_id is not null;

  -- Delete any remaining orphans (no lead/client link, cannot attribute)
  delete from public.contacts where org_id is null;

  get diagnostics v_orphans = row_count;
  raise notice 'contacts.org_id backfill: deleted % orphan rows', v_orphans;
end $$;

-- 1.b Enforce NOT NULL
alter table public.contacts alter column org_id set not null;

-- 1.c Tighten RLS — drop the "org_id is null OR ..." clause
do $$
declare r record;
begin
  for r in (select policyname from pg_policies where schemaname='public' and tablename='contacts')
  loop
    execute format('drop policy if exists %I on public.contacts', r.policyname);
  end loop;
end $$;

create policy contacts_select_org on public.contacts
  for select using (public.has_org_membership(auth.uid(), org_id));

create policy contacts_insert_org on public.contacts
  for insert with check (public.has_org_membership(auth.uid(), org_id));

create policy contacts_update_org on public.contacts
  for update using (public.has_org_membership(auth.uid(), org_id))
             with check (public.has_org_membership(auth.uid(), org_id));

create policy contacts_delete_org on public.contacts
  for delete using (public.has_org_membership(auth.uid(), org_id));

-- ---------------------------------------------------------------------
-- 2. audit_events retention — 3 years (Loi 25 / RGPD baseline)
--    + metadata redaction helper
-- ---------------------------------------------------------------------

-- 2.a Index for efficient purge (if not already present)
create index if not exists idx_audit_events_created_at on public.audit_events(created_at);

-- 2.b Purge function — called daily by pg_cron
create or replace function public.purge_old_audit_events(p_retention_days int default 1095)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  delete from public.audit_events
   where created_at < (now() - make_interval(days => p_retention_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_old_audit_events(int) from public;
grant execute on function public.purge_old_audit_events(int) to service_role;

-- 2.c Schedule daily purge at 03:15 UTC via pg_cron (if extension available)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule any prior job with same name (idempotent)
    perform cron.unschedule(jobname)
      from cron.job where jobname = 'lume_purge_audit_events';
    perform cron.schedule(
      'lume_purge_audit_events',
      '15 3 * * *',
      $cmd$ select public.purge_old_audit_events(1095) $cmd$
    );
    raise notice 'Scheduled daily audit_events purge (3y retention)';
  else
    raise notice 'pg_cron extension not installed — purge must be run manually';
  end if;
exception
  when others then
    raise notice 'pg_cron scheduling failed (non-fatal): %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 3. Server-side org_id validation helper (RPC)
--    Used by Express routes that use service_role client to re-check
--    that the calling user actually belongs to the org_id they claim.
-- ---------------------------------------------------------------------
create or replace function public.verify_org_access(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
     where user_id = p_user_id
       and org_id  = p_org_id
  );
$$;

revoke all on function public.verify_org_access(uuid, uuid) from public;
grant execute on function public.verify_org_access(uuid, uuid) to service_role, authenticated;

comment on function public.verify_org_access(uuid, uuid) is
  'Compliance: re-validates user-org membership from server code using service_role client. See server/lib/org-access.ts.';

-- ---------------------------------------------------------------------
-- DOWN migration (manual — keep readable)
-- ---------------------------------------------------------------------
-- alter table public.contacts alter column org_id drop not null;
-- drop function if exists public.verify_org_access(uuid, uuid);
-- drop function if exists public.purge_old_audit_events(int);
-- select cron.unschedule('lume_purge_audit_events');
