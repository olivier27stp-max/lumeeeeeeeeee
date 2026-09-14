-- Audit automatisations 2026-09-13, F4 (CRITIQUE) — migration M1.
-- Les règles se lisent par tout membre et s'ÉCRIVENT par les admins (owner/admin)
-- seulement ; la file de tâches et les journaux d'exécution ne s'écrivent que
-- par le serveur (service_role). Avant : n'importe quel membre (un technicien)
-- pouvait créer une règle « facture payée → statut paid » ou réécrire le
-- destinataire d'une confirmation — prouvé sur staging (T8.1, T8.2).
-- has_org_admin_role(uid, org) existe déjà (utilisée par batch_restore).

begin;

-- automation_rules ─────────────────────────────────────────────
drop policy if exists automation_rules_insert_org on public.automation_rules;
drop policy if exists automation_rules_update_org on public.automation_rules;
drop policy if exists automation_rules_delete_org on public.automation_rules;

create policy automation_rules_insert_admin on public.automation_rules
  as permissive for insert to authenticated
  with check (public.has_org_admin_role((select auth.uid()), org_id));

create policy automation_rules_update_admin on public.automation_rules
  as permissive for update to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));

create policy automation_rules_delete_admin on public.automation_rules
  as permissive for delete to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));

-- automation_scheduled_tasks / automation_execution_logs : lecture seule ──
drop policy if exists automation_scheduled_tasks_insert_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_update_org on public.automation_scheduled_tasks;
drop policy if exists automation_scheduled_tasks_delete_org on public.automation_scheduled_tasks;
drop policy if exists automation_execution_logs_insert_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_update_org on public.automation_execution_logs;
drop policy if exists automation_execution_logs_delete_org on public.automation_execution_logs;

-- Ceinture et bretelles : les GRANT par défaut de Supabase donnent ALL à
-- authenticated ; sans REVOKE, une future policy permissive rouvrirait tout
-- (voir mémoire secdef-lume-moindre-privilege).
revoke insert, update, delete on public.automation_scheduled_tasks from authenticated, anon;
revoke insert, update, delete on public.automation_execution_logs from authenticated, anon;

commit;
