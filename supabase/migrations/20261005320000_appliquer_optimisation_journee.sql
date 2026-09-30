-- « Optimiser la journée » (audit Agenda, 2026-09-30) : appliquer une proposition
-- ACCEPTÉE, en UNE transaction, par le même service que reschedule_job
-- (rpc_reschedule_event : permission page Rôles, statut conservé, job recalculée).
--
-- p_changements : [{ "visit_id", "avant_debut", "avant_fin", "apres_debut", "apres_fin" }]
--
-- Périmée = refusée : si une seule visite n'est plus à l'heure qu'avait vue la
-- proposition (quelqu'un l'a déplacée entre-temps), RIEN n'est appliqué
-- (exception proposition_perimee, tout est annulé) — l'appelant recalcule.
--
-- Deux temps : les visites concernées sont d'abord rangées sur un créneau
-- temporaire, puis posées à leur heure finale. Sans cela, déplacer A là où
-- était B avant d'avoir déplacé B pourrait heurter la contrainte d'exclusion
-- « un technicien, un seul endroit à la fois » (schedule_events_no_tech_overlap).
--
-- SECURITY INVOKER : la RLS et la permission de l'appelant s'appliquent,
-- rpc_reschedule_event refait ses propres contrôles pour chaque visite.
create or replace function public.rpc_appliquer_optimisation(p_changements jsonb, p_timezone text default 'America/Montreal')
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  c jsonb;
  v_ev public.schedule_events%rowtype;
  v_res jsonb;
  v_n integer := 0;
  v_chevauchements integer := 0;
  v_i integer := 0;
begin
  if p_changements is null or jsonb_typeof(p_changements) <> 'array' or jsonb_array_length(p_changements) = 0 then
    raise exception 'Aucun changement à appliquer.';
  end if;
  if jsonb_array_length(p_changements) > 200 then
    raise exception 'Trop de changements (200 au plus).';
  end if;

  -- 1. Verrouiller et vérifier que rien n'a bougé depuis la proposition.
  for c in select * from jsonb_array_elements(p_changements) loop
    select * into v_ev from public.schedule_events
     where id = (c->>'visit_id')::uuid and deleted_at is null
     for update;
    if v_ev.id is null then
      raise exception 'proposition_perimee: une visite a été supprimée depuis la proposition.' using errcode = 'P0001';
    end if;
    if v_ev.start_at <> (c->>'avant_debut')::timestamptz or v_ev.end_at <> (c->>'avant_fin')::timestamptz then
      raise exception 'proposition_perimee: une visite a été déplacée depuis la proposition.' using errcode = 'P0001';
    end if;
  end loop;

  -- 2. Créneau temporaire (hors de toute journée réelle), puis heure finale.
  for c in select * from jsonb_array_elements(p_changements) loop
    v_i := v_i + 1;
    update public.schedule_events
       set start_at = timestamptz '2999-01-01 00:00+00' + (v_i * interval '2 hours'),
           end_at   = timestamptz '2999-01-01 01:00+00' + (v_i * interval '2 hours')
     where id = (c->>'visit_id')::uuid;
  end loop;
  for c in select * from jsonb_array_elements(p_changements) loop
    v_res := public.rpc_reschedule_event((c->>'visit_id')::uuid, (c->>'apres_debut')::timestamptz, (c->>'apres_fin')::timestamptz, null, p_timezone);
    v_n := v_n + 1;
    v_chevauchements := v_chevauchements + coalesce((v_res->>'overlaps')::integer, 0);
  end loop;

  return jsonb_build_object('appliquees', v_n, 'chevauchements', v_chevauchements);
end;
$function$;

-- Réservée aux membres connectés (la RLS et rpc_reschedule_event font le reste).
revoke all on function public.rpc_appliquer_optimisation(jsonb, text) from public;
revoke all on function public.rpc_appliquer_optimisation(jsonb, text) from anon;
grant execute on function public.rpc_appliquer_optimisation(jsonb, text) to authenticated;
