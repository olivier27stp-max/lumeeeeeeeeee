-- M-05 (agent M, PROPOSÉE — non appliquée hors de la pile locale)
-- Constat B-24 : « Opportunité qui dort » ne prévient qu'UNE fois par étape, pour toujours.
-- Une opportunité relancée, sortie de l'étape puis revenue, qui se rendort dans la MÊME étape
-- trois mois plus tard ne déclenche plus rien.
--
-- Cause : la clé d'unicité de l'alerte est `idle:<deal>:<règle>:<jours>:<étape>`, sans rien
-- qui distingue deux périodes de sommeil. La deuxième alerte tombe sur `on conflict do nothing`.
--
-- Correctif : la clé porte en plus le JOUR de la dernière activité de l'opportunité
-- (`deals.last_activity_at`, qui ne bouge qu'à un changement d'étape —
-- `deals_horodater_etape`). Une période de sommeil = une alerte ; une nouvelle période (après
-- un mouvement) = une nouvelle alerte. Une opportunité qui dort sans bouger garde la même
-- dernière activité, donc la même clé : toujours une seule alerte, pas une par tick.
--
-- SANS EFFET AU DÉPLOIEMENT : les alertes déjà émises portent l'ancienne clé. Sans précaution,
-- toutes les opportunités qui dorment aujourd'hui recevraient une nouvelle clé et seraient
-- re-signalées d'un coup. D'où le `not exists` : une alerte à l'ancienne clé, émise APRÈS la
-- dernière activité, couvre la période en cours. (Recherche exacte sur l'index unique
-- `uq_pipeline_events_cle (org_id, cle_unicite)` : aucun balayage.)
--
-- Prouvé sur la pile locale par
-- tests/automations-finale/b/m-24-opportunite-qui-se-rendort.test.ts (M24-01 à M24-03).
-- Le reste de la fonction est celui de la prod, au mot près.

BEGIN;

CREATE OR REPLACE FUNCTION public.pipeline_detecter_stagnation()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_insere integer := 0;
begin
  with candidats as (
    select
      d.org_id, d.id as deal_id, d.stage_id, d.pipeline_id,
      d.source, d.utm_campaign, d.assigned_user_id,
      r.id as rule_id,
      coalesce((r.conditions ->> 'idle_days')::integer, 7) as jours,
      d.last_activity_at,
      -- La clé d'avant ce correctif : une alerte par règle, par deal et par ÉTAPE.
      'idle:' || d.id::text || ':' || r.id::text || ':'
        || coalesce((r.conditions ->> 'idle_days')::integer, 7)::text || ':' || d.stage_id::text as cle_etape
    from public.deals d
    join public.pipeline_stages s
      on s.id = d.stage_id and s.org_id = d.org_id
    join public.automation_rules r
      on r.org_id = d.org_id
     and r.trigger_event = 'deal.stage_idle'
     and r.is_active
     and r.deleted_at is null
     and (
       r.stage_id = d.stage_id
       or (r.stage_id is null and (r.conditions ->> 'stage_id') = d.stage_id::text)
       or (r.stage_id is null and coalesce(r.conditions ->> 'stage_id', '') = '')
     )
    where d.deleted_at is null
      and s.kind = 'open'
      and d.last_activity_at
          <= now() - make_interval(days => coalesce((r.conditions ->> 'idle_days')::integer, 7))
  ),
  inserees as (
    insert into public.pipeline_events (org_id, deal_id, type, payload, cle_unicite)
    select
      c.org_id, c.deal_id, 'deal.stage_idle',
      jsonb_build_object(
        'deal_id', c.deal_id, 'stage_id', c.stage_id, 'pipeline_id', c.pipeline_id,
        'source', c.source, 'utm_campaign', c.utm_campaign,
        'assigned_user_id', c.assigned_user_id, 'idle_days', c.jours,
        'rule_id', c.rule_id
      ),
      -- Une alerte par règle, par deal, par étape ET par période de sommeil : la période est
      -- repérée par le jour de la dernière activité (B-24).
      c.cle_etape || ':' || to_char(c.last_activity_at at time zone 'UTC', 'YYYYMMDD')
    from candidats c
    -- Une alerte à l'ANCIENNE clé, émise depuis la dernière activité, couvre déjà cette
    -- période : pas de deuxième alerte au déploiement.
    where not exists (
      select 1
      from public.pipeline_events e
      where e.org_id = c.org_id
        and e.cle_unicite = c.cle_etape
        and e.created_at >= c.last_activity_at
    )
    on conflict (org_id, cle_unicite) do nothing
    returning 1
  )
  select count(*) into v_insere from inserees;

  return v_insere;
end;
$function$;

revoke all on function public.pipeline_detecter_stagnation() from public, anon, authenticated;

comment on function public.pipeline_detecter_stagnation() is
  'Détecte les deals stagnants et remplit la file. Étape : colonne stage_id, sinon conditions.stage_id, vide = toutes les étapes ouvertes. Appelée par le tick de 5 min du scheduler. Idempotente : une alerte par règle, deal, étape et période de sommeil (jour de la dernière activité).';

COMMIT;
