-- ═══════════════════════════════════════════════════════════════
-- PERFORMANCE : index sur les foreign keys non indexées (advisor
-- unindexed_foreign_keys, audit 2026-07-17).
--
-- Pourquoi ça compte : une FK sans index force un scan complet de la
-- table enfant à chaque DELETE/UPDATE du parent (les cascades de
-- suppression gardées en #128/#129 font justement des DELETE WHERE
-- job_id/client_id = …) et ralentit les jointures. Volumes actuels
-- petits (≤ ~1000 lignes) donc impact faible aujourd'hui, mais gratuit
-- à poser et payant quand tracking_points / email_* grossiront.
--
-- Sans CONCURRENTLY : les tables sont minuscules (≤1000 lignes) donc le
-- lock d'écriture ne dure que quelques millisecondes — sans risque en prod,
-- et compatible avec l'exécution transactionnelle du runner db:apply.
-- ═══════════════════════════════════════════════════════════════

-- Fort volume / croissance rapide (tracking GPS, courriels)
create index if not exists idx_tracking_points_job_id on public.tracking_points (job_id);
create index if not exists idx_tracking_points_team_id on public.tracking_points (team_id);
create index if not exists idx_email_messages_user_id on public.email_messages (user_id);
create index if not exists idx_email_threads_org_id on public.email_threads (org_id);
create index if not exists idx_tracking_live_locations_job_id on public.tracking_live_locations (job_id);
create index if not exists idx_tracking_live_locations_team_id on public.tracking_live_locations (team_id);

-- Entités métier jointes / supprimées en cascade
create index if not exists idx_field_house_profiles_invoice_id on public.field_house_profiles (invoice_id);
create index if not exists idx_field_house_profiles_client_id on public.field_house_profiles (client_id);
create index if not exists idx_field_house_profiles_job_id on public.field_house_profiles (job_id);
create index if not exists idx_field_house_profiles_quote_id on public.field_house_profiles (quote_id);
create index if not exists idx_pipeline_deals_quote_id on public.pipeline_deals (quote_id);
create index if not exists idx_memberships_team_id on public.memberships (team_id);
create index if not exists idx_email_oauth_states_org_id on public.email_oauth_states (org_id);
create index if not exists idx_email_oauth_states_user_id on public.email_oauth_states (user_id);
create index if not exists idx_job_agreements_client_id on public.job_agreements (client_id);
create index if not exists idx_activity_notes_actor_id on public.activity_notes (actor_id);
create index if not exists idx_invitations_team_id on public.invitations (team_id);

-- Tables actuellement vides mais dont la FK sert aux cascades job/client
-- (posées maintenant pour ne pas y repenser quand elles se rempliront).
create index if not exists idx_fs_commission_entries_job_id on public.fs_commission_entries (job_id);
create index if not exists idx_geofences_job_id on public.geofences (job_id);
create index if not exists idx_job_billing_milestones_job_id on public.job_billing_milestones (job_id);
create index if not exists idx_proof_of_presence_job_id on public.proof_of_presence (job_id);
create index if not exists idx_service_contracts_client_id on public.service_contracts (client_id);
create index if not exists idx_course_assignments_team_id on public.course_assignments (team_id);
create index if not exists idx_form_submissions_assessment_team_id on public.form_submissions (assessment_team_id);
create index if not exists idx_form_submissions_assessment_user_id on public.form_submissions (assessment_user_id);
create index if not exists idx_mfa_phone_org_id on public.mfa_phone (org_id);
