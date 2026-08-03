-- ============================================================================
-- Nettoyage : drop de 23 tables mortes + 3 fonctions mortes (2026-08-02)
-- ============================================================================
-- Toutes VÉRIFIÉES avant suppression : 0 ligne, 0 référence code (src/server),
-- 0 vue dépendante, 0 job pg_cron, et les fonctions qui les référencent sont
-- mortes (droppées ici) ou exclues. Clusters : IA/agent abandonné, note-boards
-- jamais câblé, tables remplacées (job_materials->job_line_items, etc.).
--
-- EXCLUES volontairement (PAS mortes) : note_history (trigger LIVE trg_notes_history
-- sur notes), org_invoice_sequences (numérotation de facture, prudence financière).
--
-- FK internes au cluster => CASCADE. Vérifié : aucune table conservée ne référence
-- ce set (seule FK externe etait bookings->booking_pages, les 2 sont dans le set).
-- ============================================================================

begin;

-- fonctions mortes référençant les tables droppées (0 trigger/ref/cron)
drop function if exists public.decay_few_shot_scores();
drop function if exists public.increment_few_shot_usage(uuid);
drop function if exists public.recalculate_calibration(uuid, text);

-- tables mortes (CASCADE pour les FK inter-cluster)
drop table if exists public.decision_outcomes cascade;
drop table if exists public.decision_logs cascade;
drop table if exists public.scenario_options cascade;
drop table if exists public.scenario_runs cascade;
drop table if exists public.confidence_calibration cascade;
drop table if exists public.few_shot_examples cascade;
drop table if exists public.user_agent_preferences cascade;
drop table if exists public.approvals cascade;
drop table if exists public.board_votes cascade;
drop table if exists public.board_drawings cascade;
drop table if exists public.board_comments cascade;
drop table if exists public.notes_tags cascade;
drop table if exists public.notes_files cascade;
drop table if exists public.notes_checklist cascade;
drop table if exists public.note_entity_links cascade;
drop table if exists public.note_connections cascade;
drop table if exists public.note_items cascade;
drop table if exists public.note_boards cascade;
drop table if exists public.job_materials cascade;
drop table if exists public.job_time_logs cascade;
drop table if exists public.email_campaign_recipients cascade;
drop table if exists public.booking_pages cascade;
drop table if exists public.bookings cascade;

commit;
