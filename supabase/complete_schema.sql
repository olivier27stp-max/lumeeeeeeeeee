
-- ============================================================
-- MIGRATION: 20260302170000_create_jobs.sql
-- ============================================================

create extension if not exists "pgcrypto";

create sequence if not exists jobs_job_number_seq;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default auth.uid(),
  job_number text not null default lpad(nextval('jobs_job_number_seq')::text, 4, '0'),
  title text not null,
  client_id uuid,
  client_name text,
  property_address text not null,
  scheduled_at timestamptz,
  status text not null default 'Unscheduled',
  total_cents integer not null default 0,
  currency text not null default 'USD',
  job_type text,
  notes text,
  invoice_url text,
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_org_id_idx on public.jobs (org_id);
create index if not exists jobs_scheduled_at_idx on public.jobs (scheduled_at);
create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists jobs_job_number_idx on public.jobs (job_number);

create or replace function public.set_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
before update on public.jobs
for each row execute function public.set_jobs_updated_at();

alter table public.jobs enable row level security;

drop policy if exists "jobs_select" on public.jobs;
create policy "jobs_select" on public.jobs
for select using (auth.uid() = org_id);

drop policy if exists "jobs_insert" on public.jobs;
create policy "jobs_insert" on public.jobs
for insert with check (auth.uid() = org_id);

drop policy if exists "jobs_update" on public.jobs;
create policy "jobs_update" on public.jobs
for update using (auth.uid() = org_id);

drop policy if exists "jobs_delete" on public.jobs;
create policy "jobs_delete" on public.jobs
for delete using (auth.uid() = org_id);

create or replace function public.get_job_kpis(
  p_org_id uuid,
  p_status text default null,
  p_job_type text default null,
  p_q text default null
)
returns table (
  ending_within_30 integer,
  late integer,
  requires_invoicing integer,
  action_required integer,
  unscheduled integer,
  recent_visits integer,
  recent_visits_prev integer,
  visits_scheduled integer,
  visits_scheduled_prev integer
)
language plpgsql
as $$
begin
  return query
  with base as (
    select *
    from public.jobs
    where org_id = p_org_id
      and (p_status is null or status = p_status)
      and (p_job_type is null or job_type = p_job_type)
      and (
        p_q is null
        or job_number ilike '%' || p_q || '%'
        or title ilike '%' || p_q || '%'
        or property_address ilike '%' || p_q || '%'
        or coalesce(client_name, '') ilike '%' || p_q || '%'
      )
  )
  select
    count(*) filter (where scheduled_at is not null and scheduled_at >= now() and scheduled_at < now() + interval '30 days') as ending_within_30,
    count(*) filter (where status = 'Late') as late,
    count(*) filter (where status = 'Requires Invoicing') as requires_invoicing,
    count(*) filter (where status = 'Action Required') as action_required,
    count(*) filter (where status = 'Unscheduled' or scheduled_at is null) as unscheduled,
    count(*) filter (where scheduled_at >= now() - interval '30 days' and scheduled_at < now()) as recent_visits,
    count(*) filter (where scheduled_at >= now() - interval '60 days' and scheduled_at < now() - interval '30 days') as recent_visits_prev,
    count(*) filter (where scheduled_at >= now() and scheduled_at < now() + interval '30 days') as visits_scheduled,
    count(*) filter (where scheduled_at >= now() + interval '30 days' and scheduled_at < now() + interval '60 days') as visits_scheduled_prev
  from base;
end;
$$;


-- ============================================================
-- MIGRATION: 20260302190000_leads_org_scope_server_enforced.sql
-- ============================================================

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


-- ============================================================
-- MIGRATION: 20260302210000_crm_core.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.memberships (
  user_id uuid not null,
  org_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index if not exists idx_memberships_org_id on public.memberships (org_id);
create index if not exists idx_memberships_user_id on public.memberships (user_id);

create or replace function public.has_org_membership(p_user uuid, p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exists boolean := false;
begin
  if p_user is null or p_org is null then
    return false;
  end if;

  -- Single-tenant fallback: one user owns one org with same UUID.
  if p_user = p_org then
    return true;
  end if;

  if to_regclass('public.memberships') is not null then
    execute $q$
      select exists(
        select 1 from public.memberships m
        where m.user_id = $1 and m.org_id = $2
      )
    $q$ into v_exists using p_user, p_org;
    if v_exists then
      return true;
    end if;
  end if;

  if to_regclass('public.org_members') is not null then
    execute $q$
      select exists(
        select 1 from public.org_members m
        where m.user_id = $1 and m.org_id = $2
      )
    $q$ into v_exists using p_user, p_org;
    return v_exists;
  end if;

  return false;
end;
$$;

create or replace function public.current_org_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_claim_org text;
  v_org uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    return null;
  end if;

  v_claim_org := nullif(current_setting('request.jwt.claim.org_id', true), '');
  if v_claim_org is not null then
    begin
      v_org := v_claim_org::uuid;
      if public.has_org_membership(v_user, v_org) then
        return v_org;
      end if;
    exception when others then
      null;
    end;
  end if;

  if to_regclass('public.memberships') is not null then
    select m.org_id
      into v_org
      from public.memberships m
     where m.user_id = v_user
     order by m.created_at asc, m.org_id asc
     limit 1;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  if to_regclass('public.org_members') is not null then
    select m.org_id
      into v_org
      from public.org_members m
     where m.user_id = v_user
     order by m.org_id asc
     limit 1;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  return v_user;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.crm_enforce_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_org uuid;
begin
  v_user := auth.uid();

  -- SQL editor/service role path: require explicit values.
  if v_user is null then
    if new.org_id is null then
      raise exception 'org_id is required when no auth context' using errcode = '23502';
    end if;
    if to_jsonb(new) ? 'created_by' and new.created_by is null then
      raise exception 'created_by is required when no auth context' using errcode = '23502';
    end if;
    return new;
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'unable to resolve org_id for authenticated user' using errcode = '42501';
  end if;

  new.org_id := v_org;
  if to_jsonb(new) ? 'created_by' then
    new.created_by := v_user;
  end if;
  return new;
end;
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  created_by uuid not null default auth.uid(),
  first_name text not null,
  last_name text not null,
  company text null,
  email text null,
  phone text null,
  address text null,
  status text not null default 'active',
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  created_by uuid not null default auth.uid(),
  first_name text not null,
  last_name text not null,
  company text null,
  title text null,
  email text null,
  phone text null,
  source text null,
  status text not null default 'new',
  assigned_to uuid null,
  notes text null,
  value numeric(12,2) not null default 0,
  tags text[] not null default '{}',
  schedule jsonb null,
  assigned_team text null,
  line_items jsonb not null default '[]'::jsonb,
  description text null,
  converted_to_client_id uuid null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  created_by uuid not null default auth.uid(),
  client_id uuid null references public.clients(id) on delete set null,
  title text not null,
  description text null,
  status text not null default 'scheduled',
  scheduled_at timestamptz null,
  total_amount numeric(12,2) not null default 0,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  created_by uuid not null default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  assigned_user uuid null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, position)
);

create table if not exists public.pipeline_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  created_by uuid not null default auth.uid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  value numeric(12,2) not null default 0,
  probability integer not null default 10,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure extra columns exist on pre-existing tables
alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists created_by uuid;
alter table public.leads add column if not exists title text;
alter table public.leads add column if not exists company text;
alter table public.leads add column if not exists source text;
alter table public.leads add column if not exists assigned_to uuid;
alter table public.leads add column if not exists value numeric(12,2);
alter table public.leads add column if not exists tags text[];
alter table public.leads add column if not exists schedule jsonb;
alter table public.leads add column if not exists assigned_team text;
alter table public.leads add column if not exists line_items jsonb;
alter table public.leads add column if not exists description text;
alter table public.leads add column if not exists converted_to_client_id uuid;
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists created_by uuid;
alter table public.jobs add column if not exists description text;
alter table public.jobs add column if not exists total_amount numeric(12,2);
alter table public.jobs add column if not exists deleted_at timestamptz;
alter table public.jobs add column if not exists created_by uuid;
alter table public.schedule_events add column if not exists deleted_at timestamptz;
alter table public.schedule_events add column if not exists created_by uuid;
alter table public.pipeline_deals add column if not exists deleted_at timestamptz;
alter table public.pipeline_deals add column if not exists created_by uuid;

alter table public.clients alter column org_id set default public.current_org_id();
alter table public.clients alter column created_by set default auth.uid();
alter table public.leads alter column org_id set default public.current_org_id();
alter table public.leads alter column created_by set default auth.uid();
alter table public.leads alter column value set default 0;
alter table public.leads alter column tags set default '{}';
alter table public.leads alter column line_items set default '[]'::jsonb;
alter table public.jobs alter column org_id set default public.current_org_id();
alter table public.jobs alter column created_by set default auth.uid();
alter table public.schedule_events alter column org_id set default public.current_org_id();
alter table public.schedule_events alter column created_by set default auth.uid();
alter table public.pipeline_stages alter column org_id set default public.current_org_id();
alter table public.pipeline_deals alter column org_id set default public.current_org_id();
alter table public.pipeline_deals alter column created_by set default auth.uid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_status_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients add constraint clients_status_check
      check (status in ('active', 'lead', 'inactive'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_status_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads add constraint leads_status_check
      check (status in ('new', 'contacted', 'qualified', 'won', 'lost'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_status_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs add constraint jobs_status_check
      check (status in ('unscheduled', 'scheduled', 'in_progress', 'completed', 'late', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_events_time_check'
      and conrelid = 'public.schedule_events'::regclass
  ) then
    alter table public.schedule_events add constraint schedule_events_time_check
      check (end_time > start_time);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'pipeline_deals_probability_check'
      and conrelid = 'public.pipeline_deals'::regclass
  ) then
    alter table public.pipeline_deals add constraint pipeline_deals_probability_check
      check (probability >= 0 and probability <= 100);
  end if;
end
$$;

create unique index if not exists uq_clients_org_email
  on public.clients (org_id, lower(email))
  where email is not null and deleted_at is null;

create unique index if not exists uq_leads_org_email
  on public.leads (org_id, lower(email))
  where email is not null and deleted_at is null;

create index if not exists idx_clients_org_created_at on public.clients (org_id, created_at desc);
create index if not exists idx_clients_org_status on public.clients (org_id, status);
create index if not exists idx_clients_org_deleted_at on public.clients (org_id, deleted_at);

create index if not exists idx_leads_org_created_at on public.leads (org_id, created_at desc);
create index if not exists idx_leads_org_status on public.leads (org_id, status);
create index if not exists idx_leads_org_source on public.leads (org_id, source);
create index if not exists idx_leads_org_assigned_to on public.leads (org_id, assigned_to);
create index if not exists idx_leads_org_deleted_at on public.leads (org_id, deleted_at);

create index if not exists idx_jobs_org_scheduled_at on public.jobs (org_id, scheduled_at);
create index if not exists idx_jobs_org_status on public.jobs (org_id, status);
create index if not exists idx_jobs_org_client_id on public.jobs (org_id, client_id);
create index if not exists idx_jobs_org_deleted_at on public.jobs (org_id, deleted_at);

create index if not exists idx_schedule_events_org_start on public.schedule_events (org_id, start_time);
create index if not exists idx_schedule_events_org_assigned on public.schedule_events (org_id, assigned_user);
create index if not exists idx_schedule_events_org_deleted_at on public.schedule_events (org_id, deleted_at);

create index if not exists idx_pipeline_stages_org_position on public.pipeline_stages (org_id, position);
create index if not exists idx_pipeline_deals_org_stage on public.pipeline_deals (org_id, stage_id);
create index if not exists idx_pipeline_deals_org_lead on public.pipeline_deals (org_id, lead_id);
create index if not exists idx_pipeline_deals_org_deleted_at on public.pipeline_deals (org_id, deleted_at);

create index if not exists idx_leads_search_trgm on public.leads
using gin (
  (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(phone, '')
    )
  ) gin_trgm_ops
);

drop trigger if exists trg_clients_set_updated_at on public.clients;
create trigger trg_clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_set_updated_at on public.leads;
create trigger trg_leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists trg_jobs_set_updated_at on public.jobs;
create trigger trg_jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedule_events_set_updated_at on public.schedule_events;
create trigger trg_schedule_events_set_updated_at
before update on public.schedule_events
for each row execute function public.set_updated_at();

drop trigger if exists trg_pipeline_stages_set_updated_at on public.pipeline_stages;
create trigger trg_pipeline_stages_set_updated_at
before update on public.pipeline_stages
for each row execute function public.set_updated_at();

drop trigger if exists trg_pipeline_deals_set_updated_at on public.pipeline_deals;
create trigger trg_pipeline_deals_set_updated_at
before update on public.pipeline_deals
for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_enforce_scope on public.clients;
create trigger trg_clients_enforce_scope
before insert on public.clients
for each row execute function public.crm_enforce_scope();

drop trigger if exists trg_leads_enforce_scope on public.leads;
create trigger trg_leads_enforce_scope
before insert on public.leads
for each row execute function public.crm_enforce_scope();

drop trigger if exists trg_jobs_enforce_scope on public.jobs;
create trigger trg_jobs_enforce_scope
before insert on public.jobs
for each row execute function public.crm_enforce_scope();

drop trigger if exists trg_schedule_events_enforce_scope on public.schedule_events;
create trigger trg_schedule_events_enforce_scope
before insert on public.schedule_events
for each row execute function public.crm_enforce_scope();

drop trigger if exists trg_pipeline_deals_enforce_scope on public.pipeline_deals;
create trigger trg_pipeline_deals_enforce_scope
before insert on public.pipeline_deals
for each row execute function public.crm_enforce_scope();

alter table public.clients enable row level security;
alter table public.leads enable row level security;
alter table public.jobs enable row level security;
alter table public.schedule_events enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_deals enable row level security;

drop policy if exists clients_select_org on public.clients;
drop policy if exists clients_insert_org on public.clients;
drop policy if exists clients_update_org on public.clients;
drop policy if exists clients_delete_org on public.clients;

create policy clients_select_org on public.clients
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy clients_insert_org on public.clients
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy clients_update_org on public.clients
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy clients_delete_org on public.clients
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists leads_select_org on public.leads;
drop policy if exists leads_insert_org on public.leads;
drop policy if exists leads_update_org on public.leads;
drop policy if exists leads_delete_org on public.leads;

create policy leads_select_org on public.leads
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy leads_insert_org on public.leads
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy leads_update_org on public.leads
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy leads_delete_org on public.leads
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists jobs_select_org on public.jobs;
drop policy if exists jobs_insert_org on public.jobs;
drop policy if exists jobs_update_org on public.jobs;
drop policy if exists jobs_delete_org on public.jobs;

create policy jobs_select_org on public.jobs
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy jobs_insert_org on public.jobs
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy jobs_update_org on public.jobs
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy jobs_delete_org on public.jobs
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists schedule_events_select_org on public.schedule_events;
drop policy if exists schedule_events_insert_org on public.schedule_events;
drop policy if exists schedule_events_update_org on public.schedule_events;
drop policy if exists schedule_events_delete_org on public.schedule_events;

create policy schedule_events_select_org on public.schedule_events
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy schedule_events_insert_org on public.schedule_events
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy schedule_events_update_org on public.schedule_events
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy schedule_events_delete_org on public.schedule_events
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists pipeline_stages_select_org on public.pipeline_stages;
drop policy if exists pipeline_stages_insert_org on public.pipeline_stages;
drop policy if exists pipeline_stages_update_org on public.pipeline_stages;
drop policy if exists pipeline_stages_delete_org on public.pipeline_stages;

create policy pipeline_stages_select_org on public.pipeline_stages
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy pipeline_stages_insert_org on public.pipeline_stages
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id));

create policy pipeline_stages_update_org on public.pipeline_stages
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy pipeline_stages_delete_org on public.pipeline_stages
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists pipeline_deals_select_org on public.pipeline_deals;
drop policy if exists pipeline_deals_insert_org on public.pipeline_deals;
drop policy if exists pipeline_deals_update_org on public.pipeline_deals;
drop policy if exists pipeline_deals_delete_org on public.pipeline_deals;

create policy pipeline_deals_select_org on public.pipeline_deals
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy pipeline_deals_insert_org on public.pipeline_deals
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy pipeline_deals_update_org on public.pipeline_deals
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy pipeline_deals_delete_org on public.pipeline_deals
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

-- Drop legacy policies and columns not in schema
DROP POLICY IF EXISTS "Own data only" ON public.pipeline_stages;
ALTER TABLE public.pipeline_stages DROP COLUMN IF EXISTS pipeline_id;
ALTER TABLE public.pipeline_stages DROP COLUMN IF EXISTS sort_order;
ALTER TABLE public.pipeline_stages DROP COLUMN IF EXISTS user_id;

-- Seed default stages for existing org memberships.
insert into public.pipeline_stages (org_id, name, position)
select distinct m.org_id, s.name, s.position
from public.memberships m
cross join (
  values
    ('Lead', 1),
    ('Qualified', 2),
    ('Proposal', 3),
    ('Negotiation', 4),
    ('Closed', 5)
) as s(name, position)
where not exists (
  select 1 from public.pipeline_stages ps
  where ps.org_id = m.org_id and ps.position = s.position
);

create or replace view public.leads_active as
select *
from public.leads
where deleted_at is null;

create or replace view public.clients_active as
select *
from public.clients
where deleted_at is null;

create or replace view public.jobs_active as
select *
from public.jobs
where deleted_at is null;

commit;


-- ============================================================
-- MIGRATION: 20260303002000_jobs_modal_fields.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

alter table public.jobs add column if not exists job_number text;
alter table public.jobs add column if not exists end_at timestamptz;
alter table public.jobs add column if not exists salesperson_id uuid;
alter table public.jobs add column if not exists requires_invoicing boolean not null default false;
alter table public.jobs add column if not exists billing_split boolean not null default false;
alter table public.jobs add column if not exists currency text not null default 'CAD';
alter table public.jobs add column if not exists total_cents integer not null default 0;
alter table public.jobs add column if not exists job_type text;

create table if not exists public.job_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  qty numeric(10,2) not null default 1,
  unit_price_cents integer not null default 0,
  total_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_line_items add column if not exists created_by uuid not null default auth.uid();

create index if not exists idx_jobs_org_created_at on public.jobs (org_id, created_at desc);
create index if not exists idx_jobs_org_scheduled_at on public.jobs (org_id, scheduled_at);
create index if not exists idx_jobs_org_status on public.jobs (org_id, status);
create index if not exists idx_jobs_org_client_id on public.jobs (org_id, client_id);
create index if not exists idx_job_line_items_org_job on public.job_line_items (org_id, job_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_line_items_qty_positive'
      and conrelid = 'public.job_line_items'::regclass
  ) then
    alter table public.job_line_items
      add constraint job_line_items_qty_positive check (qty > 0);
  end if;
end $$;

drop trigger if exists trg_job_line_items_set_updated_at on public.job_line_items;
create trigger trg_job_line_items_set_updated_at
before update on public.job_line_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_job_line_items_enforce_scope on public.job_line_items;
create trigger trg_job_line_items_enforce_scope
before insert on public.job_line_items
for each row execute function public.crm_enforce_scope();

alter table public.job_line_items enable row level security;

drop policy if exists job_line_items_select_org on public.job_line_items;
drop policy if exists job_line_items_insert_org on public.job_line_items;
drop policy if exists job_line_items_update_org on public.job_line_items;
drop policy if exists job_line_items_delete_org on public.job_line_items;

create policy job_line_items_select_org on public.job_line_items
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy job_line_items_insert_org on public.job_line_items
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy job_line_items_update_org on public.job_line_items
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy job_line_items_delete_org on public.job_line_items
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

commit;


-- ============================================================
-- MIGRATION: 20260303103000_fix_leads_trigger_client_id_error.sql
-- ============================================================

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

create or replace function app.leads_force_org_id()
returns trigger
language plpgsql
as $$
begin
  -- Do not read NEW.client_id here: leads does not have that column.
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

commit;


-- ============================================================
-- MIGRATION: 20260303112000_schedule_events_notes_status.sql
-- ============================================================

begin;

alter table public.schedule_events
  add column if not exists status text null,
  add column if not exists notes text null;

create index if not exists idx_schedule_events_org_status
  on public.schedule_events (org_id, status);

commit;


-- ============================================================
-- MIGRATION: 20260303130000_allow_duplicate_emails_leads_clients.sql
-- ============================================================

begin;

-- Allow duplicate emails for leads and clients inside the same org.
-- Drop known unique indexes/constraints created across previous migrations.

drop index if exists public.uq_leads_org_email;
drop index if exists public.uq_leads_org_email_notnull;
drop index if exists public.uq_clients_org_email;
drop index if exists public.uq_clients_org_email_notnull;

alter table public.leads drop constraint if exists uq_leads_org_email;
alter table public.leads drop constraint if exists uq_leads_org_email_notnull;
alter table public.clients drop constraint if exists uq_clients_org_email;
alter table public.clients drop constraint if exists uq_clients_org_email_notnull;

commit;


-- ============================================================
-- MIGRATION: 20260303143000_pipeline_perfect_deal_job_rpc.sql
-- ============================================================

begin;

-- 1) Ensure pipeline_deals has required columns
alter table public.pipeline_deals
  add column if not exists job_id uuid,
  add column if not exists stage text,
  add column if not exists title text,
  add column if not exists notes text,
  add column if not exists value numeric not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- 2) Backfill stage/title
update public.pipeline_deals pd
set stage = case
  when lower(coalesce(ps.name, '')) like '%qualif%' then 'Qualified'
  when lower(coalesce(ps.name, '')) like '%contact%' then 'Contact'
  when lower(coalesce(ps.name, '')) like '%quote%' then 'Quote Sent'
  when lower(coalesce(ps.name, '')) like '%clos%' then 'Closed'
  when lower(coalesce(ps.name, '')) like '%lost%' then 'Lost'
  else 'Qualified'
end
from public.pipeline_stages ps
where pd.stage is null
  and pd.stage_id is not null
  and ps.id = pd.stage_id;

update public.pipeline_deals
set stage = 'Qualified'
where stage is null;

update public.pipeline_deals pd
set title = coalesce(j.title, concat('Deal ', left(pd.id::text, 8)))
from public.jobs j
where pd.title is null
  and pd.job_id is not null
  and j.id = pd.job_id;

update public.pipeline_deals
set title = concat('Deal ', left(id::text, 8))
where title is null;

-- 3) Backfill job_id if missing (creates job rows)
do $$
declare
  r record;
  v_client_id uuid;
  v_job_id uuid;
begin
  for r in
    select pd.id, pd.lead_id, pd.org_id, pd.created_by, pd.title
    from public.pipeline_deals pd
    where pd.job_id is null
  loop
    select l.converted_to_client_id
      into v_client_id
      from public.leads l
     where l.id = r.lead_id;

    if v_client_id is null then
      insert into public.clients (
        org_id, created_by, first_name, last_name, email, phone, status
      )
      select
        l.org_id,
        coalesce(l.created_by, auth.uid()),
        coalesce(l.first_name, 'Unknown'),
        coalesce(l.last_name, 'Lead'),
        l.email,
        l.phone,
        'active'
      from public.leads l
      where l.id = r.lead_id
      returning id into v_client_id;
    end if;

    insert into public.jobs (
      org_id,
      created_by,
      client_id,
      title,
      property_address,
      status,
      total_cents,
      currency
    )
    values (
      coalesce(r.org_id, public.current_org_id()),
      coalesce(r.created_by, auth.uid()),
      v_client_id,
      coalesce(r.title, 'New Deal Job'),
      '-',
      'new',
      0,
      'CAD'
    )
    returning id into v_job_id;

    update public.pipeline_deals
       set job_id = v_job_id
     where id = r.id;
  end loop;
end $$;

-- 4) Constraints
alter table public.pipeline_deals
  alter column job_id set not null,
  alter column stage set not null,
  alter column title set not null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost'));

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_key;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_key unique (job_id);

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;

-- 5) Indexes
create index if not exists idx_pipeline_deals_stage on public.pipeline_deals(stage);
create index if not exists idx_pipeline_deals_lead_id on public.pipeline_deals(lead_id);
create index if not exists idx_pipeline_deals_job_id on public.pipeline_deals(job_id);
create index if not exists idx_pipeline_deals_created_at on public.pipeline_deals(created_at desc);
create index if not exists idx_schedule_events_job_id on public.schedule_events(job_id);

-- 6) RPC atomic create deal + job
create or replace function public.create_deal_with_job(
  p_lead_id uuid,
  p_title text,
  p_value numeric,
  p_stage text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
  v_stage text;
begin
  select *
    into v_lead
    from public.leads
   where id = p_lead_id
   limit 1;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  v_stage := case
    when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage
    else 'Qualified'
  end;

  v_client_id := v_lead.converted_to_client_id;
  if v_client_id is null then
    insert into public.clients (
      org_id, created_by, first_name, last_name, email, phone, status
    )
    values (
      coalesce(v_lead.org_id, public.current_org_id()),
      coalesce(v_lead.created_by, auth.uid()),
      coalesce(v_lead.first_name, 'Unknown'),
      coalesce(v_lead.last_name, 'Lead'),
      v_lead.email,
      v_lead.phone,
      'active'
    )
    returning id into v_client_id;
  end if;

  insert into public.jobs (
    org_id,
    created_by,
    client_id,
    title,
    property_address,
    status,
    total_cents,
    currency
  )
  values (
    coalesce(v_lead.org_id, public.current_org_id()),
    coalesce(v_lead.created_by, auth.uid()),
    v_client_id,
    coalesce(nullif(trim(p_title), ''), 'New Deal Job'),
    '-',
    'new',
    0,
    'CAD'
  )
  returning id into v_job_id;

  insert into public.pipeline_deals (
    org_id,
    created_by,
    lead_id,
    job_id,
    stage,
    value,
    title,
    notes
  )
  values (
    coalesce(v_lead.org_id, public.current_org_id()),
    coalesce(v_lead.created_by, auth.uid()),
    v_lead.id,
    v_job_id,
    v_stage,
    coalesce(p_value, 0),
    coalesce(nullif(trim(p_title), ''), 'New Deal'),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return v_deal_id;
end;
$$;

revoke all on function public.create_deal_with_job(uuid, text, numeric, text, text) from public;
grant execute on function public.create_deal_with_job(uuid, text, numeric, text, text) to authenticated, service_role;

-- 7) updated_at trigger
drop trigger if exists trg_pipeline_deals_set_updated_at on public.pipeline_deals;
create trigger trg_pipeline_deals_set_updated_at
before update on public.pipeline_deals
for each row execute function public.set_updated_at();

-- 8) RLS + minimal authenticated policies (org scoped)
alter table public.jobs enable row level security;
alter table public.leads enable row level security;
alter table public.pipeline_deals enable row level security;
alter table public.schedule_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_select_org') then
    create policy jobs_select_org on public.jobs for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_insert_org') then
    create policy jobs_insert_org on public.jobs for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_update_org') then
    create policy jobs_update_org on public.jobs for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_select_org') then
    create policy leads_select_org on public.leads for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_insert_org') then
    create policy leads_insert_org on public.leads for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_update_org') then
    create policy leads_update_org on public.leads for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pipeline_deals' and policyname='pipeline_deals_select_org') then
    create policy pipeline_deals_select_org on public.pipeline_deals for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pipeline_deals' and policyname='pipeline_deals_insert_org') then
    create policy pipeline_deals_insert_org on public.pipeline_deals for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pipeline_deals' and policyname='pipeline_deals_update_org') then
    create policy pipeline_deals_update_org on public.pipeline_deals for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_select_org') then
    create policy schedule_events_select_org on public.schedule_events for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_insert_org') then
    create policy schedule_events_insert_org on public.schedule_events for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_update_org') then
    create policy schedule_events_update_org on public.schedule_events for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;
end $$;

commit;


-- ============================================================
-- MIGRATION: 20260303170000_contacts_atomic_pipeline.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- Contacts as source-of-truth.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid null,
  full_name text null,
  email text null,
  phone text null,
  address_line1 text null,
  address_line2 text null,
  city text null,
  province text null,
  postal_code text null,
  country text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contacts_org_id on public.contacts(org_id);
create index if not exists idx_contacts_org_email on public.contacts(org_id, lower(email));
create index if not exists idx_contacts_org_phone on public.contacts(org_id, phone);

alter table public.leads add column if not exists contact_id uuid;
alter table public.clients add column if not exists contact_id uuid;
alter table public.jobs add column if not exists client_id uuid;
alter table public.pipeline_deals add column if not exists client_id uuid;
alter table public.pipeline_deals add column if not exists job_id uuid;
alter table public.pipeline_deals add column if not exists stage text;
alter table public.pipeline_deals add column if not exists title text;
alter table public.pipeline_deals add column if not exists notes text;
alter table public.pipeline_deals add column if not exists value numeric not null default 0;
alter table public.pipeline_deals add column if not exists created_at timestamptz not null default now();
alter table public.pipeline_deals add column if not exists updated_at timestamptz not null default now();

update public.pipeline_deals
set stage = coalesce(stage, 'Qualified'),
    title = coalesce(title, concat('Deal ', left(id::text, 8)));

-- Backfill lead/client contact_id safely.
do $do$
declare
  r record;
  v_contact_id uuid;
begin
  for r in
    select id, org_id, first_name, last_name, email, phone
    from public.leads
    where contact_id is null
  loop
    insert into public.contacts (org_id, full_name, email, phone)
    values (
      r.org_id,
      nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
      nullif(trim(r.email), ''),
      nullif(trim(r.phone), '')
    )
    returning id into v_contact_id;

    update public.leads set contact_id = v_contact_id where id = r.id;
  end loop;

  for r in
    select id, org_id, first_name, last_name, email, phone
    from public.clients
    where contact_id is null
  loop
    insert into public.contacts (org_id, full_name, email, phone)
    values (
      r.org_id,
      nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
      nullif(trim(r.email), ''),
      nullif(trim(r.phone), '')
    )
    returning id into v_contact_id;

    update public.clients set contact_id = v_contact_id where id = r.id;
  end loop;
end;
$do$;

alter table public.leads drop constraint if exists leads_contact_id_fkey;
alter table public.leads
  add constraint leads_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete set null;

alter table public.clients drop constraint if exists clients_contact_id_fkey;
alter table public.clients
  add constraint clients_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete set null;

