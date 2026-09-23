-- Idempotence des actions IMMÉDIATES d'automatisation (F3).
-- ──────────────────────────────────────────────────────────
-- Les actions DIFFÉRÉES sont protégées depuis longtemps : elles passent par
-- `automation_scheduled_tasks`, dont `idx_scheduled_tasks_dedup` est unique
-- sur (org_id, execution_key) parmi les tâches pending/running.
--
-- Les actions IMMÉDIATES, elles, calculaient la même clé (`buildExecutionKey`)
-- et ne s'en servaient JAMAIS : elles envoyaient directement. Deux émissions
-- du même événement — double clic, reprise réseau, rejeu d'un webhook —
-- produisaient donc deux SMS au même client, facturés deux fois.
--
-- Mesuré en production le 2026-09-23 : 2 doublons réels à 1 SECONDE d'écart,
-- même règle (« Appointment Confirmation »), même entité, même action. Ils
-- n'ont encore rien coûté parce qu'aucun SMS d'automatisation n'est parti en
-- prod à ce jour — mais le chemin est ouvert, et c'est une confirmation de
-- rendez-vous : exactement le genre de message qu'un client reçoit en double.
--
-- Ce que fait cette migration : une colonne `execution_key` sur les journaux
-- d'exécution, et un index UNIQUE PARTIEL sur les seules exécutions
-- immédiates (`scheduled_task_id is null`). Le moteur réserve la clé AVANT
-- d'agir : la seconde tentative viole la contrainte (23505) et s'arrête sans
-- envoyer.
--
-- Pourquoi partiel : une tâche différée peut légitimement réexécuter la même
-- clé après une reprise (5 min, 30 min, 2 h) — ces lignes-là portent un
-- `scheduled_task_id` et restent libres.
--
-- Les lignes existantes gardent `execution_key` à NULL : un index unique
-- ignore les NULL, donc rien à rétroremplir et aucun risque sur l'historique.

begin;

alter table public.automation_execution_logs
  add column if not exists execution_key text;

comment on column public.automation_execution_logs.execution_key is
  'Clé d''idempotence des actions immédiates (rule_id:entity_id:action_index). NULL pour les exécutions différées, qui sont dédoublonnées par automation_scheduled_tasks.';

-- Unique par ORG : deux organisations peuvent légitimement porter la même
-- clé (les ids de règle diffèrent, mais on ne mise pas là-dessus).
create unique index if not exists idx_execution_logs_immediat_dedup
  on public.automation_execution_logs (org_id, execution_key)
  where scheduled_task_id is null and execution_key is not null;

commit;
