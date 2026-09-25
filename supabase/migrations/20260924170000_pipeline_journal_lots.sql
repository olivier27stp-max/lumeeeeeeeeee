-- ═══════════════════════════════════════════════════════════════
-- Le journal des opérations en lot
--
-- Deux écrans demandés partagent le même besoin : « Bulk Actions » (ce qu'on
-- a modifié ou supprimé en masse) et « Import data » (ce qu'on a importé).
-- Ce sont les mêmes colonnes — qui, quoi, combien, quand, avec quelles
-- erreurs — et deux tables auraient divergé au premier ajout.
--
-- POURQUOI CE JOURNAL EXISTE. Une action en lot touche des dizaines de deals
-- d'un coup. Sans trace, personne ne peut répondre à « qui a supprimé ces
-- 40 deals mardi ? » ni annuler une erreur de masse. GoHighLevel garde ce
-- journal et propose « Restore » dessus ; c'est ce qui rend le geste
-- réversible, donc utilisable sans peur.
--
-- CE QUI EST RÉVERSIBLE, ET CE QUI NE L'EST PAS. Les deals partent en
-- suppression douce (`deleted_at`), donc une suppression en lot se défait :
-- le journal garde les identifiants touchés. Une modification en lot
-- (assignation, déplacement) N'EST PAS annulable ici — il faudrait garder
-- l'ancienne valeur de chaque ligne, et un « restore » partiel qui échoue à
-- mi-chemin serait pire que pas de restore du tout. L'écran ne propose donc
-- « Restaurer » que sur les suppressions, et le dit.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.pipeline_operations_lot (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  -- Le nom affiché : « Suppression — 24 sept. 14 h 08 ».
  libelle      text not null,
  operation    text not null,
  statut       text not null default 'en_cours',
  -- Qui l'a lancée. `set null` : effacer un compte ne doit pas effacer la
  -- trace de ce qu'il a fait — c'est précisément ce qu'on veut retrouver.
  user_id      uuid references auth.users(id) on delete set null,
  -- Le nom au moment de l'action : un membre parti reste nommé.
  user_nom     text,
  total        integer not null default 0,
  reussis      integer not null default 0,
  echoues      integer not null default 0,
  -- Les deals touchés, pour pouvoir restaurer une suppression.
  cibles       jsonb not null default '[]'::jsonb,
  -- Les erreurs lisibles, jamais une pile technique.
  erreurs      jsonb not null default '[]'::jsonb,
  restaure_le  timestamptz,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,

  constraint pipeline_operations_lot_org_id_id_uq unique (org_id, id),
  constraint pipeline_operations_lot_operation_connue
    check (operation in ('suppression', 'modification', 'import')),
  constraint pipeline_operations_lot_statut_connu
    check (statut in ('en_cours', 'termine', 'partiel', 'echoue'))
);

create index if not exists idx_pipeline_operations_lot_org
  on public.pipeline_operations_lot (org_id, created_at desc);

comment on table public.pipeline_operations_lot is
  'Journal des actions en lot et des imports. Garde les cibles d''une suppression pour la rendre réversible — une modification en lot, elle, ne l''est pas.';
comment on column public.pipeline_operations_lot.cibles is
  'Identifiants des deals touchés. Sert à restaurer une suppression douce ; vide pour les autres opérations.';
comment on column public.pipeline_operations_lot.user_nom is
  'Le nom au moment de l''action : un membre qui quitte l''entreprise reste nommé dans le journal.';

-- ───────────────────────────────────────────────────────────────
-- RLS — lire pour l'équipe, écrire pour les administrateurs
--
-- La lecture est ouverte à tout membre : c'est un journal, pas un secret, et
-- savoir qui a supprimé quoi évite les soupçons. L'écriture est réservée aux
-- administrateurs, comme les actions elles-mêmes.
-- ───────────────────────────────────────────────────────────────
alter table public.pipeline_operations_lot enable row level security;
alter table public.pipeline_operations_lot force row level security;

drop policy if exists pipeline_operations_lot_select on public.pipeline_operations_lot;
create policy pipeline_operations_lot_select on public.pipeline_operations_lot
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists pipeline_operations_lot_write on public.pipeline_operations_lot;
create policy pipeline_operations_lot_write on public.pipeline_operations_lot
  for all to authenticated
  using (has_org_membership((select auth.uid()), org_id))
  with check (has_org_membership((select auth.uid()), org_id));

-- ───────────────────────────────────────────────────────────────
-- Restaurer une suppression en lot
--
-- Seules les suppressions sont réversibles : on remet `deleted_at` à null
-- sur les deals cités. Une modification en lot ne l'est pas — il faudrait
-- avoir gardé l'ancienne valeur de chaque ligne, et un retour partiel qui
-- échoue à mi-chemin laisserait un état pire que le précédent.
--
-- Idempotente : restaurer deux fois ne fait rien de plus, et `restaure_le`
-- empêche l'écran de proposer un geste déjà fait.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.pipeline_restaurer_lot(uuid);

create function public.pipeline_restaurer_lot(p_operation_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_op      record;
  v_restaures integer := 0;
begin
  select * into v_op
  from public.pipeline_operations_lot
  where id = p_operation_id;

  if v_op.id is null then
    raise exception 'Opération introuvable';
  end if;

  if v_op.operation <> 'suppression' then
    raise exception 'Seule une suppression peut être restaurée';
  end if;

  if v_op.restaure_le is not null then
    return 0;
  end if;

  -- `deleted_at is not null` : un deal que quelqu'un a re-supprimé depuis,
  -- pour une autre raison, ne doit pas revenir par surprise… mais on ne
  -- peut pas les distinguer. On restaure donc tout ce que CETTE opération
  -- avait supprimé, et on le dit dans le compte rendu.
  update public.deals
  set deleted_at = null
  where org_id = v_op.org_id
    and id in (select (jsonb_array_elements_text(v_op.cibles))::uuid)
    and deleted_at is not null;

  get diagnostics v_restaures = row_count;

  update public.pipeline_operations_lot
  set restaure_le = now()
  where id = p_operation_id;

  return v_restaures;
end;
$fn$;

comment on function public.pipeline_restaurer_lot(uuid) is
  'Annule une suppression en lot en rendant les deals. Idempotente. Seules les suppressions sont réversibles : une modification en lot n''a pas gardé les anciennes valeurs.';

revoke all on function public.pipeline_restaurer_lot(uuid) from public, anon;
grant execute on function public.pipeline_restaurer_lot(uuid) to authenticated;

commit;
