-- =============================================================================
-- org_knowledge : la mémoire de Lumi n'est plus lisible par tout le bureau
-- =============================================================================
--
-- FUITE PROUVÉE EN PRODUCTION le 2026-09-30. Connecté comme TECHNICIEN sur une
-- org de test, `supabase.from('org_knowledge').select()` rendait :
--
--     « la marge cible sur les toitures est de 45 pourcent
--       et que le taux horaire de Marc est 32 dollars »
--
-- La seule policy de lecture était `has_org_membership(auth.uid(), org_id)` :
-- appartenir au bureau suffisait. Aucune vérification de la page Rôles, alors
-- que 39 autres tables (factures, paiements, devis, objectifs…) l'exigent déjà.
--
-- Ce que ces notes contiennent : ce qu'un propriétaire a demandé à Lumi de
-- retenir — marges cibles, taux horaires, consignes de prix. Exactement ce
-- qu'un technicien ne voit nulle part ailleurs dans l'app.
--
-- Le correctif applicatif du même jour a fermé la porte LUMI (les notes
-- n'entrent plus dans son prompt, et `recall_notes` exige `settings.update`).
-- Celui-ci ferme la porte DIRECTE, qui restait grande ouverte depuis la
-- console du navigateur.
--
-- MÊME CLÉ que côté Lumi : `settings.update`. Surtout pas `settings.read`,
-- que les quatre rôles possèdent — elle ne fermerait rien.
--
-- SANS RISQUE DE RÉGRESSION, vérifié avant d'écrire :
--   • une seule catégorie existe en prod (`assistant`), 1 ligne, 1 org ;
--   • AUCUN code client ne lit cette table — ni `src/` (web) ni `mobile/src/`.
--     La seule voie d'accès est le serveur, qui utilise la clé de service et
--     n'est donc pas touché par cette policy.
--
-- L'écriture était déjà fermée aux clients (pas de GRANT INSERT/UPDATE) : on
-- ne change que la LECTURE.
-- =============================================================================

begin;

-- L'ancienne policy : appartenir au bureau suffisait.
drop policy if exists org_knowledge_org_member_select on public.org_knowledge;

-- La nouvelle : il faut EN PLUS le droit de modifier les réglages
-- d'entreprise, c'est-à-dire owner ou admin. `member_has_permission` est la
-- fonction que la base utilise déjà pour les 39 autres tables — on ne crée pas
-- un second système de permissions en parallèle.
create policy org_knowledge_reglages_select
  on public.org_knowledge
  for select
  to authenticated
  using (
    public.has_org_membership((select auth.uid()), org_id)
    and public.member_has_permission((select auth.uid()), org_id, 'settings.update')
  );

comment on policy org_knowledge_reglages_select on public.org_knowledge is
  'Mémoire de Lumi et réglages d''entreprise : réservés aux rôles qui peuvent modifier les réglages (owner, admin). Même clé que remember_this / forget_note / recall_notes côté serveur. Fuite prouvée et fermée le 2026-09-30.';

commit;