alter table public.jobs drop constraint if exists jobs_client_id_fkey;
alter table public.jobs
  add constraint jobs_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_lead_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete cascade;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_client_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;

-- Allow client-origin deals.
alter table public.pipeline_deals alter column lead_id drop not null;

-- Helper to create minimal client row safely across schema drift.
create or replace function public.create_minimal_client_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_contact_id uuid,
  p_full_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''), 'Client');
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sql text;
  v_client_id uuid;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='org_id') then
    cols := cols || 'org_id';
    vals := vals || quote_literal(p_org_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='created_by') then
    cols := cols || 'created_by';
    vals := vals || quote_literal(p_created_by::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='first_name') then
    cols := cols || 'first_name';
    vals := vals || quote_literal(v_first_name);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='last_name') then
    cols := cols || 'last_name';
    vals := vals || quote_literal(v_last_name);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='email') then
    cols := cols || 'email';
    vals := vals || quote_literal(nullif(trim(p_email), ''));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='phone') then
    cols := cols || 'phone';
    vals := vals || quote_literal(nullif(trim(p_phone), ''));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='status') then
    cols := cols || 'status';
    vals := vals || quote_literal('active');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='contact_id') then
    cols := cols || 'contact_id';
    vals := vals || quote_literal(p_contact_id::text) || '::uuid';
  end if;

  sql := format(
    'insert into public.clients (%s) values (%s) returning id',
    array_to_string(cols, ','),
    array_to_string(vals, ',')
  );
  execute sql into v_client_id;
  return v_client_id;
end;
$fn$;

-- Helper to create minimal job row safely across schema drift.
create or replace function public.create_minimal_job_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_client_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sql text;
  v_job_id uuid;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='org_id') then
    cols := cols || 'org_id';
    vals := vals || quote_literal(p_org_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='created_by') then
    cols := cols || 'created_by';
    vals := vals || quote_literal(p_created_by::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='client_id') then
    cols := cols || 'client_id';
    vals := vals || quote_literal(p_client_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='title') then
    cols := cols || 'title';
    vals := vals || quote_literal(coalesce(nullif(trim(p_title), ''), 'New Deal Job'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='property_address') then
    cols := cols || 'property_address';
    vals := vals || quote_literal('-');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='status') then
    cols := cols || 'status';
    vals := vals || quote_literal('scheduled');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='total_cents') then
    cols := cols || 'total_cents';
    vals := vals || '0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='total_amount') then
    cols := cols || 'total_amount';
    vals := vals || '0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='currency') then
    cols := cols || 'currency';
    vals := vals || quote_literal('CAD');
  end if;

  sql := format(
    'insert into public.jobs (%s) values (%s) returning id',
    array_to_string(cols, ','),
    array_to_string(vals, ',')
  );
  execute sql into v_job_id;
  return v_job_id;
end;
$fn$;

-- Backfill missing job_id/client_id on existing deals.
do $do$
declare
  r record;
  v_org_id uuid;
  v_created_by uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_contact_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
begin
  for r in
    select id, org_id, created_by, lead_id, client_id, job_id, title
    from public.pipeline_deals
    where job_id is null
  loop
    v_org_id := coalesce(r.org_id, public.current_org_id());
    v_created_by := coalesce(r.created_by, auth.uid());
    v_client_id := r.client_id;

    if v_client_id is null and r.lead_id is not null then
      select l.converted_to_client_id, l.contact_id, concat_ws(' ', l.first_name, l.last_name), l.email, l.phone
      into v_client_id, v_contact_id, v_full_name, v_email, v_phone
      from public.leads l
      where l.id = r.lead_id;

      if v_client_id is null then
        v_client_id := public.create_minimal_client_for_deal(v_org_id, v_created_by, v_contact_id, v_full_name, v_email, v_phone);
        update public.leads set converted_to_client_id = v_client_id where id = r.lead_id;
      end if;

      update public.pipeline_deals set client_id = v_client_id where id = r.id;
    end if;

    if v_client_id is null then
      v_client_id := public.create_minimal_client_for_deal(v_org_id, v_created_by, null, 'Unknown Client', null, null);
      update public.pipeline_deals set client_id = v_client_id where id = r.id;
    end if;

    v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, v_client_id, coalesce(r.title, 'New Deal Job'));
    update public.pipeline_deals set job_id = v_job_id where id = r.id;
  end loop;
end;
$do$;

alter table public.pipeline_deals alter column job_id set not null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost'));

alter table public.pipeline_deals drop constraint if exists pipeline_deals_origin_check;
alter table public.pipeline_deals
  add constraint pipeline_deals_origin_check
  check ((lead_id is not null) or (client_id is not null));

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_key;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_key unique (job_id);

create index if not exists idx_pipeline_deals_stage on public.pipeline_deals(stage);
create index if not exists idx_pipeline_deals_lead_id on public.pipeline_deals(lead_id);
create index if not exists idx_pipeline_deals_client_id on public.pipeline_deals(client_id);
create index if not exists idx_pipeline_deals_job_id on public.pipeline_deals(job_id);

create index if not exists idx_leads_contact_id on public.leads(contact_id);
create index if not exists idx_clients_contact_id on public.clients(contact_id);
create index if not exists idx_jobs_client_id on public.jobs(client_id);
create index if not exists idx_schedule_events_job_id on public.schedule_events(job_id);
create unique index if not exists uq_schedule_kickoff_per_job on public.schedule_events(job_id, notes) where notes = 'Kickoff';

drop trigger if exists trg_contacts_set_updated_at on public.contacts;
create trigger trg_contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists trg_pipeline_deals_set_updated_at on public.pipeline_deals;
create trigger trg_pipeline_deals_set_updated_at
before update on public.pipeline_deals
for each row execute function public.set_updated_at();

-- RPC: create_lead_and_deal
create or replace function public.create_lead_and_deal(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_title text default null,
  p_value numeric default 0,
  p_notes text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''), 'Lead');
  v_contact_id uuid;
  v_lead_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  insert into public.contacts (org_id, full_name, email, phone)
  values (v_org_id, nullif(trim(p_full_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
  returning id into v_contact_id;

  insert into public.leads (
    org_id, created_by, first_name, last_name, email, phone, status, contact_id
  )
  values (
    v_org_id, v_created_by, v_first_name, v_last_name, nullif(trim(p_email), ''), nullif(trim(p_phone), ''), 'new', v_contact_id
  )
  returning id into v_lead_id;

  v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, null, coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'));

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, v_lead_id, null, v_job_id, 'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'lead_id', v_lead_id,
    'job_id', v_job_id
  );
end;
$fn$;

-- RPC: create_client_and_deal
create or replace function public.create_client_and_deal(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_title text default null,
  p_value numeric default 0,
  p_notes text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_contact_id uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  insert into public.contacts (org_id, full_name, email, phone)
  values (v_org_id, nullif(trim(p_full_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
  returning id into v_contact_id;

  v_client_id := public.create_minimal_client_for_deal(
    v_org_id, v_created_by, v_contact_id, p_full_name, p_email, p_phone
  );

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id, v_created_by, v_client_id, coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, null, v_client_id, v_job_id, 'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'client_id', v_client_id,
    'job_id', v_job_id
  );
end;
$fn$;

-- RPC: set_deal_stage (pipeline source-of-truth)
create or replace function public.set_deal_stage(
  p_deal_id uuid,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deal public.pipeline_deals%rowtype;
  v_stage text;
  v_client_id uuid;
  v_contact_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
begin
  v_stage := case
    when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage
    else null
  end;
  if v_stage is null then
    raise exception 'Invalid stage';
  end if;

  select * into v_deal
  from public.pipeline_deals
  where id = p_deal_id
  for update;

  if v_deal.id is null then
    raise exception 'Deal not found';
  end if;

  update public.pipeline_deals
  set stage = v_stage,
      updated_at = now()
  where id = v_deal.id;

  if v_stage = 'Closed' then
    v_client_id := v_deal.client_id;

    if v_client_id is null and v_deal.lead_id is not null then
      select l.converted_to_client_id, l.contact_id, concat_ws(' ', l.first_name, l.last_name), l.email, l.phone
      into v_client_id, v_contact_id, v_full_name, v_email, v_phone
      from public.leads l
      where l.id = v_deal.lead_id;

      if v_client_id is null then
        v_client_id := public.create_minimal_client_for_deal(v_deal.org_id, coalesce(v_deal.created_by, auth.uid()), v_contact_id, v_full_name, v_email, v_phone);
        update public.leads
        set converted_to_client_id = v_client_id
        where id = v_deal.lead_id;
      end if;

      update public.pipeline_deals
      set client_id = v_client_id,
          updated_at = now()
      where id = v_deal.id;
    end if;

    if v_client_id is not null then
      update public.jobs
      set client_id = v_client_id,
          status = 'completed',
          updated_at = now()
      where id = v_deal.job_id;
    else
      update public.jobs
      set status = 'completed',
          updated_at = now()
      where id = v_deal.job_id;
    end if;

    insert into public.schedule_events (org_id, created_by, job_id, start_time, end_time, status, notes)
    select
      v_deal.org_id,
      auth.uid(),
      v_deal.job_id,
      now() + interval '1 day',
      now() + interval '1 day 1 hour',
      'scheduled',
      'Kickoff'
    where not exists (
      select 1
      from public.schedule_events se
      where se.job_id = v_deal.job_id
        and se.notes = 'Kickoff'
        and se.start_time >= now()
    );

  elsif v_stage = 'Lost' then
    update public.jobs
    set status = 'cancelled',
        updated_at = now()
    where id = v_deal.job_id;
  end if;

  return (
    select jsonb_build_object(
      'id', pd.id,
      'lead_id', pd.lead_id,
      'client_id', pd.client_id,
      'job_id', pd.job_id,
      'stage', pd.stage,
      'title', pd.title,
      'value', pd.value,
      'notes', pd.notes
    )
    from public.pipeline_deals pd
    where pd.id = p_deal_id
  );
end;
$fn$;

-- Compatibility wrapper used by existing UI.
create or replace function public.create_deal_with_job(
  p_lead_id uuid,
  p_title text,
  p_value numeric,
  p_stage text,
  p_notes text,
  p_pipeline_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deal_id uuid;
  v_org_id uuid;
  v_created_by uuid;
  v_client_id uuid;
  v_job_id uuid;
begin
  select l.org_id, coalesce(l.created_by, auth.uid()), l.converted_to_client_id
    into v_org_id, v_created_by, v_client_id
  from public.leads l
  where l.id = p_lead_id;

  if v_org_id is null then
    raise exception 'Lead not found';
  end if;

  v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, v_client_id, coalesce(nullif(trim(p_title), ''), 'New Deal Job'));

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, p_lead_id, v_client_id, v_job_id,
    case when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage else 'Qualified' end,
    coalesce(nullif(trim(p_title), ''), 'New Deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return v_deal_id;
end;
$fn$;

drop function if exists public.create_deal_with_job(uuid, text, numeric, text, text);

revoke all on function public.create_minimal_client_for_deal(uuid, uuid, uuid, text, text, text) from public;
grant execute on function public.create_minimal_client_for_deal(uuid, uuid, uuid, text, text, text) to authenticated, service_role;
revoke all on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) from public;
grant execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) to authenticated, service_role;
revoke all on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) to authenticated, service_role;
revoke all on function public.create_client_and_deal(text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_client_and_deal(text, text, text, text, numeric, text, uuid) to authenticated, service_role;
revoke all on function public.set_deal_stage(uuid, text) from public;
grant execute on function public.set_deal_stage(uuid, text) to authenticated, service_role;
revoke all on function public.create_deal_with_job(uuid, text, numeric, text, text, uuid) from public;
grant execute on function public.create_deal_with_job(uuid, text, numeric, text, text, uuid) to authenticated, service_role;

-- RLS for contacts (org-scoped if org_id exists).
alter table public.contacts enable row level security;

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='contacts_select_org') then
    create policy contacts_select_org on public.contacts
    for select to authenticated
    using (org_id is null or public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='contacts_insert_org') then
    create policy contacts_insert_org on public.contacts
    for insert to authenticated
    with check (org_id is null or public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='contacts_update_org') then
    create policy contacts_update_org on public.contacts
    for update to authenticated
    using (org_id is null or public.has_org_membership(auth.uid(), org_id))
    with check (org_id is null or public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

create or replace view public.pipeline_deals_active as
select *
from public.pipeline_deals
where deleted_at is null;

create or replace view public.schedule_events_active as
select *
from public.schedule_events
where deleted_at is null;

commit;


-- ============================================================
-- MIGRATION: 20260303190000_lead_to_job_intents.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- Lead/job linkage + scheduling metadata.
alter table public.leads add column if not exists address text;
alter table public.jobs add column if not exists lead_id uuid;
alter table public.schedule_events add column if not exists timezone text;

update public.jobs set status = 'unscheduled' where status is null;
alter table public.jobs alter column status set default 'unscheduled';

-- Foreign keys and indexes.
alter table public.jobs drop constraint if exists jobs_lead_id_fkey;
alter table public.jobs
  add constraint jobs_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete set null;

create index if not exists idx_leads_stage_slug on public.leads ((lower(coalesce(status, ''))));
create index if not exists idx_jobs_status on public.jobs (status);
create index if not exists idx_schedule_events_start_time on public.schedule_events (start_time);
create index if not exists idx_jobs_lead_id on public.jobs (lead_id);

-- Dedup: one active job per lead.
create unique index if not exists uq_jobs_active_lead
  on public.jobs (lead_id)
  where lead_id is not null
    and deleted_at is null
    and lower(coalesce(status, 'unscheduled')) not in ('done', 'canceled', 'cancelled', 'completed');

-- Job intents emitted when deal enters trigger stage.
create table if not exists public.job_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  deal_id uuid null references public.pipeline_deals(id) on delete set null,
  triggered_stage text not null,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'canceled')),
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  consumed_at timestamptz null
);

create index if not exists idx_job_intents_org_created_at on public.job_intents(org_id, created_at desc);
create index if not exists idx_job_intents_lead_status on public.job_intents(lead_id, status);
create unique index if not exists uq_job_intents_pending_lead on public.job_intents(lead_id) where status = 'pending';

alter table public.job_intents enable row level security;

-- Scope/intents trigger.
create or replace function public.pipeline_deals_emit_job_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stage_slug text;
  v_active_job_exists boolean;
begin
  if new.lead_id is null then
    return new;
  end if;

  v_stage_slug := lower(replace(coalesce(new.stage, ''), ' ', '_'));

  -- Trigger stage = "qualified" by slug mapping.
  if v_stage_slug <> 'qualified' then
    return new;
  end if;

  -- Only on transition to qualified.
  if tg_op = 'UPDATE' then
    if lower(replace(coalesce(old.stage, ''), ' ', '_')) = 'qualified' then
      return new;
    end if;
  end if;

  select exists (
    select 1
    from public.jobs j
    where j.lead_id = new.lead_id
      and j.deleted_at is null
      and lower(coalesce(j.status, 'unscheduled')) not in ('done', 'canceled', 'cancelled', 'completed')
  ) into v_active_job_exists;

  if v_active_job_exists then
    return new;
  end if;

  insert into public.job_intents (org_id, lead_id, deal_id, triggered_stage, status, created_by)
  values (new.org_id, new.lead_id, new.id, v_stage_slug, 'pending', auth.uid())
  on conflict on constraint uq_job_intents_pending_lead
  do update set
    deal_id = excluded.deal_id,
    triggered_stage = excluded.triggered_stage,
    created_at = now(),
    created_by = excluded.created_by,
    org_id = excluded.org_id;

  return new;
end;
$fn$;

drop trigger if exists trg_pipeline_deals_emit_job_intent on public.pipeline_deals;
create trigger trg_pipeline_deals_emit_job_intent
after insert or update of stage on public.pipeline_deals
for each row execute function public.pipeline_deals_emit_job_intent();

-- Atomic flow: create job (+ optional schedule event) + consume intent.
create or replace function public.create_job_from_intent(
  p_intent_id uuid,
  p_lead_id uuid,
  p_title text,
  p_address text default null,
  p_notes text default null,
  p_estimated_minutes integer default 60,
  p_start_at timestamptz default null,
  p_timezone text default null,
  p_force_create_another boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_intent public.job_intents%rowtype;
  v_lead public.leads%rowtype;
  v_job_id uuid;
  v_event_id uuid;
  v_active_job_id uuid;
  v_minutes integer := greatest(coalesce(p_estimated_minutes, 60), 15);
  v_status text;
begin
  select * into v_intent
  from public.job_intents
  where id = p_intent_id
  for update;

  if v_intent.id is null then
    raise exception 'Job intent not found' using errcode = 'P0002';
  end if;
  if v_intent.status <> 'pending' then
    raise exception 'Job intent is not pending' using errcode = 'P0001';
  end if;
  if v_intent.lead_id <> p_lead_id then
    raise exception 'Intent/lead mismatch' using errcode = 'P0001';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  select j.id into v_active_job_id
  from public.jobs j
  where j.lead_id = p_lead_id
    and j.deleted_at is null
    and lower(coalesce(j.status, 'unscheduled')) not in ('done', 'canceled', 'cancelled', 'completed')
  limit 1;

  if v_active_job_id is not null and not coalesce(p_force_create_another, false) then
    raise exception 'Job already exists for this lead: %', v_active_job_id using errcode = '23505';
  end if;

  v_status := case when p_start_at is null then 'unscheduled' else 'scheduled' end;

  insert into public.jobs (
    org_id, created_by, lead_id, client_id, title, notes, property_address,
    status, scheduled_at, end_at, total_amount
  )
  values (
    v_intent.org_id,
    coalesce(auth.uid(), v_intent.created_by, v_lead.created_by),
    p_lead_id,
    v_lead.converted_to_client_id,
    coalesce(nullif(trim(p_title), ''), coalesce(v_lead.title, v_lead.company, 'Lead Job')),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_address), ''), nullif(trim(v_lead.address), ''), '-'),
    v_status,
    p_start_at,
    case when p_start_at is null then null else p_start_at + make_interval(mins => v_minutes) end,
    0
  )
  returning id into v_job_id;

  if p_start_at is not null then
    insert into public.schedule_events (
      org_id, created_by, job_id, start_time, end_time, status, notes, timezone
    ) values (
      v_intent.org_id,
      coalesce(auth.uid(), v_intent.created_by, v_lead.created_by),
      v_job_id,
      p_start_at,
      p_start_at + make_interval(mins => v_minutes),
      'scheduled',
      nullif(trim(p_notes), ''),
      coalesce(nullif(trim(p_timezone), ''), 'UTC')
    )
    returning id into v_event_id;
  end if;

  update public.job_intents
  set status = 'consumed',
      consumed_at = now()
  where id = v_intent.id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'schedule_event_id', v_event_id,
    'intent_status', 'consumed'
  );
end;
$fn$;

revoke all on function public.create_job_from_intent(uuid, uuid, text, text, text, integer, timestamptz, text, boolean) from public;
grant execute on function public.create_job_from_intent(uuid, uuid, text, text, text, integer, timestamptz, text, boolean) to authenticated, service_role;

-- RLS policies for job_intents.
do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_select_org') then
    create policy job_intents_select_org on public.job_intents
    for select to authenticated
    using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_insert_org') then
    create policy job_intents_insert_org on public.job_intents
    for insert to authenticated
    with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_update_org') then
    create policy job_intents_update_org on public.job_intents
    for update to authenticated
    using (public.has_org_membership(auth.uid(), org_id))
    with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_delete_org') then
    create policy job_intents_delete_org on public.job_intents
    for delete to authenticated
    using (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

-- Ensure RLS is enabled for core tables.
alter table public.jobs enable row level security;
alter table public.schedule_events enable row level security;

-- Make job_intents available on Realtime.
alter table public.job_intents replica identity full;
do $do$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_intents'
  ) then
    alter publication supabase_realtime add table public.job_intents;
  end if;
end;
$do$;

commit;


-- ============================================================
-- MIGRATION: 20260303203000_pipeline_schedule_pro.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- ------------------------------------------------------------
-- Constants
-- ------------------------------------------------------------
-- TRIGGER_JOB_STAGE = 'closed'
-- LOST_STAGE = 'lost'
-- LOST_AUTO_DELETE_DAYS = 15
-- DEFAULT_TIMEZONE = 'America/Montreal'

-- ------------------------------------------------------------
-- Schema hardening (safe alters)
-- ------------------------------------------------------------
alter table public.pipeline_deals add column if not exists lost_at timestamptz;
alter table public.pipeline_deals add column if not exists deleted_at timestamptz;

alter table public.jobs add column if not exists lead_id uuid null;
alter table public.jobs add column if not exists team_id uuid null;
alter table public.jobs add column if not exists notes text null;
alter table public.jobs add column if not exists property_address text null;

alter table public.schedule_events add column if not exists team_id uuid null;
alter table public.schedule_events add column if not exists start_at timestamptz;
alter table public.schedule_events add column if not exists end_at timestamptz;
alter table public.schedule_events add column if not exists timezone text;
alter table public.schedule_events add column if not exists deleted_at timestamptz;

update public.schedule_events
set start_at = coalesce(start_at, start_time),
    end_at = coalesce(end_at, end_time)
where start_at is null or end_at is null;

update public.schedule_events
set timezone = coalesce(nullif(timezone, ''), 'America/Montreal')
where timezone is null or timezone = '';

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  name text not null,
  color_hex text not null default '#3B82F6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists idx_teams_org_name on public.teams(org_id, name);
create index if not exists idx_teams_org_deleted_at on public.teams(org_id, deleted_at);

alter table public.jobs drop constraint if exists jobs_lead_id_fkey;
alter table public.jobs
  add constraint jobs_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete set null;

alter table public.jobs drop constraint if exists jobs_team_id_fkey;
alter table public.jobs
  add constraint jobs_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

alter table public.schedule_events drop constraint if exists schedule_events_team_id_fkey;
alter table public.schedule_events
  add constraint schedule_events_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

create index if not exists idx_jobs_org_lead_id on public.jobs(org_id, lead_id);
create index if not exists idx_jobs_org_team_id on public.jobs(org_id, team_id);
create index if not exists idx_schedule_events_org_start_at on public.schedule_events(org_id, start_at);
create index if not exists idx_schedule_events_org_team_start on public.schedule_events(org_id, team_id, start_at);
create index if not exists idx_pipeline_deals_org_lost_at on public.pipeline_deals(org_id, lost_at) where deleted_at is null;

create unique index if not exists uq_jobs_active_per_lead
  on public.jobs(org_id, lead_id)
  where lead_id is not null
    and deleted_at is null
    and lower(coalesce(status, 'unscheduled')) not in ('canceled', 'cancelled', 'completed', 'done');

-- Keep legacy columns in sync.
create or replace function public.sync_schedule_event_time_columns()
returns trigger
language plpgsql
as $fn$
begin
  if new.start_at is null and new.start_time is not null then
    new.start_at := new.start_time;
  end if;
  if new.end_at is null and new.end_time is not null then
    new.end_at := new.end_time;
  end if;

  if new.start_time is null and new.start_at is not null then
    new.start_time := new.start_at;
  end if;
  if new.end_time is null and new.end_at is not null then
    new.end_time := new.end_at;
  end if;

  if new.timezone is null or new.timezone = '' then
    new.timezone := 'America/Montreal';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_schedule_events_sync_time_columns on public.schedule_events;
create trigger trg_schedule_events_sync_time_columns
before insert or update on public.schedule_events
for each row execute function public.sync_schedule_event_time_columns();

