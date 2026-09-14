-- Audit automatisations 2026-09-13, F8 (Loi 25) — migration M3.
-- Trace d'exécution complète : qui a déclenché, à qui c'est parti, quelle
-- version de la règle a été appliquée. Jamais le corps du message (le SMS est
-- dans `messages`, le courriel chez le fournisseur).
alter table public.automation_execution_logs
  add column if not exists event_id uuid,                 -- activity_log.id de l'événement déclencheur (réservé, non écrit pour l'instant)
  add column if not exists actor_id uuid,                 -- qui a provoqué l'événement (null = système)
  add column if not exists recipient text,                -- destinataire résolu (E.164 ou courriel), jamais le corps
  add column if not exists rule_snapshot jsonb,           -- {trigger_event, conditions, delay_seconds, action} au moment de l'exécution
  add column if not exists conditions_evaluated jsonb,    -- {clé: {attendu, réel, ok}} — réservé
  add column if not exists dry_run boolean not null default false;

-- Les journaux existants portaient le corps des SMS dans result_data.body
-- (PII sans finalité) : retiré en une fois, le serveur ne l'écrit plus.
update public.automation_execution_logs
   set result_data = result_data - 'body'
 where result_data ? 'body';
