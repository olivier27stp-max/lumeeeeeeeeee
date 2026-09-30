-- « Deal sans mouvement » part aussi pour une règle faite dans l'éditeur.
--
-- POURQUOI (audit V2, D-03)
-- L'éditeur enregistre l'étape dans conditions.stage_id ; la détection ne
-- joignait que sur la COLONNE automation_rules.stage_id, toujours nulle via
-- la route. Une règle « deal sans mouvement » créée à l'écran ne partait
-- JAMAIS (mesuré sur staging : règle éditeur 0 exécution, règle témoin
-- détectée). Et « laisser l'étape vide = toutes les étapes » ne marchait pas.
--
-- CE QUI CHANGE
-- L'étape se lit dans la colonne, sinon dans conditions.stage_id ; vide
-- partout = toutes les étapes OUVERTES. Comparaison en TEXTE : une valeur
-- mal formée dans les conditions ne fait jamais échouer le tick.
--
-- DOWN : recréer la fonction de 20260923100100_pipeline_moteur_et_forfait.sql
-- (jointure « and r.stage_id = d.stage_id »).

create or replace function public.pipeline_detecter_stagnation()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_insere integer := 0;
begin
  with candidats as (
    select
      d.org_id, d.id as deal_id, d.stage_id, d.pipeline_id,
      d.source, d.utm_campaign, d.assigned_user_id,
      r.id as rule_id,
      coalesce((r.conditions ->> 'idle_days')::integer, 7) as jours
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
      -- Une seule alerte par règle, par deal et par ÉTAPE : une règle « toutes
      -- les étapes » réalerte quand le deal stagne dans une autre étape.
      'idle:' || c.deal_id::text || ':' || c.rule_id::text || ':' || c.jours::text || ':' || c.stage_id::text
    from candidats c
    on conflict (org_id, cle_unicite) do nothing
    returning 1
  )
  select count(*) into v_insere from inserees;

  return v_insere;
end;
$fn$;

revoke all on function public.pipeline_detecter_stagnation() from public, anon, authenticated;

comment on function public.pipeline_detecter_stagnation() is
  'Détecte les deals stagnants et remplit la file. Étape : colonne stage_id, sinon conditions.stage_id, vide = toutes les étapes ouvertes. Appelée par le tick de 5 min du scheduler. Idempotente : une alerte par règle, deal et étape.';