-- ------------------------------------------------------------
-- Pipeline stage behavior (closed/lost) + creation deal-only
-- ------------------------------------------------------------
create or replace function public.set_deal_stage(
  p_deal_id uuid,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deal public.pipeline_deals%rowtype;
  v_stage text;
begin
  v_stage := case
    when lower(trim(p_stage)) = 'qualified' then 'Qualified'
    when lower(trim(p_stage)) = 'contact' then 'Contact'
    when lower(trim(p_stage)) = 'quote sent' then 'Quote Sent'
    when lower(trim(p_stage)) = 'closed' then 'Closed'
    when lower(trim(p_stage)) = 'lost' then 'Lost'
    else null
  end;

  if v_stage is null then
    raise exception 'Invalid stage';
  end if;

  select * into v_deal
  from public.pipeline_deals
  where id = p_deal_id
    and deleted_at is null
  for update;

  if v_deal.id is null then
    raise exception 'Deal not found';
  end if;

  update public.pipeline_deals
  set stage = v_stage,
      lost_at = case
        when v_stage = 'Lost' then now()
        when coalesce(v_deal.lost_at, null) is not null then null
        else lost_at
      end,
      updated_at = now()
  where id = v_deal.id;

  return (
    select jsonb_build_object(
      'id', pd.id,
      'stage', pd.stage,
      'lost_at', pd.lost_at,
      'updated_at', pd.updated_at
    )
    from public.pipeline_deals pd
    where pd.id = v_deal.id
  );
end;
$fn$;

create or replace function public.create_pipeline_deal(
  p_lead_id uuid,
  p_title text,
  p_value numeric,
  p_stage text default 'Qualified',
  p_notes text default null,
  p_pipeline_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lead public.leads%rowtype;
  v_stage text;
  v_deal_id uuid;
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id
    and deleted_at is null
  limit 1;

  if v_lead.id is null then
    raise exception 'Lead not found';
  end if;

  v_stage := case
    when lower(trim(coalesce(p_stage, ''))) = 'qualified' then 'Qualified'
    when lower(trim(coalesce(p_stage, ''))) = 'contact' then 'Contact'
    when lower(trim(coalesce(p_stage, ''))) = 'quote sent' then 'Quote Sent'
    when lower(trim(coalesce(p_stage, ''))) = 'closed' then 'Closed'
    when lower(trim(coalesce(p_stage, ''))) = 'lost' then 'Lost'
    else 'Qualified'
  end;

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, stage, value, title, notes, lost_at
  )
  values (
    coalesce(v_lead.org_id, public.current_org_id()),
    coalesce(auth.uid(), v_lead.created_by),
    v_lead.id,
    v_lead.converted_to_client_id,
    v_stage,
    coalesce(p_value, 0),
    coalesce(nullif(trim(p_title), ''), 'New deal'),
    nullif(trim(p_notes), ''),
    case when v_stage = 'Lost' then now() else null end
  )
  returning id into v_deal_id;

  return v_deal_id;
end;
$fn$;

revoke all on function public.create_pipeline_deal(uuid, text, numeric, text, text, uuid) from public;
grant execute on function public.create_pipeline_deal(uuid, text, numeric, text, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- Job/Schedule transactional RPCs
-- ------------------------------------------------------------
create or replace function public.rpc_create_job_with_optional_schedule(
  p_lead_id uuid default null,
  p_client_id uuid default null,
  p_team_id uuid default null,
  p_title text default null,
  p_job_number text default null,
  p_job_type text default null,
  p_status text default null,
  p_address text default null,
  p_notes text default null,
  p_scheduled_at timestamptz default null,
  p_end_at timestamptz default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := public.current_org_id();
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_event_id uuid;
  v_existing_job uuid;
  v_status text;
begin
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  if p_lead_id is not null then
    select id into v_existing_job
    from public.jobs
    where org_id = v_org_id
      and lead_id = p_lead_id
      and deleted_at is null
      and lower(coalesce(status, 'unscheduled')) not in ('canceled', 'cancelled', 'completed', 'done')
    limit 1;

    if v_existing_job is not null then
      return jsonb_build_object('job_id', v_existing_job, 'event_id', null, 'existing', true);
    end if;
  end if;

  v_status := coalesce(
    nullif(lower(trim(p_status)), ''),
    case when p_scheduled_at is null then 'unscheduled' else 'scheduled' end
  );

  insert into public.jobs (
    org_id, created_by, lead_id, client_id, team_id, title, job_number, job_type,
    status, property_address, notes, scheduled_at, end_at
  )
  values (
    v_org_id,
    coalesce(v_user_id, gen_random_uuid()),
    p_lead_id,
    p_client_id,
    p_team_id,
    coalesce(nullif(trim(p_title), ''), 'New job'),
    nullif(trim(p_job_number), ''),
    nullif(trim(p_job_type), ''),
    v_status,
    nullif(trim(p_address), ''),
    nullif(trim(p_notes), ''),
    p_scheduled_at,
    p_end_at
  )
  returning id into v_job_id;

  if p_scheduled_at is not null then
    insert into public.schedule_events (
      org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes
    )
    values (
      v_org_id,
      coalesce(v_user_id, gen_random_uuid()),
      v_job_id,
      p_team_id,
      p_scheduled_at,
      coalesce(p_end_at, p_scheduled_at + interval '1 hour'),
      coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
      'scheduled',
      nullif(trim(p_notes), '')
    )
    returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'job_id', v_job_id,
    'event_id', v_event_id,
    'existing', false
  );
end;
$fn$;

revoke all on function public.rpc_create_job_with_optional_schedule(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text) from public;
grant execute on function public.rpc_create_job_with_optional_schedule(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text) to authenticated, service_role;

create or replace function public.rpc_schedule_job(
  p_job_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_team_id uuid default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job public.jobs%rowtype;
  v_event public.schedule_events%rowtype;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
    and deleted_at is null
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  insert into public.schedule_events (
    org_id, created_by, job_id, team_id, start_at, end_at, timezone, status
  )
  values (
    v_job.org_id,
    coalesce(auth.uid(), v_job.created_by),
    v_job.id,
    coalesce(p_team_id, v_job.team_id),
    p_start_at,
    p_end_at,
    coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
    'scheduled'
  )
  returning * into v_event;

  update public.jobs
  set team_id = coalesce(p_team_id, team_id),
      status = 'scheduled',
      scheduled_at = p_start_at,
      end_at = p_end_at,
      updated_at = now()
  where id = v_job.id;

  return to_jsonb(v_event);
end;
$fn$;

revoke all on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;

create or replace function public.rpc_reschedule_event(
  p_event_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_team_id uuid default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event public.schedule_events%rowtype;
  v_overlaps integer := 0;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_event
  from public.schedule_events
  where id = p_event_id
    and deleted_at is null
  for update;

  if v_event.id is null then
    raise exception 'Schedule event not found';
  end if;

  update public.schedule_events
  set start_at = p_start_at,
      end_at = p_end_at,
      team_id = coalesce(p_team_id, team_id),
      timezone = coalesce(nullif(trim(p_timezone), ''), timezone, 'America/Montreal'),
      updated_at = now()
  where id = v_event.id;

  update public.jobs
  set scheduled_at = p_start_at,
      end_at = p_end_at,
      team_id = coalesce(p_team_id, team_id),
      status = 'scheduled',
      updated_at = now()
  where id = v_event.job_id;

  select count(*)
    into v_overlaps
  from public.schedule_events se
  where se.id <> v_event.id
    and se.deleted_at is null
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_team_id, v_event.team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)');

  return jsonb_build_object(
    'event', (
      select to_jsonb(se)
      from public.schedule_events se
      where se.id = v_event.id
    ),
    'overlaps', v_overlaps
  );
end;
$fn$;

revoke all on function public.rpc_reschedule_event(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.rpc_reschedule_event(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;

create or replace function public.rpc_unschedule_job(
  p_job_id uuid,
  p_event_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_event_id is not null then
    update public.schedule_events
    set deleted_at = now(),
        updated_at = now()
    where id = p_event_id
      and job_id = p_job_id
      and deleted_at is null;
  else
    update public.schedule_events
    set deleted_at = now(),
        updated_at = now()
    where job_id = p_job_id
      and deleted_at is null;
  end if;

  update public.jobs
  set status = 'unscheduled',
      scheduled_at = null,
      end_at = null,
      updated_at = now()
  where id = p_job_id
    and deleted_at is null;
end;
$fn$;

revoke all on function public.rpc_unschedule_job(uuid, uuid) from public;
grant execute on function public.rpc_unschedule_job(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- Lost cleanup (DB scheduler, soft delete)
-- ------------------------------------------------------------
create or replace function public.cleanup_lost_pipeline_deals()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer := 0;
begin
  update public.pipeline_deals
  set deleted_at = now(),
      updated_at = now()
  where deleted_at is null
    and lower(coalesce(stage, '')) = 'lost'
    and lost_at is not null
    and lost_at < now() - interval '15 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup_lost_pipeline_deals_daily') then
    perform cron.unschedule('cleanup_lost_pipeline_deals_daily');
  end if;
exception when undefined_table then
  null;
end;
$do$;

select cron.schedule(
  'cleanup_lost_pipeline_deals_daily',
  '0 3 * * *',
  $$select public.cleanup_lost_pipeline_deals();$$
);

-- ------------------------------------------------------------
-- RLS hardening (teams + existing tables)
-- ------------------------------------------------------------
alter table public.teams enable row level security;

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='teams' and policyname='teams_select_org') then
    create policy teams_select_org on public.teams
    for select to authenticated
    using (public.has_org_membership(auth.uid(), org_id) and deleted_at is null);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='teams' and policyname='teams_insert_org') then
    create policy teams_insert_org on public.teams
    for insert to authenticated
    with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='teams' and policyname='teams_update_org') then
    create policy teams_update_org on public.teams
    for update to authenticated
    using (public.has_org_membership(auth.uid(), org_id))
    with check (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

commit;


-- ============================================================
-- MIGRATION: 20260303224500_dashboard_search_indexes.sql
-- ============================================================

begin;

create extension if not exists pg_trgm;

create index if not exists idx_jobs_org_status_dashboard
  on public.jobs (org_id, status)
  where deleted_at is null;

create index if not exists idx_schedule_events_org_start_at_dashboard
  on public.schedule_events (org_id, start_at)
  where deleted_at is null;

create index if not exists idx_leads_org_status_dashboard
  on public.leads (org_id, status)
  where deleted_at is null;

create index if not exists idx_pipeline_deals_org_stage_dashboard
  on public.pipeline_deals (org_id, stage)
  where deleted_at is null;

create index if not exists idx_clients_name_trgm_dashboard
  on public.clients
  using gin (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(company, '')
    ) gin_trgm_ops
  );

commit;


-- ============================================================
-- MIGRATION: 20260303233000_global_search.sql
-- ============================================================

begin;

create extension if not exists pg_trgm;

create index if not exists clients_name_trgm
  on public.clients
  using gin (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(company, '')
    ) gin_trgm_ops
  );

create index if not exists jobs_title_trgm
  on public.jobs
  using gin (lower(coalesce(title, '')) gin_trgm_ops);

create index if not exists leads_title_trgm
  on public.leads
  using gin (
    lower(
      coalesce(title, '') || ' ' ||
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '')
    ) gin_trgm_ops
  );

create index if not exists pipeline_deals_title_trgm
  on public.pipeline_deals
  using gin (lower(coalesce(title, '')) gin_trgm_ops);

create or replace function public.search_global_source(p_org uuid, p_q text)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public, extensions
as $$
  with args as (
    select
      p_org as org_id,
      trim(coalesce(p_q, '')) as raw_q,
      lower(trim(coalesce(p_q, ''))) as q,
      auth.uid() as user_id
  ),
  guard as (
    select 1 as ok
    from args a
    where a.raw_q <> ''
      and a.org_id is not null
      and public.has_org_membership(a.user_id, a.org_id)
  ),
  query_terms as (
    select
      a.q,
      ('%' || a.q || '%')::text as pattern,
      plainto_tsquery('simple', a.q) as tsq
    from args a
    join guard g on true
  ),
  clients_ranked as (
    select
      'client'::text as entity_type,
      c.id as entity_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(c.company, ''),
        'Client'
      ) as title,
      coalesce(nullif(c.company, ''), nullif(c.email, ''), nullif(c.phone, ''), 'Client') as subtitle,
      c.created_at,
      (
        ts_rank_cd(
          to_tsvector(
            'simple',
            lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone))
          ),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q),
            similarity(lower(coalesce(c.email, '')), qt.q),
            similarity(lower(coalesce(c.phone, '')), qt.q)
          )
      )::double precision as rank
    from public.clients c
    join query_terms qt on true
    where c.org_id = p_org
      and c.deleted_at is null
      and (
        lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone))) @@ qt.tsq
      )
  ),
  jobs_ranked as (
    select
      'job'::text as entity_type,
      j.id as entity_id,
      coalesce(nullif(j.title, ''), nullif(j.job_number, ''), 'Job') as title,
      coalesce(
        nullif(j.client_name, ''),
        nullif(j.property_address, ''),
        nullif(j.status, ''),
        nullif(j.job_number, ''),
        'Job'
      ) as subtitle,
      j.created_at,
      (
        ts_rank_cd(
          to_tsvector(
            'simple',
            lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))
          ),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(j.title, '')), qt.q),
            similarity(lower(coalesce(j.client_name, '')), qt.q),
            similarity(lower(coalesce(j.property_address, '')), qt.q)
          )
      )::double precision as rank
    from public.jobs j
    join query_terms qt on true
    where j.org_id = p_org
      and j.deleted_at is null
      and (
        lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))) @@ qt.tsq
      )
  ),
  lead_candidates as (
    select
      l.id as entity_id,
      coalesce(
        nullif(pd.title, ''),
        nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''),
        'Lead'
      ) as title,
      coalesce(nullif(pd.stage, ''), nullif(l.phone, ''), nullif(l.email, ''), 'Lead') as subtitle,
      coalesce(pd.created_at, l.created_at) as created_at,
      (
        ts_rank_cd(
          to_tsvector(
            'simple',
            lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))
          ),
          qt.tsq
        ) * 2.0
        + greatest(
            similarity(lower(coalesce(pd.title, '')), qt.q),
            similarity(lower(concat_ws(' ', l.first_name, l.last_name)), qt.q),
            similarity(lower(coalesce(l.email, '')), qt.q)
          )
      )::double precision as rank,
      row_number() over (
        partition by l.id
        order by
          (
            ts_rank_cd(
              to_tsvector(
                'simple',
                lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))
              ),
              qt.tsq
            ) * 2.0
            + greatest(
                similarity(lower(coalesce(pd.title, '')), qt.q),
                similarity(lower(concat_ws(' ', l.first_name, l.last_name)), qt.q),
                similarity(lower(coalesce(l.email, '')), qt.q)
              )
          ) desc,
          coalesce(pd.created_at, l.created_at) desc
      ) as rn
    from public.pipeline_deals pd
    join public.leads l
      on l.id = pd.lead_id
     and l.org_id = p_org
     and l.deleted_at is null
    join query_terms qt on true
    where pd.org_id = p_org
      and pd.deleted_at is null
      and (
        lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))) @@ qt.tsq
      )
  ),
  leads_ranked as (
    select
      'lead'::text as entity_type,
      lc.entity_id,
      lc.title,
      lc.subtitle,
      lc.created_at,
      lc.rank
    from lead_candidates lc
    where lc.rn = 1
  )
  select * from clients_ranked
  union all
  select * from jobs_ranked
  union all
  select * from leads_ranked;
$$;

create or replace function public.search_global(
  p_org uuid,
  p_q text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public
as $$
  select
    s.entity_type,
    s.entity_id,
    s.title,
    s.subtitle,
    s.created_at,
    s.rank
  from public.search_global_source(p_org, p_q) s
  order by s.rank desc nulls last, s.created_at desc, s.entity_type asc
  limit greatest(1, least(coalesce(p_limit, 20), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.search_global_by_type(
  p_org uuid,
  p_q text,
  p_entity_type text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  rank double precision
)
language sql
security definer
set search_path = public
as $$
  select
    s.entity_type,
    s.entity_id,
    s.title,
    s.subtitle,
    s.created_at,
    s.rank
  from public.search_global_source(p_org, p_q) s
  where s.entity_type = lower(trim(coalesce(p_entity_type, '')))
  order by s.rank desc nulls last, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.search_global_counts(p_org uuid, p_q text)
returns table (
  entity_type text,
  total bigint
)
language sql
security definer
set search_path = public
as $$
  select s.entity_type, count(*)::bigint as total
  from public.search_global_source(p_org, p_q) s
  group by s.entity_type;
$$;

revoke all on function public.search_global_source(uuid, text) from public;
revoke all on function public.search_global(uuid, text, int, int) from public;
revoke all on function public.search_global_by_type(uuid, text, text, int, int) from public;
revoke all on function public.search_global_counts(uuid, text) from public;

grant execute on function public.search_global(uuid, text, int, int) to authenticated;
grant execute on function public.search_global_by_type(uuid, text, text, int, int) to authenticated;
grant execute on function public.search_global_counts(uuid, text) to authenticated;

commit;


-- ============================================================
-- MIGRATION: 20260304003000_calendar_schedule_rebuild.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  name text not null,
  color_hex text not null default '#3B82F6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.jobs add column if not exists team_id uuid null;
alter table public.jobs add column if not exists notes text null;
alter table public.jobs add column if not exists address text null;
alter table public.jobs alter column status set default 'unscheduled';

alter table public.schedule_events add column if not exists team_id uuid null;
alter table public.schedule_events add column if not exists start_at timestamptz;
alter table public.schedule_events add column if not exists end_at timestamptz;
alter table public.schedule_events add column if not exists timezone text default 'America/Montreal';

update public.jobs
set address = coalesce(address, property_address)
where address is null and property_address is not null;

update public.schedule_events
set start_at = coalesce(start_at, start_time),
    end_at = coalesce(end_at, end_time),
    timezone = coalesce(nullif(timezone, ''), 'America/Montreal')
where start_at is null
   or end_at is null
   or timezone is null
   or timezone = '';

alter table public.jobs drop constraint if exists jobs_team_id_fkey;
alter table public.jobs
  add constraint jobs_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

alter table public.schedule_events drop constraint if exists schedule_events_team_id_fkey;
alter table public.schedule_events
  add constraint schedule_events_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

create index if not exists idx_schedule_events_org_start_at on public.schedule_events (org_id, start_at);
create index if not exists idx_schedule_events_job_id on public.schedule_events (job_id);
create index if not exists idx_jobs_org_team_status on public.jobs (org_id, team_id, status);
create index if not exists idx_teams_org_deleted_name on public.teams (org_id, deleted_at, name);

create or replace view public.jobs_active as
select *
from public.jobs
where deleted_at is null;

revoke all on table public.teams from public;
revoke all on table public.jobs from public;
revoke all on table public.schedule_events from public;

alter table public.teams enable row level security;
alter table public.jobs enable row level security;
alter table public.schedule_events enable row level security;

do $do$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_select_org'
  ) then
    create policy teams_select_org on public.teams
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_insert_org'
  ) then
    create policy teams_insert_org on public.teams
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_update_org'
  ) then
    create policy teams_update_org on public.teams
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_delete_org'
  ) then
    create policy teams_delete_org on public.teams
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='jobs' and policyname='jobs_select_org'
  ) then
    create policy jobs_select_org on public.jobs
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='jobs' and policyname='jobs_insert_org'
  ) then
    create policy jobs_insert_org on public.jobs
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='jobs' and policyname='jobs_update_org'
  ) then
    create policy jobs_update_org on public.jobs
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='jobs' and policyname='jobs_delete_org'
  ) then
    create policy jobs_delete_org on public.jobs
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_select_org'
  ) then
    create policy schedule_events_select_org on public.schedule_events
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_insert_org'
  ) then
    create policy schedule_events_insert_org on public.schedule_events
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_update_org'
  ) then
    create policy schedule_events_update_org on public.schedule_events
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_delete_org'
  ) then
    create policy schedule_events_delete_org on public.schedule_events
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

create or replace function public.schedule_events_apply_job_team_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job_team_id uuid;
begin
  if new.team_id is not null then
    return new;
  end if;

  select j.team_id
    into v_job_team_id
  from public.jobs j
  where j.id = new.job_id
    and j.org_id = new.org_id
    and j.deleted_at is null
  limit 1;

  if v_job_team_id is not null then
    new.team_id := v_job_team_id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_schedule_events_apply_job_team_default on public.schedule_events;
create trigger trg_schedule_events_apply_job_team_default
before insert or update of job_id, team_id
on public.schedule_events
for each row
execute function public.schedule_events_apply_job_team_default();

create or replace function public.jobs_sync_future_events_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.team_id is not distinct from new.team_id then
    return new;
  end if;

  update public.schedule_events se
  set team_id = new.team_id,
      updated_at = now()
  where se.job_id = new.id
    and se.org_id = new.org_id
    and se.deleted_at is null
    and se.start_at >= now();

  return new;
end;
$fn$;

drop trigger if exists trg_jobs_sync_future_events_team on public.jobs;
create trigger trg_jobs_sync_future_events_team
after update of team_id
on public.jobs
for each row
execute function public.jobs_sync_future_events_team();

create or replace function public.rpc_schedule_job(
  p_job_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_team_id uuid default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job public.jobs%rowtype;
  v_team public.teams%rowtype;
  v_event public.schedule_events%rowtype;
  v_existing_event public.schedule_events%rowtype;
  v_overlaps integer := 0;
  v_team_for_overlap uuid;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
    and deleted_at is null
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.has_org_membership(auth.uid(), v_job.org_id) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_team_id is not null then
    select * into v_team
    from public.teams
    where id = p_team_id
      and org_id = v_job.org_id
      and deleted_at is null
    limit 1;

    if v_team.id is null then
      raise exception 'Team not found in organization';
    end if;
  end if;

  select * into v_existing_event
  from public.schedule_events
  where job_id = v_job.id
    and deleted_at is null
  order by created_at desc
  limit 1
  for update;

  if v_existing_event.id is not null then
    update public.schedule_events
    set start_at = p_start_at,
        end_at = p_end_at,
        team_id = coalesce(p_team_id, team_id, v_job.team_id),
        timezone = coalesce(nullif(trim(p_timezone), ''), timezone, 'America/Montreal'),
        status = 'scheduled',
        notes = coalesce(notes, v_job.notes),
        deleted_at = null,
        updated_at = now()
    where id = v_existing_event.id
    returning * into v_event;
  else
    insert into public.schedule_events (
      org_id,
      created_by,
      job_id,
      team_id,
      start_at,
      end_at,
      timezone,
      status,
      notes
    )
    values (
      v_job.org_id,
      coalesce(auth.uid(), v_job.created_by),
      v_job.id,
      coalesce(p_team_id, v_job.team_id),
      p_start_at,
      p_end_at,
      coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
      'scheduled',
      v_job.notes
    )
    returning * into v_event;
  end if;

  update public.jobs
  set team_id = coalesce(p_team_id, team_id),
      status = 'scheduled',
      scheduled_at = p_start_at,
      end_at = p_end_at,
      updated_at = now()
  where id = v_job.id;

  v_team_for_overlap := coalesce(v_event.team_id, v_job.team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  select count(*)
    into v_overlaps
  from public.schedule_events se
  where se.id <> v_event.id
    and se.deleted_at is null
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'overlaps', v_overlaps,
    'updated', v_existing_event.id is not null
  );
end;
$fn$;

create or replace function public.rpc_reschedule_event(
  p_event_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_team_id uuid default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event public.schedule_events%rowtype;
  v_team public.teams%rowtype;
  v_overlaps integer := 0;
  v_team_for_overlap uuid;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_event
  from public.schedule_events
  where id = p_event_id
    and deleted_at is null
  for update;

  if v_event.id is null then
    raise exception 'Schedule event not found';
  end if;

  if not public.has_org_membership(auth.uid(), v_event.org_id) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_team_id is not null then
    select * into v_team
    from public.teams
    where id = p_team_id
      and org_id = v_event.org_id
      and deleted_at is null
    limit 1;

    if v_team.id is null then
      raise exception 'Team not found in organization';
    end if;
  end if;

  update public.schedule_events
  set start_at = p_start_at,
      end_at = p_end_at,
      team_id = coalesce(p_team_id, team_id),
      timezone = coalesce(nullif(trim(p_timezone), ''), timezone, 'America/Montreal'),
      status = 'scheduled',
      updated_at = now()
  where id = v_event.id
  returning * into v_event;

  update public.jobs
  set team_id = coalesce(p_team_id, team_id),
      scheduled_at = p_start_at,
      end_at = p_end_at,
      status = 'scheduled',
      updated_at = now()
  where id = v_event.job_id
    and deleted_at is null;

  v_team_for_overlap := coalesce(v_event.team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  select count(*)
    into v_overlaps
  from public.schedule_events se
  where se.id <> v_event.id
    and se.deleted_at is null
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'overlaps', v_overlaps
  );
end;
$fn$;

create or replace function public.rpc_unschedule_job(
  p_job_id uuid,
  p_event_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id
    and deleted_at is null
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.has_org_membership(auth.uid(), v_job.org_id) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_event_id is not null then
    delete from public.schedule_events
    where id = p_event_id
      and job_id = p_job_id
      and deleted_at is null;
  else
    delete from public.schedule_events
    where job_id = p_job_id
      and deleted_at is null;
  end if;

  update public.jobs
  set status = 'unscheduled',
      scheduled_at = null,
      end_at = null,
      updated_at = now()
  where id = p_job_id
    and deleted_at is null;
end;
$fn$;

revoke all on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) from public;
revoke all on function public.rpc_reschedule_event(uuid, timestamptz, timestamptz, uuid, text) from public;
revoke all on function public.rpc_unschedule_job(uuid, uuid) from public;

grant execute on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_reschedule_event(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_unschedule_job(uuid, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260304013000_calendar_team_fixes.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  name text not null,
  color_hex text not null default '#3B82F6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.jobs add column if not exists team_id uuid null;
alter table public.schedule_events add column if not exists team_id uuid null;
alter table public.schedule_events add column if not exists start_at timestamptz;
alter table public.schedule_events add column if not exists end_at timestamptz;
alter table public.schedule_events add column if not exists timezone text default 'America/Montreal';

update public.schedule_events
set start_at = coalesce(start_at, start_time),
    end_at = coalesce(end_at, end_time),
    timezone = coalesce(nullif(timezone, ''), 'America/Montreal')
where start_at is null
   or end_at is null
   or timezone is null
   or timezone = '';

alter table public.jobs drop constraint if exists jobs_team_id_fkey;
alter table public.jobs
  add constraint jobs_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

alter table public.schedule_events drop constraint if exists schedule_events_team_id_fkey;
alter table public.schedule_events
  add constraint schedule_events_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

create index if not exists idx_schedule_events_org_start_at on public.schedule_events (org_id, start_at);
create index if not exists idx_schedule_events_job_id on public.schedule_events (job_id);
create index if not exists idx_jobs_org_team_status on public.jobs (org_id, team_id, status);
create index if not exists idx_teams_org_deleted_name on public.teams (org_id, deleted_at, name);

create or replace view public.jobs_active as
select *
from public.jobs
where deleted_at is null;

revoke all on table public.teams from public;
alter table public.teams enable row level security;

do $do$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_select_org'
  ) then
    create policy teams_select_org on public.teams
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_insert_org'
  ) then
    create policy teams_insert_org on public.teams
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_update_org'
  ) then
    create policy teams_update_org on public.teams
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='teams' and policyname='teams_delete_org'
  ) then
    create policy teams_delete_org on public.teams
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

create or replace function public.schedule_events_apply_job_team_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job_team_id uuid;
begin
  if new.team_id is not null then
    return new;
  end if;

  select j.team_id
    into v_job_team_id
  from public.jobs j
  where j.id = new.job_id
    and j.org_id = new.org_id
    and j.deleted_at is null
  limit 1;

  if v_job_team_id is not null then
    new.team_id := v_job_team_id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_schedule_events_apply_job_team_default on public.schedule_events;
create trigger trg_schedule_events_apply_job_team_default
before insert or update of job_id, team_id
on public.schedule_events
for each row
execute function public.schedule_events_apply_job_team_default();

create or replace function public.jobs_sync_future_events_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.team_id is not distinct from new.team_id then
    return new;
  end if;

  update public.schedule_events se
  set team_id = new.team_id,
      updated_at = now()
  where se.job_id = new.id
    and se.org_id = new.org_id
    and se.deleted_at is null
    and se.start_at >= now();

  return new;
end;
$fn$;

drop trigger if exists trg_jobs_sync_future_events_team on public.jobs;
create trigger trg_jobs_sync_future_events_team
after update of team_id
on public.jobs
for each row
execute function public.jobs_sync_future_events_team();

create or replace function public.rpc_schedule_job(
  p_job_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_team_id uuid default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job public.jobs%rowtype;
  v_team public.teams%rowtype;
  v_event public.schedule_events%rowtype;
  v_existing_event public.schedule_events%rowtype;
  v_overlaps integer := 0;
  v_team_for_overlap uuid;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
    and deleted_at is null
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.has_org_membership(auth.uid(), v_job.org_id) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_team_id is not null then
    select * into v_team
    from public.teams
    where id = p_team_id
      and org_id = v_job.org_id
      and deleted_at is null
    limit 1;

    if v_team.id is null then
      raise exception 'Team not found in organization';
    end if;
  end if;

  select * into v_existing_event
  from public.schedule_events
  where job_id = v_job.id
    and deleted_at is null
  order by created_at desc
  limit 1
  for update;

  if v_existing_event.id is not null then
    update public.schedule_events
    set start_at = p_start_at,
        end_at = p_end_at,
        team_id = coalesce(p_team_id, team_id, v_job.team_id),
        timezone = coalesce(nullif(trim(p_timezone), ''), timezone, 'America/Montreal'),
        status = 'scheduled',
        notes = coalesce(notes, v_job.notes),
        deleted_at = null,
        updated_at = now()
    where id = v_existing_event.id
    returning * into v_event;
  else
    insert into public.schedule_events (
      org_id,
      created_by,
      job_id,
      team_id,
      start_at,
      end_at,
      timezone,
      status,
      notes
    )
    values (
      v_job.org_id,
      coalesce(auth.uid(), v_job.created_by),
      v_job.id,
      coalesce(p_team_id, v_job.team_id),
      p_start_at,
      p_end_at,
      coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
      'scheduled',
      v_job.notes
    )
    returning * into v_event;
  end if;

  update public.jobs
  set team_id = coalesce(p_team_id, team_id),
      status = 'scheduled',
      scheduled_at = p_start_at,
      end_at = p_end_at,
      updated_at = now()
  where id = v_job.id;

  v_team_for_overlap := coalesce(v_event.team_id, v_job.team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  select count(*)
    into v_overlaps
  from public.schedule_events se
  where se.id <> v_event.id
    and se.deleted_at is null
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'overlaps', v_overlaps,
    'updated', v_existing_event.id is not null
  );
end;
$fn$;

revoke all on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260304100000_invoices_module.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft',
  subject text null,
  issued_at timestamptz null,
  due_date date null,
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  paid_cents integer not null default 0,
  balance_cents integer not null default 0,
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  qty numeric(12,2) not null default 1,
  unit_price_cents integer not null default 0,
  line_total_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_sequences (
  org_id uuid primary key,
  last_value integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.invoices add column if not exists org_id uuid;
alter table public.invoices add column if not exists created_by uuid;
alter table public.invoices add column if not exists client_id uuid;
alter table public.invoices add column if not exists invoice_number text;
alter table public.invoices add column if not exists status text;
alter table public.invoices add column if not exists subject text;
alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists subtotal_cents integer;
alter table public.invoices add column if not exists tax_cents integer;
alter table public.invoices add column if not exists total_cents integer;
alter table public.invoices add column if not exists paid_cents integer;
alter table public.invoices add column if not exists balance_cents integer;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists created_at timestamptz;
alter table public.invoices add column if not exists updated_at timestamptz;
alter table public.invoices add column if not exists deleted_at timestamptz;

alter table public.invoice_items add column if not exists org_id uuid;
alter table public.invoice_items add column if not exists invoice_id uuid;
alter table public.invoice_items add column if not exists description text;
alter table public.invoice_items add column if not exists qty numeric(12,2);
alter table public.invoice_items add column if not exists unit_price_cents integer;
alter table public.invoice_items add column if not exists line_total_cents integer;
alter table public.invoice_items add column if not exists created_at timestamptz;

alter table public.invoices alter column org_id set default public.current_org_id();
alter table public.invoices alter column created_by set default auth.uid();
alter table public.invoices alter column status set default 'draft';
alter table public.invoices alter column subtotal_cents set default 0;
alter table public.invoices alter column tax_cents set default 0;
alter table public.invoices alter column total_cents set default 0;
alter table public.invoices alter column paid_cents set default 0;
alter table public.invoices alter column balance_cents set default 0;
alter table public.invoices alter column created_at set default now();
alter table public.invoices alter column updated_at set default now();

alter table public.invoice_items alter column org_id set default public.current_org_id();
alter table public.invoice_items alter column qty set default 1;
alter table public.invoice_items alter column unit_price_cents set default 0;
alter table public.invoice_items alter column line_total_cents set default 0;
alter table public.invoice_items alter column created_at set default now();

alter table public.invoices alter column org_id set not null;
alter table public.invoices alter column created_by set not null;
alter table public.invoices alter column client_id set not null;
alter table public.invoices alter column invoice_number set not null;
alter table public.invoices alter column status set not null;
alter table public.invoices alter column subtotal_cents set not null;
alter table public.invoices alter column tax_cents set not null;
alter table public.invoices alter column total_cents set not null;
alter table public.invoices alter column paid_cents set not null;
alter table public.invoices alter column balance_cents set not null;
alter table public.invoices alter column created_at set not null;
alter table public.invoices alter column updated_at set not null;

alter table public.invoice_items alter column org_id set not null;
alter table public.invoice_items alter column invoice_id set not null;
alter table public.invoice_items alter column description set not null;
alter table public.invoice_items alter column qty set not null;
alter table public.invoice_items alter column unit_price_cents set not null;
alter table public.invoice_items alter column line_total_cents set not null;
alter table public.invoice_items alter column created_at set not null;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('draft', 'sent', 'partial', 'paid', 'void'));

alter table public.invoices drop constraint if exists invoices_invoice_number_org_unique;
alter table public.invoices
  add constraint invoices_invoice_number_org_unique unique (org_id, invoice_number);

alter table public.invoices drop constraint if exists invoices_client_id_fkey;
alter table public.invoices
  add constraint invoices_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.invoice_items drop constraint if exists invoice_items_invoice_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete cascade;

create index if not exists idx_invoices_org_status on public.invoices (org_id, status);
create index if not exists idx_invoices_org_due_date on public.invoices (org_id, due_date);
create index if not exists idx_invoices_org_issued_at on public.invoices (org_id, issued_at);
create index if not exists idx_invoices_org_client on public.invoices (org_id, client_id);
create index if not exists idx_invoices_org_number on public.invoices (org_id, invoice_number);
create index if not exists idx_invoices_org_deleted on public.invoices (org_id, deleted_at);
create index if not exists idx_invoice_items_org_invoice on public.invoice_items (org_id, invoice_id);
create index if not exists idx_invoices_number_trgm on public.invoices using gin (invoice_number gin_trgm_ops);
create index if not exists idx_invoices_subject_trgm on public.invoices using gin (coalesce(subject, '') gin_trgm_ops);
create index if not exists idx_clients_search_name_trgm on public.clients
  using gin ((lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(company, ''))) gin_trgm_ops);

create or replace function public.invoice_next_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_next integer;
begin
  insert into public.invoice_sequences (org_id, last_value)
  values (p_org, 0)
  on conflict (org_id) do nothing;

  update public.invoice_sequences
  set last_value = last_value + 1,
      updated_at = now()
  where org_id = p_org
  returning last_value into v_next;

  return 'INV-' || lpad(v_next::text, 6, '0');
end;
$fn$;

create or replace function public.invoice_items_set_line_total()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.qty := greatest(coalesce(new.qty, 1), 0);
  new.unit_price_cents := greatest(coalesce(new.unit_price_cents, 0), 0);
  new.line_total_cents := greatest(round(new.qty * new.unit_price_cents)::integer, 0);
  return new;
end;
$fn$;

create or replace function public.invoice_items_sync_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  select org_id
    into v_org
  from public.invoices
  where id = new.invoice_id
    and deleted_at is null
  limit 1;

  if v_org is null then
    raise exception 'Invoice not found for item';
  end if;

  new.org_id := v_org;
  return new;
end;
$fn$;

create or replace function public.recalculate_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_subtotal integer := 0;
begin
  select coalesce(sum(ii.line_total_cents), 0)::integer
    into v_subtotal
  from public.invoice_items ii
  where ii.invoice_id = p_invoice_id;

  update public.invoices i
  set subtotal_cents = v_subtotal,
      total_cents = greatest(v_subtotal + coalesce(i.tax_cents, 0), 0),
      paid_cents = greatest(coalesce(i.paid_cents, 0), 0),
      balance_cents = greatest((v_subtotal + coalesce(i.tax_cents, 0)) - greatest(coalesce(i.paid_cents, 0), 0), 0),
      updated_at = now()
  where i.id = p_invoice_id;
