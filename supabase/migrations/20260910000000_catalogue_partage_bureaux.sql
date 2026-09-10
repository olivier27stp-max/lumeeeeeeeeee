-- Catalogue Produits & Services partagé entre les bureaux d'une même compagnie.
--
-- AVANT : predefined_services était étanche par org (= bureau). Une compagnie
-- à plusieurs bureaux devait ressaisir son catalogue dans chacun, et la
-- migration assistée créait un catalogue par bureau importé.
-- APRÈS : tout membre actif d'un bureau de la compagnie (orgs.company_group_id)
-- lit, crée, modifie et archive les services de TOUS les bureaux de cette
-- compagnie. Les lignes gardent leur org_id (bureau créateur) — rien n'est
-- déplacé, aucune donnée n'est réécrite.
--
-- Hors compagnie, rien ne change : une org sans company_group_id (ou seule
-- dans son groupe) garde exactement le périmètre d'avant.
--
-- Les autres tables (clients, jobs, factures…) restent 100 % séparées par
-- bureau — seul le catalogue devient commun.

-- ── 1. Brique RLS : appartenance à la compagnie d'une org ───────────────────
-- Brique dédiée plutôt que same_company_orgs() : cette dernière a vu son
-- EXECUTE révoqué pour authenticated (20260751102300) et ne peut donc pas
-- porter une policy évaluée sous ce rôle.
create or replace function public.has_company_membership(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and p_org is not null
     and exists (
       select 1
       from public.memberships m
       join public.orgs o1 on o1.id = m.org_id
       join public.orgs o2 on o2.id = p_org
       where m.user_id = p_user
         and m.status = 'active'
         and (
           o1.id = o2.id
           or (o1.company_group_id is not null and o1.company_group_id = o2.company_group_id)
         )
     );
$$;

revoke all on function public.has_company_membership(uuid, uuid) from public, anon;
grant execute on function public.has_company_membership(uuid, uuid) to authenticated;

comment on function public.has_company_membership(uuid, uuid) is
  'Brique RLS : vrai si p_user est membre actif d''un bureau de la MÊME compagnie '
  '(orgs.company_group_id) que p_org. Sert au catalogue partagé (predefined_services).';

-- ── 2. RPC front : les bureaux de la compagnie d'une org ────────────────────
-- Le navigateur filtre toujours explicitement par org (une personne membre de
-- deux compagnies distinctes ne doit pas voir leurs catalogues mélangés). Il
-- lui faut donc la liste des bureaux frères de l'org active. Garde : l'appelant
-- doit appartenir à cette compagnie, sinon aucune ligne.
create or replace function public.company_org_ids(p_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o2.id
  from public.orgs o1
  join public.orgs o2
    on o2.id = o1.id
    or (o1.company_group_id is not null and o2.company_group_id = o1.company_group_id)
  where o1.id = p_org
    and public.has_company_membership(auth.uid(), p_org);
$$;

revoke all on function public.company_org_ids(uuid) from public, anon;
grant execute on function public.company_org_ids(uuid) to authenticated;

comment on function public.company_org_ids(uuid) is
  'Bureaux (orgs) de la compagnie de p_org, p_org inclus. Vide si l''appelant '
  'n''est membre d''aucun bureau de cette compagnie. Lecture bornée, appelée par le navigateur.';

-- ── 3. Policies predefined_services : périmètre = compagnie ─────────────────
drop policy if exists predefined_services_select_org on public.predefined_services;
drop policy if exists predefined_services_insert_org on public.predefined_services;
drop policy if exists predefined_services_update_org on public.predefined_services;
drop policy if exists predefined_services_delete_org on public.predefined_services;

create policy predefined_services_select_company on public.predefined_services
  as permissive for select to authenticated
  using (public.has_company_membership((select auth.uid()), org_id));

create policy predefined_services_insert_company on public.predefined_services
  as permissive for insert to authenticated
  with check (public.has_company_membership((select auth.uid()), org_id));

create policy predefined_services_update_company on public.predefined_services
  as permissive for update to authenticated
  using (public.has_company_membership((select auth.uid()), org_id))
  with check (public.has_company_membership((select auth.uid()), org_id));

create policy predefined_services_delete_company on public.predefined_services
  as permissive for delete to authenticated
  using (public.has_company_membership((select auth.uid()), org_id));

comment on table public.predefined_services is
  '[Jobs] Catalogue produits/services. PARTAGÉ entre les bureaux d''une compagnie '
  '(company_group_id) depuis 20260910000000 ; org_id = bureau créateur.';
