-- ORDER_HINT: 2/2 — timestamp collision with 20260421000000_pending_consolidated.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ============================================================
-- Migration: Schedule reliability, unassigned jobs, line item selection
-- Fixes:
--   1. Unique active schedule_event per job (prevent duplicates)
--   2. Consistent soft-delete in rpc_unschedule_job
--   3. DB function to find free team slots (server-side)
--   4. Line items include/exclude support
-- ============================================================

begin;

-- ============================================================
-- 1. Unique active schedule_event per job
--    Prevents duplicate active events for the same job.
--    The frontend syncJobSchedule was sometimes creating duplicates
--    when the RPC failed and fallback kicked in.
-- ============================================================

-- First, clean up any existing duplicates (keep the most recent one)
with ranked as (
  select id,
         job_id,
         row_number() over (partition by job_id order by updated_at desc, created_at desc) as rn
  from public.schedule_events
  where deleted_at is null
)
update public.schedule_events
set deleted_at = now()
where id in (select id from ranked where rn > 1);

-- Now create the unique partial index
create unique index if not exists idx_schedule_events_unique_active_job
  on public.schedule_events (job_id)
  where deleted_at is null;

-- ============================================================
-- 2. Fix rpc_unschedule_job to use soft-delete (consistent with rest of app)
--    Old version used hard DELETE, new version sets deleted_at.
-- ============================================================

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

  -- Soft-delete schedule events (instead of hard delete)
  if p_event_id is not null then
    update public.schedule_events
    set deleted_at = now(), updated_at = now()
    where id = p_event_id
      and job_id = p_job_id
      and deleted_at is null;
  else
    update public.schedule_events
    set deleted_at = now(), updated_at = now()
    where job_id = p_job_id
      and deleted_at is null;
  end if;

  -- Reset job scheduling fields
  update public.jobs
  set status = 'draft',
      scheduled_at = null,
      end_at = null,
      updated_at = now()
  where id = p_job_id
    and deleted_at is null;
end;
$fn$;

-- ============================================================
-- 3. Server-side free slot finder
--    Returns available time slots for teams based on their
--    weekly availability rules and existing schedule_events.
-- ============================================================

create or replace function public.rpc_find_free_slots(
  p_team_id uuid default null,
  p_date    date default current_date,
  p_days    int  default 7,
  p_duration_minutes int default 60
)
returns table (
  slot_date       date,
  team_id         uuid,
  team_name       text,
  team_color      text,
  slot_start      timestamptz,
  slot_end        timestamptz,
  duration_minutes int
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid;
  v_day    date;
  v_weekday int;
  v_avail  record;
  v_slot_start timestamptz;
  v_slot_end   timestamptz;
  v_has_conflict boolean;
begin
  -- Get org context
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  -- Iterate each day in the requested range
  for v_day in select generate_series(p_date, p_date + (p_days - 1), '1 day'::interval)::date
  loop
    v_weekday := extract(dow from v_day)::int;  -- 0=Sunday, 6=Saturday

    -- For each availability rule that matches this weekday
    for v_avail in
      select ta.team_id, ta.start_minute, ta.end_minute, ta.timezone,
             t.name as tname, t.color_hex as tcolor
      from public.team_availability ta
      join public.teams t on t.id = ta.team_id and t.deleted_at is null
      where ta.deleted_at is null
        and ta.weekday = v_weekday
        and t.org_id = v_org_id
        and (p_team_id is null or ta.team_id = p_team_id)
      order by ta.team_id, ta.start_minute
    loop
      -- Generate slots within this availability window
      declare
        v_minute int := v_avail.start_minute;
      begin
        while v_minute + p_duration_minutes <= v_avail.end_minute loop
          v_slot_start := (v_day || ' 00:00:00')::timestamp at time zone coalesce(v_avail.timezone, 'America/Toronto')
                          + (v_minute * interval '1 minute');
          v_slot_end   := v_slot_start + (p_duration_minutes * interval '1 minute');

          -- Skip past slots
          if v_slot_start >= now() then
            -- Check for conflicts with existing events
            select exists(
              select 1
              from public.schedule_events se
              where se.deleted_at is null
                and se.team_id = v_avail.team_id
                and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
            ) into v_has_conflict;

            if not v_has_conflict then
              slot_date := v_day;
              team_id := v_avail.team_id;
              team_name := v_avail.tname;
              team_color := v_avail.tcolor;
              slot_start := v_slot_start;
              slot_end := v_slot_end;
              duration_minutes := p_duration_minutes;
              return next;
            end if;
          end if;

          v_minute := v_minute + 30;  -- 30-minute slot increments
        end loop;
      end;
    end loop;
  end loop;
end;
$fn$;

revoke all on function public.rpc_find_free_slots(uuid, date, int, int) from public;
grant execute on function public.rpc_find_free_slots(uuid, date, int, int) to authenticated, service_role;

-- ============================================================
-- 4. Add included column on job_line_items for selection tracking
--    Allows users to exclude line items from totals without deleting them.
-- ============================================================

alter table public.job_line_items
  add column if not exists included boolean not null default true;

comment on column public.job_line_items.included
  is 'When false, line item is excluded from totals but not deleted. Supports select/deselect UX.';

-- ============================================================
-- 5. Performance index for unscheduled jobs query
--    Optimizes the calendar sidebar listUnscheduledJobs query.
-- ============================================================

create index if not exists idx_jobs_unscheduled
  on public.jobs (org_id, created_at desc)
  where deleted_at is null
    and scheduled_at is null
    and status = 'draft';

commit;
