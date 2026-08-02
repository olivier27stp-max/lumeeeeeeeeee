-- ============================================================================
-- D3 — Ajout des FK manquantes vérifiées (audit métadonnées, 2026-08-01)
-- ============================================================================
-- 9 des 10 colonnes *_id sans FK (vérifiées 0 orphelin) reçoivent une contrainte.
-- EXCLU volontairement : form_submissions.lead_id (11 orphelins => l'app y écrit
-- des lead_id absents de clients ; une FK bloquerait des soumissions).
--
-- FK single-col + ON DELETE SET NULL (colonnes nullables, refs optionnelles) :
-- supprimer le parent annule la référence sans effacer l'enfant. Exception :
-- field_territory_assignments.territory_id est NOT NULL => CASCADE.
-- NOT VALID : pas de scan, n'affecte pas l'existant, contraint les écritures
-- futures (0 orphelin actuel => aucune écriture légitime cassée).
-- ============================================================================

begin;

-- territoires -> field_territories
alter table public.field_rep_performance
  add constraint field_rep_performance_territory_id_fkey
  foreign key (territory_id) references public.field_territories(id) on delete set null not valid;
alter table public.field_territory_assignments
  add constraint field_territory_assignments_territory_id_fkey
  foreign key (territory_id) references public.field_territories(id) on delete cascade not valid;
alter table public.fs_field_sessions
  add constraint fs_field_sessions_territory_id_fkey
  foreign key (territory_id) references public.field_territories(id) on delete set null not valid;

-- leads (= clients) -> clients
alter table public.fs_commission_entries
  add constraint fs_commission_entries_lead_id_fkey
  foreign key (lead_id) references public.clients(id) on delete set null not valid;
alter table public.field_house_profiles
  add constraint field_house_profiles_lead_id_fkey
  foreign key (lead_id) references public.clients(id) on delete set null not valid;

-- templates / pins / teams
alter table public.quotes
  add constraint quotes_source_template_id_fkey
  foreign key (source_template_id) references public.quote_templates(id) on delete set null not valid;
alter table public.field_settings
  add constraint field_settings_default_pin_template_id_fkey
  foreign key (default_pin_template_id) references public.field_pin_templates(id) on delete set null not valid;
alter table public.pipeline_deals
  add constraint pipeline_deals_pin_id_fkey
  foreign key (pin_id) references public.field_pins(id) on delete set null not valid;
alter table public.fs_battles
  add constraint fs_battles_challenger_team_id_fkey
  foreign key (challenger_team_id) references public.field_sales_teams(id) on delete set null not valid;
alter table public.fs_battles
  add constraint fs_battles_opponent_team_id_fkey
  foreign key (opponent_team_id) references public.field_sales_teams(id) on delete set null not valid;
alter table public.fs_battles
  add constraint fs_battles_winner_team_id_fkey
  foreign key (winner_team_id) references public.field_sales_teams(id) on delete set null not valid;

commit;
