-- ============================================================================
-- Perf : drop de 65 index single-col REDONDANTS (couverts par un composite)
-- 2026-08-02
-- ============================================================================
-- Chaque index ci-dessous est single-colonne, non-unique, non-PK, sans INCLUDE,
-- et sa colonne est la TÊTE d'un index composite existant avec le MÊME prédicat.
-- => il ne sert aucune requête que le composite ne sert déjà (la RLS filtrant sur
-- org_id utilise le composite (org_id, ...)). Redondance prouvable sans trafic.
-- Réduit l'amplification d'écriture. 0 référence code/test. Ils forment le gros
-- de la sur-indexation (jobs avait 23 index, etc.).
-- ============================================================================

begin;
drop index if exists public.idx_agent_messages_org_id;
drop index if exists public.idx_approvals_org_id;
drop index if exists public.idx_automation_rules_org;
drop index if exists public.idx_fk_automation_scheduled_tasks_org;
drop index if exists public.idx_billing_receipt_log_org_id;
drop index if exists public.idx_board_votes_board;
drop index if exists public.bookings_org_idx;
drop index if exists public.idx_contacts_org_id;
drop index if exists public.idx_fk_conversations_org_id;
drop index if exists public.idx_course_assignments_course;
drop index if exists public.idx_fk_ccv_org_id;
drop index if exists public.idx_decision_logs_org;
drop index if exists public.idx_email_accounts_org;
drop index if exists public.idx_email_accounts_user;
drop index if exists public.ecr_org_idx;
drop index if exists public.idx_email_messages_account;
drop index if exists public.idx_fk_email_tpl_org_id;
drop index if exists public.idx_email_threads_org_id;
drop index if exists public.idx_field_pins_org_id;
drop index if exists public.idx_field_territories_org_id;
drop index if exists public.idx_fk_fs_check_in_records_org_id;
drop index if exists public.idx_fk_fs_commission_entries_org_id;
drop index if exists public.idx_fk_fs_commission_rules_org_id;
drop index if exists public.idx_fk_fs_field_sessions_org_id;
drop index if exists public.idx_fk_fs_rep_badges_org_id;
drop index if exists public.idx_fk_fs_rep_stat_snapshots_org_id;
drop index if exists public.idx_fk_geofences_org_id;
drop index if exists public.idx_fk_ial_org_id;
drop index if exists public.idx_invitations_org;
drop index if exists public.idx_invoice_send_events_org_id;
drop index if exists public.idx_invoice_templates_org_id;
drop index if exists public.idx_job_agreements_org_id;
drop index if exists public.job_checklists_org_idx;
drop index if exists public.idx_job_intents_org_id;
drop index if exists public.idx_job_materials_org_id;
drop index if exists public.idx_fk_job_recurrence_org;
drop index if exists public.idx_job_time_logs_org_id;
drop index if exists public.jobs_org_id_idx;
drop index if exists public.idx_memberships_org_id;
drop index if exists public.idx_memberships_user_id;
drop index if exists public.idx_fk_messages_org;
drop index if exists public.idx_mfa_trusted_devices_user;
drop index if exists public.idx_note_entity_links_item;
drop index if exists public.idx_notes_tags_note;
drop index if exists public.idx_org_features_org;
drop index if exists public.idx_payment_requests_org_id;
drop index if exists public.idx_payment_requirements_org_id;
drop index if exists public.idx_fk_pop_org;
drop index if exists public.idx_properties_org_id;
drop index if exists public.push_tokens_org_idx;
drop index if exists public.idx_quote_measurements_org_id;
drop index if exists public.idx_fk_rr_org;
drop index if exists public.idx_role_templates_org;
drop index if exists public.idx_fk_ss_org;
drop index if exists public.idx_scenario_options_org_id;
drop index if exists public.idx_scenario_runs_org_id;
drop index if exists public.idx_service_contracts_org_id;
drop index if exists public.idx_subscriptions_org_id;
drop index if exists public.idx_team_availability_org_id;
drop index if exists public.idx_team_capabilities_org_id;
drop index if exists public.idx_fk_tds_org;
drop index if exists public.idx_fk_te_org;
drop index if exists public.idx_tracking_events_org_id;
drop index if exists public.idx_tracking_live_org;
drop index if exists public.workflows_org_idx;
commit;