end;
$fn$;

create or replace function public.invoices_apply_status_logic()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.subtotal_cents := greatest(coalesce(new.subtotal_cents, 0), 0);
  new.tax_cents := greatest(coalesce(new.tax_cents, 0), 0);
  new.total_cents := greatest(new.subtotal_cents + new.tax_cents, 0);
  new.paid_cents := greatest(coalesce(new.paid_cents, 0), 0);

  if new.paid_cents > new.total_cents then
    new.paid_cents := new.total_cents;
  end if;

  new.balance_cents := greatest(new.total_cents - new.paid_cents, 0);

  if coalesce(new.status, '') = 'void' then
    if new.paid_cents = 0 then
      new.paid_at := null;
    end if;
    return new;
  end if;

  if new.issued_at is null then
    new.status := 'draft';
    if new.paid_cents = 0 then
      new.paid_at := null;
    end if;
    return new;
  end if;

  if new.balance_cents = 0 then
    new.status := 'paid';
    if new.paid_at is null then
      new.paid_at := now();
    end if;
    return new;
  end if;

  if new.paid_cents > 0 then
    new.status := 'partial';
  else
    new.status := 'sent';
  end if;

  if new.balance_cents > 0 then
    new.paid_at := null;
  end if;

  return new;
end;
$fn$;

create or replace function public.invoice_items_recalculate_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_invoice_id uuid;
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  perform public.recalculate_invoice_totals(v_invoice_id);
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_invoice_items_set_line_total on public.invoice_items;
create trigger trg_invoice_items_set_line_total
before insert or update of qty, unit_price_cents
on public.invoice_items
for each row
execute function public.invoice_items_set_line_total();

drop trigger if exists trg_invoice_items_sync_org on public.invoice_items;
create trigger trg_invoice_items_sync_org
before insert or update of invoice_id
on public.invoice_items
for each row
execute function public.invoice_items_sync_org();

drop trigger if exists trg_invoice_items_recalculate_parent_insert on public.invoice_items;
create trigger trg_invoice_items_recalculate_parent_insert
after insert on public.invoice_items
for each row
execute function public.invoice_items_recalculate_parent();

drop trigger if exists trg_invoice_items_recalculate_parent_update on public.invoice_items;
create trigger trg_invoice_items_recalculate_parent_update
after update on public.invoice_items
for each row
execute function public.invoice_items_recalculate_parent();

drop trigger if exists trg_invoice_items_recalculate_parent_delete on public.invoice_items;
create trigger trg_invoice_items_recalculate_parent_delete
after delete on public.invoice_items
for each row
execute function public.invoice_items_recalculate_parent();

drop trigger if exists trg_invoices_set_updated_at on public.invoices;
create trigger trg_invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_apply_status_logic on public.invoices;
create trigger trg_invoices_apply_status_logic
before insert or update of issued_at, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, status, paid_at
on public.invoices
for each row
execute function public.invoices_apply_status_logic();

create or replace function public.rpc_create_invoice_draft(
  p_client_id uuid,
  p_subject text default null,
  p_due_date date default null
)
returns table (
  id uuid,
  invoice_number text,
  status text,
  subject text,
  due_date date,
  total_cents integer,
  balance_cents integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_number text;
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_client
  from public.clients
  where id = p_client_id
    and deleted_at is null
  limit 1;

  if v_client.id is null then
    raise exception 'Client not found';
  end if;

  if v_client.org_id <> v_org then
    raise exception 'Client does not belong to your organization';
  end if;

  if lower(coalesce(v_client.status, 'active')) = 'inactive' then
    raise exception 'Client is inactive';
  end if;

  v_number := public.invoice_next_number(v_org);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    v_org,
    auth.uid(),
    p_client_id,
    v_number,
    'draft',
    nullif(trim(p_subject), ''),
    null,
    p_due_date,
    0,
    0,
    0,
    0,
    0
  )
  returning * into v_invoice;

  return query
  select
    v_invoice.id,
    v_invoice.invoice_number,
    v_invoice.status,
    v_invoice.subject,
    v_invoice.due_date,
    v_invoice.total_cents,
    v_invoice.balance_cents,
    v_invoice.created_at;
end;
$fn$;

create or replace function public.rpc_save_invoice_draft(
  p_invoice_id uuid,
  p_subject text default null,
  p_due_date date default null,
  p_tax_cents integer default 0,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_invoice public.invoices%rowtype;
  v_item jsonb;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_invoice
  from public.invoices
  where id = p_invoice_id
    and deleted_at is null
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.org_id <> v_org then
    raise exception 'Invoice does not belong to your organization';
  end if;

  if v_invoice.status = 'void' then
    raise exception 'Cannot edit a void invoice';
  end if;

  update public.invoices
  set subject = nullif(trim(p_subject), ''),
      due_date = p_due_date,
      tax_cents = greatest(coalesce(p_tax_cents, 0), 0),
      updated_at = now()
  where id = v_invoice.id;

  delete from public.invoice_items
  where invoice_id = v_invoice.id;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.invoice_items (
      org_id,
      invoice_id,
      description,
      qty,
      unit_price_cents
    )
    values (
      v_org,
      v_invoice.id,
      coalesce(nullif(trim(v_item->>'description'), ''), 'Item'),
      greatest(coalesce((v_item->>'qty')::numeric, 1), 0),
      greatest(coalesce((v_item->>'unit_price_cents')::integer, 0), 0)
    );
  end loop;

  perform public.recalculate_invoice_totals(v_invoice.id);

  return (
    select to_jsonb(i)
    from public.invoices i
    where i.id = v_invoice.id
  );
end;
$fn$;

create or replace function public.rpc_invoices_kpis_30d(
  p_org uuid default null
)
returns table (
  past_due_count bigint,
  past_due_total_cents bigint,
  sent_not_due_count bigint,
  sent_not_due_total_cents bigint,
  draft_count bigint,
  draft_total_cents bigint,
  issued_30d_count bigint,
  issued_30d_total_cents bigint,
  avg_invoice_30d_cents bigint,
  avg_payment_time_days_30d numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select *
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
  ),
  overview as (
    select
      count(*) filter (
        where due_date < current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ) as past_due_count,
      coalesce(sum(balance_cents) filter (
        where due_date < current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ), 0)::bigint as past_due_total_cents,
      count(*) filter (
        where due_date >= current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ) as sent_not_due_count,
      coalesce(sum(balance_cents) filter (
        where due_date >= current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ), 0)::bigint as sent_not_due_total_cents,
      count(*) filter (
        where status = 'draft'
      ) as draft_count,
      coalesce(sum(total_cents) filter (
        where status = 'draft'
      ), 0)::bigint as draft_total_cents
    from base
  ),
  issued as (
    select
      count(*) as issued_30d_count,
      coalesce(sum(total_cents), 0)::bigint as issued_30d_total_cents
    from base
    where issued_at >= (now() - interval '30 days')
      and status in ('sent', 'partial', 'paid')
  ),
  payment as (
    select
      avg(extract(epoch from (paid_at - issued_at)) / 86400.0) as avg_payment_time_days_30d
    from base
    where paid_at is not null
      and issued_at is not null
      and paid_at >= (now() - interval '30 days')
      and paid_at >= issued_at
  )
  select
    o.past_due_count,
    o.past_due_total_cents,
    o.sent_not_due_count,
    o.sent_not_due_total_cents,
    o.draft_count,
    o.draft_total_cents,
    i.issued_30d_count,
    i.issued_30d_total_cents,
    case
      when i.issued_30d_count = 0 then 0::bigint
      else round(i.issued_30d_total_cents::numeric / i.issued_30d_count::numeric)::bigint
    end as avg_invoice_30d_cents,
    p.avg_payment_time_days_30d
  from overview o
  cross join issued i
  cross join payment p;
end;
$fn$;

create or replace function public.rpc_list_invoices(
  p_status text default 'all',
  p_range text default 'all',
  p_q text default null,
  p_sort text default 'due_date_desc',
  p_limit integer default 25,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_org uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_number text,
  status text,
  subject text,
  issued_at timestamptz,
  due_date date,
  total_cents integer,
  balance_cents integer,
  paid_cents integer,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_status text := lower(coalesce(p_status, 'all'));
  v_range text := lower(coalesce(p_range, 'all'));
  v_sort text := lower(coalesce(p_sort, 'due_date_desc'));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select
      i.id,
      i.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      i.invoice_number,
      i.status,
      i.subject,
      i.issued_at,
      i.due_date,
      i.total_cents,
      i.balance_cents,
      i.paid_cents,
      i.created_at,
      i.updated_at,
      coalesce(i.issued_at::date, i.created_at::date) as reference_date
    from public.invoices i
    left join public.clients c on c.id = i.client_id
    where i.org_id = v_org
      and i.deleted_at is null
      and (c.id is null or c.org_id = v_org)
  ),
  filtered as (
    select *
    from base b
    where
      (
        v_status = 'all'
        or (v_status = 'draft' and b.status = 'draft')
        or (v_status = 'paid' and b.status = 'paid')
        or (
          v_status = 'past_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date < current_date
        )
        or (
          v_status = 'sent_not_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date >= current_date
        )
      )
      and (
        v_range = 'all'
        or (v_range = '30d' and b.reference_date >= (current_date - interval '30 days')::date)
        or (v_range = 'this_month' and date_trunc('month', b.reference_date) = date_trunc('month', current_date))
        or (
          v_range = 'custom'
          and (p_from is null or b.reference_date >= p_from)
          and (p_to is null or b.reference_date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or b.invoice_number ilike ('%' || v_q || '%')
        or coalesce(b.subject, '') ilike ('%' || v_q || '%')
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_number,
    f.status,
    f.subject,
    f.issued_at,
    f.due_date,
    f.total_cents,
    f.balance_cents,
    f.paid_cents,
    f.created_at,
    f.updated_at,
    count(*) over() as total_count
  from filtered f
  order by
    case when v_sort = 'client_asc' then lower(f.client_name) end asc nulls last,
    case when v_sort = 'client_desc' then lower(f.client_name) end desc nulls last,
    case when v_sort = 'invoice_number_asc' then f.invoice_number end asc nulls last,
    case when v_sort = 'invoice_number_desc' then f.invoice_number end desc nulls last,
    case when v_sort = 'due_date_asc' then f.due_date end asc nulls last,
    case when v_sort = 'due_date_desc' then f.due_date end desc nulls last,
    case when v_sort = 'status_asc' then f.status end asc nulls last,
    case when v_sort = 'status_desc' then f.status end desc nulls last,
    case when v_sort = 'total_asc' then f.total_cents end asc nulls last,
    case when v_sort = 'total_desc' then f.total_cents end desc nulls last,
    case when v_sort = 'balance_asc' then f.balance_cents end asc nulls last,
    case when v_sort = 'balance_desc' then f.balance_cents end desc nulls last,
    f.created_at desc
  limit v_limit
  offset v_offset;
end;
$fn$;

revoke all on table public.invoices from public;
revoke all on table public.invoice_items from public;
revoke all on table public.invoice_sequences from public;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_sequences enable row level security;

do $do$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select_org'
  ) then
    create policy invoices_select_org on public.invoices
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_insert_org'
  ) then
    create policy invoices_insert_org on public.invoices
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_update_org'
  ) then
    create policy invoices_update_org on public.invoices
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_delete_org'
  ) then
    create policy invoices_delete_org on public.invoices
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_select_org'
  ) then
    create policy invoice_items_select_org on public.invoice_items
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_insert_org'
  ) then
    create policy invoice_items_insert_org on public.invoice_items
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_update_org'
  ) then
    create policy invoice_items_update_org on public.invoice_items
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_delete_org'
  ) then
    create policy invoice_items_delete_org on public.invoice_items
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_sequences' and policyname = 'invoice_sequences_select_org'
  ) then
    create policy invoice_sequences_select_org on public.invoice_sequences
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_sequences' and policyname = 'invoice_sequences_update_org'
  ) then
    create policy invoice_sequences_update_org on public.invoice_sequences
      for all to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

revoke all on function public.invoice_next_number(uuid) from public;
revoke all on function public.recalculate_invoice_totals(uuid) from public;
revoke all on function public.rpc_create_invoice_draft(uuid, text, date) from public;
revoke all on function public.rpc_save_invoice_draft(uuid, text, date, integer, jsonb) from public;
revoke all on function public.rpc_invoices_kpis_30d(uuid) from public;
revoke all on function public.rpc_list_invoices(text, text, text, text, integer, integer, date, date, uuid) from public;

grant execute on function public.invoice_next_number(uuid) to authenticated, service_role;
grant execute on function public.recalculate_invoice_totals(uuid) to authenticated, service_role;
grant execute on function public.rpc_create_invoice_draft(uuid, text, date) to authenticated, service_role;
grant execute on function public.rpc_save_invoice_draft(uuid, text, date, integer, jsonb) to authenticated, service_role;
grant execute on function public.rpc_invoices_kpis_30d(uuid) to authenticated, service_role;
grant execute on function public.rpc_list_invoices(text, text, text, text, integer, integer, date, date, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260304113000_jobs_geocoding_map.sql
-- ============================================================

begin;

alter table public.jobs
  add column if not exists latitude double precision null,
  add column if not exists longitude double precision null,
  add column if not exists geocoded_at timestamptz null,
  add column if not exists geocode_status text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_geocode_status_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_geocode_status_check
      check (geocode_status is null or geocode_status in ('ok', 'failed', 'pending'));
  end if;
end;
$$;

create index if not exists idx_jobs_org_lat_lng
  on public.jobs (org_id, latitude, longitude)
  where deleted_at is null;

create index if not exists idx_schedule_events_org_start_at
  on public.schedule_events (org_id, start_at);

commit;


-- ============================================================
-- MIGRATION: 20260304121000_security_fix_function_search_path.sql
-- ============================================================

begin;

-- Fix Supabase linter warning: function_search_path_mutable
-- We set a stable search_path for the flagged functions in schema public.
do $$
declare
  fn_name text;
  fn record;
  flagged_names text[] := array[
    'payments_sync_dates_and_update',
    'mark_job_geocode_pending',
    'touch_org_billing_settings_updated_at',
    'set_updated_at',
    'normalize_lead_stage_value',
    'trg_normalize_lead_stage',
    'crm_leads_stage_timestamps',
    'crm_normalize_lead_stage',
    'sync_schedule_event_time_columns',
    'crm_is_org_member',
    'crm_is_org_admin',
    'payments_sync_legacy_dates',
    'job_line_items_set_totals'
  ];
begin
  foreach fn_name in array flagged_names loop
    for fn in
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn_name
    loop
      execute format(
        'alter function public.%I(%s) set search_path = public',
        fn.proname,
        fn.args
      );
    end loop;
  end loop;
end $$;

commit;


-- ============================================================
-- MIGRATION: 20260304123000_insights_module.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  invoice_id uuid null references public.invoices(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  client_id uuid null references public.clients(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz not null,
  method text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.payments add column if not exists org_id uuid;
alter table public.payments add column if not exists created_by uuid;
alter table public.payments add column if not exists invoice_id uuid;
alter table public.payments add column if not exists job_id uuid;
alter table public.payments add column if not exists client_id uuid;
alter table public.payments add column if not exists amount_cents integer;
alter table public.payments add column if not exists paid_at timestamptz;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists created_at timestamptz;
alter table public.payments add column if not exists updated_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;

alter table public.payments alter column org_id set default public.current_org_id();
alter table public.payments alter column created_by set default auth.uid();
alter table public.payments alter column created_at set default now();
alter table public.payments alter column updated_at set default now();

update public.payments
set org_id = public.current_org_id()
where org_id is null;

update public.payments
set created_by = auth.uid()
where created_by is null;

update public.payments
set created_at = now()
where created_at is null;

update public.payments
set updated_at = now()
where updated_at is null;

alter table public.payments alter column org_id set not null;
alter table public.payments alter column created_by set not null;
alter table public.payments alter column amount_cents set not null;
alter table public.payments alter column paid_at set not null;
alter table public.payments alter column created_at set not null;
alter table public.payments alter column updated_at set not null;

alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

alter table public.payments drop constraint if exists payments_job_id_fkey;
alter table public.payments
  add constraint payments_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

alter table public.payments drop constraint if exists payments_client_id_fkey;
alter table public.payments
  add constraint payments_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_amount_cents_non_negative'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_amount_cents_non_negative
      check (amount_cents >= 0);
  end if;
end;
$$;

create index if not exists idx_leads_org_created_at_insights on public.leads (org_id, created_at);
create index if not exists idx_jobs_org_created_at_insights on public.jobs (org_id, created_at);
create index if not exists idx_jobs_org_lead_id_insights on public.jobs (org_id, lead_id);
create index if not exists idx_invoices_org_issued_at_insights on public.invoices (org_id, issued_at);
create index if not exists idx_invoices_org_status_insights on public.invoices (org_id, status);
create index if not exists idx_payments_org_paid_at on public.payments (org_id, paid_at);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'stage_slug'
  ) then
    execute 'create index if not exists idx_leads_org_stage_slug_insights on public.leads (org_id, stage_slug)';
  end if;
end;
$$;

drop trigger if exists trg_payments_set_updated_at on public.payments;
create trigger trg_payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_enforce_scope on public.payments;
create trigger trg_payments_enforce_scope
before insert on public.payments
for each row execute function public.crm_enforce_scope();

revoke all on table public.payments from public;
alter table public.payments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_select_org'
  ) then
    create policy payments_select_org on public.payments
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_insert_org'
  ) then
    create policy payments_insert_org on public.payments
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_update_org'
  ) then
    create policy payments_update_org on public.payments
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_delete_org'
  ) then
    create policy payments_delete_org on public.payments
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$$;

create or replace function public.rpc_insights_overview(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  new_leads_count bigint,
  converted_quotes_count bigint,
  new_oneoff_jobs_count bigint,
  invoiced_value_cents bigint,
  revenue_cents bigint,
  requests_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
  v_has_job_type boolean;
  v_has_payments boolean;
  v_new_leads bigint := 0;
  v_converted_quotes bigint := 0;
  v_new_oneoff_jobs bigint := 0;
  v_invoiced_cents bigint := 0;
  v_revenue_cents bigint := 0;
  v_requests bigint := null;
  v_has_requests boolean;
  v_requests_has_org boolean;
  v_requests_has_created boolean;
  v_requests_has_deleted boolean;
  v_requests_sql text;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  v_has_job_type := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'job_type'
  );
  v_has_payments := to_regclass('public.payments') is not null;

  select count(*)
    into v_new_leads
  from public.leads l
  where l.org_id = v_org
    and l.deleted_at is null
    and l.created_at >= v_from_ts
    and l.created_at < v_to_exclusive;

  -- Converted quotes definition used here:
  -- jobs created from a lead (jobs.lead_id is not null) in selected date range.
  select count(*)
    into v_converted_quotes
  from public.jobs j
  where j.org_id = v_org
    and j.deleted_at is null
    and j.lead_id is not null
    and j.created_at >= v_from_ts
    and j.created_at < v_to_exclusive;

  select count(*)
    into v_new_oneoff_jobs
  from public.jobs j
  where j.org_id = v_org
    and j.deleted_at is null
    and j.created_at >= v_from_ts
    and j.created_at < v_to_exclusive
    and (
      not v_has_job_type
      or coalesce(nullif(lower(trim(j.job_type)), ''), 'one_off') = 'one_off'
    );

  select coalesce(sum(i.total_cents), 0)::bigint
    into v_invoiced_cents
  from public.invoices i
  where i.org_id = v_org
    and i.deleted_at is null
    and i.status in ('sent', 'partial', 'paid')
    and coalesce(i.issued_at, i.created_at) >= v_from_ts
    and coalesce(i.issued_at, i.created_at) < v_to_exclusive;

  if v_has_payments then
    select coalesce(sum(p.amount_cents), 0)::bigint
      into v_revenue_cents
    from public.payments p
    where p.org_id = v_org
      and p.deleted_at is null
      and p.paid_at >= v_from_ts
      and p.paid_at < v_to_exclusive;
  else
    select coalesce(sum(i.paid_cents), 0)::bigint
      into v_revenue_cents
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and i.paid_at is not null
      and i.paid_at >= v_from_ts
      and i.paid_at < v_to_exclusive;
  end if;

  v_has_requests := to_regclass('public.requests') is not null;
  if v_has_requests then
    v_requests_has_org := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = 'org_id'
    );
    v_requests_has_created := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = 'created_at'
    );
    v_requests_has_deleted := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = 'deleted_at'
    );

    if v_requests_has_org and v_requests_has_created then
      v_requests_sql := 'select count(*) from public.requests r where r.org_id = $1 and r.created_at >= $2 and r.created_at < $3';
      if v_requests_has_deleted then
        v_requests_sql := v_requests_sql || ' and r.deleted_at is null';
      end if;
      execute v_requests_sql into v_requests using v_org, v_from_ts, v_to_exclusive;
    end if;
  end if;

  return query
  select
    v_new_leads,
    v_converted_quotes,
    v_new_oneoff_jobs,
    v_invoiced_cents,
    v_revenue_cents,
    v_requests;
end;
$$;

create or replace function public.rpc_insights_revenue_series(
  p_org uuid default null,
  p_from date default null,
  p_to date default null,
  p_granularity text default 'month'
)
returns table (
  bucket_start date,
  revenue_cents bigint,
  invoiced_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
  v_granularity text;
  v_step interval;
  v_series_start date;
  v_series_end date;
  v_has_payments boolean;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;
  v_granularity := lower(coalesce(p_granularity, 'month'));
  if v_granularity not in ('day', 'week', 'month') then
    v_granularity := 'month';
  end if;

  if v_granularity = 'day' then
    v_step := interval '1 day';
    v_series_start := v_from_date;
    v_series_end := v_to_date;
  elsif v_granularity = 'week' then
    v_step := interval '1 week';
    v_series_start := date_trunc('week', v_from_date::timestamp)::date;
    v_series_end := date_trunc('week', v_to_date::timestamp)::date;
  else
    v_step := interval '1 month';
    v_series_start := date_trunc('month', v_from_date::timestamp)::date;
    v_series_end := date_trunc('month', v_to_date::timestamp)::date;
  end if;

  v_has_payments := to_regclass('public.payments') is not null;

  if v_has_payments then
    return query
    with buckets as (
      select generate_series(v_series_start::timestamp, v_series_end::timestamp, v_step)::date as bucket_start
    ),
    revenue as (
      select
        date_trunc(v_granularity, p.paid_at)::date as bucket_start,
        coalesce(sum(p.amount_cents), 0)::bigint as revenue_cents
      from public.payments p
      where p.org_id = v_org
        and p.deleted_at is null
        and p.paid_at >= v_from_ts
        and p.paid_at < v_to_exclusive
      group by 1
    ),
    invoiced as (
      select
        date_trunc(v_granularity, coalesce(i.issued_at, i.created_at))::date as bucket_start,
        coalesce(sum(i.total_cents), 0)::bigint as invoiced_cents
      from public.invoices i
      where i.org_id = v_org
        and i.deleted_at is null
        and i.status in ('sent', 'partial', 'paid')
        and coalesce(i.issued_at, i.created_at) >= v_from_ts
        and coalesce(i.issued_at, i.created_at) < v_to_exclusive
      group by 1
    )
    select
      b.bucket_start,
      coalesce(r.revenue_cents, 0)::bigint,
      coalesce(i.invoiced_cents, 0)::bigint
    from buckets b
    left join revenue r on r.bucket_start = b.bucket_start
    left join invoiced i on i.bucket_start = b.bucket_start
    order by b.bucket_start asc;
  else
    return query
    with buckets as (
      select generate_series(v_series_start::timestamp, v_series_end::timestamp, v_step)::date as bucket_start
    ),
    revenue as (
      select
        date_trunc(v_granularity, i.paid_at)::date as bucket_start,
        coalesce(sum(i.paid_cents), 0)::bigint as revenue_cents
      from public.invoices i
      where i.org_id = v_org
        and i.deleted_at is null
        and i.paid_at is not null
        and i.paid_at >= v_from_ts
        and i.paid_at < v_to_exclusive
      group by 1
    ),
    invoiced as (
      select
        date_trunc(v_granularity, coalesce(i.issued_at, i.created_at))::date as bucket_start,
        coalesce(sum(i.total_cents), 0)::bigint as invoiced_cents
      from public.invoices i
      where i.org_id = v_org
        and i.deleted_at is null
        and i.status in ('sent', 'partial', 'paid')
        and coalesce(i.issued_at, i.created_at) >= v_from_ts
        and coalesce(i.issued_at, i.created_at) < v_to_exclusive
      group by 1
    )
    select
      b.bucket_start,
      coalesce(r.revenue_cents, 0)::bigint,
      coalesce(i.invoiced_cents, 0)::bigint
    from buckets b
    left join revenue r on r.bucket_start = b.bucket_start
    left join invoiced i on i.bucket_start = b.bucket_start
    order by b.bucket_start asc;
  end if;
end;
$$;

create or replace function public.rpc_insights_lead_conversion(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  leads_created bigint,
  leads_closed bigint,
  conversion_rate numeric,
  breakdown jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
  v_has_source boolean;
  v_has_payments boolean;
  v_created bigint := 0;
  v_closed bigint := 0;
  v_rate numeric := 0;
  v_breakdown jsonb := null;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  v_has_source := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'source'
  );
  v_has_payments := to_regclass('public.payments') is not null;

  select count(*)
    into v_created
  from public.leads l
  where l.org_id = v_org
    and l.deleted_at is null
    and l.created_at >= v_from_ts
    and l.created_at < v_to_exclusive;

  select count(*)
    into v_closed
  from public.jobs j
  where j.org_id = v_org
    and j.deleted_at is null
    and j.lead_id is not null
    and j.created_at >= v_from_ts
    and j.created_at < v_to_exclusive;

  if v_created > 0 then
    v_rate := round((v_closed::numeric / v_created::numeric), 4);
  else
    v_rate := 0;
  end if;

  if v_has_source then
    if v_has_payments then
      with created_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_created
        from public.leads l
        where l.org_id = v_org
          and l.deleted_at is null
          and l.created_at >= v_from_ts
          and l.created_at < v_to_exclusive
        group by 1
      ),
      closed_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_closed
        from public.jobs j
        join public.leads l
          on l.id = j.lead_id
         and l.org_id = j.org_id
         and l.deleted_at is null
        where j.org_id = v_org
          and j.deleted_at is null
          and j.lead_id is not null
          and j.created_at >= v_from_ts
          and j.created_at < v_to_exclusive
        group by 1
      ),
      revenue_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          coalesce(sum(p.amount_cents), 0)::bigint as revenue_cents
        from public.payments p
        join public.jobs j
          on j.id = p.job_id
         and j.org_id = p.org_id
         and j.deleted_at is null
         and j.lead_id is not null
        join public.leads l
          on l.id = j.lead_id
         and l.org_id = j.org_id
         and l.deleted_at is null
        where p.org_id = v_org
          and p.deleted_at is null
          and p.paid_at >= v_from_ts
          and p.paid_at < v_to_exclusive
        group by 1
      ),
      source_keys as (
        select source_key from created_source
        union
        select source_key from closed_source
        union
        select source_key from revenue_source
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source', sk.source_key,
            'leads_created', coalesce(cs.leads_created, 0),
            'leads_closed', coalesce(cl.leads_closed, 0),
            'revenue_cents', coalesce(rs.revenue_cents, 0)
          )
          order by sk.source_key
        ),
        '[]'::jsonb
      )
      into v_breakdown
      from source_keys sk
      left join created_source cs on cs.source_key = sk.source_key
      left join closed_source cl on cl.source_key = sk.source_key
      left join revenue_source rs on rs.source_key = sk.source_key;
    else
      with created_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_created
        from public.leads l
        where l.org_id = v_org
          and l.deleted_at is null
          and l.created_at >= v_from_ts
          and l.created_at < v_to_exclusive
        group by 1
      ),
      closed_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_closed
        from public.jobs j
        join public.leads l
          on l.id = j.lead_id
         and l.org_id = j.org_id
         and l.deleted_at is null
        where j.org_id = v_org
          and j.deleted_at is null
          and j.lead_id is not null
          and j.created_at >= v_from_ts
          and j.created_at < v_to_exclusive
        group by 1
      ),
      source_keys as (
        select source_key from created_source
        union
        select source_key from closed_source
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source', sk.source_key,
            'leads_created', coalesce(cs.leads_created, 0),
            'leads_closed', coalesce(cl.leads_closed, 0),
            'revenue_cents', 0
          )
          order by sk.source_key
        ),
        '[]'::jsonb
      )
      into v_breakdown
      from source_keys sk
      left join created_source cs on cs.source_key = sk.source_key
      left join closed_source cl on cl.source_key = sk.source_key;
    end if;
  end if;

  return query
  select v_created, v_closed, v_rate, v_breakdown;
end;
$$;

