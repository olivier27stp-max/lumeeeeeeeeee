-- ============================================================================
-- Perf/correctness : index sur les 16 FK non indexées (2026-08-02)
-- ============================================================================
-- Ces FK (ajoutées lors de D1/D3/audit metadonnees) n'avaient pas d'index de
-- support => cascade/SET NULL sur suppression du parent = seq-scan de l'enfant,
-- jointures lentes (lint Supabase 0001). Aucune n'est redondante (verifie : 0
-- index existant avec cette colonne en tete). Index sur exactement la/les
-- colonne(s) de la FK.
-- ============================================================================

begin;
create index if not exists idx_field_house_profiles_lead_id_fk on public.field_house_profiles (lead_id);
create index if not exists idx_field_rep_performance_territory_id_fk on public.field_rep_performance (territory_id);
create index if not exists idx_field_settings_default_pin_template_id_fk on public.field_settings (default_pin_template_id);
create index if not exists idx_field_territory_assignments_territory_id_fk on public.field_territory_assignments (territory_id);
create index if not exists idx_form_submissions_lead_id_fk on public.form_submissions (lead_id);
create index if not exists idx_fs_battles_challenger_team_id_fk on public.fs_battles (challenger_team_id);
create index if not exists idx_fs_battles_winner_team_id_fk on public.fs_battles (winner_team_id);
create index if not exists idx_fs_battles_opponent_team_id_fk on public.fs_battles (opponent_team_id);
create index if not exists idx_fs_commission_entries_lead_id_fk on public.fs_commission_entries (lead_id);
create index if not exists idx_fs_field_sessions_territory_id_fk on public.fs_field_sessions (territory_id);
create index if not exists idx_pipeline_deals_pin_id_fk on public.pipeline_deals (pin_id);
create index if not exists idx_quote_line_items_org_id_quote_id_fk on public.quote_line_items (org_id, quote_id);
create index if not exists idx_quote_measurement_camera_org_id_fk on public.quote_measurement_camera (org_id);
create index if not exists idx_quotes_source_template_id_fk on public.quotes (source_template_id);
create index if not exists idx_referrals_referrer_org_id_fk on public.referrals (referrer_org_id);
create index if not exists idx_referrals_referred_org_id_fk on public.referrals (referred_org_id);
commit;
