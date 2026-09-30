-- « Supprimer définitivement » depuis la corbeille des automatisations.
--
-- POURQUOI (demande de Rafba, 2026-09-30)
-- La corbeille n'offrait que « Restaurer » : une automatisation mise à la
-- corbeille y restait pour toujours.
--
-- POURQUOI PAS UN VRAI DELETE
-- 1. Règle du projet : jamais de suppression dure.
-- 2. Les journaux d'exécution pointent vers la règle
--    (automation_execution_logs (org_id, automation_rule_id), ON DELETE NO
--    ACTION — vérifié en prod) : effacer la règle obligerait à effacer
--    l'historique de ce qui a été envoyé aux clients, qui sert de preuve
--    (consentement, plaintes).
--
-- CE QUI CHANGE
-- `purged_at` : la règle quitte la corbeille pour de bon — plus listée,
-- plus restaurable — et son historique d'envois reste. Seule une règle déjà
-- à la corbeille peut être supprimée définitivement (contrainte).
--
-- DOWN :
--   alter table public.automation_rules drop constraint if exists automation_rules_purgee_en_corbeille;
--   alter table public.automation_rules drop column if exists purged_at;

alter table public.automation_rules
  add column if not exists purged_at timestamptz;

comment on column public.automation_rules.purged_at is
  'Supprimée définitivement depuis la corbeille : plus listée ni restaurable ; les journaux d''exécution restent.';

alter table public.automation_rules
  drop constraint if exists automation_rules_purgee_en_corbeille;
alter table public.automation_rules
  add constraint automation_rules_purgee_en_corbeille
  check (purged_at is null or deleted_at is not null);
