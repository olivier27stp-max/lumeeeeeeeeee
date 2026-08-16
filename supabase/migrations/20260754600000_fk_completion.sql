-- Complète les 3 dernières clés étrangères réellement manquantes.
--
-- Audit du 2026-08-03 sur les 63 colonnes uuid *_id sans contrainte :
--   30  → auth.users (schéma géré par Supabase, convention du projet : pas de FK)
--   16  → références polymorphes (entity_id, ref_id, record_id…) : impossible par nature
--   14  → colonnes mortes, 0 ligne renseignée (department_id ×2, stage_id,
--          review_template_id) ou table disparue (lead_id)
--    3  → VRAIES clés manquantes, corrigées ici (0 orphelin vérifié en prod)
--
-- Modèle ADD ... NOT VALID puis VALIDATE : pas de scan bloquant à l'ajout, la
-- validation vérifie l'existant sans bloquer les écritures.
-- ON DELETE laissé en NO ACTION : l'app fait de la suppression douce
-- (deleted_at), une suppression dure d'un parent doit donc être refusée.

begin;

alter table public.field_pin_entity_links
  add constraint field_pin_entity_links_house_id_fkey
  foreign key (house_id) references public.field_house_profiles(id) not valid;

alter table public.team_schedule_audit
  add constraint team_schedule_audit_team_id_fkey
  foreign key (team_id) references public.teams(id) not valid;

alter table public.provisioning_events
  add constraint provisioning_events_subscription_id_fkey
  foreign key (subscription_id) references public.subscriptions(id) not valid;

alter table public.field_pin_entity_links validate constraint field_pin_entity_links_house_id_fkey;
alter table public.team_schedule_audit    validate constraint team_schedule_audit_team_id_fkey;
alter table public.provisioning_events    validate constraint provisioning_events_subscription_id_fkey;

commit;
