-- ════════════════════════════════════════════════════════════════════════════
-- Nettoyage : tâches d'automatisation planifiées en double
--
-- CONTEXTE
-- `buildExecutionKey()` (server/lib/automationEngine.ts) incluait la date du
-- jour dans la clé d'unicité :
--     `${ruleId}:${entityId}:${actionIndex}:${YYYY-MM-DD}`
-- Or l'index `idx_scheduled_tasks_dedup` est unique sur (org_id, execution_key)
-- parmi les tâches 'pending'/'running'. Avec la date dedans, ré-émettre le même
-- événement le lendemain (renvoyer un devis, par ex.) produisait une clé
-- DIFFÉRENTE : les tâches déjà en attente restaient, de nouvelles s'ajoutaient,
-- et le client recevait chaque relance en double.
--
-- Constaté en prod le 2026-08-10 : le devis nº6 portait 16 tâches 'pending'
-- au lieu de 8 (devis envoyé par courriel le 31/07 puis par SMS le 01/08).
--
-- Le correctif applicatif retire la date de la clé. Cette migration résorbe
-- les doublons DÉJÀ présents, que le correctif ne peut pas rattraper.
--
-- CE QUE FAIT CETTE MIGRATION
-- Pour chaque (org_id, règle, entité, type d'action) en statut 'pending', garde
-- la tâche la plus ANCIENNE (celle dont l'échéance respecte le délai voulu à
-- partir de l'événement d'origine) et passe les autres en 'cancelled'.
--
-- CE QU'ELLE NE FAIT PAS
-- - Aucune suppression : 'cancelled' préserve la traçabilité.
-- - Ne touche ni 'running', ni 'completed', ni 'failed', ni 'cancelled'.
-- - Ne touche pas aux tâches sans doublon.
--
-- Idempotente : rejouée, elle ne trouve plus de doublon et ne fait rien.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_annulees integer;
begin
  with doublons as (
    select
      id,
      row_number() over (
        partition by org_id, automation_rule_id, entity_id, (action_config->>'type')
        order by created_at, id
      ) as rn
    from public.automation_scheduled_tasks
    where status = 'pending'
  )
  update public.automation_scheduled_tasks t
     set status       = 'cancelled',
         completed_at = now(),
         last_error   = 'Doublon résorbé : clé d''unicité datée (voir 20260810140000)'
    from doublons d
   where d.id = t.id
     and d.rn > 1;

  get diagnostics v_annulees = row_count;
  raise notice '[dedup] % tâche(s) en double annulée(s)', v_annulees;
end
$$;
