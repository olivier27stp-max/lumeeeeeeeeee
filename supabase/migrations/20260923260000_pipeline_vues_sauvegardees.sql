-- ═══════════════════════════════════════════════════════════════
-- Vues sauvegardées du board — persistantes, pas un état de composant
--
-- CE QUI EXISTAIT. Le board affiche quatre onglets (`VUES` dans
-- PipelineBoard.tsx) codés EN DUR : ni créables, ni modifiables, ni
-- conservés d'une session à l'autre. Deux d'entre eux — « Ouverts » et
-- « Tous » — portent exactement les mêmes filtres et montrent donc la même
-- chose : un onglet qui ment sur ce qu'il fait.
--
-- CE QU'ON FAIT. Une vraie table. Un vendeur qui se bâtit « Mes soumissions
-- de plus de 5 000 $ » la retrouve demain, sur son téléphone comme sur
-- l'ordinateur du bureau — ce qu'un `localStorage` ne donne jamais (il meurt
-- avec le navigateur, ne suit pas l'appareil, et reste invisible au partage).
--
-- PORTÉE D'UNE VUE. `user_id` NULL = vue d'entreprise, visible de tous et
-- modifiable par les admins seulement. `user_id` renseigné = vue privée, que
-- son auteur seul voit et modifie. Le board mélange les deux dans la même
-- barre d'onglets ; c'est la RLS qui décide de ce qui apparaît, jamais le
-- client.
--
-- LES FILTRES EN JSONB, volontairement : la forme des filtres du board va
-- bouger (l'audit du 2026-09-23 réclame déjà l'étape, le montant, la date).
-- Une colonne par filtre imposerait une migration à chaque ajout, et une
-- vue enregistrée avant l'ajout deviendrait invalide. Le client ignore les
-- clés qu'il ne connaît pas : une vue survit donc aux versions.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.pipeline_vues (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  -- La vue suit son pipeline : une vue « gros contrats » n'a aucun sens sur
  -- le pipeline de nettoyage résidentiel.
  pipeline_id uuid not null,
  -- NULL = vue d'entreprise. Sinon, vue privée de ce membre.
  user_id     uuid references auth.users(id) on delete cascade,
  nom         text not null,
  -- { texte, source, assigne, priorite, … } — voir EtatFiltres côté client.
  filtres     jsonb not null default '{}'::jsonb,
  tri         text,
  affichage   text,
  position    integer not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint pipeline_vues_org_id_id_uq unique (org_id, id),
  constraint pipeline_vues_nom_non_vide check (length(btrim(nom)) > 0),
  constraint pipeline_vues_nom_court check (length(nom) <= 60),
  -- Le même couple (org, pipeline) doit exister : pas de vue orpheline
  -- pointant vers le pipeline d'une autre entreprise.
  constraint pipeline_vues_pipeline_same_org
    foreign key (org_id, pipeline_id)
    references public.pipelines_ventes (org_id, id) on delete cascade,
  -- Les deux valeurs viennent du client : on les borne en base, sinon une
  -- vue enregistrée avec « tri: bidon » casserait l'affichage au chargement.
  constraint pipeline_vues_tri_connu
    check (tri is null or tri in ('ancien', 'recent', 'montant', 'inactif')),
  constraint pipeline_vues_affichage_connu
    check (affichage is null or affichage in ('kanban', 'liste'))
);

-- Deux vues du même nom, sur le même pipeline, pour le même propriétaire :
-- l'utilisateur ne saurait plus laquelle il ouvre. Deux index partiels,
-- parce qu'en SQL `null = null` est faux — un index unique ordinaire
-- laisserait passer autant de doublons d'entreprise qu'on veut.
create unique index if not exists uq_pipeline_vues_nom_perso
  on public.pipeline_vues (org_id, pipeline_id, user_id, lower(btrim(nom)))
  where user_id is not null;

create unique index if not exists uq_pipeline_vues_nom_org
  on public.pipeline_vues (org_id, pipeline_id, lower(btrim(nom)))
  where user_id is null;

create index if not exists idx_pipeline_vues_pipeline
  on public.pipeline_vues (org_id, pipeline_id, position);

create trigger trg_pipeline_vues_updated_at
  before update on public.pipeline_vues
  for each row execute function public.set_updated_at();

comment on table public.pipeline_vues is
  'Vues sauvegardées du board (filtres + tri + affichage). user_id NULL = vue d''entreprise ; sinon vue privée du membre.';
comment on column public.pipeline_vues.filtres is
  'Filtres en jsonb pour survivre aux versions : le client ignore les clés qu''il ne connaît pas.';

-- ───────────────────────────────────────────────────────────────
-- RLS — mêmes garanties que le reste du pipeline
-- ───────────────────────────────────────────────────────────────
alter table public.pipeline_vues enable row level security;
alter table public.pipeline_vues force row level security;

-- Lecture : les vues d'entreprise, plus les siennes.
drop policy if exists pipeline_vues_select on public.pipeline_vues;
create policy pipeline_vues_select on public.pipeline_vues
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and (user_id is null or user_id = (select auth.uid()))
  );

-- Écriture d'une vue PRIVÉE : son propriétaire, et lui seul.
drop policy if exists pipeline_vues_perso_write on public.pipeline_vues;
create policy pipeline_vues_perso_write on public.pipeline_vues
  for all to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and user_id = (select auth.uid())
  )
  with check (
    has_org_membership((select auth.uid()), org_id)
    and user_id = (select auth.uid())
  );

-- Écriture d'une vue D'ENTREPRISE : les admins. Elle s'impose à toute
-- l'équipe, donc elle ne se crée pas par accident.
drop policy if exists pipeline_vues_org_write on public.pipeline_vues;
create policy pipeline_vues_org_write on public.pipeline_vues
  for all to authenticated
  using (has_org_admin_role((select auth.uid()), org_id) and user_id is null)
  with check (has_org_admin_role((select auth.uid()), org_id) and user_id is null);

commit;
