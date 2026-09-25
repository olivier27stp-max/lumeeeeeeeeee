-- Aligne prod et staging sur les automatisations (db:diff du 2026-09-25).
--
-- Origine de l'écart : les migrations 20260914120100 à 120700 de la PR #375
-- (audit automatisations, jamais mergée) ont été appliquées à STAGING le
-- 2026-09-14 et jamais à la prod. Constat :
--   * le code de main n'utilise AUCUN des objets ajoutés (grep vide) ;
--   * la partie has_org_membership est remplacée par 20260927180000 ;
--   * la colonne clients.marketing_consent est dépassée par F7 (#439/#468),
--     qui gère le consentement autrement.
--
-- Décision : ne pas installer en prod un schéma que rien n'utilise (des
-- colonnes supprimées en prod plus tard = opération risquée) ; le retirer de
-- staging, ce qui se défait en réappliquant les fichiers de #375.
-- La seule partie utile tout de suite est un durcissement : les 6 politiques
-- d'écriture « tout membre » sur les journaux et tâches d'automatisation.
-- Elles sont mortes aujourd'hui (authenticated n'a ni INSERT ni UPDATE ni
-- DELETE sur ces tables), mais un ré-octroi des droits suffirait à laisser
-- n'importe quel technicien effacer l'historique. Seul le serveur
-- (service_role) écrit ces tables.
--
-- Idempotent : sur chaque environnement, ce qui n'existe pas est ignoré.
-- Si #375 est reprise un jour : re-dater ses migrations après celle-ci.

-- 1. Durcissement (prod) : plus aucune écriture client sur l'historique.
drop policy if exists automation_execution_logs_insert_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_update_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_delete_org on public.automation_execution_logs;
drop policy if exists automation_scheduled_tasks_insert_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_update_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_delete_org on public.automation_scheduled_tasks;
revoke insert, update, delete on public.automation_scheduled_tasks from authenticated, anon;
revoke insert, update, delete on public.automation_execution_logs from authenticated, anon;

-- 2. Retrait du schéma non déployé de #375 (staging).
drop function if exists public.automation_bump_counter(uuid, text);
drop function if exists public.purge_automation_history(integer);
drop table if exists public.automation_send_counters;

alter table public.company_settings
  drop column if exists automations_paused_at,
  drop column if exists automations_dry_run;

alter table public.plans
  drop column if exists automation_daily_sms_cap,
  drop column if exists automation_daily_email_cap;

alter table public.automation_execution_logs
  drop column if exists event_id,
  drop column if exists actor_id,
  drop column if exists recipient,
  drop column if exists rule_snapshot,
  drop column if exists conditions_evaluated,
  drop column if exists dry_run;

alter table public.clients
  drop column if exists marketing_consent,
  drop column if exists marketing_consent_at,
  drop column if exists marketing_consent_source;
