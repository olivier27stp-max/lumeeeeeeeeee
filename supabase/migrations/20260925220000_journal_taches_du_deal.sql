-- ═══════════════════════════════════════════════════════════════
-- Les tâches d'un deal apparaissent dans son journal d'activité
--
-- LE PROBLÈME, MESURÉ EN PROD (2026-09-25). L'onglet « Activité » d'un deal
-- lit `activity_log` (entity OU related = ce deal). Pour les deals, la table
-- ne contient que deux sortes d'événements, écrits par le serveur :
-- `deal_stage_entered` (44) et `deal_stage_exited` (16). Aucun déclencheur
-- n'existe sur `tasks` — seuls jobs, devis et factures ont le leur. Créer,
-- cocher, modifier ou supprimer une tâche du deal ne laissait donc AUCUNE
-- trace : « Aucune activité » après avoir posé une tâche.
--
-- LE CORRECTIF. Un déclencheur sur `tasks`, limité aux tâches rattachées à
-- un deal, qui écrit l'événement avec le deal en `related_entity` — c'est ce
-- que le journal du deal sait déjà lire (et ce que son abonnement temps réel
-- filtre). Même forme que `log_quote_created`.
--
--   task_created    insertion
--   task_completed  open → done
--   task_reopened   done → open
--   task_updated    titre ou échéance modifiés
--   task_deleted    suppression douce (deleted_at posé)
--
-- ADDITIF : une fonction et un déclencheur neufs, aucune donnée migrée.
--
-- ROLLBACK :
--   drop trigger if exists trg_log_tache_deal on public.tasks;
--   drop function if exists public.log_tache_deal();
--   (les lignes déjà écrites dans activity_log peuvent rester : ce sont des
--    faits exacts ; sinon delete ... where entity_type = 'task'
--    and related_entity_type = 'deal'.)
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.log_tache_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_evenement text;
begin
  if new.linked_entity_type is distinct from 'deal' or new.linked_entity_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      return new;
    end if;
    v_evenement := 'task_created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_evenement := 'task_deleted';
  elsif new.deleted_at is not null then
    -- Une tâche déjà supprimée qu'on retouche : rien à raconter.
    return new;
  elsif old.status is distinct from new.status and new.status = 'done' then
    v_evenement := 'task_completed';
  elsif old.status is distinct from new.status and new.status = 'open' then
    v_evenement := 'task_reopened';
  elsif old.title is distinct from new.title or old.due_date is distinct from new.due_date then
    v_evenement := 'task_updated';
  else
    return new;
  end if;

  insert into public.activity_log (
    org_id, entity_type, entity_id, related_entity_type, related_entity_id,
    event_type, actor_id, metadata
  )
  values (
    new.org_id, 'task', new.id, 'deal', new.linked_entity_id,
    v_evenement, coalesce(auth.uid(), new.created_by),
    jsonb_build_object('title', coalesce(new.title, ''), 'due_date', new.due_date)
  );
  return new;
end;
$fn$;

-- Une fonction de déclencheur n'a rien à faire appelée directement.
revoke all on function public.log_tache_deal() from public, anon, authenticated;

drop trigger if exists trg_log_tache_deal on public.tasks;
create trigger trg_log_tache_deal
  after insert or update on public.tasks
  for each row execute function public.log_tache_deal();

commit;
