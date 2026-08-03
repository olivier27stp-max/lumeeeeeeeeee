-- ============================================================================
-- Perf : drop 10 index composites-prefixes redondants (2026-08-02)
-- ============================================================================
-- Chacun est un PREFIXE STRICT d'un index plus long avec le MEME predicat
-- (couvert par la colonne de tete). Verifie un par un.
-- EXCLU (faux positif) : idx_schedule_events_job_start_at — start_at y est une
-- colonne KEY (triable) alors que dans idx_schedule_job_cover c'est un INCLUDE
-- (stocke, non triable) => il fournit un tri que le cover ne donne pas.
-- 0 reference code.
-- ============================================================================

begin;
drop index if exists public.idx_custom_column_values_org_column_id;      -- prefixe de custom_column_values_org_col_record_uniq
drop index if exists public.custom_columns_org_entity_idx;               -- prefixe de custom_columns_org_entity_name_uniq
drop index if exists public.idx_email_threads_org_account_id;            -- prefixe de email_threads_org_account_thread_uq
drop index if exists public.idx_pipeline_deals_org_stage_dashboard;      -- prefixe de idx_pipeline_deals_active_org
drop index if exists public.idx_reminder_log_org_invoice_id;             -- prefixe de reminder_log_org_invoice_day_channel_uq
drop index if exists public.idx_schedule_events_org_start_at_dashboard;  -- prefixe de idx_schedule_active_range
drop index if exists public.idx_team_assignments_org_user;               -- prefixe de team_assignments_org_id_user_id_team_id_key
drop index if exists public.idx_team_date_slots_org_team_id;             -- prefixe de team_date_slots_org_team_slot_uq
drop index if exists public.idx_team_schedule_assignments_org_team_id;   -- prefixe de tsa_org_team_user_date_start_uq
drop index if exists public.idx_teams_org_deleted_at;                    -- prefixe de idx_teams_org_deleted_name
commit;
