-- ═══════════════════════════════════════════════════════════════
-- Les raisons de perte deviennent une liste
--
-- LE PROBLÈME. `deals.lost_reason` est du texte libre. Le bloc « Raisons de
-- perte » livré le 2026-09-23 fonctionne, mais si un vendeur écrit « trop
-- cher », un autre « prix », un troisième « trop dispendieux », le graphique
-- compte trois raisons distinctes pour un seul motif. Le seul retour
-- structuré qu'on ait sur POURQUOI on perd devient illisible — exactement la
-- friction relevée chez GoHighLevel, dont le champ `Source` en texte libre
-- rend les rapports inutilisables.
--
-- CE QU'ON FAIT, et ce qu'on ne fait PAS. On ajoute une liste par
-- organisation, avec les motifs du métier au départ. On NE convertit PAS
-- `lost_reason` en clé étrangère :
--
--   · les raisons déjà saisies resteraient orphelines, et on perdrait
--     l'information au moment même où on prétend la structurer ;
--   · un vendeur doit pouvoir écrire un motif que personne n'avait prévu —
--     c'est souvent celui-là qui apprend quelque chose. GHL le permet
--     d'ailleurs (« type in to create new lost reason »).
--
-- La liste est donc une AIDE À LA SAISIE : l'écran propose, l'utilisateur
-- peut ajouter, et le texte reste la vérité. Ce qui change, c'est que quatre
-- vendeurs qui cliquent la même entrée écrivent la même chaîne.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.pipeline_raisons_perte_liste (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  libelle    text not null,
  position   integer not null default 0,
  -- Une raison retirée n'est jamais supprimée : les deals perdus la citent
  -- encore, et l'historique ne doit pas changer parce qu'on a nettoyé une
  -- liste. Elle cesse simplement d'être proposée.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_raisons_perte_org_id_id_uq unique (org_id, id),
  constraint pipeline_raisons_perte_libelle_non_vide check (length(btrim(libelle)) > 0),
  constraint pipeline_raisons_perte_libelle_court check (length(libelle) <= 80)
);

-- Deux fois « Trop cher » dans la même liste : l'utilisateur ne saurait pas
-- laquelle choisir, et les statistiques les compteraient séparément.
-- `lower(btrim())` : « trop cher » et « Trop cher  » sont le même motif.
create unique index if not exists uq_pipeline_raisons_perte_libelle
  on public.pipeline_raisons_perte_liste (org_id, lower(btrim(libelle)));

create index if not exists idx_pipeline_raisons_perte_org
  on public.pipeline_raisons_perte_liste (org_id, position)
  where archived_at is null;

create trigger trg_pipeline_raisons_perte_updated_at
  before update on public.pipeline_raisons_perte_liste
  for each row execute function public.set_updated_at();

comment on table public.pipeline_raisons_perte_liste is
  'Motifs de perte proposés à la saisie, par organisation. `deals.lost_reason` reste du TEXTE : la liste harmonise l''écriture sans empêcher un motif imprévu.';

-- ───────────────────────────────────────────────────────────────
-- RLS — lecture pour l'équipe, écriture pour les admins
--
-- La liste s'impose à tous les vendeurs : elle ne se modifie pas au hasard
-- d'une saisie. C'est le même partage que les étapes du pipeline.
-- ───────────────────────────────────────────────────────────────
alter table public.pipeline_raisons_perte_liste enable row level security;
alter table public.pipeline_raisons_perte_liste force row level security;

drop policy if exists pipeline_raisons_perte_select on public.pipeline_raisons_perte_liste;
create policy pipeline_raisons_perte_select on public.pipeline_raisons_perte_liste
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists pipeline_raisons_perte_admin_write on public.pipeline_raisons_perte_liste;
create policy pipeline_raisons_perte_admin_write on public.pipeline_raisons_perte_liste
  for all to authenticated
  using (has_org_admin_role((select auth.uid()), org_id))
  with check (has_org_admin_role((select auth.uid()), org_id));

-- ───────────────────────────────────────────────────────────────
-- Les motifs du métier, pour les organisations qui ont un pipeline
--
-- Une liste vide ne rendrait service à personne : le vendeur retomberait
-- dans le texte libre, et rien n'aurait changé. On sème donc les motifs
-- courants d'un service terrain — prix, délai, concurrent, injoignable,
-- hors zone, reporté. Chaque organisation les renomme ou les retire.
-- ───────────────────────────────────────────────────────────────
insert into public.pipeline_raisons_perte_liste (org_id, libelle, position)
select p.org_id, m.libelle, m.position
from (select distinct org_id from public.pipelines_ventes) p
cross join (values
  ('Prix trop élevé', 1),
  ('A choisi un concurrent', 2),
  ('Délai trop long', 3),
  ('Client injoignable', 4),
  ('Hors de notre zone', 5),
  ('Projet reporté', 6),
  ('Pas le bon service', 7)
) as m(libelle, position)
on conflict do nothing;

commit;