create or replace function public.rpc_insights_invoices_summary(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  count_draft bigint,
  count_sent bigint,
  count_paid bigint,
  count_past_due bigint,
  total_outstanding_cents bigint,
  avg_payment_time_days numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  return query
  with base as (
    select *
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and coalesce(i.issued_at, i.created_at) >= v_from_ts
      and coalesce(i.issued_at, i.created_at) < v_to_exclusive
  ),
  paid_stats as (
    select
      avg(extract(epoch from (i.paid_at - i.issued_at)) / 86400.0) as avg_payment_time_days
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and i.paid_at is not null
      and i.issued_at is not null
      and i.paid_at >= v_from_ts
      and i.paid_at < v_to_exclusive
      and i.paid_at >= i.issued_at
  )
  select
    count(*) filter (where b.status = 'draft')::bigint as count_draft,
    count(*) filter (where b.status in ('sent', 'partial'))::bigint as count_sent,
    count(*) filter (where b.status = 'paid')::bigint as count_paid,
    count(*) filter (
      where b.status in ('sent', 'partial')
        and b.balance_cents > 0
        and b.due_date < current_date
    )::bigint as count_past_due,
    coalesce(sum(b.balance_cents) filter (
      where b.status in ('sent', 'partial')
        and b.balance_cents > 0
    ), 0)::bigint as total_outstanding_cents,
    p.avg_payment_time_days
  from base b
  cross join paid_stats p;
end;
$$;

revoke all on function public.rpc_insights_overview(uuid, date, date) from public;
revoke all on function public.rpc_insights_revenue_series(uuid, date, date, text) from public;
revoke all on function public.rpc_insights_lead_conversion(uuid, date, date) from public;
revoke all on function public.rpc_insights_invoices_summary(uuid, date, date) from public;

grant execute on function public.rpc_insights_overview(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_revenue_series(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.rpc_insights_lead_conversion(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_invoices_summary(uuid, date, date) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260304153000_payments_module.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  client_id uuid null references public.clients(id) on delete set null,
  invoice_id uuid null references public.invoices(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD',
  method text null,
  status text not null default 'pending',
  payment_date timestamptz not null default now(),
  payout_date timestamptz null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.payments add column if not exists org_id uuid;
alter table public.payments add column if not exists client_id uuid;
alter table public.payments add column if not exists invoice_id uuid;
alter table public.payments add column if not exists job_id uuid;
alter table public.payments add column if not exists amount_cents integer;
alter table public.payments add column if not exists currency text;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists status text;
alter table public.payments add column if not exists payment_date timestamptz;
alter table public.payments add column if not exists payout_date timestamptz;
alter table public.payments add column if not exists created_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;

-- Compatibility with previous insights implementation.
alter table public.payments add column if not exists paid_at timestamptz;

alter table public.payments alter column org_id set default public.current_org_id();
alter table public.payments alter column currency set default 'CAD';
alter table public.payments alter column status set default 'pending';
alter table public.payments alter column payment_date set default now();
alter table public.payments alter column created_at set default now();

update public.payments
set org_id = public.current_org_id()
where org_id is null;

update public.payments
set currency = 'CAD'
where currency is null or btrim(currency) = '';

update public.payments
set status = 'pending'
where status is null or btrim(status) = '';

update public.payments
set status = 'pending'
where status not in ('succeeded', 'pending', 'failed');

update public.payments
set method = null
where method is not null and method not in ('card', 'e-transfer', 'cash', 'check');

update public.payments
set created_at = now()
where created_at is null;

update public.payments
set payment_date = coalesce(payment_date, paid_at, created_at, now())
where payment_date is null;

update public.payments
set paid_at = payment_date
where paid_at is null;

alter table public.payments alter column org_id set not null;
alter table public.payments alter column amount_cents set not null;
alter table public.payments alter column currency set not null;
alter table public.payments alter column status set not null;
alter table public.payments alter column payment_date set not null;
alter table public.payments alter column created_at set not null;

alter table public.payments drop constraint if exists payments_client_id_fkey;
alter table public.payments
  add constraint payments_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

alter table public.payments drop constraint if exists payments_job_id_fkey;
alter table public.payments
  add constraint payments_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('succeeded', 'pending', 'failed'));

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method is null or method in ('card', 'e-transfer', 'cash', 'check'));

create index if not exists idx_payments_org_id_module on public.payments (org_id);
create index if not exists idx_payments_payment_date_module on public.payments (payment_date desc);
create index if not exists idx_payments_invoice_id_module on public.payments (invoice_id);
create index if not exists idx_payments_client_id_module on public.payments (client_id);
create index if not exists idx_payments_org_payment_date_module on public.payments (org_id, payment_date desc);

create or replace function public.payments_sync_legacy_dates()
returns trigger
language plpgsql
as $$
begin
  new.payment_date := coalesce(new.payment_date, new.paid_at, new.created_at, now());
  new.paid_at := new.payment_date;
  return new;
end;
$$;

drop trigger if exists trg_payments_sync_legacy_dates on public.payments;
create trigger trg_payments_sync_legacy_dates
before insert or update of payment_date, paid_at
on public.payments
for each row execute function public.payments_sync_legacy_dates();

drop trigger if exists trg_payments_enforce_scope on public.payments;
create trigger trg_payments_enforce_scope
before insert on public.payments
for each row execute function public.crm_enforce_scope();

revoke all on table public.payments from public;
alter table public.payments enable row level security;

drop policy if exists payments_select_org on public.payments;
drop policy if exists payments_insert_org on public.payments;
drop policy if exists payments_update_org on public.payments;
drop policy if exists payments_delete_org on public.payments;

create policy payments_select_org on public.payments
  for select to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create policy payments_insert_org on public.payments
  for insert to authenticated
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payments_update_org on public.payments
  for update to authenticated
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payments_delete_org on public.payments
  for delete to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create or replace function public.rpc_payments_overview(
  p_org uuid default null
)
returns table (
  available_funds_cents bigint,
  invoice_payment_time_days_30d numeric,
  paid_on_time_global_pct_60d numeric,
  paid_on_time_residential_pct_60d numeric,
  paid_on_time_commercial_pct_60d numeric,
  has_property_split boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_has_property_type boolean;
  v_available bigint := 0;
  v_avg_payment_days numeric := null;
  v_global_pct numeric := null;
  v_res_pct numeric := null;
  v_com_pct numeric := null;
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  select coalesce(sum(p.amount_cents), 0)::bigint
    into v_available
  from public.payments p
  where p.org_id = v_org
    and p.deleted_at is null
    and p.status = 'succeeded'
    and p.payout_date is null;

  with paid_invoice as (
    select
      p.invoice_id,
      max(p.payment_date) as last_payment_date
    from public.payments p
    where p.org_id = v_org
      and p.deleted_at is null
      and p.status = 'succeeded'
      and p.invoice_id is not null
    group by p.invoice_id
  )
  select avg(extract(epoch from (pi.last_payment_date - coalesce(i.issued_at, i.created_at))) / 86400.0)
    into v_avg_payment_days
  from paid_invoice pi
  join public.invoices i
    on i.id = pi.invoice_id
   and i.org_id = v_org
   and i.deleted_at is null
  where pi.last_payment_date >= (now() - interval '30 days')
    and coalesce(i.issued_at, i.created_at) is not null
    and pi.last_payment_date >= coalesce(i.issued_at, i.created_at);

  with paid_invoice as (
    select
      p.invoice_id,
      max(p.payment_date) as paid_date,
      max(p.job_id) as job_id
    from public.payments p
    where p.org_id = v_org
      and p.deleted_at is null
      and p.status = 'succeeded'
      and p.invoice_id is not null
    group by p.invoice_id
  ),
  paid_60 as (
    select
      pi.invoice_id,
      pi.paid_date,
      i.due_date,
      pi.job_id
    from paid_invoice pi
    join public.invoices i
      on i.id = pi.invoice_id
     and i.org_id = v_org
     and i.deleted_at is null
    where pi.paid_date >= (now() - interval '60 days')
      and i.due_date is not null
  )
  select
    case
      when count(*) = 0 then null
      else round(avg(case when p60.paid_date::date <= p60.due_date then 100.0 else 0 end)::numeric, 2)
    end
  into v_global_pct
  from paid_60 p60;

  v_has_property_type := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'property_type'
  );

  if v_has_property_type then
    with paid_invoice as (
      select
        p.invoice_id,
        max(p.payment_date) as paid_date,
        max(p.job_id) as job_id
      from public.payments p
      where p.org_id = v_org
        and p.deleted_at is null
        and p.status = 'succeeded'
        and p.invoice_id is not null
      group by p.invoice_id
    ),
    paid_60 as (
      select
        pi.invoice_id,
        pi.paid_date,
        i.due_date,
        lower(trim(coalesce(j.property_type, ''))) as property_type
      from paid_invoice pi
      join public.invoices i
        on i.id = pi.invoice_id
       and i.org_id = v_org
       and i.deleted_at is null
      left join public.jobs j
        on j.id = pi.job_id
       and j.org_id = v_org
       and j.deleted_at is null
      where pi.paid_date >= (now() - interval '60 days')
        and i.due_date is not null
    )
    select
      case
        when count(*) filter (where property_type = 'residential') = 0 then null
        else round(
          avg(case when paid_date::date <= due_date then 100.0 else 0 end)
            filter (where property_type = 'residential')::numeric,
          2
        )
      end,
      case
        when count(*) filter (where property_type = 'commercial') = 0 then null
        else round(
          avg(case when paid_date::date <= due_date then 100.0 else 0 end)
            filter (where property_type = 'commercial')::numeric,
          2
        )
      end
    into v_res_pct, v_com_pct
    from paid_60;
  end if;

  return query
  select
    v_available,
    v_avg_payment_days,
    v_global_pct,
    v_res_pct,
    v_com_pct,
    v_has_property_type;
end;
$$;

create or replace function public.rpc_list_payments(
  p_status text default 'all',
  p_method text default 'all',
  p_date text default 'all',
  p_q text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_org uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_id uuid,
  invoice_number text,
  payment_date timestamptz,
  payout_date timestamptz,
  status text,
  method text,
  amount_cents integer,
  currency text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
  v_method text := lower(coalesce(nullif(trim(p_method), ''), 'all'));
  v_date text := lower(coalesce(nullif(trim(p_date), ''), 'all'));
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v_q_amount text;
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_q_amount := nullif(regexp_replace(coalesce(v_q, ''), '[^0-9.]', '', 'g'), '');

  return query
  with base as (
    select
      p.id,
      p.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      p.invoice_id,
      i.invoice_number,
      p.payment_date,
      p.payout_date,
      p.status,
      p.method,
      p.amount_cents,
      p.currency,
      p.created_at
    from public.payments p
    left join public.clients c
      on c.id = p.client_id
     and c.org_id = v_org
    left join public.invoices i
      on i.id = p.invoice_id
     and i.org_id = v_org
     and i.deleted_at is null
    where p.org_id = v_org
      and p.deleted_at is null
  ),
  filtered as (
    select *
    from base b
    where
      (v_status = 'all' or b.status = v_status)
      and (v_method = 'all' or coalesce(b.method, '') = v_method)
      and (
        v_date = 'all'
        or (v_date = '30d' and b.payment_date >= (now() - interval '30 days'))
        or (v_date = 'this_month' and date_trunc('month', b.payment_date) = date_trunc('month', now()))
        or (
          v_date = 'custom'
          and (p_from is null or b.payment_date::date >= p_from)
          and (p_to is null or b.payment_date::date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or coalesce(b.invoice_number, '') ilike ('%' || v_q || '%')
        or coalesce(b.method, '') ilike ('%' || v_q || '%')
        or b.amount_cents::text ilike ('%' || v_q || '%')
        or (v_q_amount is not null and to_char((b.amount_cents::numeric / 100.0), 'FM9999999990D00') ilike ('%' || v_q_amount || '%'))
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_id,
    f.invoice_number,
    f.payment_date,
    f.payout_date,
    f.status,
    f.method,
    f.amount_cents,
    f.currency,
    count(*) over() as total_count
  from filtered f
  order by f.payment_date desc, f.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.rpc_payments_overview(uuid) from public;
revoke all on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) from public;

grant execute on function public.rpc_payments_overview(uuid) to authenticated, service_role;
grant execute on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260304180000_payments_real_module.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique,
  stripe_enabled boolean not null default false,
  stripe_account_id text null,
  stripe_webhook_secret text null,
  paypal_enabled boolean not null default false,
  paypal_merchant_id text null,
  paypal_webhook_id text null,
  default_provider text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_providers add column if not exists org_id uuid;
alter table public.payment_providers add column if not exists stripe_enabled boolean;
alter table public.payment_providers add column if not exists stripe_account_id text;
alter table public.payment_providers add column if not exists stripe_webhook_secret text;
alter table public.payment_providers add column if not exists paypal_enabled boolean;
alter table public.payment_providers add column if not exists paypal_merchant_id text;
alter table public.payment_providers add column if not exists paypal_webhook_id text;
alter table public.payment_providers add column if not exists default_provider text;
alter table public.payment_providers add column if not exists created_at timestamptz;
alter table public.payment_providers add column if not exists updated_at timestamptz;

alter table public.payment_providers alter column stripe_enabled set default false;
alter table public.payment_providers alter column paypal_enabled set default false;
alter table public.payment_providers alter column created_at set default now();
alter table public.payment_providers alter column updated_at set default now();

update public.payment_providers
set org_id = public.current_org_id()
where org_id is null;

update public.payment_providers
set stripe_enabled = false
where stripe_enabled is null;

update public.payment_providers
set paypal_enabled = false
where paypal_enabled is null;

update public.payment_providers
set created_at = now()
where created_at is null;

update public.payment_providers
set updated_at = now()
where updated_at is null;

update public.payment_providers
set default_provider = null
where default_provider is not null and default_provider not in ('stripe', 'paypal');

alter table public.payment_providers alter column org_id set not null;
alter table public.payment_providers alter column stripe_enabled set not null;
alter table public.payment_providers alter column paypal_enabled set not null;
alter table public.payment_providers alter column created_at set not null;
alter table public.payment_providers alter column updated_at set not null;

alter table public.payment_providers drop constraint if exists payment_providers_default_provider_check;
alter table public.payment_providers
  add constraint payment_providers_default_provider_check
  check (default_provider is null or default_provider in ('stripe', 'paypal'));

alter table public.payment_providers drop constraint if exists payment_providers_org_id_key;
alter table public.payment_providers
  add constraint payment_providers_org_id_key unique (org_id);

create index if not exists idx_payment_providers_org_id on public.payment_providers (org_id);

drop trigger if exists trg_payment_providers_set_updated_at on public.payment_providers;
create trigger trg_payment_providers_set_updated_at
before update on public.payment_providers
for each row execute function public.set_updated_at();

drop trigger if exists trg_payment_providers_enforce_scope on public.payment_providers;
create trigger trg_payment_providers_enforce_scope
before insert on public.payment_providers
for each row execute function public.crm_enforce_scope();

alter table public.invoices add column if not exists total_cents integer;
alter table public.invoices add column if not exists paid_cents integer;
alter table public.invoices add column if not exists balance_cents integer;
alter table public.invoices add column if not exists status text;
alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists paid_at timestamptz;

update public.invoices
set total_cents = 0
where total_cents is null;

update public.invoices
set paid_cents = 0
where paid_cents is null;

update public.invoices
set balance_cents = greatest(coalesce(total_cents, 0) - coalesce(paid_cents, 0), 0)
where balance_cents is null;

update public.invoices
set status = case
  when coalesce(balance_cents, 0) = 0 and coalesce(total_cents, 0) > 0 then 'paid'
  when coalesce(paid_cents, 0) > 0 and coalesce(balance_cents, 0) > 0 then 'partial'
  else 'draft'
end
where status is null or btrim(status) = '';

alter table public.invoices alter column total_cents set default 0;
alter table public.invoices alter column paid_cents set default 0;
alter table public.invoices alter column balance_cents set default 0;

alter table public.invoices drop constraint if exists invoices_payment_status_check;
alter table public.invoices
  add constraint invoices_payment_status_check
  check (status in ('draft', 'sent', 'paid', 'partial', 'void'));

create index if not exists idx_invoices_org_issued_at_payments on public.invoices (org_id, issued_at desc);
create index if not exists idx_invoices_org_status_payments on public.invoices (org_id, status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  client_id uuid null references public.clients(id) on delete set null,
  invoice_id uuid null references public.invoices(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  provider text not null default 'manual',
  provider_payment_id text null,
  provider_order_id text null,
  provider_event_id text null,
  status text not null default 'pending',
  method text null,
  amount_cents integer not null,
  currency text not null default 'CAD',
  payment_date timestamptz not null default now(),
  payout_date timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.payments add column if not exists org_id uuid;
alter table public.payments add column if not exists client_id uuid;
alter table public.payments add column if not exists invoice_id uuid;
alter table public.payments add column if not exists job_id uuid;
alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists provider_payment_id text;
alter table public.payments add column if not exists provider_order_id text;
alter table public.payments add column if not exists provider_event_id text;
alter table public.payments add column if not exists status text;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists amount_cents integer;
alter table public.payments add column if not exists currency text;
alter table public.payments add column if not exists payment_date timestamptz;
alter table public.payments add column if not exists payout_date timestamptz;
alter table public.payments add column if not exists created_at timestamptz;
alter table public.payments add column if not exists updated_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;
alter table public.payments add column if not exists paid_at timestamptz;

alter table public.payments alter column org_id set default public.current_org_id();
alter table public.payments alter column provider set default 'manual';
alter table public.payments alter column status set default 'pending';
alter table public.payments alter column currency set default 'CAD';
alter table public.payments alter column payment_date set default now();
alter table public.payments alter column created_at set default now();
alter table public.payments alter column updated_at set default now();

update public.payments
set org_id = public.current_org_id()
where org_id is null;

update public.payments
set provider = 'manual'
where provider is null or btrim(provider) = '';

update public.payments
set status = 'pending'
where status is null or btrim(status) = '';

update public.payments
set status = 'pending'
where status not in ('succeeded', 'pending', 'failed', 'refunded');

update public.payments
set method = null
where method is not null and method not in ('card', 'e-transfer', 'cash', 'check');

update public.payments
set currency = 'CAD'
where currency is null or btrim(currency) = '';

update public.payments
set created_at = now()
where created_at is null;

update public.payments
set updated_at = now()
where updated_at is null;

update public.payments
set payment_date = coalesce(payment_date, paid_at, created_at, now())
where payment_date is null;

update public.payments
set paid_at = payment_date
where paid_at is null;

alter table public.payments alter column org_id set not null;
alter table public.payments alter column provider set not null;
alter table public.payments alter column status set not null;
alter table public.payments alter column amount_cents set not null;
alter table public.payments alter column currency set not null;
alter table public.payments alter column payment_date set not null;
alter table public.payments alter column created_at set not null;
alter table public.payments alter column updated_at set not null;

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments
  add constraint payments_provider_check
  check (provider in ('stripe', 'paypal', 'manual'));

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('succeeded', 'pending', 'failed', 'refunded'));

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method is null or method in ('card', 'e-transfer', 'cash', 'check'));

alter table public.payments drop constraint if exists payments_amount_cents_non_negative;
alter table public.payments
  add constraint payments_amount_cents_non_negative
  check (amount_cents >= 0);

alter table public.payments drop constraint if exists payments_client_id_fkey;
alter table public.payments
  add constraint payments_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

alter table public.payments drop constraint if exists payments_job_id_fkey;
alter table public.payments
  add constraint payments_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

create index if not exists idx_payments_org_id on public.payments (org_id);
create index if not exists idx_payments_payment_date on public.payments (payment_date desc);
create index if not exists idx_payments_invoice_id on public.payments (invoice_id);
create index if not exists idx_payments_client_id on public.payments (client_id);
create index if not exists idx_payments_status on public.payments (org_id, status);
create index if not exists idx_payments_provider on public.payments (org_id, provider);
create index if not exists idx_payments_provider_payment_id on public.payments (provider, provider_payment_id);
create index if not exists idx_payments_provider_event_id on public.payments (provider, provider_event_id);

create unique index if not exists uq_payments_provider_payment_id
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null and deleted_at is null;

create unique index if not exists uq_payments_provider_event_id
  on public.payments (provider, provider_event_id)
  where provider_event_id is not null and deleted_at is null;

create or replace function public.payments_sync_dates_and_update()
returns trigger
language plpgsql
as $$
begin
  new.payment_date := coalesce(new.payment_date, new.paid_at, new.created_at, now());
  new.paid_at := new.payment_date;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.recalculate_invoice_from_payments(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid_cents bigint := 0;
  v_latest_paid_at timestamptz := null;
  v_total_cents integer := 0;
  v_balance_cents integer := 0;
  v_status text := 'sent';
  v_prev_status text;
begin
  if p_invoice_id is null then
    return;
  end if;

  select
    coalesce(sum(p.amount_cents), 0)::bigint,
    max(p.payment_date)
  into v_paid_cents, v_latest_paid_at
  from public.payments p
  where p.invoice_id = p_invoice_id
    and p.deleted_at is null
    and p.status = 'succeeded';

  select i.total_cents, i.status
    into v_total_cents, v_prev_status
  from public.invoices i
  where i.id = p_invoice_id
    and i.deleted_at is null
  for update;

  if not found then
    return;
  end if;

  v_paid_cents := greatest(0, least(v_paid_cents, v_total_cents));
  v_balance_cents := greatest(v_total_cents - v_paid_cents::integer, 0);

  if v_prev_status = 'void' then
    v_status := 'void';
  elsif v_total_cents = 0 then
    v_status := 'draft';
  elsif v_balance_cents = 0 then
    v_status := 'paid';
  elsif v_paid_cents > 0 then
    v_status := 'partial';
  elsif v_prev_status = 'draft' then
    v_status := 'draft';
  else
    v_status := 'sent';
  end if;

  update public.invoices i
  set
    paid_cents = v_paid_cents::integer,
    balance_cents = v_balance_cents,
    status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(v_latest_paid_at, i.paid_at, now()) else null end,
    updated_at = now()
  where i.id = p_invoice_id;
end;
$$;

create or replace function public.payments_recalculate_invoice_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_invoice_from_payments(new.invoice_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.invoice_id is distinct from new.invoice_id then
      perform public.recalculate_invoice_from_payments(old.invoice_id);
      perform public.recalculate_invoice_from_payments(new.invoice_id);
    else
      perform public.recalculate_invoice_from_payments(new.invoice_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recalculate_invoice_from_payments(old.invoice_id);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_payments_set_updated_at on public.payments;
create trigger trg_payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_sync_dates on public.payments;
create trigger trg_payments_sync_dates
before insert or update of payment_date, paid_at
on public.payments
for each row execute function public.payments_sync_dates_and_update();

drop trigger if exists trg_payments_enforce_scope on public.payments;
create trigger trg_payments_enforce_scope
before insert on public.payments
for each row execute function public.crm_enforce_scope();

drop trigger if exists trg_payments_recalculate_invoice on public.payments;
create trigger trg_payments_recalculate_invoice
after insert or update or delete on public.payments
for each row execute function public.payments_recalculate_invoice_trigger();

revoke all on table public.payment_providers from public;
revoke all on table public.payments from public;

alter table public.payment_providers enable row level security;
alter table public.payments enable row level security;

drop policy if exists payment_providers_select_org on public.payment_providers;
drop policy if exists payment_providers_insert_org on public.payment_providers;
drop policy if exists payment_providers_update_org on public.payment_providers;
drop policy if exists payment_providers_delete_org on public.payment_providers;

create policy payment_providers_select_org on public.payment_providers
  for select to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create policy payment_providers_insert_org on public.payment_providers
  for insert to authenticated
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payment_providers_update_org on public.payment_providers
  for update to authenticated
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payment_providers_delete_org on public.payment_providers
  for delete to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists payments_select_org on public.payments;
drop policy if exists payments_insert_org on public.payments;
drop policy if exists payments_update_org on public.payments;
drop policy if exists payments_delete_org on public.payments;

create policy payments_select_org on public.payments
  for select to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create policy payments_insert_org on public.payments
  for insert to authenticated
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payments_update_org on public.payments
  for update to authenticated
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payments_delete_org on public.payments
  for delete to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create or replace function public.rpc_payments_overview_kpis(
  p_org uuid default null,
  p_now timestamptz default now()
)
returns table (
  available_funds_cents bigint,
  invoice_payment_time_days_30d numeric,
  paid_on_time_global_pct_60d numeric,
  paid_on_time_residential_pct_60d numeric,
  paid_on_time_commercial_pct_60d numeric,
  has_segment_split boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_now timestamptz := coalesce(p_now, now());
  v_has_jobs_service_type boolean;
  v_has_clients_segment boolean;
  v_available bigint := 0;
  v_avg_payment_days numeric := 0;
  v_global_pct numeric := 0;
  v_res_pct numeric := null;
  v_com_pct numeric := null;
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  select coalesce(sum(p.amount_cents), 0)::bigint
    into v_available
  from public.payments p
  where p.org_id = v_org
    and p.deleted_at is null
    and p.status = 'succeeded'
    and p.payout_date is null;

  select coalesce(
    avg(
      extract(epoch from (p.payment_date - coalesce(i.issued_at, i.created_at))) / 86400.0
    ),
    0
  )
  into v_avg_payment_days
  from public.payments p
  join public.invoices i
    on i.id = p.invoice_id
   and i.org_id = v_org
   and i.deleted_at is null
  where p.org_id = v_org
    and p.deleted_at is null
    and p.status = 'succeeded'
    and p.invoice_id is not null
    and p.payment_date >= (v_now - interval '30 days')
    and coalesce(i.issued_at, i.created_at) is not null
    and p.payment_date >= coalesce(i.issued_at, i.created_at);

  select coalesce(
    avg(
      case when i.paid_at::date <= i.due_date then 100.0 else 0 end
    ),
    0
  )
  into v_global_pct
  from public.invoices i
  where i.org_id = v_org
    and i.deleted_at is null
    and i.due_date is not null
    and i.paid_at is not null
    and i.paid_at >= (v_now - interval '60 days')
    and (i.status = 'paid' or i.balance_cents = 0);

  v_has_jobs_service_type := exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'service_type'
  );

  v_has_clients_segment := exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clients'
      and column_name = 'segment'
  );

  if v_has_jobs_service_type then
    with invoice_segment as (
      select
        i.id,
        i.paid_at,
        i.due_date,
        case
          when lower(coalesce(j.service_type, '')) like '%residential%' then 'residential'
          when lower(coalesce(j.service_type, '')) like '%commercial%' then 'commercial'
          else null
        end as segment
      from public.invoices i
      join public.payments p
        on p.invoice_id = i.id
       and p.org_id = v_org
       and p.deleted_at is null
      left join public.jobs j
        on j.id = p.job_id
       and j.org_id = v_org
       and j.deleted_at is null
      where i.org_id = v_org
        and i.deleted_at is null
        and i.due_date is not null
        and i.paid_at is not null
        and i.paid_at >= (v_now - interval '60 days')
        and (i.status = 'paid' or i.balance_cents = 0)
      group by i.id, i.paid_at, i.due_date, j.service_type
    )
    select
      case
        when count(*) filter (where segment = 'residential') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'residential')::numeric, 2)
      end,
      case
        when count(*) filter (where segment = 'commercial') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'commercial')::numeric, 2)
      end
    into v_res_pct, v_com_pct
    from invoice_segment;
  elsif v_has_clients_segment then
    with invoice_segment as (
      select
        i.id,
        i.paid_at,
        i.due_date,
        case
          when lower(coalesce(c.segment, '')) like '%residential%' then 'residential'
          when lower(coalesce(c.segment, '')) like '%commercial%' then 'commercial'
          else null
        end as segment
      from public.invoices i
      left join public.clients c
        on c.id = i.client_id
       and c.org_id = v_org
      where i.org_id = v_org
        and i.deleted_at is null
        and i.due_date is not null
        and i.paid_at is not null
        and i.paid_at >= (v_now - interval '60 days')
        and (i.status = 'paid' or i.balance_cents = 0)
    )
    select
      case
        when count(*) filter (where segment = 'residential') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'residential')::numeric, 2)
      end,
      case
        when count(*) filter (where segment = 'commercial') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'commercial')::numeric, 2)
      end
    into v_res_pct, v_com_pct
    from invoice_segment;
  end if;

  return query
  select
    v_available,
    coalesce(round(v_avg_payment_days::numeric, 2), 0),
    coalesce(round(v_global_pct::numeric, 2), 0),
    v_res_pct,
    v_com_pct,
    (v_res_pct is not null or v_com_pct is not null);
end;
$$;

create or replace function public.rpc_list_payments(
  p_status text default 'all',
  p_method text default 'all',
  p_date text default 'all',
  p_q text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_org uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_id uuid,
  invoice_number text,
  payment_date timestamptz,
  payout_date timestamptz,
  status text,
  method text,
  amount_cents integer,
  currency text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
  v_method text := lower(coalesce(nullif(trim(p_method), ''), 'all'));
  v_date text := lower(coalesce(nullif(trim(p_date), ''), 'all'));
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v_q_amount text;
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_q_amount := nullif(regexp_replace(coalesce(v_q, ''), '[^0-9.]', '', 'g'), '');

  return query
  with base as (
    select
      p.id,
      p.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      p.invoice_id,
      i.invoice_number,
      p.payment_date,
      p.payout_date,
      p.status,
      p.method,
      p.amount_cents,
      p.currency,
      p.created_at
    from public.payments p
    left join public.clients c
      on c.id = p.client_id
     and c.org_id = v_org
    left join public.invoices i
      on i.id = p.invoice_id
     and i.org_id = v_org
     and i.deleted_at is null
    where p.org_id = v_org
      and p.deleted_at is null
  ),
  filtered as (
    select *
    from base b
    where
      (v_status = 'all' or b.status = v_status)
      and (v_method = 'all' or coalesce(b.method, '') = v_method)
      and (
        v_date = 'all'
        or (v_date = '30d' and b.payment_date >= (now() - interval '30 days'))
        or (v_date = 'this_month' and date_trunc('month', b.payment_date) = date_trunc('month', now()))
        or (
          v_date = 'custom'
          and (p_from is null or b.payment_date::date >= p_from)
          and (p_to is null or b.payment_date::date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or coalesce(b.invoice_number, '') ilike ('%' || v_q || '%')
        or coalesce(b.method, '') ilike ('%' || v_q || '%')
        or b.amount_cents::text ilike ('%' || v_q || '%')
        or (v_q_amount is not null and to_char((b.amount_cents::numeric / 100.0), 'FM9999999990D00') ilike ('%' || v_q_amount || '%'))
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_id,
    f.invoice_number,
    f.payment_date,
    f.payout_date,
    f.status,
    f.method,
    f.amount_cents,
    f.currency,
    count(*) over() as total_count
  from filtered f
  order by f.payment_date desc, f.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.recalculate_invoice_from_payments(uuid) from public;
revoke all on function public.rpc_payments_overview_kpis(uuid, timestamptz) from public;
revoke all on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) from public;

grant execute on function public.recalculate_invoice_from_payments(uuid) to authenticated, service_role;
grant execute on function public.rpc_payments_overview_kpis(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260304203000_payment_settings_secure.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := null;
  v_exists boolean := false;
begin
  if p_user is null or p_org is null then
    return false;
  end if;

  if p_user = p_org then
    return true;
  end if;

  if to_regclass('public.memberships') is not null then
    select m.role
      into v_role
      from public.memberships m
     where m.user_id = p_user
       and m.org_id = p_org
     limit 1;

    if v_role is not null and lower(v_role) in ('owner', 'admin') then
      return true;
    end if;
  end if;

  if to_regclass('public.org_members') is not null then
    execute $q$
      select exists(
        select 1
          from public.org_members om
         where om.user_id = $1
           and om.org_id = $2
           and (
             coalesce(lower(om.role), '') in ('owner', 'admin')
             or coalesce(om.is_owner, false) = true
             or coalesce(om.is_admin, false) = true
           )
      )
    $q$ into v_exists using p_user, p_org;

    if v_exists then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create table if not exists public.payment_provider_settings (
  org_id uuid primary key,
  default_provider text not null default 'none',
  stripe_enabled boolean not null default false,
  paypal_enabled boolean not null default false,
  stripe_keys_present boolean not null default false,
  paypal_keys_present boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.payment_provider_settings add column if not exists org_id uuid;
alter table public.payment_provider_settings add column if not exists default_provider text;
alter table public.payment_provider_settings add column if not exists stripe_enabled boolean;
alter table public.payment_provider_settings add column if not exists paypal_enabled boolean;
alter table public.payment_provider_settings add column if not exists stripe_keys_present boolean;
alter table public.payment_provider_settings add column if not exists paypal_keys_present boolean;
alter table public.payment_provider_settings add column if not exists updated_at timestamptz;

update public.payment_provider_settings
set org_id = public.current_org_id()
where org_id is null;

update public.payment_provider_settings
set default_provider = 'none'
where default_provider is null or lower(default_provider) not in ('none', 'stripe', 'paypal');

update public.payment_provider_settings
set stripe_enabled = false
where stripe_enabled is null;

update public.payment_provider_settings
set paypal_enabled = false
where paypal_enabled is null;

update public.payment_provider_settings
set stripe_keys_present = false
where stripe_keys_present is null;

update public.payment_provider_settings
set paypal_keys_present = false
where paypal_keys_present is null;

update public.payment_provider_settings
set updated_at = now()
where updated_at is null;

alter table public.payment_provider_settings alter column org_id set not null;
alter table public.payment_provider_settings alter column default_provider set not null;
alter table public.payment_provider_settings alter column stripe_enabled set not null;
alter table public.payment_provider_settings alter column paypal_enabled set not null;
alter table public.payment_provider_settings alter column stripe_keys_present set not null;
alter table public.payment_provider_settings alter column paypal_keys_present set not null;
alter table public.payment_provider_settings alter column updated_at set not null;

alter table public.payment_provider_settings alter column default_provider set default 'none';
alter table public.payment_provider_settings alter column stripe_enabled set default false;
alter table public.payment_provider_settings alter column paypal_enabled set default false;
alter table public.payment_provider_settings alter column stripe_keys_present set default false;
alter table public.payment_provider_settings alter column paypal_keys_present set default false;
alter table public.payment_provider_settings alter column updated_at set default now();

alter table public.payment_provider_settings drop constraint if exists payment_provider_settings_default_provider_check;
alter table public.payment_provider_settings
  add constraint payment_provider_settings_default_provider_check
  check (default_provider in ('none', 'stripe', 'paypal'));

create table if not exists public.payment_provider_secrets (
  org_id uuid primary key,
  stripe_publishable_key text null,
  stripe_secret_key_enc text null,
  paypal_client_id text null,
  paypal_secret_enc text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_provider_secrets add column if not exists org_id uuid;
alter table public.payment_provider_secrets add column if not exists stripe_publishable_key text;
alter table public.payment_provider_secrets add column if not exists stripe_secret_key_enc text;
alter table public.payment_provider_secrets add column if not exists paypal_client_id text;
alter table public.payment_provider_secrets add column if not exists paypal_secret_enc text;
alter table public.payment_provider_secrets add column if not exists created_at timestamptz;
alter table public.payment_provider_secrets add column if not exists updated_at timestamptz;

update public.payment_provider_secrets
set created_at = now()
where created_at is null;

update public.payment_provider_secrets
set updated_at = now()
where updated_at is null;

alter table public.payment_provider_secrets alter column org_id set not null;
alter table public.payment_provider_secrets alter column created_at set not null;
alter table public.payment_provider_secrets alter column updated_at set not null;

alter table public.payment_provider_secrets alter column created_at set default now();
alter table public.payment_provider_secrets alter column updated_at set default now();

insert into public.payment_provider_settings (
  org_id,
  default_provider,
  stripe_enabled,
  paypal_enabled,
  stripe_keys_present,
  paypal_keys_present,
  updated_at
)
select
  pp.org_id,
  case
    when pp.default_provider in ('stripe', 'paypal') then pp.default_provider
    else 'none'
  end as default_provider,
  coalesce(pp.stripe_enabled, false) as stripe_enabled,
  coalesce(pp.paypal_enabled, false) as paypal_enabled,
  false as stripe_keys_present,
  false as paypal_keys_present,
  now()
from public.payment_providers pp
where pp.org_id is not null
on conflict (org_id) do update
set
  default_provider = excluded.default_provider,
  stripe_enabled = excluded.stripe_enabled,
  paypal_enabled = excluded.paypal_enabled,
  updated_at = now();

update public.payment_provider_settings s
set
  stripe_keys_present = (
    ps.stripe_publishable_key is not null
    and btrim(ps.stripe_publishable_key) <> ''
    and ps.stripe_secret_key_enc is not null
    and btrim(ps.stripe_secret_key_enc) <> ''
  ),
  paypal_keys_present = (
    ps.paypal_client_id is not null
    and btrim(ps.paypal_client_id) <> ''
    and ps.paypal_secret_enc is not null
    and btrim(ps.paypal_secret_enc) <> ''
  ),
  updated_at = now()
from public.payment_provider_secrets ps
where ps.org_id = s.org_id;

drop trigger if exists trg_payment_provider_settings_set_updated_at on public.payment_provider_settings;
create trigger trg_payment_provider_settings_set_updated_at
before update on public.payment_provider_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_payment_provider_secrets_set_updated_at on public.payment_provider_secrets;
create trigger trg_payment_provider_secrets_set_updated_at
before update on public.payment_provider_secrets
for each row execute function public.set_updated_at();

alter table public.payment_provider_settings enable row level security;
alter table public.payment_provider_secrets enable row level security;

drop policy if exists payment_provider_settings_select_org on public.payment_provider_settings;
drop policy if exists payment_provider_settings_insert_org on public.payment_provider_settings;
drop policy if exists payment_provider_settings_update_org on public.payment_provider_settings;
drop policy if exists payment_provider_settings_delete_org on public.payment_provider_settings;

create policy payment_provider_settings_select_org on public.payment_provider_settings
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy payment_provider_settings_insert_org on public.payment_provider_settings
for insert to authenticated
with check (public.has_org_admin_role(auth.uid(), org_id));

create policy payment_provider_settings_update_org on public.payment_provider_settings
for update to authenticated
using (public.has_org_admin_role(auth.uid(), org_id))
with check (public.has_org_admin_role(auth.uid(), org_id));

create policy payment_provider_settings_delete_org on public.payment_provider_settings
for delete to authenticated
using (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists payment_provider_secrets_block_all_select on public.payment_provider_secrets;
drop policy if exists payment_provider_secrets_block_all_insert on public.payment_provider_secrets;
drop policy if exists payment_provider_secrets_block_all_update on public.payment_provider_secrets;
drop policy if exists payment_provider_secrets_block_all_delete on public.payment_provider_secrets;

create policy payment_provider_secrets_block_all_select on public.payment_provider_secrets
for select to authenticated
using (false);

create policy payment_provider_secrets_block_all_insert on public.payment_provider_secrets
for insert to authenticated
with check (false);

create policy payment_provider_secrets_block_all_update on public.payment_provider_secrets
for update to authenticated
using (false)
with check (false);

create policy payment_provider_secrets_block_all_delete on public.payment_provider_secrets
for delete to authenticated
using (false);

create or replace function public.ensure_payment_settings_row(p_org uuid default null)
returns public.payment_provider_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.payment_provider_settings;
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  insert into public.payment_provider_settings (org_id)
  values (v_org)
  on conflict (org_id) do nothing;

  select *
    into v_row
    from public.payment_provider_settings
   where org_id = v_org;

  return v_row;
end;
$$;

revoke all on table public.payment_provider_settings from public;
revoke all on table public.payment_provider_secrets from public;
revoke all on function public.ensure_payment_settings_row(uuid) from public;
revoke all on function public.has_org_admin_role(uuid, uuid) from public;

grant execute on function public.ensure_payment_settings_row(uuid) to authenticated, service_role;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260305110000_payment_keys_settings.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

create table if not exists public.payment_provider_settings (
  org_id uuid primary key,
  stripe_keys_present boolean not null default false,
  paypal_keys_present boolean not null default false,
  stripe_enabled boolean not null default false,
  paypal_enabled boolean not null default false,
  default_provider text not null default 'none' check (default_provider in ('none', 'stripe', 'paypal')),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_provider_secrets (
  org_id uuid primary key,
  stripe_publishable_key text null,
  stripe_secret_key_enc text null,
  paypal_client_id text null,
  paypal_secret_enc text null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.orgs') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'payment_provider_settings_org_fk'
    ) then
      alter table public.payment_provider_settings
        add constraint payment_provider_settings_org_fk
        foreign key (org_id) references public.orgs(id) on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'payment_provider_secrets_org_fk'
    ) then
      alter table public.payment_provider_secrets
        add constraint payment_provider_secrets_org_fk
        foreign key (org_id) references public.orgs(id) on delete cascade;
    end if;
  end if;
end $$;

drop trigger if exists trg_payment_provider_settings_updated_at on public.payment_provider_settings;
create trigger trg_payment_provider_settings_updated_at
before update on public.payment_provider_settings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_payment_provider_secrets_updated_at on public.payment_provider_secrets;
create trigger trg_payment_provider_secrets_updated_at
before update on public.payment_provider_secrets
for each row
execute function public.set_updated_at();

alter table public.payment_provider_settings enable row level security;
alter table public.payment_provider_secrets enable row level security;

drop policy if exists pps_select_member on public.payment_provider_settings;
create policy pps_select_member
on public.payment_provider_settings
for select
to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
);

drop policy if exists pps_update_admin on public.payment_provider_settings;
create policy pps_update_admin
on public.payment_provider_settings
for update
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id))
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists pps_insert_admin on public.payment_provider_settings;
create policy pps_insert_admin
on public.payment_provider_settings
for insert
to authenticated
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists pps_delete_admin on public.payment_provider_settings;
create policy pps_delete_admin
on public.payment_provider_settings
for delete
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists ppss_deny_select on public.payment_provider_secrets;
create policy ppss_deny_select
on public.payment_provider_secrets
for select
to authenticated
using (false);

drop policy if exists ppss_deny_insert on public.payment_provider_secrets;
create policy ppss_deny_insert
on public.payment_provider_secrets
for insert
to authenticated
with check (false);

drop policy if exists ppss_deny_update on public.payment_provider_secrets;
create policy ppss_deny_update
on public.payment_provider_secrets
for update
to authenticated
using (false)
with check (false);

drop policy if exists ppss_deny_delete on public.payment_provider_secrets;
create policy ppss_deny_delete
on public.payment_provider_secrets
for delete
to authenticated
using (false);

drop function if exists public.ensure_payment_settings_row(uuid);
create or replace function public.ensure_payment_settings_row(p_org uuid)
returns public.payment_provider_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_provider_settings;
begin
  if p_org is null then
    raise exception 'p_org is required';
  end if;

  insert into public.payment_provider_settings (org_id)
  values (p_org)
  on conflict (org_id) do nothing;

  select *
    into v_row
    from public.payment_provider_settings
   where org_id = p_org;

  return v_row;
end;
$$;

revoke all on table public.payment_provider_settings from public;
revoke all on table public.payment_provider_secrets from public;
revoke all on function public.ensure_payment_settings_row(uuid) from public;

grant select, insert, update on public.payment_provider_settings to authenticated;
grant execute on function public.ensure_payment_settings_row(uuid) to authenticated, service_role;

commit;



-- ============================================================
-- MIGRATION: 20260305123000_soft_delete_jobs_clients.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists deleted_by uuid;

alter table public.jobs add column if not exists deleted_at timestamptz;
alter table public.jobs add column if not exists deleted_by uuid;

alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid;

create index if not exists idx_jobs_org_deleted_at on public.jobs (org_id, deleted_at);
create index if not exists idx_clients_org_deleted_at on public.clients (org_id, deleted_at);
create index if not exists idx_leads_org_deleted_at on public.leads (org_id, deleted_at);

create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

create or replace function public.enforce_soft_delete_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if auth.uid() is null then
      return new;
    end if;
    if not public.has_org_admin_role(auth.uid(), new.org_id) then
      raise exception 'Only owner/admin can soft-delete records.'
        using errcode = '42501';
    end if;
    if new.deleted_by is null then
      new.deleted_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_enforce_soft_delete_admin on public.clients;
create trigger trg_clients_enforce_soft_delete_admin
before update on public.clients
for each row
execute function public.enforce_soft_delete_admin();

drop trigger if exists trg_jobs_enforce_soft_delete_admin on public.jobs;
create trigger trg_jobs_enforce_soft_delete_admin
before update on public.jobs
for each row
execute function public.enforce_soft_delete_admin();

drop trigger if exists trg_leads_enforce_soft_delete_admin on public.leads;
create trigger trg_leads_enforce_soft_delete_admin
before update on public.leads
for each row
execute function public.enforce_soft_delete_admin();

create or replace function public.soft_delete_job(p_org_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jobs integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;
  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete jobs' using errcode = '42501';
  end if;

  update public.jobs
  set deleted_at = now(),
      deleted_by = v_uid
  where id = p_job_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_jobs = row_count;

  if to_regclass('public.audit_events') is not null and v_jobs > 0 then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'job.soft_deleted', jsonb_build_object('job_id', p_job_id, 'count', v_jobs);
  end if;

  return jsonb_build_object('job', v_jobs);
end;
$$;

create or replace function public.soft_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client integer := 0;
  v_jobs integer := 0;
  v_leads integer := 0;
  v_invoices integer := 0;
  v_notes integer := 0;
  v_has_leads_client_id boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;
  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = now(),
      deleted_by = v_uid
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client = row_count;

  update public.jobs
  set deleted_at = now(),
      deleted_by = v_uid
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_jobs = row_count;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'client_id'
  ) into v_has_leads_client_id;

  if v_has_leads_client_id then
    update public.leads
    set deleted_at = now(),
        deleted_by = v_uid
    where org_id = p_org_id
      and deleted_at is null
      and (
        client_id = p_client_id
        or converted_to_client_id = p_client_id
      );
  else
    update public.leads
    set deleted_at = now(),
        deleted_by = v_uid
    where org_id = p_org_id
      and deleted_at is null
      and converted_to_client_id = p_client_id;
  end if;
  get diagnostics v_leads = row_count;

  if to_regclass('public.invoices') is not null then
    begin
      execute
        'update public.invoices
            set deleted_at = now()
          where org_id = $1
            and client_id = $2
            and deleted_at is null'
      using p_org_id, p_client_id;
      get diagnostics v_invoices = row_count;
    exception when others then
      v_invoices := 0;
    end;
  end if;

  if to_regclass('public.notes') is not null then
    begin
      execute
        'update public.notes
            set deleted_at = now()
          where org_id = $1
            and client_id = $2
            and deleted_at is null'
      using p_org_id, p_client_id;
      get diagnostics v_notes = row_count;
    exception when others then
      v_notes := 0;
    end;
  end if;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'client.soft_deleted',
      jsonb_build_object(
        'client_id', p_client_id,
        'client', v_client,
        'jobs', v_jobs,
        'leads', v_leads,
        'invoices', v_invoices,
        'notes', v_notes
      );
  end if;

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', v_leads,
    'invoices', v_invoices,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.soft_delete_job(uuid, uuid) from public;
revoke all on function public.soft_delete_client(uuid, uuid) from public;

grant execute on function public.soft_delete_job(uuid, uuid) to authenticated, service_role;
grant execute on function public.soft_delete_client(uuid, uuid) to authenticated, service_role;

commit;



-- ============================================================
-- MIGRATION: 20260305150000_jobs_to_invoices_automation.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Jobs schema hardening (fix missing end_at error + completion fields)
-- ------------------------------------------------------------------
alter table public.jobs add column if not exists end_at timestamptz;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists closed_at timestamptz;

create index if not exists idx_jobs_org_deleted_at on public.jobs (org_id, deleted_at);

-- ------------------------------------------------------------------
-- Invoices linkage to jobs + idempotency guard (1 active invoice/job)
-- ------------------------------------------------------------------
alter table public.invoices add column if not exists job_id uuid;

alter table public.invoices drop constraint if exists invoices_job_id_fkey;
alter table public.invoices
  add constraint invoices_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

create index if not exists idx_invoices_org_job on public.invoices (org_id, job_id);
create unique index if not exists uq_invoices_org_job_active
  on public.invoices (org_id, job_id)
  where deleted_at is null and job_id is not null;

-- ------------------------------------------------------------------
-- RPC: create invoice from job (idempotent)
-- ------------------------------------------------------------------
drop function if exists public.create_invoice_from_job(uuid, uuid, boolean);
create or replace function public.create_invoice_from_job(
  p_org_id uuid,
  p_job_id uuid,
  p_send_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_existing record;
  v_invoice_id uuid;
  v_invoice_status text;
  v_invoice_number text;
  v_due_date date := (current_date + interval '14 days')::date;
  v_subtotal integer := 0;
  v_line_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can create invoices from jobs' using errcode = '42501';
  end if;

  select j.id, j.org_id, j.client_id, j.title, j.currency, j.total_cents, j.total_amount, j.deleted_at
    into v_job
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = p_org_id
  limit 1;

  if not found or v_job.deleted_at is not null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if v_job.client_id is null then
    raise exception 'Job must be linked to a client before invoicing' using errcode = '23514';
  end if;

  select i.id, i.status
    into v_existing
  from public.invoices i
  where i.org_id = p_org_id
    and i.job_id = p_job_id
    and i.deleted_at is null
  order by i.created_at desc
  limit 1;

  if found then
    if p_send_now and v_existing.status = 'draft' then
      update public.invoices
         set status = 'sent',
             issued_at = coalesce(issued_at, now()),
             due_date = coalesce(due_date, v_due_date),
             updated_at = now()
       where id = v_existing.id;

      select status into v_invoice_status from public.invoices where id = v_existing.id;
    else
      v_invoice_status := v_existing.status;
    end if;

    return jsonb_build_object(
      'invoice_id', v_existing.id,
      'already_exists', true,
      'status', coalesce(v_invoice_status, v_existing.status)
    );
  end if;

  v_invoice_number := public.invoice_next_number(p_org_id);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    job_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    p_org_id,
    v_uid,
    v_job.client_id,
    p_job_id,
    v_invoice_number,
    case when p_send_now then 'sent' else 'draft' end,
    coalesce(nullif(trim(v_job.title), ''), 'Job invoice'),
    case when p_send_now then now() else null end,
    case when p_send_now then v_due_date else null end,
    0,
    0,
    0,
    0,
    0
  )
  returning id, status into v_invoice_id, v_invoice_status;

  insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
  select
    p_org_id,
    v_invoice_id,
    coalesce(nullif(trim(jli.name), ''), 'Job line item'),
    greatest(coalesce(jli.qty, 1), 0),
    greatest(coalesce(jli.unit_price_cents, 0), 0),
    greatest(round(coalesce(jli.qty, 1) * coalesce(jli.unit_price_cents, 0))::integer, 0)
  from public.job_line_items jli
  where jli.org_id = p_org_id
    and jli.job_id = p_job_id;

  get diagnostics v_line_count = row_count;

  if v_line_count = 0 then
    v_subtotal := greatest(
      coalesce(v_job.total_cents, round(coalesce(v_job.total_amount, 0) * 100)::integer, 0),
      0
    );

    insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
    values (
      p_org_id,
      v_invoice_id,
      coalesce(nullif(trim(v_job.title), ''), 'Job service'),
      1,
      v_subtotal,
      v_subtotal
    );
  end if;

  perform public.recalculate_invoice_totals(v_invoice_id);

  if p_send_now then
    update public.invoices
       set status = 'sent',
           issued_at = coalesce(issued_at, now()),
           due_date = coalesce(due_date, v_due_date),
           updated_at = now()
     where id = v_invoice_id;
  end if;

  select status into v_invoice_status from public.invoices where id = v_invoice_id;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'invoice.created_from_job', jsonb_build_object(
      'job_id', p_job_id,
      'invoice_id', v_invoice_id,
      'send_now', p_send_now
    );
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'already_exists', false,
    'status', coalesce(v_invoice_status, case when p_send_now then 'sent' else 'draft' end)
  );
exception
  when unique_violation then
    select i.id, i.status
      into v_existing
    from public.invoices i
    where i.org_id = p_org_id
      and i.job_id = p_job_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'already_exists', true,
        'status', v_existing.status
      );
    end if;

    raise;
end;
$fn$;

revoke all on function public.create_invoice_from_job(uuid, uuid, boolean) from public;
grant execute on function public.create_invoice_from_job(uuid, uuid, boolean) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260305164000_pipeline_leads_jobs_fixes.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- Role helpers
-- -------------------------------------------------------------------
create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

-- -------------------------------------------------------------------
-- Leads schema hardening (soft delete + stage split)
-- -------------------------------------------------------------------
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid;
alter table public.leads add column if not exists stage text;

alter table public.leads alter column org_id set default public.current_org_id();
alter table public.leads alter column created_by set default auth.uid();

update public.leads
set stage = case lower(coalesce(stage, status, 'new'))
  when 'new' then 'new'
  when 'qualified' then 'qualified'
  when 'contacted' then 'quote_sent'
  when 'quote_sent' then 'quote_sent'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'lost' then 'lost'
  else 'new'
end
where stage is null
   or lower(stage) not in ('new', 'qualified', 'quote_sent', 'closed', 'lost');

alter table public.leads alter column stage set default 'new';

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads
  add constraint leads_stage_check
  check (stage in ('new', 'qualified', 'quote_sent', 'closed', 'lost'));

create index if not exists leads_org_deleted_idx on public.leads(org_id, deleted_at);

-- -------------------------------------------------------------------
-- Jobs status normalization (separate from pipeline stage)
-- -------------------------------------------------------------------
alter table public.jobs alter column status set default 'draft';

update public.jobs
set status = case lower(coalesce(status, 'draft'))
  when 'scheduled' then 'scheduled'
  when 'in_progress' then 'in_progress'
  when 'completed' then 'completed'
  when 'cancelled' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'closed' then 'completed'
  when 'lost' then 'cancelled'
  when 'qualified' then 'draft'
  when 'quote_sent' then 'draft'
  when 'new' then 'draft'
  when 'unscheduled' then 'draft'
  when 'late' then 'scheduled'
  when 'action_required' then 'draft'
  when 'requires_invoicing' then 'completed'
  else 'draft'
end
where lower(coalesce(status, 'draft')) not in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
   or lower(coalesce(status, 'draft')) in ('canceled', 'closed', 'lost', 'qualified', 'quote_sent', 'new', 'unscheduled', 'late', 'action_required', 'requires_invoicing');

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

create index if not exists idx_jobs_org_deleted_at on public.jobs(org_id, deleted_at);

-- -------------------------------------------------------------------
-- Leads RLS (strict org scoped, owner/admin writes)
-- -------------------------------------------------------------------
alter table public.leads enable row level security;

drop policy if exists leads_select_org on public.leads;
drop policy if exists leads_insert_org on public.leads;
drop policy if exists leads_update_org on public.leads;
drop policy if exists leads_delete_org on public.leads;
drop policy if exists leads_insert_org_scope on public.leads;

create policy leads_select_org on public.leads
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy leads_insert_org on public.leads
for insert to authenticated
with check (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
  and created_by = auth.uid()
);

create policy leads_update_org on public.leads
for update to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
)
with check (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

create policy leads_delete_org on public.leads
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

-- -------------------------------------------------------------------
-- Pipeline soft-delete metadata + RPC soft_delete_lead
-- -------------------------------------------------------------------
alter table public.pipeline_deals add column if not exists deleted_at timestamptz;
alter table public.pipeline_deals add column if not exists deleted_by uuid;

create index if not exists idx_pipeline_deals_org_deleted_idx on public.pipeline_deals(org_id, deleted_at);

create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_leads integer := 0;
  v_deals integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete leads' using errcode = '42501';
  end if;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_leads = row_count;

  if v_leads = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deals = row_count;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'lead.soft_deleted', jsonb_build_object(
      'lead_id', p_lead_id,
      'leads', v_leads,
      'deals', v_deals
    );
  end if;

  return jsonb_build_object('lead', v_leads, 'deals', v_deals);
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;

-- -------------------------------------------------------------------
-- Ensure job creation RPCs always emit valid job statuses
-- -------------------------------------------------------------------
create or replace function public.create_minimal_job_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_client_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sql text;
  v_job_id uuid;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='org_id') then
    cols := cols || 'org_id';
    vals := vals || quote_literal(p_org_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='created_by') then
    cols := cols || 'created_by';
    vals := vals || quote_literal(p_created_by::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='client_id') then
    cols := cols || 'client_id';
    vals := vals || quote_literal(p_client_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='title') then
    cols := cols || 'title';
    vals := vals || quote_literal(coalesce(nullif(trim(p_title), ''), 'New Deal Job'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='property_address') then
    cols := cols || 'property_address';
    vals := vals || quote_literal('-');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='status') then
    cols := cols || 'status';
    vals := vals || quote_literal('draft');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='total_cents') then
    cols := cols || 'total_cents';
    vals := vals || '0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='total_amount') then
    cols := cols || 'total_amount';
    vals := vals || '0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='currency') then
    cols := cols || 'currency';
    vals := vals || quote_literal('CAD');
  end if;

  sql := format(
    'insert into public.jobs (%s) values (%s) returning id',
    array_to_string(cols, ','),
    array_to_string(vals, ',')
  );
  execute sql into v_job_id;
  return v_job_id;
end;
$fn$;

create or replace function public.rpc_create_job_with_optional_schedule(
  p_lead_id uuid default null,
  p_client_id uuid default null,
  p_team_id uuid default null,
  p_title text default null,
  p_job_number text default null,
  p_job_type text default null,
  p_status text default null,
  p_address text default null,
  p_notes text default null,
  p_scheduled_at timestamptz default null,
  p_end_at timestamptz default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := public.current_org_id();
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_event_id uuid;
  v_existing_job uuid;
  v_status text;
begin
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  if p_lead_id is not null then
    select id into v_existing_job
    from public.jobs
    where org_id = v_org_id
      and lead_id = p_lead_id
      and deleted_at is null
      and lower(coalesce(status, 'draft')) not in ('canceled', 'cancelled', 'completed', 'done')
    limit 1;

    if v_existing_job is not null then
      return jsonb_build_object('job_id', v_existing_job, 'event_id', null, 'existing', true);
    end if;
  end if;

  v_status := case
    when lower(coalesce(trim(p_status), '')) in ('scheduled') then 'scheduled'
    when lower(coalesce(trim(p_status), '')) in ('in_progress', 'in progress') then 'in_progress'
    when lower(coalesce(trim(p_status), '')) in ('completed', 'closed', 'done') then 'completed'
    when lower(coalesce(trim(p_status), '')) in ('cancelled', 'canceled', 'lost') then 'cancelled'
    when lower(coalesce(trim(p_status), '')) in ('draft', 'unscheduled', 'late', 'action_required', 'requires_invoicing', 'qualified', 'quote_sent', 'new') then 'draft'
    when p_scheduled_at is null then 'draft'
    else 'scheduled'
  end;

  insert into public.jobs (
    org_id, created_by, lead_id, client_id, team_id, title, job_number, job_type,
    status, property_address, notes, scheduled_at, end_at
  )
  values (
    v_org_id,
    coalesce(v_user_id, gen_random_uuid()),
    p_lead_id,
    p_client_id,
    p_team_id,
    coalesce(nullif(trim(p_title), ''), 'New job'),
    nullif(trim(p_job_number), ''),
    nullif(trim(p_job_type), ''),
    v_status,
    nullif(trim(p_address), ''),
    nullif(trim(p_notes), ''),
    p_scheduled_at,
    p_end_at
  )
  returning id into v_job_id;

  if p_scheduled_at is not null then
    insert into public.schedule_events (
      org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes
    )
    values (
      v_org_id,
      coalesce(v_user_id, gen_random_uuid()),
      v_job_id,
      p_team_id,
      p_scheduled_at,
      coalesce(p_end_at, p_scheduled_at + interval '1 hour'),
      coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
      'scheduled',
      nullif(trim(p_notes), '')
    )
    returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'job_id', v_job_id,
    'event_id', v_event_id,
    'existing', false
  );
end;
$fn$;

create or replace function public.rpc_unschedule_job(
  p_job_id uuid,
  p_event_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_event_id is not null then
    update public.schedule_events
    set deleted_at = now(),
        updated_at = now()
    where id = p_event_id
      and job_id = p_job_id
      and deleted_at is null;
  else
    update public.schedule_events
    set deleted_at = now(),
        updated_at = now()
    where job_id = p_job_id
      and deleted_at is null;
  end if;

  update public.jobs
  set status = 'draft',
      scheduled_at = null,
      end_at = null,
      updated_at = now()
  where id = p_job_id
    and deleted_at is null;
end;
$fn$;

revoke all on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) from public;
revoke all on function public.rpc_create_job_with_optional_schedule(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text) from public;
revoke all on function public.rpc_unschedule_job(uuid, uuid) from public;

grant execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_create_job_with_optional_schedule(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.rpc_unschedule_job(uuid, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260305190000_pipeline_full_automation.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Leads columns + stage model
-- ------------------------------------------------------------------
alter table public.leads add column if not exists stage text;
alter table public.leads add column if not exists lost_at timestamptz;
alter table public.leads add column if not exists closed_at timestamptz;
alter table public.leads add column if not exists converted_job_id uuid;
alter table public.leads add column if not exists converted_at timestamptz;
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid;

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads
  add constraint leads_stage_check
  check (stage in ('qualified', 'quote_sent', 'contacted', 'closed', 'lost'));

update public.leads
set stage = case lower(coalesce(stage, status, 'qualified'))
  when 'new' then 'qualified'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'lost' then 'lost'
  else 'qualified'
end
where stage is null
   or lower(coalesce(stage, '')) not in ('qualified', 'quote_sent', 'contacted', 'closed', 'lost');

update public.leads
set lost_at = coalesce(lost_at, now())
where stage = 'lost' and lost_at is null;

update public.leads
set closed_at = coalesce(closed_at, now())
where stage = 'closed' and closed_at is null;

create index if not exists leads_org_deleted_idx on public.leads(org_id, deleted_at);
create index if not exists leads_org_stage_idx on public.leads(org_id, stage);
create index if not exists leads_org_lost_at_idx on public.leads(org_id, lost_at) where deleted_at is null;
create index if not exists leads_org_converted_job_idx on public.leads(org_id, converted_job_id);

-- ------------------------------------------------------------------
-- Jobs columns + status normalization
-- ------------------------------------------------------------------
alter table public.jobs add column if not exists deleted_at timestamptz;
alter table public.jobs add column if not exists deleted_by uuid;
alter table public.jobs add column if not exists completed_at timestamptz;

update public.jobs
set status = case lower(coalesce(status, 'draft'))
  when 'scheduled' then 'scheduled'
  when 'in_progress' then 'in_progress'
  when 'completed' then 'completed'
  when 'cancelled' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'closed' then 'completed'
  when 'lost' then 'cancelled'
  when 'qualified' then 'draft'
  when 'quote_sent' then 'draft'
  when 'new' then 'draft'
  when 'unscheduled' then 'draft'
  when 'late' then 'scheduled'
  when 'action_required' then 'draft'
  when 'requires_invoicing' then 'completed'
  else 'draft'
end
where lower(coalesce(status, 'draft')) not in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
   or lower(coalesce(status, 'draft')) in ('canceled', 'closed', 'lost', 'qualified', 'quote_sent', 'new', 'unscheduled', 'late', 'action_required', 'requires_invoicing');

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

create index if not exists idx_jobs_org_deleted_at on public.jobs(org_id, deleted_at);
create index if not exists idx_jobs_org_status on public.jobs(org_id, status);

-- ------------------------------------------------------------------
-- Invoices idempotency by job
-- ------------------------------------------------------------------
alter table public.invoices add column if not exists job_id uuid;
alter table public.invoices drop constraint if exists invoices_job_id_fkey;
alter table public.invoices
  add constraint invoices_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

create unique index if not exists uq_invoices_org_job_active
  on public.invoices(org_id, job_id)
  where deleted_at is null and job_id is not null;

-- ------------------------------------------------------------------
-- Notifications table (for payment success)
-- ------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  type text not null,
  ref_id uuid null,
  title text not null,
  body text null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.notifications add column if not exists deleted_at timestamptz null;

create index if not exists idx_notifications_org_created on public.notifications(org_id, created_at desc);
create index if not exists idx_notifications_org_unread on public.notifications(org_id, read_at) where deleted_at is null;

alter table public.notifications enable row level security;
drop policy if exists notifications_select_org on public.notifications;
drop policy if exists notifications_insert_org on public.notifications;
drop policy if exists notifications_update_org on public.notifications;

create policy notifications_select_org on public.notifications
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy notifications_insert_org on public.notifications
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id));

create policy notifications_update_org on public.notifications
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

-- Add to realtime publication if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- Keep lead.stage in sync with pipeline moves
-- ------------------------------------------------------------------
create or replace function public.sync_lead_stage_from_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stage text;
begin
  if new.lead_id is null then
    return new;
  end if;

  v_stage := case lower(coalesce(new.stage, 'qualified'))
    when 'qualified' then 'qualified'
    when 'quote sent' then 'quote_sent'
    when 'contact' then 'contacted'
    when 'closed' then 'closed'
    when 'lost' then 'lost'
    else 'qualified'
  end;

  update public.leads
  set stage = v_stage,
      lost_at = case when v_stage = 'lost' then coalesce(lost_at, now()) else null end,
      closed_at = case when v_stage = 'closed' then coalesce(closed_at, now()) else null end,
      updated_at = now()
  where id = new.lead_id
    and org_id = new.org_id
    and deleted_at is null;

  return new;
end;
$fn$;

drop trigger if exists trg_pipeline_deals_sync_lead_stage on public.pipeline_deals;
create trigger trg_pipeline_deals_sync_lead_stage
after insert or update of stage on public.pipeline_deals
for each row execute function public.sync_lead_stage_from_deal();

-- ------------------------------------------------------------------
-- RPC: soft_delete_lead
-- ------------------------------------------------------------------
create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead_count integer := 0;
  v_deal_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete leads' using errcode = '42501';
  end if;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_lead_count = row_count;

  if v_lead_count = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deal_count = row_count;

  return jsonb_build_object('lead', v_lead_count, 'deals', v_deal_count);
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- RPC: soft_delete_client_conditional
-- ------------------------------------------------------------------
create or replace function public.soft_delete_client_conditional(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_client integer := 0;
  v_leads integer := 0;
  v_jobs_deleted integer := 0;
  v_jobs_kept integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client = row_count;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where org_id = p_org_id
    and converted_to_client_id = p_client_id
    and coalesce(converted_job_id::text, '') = ''
    and deleted_at is null;
  get diagnostics v_leads = row_count;

  update public.jobs
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and lower(coalesce(status, 'draft')) not in ('scheduled', 'in_progress', 'completed')
    and deleted_at is null;
  get diagnostics v_jobs_deleted = row_count;

  select count(*)::integer into v_jobs_kept
  from public.jobs
  where org_id = p_org_id
    and client_id = p_client_id
    and lower(coalesce(status, 'draft')) in ('scheduled', 'in_progress', 'completed')
    and deleted_at is null;

  return jsonb_build_object(
    'client', v_client,
    'leads_deleted', v_leads,
    'jobs_deleted', v_jobs_deleted,
    'jobs_kept', v_jobs_kept
  );
end;
$fn$;

revoke all on function public.soft_delete_client_conditional(uuid, uuid) from public;
grant execute on function public.soft_delete_client_conditional(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- RPC: create_job_from_lead
-- ------------------------------------------------------------------
create or replace function public.create_job_from_lead(
  p_org_id uuid,
  p_lead_id uuid,
  p_title text default null,
  p_address text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_team_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead record;
  v_job jsonb;
  v_job_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can create jobs from leads' using errcode = '42501';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null
  limit 1;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  select public.rpc_create_job_with_optional_schedule(
    p_lead_id := p_lead_id,
    p_client_id := coalesce(v_lead.converted_to_client_id, null),
    p_team_id := p_team_id,
    p_title := coalesce(nullif(trim(p_title), ''), concat_ws(' ', coalesce(v_lead.first_name,''), coalesce(v_lead.last_name,''))),
    p_address := coalesce(nullif(trim(p_address), ''), nullif(trim(v_lead.address), ''), '-'),
    p_status := case when p_start_at is null then 'draft' else 'scheduled' end,
    p_scheduled_at := p_start_at,
    p_end_at := p_end_at
  ) into v_job;

  v_job_id := (v_job->>'job_id')::uuid;

  update public.leads
  set converted_job_id = v_job_id,
      converted_at = now(),
      stage = 'closed',
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'event_id', v_job->>'event_id'
  );
end;
$fn$;

revoke all on function public.create_job_from_lead(uuid, uuid, text, text, timestamptz, timestamptz, uuid) from public;
grant execute on function public.create_job_from_lead(uuid, uuid, text, text, timestamptz, timestamptz, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Wrapper RPC: create_invoice_from_job(org, job)
-- ------------------------------------------------------------------
create or replace function public.create_invoice_from_job(p_org_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return public.create_invoice_from_job(p_org_id, p_job_id, false);
end;
$fn$;

revoke all on function public.create_invoice_from_job(uuid, uuid) from public;
grant execute on function public.create_invoice_from_job(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Lost cleanup after 10 days
-- ------------------------------------------------------------------
create or replace function public.cleanup_lost_leads_10d()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer := 0;
begin
  update public.leads
  set deleted_at = now(),
      updated_at = now()
  where stage = 'lost'
    and deleted_at is null
    and coalesce(converted_job_id::text, '') = ''
    and lost_at is not null
    and lost_at <= now() - interval '10 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.cleanup_lost_leads_10d() from public;
grant execute on function public.cleanup_lost_leads_10d() to authenticated, service_role;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_lost_leads_10d_daily') THEN
      PERFORM cron.unschedule('cleanup_lost_leads_10d_daily');
    END IF;

    PERFORM cron.schedule(
      'cleanup_lost_leads_10d_daily',
      '0 3 * * *',
      'select public.cleanup_lost_leads_10d();'
    );
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END;
$outer$;

commit;




-- ============================================================
-- MIGRATION: 20260305195500_hard_delete_client_and_jobs_status_guard.sql
-- ============================================================

begin;

create or replace function public.hard_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client integer := 0;
  v_jobs integer := 0;
  v_leads integer := 0;
  v_invoices integer := 0;
  v_invoice_items integer := 0;
  v_notes integer := 0;
  v_has_leads_client_id boolean := false;
  v_protected_jobs integer := 0;
  v_protected_invoices integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  select count(*)::int
  into v_protected_jobs
  from public.jobs j
  where j.org_id = p_org_id
    and j.client_id = p_client_id
    and j.deleted_at is null
    and lower(coalesce(j.status, 'draft')) in ('scheduled', 'in_progress', 'completed');

  if to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        select count(*)::int
        from public.invoices i
        where i.org_id = $1
          and i.client_id = $2
          and i.deleted_at is null
          and lower(coalesce(i.status, 'draft')) in ('paid', 'sent')
      $sql$
      into v_protected_invoices
      using p_org_id, p_client_id;
    exception when others then
      v_protected_invoices := 0;
    end;
  end if;

  if v_protected_jobs > 0 or v_protected_invoices > 0 then
    raise exception 'Cannot delete: linked scheduled/completed jobs or paid invoices. Use archive instead.'
      using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'client_id'
  ) into v_has_leads_client_id;

  if to_regclass('public.invoice_items') is not null and to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        delete from public.invoice_items ii
        using public.invoices i
        where ii.invoice_id = i.id
          and i.org_id = $1
          and i.client_id = $2
          and i.deleted_at is null
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_invoice_items = row_count;
    exception when others then
      v_invoice_items := 0;
    end;
  end if;

  if to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        delete from public.invoices
        where org_id = $1
          and client_id = $2
          and deleted_at is null
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_invoices = row_count;
    exception when others then
      v_invoices := 0;
    end;
  end if;

  delete from public.jobs
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null
    and lower(coalesce(status, 'draft')) not in ('scheduled', 'in_progress', 'completed');
  get diagnostics v_jobs = row_count;

  if v_has_leads_client_id then
    delete from public.leads
    where org_id = p_org_id
      and deleted_at is null
      and (
        client_id = p_client_id
        or converted_to_client_id = p_client_id
      );
  else
    delete from public.leads
    where org_id = p_org_id
      and deleted_at is null
      and converted_to_client_id = p_client_id;
  end if;
  get diagnostics v_leads = row_count;

  if to_regclass('public.notes') is not null then
    begin
      execute $sql$
        delete from public.notes
        where org_id = $1
          and client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_notes = row_count;
    exception when others then
      v_notes := 0;
    end;
  end if;

  delete from public.clients
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client = row_count;

  if v_client = 0 then
    raise exception 'Client not found or already deleted.' using errcode = 'P0002';
  end if;

  if to_regclass('public.audit_events') is not null then
    begin
      execute
        'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
         values ($1, $2, $3, $4::jsonb, now())'
      using p_org_id, v_uid, 'client.hard_deleted',
        jsonb_build_object(
          'client_id', p_client_id,
          'client', v_client,
          'jobs', v_jobs,
          'leads', v_leads,
          'invoices', v_invoices,
          'invoice_items', v_invoice_items,
          'notes', v_notes
        );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', v_leads,
    'invoices', v_invoices,
    'invoice_items', v_invoice_items,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.hard_delete_client(uuid, uuid) from public;
grant execute on function public.hard_delete_client(uuid, uuid) to authenticated, service_role;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

commit;


-- ============================================================
-- MIGRATION: 20260305200000_jobs_rls_owner_admin_writes.sql
-- ============================================================

begin;

drop policy if exists jobs_select_org on public.jobs;
create policy jobs_select_org
on public.jobs
for select
to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists jobs_insert_org on public.jobs;
create policy jobs_insert_org
on public.jobs
for insert
to authenticated
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists jobs_update_org on public.jobs;
create policy jobs_update_org
on public.jobs
for update
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id))
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists jobs_delete_org on public.jobs;
create policy jobs_delete_org
on public.jobs
for delete
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id));

commit;


-- ============================================================
-- MIGRATION: 20260305213000_fix_lead_delete_and_client_soft_cascade.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1) Lead stage/status normalization to prevent delete-time check errors
-- ------------------------------------------------------------------
alter table if exists public.leads
  add column if not exists stage text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table if exists public.leads
  alter column stage set default 'qualified';

update public.leads
set stage = case lower(coalesce(stage, status, 'qualified'))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'quote sent' then 'quote_sent'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'lost' then 'lost'
  else 'qualified'
end
where stage is null
   or lower(coalesce(stage, '')) not in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost');

alter table if exists public.leads drop constraint if exists leads_stage_check;
alter table if exists public.leads
  add constraint leads_stage_check
  check (stage in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost'));

-- Keep legacy status coherent for UI/read models that still consume it.
update public.leads
set status = case lower(coalesce(status, ''))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'proposal' then 'contacted'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  else coalesce(nullif(lower(status), ''), 'qualified')
end
where lower(coalesce(status, '')) in ('new', 'lead', 'proposal', 'negotiation', 'won')
   or coalesce(status, '') = '';

-- ------------------------------------------------------------------
-- 2) RLS hardening for destructive actions (owner/admin only)
-- ------------------------------------------------------------------
create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

alter table if exists public.leads enable row level security;
alter table if exists public.clients enable row level security;
alter table if exists public.jobs enable row level security;

drop policy if exists leads_delete_org on public.leads;
create policy leads_delete_org on public.leads
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

drop policy if exists clients_delete_org on public.clients;
create policy clients_delete_org on public.clients
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

drop policy if exists jobs_delete_org on public.jobs;
create policy jobs_delete_org on public.jobs
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

-- ------------------------------------------------------------------
-- 3) One-time backfill to stable FK (jobs.client_id -> clients.id)
--    No runtime email/name matching in app code.
-- ------------------------------------------------------------------
alter table if exists public.jobs add column if not exists client_id uuid;
create index if not exists idx_jobs_org_client_id on public.jobs(org_id, client_id);

