-- ═══════════════════════════════════════════════════════════════
-- Launch 2026-09-28 — bloc 4 : sécurité des automatisations.
--
-- 1. Journaux d'exécution et tâches planifiées : lisibles par TOUT membre
--    (simple adhésion), alors que `action_config` / `result_data` portent
--    courriels et téléphones des clients. Désormais :
--      · journaux : « Voir les automatisations » OU « Voir les prospects »
--        (l'onglet « Relances » de la fiche d'un deal les lit pour les
--        vendeurs, qui n'ont pas automations.read — sans cette 2e clé il
--        serait vide pour eux) ; un technicien ne les lit plus ;
--      · tâches planifiées : « Voir les automatisations ».
-- 2. Clé des adresses d'appel (`automation_webhooks.api_key`) : qui la
--    détient déclenche les automatisations de l'entreprise. Elle n'est plus
--    LISIBLE par `authenticated` (privilège de colonne) ; le serveur la montre
--    une seule fois, à la création ou à la régénération. L'écriture (UPDATE,
--    régénération) reste gardée par la policy existante (automations.update).
--
-- Réversible : voir le bloc DOWN en fin de fichier.
-- ═══════════════════════════════════════════════════════════════

begin;

drop policy if exists automation_execution_logs_select_org on public.automation_execution_logs;
create policy automation_execution_logs_select_org
  on public.automation_execution_logs
  for select to authenticated
  using (
    member_has_permission((select auth.uid()), org_id, 'automations.read'::text)
    or member_has_permission((select auth.uid()), org_id, 'leads.read'::text)
  );

drop policy if exists automation_scheduled_tasks_select_org on public.automation_scheduled_tasks;
create policy automation_scheduled_tasks_select_org
  on public.automation_scheduled_tasks
  for select to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.read'::text));

revoke select on table public.automation_webhooks from anon, authenticated;
grant select (id, org_id, created_by, name, enabled, mode, deleted_at, created_at, updated_at)
  on table public.automation_webhooks to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════
-- DOWN :
--
-- begin;
-- drop policy if exists automation_execution_logs_select_org on public.automation_execution_logs;
-- create policy automation_execution_logs_select_org on public.automation_execution_logs
--   for select to authenticated using (has_org_membership((select auth.uid()), org_id));
-- drop policy if exists automation_scheduled_tasks_select_org on public.automation_scheduled_tasks;
-- create policy automation_scheduled_tasks_select_org on public.automation_scheduled_tasks
--   for select to authenticated using (has_org_membership((select auth.uid()), org_id));
-- grant select on table public.automation_webhooks to authenticated;
-- commit;
-- ═══════════════════════════════════════════════════════════════
