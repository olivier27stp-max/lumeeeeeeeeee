-- ═══════════════════════════════════════════════════════════════
-- Partage d'un pipeline : qui le voit
--
-- L'audit GoHighLevel relevait « Sharing & permissions » par pipeline (#51),
-- avec le cas d'usage du service terrain : un sous-traitant qui ne doit voir
-- que ses propres jobs, pas le carnet de commandes de toute l'entreprise.
--
-- Aujourd'hui, tout membre voit TOUS les pipelines de son organisation.
-- Pour une équipe de quatre, c'est le bon défaut. Ça cesse de l'être dès
-- qu'on fait entrer un sous-traitant ou qu'on sépare résidentiel et
-- commercial entre deux équipes.
--
-- LE CHOIX DE CONCEPTION, et pourquoi il est restrictif par exception :
--
--   · un pipeline SANS aucune ligne de partage reste visible de tous.
--     C'est l'état actuel, et il ne change pas : personne ne perd l'accès à
--     quoi que ce soit en appliquant cette migration ;
--   · dès qu'UNE ligne existe, le pipeline devient réservé — aux membres
--     nommés, plus les administrateurs, toujours.
--
-- L'inverse (tout fermer par défaut, ouvrir au cas par cas) obligerait à
-- configurer avant de pouvoir travailler, et transformerait une fonction
-- optionnelle en corvée d'installation.
--
-- LES ADMINISTRATEURS VOIENT TOUT, sans exception possible. Ce n'est pas une
-- commodité : le propriétaire doit pouvoir constater ce qui se passe dans
-- son entreprise, et un pipeline qu'on peut cacher à son patron est un
-- risque, pas une fonctionnalité.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.pipeline_acces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  pipeline_id uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),

  constraint pipeline_acces_org_id_id_uq unique (org_id, id),
  -- Deux fois le même membre sur le même pipeline n'a aucun sens, et
  -- ferait apparaître son nom en double dans l'écran de partage.
  constraint pipeline_acces_unique unique (pipeline_id, user_id),
  -- Le couple doit exister : pas de partage pointant vers le pipeline
  -- d'une autre entreprise.
  constraint pipeline_acces_pipeline_same_org
    foreign key (org_id, pipeline_id)
    references public.pipelines_ventes (org_id, id) on delete cascade
);

create index if not exists idx_pipeline_acces_pipeline
  on public.pipeline_acces (pipeline_id);

create index if not exists idx_pipeline_acces_user
  on public.pipeline_acces (user_id);

comment on table public.pipeline_acces is
  'Partage d''un pipeline. AUCUNE ligne = visible de toute l''organisation (le défaut). Une ligne ou plus = réservé aux membres nommés, plus les administrateurs qui voient toujours tout.';

-- ───────────────────────────────────────────────────────────────
-- Le test d'accès, en une fonction
--
-- STABLE et SECURITY DEFINER : appelée par les policies de trois tables et
-- une fois par ligne de `deals`. Sans `definer`, elle relirait
-- `pipeline_acces` sous la RLS de l'appelant — qui dépend d'elle-même.
-- ───────────────────────────────────────────────────────────────
create or replace function public.peut_voir_pipeline(p_user uuid, p_pipeline uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    -- Hors de l'organisation : rien, quoi qu'il arrive.
    exists (
      select 1 from public.pipelines_ventes p
      where p.id = p_pipeline
        and public.has_org_membership(p_user, p.org_id)
    )
    and (
      -- Aucun partage défini : le pipeline est ouvert à l'équipe.
      not exists (select 1 from public.pipeline_acces a where a.pipeline_id = p_pipeline)
      -- Nommé dans le partage.
      or exists (
        select 1 from public.pipeline_acces a
        where a.pipeline_id = p_pipeline and a.user_id = p_user
      )
      -- Administrateur : voit tout, toujours.
      or exists (
        select 1 from public.pipelines_ventes p
        where p.id = p_pipeline
          and public.has_org_admin_role(p_user, p.org_id)
      )
    );
$fn$;

comment on function public.peut_voir_pipeline(uuid, uuid) is
  'Ce membre voit-il ce pipeline ? Aucun partage = tout le monde ; sinon les membres nommés, plus les administrateurs.';

-- Une fonction SECURITY DEFINER n'a rien à faire dans les mains d'anon.
revoke all on function public.peut_voir_pipeline(uuid, uuid) from public, anon;
grant execute on function public.peut_voir_pipeline(uuid, uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- RLS de la table de partage
--
-- Lecture par tout membre : l'écran de partage doit pouvoir afficher qui a
-- accès. Écriture réservée aux administrateurs — un vendeur ne se donne pas
-- l'accès à un pipeline, et n'en prive personne.
-- ───────────────────────────────────────────────────────────────
alter table public.pipeline_acces enable row level security;
alter table public.pipeline_acces force row level security;

drop policy if exists pipeline_acces_select on public.pipeline_acces;
create policy pipeline_acces_select on public.pipeline_acces
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists pipeline_acces_admin_write on public.pipeline_acces;
create policy pipeline_acces_admin_write on public.pipeline_acces
  for all to authenticated
  using (has_org_admin_role((select auth.uid()), org_id))
  with check (has_org_admin_role((select auth.uid()), org_id));

-- ───────────────────────────────────────────────────────────────
-- Les policies existantes tiennent compte du partage
--
-- On REMPLACE les policies de lecture. L'appartenance à l'organisation reste
-- la première condition — `peut_voir_pipeline` la revérifie, mais la garder
-- ici rend la policy lisible sans ouvrir la fonction.
-- ───────────────────────────────────────────────────────────────
drop policy if exists pipelines_ventes_select_org on public.pipelines_ventes;
create policy pipelines_ventes_select_org on public.pipelines_ventes
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and peut_voir_pipeline((select auth.uid()), id)
  );

drop policy if exists pipeline_stages_select_org on public.pipeline_stages;
create policy pipeline_stages_select_org on public.pipeline_stages
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and peut_voir_pipeline((select auth.uid()), pipeline_id)
  );

drop policy if exists deals_select_org on public.deals;
create policy deals_select_org on public.deals
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and peut_voir_pipeline((select auth.uid()), pipeline_id)
  );

commit;
