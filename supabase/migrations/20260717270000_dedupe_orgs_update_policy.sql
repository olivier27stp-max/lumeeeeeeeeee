-- PERF/hygiène : fusionner les 2 policies UPDATE permissives sur `orgs`
-- (advisor multiple_permissive_policies). Postgres évalue TOUTES les
-- policies permissives à chaque requête — deux qui se chevauchent = travail
-- doublé pour rien. On les remplace par une seule qui préserve exactement
-- l'union des deux accès (aucun droit gagné ni perdu) :
--   orgs_update       : created_by = uid  OR  has_org_admin_role(uid, id)
--   orgs_update_admin : has_org_role(uid, id, {owner, admin})
-- has_org_admin_role ≡ has_org_role(...,{owner,admin}) → l'union se réduit à
-- « créateur OU admin/owner ».

drop policy if exists orgs_update on public.orgs;
drop policy if exists orgs_update_admin on public.orgs;

create policy orgs_update on public.orgs
  for update to authenticated
  using ((created_by = (select auth.uid())) or public.has_org_admin_role((select auth.uid()), id))
  with check ((created_by = (select auth.uid())) or public.has_org_admin_role((select auth.uid()), id));
