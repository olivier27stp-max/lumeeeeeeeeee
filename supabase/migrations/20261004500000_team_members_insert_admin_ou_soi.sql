-- Audit des outils de Lumi (2026-09-30) — approuvée par Rafba le 2026-09-30.
--
-- Constat : team_members_insert_org laisse TOUT membre (technicien, vendeur)
-- insérer une fiche d'équipe pour n'importe quel user_id de l'org (WITH CHECK
-- ne vérifie que l'appartenance à l'org). Une fausse fiche d'équipe apparaît
-- dans Équipe, la paie et les listes de Lumi (get_team, assign_job).
--
-- Chemins d'insertion existants côté client, tous conservés :
--   - src/pages/settings/ProfileSettings.tsx : un membre crée SA propre fiche
--     (user_id = lui-même) → permis par « user_id = auth.uid() » ;
--   - src/lib/teamMembersApi.ts (taux horaire) : écran admin → permis par
--     has_org_admin_role.
-- Les routes serveur écrivent en service_role (hors RLS) : inchangées.
--
-- Vérification après application (staging) : un technicien ne peut plus
-- insérer une fiche pour un autre user_id (42501) ; il peut créer la sienne.
-- Puis : npm run check:broken-objects && npm run check:db-coherence.

drop policy if exists team_members_insert_org on public.team_members;
create policy team_members_insert_org on public.team_members
  for insert to authenticated
  with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = (select auth.uid()))
    and (
      public.has_org_admin_role((select auth.uid()), org_id)
      or user_id = (select auth.uid())
    )
  );

-- NON inclus, à décider (Loi 25) : taux horaire (hourly_rate_cents,
-- labour_cost_hourly) et date de naissance lisibles par TOUS les membres via
-- team_members_select_org. Une révocation de colonne casserait les
-- select('*') de ProfileSettings.tsx et TeamMemberDetails.tsx et la lecture
-- de Commissions.tsx : il faut d'abord passer ces écrans par une RPC ou une
-- vue restreinte. Voir LUMI_TOOLS_AUDIT.md, « Migrations en attente ».
