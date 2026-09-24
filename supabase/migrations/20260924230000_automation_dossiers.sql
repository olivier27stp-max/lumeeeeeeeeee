-- ═══════════════════════════════════════════════════════════════
-- Les dossiers d'automatisations
--
-- POURQUOI. Le bouton « Nouveau dossier » existait depuis la refonte
-- (#525) et ne faisait qu'afficher « Les dossiers arrivent bientôt ».
-- Même chose pour « Déplacer dans un dossier » dans le menu de chaque
-- ligne. Deux promesses à l'écran, zéro derrière : une entreprise qui
-- dépasse trente automatisations (il y en a 41 en staging) n'a aucun
-- moyen de les ranger.
--
-- CE QU'ON AJOUTE. Une table `automation_folders` et une colonne
-- `folder_id` sur `automation_rules`. Purement ADDITIF : une règle sans
-- dossier garde `folder_id NULL` et s'affiche comme avant. Les 210 règles
-- de production ne bougent pas.
--
-- POURQUOI UNE TABLE ET PAS UN TEXTE. Un simple `folder text` aurait
-- suffi à afficher, mais renommer un dossier aurait demandé de réécrire
-- toutes les règles, et deux fautes de frappe auraient fait deux dossiers.
-- Une table porte le nom une seule fois.
--
-- LA SUPPRESSION NE DÉTRUIT RIEN. `on delete set null` : supprimer un
-- dossier remet ses automatisations à la racine. Elles continuent de
-- tourner — un rangement ne doit jamais faire disparaître un envoi.
--
-- Schéma vérifié avant écriture (SCHEMA_SNAPSHOT.md, 2026-09-23) :
-- `automation_rules` existe, porte `org_id uuid NOT NULL`, et n'a
-- AUCUNE colonne de dossier. `member_has_permission(user, org, clé)`
-- existe et sert déjà aux 4 policies de la table.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.automation_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  -- L'ordre d'affichage, choisi par l'utilisateur. Deux dossiers peuvent
  -- partager une position : on départage ensuite par nom.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_folders_name_non_vide check (length(btrim(name)) > 0),
  constraint automation_folders_name_court check (length(name) <= 60)
);

-- Deux dossiers du même nom dans la même entreprise n'ont aucun sens et
-- rendraient le menu « Déplacer vers » illisible.
create unique index if not exists automation_folders_org_name_uniq
  on public.automation_folders (org_id, lower(btrim(name)));

-- Le rattachement. `set null` : supprimer le dossier range ses
-- automatisations à la racine, il ne les supprime pas.
alter table public.automation_rules
  add column if not exists folder_id uuid
  references public.automation_folders(id) on delete set null;

-- La liste filtre par dossier à chaque affichage.
create index if not exists automation_rules_folder_idx
  on public.automation_rules (org_id, folder_id)
  where folder_id is not null;

-- ── RLS : les mêmes clés que les automatisations elles-mêmes ──
-- Un dossier ne porte aucune donnée client, mais il décide de ce qu'on
-- voit : il suit donc exactement les droits de la page Rôles, comme
-- `automation_rules` (migration 20260924090000).
alter table public.automation_folders enable row level security;
alter table public.automation_folders force row level security;

drop policy if exists automation_folders_select on public.automation_folders;
create policy automation_folders_select
  on public.automation_folders
  for select
  to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.read'));

drop policy if exists automation_folders_insert on public.automation_folders;
create policy automation_folders_insert
  on public.automation_folders
  for insert
  to authenticated
  with check (member_has_permission((select auth.uid()), org_id, 'automations.update'));

-- WITH CHECK autant que USING : sans le premier, on pourrait renommer un
-- dossier en le déplaçant vers une autre entreprise.
drop policy if exists automation_folders_update on public.automation_folders;
create policy automation_folders_update
  on public.automation_folders
  for update
  to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.update'))
  with check (member_has_permission((select auth.uid()), org_id, 'automations.update'));

drop policy if exists automation_folders_delete on public.automation_folders;
create policy automation_folders_delete
  on public.automation_folders
  for delete
  to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.update'));

-- `updated_at` suit les modifications, comme partout ailleurs.
drop trigger if exists automation_folders_touch on public.automation_folders;
create trigger automation_folders_touch
  before update on public.automation_folders
  for each row execute function public.set_updated_at();

comment on table public.automation_folders is
  'Dossiers de rangement des automatisations. Supprimer un dossier remet ses règles à la racine (folder_id set null) — jamais de perte.';
