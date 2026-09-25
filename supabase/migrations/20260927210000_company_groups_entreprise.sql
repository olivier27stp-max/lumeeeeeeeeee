-- L'entreprise existe enfin en base (MULTI_BUREAUX_PLAN.md, étape 5).
--
-- Jusqu'ici, un groupe de bureaux n'était qu'un uuid (orgs.company_group_id)
-- sans table : rien ne pouvait appartenir à « l'entreprise » (modèles
-- d'entreprise, branding commun…), seulement à un bureau. Cette table est le
-- propriétaire stable dont le P2 (modèles et automatisations partagés) a besoin.
-- Volontairement minimale : les réglages d'entreprise arriveront avec leur usage.
--
-- + étape 2 : retrait des tables mortes pipelines / lists / lead_lists
--   (ancien système par utilisateur ; les pipelines de vente vivent dans
--   pipelines_ventes). Aucune référence dans le code ; les 5 fonctions qui les
--   citent le font sous garde (to_regclass / exception) ou en commentaire.
--   prod : pipelines = 2 lignes « Main Pipeline » vides, lists = 0, lead_lists = 0.

-- 1. La table ───────────────────────────────────────────────────────

create table if not exists public.company_groups (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz not null default now()
);
comment on table public.company_groups is
  'Entreprise : regroupe les bureaux (orgs.company_group_id). Propriétaire des éléments d''entreprise.';

-- Une ligne par groupe existant, nommée d'après son plus ancien bureau.
insert into public.company_groups (id, name, created_at)
select distinct on (o.company_group_id)
       o.company_group_id,
       coalesce(nullif(btrim(cs.company_name), ''), o.name),
       o.created_at
  from public.orgs o
  left join public.company_settings cs on cs.org_id = o.id
 where o.company_group_id is not null
 order by o.company_group_id, o.created_at
on conflict (id) do nothing;

-- 2. Tout bureau crée ou rejoint une entreprise ────────────────────
-- Le trigger BEFORE INSERT existant choisit le groupe ; il crée maintenant la
-- ligne d'entreprise si elle manque (y compris quand l'appelant fournit un
-- company_group_id neuf, comme les scripts de QA) — sinon la FK refuserait.

create or replace function public.assign_org_company_group()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.company_group_id is null then
    select o.company_group_id into new.company_group_id
    from public.orgs o
    where o.created_by = new.created_by
      and new.created_by is not null
      and o.company_group_id is not null
    limit 1;

    if new.company_group_id is null then
      new.company_group_id := gen_random_uuid();
    end if;
  end if;

  insert into public.company_groups (id, name)
  values (new.company_group_id, new.name)
  on conflict (id) do nothing;

  return new;
end;
$function$;

alter table public.orgs alter column company_group_id set not null;
alter table public.orgs drop constraint if exists orgs_company_group_id_fkey;
alter table public.orgs
  add constraint orgs_company_group_id_fkey
  foreign key (company_group_id) references public.company_groups(id);
create index if not exists orgs_company_group_id_idx on public.orgs (company_group_id);

-- 3. Accès ──────────────────────────────────────────────────────────
-- Lecture : membre ACTIF d'un bureau de l'entreprise. Renommer : propriétaire.
-- Création / suppression : serveur seulement (le trigger ci-dessus).

alter table public.company_groups enable row level security;
alter table public.company_groups force row level security;

drop policy if exists company_groups_select_membre on public.company_groups;
create policy company_groups_select_membre on public.company_groups
  for select to authenticated
  using (exists (
    select 1 from public.orgs o
     where o.company_group_id = company_groups.id
       and public.has_org_membership((select auth.uid()), o.id)
  ));

drop policy if exists company_groups_update_proprietaire on public.company_groups;
create policy company_groups_update_proprietaire on public.company_groups
  for update to authenticated
  using (exists (
    select 1 from public.orgs o
     where o.company_group_id = company_groups.id
       and public.has_org_role((select auth.uid()), o.id, array['owner'])
  ))
  with check (exists (
    select 1 from public.orgs o
     where o.company_group_id = company_groups.id
       and public.has_org_role((select auth.uid()), o.id, array['owner'])
  ));

revoke all on public.company_groups from anon, authenticated;
grant select on public.company_groups to authenticated;
grant update (name) on public.company_groups to authenticated;
grant all on public.company_groups to service_role;

-- 4. Étape 2 : tables mortes ────────────────────────────────────────

drop table if exists public.lead_lists;
drop table if exists public.lists;
drop table if exists public.pipelines;
