-- ============================================================================
-- Jobs can have MULTIPLE visits (schedule_events)
-- ----------------------------------------------------------------------------
-- Previously a job could only have ONE active schedule_event, enforced by a
-- unique partial index + an UPSERT inside rpc_schedule_job. The business needs
-- a job to hold several visits (e.g. estimate visit, execution, follow-up), and
-- each visit must stay assigned to its job (schedule_events.job_id is NOT NULL).
--
-- This migration:
--   1. Drops the one-active-visit-per-job unique index.
--   2. Adds recompute_job_schedule(job): keeps jobs.scheduled_at / end_at /
--      status mirroring the NEXT UPCOMING active visit (else the latest past
--      one). Terminal statuses (completed/cancelled/...) are preserved.
--   3. Adds rpc_add_visit(): always INSERTS an extra visit on a job.
--   4. rpc_schedule_job(): still upserts the FIRST visit, but is a no-op on the
--      events when the job already has >= 2 active visits — so saving a job from
--      the job form never clobbers/moves its visits. Always recomputes.
--   5. rpc_reschedule_event(): recomputes scheduled_at from the visit set
--      instead of blindly copying the moved event's date onto the job.
--   6. rpc_unschedule_job(): per-event soft-delete now recomputes (the job is
--      only reset to draft when its LAST visit is removed).
--
-- The calendar already renders schedule_events only, so multiple visits show as
-- multiple calendar entries automatically. Idempotent / safe to re-run.
-- ============================================================================

begin;

-- 1. Allow multiple active visits per job ------------------------------------
drop index if exists public.idx_schedule_events_unique_active_job;

