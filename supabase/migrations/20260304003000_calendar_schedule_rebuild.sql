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
