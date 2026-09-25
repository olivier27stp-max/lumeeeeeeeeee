-- ═══════════════════════════════════════════════════════════════
-- Creator Space — notes internes : durcissement des privilèges (2026-09-18)
--
-- La migration 20260917100000_creator_space_notes.sql portait le MÊME
-- horodatage que deux autres (company_settings_social_links, lumi_plafonds) :
-- elle n'a jamais été appliquée, ni en staging ni en prod. Résultat mesuré le
-- 2026-09-18 : GET /api/creator-space/companies/:orgId/notes répondait 500 en
-- production depuis la mise en ligne de la section Notes internes.
--
-- En l'appliquant, on constate le piège déjà documenté (voir la note
-- « SECURITY DEFINER moindre privilège ») : sur une table NEUVE, Supabase
-- accorde par DEFAULT PRIVILEGES tous les droits à `anon` et `authenticated`.
-- La RLS activée sans policy bloque effectivement l'accès aujourd'hui, mais
-- la table reste à une policy de distance d'une fuite : une note interne de
-- la plateforme sur un client ne doit JAMAIS être lisible par ce client.
-- On révoque donc nommément, comme pour org_features et security_events.
-- Seul le service_role (qui contourne la RLS) y accède, via des routes
-- gardées par requireCreatorSpace.
-- ═══════════════════════════════════════════════════════════════

begin;

revoke all on public.creator_space_notes from anon, authenticated;

-- FORCE RLS : même le propriétaire de la table reste soumis aux policies
-- (il n'y en a aucune) ; seul service_role passe.
alter table public.creator_space_notes force row level security;

comment on table public.creator_space_notes is
  'Notes internes de la plateforme sur un workspace. RLS activée sans policy + privilèges révoqués pour anon/authenticated : seul le service_role y accède (routes gardées par requireCreatorSpace). Jamais visible par le client.';

commit;
