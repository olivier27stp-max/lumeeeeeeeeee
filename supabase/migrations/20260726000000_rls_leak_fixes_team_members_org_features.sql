-- ============================================================
-- 🔴 CRITIQUE — Fuites inter-tenant sur team_members & org_features
-- Trouvées par scripts/test-rls-isolation.ts (2026-07-08), APPLIQUÉES le même
-- jour, vérifiées (le test passe). Versionné ici pour le suivi + reproductibilité.
-- ============================================================
--
-- team_members : les policies SELECT/UPDATE/DELETE utilisaient
--   `USING (auth.uid() IS NOT NULL)` → AUCUN scoping org → n'importe quel user
--   authentifié pouvait LIRE, MODIFIER et SUPPRIMER les membres (nom, email,
--   téléphone) de TOUS les orgs. (Write access cross-tenant = très grave.)
-- org_features : la policy SELECT avait `... OR (org_id = auth.uid())` — une
--   comparaison org_id↔user_id boguée qui laissait fuiter des lignes.
--
-- Fix : scoping org via memberships (préserve le comportement intra-org, ferme
-- le cross-tenant). auth.uid() wrappé dans (select ...) pour la perf.

begin;

-- ── team_members ──
drop policy if exists "Users can view team members"   on public.team_members;
drop policy if exists "Users can update team members" on public.team_members;
drop policy if exists "Users can delete team members" on public.team_members;

create policy team_members_select_org on public.team_members
  for select to authenticated
  using (org_id in (select m.org_id from memberships m where m.user_id = (select auth.uid())));

create policy team_members_update_org on public.team_members
  for update to authenticated
  using      (org_id in (select m.org_id from memberships m where m.user_id = (select auth.uid())))
  with check (org_id in (select m.org_id from memberships m where m.user_id = (select auth.uid())));

create policy team_members_delete_org on public.team_members
  for delete to authenticated
  using (org_id in (select m.org_id from memberships m where m.user_id = (select auth.uid())));

-- ── org_features ──
drop policy if exists org_features_select on public.org_features;
create policy org_features_select on public.org_features
  for select to authenticated
  using (org_id in (select m.org_id from memberships m where m.user_id = (select auth.uid())));

commit;

-- Rollback (⚠️ réouvre les fuites — ne pas utiliser) :
--   recréer les anciennes policies USING(auth.uid() is not null) / avec le OR.
--
-- Suivi dev : envisager de restreindre team_members UPDATE/DELETE aux
-- rôles admin/owner (ici on a gardé "tout membre de l'org" pour ne pas changer
-- les permissions intra-org existantes — décision produit séparée).
