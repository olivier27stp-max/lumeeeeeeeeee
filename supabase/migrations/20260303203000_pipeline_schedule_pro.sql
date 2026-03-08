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
  p_team_id uuid default null,
  p_start_at timestamptz,
  p_end_at timestamptz,
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

revoke all on function public.rpc_schedule_job(uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.rpc_schedule_job(uuid, uuid, timestamptz, timestamptz, text) to authenticated, service_role;

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
