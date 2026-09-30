-- Audit Agenda (2026-09-30) — replanification : trois défauts dans les RPC de l'horaire.
--
-- C3 : rpc_reschedule_event remettait TOUTE visite déplacée à « scheduled »,
--      même terminée : une visite faite et facturée redevenait « à faire ».
--      → une visite terminée, en cours ou annulée garde son statut.
-- E8 : le compte des chevauchements des visites NON ASSIGNÉES n'avait pas de
--      filtre d'entreprise (SECURITY DEFINER) : il comptait celles des autres
--      entreprises. → filtre org_id (les trois fonctions).
-- E9 : seule l'appartenance à l'entreprise était vérifiée, pas la page Rôles.
--      → il faut calendar.update OU jobs.update (mêmes clés que la route
--      POST /api/automations/events/appointment-rescheduled).
--
-- Corps repris de la version en prod (empreintes vérifiées identiques), seules
-- les lignes ci-dessus changent. CREATE OR REPLACE conserve les droits.

CREATE OR REPLACE FUNCTION public.rpc_reschedule_event(p_event_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_team_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'America/Montreal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event public.schedule_events%rowtype; v_team public.teams%rowtype;
  v_overlaps integer := 0; v_team_for_overlap uuid;
begin
  if p_end_at <= p_start_at then raise exception 'end_at must be after start_at'; end if;
  select * into v_event from public.schedule_events where id = p_event_id and deleted_at is null for update;
  if v_event.id is null then raise exception 'Schedule event not found'; end if;
  if not public.has_org_membership(auth.uid(), v_event.org_id) then raise exception 'Not allowed for this organization'; end if;
  if not (public.member_has_permission(auth.uid(), v_event.org_id, 'calendar.update') or public.member_has_permission(auth.uid(), v_event.org_id, 'jobs.update')) then raise exception 'Permission refusée : replanifier des visites (page Rôles)'; end if;
  if p_team_id is not null then
    select * into v_team from public.teams where id = p_team_id and org_id = v_event.org_id and deleted_at is null limit 1;
    if v_team.id is null then raise exception 'Team not found in organization'; end if;
  end if;

  update public.schedule_events
  set start_at = p_start_at, end_at = p_end_at, team_id = coalesce(p_team_id, team_id),
      timezone = coalesce(nullif(trim(p_timezone), ''), timezone, 'America/Montreal'),
      status = case when status in ('completed', 'in_progress', 'cancelled') then status else 'scheduled' end,
      updated_at = now()
  where id = v_event.id returning * into v_event;

  perform public.recompute_job_schedule(v_event.job_id);

  v_team_for_overlap := coalesce(v_event.team_id, '00000000-0000-0000-0000-000000000000'::uuid);
  select count(*) into v_overlaps from public.schedule_events se
  where se.id <> v_event.id and se.deleted_at is null
    and se.org_id = v_event.org_id
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', v_overlaps);
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_schedule_job(p_job_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_team_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'America/Montreal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.jobs%rowtype; v_team public.teams%rowtype; v_event public.schedule_events%rowtype;
  v_existing_event public.schedule_events%rowtype; v_active_count integer := 0;
  v_overlaps integer := 0; v_team_for_overlap uuid; v_updated boolean := false;
begin
  if p_end_at <= p_start_at then raise exception 'end_at must be after start_at'; end if;
  select * into v_job from public.jobs where id = p_job_id and deleted_at is null for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if not public.has_org_membership(auth.uid(), v_job.org_id) then raise exception 'Not allowed for this organization'; end if;
  if not (public.member_has_permission(auth.uid(), v_job.org_id, 'calendar.update') or public.member_has_permission(auth.uid(), v_job.org_id, 'jobs.update')) then raise exception 'Permission refusée : replanifier des visites (page Rôles)'; end if;
  if p_team_id is not null then
    select * into v_team from public.teams where id = p_team_id and org_id = v_job.org_id and deleted_at is null limit 1;
    if v_team.id is null then raise exception 'Team not found in organization'; end if;
  end if;

  select count(*) into v_active_count from public.schedule_events where job_id = v_job.id and deleted_at is null;

  if v_active_count >= 2 then
    perform public.recompute_job_schedule(v_job.id);
    select * into v_event from public.schedule_events
    where job_id = v_job.id and deleted_at is null
    order by (start_at >= now()) desc, case when start_at >= now() then start_at end asc, start_at desc
    limit 1;
    return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', 0, 'updated', true);
  end if;

  select * into v_existing_event from public.schedule_events
  where job_id = v_job.id and deleted_at is null order by created_at desc limit 1 for update;

  if v_existing_event.id is not null then
    update public.schedule_events
    set start_at = p_start_at, end_at = p_end_at,
        team_id = coalesce(p_team_id, team_id, v_job.team_id),
        timezone = coalesce(nullif(trim(p_timezone), ''), timezone, 'America/Montreal'),
        status = 'scheduled', notes = coalesce(notes, v_job.notes), deleted_at = null, updated_at = now()
    where id = v_existing_event.id returning * into v_event;
    v_updated := true;
  else
    insert into public.schedule_events (org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes)
    values (v_job.org_id, coalesce(auth.uid(), v_job.created_by), v_job.id, coalesce(p_team_id, v_job.team_id),
            p_start_at, p_end_at, coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'), 'scheduled', v_job.notes)
    returning * into v_event;
  end if;

  update public.jobs set team_id = coalesce(p_team_id, team_id), updated_at = now() where id = v_job.id;
  perform public.recompute_job_schedule(v_job.id);

  v_team_for_overlap := coalesce(v_event.team_id, v_job.team_id, '00000000-0000-0000-0000-000000000000'::uuid);
  select count(*) into v_overlaps from public.schedule_events se
  where se.id <> v_event.id and se.deleted_at is null
    and se.org_id = v_job.org_id
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', v_overlaps, 'updated', v_updated);
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_add_visit(p_job_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_team_id uuid DEFAULT NULL::uuid, p_timezone text DEFAULT 'America/Montreal'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.jobs%rowtype; v_team public.teams%rowtype; v_event public.schedule_events%rowtype;
  v_overlaps integer := 0; v_team_for_overlap uuid;
begin
  if p_end_at <= p_start_at then raise exception 'end_at must be after start_at'; end if;
  select * into v_job from public.jobs where id = p_job_id and deleted_at is null for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if not public.has_org_membership(auth.uid(), v_job.org_id) then raise exception 'Not allowed for this organization'; end if;
  if not (public.member_has_permission(auth.uid(), v_job.org_id, 'calendar.update') or public.member_has_permission(auth.uid(), v_job.org_id, 'jobs.update')) then raise exception 'Permission refusée : replanifier des visites (page Rôles)'; end if;
  if p_team_id is not null then
    select * into v_team from public.teams where id = p_team_id and org_id = v_job.org_id and deleted_at is null limit 1;
    if v_team.id is null then raise exception 'Team not found in organization'; end if;
  end if;

  insert into public.schedule_events (org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes)
  values (v_job.org_id, coalesce(auth.uid(), v_job.created_by), v_job.id, coalesce(p_team_id, v_job.team_id),
          p_start_at, p_end_at, coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'), 'scheduled', coalesce(p_notes, v_job.notes))
  returning * into v_event;

  perform public.recompute_job_schedule(v_job.id);

  v_team_for_overlap := coalesce(v_event.team_id, '00000000-0000-0000-0000-000000000000'::uuid);
  select count(*) into v_overlaps from public.schedule_events se
  where se.id <> v_event.id and se.deleted_at is null
    and se.org_id = v_job.org_id
    and coalesce(se.team_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_team_for_overlap
    and tstzrange(se.start_at, se.end_at, '[)') && tstzrange(v_event.start_at, v_event.end_at, '[)');

  return jsonb_build_object('event', to_jsonb(v_event), 'overlaps', v_overlaps);
end;
$function$;
