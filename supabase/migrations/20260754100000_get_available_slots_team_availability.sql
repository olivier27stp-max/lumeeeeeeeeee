-- get_available_slots : réécrite sur team_availability.
--
-- L'ancienne version joignait public.availabilities, table supprimée depuis —
-- chaque ouverture du sélecteur de créneaux du Pipeline plantait en 42P01
-- (toast « failedLoadSlots »). La table de disponibilité actuelle est
-- team_availability (fenêtres hebdomadaires par équipe, soft-delete).
--
-- Sémantique : p_team_id null = toutes les équipes; sinon l'équipe demandée.
-- Le fuseau de la fenêtre (team_availability.timezone) prime sur p_timezone.

create or replace function public.get_available_slots(
  p_org_id uuid,
  p_team_id uuid default null::uuid,
  p_start_date date default current_date,
  p_days integer default 14,
  p_slot_minutes integer default 30,
  p_timezone text default 'America/Toronto'::text
)
returns table(slot_start timestamp with time zone, slot_end timestamp with time zone, team_id uuid)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
      a.end_minute,
      coalesce(nullif(trim(a.timezone), ''), v_tz) as tz
    from days d
    join public.team_availability a
      on a.org_id = p_org_id
     and a.deleted_at is null
     and a.weekday = extract(dow from d.day_local)::int
     and (p_team_id is null or a.team_id = p_team_id)
  ),
  slots as (
    select
      ((w.day_local::timestamp + make_interval(mins => m.minute_val)) at time zone w.tz) as s_start,
      ((w.day_local::timestamp + make_interval(mins => m.minute_val + v_slot)) at time zone w.tz) as s_end,
      w.team_id as t_id
    from windows w
    cross join lateral generate_series(w.start_minute, w.end_minute - v_slot, v_slot) as m(minute_val)
  )
  select s.s_start, s.s_end, s.t_id
  from slots s
  where not exists (
    select 1
    from public.schedule_events se
    left join public.jobs j on j.id = se.job_id
    where se.org_id = p_org_id
      and se.deleted_at is null
      and coalesce(se.start_at, se.start_time) < s.s_end
      and coalesce(se.end_at, se.end_time) > s.s_start
      and (
        p_team_id is null
        or coalesce(se.team_id, j.team_id) = p_team_id
      )
  )
  order by s.s_start asc;
end;
$function$;