create table if not exists public.client_link_backfill_ambiguous (
  id bigserial primary key,
  org_id uuid not null,
  job_id uuid not null,
  reason text not null,
  client_name text null,
  client_email text null,
  candidate_client_ids jsonb not null,
  created_at timestamptz not null default now()
);

-- Prefer deterministic links already present via lead conversion.
update public.jobs j
set client_id = l.converted_to_client_id
from public.leads l
where j.client_id is null
  and j.lead_id is not null
  and l.id = j.lead_id
  and l.org_id = j.org_id
  and l.converted_to_client_id is not null;

-- Optional email backfill if jobs.client_email exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'client_email'
  ) then
    execute $sql$
      with ranked as (
        select
          j.id as job_id,
          j.org_id,
          c.id as client_id,
          count(*) over (partition by j.id) as match_count
        from public.jobs j
        join public.clients c
          on c.org_id = j.org_id
         and c.deleted_at is null
         and lower(coalesce(c.email, '')) = lower(coalesce(j.client_email, ''))
        where j.client_id is null
          and coalesce(j.client_email, '') <> ''
      )
      update public.jobs j
      set client_id = r.client_id
      from ranked r
      where j.id = r.job_id
        and r.match_count = 1
    $sql$;

    execute $sql$
      insert into public.client_link_backfill_ambiguous(org_id, job_id, reason, client_email, candidate_client_ids)
      select
        r.org_id,
        r.job_id,
        'email_ambiguous',
        j.client_email,
        jsonb_agg(r.client_id)
      from (
        select
          j.id as job_id,
          j.org_id,
          c.id as client_id,
          count(*) over (partition by j.id) as match_count
        from public.jobs j
        join public.clients c
          on c.org_id = j.org_id
         and c.deleted_at is null
         and lower(coalesce(c.email, '')) = lower(coalesce(j.client_email, ''))
        where j.client_id is null
          and coalesce(j.client_email, '') <> ''
      ) r
      join public.jobs j on j.id = r.job_id
      where r.match_count > 1
      group by r.org_id, r.job_id, j.client_email
    $sql$;
  end if;
