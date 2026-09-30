-- « Retirer de l'horaire » émet de nouveau « Rendez-vous annulé ».
--
-- POURQUOI
-- 20261003100000 a déplacé l'émission de `appointment.cancelled` du
-- navigateur vers la base : un trigger sur schedule_events qui surveille le
-- passage de `status` à 'cancelled'. Or la SEULE annulation offerte par
-- l'interface, « Retirer de l'horaire », passe par rpc_unschedule_job, qui
-- pose `deleted_at` sans toucher `status`. Mesuré sur staging (audit V2,
-- D-01) : 0 événement, 0 exécution. Les règles « Rendez-vous annulé »
-- publiées (No-Show Follow-Up de Coquin lavage et Vision Lavage) seraient
-- mortes au merge.
--
-- POURQUOI DANS LA FONCTION ET PAS DANS LE TRIGGER
-- Un trigger sur `deleted_at` se déclencherait aussi sur un TRANSFERT de job
-- vers un autre bureau (les visites futures de l'original y reçoivent
-- deleted_at) : le client recevrait « rendez-vous annulé » pour un simple
-- changement de bureau. On reproduit exactement l'ancien comportement du
-- navigateur (scheduleApi.unscheduleJob) : l'événement part quand UNE visite
-- précise est retirée (p_event_id fourni), et seulement si elle l'a été.
--
-- DOWN : recréer rpc_unschedule_job sans le bloc « Rendez-vous annulé »
-- (corps d'origine : supabase/baseline/01_schema.sql, rpc_unschedule_job).

create or replace function public.rpc_unschedule_job(p_job_id uuid, p_event_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs%rowtype;
  v_visite public.schedule_events%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id and deleted_at is null for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if not public.has_org_membership(auth.uid(), v_job.org_id) then raise exception 'Not allowed for this organization'; end if;

  if p_event_id is not null then
    update public.schedule_events set deleted_at = now(), updated_at = now()
    where id = p_event_id and job_id = p_job_id and deleted_at is null
    returning * into v_visite;

    -- Rendez-vous annulé : même événement que l'ancien appel du navigateur,
    -- consigné dans la MÊME transaction (rien ne se perd si le serveur tombe).
    if v_visite.id is not null then
      perform public.automation_consigner_evenement(
        v_visite.org_id, 'appointment.cancelled', 'schedule_event', v_visite.id,
        'annulation:' || txid_current()::text,
        jsonb_build_object('job_id', v_visite.job_id, 'client_id', v_job.client_id,
                           'start_time', coalesce(v_visite.start_at, v_visite.start_time),
                           'origine', 'retirer_de_l_horaire'),
        'job', v_visite.job_id);
    end if;
  else
    update public.schedule_events set deleted_at = now(), updated_at = now()
    where job_id = p_job_id and deleted_at is null;
  end if;

  perform public.recompute_job_schedule(p_job_id);
end;
$function$;
