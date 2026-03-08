-- Enforce server-side org scoping for leads inserts.
-- This ensures org_id is never dependent on client payload.

begin;

create schema if not exists app;

create or replace function app.current_org_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.org_id', true), '')::uuid,
    auth.uid()
  )
$$;

-- Default for safety on insert.
alter table public.leads
  alter column org_id set default app.current_org_id();

-- Trigger to force org_id from auth context.
create or replace function app.leads_force_org_id()
returns trigger
language plpgsql
as $$
begin
  new.org_id := app.current_org_id();
  if new.org_id is null then
    raise exception 'missing org_id in auth context'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_force_org_id on public.leads;
create trigger trg_leads_force_org_id
before insert on public.leads
for each row
execute function app.leads_force_org_id();

-- Keep tenant scope strict at DB policy level.
alter table public.leads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'leads'
      and policyname = 'leads_insert_org_scope'
  ) then
    create policy leads_insert_org_scope
      on public.leads
      for insert
      with check (org_id = app.current_org_id());
  end if;
end $$;

commit;