end $$;

-- Fallback: exact normalized full-name match only when unique.
with client_names as (
  select
    c.id,
    c.org_id,
    lower(regexp_replace(trim(concat_ws(' ', coalesce(c.first_name, ''), coalesce(c.last_name, ''))), '\\s+', ' ', 'g')) as normalized_name
  from public.clients c
  where c.deleted_at is null
),
job_names as (
  select
    j.id as job_id,
    j.org_id,
    lower(regexp_replace(trim(coalesce(j.client_name, '')), '\\s+', ' ', 'g')) as normalized_name
  from public.jobs j
  where j.client_id is null
    and coalesce(j.client_name, '') <> ''
),
ranked as (
  select
    j.job_id,
    j.org_id,
    c.id as client_id,
    count(*) over (partition by j.job_id) as match_count
  from job_names j
  join client_names c
    on c.org_id = j.org_id
   and c.normalized_name = j.normalized_name
)
update public.jobs j
set client_id = r.client_id
from ranked r
where j.id = r.job_id
  and r.match_count = 1;

insert into public.client_link_backfill_ambiguous(org_id, job_id, reason, client_name, candidate_client_ids)
select
  r.org_id,
  r.job_id,
  'name_ambiguous',
  j.client_name,
  jsonb_agg(r.client_id)
from (
  with client_names as (
    select
      c.id,
      c.org_id,
      lower(regexp_replace(trim(concat_ws(' ', coalesce(c.first_name, ''), coalesce(c.last_name, ''))), '\\s+', ' ', 'g')) as normalized_name
    from public.clients c
    where c.deleted_at is null
  ),
  job_names as (
    select
      j.id as job_id,
      j.org_id,
      lower(regexp_replace(trim(coalesce(j.client_name, '')), '\\s+', ' ', 'g')) as normalized_name
    from public.jobs j
    where j.client_id is null
      and coalesce(j.client_name, '') <> ''
  )
  select
    j.job_id,
    j.org_id,
    c.id as client_id,
    count(*) over (partition by j.job_id) as match_count
  from job_names j
  join client_names c
    on c.org_id = j.org_id
   and c.normalized_name = j.normalized_name
) r
join public.jobs j on j.id = r.job_id
where r.match_count > 1
group by r.org_id, r.job_id, j.client_name;

-- Enforce FK after backfill.
alter table if exists public.jobs drop constraint if exists jobs_client_id_fkey;
alter table if exists public.jobs
  add constraint jobs_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

-- ------------------------------------------------------------------
-- 4) Fix lead delete RPC (500 root cause mitigation + clear errors)
-- ------------------------------------------------------------------
create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead_count integer := 0;
  v_deal_count integer := 0;
  v_intent_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete leads' using errcode = '42501';
  end if;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      stage = case lower(coalesce(stage, status, 'qualified'))
        when 'new' then 'qualified'
        when 'lead' then 'qualified'
        when 'proposal' then 'quote_sent'
        when 'negotiation' then 'contacted'
        when 'won' then 'closed'
        else lower(coalesce(stage, 'qualified'))
      end,
      status = case lower(coalesce(status, 'qualified'))
        when 'new' then 'qualified'
        when 'lead' then 'qualified'
        when 'proposal' then 'contacted'
        when 'negotiation' then 'contacted'
        when 'won' then 'closed'
        else lower(coalesce(status, 'qualified'))
      end,
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_lead_count = row_count;

  if v_lead_count = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deal_count = row_count;

  if to_regclass('public.job_intents') is not null then
    update public.job_intents
    set deleted_at = now(),
        updated_at = now()
    where org_id = p_org_id
      and lead_id = p_lead_id
      and deleted_at is null;
    get diagnostics v_intent_count = row_count;
  end if;

  return jsonb_build_object(
    'lead', v_lead_count,
    'deals', v_deal_count,
    'job_intents', v_intent_count
  );
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 5) Default client cascade strategy: soft_delete_client RPC
-- ------------------------------------------------------------------
create or replace function public.soft_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_client_count integer := 0;
  v_jobs_count integer := 0;
  v_leads_count integer := 0;
  v_pipeline_count integer := 0;
  v_generic_count integer := 0;
  v_table record;
  v_has_deleted_by boolean;
  v_has_updated_at boolean;
  v_sql text;
  v_rowcount integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client_count = row_count;

  if v_client_count = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  update public.jobs
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_jobs_count = row_count;

  update public.leads
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and converted_to_client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_leads_count = row_count;

  if to_regclass('public.pipeline_deals') is not null then
    update public.pipeline_deals
    set deleted_at = now(),
        deleted_by = coalesce(deleted_by, v_uid),
        updated_at = now()
    where org_id = p_org_id
      and client_id = p_client_id
      and deleted_at is null;
    get diagnostics v_pipeline_count = row_count;
  end if;

  -- Generic sweep for any org-scoped table that uses (client_id, deleted_at).
  for v_table in
    select t.table_name
    from information_schema.tables t
    join information_schema.columns c1 on c1.table_schema = t.table_schema and c1.table_name = t.table_name and c1.column_name = 'org_id'
    join information_schema.columns c2 on c2.table_schema = t.table_schema and c2.table_name = t.table_name and c2.column_name = 'client_id'
    join information_schema.columns c3 on c3.table_schema = t.table_schema and c3.table_name = t.table_name and c3.column_name = 'deleted_at'
    where t.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and t.table_name not in ('clients', 'jobs', 'leads', 'pipeline_deals', 'audit_events', 'client_link_backfill_ambiguous')
  loop
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table.table_name and column_name = 'deleted_by'
    ) into v_has_deleted_by;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table.table_name and column_name = 'updated_at'
    ) into v_has_updated_at;

    v_sql := format('update public.%I set deleted_at = now()', v_table.table_name);

    if v_has_deleted_by then
      v_sql := v_sql || ', deleted_by = coalesce(deleted_by, $1)';
    end if;
    if v_has_updated_at then
      v_sql := v_sql || ', updated_at = now()';
    end if;

    v_sql := v_sql || ' where org_id = $2 and client_id = $3 and deleted_at is null';

    execute v_sql using v_uid, p_org_id, p_client_id;
    get diagnostics v_rowcount = row_count;
    v_generic_count := v_generic_count + coalesce(v_rowcount, 0);
  end loop;

  return jsonb_build_object(
    'client', v_client_count,
    'jobs', v_jobs_count,
    'leads', v_leads_count,
    'pipeline_deals', v_pipeline_count,
    'other_rows', v_generic_count
  );
end;
$fn$;

revoke all on function public.soft_delete_client(uuid, uuid) from public;
grant execute on function public.soft_delete_client(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 6) Keep lead creation aligned with the normalized stage model
-- ------------------------------------------------------------------
create or replace function public.create_lead_and_deal(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_title text default null,
  p_value numeric default 0,
  p_notes text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''), 'Lead');
  v_contact_id uuid;
  v_lead_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  insert into public.contacts (org_id, full_name, email, phone)
  values (v_org_id, nullif(trim(p_full_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
  returning id into v_contact_id;

  insert into public.leads (
    org_id, created_by, first_name, last_name, email, phone, status, stage, contact_id
  )
  values (
    v_org_id,
    v_created_by,
    v_first_name,
    v_last_name,
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), ''),
    'qualified',
    'qualified',
    v_contact_id
  )
  returning id into v_lead_id;

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id,
    v_created_by,
    null,
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id,
    v_created_by,
    v_lead_id,
    null,
    v_job_id,
    'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'lead_id', v_lead_id,
    'job_id', v_job_id
  );
end;
$fn$;

revoke all on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 7) Optional hard-delete variant (explicitly opt-in)
-- ------------------------------------------------------------------
-- If you need hard cascades instead of soft delete, apply manually:
-- alter table public.jobs drop constraint if exists jobs_client_id_fkey;
-- alter table public.jobs add constraint jobs_client_id_fkey
--   foreign key (client_id) references public.clients(id) on delete cascade;
-- alter table public.invoices drop constraint if exists invoices_client_id_fkey;
-- alter table public.invoices add constraint invoices_client_id_fkey
--   foreign key (client_id) references public.clients(id) on delete cascade;

commit;


-- ============================================================
-- MIGRATION: 20260305230000_schema_coherence_cleanup.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1) Core helpers
-- ------------------------------------------------------------------
create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 2) Drop duplicate FKs (keep one canonical FK per relation)
-- ------------------------------------------------------------------
alter table if exists public.clients drop constraint if exists clients_org_fk;
alter table if exists public.jobs drop constraint if exists jobs_client_fk;
alter table if exists public.payment_provider_secrets drop constraint if exists payment_provider_secrets_org_fk;
alter table if exists public.payment_provider_settings drop constraint if exists payment_provider_settings_org_fk;

-- ------------------------------------------------------------------
-- 3) Leads normalization (status/stage + authorship coherence)
-- ------------------------------------------------------------------
alter table if exists public.leads
  add column if not exists stage text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists address text,
  add column if not exists client_id uuid;

alter table if exists public.leads drop constraint if exists leads_status_check;
alter table if exists public.leads drop constraint if exists leads_stage_check;

alter table if exists public.leads alter column status set default 'qualified';
alter table if exists public.leads alter column stage set default 'qualified';

update public.leads
set status = case lower(coalesce(status, ''))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'lost' then 'lost'
  else 'qualified'
end
where status is null
   or lower(coalesce(status, '')) not in (
     'new', 'lead', 'proposal', 'negotiation', 'won', 'closed',
     'qualified', 'contacted', 'quote_sent', 'lost'
   );

update public.leads
set stage = case lower(coalesce(stage, status, 'qualified'))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'lost' then 'lost'
  else 'qualified'
end
where stage is null
   or lower(coalesce(stage, '')) not in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost');

update public.leads
set created_by = coalesce(created_by, user_id, auth.uid()),
    user_id = coalesce(user_id, created_by, auth.uid())
where created_by is null or user_id is null;

alter table if exists public.leads
  add constraint leads_status_check
  check (lower(status) in (
    'new', 'lead', 'proposal', 'negotiation', 'won', 'closed',
    'qualified', 'contacted', 'quote_sent', 'lost'
  ));

alter table if exists public.leads
  add constraint leads_stage_check
  check (stage in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost'));

create index if not exists idx_leads_org_deleted_at on public.leads(org_id, deleted_at);
create index if not exists idx_leads_org_stage on public.leads(org_id, stage);
create index if not exists idx_leads_org_client_id on public.leads(org_id, client_id);

-- ------------------------------------------------------------------
-- 4) Jobs coherence (make client_id nullable for lead-first workflow)
-- ------------------------------------------------------------------
alter table if exists public.jobs
  alter column client_id drop not null;

alter table if exists public.jobs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists completed_at timestamptz;

update public.jobs
set status = case lower(coalesce(status, 'draft'))
  when 'scheduled' then 'scheduled'
  when 'in_progress' then 'in_progress'
  when 'in progress' then 'in_progress'
  when 'completed' then 'completed'
  when 'closed' then 'completed'
  when 'done' then 'completed'
  when 'cancelled' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'lost' then 'cancelled'
  when 'new' then 'draft'
  when 'unscheduled' then 'draft'
  when 'late' then 'scheduled'
  when 'action_required' then 'draft'
  when 'requires_invoicing' then 'completed'
  else 'draft'
end
where lower(coalesce(status, 'draft')) not in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
   or lower(coalesce(status, 'draft')) in ('in progress', 'closed', 'done', 'canceled', 'lost', 'new', 'unscheduled', 'late', 'action_required', 'requires_invoicing');

alter table if exists public.jobs drop constraint if exists jobs_status_check;
alter table if exists public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

create index if not exists idx_jobs_org_deleted_at on public.jobs(org_id, deleted_at);
create index if not exists idx_jobs_org_client_id on public.jobs(org_id, client_id);
create index if not exists idx_jobs_org_lead_id on public.jobs(org_id, lead_id);

-- ------------------------------------------------------------------
-- 5) Pipeline deals coherence
-- ------------------------------------------------------------------
alter table if exists public.pipeline_deals
  alter column stage_id drop not null;

alter table if exists public.pipeline_deals
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists value numeric not null default 0;

update public.pipeline_deals
set stage = case
  when stage is null then 'Qualified'
  when stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then stage
  else 'Qualified'
end
where stage is null or stage not in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost');

alter table if exists public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table if exists public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost'));

-- Keep value and value_cents coherent where both exist.
create or replace function public.pipeline_deals_sync_values()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if to_jsonb(new) ? 'value' and to_jsonb(new) ? 'value_cents' then
    if new.value is null and new.value_cents is not null then
      new.value := new.value_cents::numeric / 100;
    elsif new.value_cents is null and new.value is not null then
      new.value_cents := round(new.value * 100)::integer;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pipeline_deals_sync_values on public.pipeline_deals;
create trigger trg_pipeline_deals_sync_values
before insert or update on public.pipeline_deals
for each row execute function public.pipeline_deals_sync_values();

create index if not exists idx_pipeline_deals_org_deleted_at on public.pipeline_deals(org_id, deleted_at);
create index if not exists idx_pipeline_deals_org_client_id on public.pipeline_deals(org_id, client_id);
create index if not exists idx_pipeline_deals_org_lead_id on public.pipeline_deals(org_id, lead_id);

-- ------------------------------------------------------------------
-- 6) job_intents soft-delete support (used by delete RPC)
-- ------------------------------------------------------------------
alter table if exists public.job_intents
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

create index if not exists idx_job_intents_org_deleted on public.job_intents(org_id, deleted_at);

-- ------------------------------------------------------------------
-- 7) tasks org-scoped (multi-tenant safety)
-- ------------------------------------------------------------------
alter table if exists public.tasks add column if not exists org_id uuid;
update public.tasks t
set org_id = l.org_id
from public.leads l
where t.org_id is null
  and t.lead_id = l.id;

update public.tasks
set org_id = public.current_org_id()
where org_id is null;

alter table if exists public.tasks alter column org_id set default public.current_org_id();
alter table if exists public.tasks alter column org_id set not null;

alter table if exists public.tasks drop constraint if exists tasks_org_id_fkey;
alter table if exists public.tasks
  add constraint tasks_org_id_fkey
  foreign key (org_id) references public.orgs(id);

