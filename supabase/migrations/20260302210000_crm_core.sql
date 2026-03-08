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
