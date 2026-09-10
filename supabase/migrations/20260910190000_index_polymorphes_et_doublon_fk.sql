-- ═══════════════════════════════════════════════════════════════
-- P2-G (index) + P3-H (doublon FK)
-- ───────────────────────────────────────────────────────────────
-- P2-G : les colonnes polymorphes (entity_type, entity_id) des 7 tables
--   ci-dessous n'avaient pas d'index → toute recherche « quelles notifs/tâches
--   pointent vers cette entité » fait un seq-scan. On ajoute les index (les 3
--   colonnes existent, vérifié). On NE POSE PAS les CHECK sur entity_type
--   proposés par l'audit : un CHECK trop strict casserait un insert d'une
--   automatisation en prod. À faire séparément après recensement exhaustif des
--   valeurs réellement écrites.
-- P3-H : custom_column_values portait DEUX FK composites identiques
--   (org_id, column_id) → custom_columns(org_id, id). On retire la variante
--   NO ACTION (_column_id_same_org) et on garde la CASCADE (_column_same_org),
--   cohérente avec la FK simple _column_id_fkey (CASCADE).
-- ═══════════════════════════════════════════════════════════════

-- P2-G : index polymorphes (idempotents)
create index if not exists idx_audit_events_entity           on public.audit_events (org_id, entity_type, entity_id);
create index if not exists idx_notes_entity                  on public.notes (org_id, entity_type, entity_id);
create index if not exists idx_tasks_linked_entity           on public.tasks (org_id, linked_entity_type, linked_entity_id);
create index if not exists idx_automation_exec_logs_entity   on public.automation_execution_logs (org_id, entity_type, entity_id);
create index if not exists idx_automation_sched_tasks_entity on public.automation_scheduled_tasks (org_id, entity_type, entity_id);
create index if not exists idx_field_pin_entity_links_entity on public.field_pin_entity_links (org_id, entity_type, entity_id);
create index if not exists idx_notifications_entity          on public.notifications (org_id, entity_type, entity_id);

-- P3-H : supprimer la FK composite en double (NO ACTION), garder la CASCADE
alter table public.custom_column_values
  drop constraint if exists custom_column_values_column_id_same_org;