-- 2. Keep jobs.scheduled_at in sync with the visit set -----------------------
create or replace function public.recompute_job_schedule(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job public.jobs%rowtype;
  v_ev  public.schedule_events%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    return;
  end if;

  -- Next upcoming active visit; if none upcoming, the most recent past one.
  select * into v_ev
  from public.schedule_events
  where job_id = p_job_id
    and deleted_at is null
  order by (start_at >= now()) desc,
           case when start_at >= now() then start_at end asc,
           start_at desc
  limit 1;

  if v_ev.id is not null then
    update public.jobs
    set scheduled_at = v_ev.start_at,
        end_at       = v_ev.end_at,
        status       = case when v_job.status in ('draft', 'Draft') then 'scheduled' else v_job.status end,
        updated_at   = now()
    where id = p_job_id;
  else
    update public.jobs
    set scheduled_at = null,
        end_at       = null,
        status       = case when v_job.status = 'scheduled' then 'draft' else v_job.status end,
        updated_at   = now()
    where id = p_job_id;
  end if;
end;
$fn$;

revoke all on function public.recompute_job_schedule(uuid) from public;
grant execute on function public.recompute_job_schedule(uuid) to authenticated, service_role;

-- 3. Add an extra visit to a job (always inserts) ----------------------------
create or replace function public.rpc_add_visit(
  p_job_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_team_id uuid default null,
  p_timezone text default 'America/Montreal',
  p_notes text default null
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
  v_overlaps integer := 0;
  v_team_for_overlap uuid;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null for update;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;
  if not public.has_org_membership(auth.uid(), v_job.org_id) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_team_id is not null then
    select * into v_team from public.teams
    where id = p_team_id and org_id = v_job.org_id and deleted_at is null limit 1;
    if v_team.id is null then
      raise exception 'Team not found in organization';
    end if;
  end if;

  insert into public.schedule_events (
    org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes
  ) values (
    v_job.org_id,
    coalesce(auth.uid(), v_job.created_by),
    v_job.id,
    coalesce(p_team_id, v_job.team_id),
    p_start_at,
    p_end_at,
    coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
    'scheduled',
    coalesce(p_notes, v_job.notes)
  )
  returning * into v_event;

  perform public.recompute_job_schedule(v_job.id);

  v_team_for_overlap := coalesce(v_event.team_id, '00000000-0000-0000-0000-000000000000'::uuid);
  select count(*) into v_overlaps
  from public.schedule_events se
  where se.id <> v_event.id
    and se.deleted_at is null
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', v_overlaps);
end;
$fn$;

revoke all on function public.rpc_add_visit(uuid, timestamptz, timestamptz, uuid, text, text) from public;
grant execute on function public.rpc_add_visit(uuid, timestamptz, timestamptz, uuid, text, text) to authenticated, service_role;

-- 4. First-visit scheduling — safe when the job already has multiple visits ---
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
  v_active_count integer := 0;
  v_overlaps integer := 0;
  v_team_for_overlap uuid;
  v_updated boolean := false;
begin
  if p_end_at <= p_start_at then
    raise exception 'end_at must be after start_at';
  end if;

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null for update;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;
  if not public.has_org_membership(auth.uid(), v_job.org_id) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_team_id is not null then
    select * into v_team from public.teams
    where id = p_team_id and org_id = v_job.org_id and deleted_at is null limit 1;
    if v_team.id is null then
      raise exception 'Team not found in organization';
    end if;
  end if;

  select count(*) into v_active_count
  from public.schedule_events
  where job_id = v_job.id and deleted_at is null;

  -- Job already has multiple visits: never move them from a job-level save.
  -- Only keep jobs.scheduled_at in sync with the existing visit set.
  if v_active_count >= 2 then
    perform public.recompute_job_schedule(v_job.id);
    select * into v_event
    from public.schedule_events
    where job_id = v_job.id and deleted_at is null
    order by (start_at >= now()) desc,
             case when start_at >= now() then start_at end asc,
             start_at desc
    limit 1;
    return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', 0, 'updated', true);
  end if;

  select * into v_existing_event
  from public.schedule_events
  where job_id = v_job.id and deleted_at is null
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
    v_updated := true;
  else
    insert into public.schedule_events (
      org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes
    ) values (
      v_job.org_id, coalesce(auth.uid(), v_job.created_by), v_job.id,
      coalesce(p_team_id, v_job.team_id), p_start_at, p_end_at,
      coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'), 'scheduled', v_job.notes
    )
    returning * into v_event;
  end if;

  -- Keep the job's team in sync with its single visit.
  update public.jobs
  set team_id = coalesce(p_team_id, team_id),
      updated_at = now()
  where id = v_job.id;

  perform public.recompute_job_schedule(v_job.id);

  v_team_for_overlap := coalesce(v_event.team_id, v_job.team_id, '00000000-0000-0000-0000-000000000000'::uuid);
  select count(*) into v_overlaps
  from public.schedule_events se
  where se.id <> v_event.id
    and se.deleted_at is null
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', v_overlaps, 'updated', v_updated);
end;
$fn$;

revoke all on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.rpc_schedule_job(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;

-- 5. Reschedule a single visit — recompute the job's date from the visit set --
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

  -- Sync the job's headline date to the next upcoming visit (not necessarily
  -- the one just moved), so jobs with several visits stay coherent.
  perform public.recompute_job_schedule(v_event.job_id);

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

revoke all on function public.rpc_reschedule_event(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.rpc_reschedule_event(uuid, timestamptz, timestamptz, uuid, text) to authenticated, service_role;

-- 6. Unschedule: per-visit soft-delete recomputes; full unschedule clears all -
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
    -- Remove just ONE visit; keep any others.
    update public.schedule_events
    set deleted_at = now(), updated_at = now()
    where id = p_event_id
      and job_id = p_job_id
      and deleted_at is null;
  else
    -- Remove ALL visits for the job.
    update public.schedule_events
    set deleted_at = now(), updated_at = now()
    where job_id = p_job_id
      and deleted_at is null;
  end if;

  -- Recompute resets the job to draft only when its last visit is gone.
  perform public.recompute_job_schedule(p_job_id);
end;
$fn$;

revoke all on function public.rpc_unschedule_job(uuid, uuid) from public;
grant execute on function public.rpc_unschedule_job(uuid, uuid) to authenticated, service_role;

commit;