alter table if exists public.tasks enable row level security;
drop policy if exists tasks_select_org on public.tasks;
drop policy if exists tasks_insert_org on public.tasks;
drop policy if exists tasks_update_org on public.tasks;
drop policy if exists tasks_delete_org on public.tasks;

create policy tasks_select_org on public.tasks
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy tasks_insert_org on public.tasks
for insert to authenticated
with check (
  public.has_org_membership(auth.uid(), org_id)
  and coalesce(user_id, auth.uid()) = auth.uid()
);

create policy tasks_update_org on public.tasks
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy tasks_delete_org on public.tasks
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

create index if not exists idx_tasks_org_due_date on public.tasks(org_id, due_date);
create index if not exists idx_tasks_org_deleted on public.tasks(org_id, completed);

-- ------------------------------------------------------------------
-- 8) schedule_events time columns sync (start_time/end_time + start_at/end_at)
-- ------------------------------------------------------------------
create or replace function public.schedule_events_sync_time_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.start_at is null and new.start_time is not null then
    new.start_at := new.start_time;
  end if;
  if new.end_at is null and new.end_time is not null then
    new.end_at := new.end_time;
  end if;
  if new.start_time is null and new.start_at is not null then
    new.start_time := new.start_at;
  end if;
  if new.end_time is null and new.end_at is not null then
    new.end_time := new.end_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_schedule_events_sync_time_columns on public.schedule_events;
create trigger trg_schedule_events_sync_time_columns
before insert or update on public.schedule_events
for each row execute function public.schedule_events_sync_time_columns();

-- ------------------------------------------------------------------
-- 9) Backfill stable FK: jobs.client_id from deterministic references
-- ------------------------------------------------------------------
create table if not exists public.client_link_backfill_ambiguous (
  id bigserial primary key,
  org_id uuid not null,
  job_id uuid not null,
  reason text not null,
  client_name text null,
  client_email text null,
  candidate_client_ids jsonb not null,
  created_at timestamptz not null default now()
);

update public.jobs j
set client_id = l.converted_to_client_id
from public.leads l
where j.client_id is null
  and j.lead_id is not null
  and l.id = j.lead_id
  and l.org_id = j.org_id
  and l.converted_to_client_id is not null;

-- Optional email-based deterministic backfill if jobs.client_email exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'client_email'
  ) then
    execute $sql$
      with ranked as (
        select
          j.id as job_id,
          j.org_id,
          c.id as client_id,
          count(*) over (partition by j.id) as match_count
        from public.jobs j
        join public.clients c
          on c.org_id = j.org_id
         and c.deleted_at is null
         and lower(coalesce(c.email, '')) = lower(coalesce(j.client_email, ''))
        where j.client_id is null
          and coalesce(j.client_email, '') <> ''
      )
      update public.jobs j
      set client_id = r.client_id
      from ranked r
      where j.id = r.job_id
        and r.match_count = 1
    $sql$;
  end if;
end $$;

-- Name fallback only when exact and unique within org.
with client_names as (
  select
    c.id,
    c.org_id,
    lower(regexp_replace(trim(concat_ws(' ', coalesce(c.first_name, ''), coalesce(c.last_name, ''))), '\s+', ' ', 'g')) as normalized_name
  from public.clients c
  where c.deleted_at is null
),
job_names as (
  select
    j.id as job_id,
    j.org_id,
    lower(regexp_replace(trim(coalesce(j.client_name, '')), '\s+', ' ', 'g')) as normalized_name
  from public.jobs j
  where j.client_id is null
    and coalesce(j.client_name, '') <> ''
),
ranked as (
  select
    j.job_id,
    j.org_id,
    c.id as client_id,
    count(*) over (partition by j.job_id) as match_count
  from job_names j
  join client_names c
    on c.org_id = j.org_id
   and c.normalized_name = j.normalized_name
)
update public.jobs j
set client_id = r.client_id
from ranked r
where j.id = r.job_id
  and r.match_count = 1;

-- ------------------------------------------------------------------
-- 10) Canonical RPCs: remove overload ambiguity and unsafe dynamic SQL
-- ------------------------------------------------------------------
drop function if exists public.create_lead_and_deal(text, text, text, text, numeric, text, uuid);
drop function if exists public.create_lead_and_deal(text, text, text, text, text, numeric, text, uuid);

drop function if exists public.create_minimal_job_for_deal(uuid, uuid, uuid, text);
create or replace function public.create_minimal_job_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_client_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job_id uuid;
begin
  insert into public.jobs (
    org_id,
    created_by,
    client_id,
    title,
    property_address,
    status
  )
  values (
    p_org_id,
    coalesce(p_created_by, auth.uid()),
    p_client_id,
    coalesce(nullif(trim(p_title), ''), 'New Deal Job'),
    '-',
    'draft'
  )
  returning id into v_job_id;

  return v_job_id;
end;
$fn$;

create or replace function public.create_lead_and_deal(
  p_full_name text,
  p_email text default null,
  p_address text default null,
  p_phone text default null,
  p_title text default null,
  p_value numeric default 0,
  p_notes text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(
    nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''),
    'Lead'
  );
  v_contact_id uuid;
  v_lead_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  if v_org_id is null then
    raise exception 'No organization context' using errcode = '42501';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.has_org_membership(auth.uid(), v_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(auth.uid(), v_org_id) then
    raise exception 'Only owner/admin can create leads' using errcode = '42501';
  end if;

  insert into public.contacts (org_id, full_name, email, phone)
  values (
    v_org_id,
    nullif(trim(p_full_name), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), '')
  )
  returning id into v_contact_id;

  insert into public.leads (
    org_id, created_by, user_id, first_name, last_name, email, address, phone, status, stage, contact_id
  )
  values (
    v_org_id,
    v_created_by,
    v_created_by,
    v_first_name,
    v_last_name,
    nullif(trim(p_email), ''),
    nullif(trim(p_address), ''),
    nullif(trim(p_phone), ''),
    'qualified',
    'qualified',
    v_contact_id
  )
  returning id into v_lead_id;

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id,
    v_created_by,
    null,
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id,
    v_created_by,
    v_lead_id,
    null,
    v_job_id,
    'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'lead_id', v_lead_id,
    'job_id', v_job_id
  );
end;
$fn$;

revoke all on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) from public;
grant execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) to authenticated, service_role;
revoke all on function public.create_lead_and_deal(text, text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_lead_and_deal(text, text, text, text, text, numeric, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 11) Canonical delete RPCs
-- ------------------------------------------------------------------
create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead_count integer := 0;
  v_deal_count integer := 0;
  v_intent_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete leads' using errcode = '42501';
  end if;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_lead_count = row_count;

  if v_lead_count = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deal_count = row_count;

  update public.job_intents
  set deleted_at = now(),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_intent_count = row_count;

  return jsonb_build_object('lead', v_lead_count, 'deals', v_deal_count, 'job_intents', v_intent_count);
end;
$fn$;

create or replace function public.soft_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_client_count integer := 0;
  v_jobs_count integer := 0;
  v_leads_count integer := 0;
  v_deals_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client_count = row_count;

  if v_client_count = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  update public.jobs
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_jobs_count = row_count;

  update public.leads
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and (converted_to_client_id = p_client_id or client_id = p_client_id)
    and deleted_at is null;
  get diagnostics v_leads_count = row_count;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_deals_count = row_count;

  return jsonb_build_object('client', v_client_count, 'jobs', v_jobs_count, 'leads', v_leads_count, 'pipeline_deals', v_deals_count);
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
revoke all on function public.soft_delete_client(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.soft_delete_client(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 12) Active views normalized for UI queries
-- ------------------------------------------------------------------
create or replace view public.leads_active as
select * from public.leads where deleted_at is null;

create or replace view public.clients_active as
select * from public.clients where deleted_at is null;

create or replace view public.jobs_active as
select * from public.jobs where deleted_at is null;

commit;


-- ============================================================
-- MIGRATION: 20260305231500_add_jobs_billing_split.sql
-- ============================================================

alter table if exists public.jobs
  add column if not exists billing_split boolean not null default false;


-- ============================================================
-- MIGRATION: 20260305233000_finish_job_membership_access.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

drop function if exists public.finish_job_and_prepare_invoice(uuid, uuid);

create or replace function public.finish_job_and_prepare_invoice(
  p_org_id uuid,
  p_job_id uuid
)
returns table (
  ok boolean,
  invoice_id uuid,
  already_exists boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_payload jsonb := '{}'::jsonb;
  v_invoice_id uuid;
  v_already_exists boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;

  -- Allow every CRM member in org to finish jobs.
  if not public.has_org_membership(v_uid, v_org_id) then
    raise exception 'Forbidden for this organization.' using errcode = '42501';
  end if;

  perform 1
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = v_org_id
    and j.deleted_at is null
  for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  update public.jobs
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = p_job_id
    and org_id = v_org_id
    and deleted_at is null;

  if to_regprocedure('public.create_invoice_from_job(uuid,uuid,boolean)') is not null then
    execute 'select public.create_invoice_from_job($1,$2,$3)'
      into v_payload
      using v_org_id, p_job_id, false;
  elsif to_regprocedure('public.create_invoice_from_job(uuid,uuid)') is not null then
    execute 'select public.create_invoice_from_job($1,$2)'
      into v_payload
      using v_org_id, p_job_id;
  end if;

  begin
    v_invoice_id := nullif(v_payload->>'invoice_id', '')::uuid;
  exception when others then
    v_invoice_id := null;
  end;

  if v_invoice_id is null then
    select i.id
      into v_invoice_id
    from public.invoices i
    where i.org_id = v_org_id
      and i.job_id = p_job_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    v_already_exists := v_invoice_id is not null;
  else
    v_already_exists := coalesce((v_payload->>'already_exists')::boolean, false);
  end if;

  if v_invoice_id is null then
    raise exception 'Unable to prepare invoice from job.' using errcode = 'P0001';
  end if;

  return query
  select true, v_invoice_id, v_already_exists;
end;
$fn$;

revoke all on function public.finish_job_and_prepare_invoice(uuid, uuid) from public;
grant execute on function public.finish_job_and_prepare_invoice(uuid, uuid) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260305235500_clients_delete_pipeline_slots.sql
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid null,
  action text not null,
  entity_type text not null,
  entity_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_org_created_at on public.audit_events(org_id, created_at desc);
create index if not exists idx_audit_events_entity on public.audit_events(entity_type, entity_id);

alter table if exists public.clients
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

-- Keep duplicate emails allowed, but indexed for deterministic replace.
drop index if exists public.clients_email_key;
drop index if exists public.clients_org_id_email_key;
drop index if exists public.clients_org_email_unique;
create index if not exists idx_clients_org_lower_email_active
  on public.clients(org_id, lower(email))
  where email is not null and deleted_at is null;

create or replace function public.create_client_with_duplicate_handling(
  p_org_id uuid,
  p_mode text,
  p_payload jsonb,
  p_merge_duplicates boolean default true
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := lower(coalesce(trim(p_mode), 'add'));
  v_first_name text := nullif(trim(coalesce(p_payload->>'first_name', '')), '');
  v_last_name text := nullif(trim(coalesce(p_payload->>'last_name', '')), '');
  v_company text := nullif(trim(coalesce(p_payload->>'company', '')), '');
  v_email text := nullif(trim(coalesce(p_payload->>'email', '')), '');
  v_phone text := nullif(trim(coalesce(p_payload->>'phone', '')), '');
  v_address text := nullif(trim(coalesce(p_payload->>'address', '')), '');
  v_status text := coalesce(nullif(trim(p_payload->>'status'), ''), 'active');
  v_primary public.clients%rowtype;
  v_dup record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if v_first_name is null then
    v_first_name := 'Unknown';
  end if;
  if v_last_name is null then
    v_last_name := 'Client';
  end if;

  if v_mode not in ('add', 'replace') then
    raise exception 'Invalid mode: %', v_mode using errcode = '22023';
  end if;

  if v_mode = 'add' then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  if v_email is null then
    raise exception 'replace mode requires email' using errcode = '22023';
  end if;

  select * into v_primary
  from public.clients c
  where c.org_id = p_org_id
    and c.deleted_at is null
    and lower(coalesce(c.email, '')) = lower(v_email)
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_primary.id is null then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  update public.clients
  set
    first_name = v_first_name,
    last_name = v_last_name,
    company = v_company,
    email = v_email,
    phone = v_phone,
    address = v_address,
    status = v_status,
    updated_at = now()
  where id = v_primary.id
  returning * into v_primary;

  if p_merge_duplicates then
    for v_dup in
      select c.id
      from public.clients c
      where c.org_id = p_org_id
        and c.deleted_at is null
        and lower(coalesce(c.email, '')) = lower(v_email)
        and c.id <> v_primary.id
      order by c.created_at asc, c.id asc
    loop
      update public.jobs
      set client_id = v_primary.id, updated_at = now()
      where org_id = p_org_id and client_id = v_dup.id;

      if to_regclass('public.invoices') is not null then
        begin
          execute 'update public.invoices set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      if to_regclass('public.payments') is not null then
        begin
          execute 'update public.payments set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      update public.pipeline_deals
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set converted_to_client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and converted_to_client_id = v_dup.id;

      delete from public.clients
      where org_id = p_org_id
        and id = v_dup.id;
    end loop;
  end if;

  return v_primary;
end;
$$;

revoke all on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) from public;
grant execute on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) to authenticated, service_role;

create or replace function public.delete_client_cascade(
  p_org_id uuid,
  p_client_id uuid,
  p_deleted_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_deleted_by, auth.uid());
  v_client int := 0;
  v_jobs int := 0;
  v_leads int := 0;
  v_pipeline_deals int := 0;
  v_invoices int := 0;
  v_invoice_items int := 0;
  v_payments int := 0;
  v_schedule_events int := 0;
  v_job_line_items int := 0;
  v_exists int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  select 1 into v_exists
  from public.clients c
  where c.id = p_client_id
    and c.org_id = p_org_id
  limit 1;

  if coalesce(v_exists, 0) = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  if to_regclass('public.invoice_items') is not null and to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        delete from public.invoice_items ii
        using public.invoices i
        where ii.invoice_id = i.id
          and i.org_id = $1
          and i.client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_invoice_items = row_count;
    exception when others then
      v_invoice_items := 0;
    end;
  end if;

  if to_regclass('public.payments') is not null then
    begin
      execute 'delete from public.payments where org_id = $1 and client_id = $2'
      using p_org_id, p_client_id;
      get diagnostics v_payments = row_count;
    exception when others then
      v_payments := 0;
    end;
  end if;

  if to_regclass('public.invoices') is not null then
    begin
      execute 'delete from public.invoices where org_id = $1 and client_id = $2'
      using p_org_id, p_client_id;
      get diagnostics v_invoices = row_count;
    exception when others then
      v_invoices := 0;
    end;
  end if;

  if to_regclass('public.schedule_events') is not null then
    begin
      execute $sql$
        delete from public.schedule_events se
        using public.jobs j
        where se.job_id = j.id
          and j.org_id = $1
          and j.client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_schedule_events = row_count;
    exception when others then
      v_schedule_events := 0;
    end;
  end if;

  if to_regclass('public.job_line_items') is not null then
    begin
      execute $sql$
        delete from public.job_line_items li
        using public.jobs j
        where li.job_id = j.id
          and j.org_id = $1
          and j.client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_job_line_items = row_count;
    exception when others then
      v_job_line_items := 0;
    end;
  end if;

  delete from public.pipeline_deals
  where org_id = p_org_id
    and client_id = p_client_id;
  get diagnostics v_pipeline_deals = row_count;

  delete from public.leads
  where org_id = p_org_id
    and (client_id = p_client_id or converted_to_client_id = p_client_id);
  get diagnostics v_leads = row_count;

  delete from public.jobs
  where org_id = p_org_id
    and client_id = p_client_id;
  get diagnostics v_jobs = row_count;

  delete from public.clients
  where id = p_client_id
    and org_id = p_org_id;
  get diagnostics v_client = row_count;

  if v_client = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_org_id,
    v_uid,
    'client.deleted',
    'client',
    p_client_id,
    jsonb_build_object(
      'client', v_client,
      'jobs', v_jobs,
      'leads', v_leads,
      'pipeline_deals', v_pipeline_deals,
      'invoices', v_invoices,
      'invoice_items', v_invoice_items,
      'payments', v_payments,
      'schedule_events', v_schedule_events,
      'job_line_items', v_job_line_items
    )
  );

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', v_leads,
    'pipeline_deals', v_pipeline_deals,
    'invoices', v_invoices,
    'invoice_items', v_invoice_items,
    'payments', v_payments,
    'schedule_events', v_schedule_events,
    'job_line_items', v_job_line_items
  );
end;
$$;

revoke all on function public.delete_client_cascade(uuid, uuid, uuid) from public;
grant execute on function public.delete_client_cascade(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.hard_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.delete_client_cascade(p_org_id, p_client_id, auth.uid());
end;
$$;

revoke all on function public.hard_delete_client(uuid, uuid) from public;
grant execute on function public.hard_delete_client(uuid, uuid) to authenticated, service_role;

create or replace function public.delete_lead_and_optional_client(
  p_org_id uuid,
  p_lead_id uuid,
  p_also_delete_client boolean default false,
  p_deleted_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_deleted_by, auth.uid());
  v_client_id uuid;
  v_lead int := 0;
  v_deals int := 0;
  v_jobs_unlinked int := 0;
  v_tasks int := 0;
  v_lead_lists int := 0;
  v_job_intents int := 0;
  v_client_deleted int := 0;
  v_client_result jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  select l.client_id
  into v_client_id
  from public.leads l
  where l.id = p_lead_id
    and l.org_id = p_org_id
  limit 1
  for update;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if to_regclass('public.tasks') is not null then
    begin
      execute 'delete from public.tasks where org_id = $1 and lead_id = $2'
      using p_org_id, p_lead_id;
      get diagnostics v_tasks = row_count;
    exception when others then
      v_tasks := 0;
    end;
  end if;

  if to_regclass('public.lead_lists') is not null then
    begin
      execute 'delete from public.lead_lists where lead_id = $1'
      using p_lead_id;
      get diagnostics v_lead_lists = row_count;
    exception when others then
      v_lead_lists := 0;
    end;
  end if;

  if to_regclass('public.job_intents') is not null then
    begin
      execute 'delete from public.job_intents where org_id = $1 and lead_id = $2'
      using p_org_id, p_lead_id;
      get diagnostics v_job_intents = row_count;
    exception when others then
      v_job_intents := 0;
    end;
  end if;

  delete from public.pipeline_deals
  where org_id = p_org_id
    and lead_id = p_lead_id;
  get diagnostics v_deals = row_count;

  update public.jobs
  set lead_id = null,
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id;
  get diagnostics v_jobs_unlinked = row_count;

  delete from public.leads
  where id = p_lead_id
    and org_id = p_org_id;
  get diagnostics v_lead = row_count;

  if v_lead = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if p_also_delete_client and v_client_id is not null then
    v_client_result := public.delete_client_cascade(p_org_id, v_client_id, v_uid);
    v_client_deleted := coalesce((v_client_result->>'client')::int, 0);
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_org_id,
    v_uid,
    'lead.deleted',
    'lead',
    p_lead_id,
    jsonb_build_object(
      'lead', v_lead,
      'deals', v_deals,
      'jobs_unlinked', v_jobs_unlinked,
      'tasks', v_tasks,
      'lead_lists', v_lead_lists,
      'job_intents', v_job_intents,
      'client_deleted', v_client_deleted
    )
  );

  return jsonb_build_object(
    'lead', v_lead,
    'deals', v_deals,
    'jobs_unlinked', v_jobs_unlinked,
    'tasks', v_tasks,
    'lead_lists', v_lead_lists,
    'job_intents', v_job_intents,
    'client_deleted', v_client_deleted
  );
end;
$$;

revoke all on function public.delete_lead_and_optional_client(uuid, uuid, boolean, uuid) from public;
grant execute on function public.delete_lead_and_optional_client(uuid, uuid, boolean, uuid) to authenticated, service_role;

create table if not exists public.availabilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  team_id uuid null references public.teams(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute int not null check (start_minute >= 0 and start_minute < 1440),
  end_minute int not null check (end_minute > start_minute and end_minute <= 1440),
  timezone text not null default 'America/Toronto',
  is_active boolean not null default true,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_availabilities_org_team_weekday
  on public.availabilities(org_id, team_id, weekday)
  where is_active = true;

alter table public.availabilities enable row level security;

drop policy if exists availabilities_select_org on public.availabilities;
drop policy if exists availabilities_insert_org on public.availabilities;
drop policy if exists availabilities_update_org on public.availabilities;
drop policy if exists availabilities_delete_org on public.availabilities;

create policy availabilities_select_org on public.availabilities
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy availabilities_insert_org on public.availabilities
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id));

create policy availabilities_update_org on public.availabilities
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy availabilities_delete_org on public.availabilities
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create or replace function public.get_available_slots(
  p_org_id uuid,
  p_team_id uuid default null,
  p_start_date date default current_date,
  p_days int default 14,
  p_slot_minutes int default 30,
  p_timezone text default 'America/Toronto'
)
returns table(slot_start timestamptz, slot_end timestamptz, team_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_days int := greatest(1, least(coalesce(p_days, 14), 31));
  v_slot int := greatest(15, least(coalesce(p_slot_minutes, 30), 180));
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'America/Toronto');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  return query
  with days as (
    select (p_start_date + g.d)::date as day_local
    from generate_series(0, v_days - 1) as g(d)
  ),
  windows as (
    select
      d.day_local,
      a.team_id,
      a.start_minute,
      a.end_minute
    from days d
    join public.availabilities a
      on a.org_id = p_org_id
     and a.is_active = true
     and a.weekday = extract(dow from d.day_local)::int
     and (
       (p_team_id is not null and (a.team_id = p_team_id or a.team_id is null))
       or (p_team_id is null and a.team_id is null)
     )
  ),
  slots as (
    select
      ((w.day_local::timestamp + make_interval(mins => m.minute_val)) at time zone v_tz) as slot_start,
      ((w.day_local::timestamp + make_interval(mins => m.minute_val + v_slot)) at time zone v_tz) as slot_end,
      w.team_id
    from windows w
    cross join lateral generate_series(w.start_minute, w.end_minute - v_slot, v_slot) as m(minute_val)
  )
  select s.slot_start, s.slot_end, s.team_id
  from slots s
  where not exists (
    select 1
    from public.schedule_events se
    left join public.jobs j on j.id = se.job_id
    where se.org_id = p_org_id
      and se.deleted_at is null
      and coalesce(se.start_at, se.start_time) < s.slot_end
      and coalesce(se.end_at, se.end_time) > s.slot_start
      and (
        p_team_id is null
        or coalesce(se.team_id, j.team_id) = p_team_id
      )
  )
  order by s.slot_start asc;
end;
$$;

revoke all on function public.get_available_slots(uuid, uuid, date, int, int, text) from public;
grant execute on function public.get_available_slots(uuid, uuid, date, int, int, text) to authenticated, service_role;

commit;


-- ============================================================
-- MIGRATION: 20260305240000_missing_tables_and_fixes.sql
-- ============================================================

-- Migration: 20260305240000_missing_tables_and_fixes.sql
-- Adds profiles, invoice_templates, org_billing_settings + RLS + triggers

BEGIN;

-- ============================================================
-- 1. profiles table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    text,
  avatar_url   text,
  company_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_select_own') THEN
    CREATE POLICY profiles_select_own ON public.profiles FOR SELECT
      USING (
        id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.memberships m1
          JOIN public.memberships m2 ON m1.org_id = m2.org_id
          WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_update_own') THEN
    CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE
      USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_insert_own') THEN
    CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT
      WITH CHECK (id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill existing users
INSERT INTO public.profiles (id, full_name, avatar_url)
SELECT u.id,
       COALESCE(u.raw_user_meta_data ->> 'full_name', ''),
       COALESCE(u.raw_user_meta_data ->> 'avatar_url', '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. invoice_templates table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL DEFAULT public.current_org_id(),
  name       text NOT NULL,
  content    jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_select_org') THEN
    CREATE POLICY invoice_templates_select_org ON public.invoice_templates FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_insert_org') THEN
    CREATE POLICY invoice_templates_insert_org ON public.invoice_templates FOR INSERT
      WITH CHECK (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_update_org') THEN
    CREATE POLICY invoice_templates_update_org ON public.invoice_templates FOR UPDATE
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_templates' AND policyname='invoice_templates_delete_org') THEN
    CREATE POLICY invoice_templates_delete_org ON public.invoice_templates FOR DELETE
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_templates_set_updated_at ON public.invoice_templates;
CREATE TRIGGER trg_invoice_templates_set_updated_at
  BEFORE UPDATE ON public.invoice_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. org_billing_settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_billing_settings (
  org_id       uuid PRIMARY KEY,
  company_name text,
  address      text,
  email        text,
  phone        text,
  logo_url     text,
  tax_number   text,
  footer_note  text,
  currency     text NOT NULL DEFAULT 'CAD',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_billing_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_billing_settings' AND policyname='org_billing_settings_select_org') THEN
    CREATE POLICY org_billing_settings_select_org ON public.org_billing_settings FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_billing_settings' AND policyname='org_billing_settings_insert_admin') THEN
    CREATE POLICY org_billing_settings_insert_admin ON public.org_billing_settings FOR INSERT
      WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_billing_settings' AND policyname='org_billing_settings_update_admin') THEN
    CREATE POLICY org_billing_settings_update_admin ON public.org_billing_settings FOR UPDATE
      USING (public.has_org_admin_role(auth.uid(), org_id));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_org_billing_settings_set_updated_at ON public.org_billing_settings;
CREATE TRIGGER trg_org_billing_settings_set_updated_at
  BEFORE UPDATE ON public.org_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. Ensure schedule_events has all required columns
-- ============================================================
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS start_at   timestamptz;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS end_at     timestamptz;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS timezone   text;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS team_id    uuid;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS status     text;
ALTER TABLE public.schedule_events ADD COLUMN IF NOT EXISTS notes      text;

UPDATE public.schedule_events
SET start_at = COALESCE(start_at, start_time),
    end_at   = COALESCE(end_at, end_time)
WHERE start_at IS NULL OR end_at IS NULL;

UPDATE public.schedule_events
SET timezone = 'America/Montreal'
WHERE timezone IS NULL OR timezone = '';

-- ============================================================
-- 5. Ensure jobs has subtotal/tax/total columns for billing
-- ============================================================
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS subtotal  numeric(12,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_total numeric(12,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS total     numeric(12,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 6. Ensure invoices has currency column
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'currency'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN currency text NOT NULL DEFAULT 'CAD';
  END IF;
END $$;

-- ============================================================
-- 7. Ensure audit_events has event_type column + RLS
-- ============================================================
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_events_select_org') THEN
    CREATE POLICY audit_events_select_org ON public.audit_events FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_events_insert_org') THEN
    CREATE POLICY audit_events_insert_org ON public.audit_events FOR INSERT
      WITH CHECK (public.has_org_membership(auth.uid(), org_id));
  END IF;
END $$;

COMMIT;


-- ============================================================
-- MIGRATION: 20260306100000_team_availability.sql
-- ============================================================

-- Team availability: defines working hours per team per weekday
CREATE TABLE IF NOT EXISTS team_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  start_minute int NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute int NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  timezone text NOT NULL DEFAULT 'America/Toronto',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_time_range CHECK (end_minute > start_minute),
  UNIQUE(team_id, weekday, start_minute)
);

-- RLS
ALTER TABLE team_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_availability_org_read" ON team_availability
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "team_availability_org_write" ON team_availability
  FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
  );

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_team_availability_team_weekday
  ON team_availability(team_id, weekday) WHERE deleted_at IS NULL;

-- View for active availability
CREATE OR REPLACE VIEW team_availability_active AS
  SELECT * FROM team_availability WHERE deleted_at IS NULL;

-- Batch archive clients RPC
CREATE OR REPLACE FUNCTION batch_soft_delete_clients(
  p_org_id uuid,
  p_client_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_now timestamptz := now();
BEGIN
  UPDATE clients
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = ANY(p_client_ids)
    AND org_id = p_org_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also soft-delete related jobs
  UPDATE jobs
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = ANY(p_client_ids)
    AND org_id = p_org_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object('archived_clients', v_count);
END;
$$;

-- Auto-convert lead to deal+job RPC
CREATE OR REPLACE FUNCTION auto_convert_lead_to_deal_and_job(
  p_lead_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead record;
  v_org_id uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
  v_full_name text;
BEGIN
  -- Get lead
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  v_org_id := v_lead.org_id;
  v_full_name := COALESCE(NULLIF(trim(v_lead.first_name || ' ' || v_lead.last_name), ''), 'Unknown');

  -- Create or find client
  SELECT id INTO v_client_id
  FROM clients
  WHERE org_id = v_org_id
    AND email = v_lead.email
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO clients (org_id, first_name, last_name, email, phone, address, status)
    VALUES (v_org_id, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone, v_lead.address, 'active')
    RETURNING id INTO v_client_id;
  END IF;

  -- Create job
  INSERT INTO jobs (
    org_id, lead_id, client_id, client_name, title,
    property_address, status, total_amount, total_cents, currency
  )
  VALUES (
    v_org_id, p_lead_id, v_client_id, v_full_name,
    COALESCE(v_lead.title, v_lead.company, 'Job for ' || v_full_name),
    COALESCE(v_lead.address, '-'), 'draft',
    COALESCE(v_lead.value, 0), COALESCE(v_lead.value, 0) * 100, 'CAD'
  )
  RETURNING id INTO v_job_id;

  -- Create pipeline deal
  INSERT INTO pipeline_deals (org_id, lead_id, client_id, job_id, title, value, stage)
  VALUES (
    v_org_id, p_lead_id, v_client_id, v_job_id,
    COALESCE(v_lead.title, v_lead.company, 'Deal for ' || v_full_name),
    COALESCE(v_lead.value, 0), 'Qualified'
  )
  RETURNING id INTO v_deal_id;

  -- Mark lead as converted
  UPDATE leads
  SET converted_to_client_id = v_client_id,
      converted_at = now(),
      status = 'won',
      updated_at = now()
  WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'client_id', v_client_id,
    'job_id', v_job_id,
    'deal_id', v_deal_id,
    'lead_id', p_lead_id
  );
END;
$$;

