-- ============================================================================
-- 03_indexes — index sur les 6 FK non indexées (audit métadonnées, 2026-08-01)
-- ============================================================================
-- Une FK sans index sur sa colonne = seq_scan de la table enfant à chaque
-- suppression du parent (lock escalation à l'échelle). Ajouter un index ne
-- change aucun comportement — risque nul.
-- NOTE: CREATE INDEX (non-concurrent) car tables minuscules (pré-lancement) et
-- l'API Management exécute en transaction (CONCURRENTLY y est interdit). En prod
-- à volume, préférer CREATE INDEX CONCURRENTLY hors transaction.
-- ============================================================================

create index if not exists idx_custom_column_values_column_id
  on public.custom_column_values (column_id);
create index if not exists idx_fs_rep_stat_snapshots_user_id
  on public.fs_rep_stat_snapshots (user_id);
create index if not exists idx_recurring_team_schedules_team_id
  on public.recurring_team_schedules (team_id);
create index if not exists idx_team_assignments_user_id
  on public.team_assignments (user_id);
create index if not exists idx_team_assignments_team_id
  on public.team_assignments (team_id);
create index if not exists idx_team_date_slots_team_id
  on public.team_date_slots (team_id);
