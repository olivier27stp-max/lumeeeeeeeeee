-- ═══════════════════════════════════════════════════════════════
-- Champs personnalisés v2 : RLS FORCÉE, comme toutes les tables
--
-- L'invariant quotidien check_rls_coverage (cron lume_invariant_checks)
-- exige relforcerowsecurity sur chaque table — règle de l'audit de
-- juillet 2026. La migration 20260926100000 activait la RLS sans la forcer :
-- les six tables remontaient en échec dans security_events.
--
-- Sans effet sur les fonctions SECURITY DEFINER (cf_filtrer_brut, copie
-- deal → job, Loi 25) : leur propriétaire `postgres` a BYPASSRLS, comme
-- service_role (vérifié en prod le 2026-09-24).
-- ═══════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

alter table public.custom_field_folders force row level security;
alter table public.custom_fields force row level security;
alter table public.custom_field_options force row level security;
alter table public.custom_field_values force row level security;
alter table public.custom_field_value_options force row level security;
alter table public.custom_field_pipeline_cards force row level security;

commit;
