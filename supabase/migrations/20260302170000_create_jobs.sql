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
