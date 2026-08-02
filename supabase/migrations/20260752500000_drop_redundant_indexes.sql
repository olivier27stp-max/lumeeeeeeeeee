-- ============================================================================
-- Perf : drop de 6 index STRUCTURELLEMENT redondants (2026-08-02)
-- ============================================================================
-- Chacun est un doublon EXACT (mêmes colonnes, même prédicat) d'un index PK ou
-- UNIQUE deja present => il ne sert AUCUNE requete que l'autre ne sert deja.
-- Redondance prouvable sans donnees de trafic. Reduit l'amplification d'ecriture
-- (un index de moins a maintenir par insert/update). 0 reference code/test.
-- On garde toujours le PK/UNIQUE (qui porte la contrainte), on drop le plain.
-- ============================================================================

begin;
drop index if exists public.idx_fk_company_settings_org_id;      -- == company_settings_org_unique (UNIQUE)
drop index if exists public.idx_email_oauth_states_state;        -- == email_oauth_states_state_key (UNIQUE)
drop index if exists public.idx_payment_provider_secrets_org;    -- == payment_provider_secrets_pkey (PK)
drop index if exists public.idx_fk_profiles_id;                  -- == profiles_pkey (PK)
drop index if exists public.idx_qmc_quote;                       -- == quote_measurement_camera_quote_id_key (UNIQUE)
drop index if exists public.idx_recurring_team_schedules_org_team; -- == idx_rts_org_team (doublon plain)
commit;
