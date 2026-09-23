-- ═══════════════════════════════════════════════════════════════
-- Pipeline de ventes — schéma (Phase 2, décisions Rafba 2026-09-23)
--
-- L'AVANT-JOB : un lead entre, avance dans des étapes renommables, et
-- « Gagné » mène à la création d'une job. Ce fichier crée le modèle ; il ne
-- touche NI `pipeline_deals` (l'ancien board D2D), NI le moteur
-- d'automatisations — c'est la migration 20260923100100 pour le moteur, et
-- la Phase 3 pour le retrait de l'ancien.
--
-- Décisions structurantes matérialisées ici :
--   · Q2  Le pipeline D2D sera supprimé en Phase 3 ; `deals.pin_id` et
--         `deals.field_rep_id` existent DÈS MAINTENANT pour que la Vente Map
--         et les Commissions puissent se rebrancher sans casser.
--   · Q3  Aucune purge automatique. Gagnés et perdus restent indéfiniment :
--         c'est l'historique de ventes, la matière des statistiques.
--   · Q5  AUCUN montant sur le deal. La valeur vient du devis puis de la job
--         (`quotes.total_cents`, `jobs.total_cents`), jamais saisie ici.
--   · Q9  AUCUNE colonne de priorité : elle se calcule sur l'inactivité
--         (14 j+ urgent, 5-13 j moyen). Une priorité saisie se périme en
--         silence et fausse les statistiques.
--
-- Le « contact » est `clients` (statut 'lead'), conformément à la décision
-- produit de 20260705000000_eliminate_leads_table.sql : on ne réintroduit
-- pas d'entité concurrente. `contacts` (21 lignes, zéro accès code) reste
-- hors de ce chantier.
--
-- Multi-tenancy : `org_id` (PAS `tenant_id`, qui n'existe nulle part).
-- Chaque FK inter-table est COMPOSITE `(org_id, id)` : c'est ce qui rend
-- impossible de pointer une étape ou un client d'une autre organisation.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Pipelines — plusieurs par org dans le modèle, un seul affiché en Q4.
--    (Le D2D pourra revenir comme 2e pipeline sans changement de schéma.)
-- ───────────────────────────────────────────────────────────────
create table if not exists public.pipelines_ventes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint pipelines_ventes_org_id_id_uq unique (org_id, id),
  constraint pipelines_ventes_name_non_vide check (length(btrim(name)) > 0)
);

-- Un seul pipeline par défaut par organisation.
create unique index if not exists uq_pipelines_ventes_defaut
  on public.pipelines_ventes (org_id) where is_default;

create index if not exists idx_pipelines_ventes_org
  on public.pipelines_ventes (org_id);

-- ───────────────────────────────────────────────────────────────
-- 2. Étapes — renommables, réordonnables, archivables.
--    TOUTE la logique métier s'accroche à `kind`, JAMAIS au nom : c'est ce
--    qui garantit que renommer « Relance » ne change aucun comportement.
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage_kind') then
    create type public.pipeline_stage_kind as enum ('open', 'won', 'lost');
  end if;
end
$$;

create table if not exists public.pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  pipeline_id  uuid not null,
  name_fr      text not null,
  name_en      text not null,
  guidance_fr  text not null default '',
  guidance_en  text not null default '',
  position     integer not null,
  kind         public.pipeline_stage_kind not null default 'open',
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pipeline_stages_org_id_id_uq unique (org_id, id),
  constraint pipeline_stages_pipeline_same_org
    foreign key (org_id, pipeline_id)
    references public.pipelines_ventes (org_id, id) on delete cascade,
  constraint pipeline_stages_noms_non_vides
    check (length(btrim(name_fr)) > 0 and length(btrim(name_en)) > 0),
  constraint pipeline_stages_position_positive check (position > 0)
);

-- Position unique par pipeline, DEFERRABLE : réordonner, c'est permuter deux
-- positions dans une même transaction — sans ce report, la permutation
-- échouerait au milieu, sur la position intermédiaire en doublon.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pipeline_stages_position_unique'
  ) then
    alter table public.pipeline_stages
      add constraint pipeline_stages_position_unique
      unique (pipeline_id, position) deferrable initially deferred;
  end if;
end
$$;

create index if not exists idx_pipeline_stages_pipeline
  on public.pipeline_stages (org_id, pipeline_id, position)
  where archived_at is null;

-- ───────────────────────────────────────────────────────────────
-- 3. Deals — le cœur. Pas de montant (Q5), pas de priorité (Q9).
-- ───────────────────────────────────────────────────────────────
create table if not exists public.deals (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  pipeline_id        uuid not null,
  stage_id           uuid not null,

  -- Le contact EST un client (statut 'lead'). Voir eliminate_leads_table.
  client_id          uuid not null,

  -- Assignation : un lead entrant arrive NON ASSIGNÉ (décision 5 du plan).
  assigned_user_id   uuid references auth.users(id) on delete set null,
  assigned_at        timestamptz,

  -- Provenance. `source` reste libre pour accueillir de futurs canaux.
  source             text not null default 'manual',
  external_id        text,
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  utm_content        text,
  fbclid             text,
  raw_payload        jsonb not null default '{}'::jsonb,

  -- Lien vers la job. NULL sur une étape « won » = badge « Job à créer »,
  -- qui est DÉRIVÉ de ces deux colonnes et n'est jamais stocké.
  job_id             uuid,
  quote_id           uuid,

  -- Suivi. `first_contacted_at` est posé par la PREMIÈRE activité sortante
  -- et n'est jamais modifié ensuite (garanti par trigger plus bas).
  first_contacted_at timestamptz,
  last_activity_at   timestamptz not null default now(),
  stage_entered_at   timestamptz not null default now(),
  won_at             timestamptz,
  lost_at            timestamptz,
  lost_reason        text,
  lost_from_stage_id uuid,

  -- Rattachements D2D, pour que la Vente Map et les Commissions se
  -- rebranchent en Phase 3 sans rupture (Q2).
  pin_id             uuid references public.field_pins(id) on delete set null,
  field_rep_id       uuid,

  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  constraint deals_org_id_id_uq unique (org_id, id),
  constraint deals_pipeline_same_org
    foreign key (org_id, pipeline_id)
    references public.pipelines_ventes (org_id, id) on delete cascade,
  -- Impossible d'assigner une étape d'une autre org OU d'un autre pipeline :
  -- l'appartenance au bon pipeline est vérifiée par trigger (plus bas).
  constraint deals_stage_same_org
    foreign key (org_id, stage_id)
    references public.pipeline_stages (org_id, id),
  constraint deals_client_same_org
    foreign key (org_id, client_id)
    references public.clients (org_id, id) on delete cascade,
  constraint deals_job_same_org
    foreign key (org_id, job_id)
    references public.jobs (org_id, id) on delete set null,
  constraint deals_quote_same_org
    foreign key (org_id, quote_id)
    references public.quotes (org_id, id) on delete set null,
  constraint deals_lost_from_stage_same_org
    foreign key (org_id, lost_from_stage_id)
    references public.pipeline_stages (org_id, id) on delete set null,
  -- Une raison de perte n'a de sens que sur un deal perdu.
  constraint deals_raison_perte_coherente
    check (lost_reason is null or lost_at is not null)
);

-- Idempotence de l'ingestion : une même soumission ne crée jamais deux deals.
create unique index if not exists uq_deals_source_externe
  on public.deals (org_id, source, external_id)
  where external_id is not null and deleted_at is null;

-- Index pour les statistiques (Phase 6).
create index if not exists idx_deals_org_cree
  on public.deals (org_id, created_at desc) where deleted_at is null;
create index if not exists idx_deals_org_etape
  on public.deals (org_id, stage_id) where deleted_at is null;
create index if not exists idx_deals_org_campagne
  on public.deals (org_id, source, utm_campaign) where deleted_at is null;
create index if not exists idx_deals_org_assigne
  on public.deals (org_id, assigned_user_id) where deleted_at is null;
create index if not exists idx_deals_org_client
  on public.deals (org_id, client_id) where deleted_at is null;
-- « Job à créer » et « sans activité » : deux listes de la page À traiter.
create index if not exists idx_deals_job_a_creer
  on public.deals (org_id, stage_id) where job_id is null and deleted_at is null;
create index if not exists idx_deals_org_activite
  on public.deals (org_id, last_activity_at) where deleted_at is null;

-- ───────────────────────────────────────────────────────────────
-- 4. Historique des étapes — la source de vérité de l'entonnoir.
--    Un deal qui est PASSÉ par une étape y compte, même s'il l'a quittée.
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'deal_actor_type') then
    create type public.deal_actor_type as enum ('user', 'automation', 'lumi', 'system');
  end if;
end
$$;

create table if not exists public.deal_stage_history (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  deal_id       uuid not null,
  from_stage_id uuid,
  to_stage_id   uuid not null,
  actor_type    public.deal_actor_type not null default 'user',
  actor_id      uuid,
  created_at    timestamptz not null default now(),
  constraint deal_stage_history_org_id_id_uq unique (org_id, id),
  constraint deal_stage_history_deal_same_org
    foreign key (org_id, deal_id)
    references public.deals (org_id, id) on delete cascade,
  -- Pas de FK sur les étapes : une étape archivée reste dans l'historique,
  -- et l'historique doit survivre à tout (décision Q3).
  constraint deal_stage_history_mouvement_reel
    check (from_stage_id is distinct from to_stage_id)
);

create index if not exists idx_deal_stage_history_deal
  on public.deal_stage_history (org_id, deal_id, created_at);
create index if not exists idx_deal_stage_history_etape
  on public.deal_stage_history (org_id, to_stage_id, created_at);

-- ───────────────────────────────────────────────────────────────
-- 5. Garde-fous en base (ce que l'UI promet, la base le tient)
-- ───────────────────────────────────────────────────────────────

-- 5a. Une étape doit appartenir au pipeline du deal. La FK composite garantit
--     la même org ; celle-ci garantit le même pipeline.
create or replace function public.deals_verifier_etape()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pipeline uuid;
  v_archivee timestamptz;
begin
  select pipeline_id, archived_at into v_pipeline, v_archivee
  from public.pipeline_stages
  where id = new.stage_id and org_id = new.org_id;

  if v_pipeline is null then
    raise exception 'Étape introuvable dans cette organisation';
  end if;

  if v_pipeline <> new.pipeline_id then
    raise exception 'L''étape appartient à un autre pipeline';
  end if;

  -- Une étape archivée ne reçoit plus de deal (mais garde les siens).
  if v_archivee is not null
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    raise exception 'Cette étape est archivée : elle ne peut plus recevoir de deal';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_deals_verifier_etape on public.deals;
create trigger trg_deals_verifier_etape
  before insert or update of stage_id, pipeline_id on public.deals
  for each row execute function public.deals_verifier_etape();

-- 5b. Archiver une étape qui contient encore des deals est refusé.
create or replace function public.pipeline_stages_verifier_archivage()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_restants integer;
  v_memes    integer;
begin
  if new.archived_at is null or old.archived_at is not null then
    return new;
  end if;

  select count(*) into v_restants
  from public.deals
  where stage_id = new.id and deleted_at is null;

  if v_restants > 0 then
    raise exception 'Impossible d''archiver : % deal(s) sont encore à cette étape', v_restants;
  end if;

  -- Il doit toujours rester une étape ouverte, une gagnée et une perdue.
  select count(*) into v_memes
  from public.pipeline_stages
  where pipeline_id = new.pipeline_id
    and kind = new.kind
    and archived_at is null
    and id <> new.id;

  if v_memes = 0 then
    raise exception 'Il doit rester au moins une étape « % » active', new.kind;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_pipeline_stages_archivage on public.pipeline_stages;
create trigger trg_pipeline_stages_archivage
  before update of archived_at on public.pipeline_stages
  for each row execute function public.pipeline_stages_verifier_archivage();

-- 5c. Horodatages + historique, écrits par la BASE pour que TOUS les chemins
--     (UI, Lumi, import, SQL) produisent le même historique. C'est la
--     condition pour que les statistiques soient fiables.
--
--     Deux triggers séparés, et ce n'est pas un détail : l'horodatage doit
--     être BEFORE (il modifie NEW), alors que l'historique doit être AFTER
--     (en INSERT, la ligne `deals` n'existe pas encore, donc sa FK non plus).
create or replace function public.deals_horodater_etape()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind public.pipeline_stage_kind;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select kind into v_kind from public.pipeline_stages where id = new.stage_id;

  new.stage_entered_at := now();
  new.last_activity_at := now();

  if v_kind = 'won' then
    new.won_at := coalesce(new.won_at, now());
    new.lost_at := null;
    new.lost_reason := null;
  elsif v_kind = 'lost' then
    new.lost_at := coalesce(new.lost_at, now());
    new.won_at := null;
    if tg_op = 'UPDATE' then
      new.lost_from_stage_id := coalesce(new.lost_from_stage_id, old.stage_id);
    end if;
  else
    new.won_at := null;
    new.lost_at := null;
    new.lost_reason := null;
  end if;

  return new;
end;
$fn$;

create or replace function public.deals_ecrire_historique()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  insert into public.deal_stage_history (org_id, deal_id, from_stage_id, to_stage_id, actor_type, actor_id)
  values (
    new.org_id,
    new.id,
    case when tg_op = 'UPDATE' then old.stage_id else null end,
    new.stage_id,
    case when auth.uid() is null then 'system'::public.deal_actor_type
         else 'user'::public.deal_actor_type end,
    auth.uid()
  );

  return null;
end;
$fn$;

create trigger trg_deals_horodater_etape
  before insert or update of stage_id on public.deals
  for each row execute function public.deals_horodater_etape();

create trigger trg_deals_ecrire_historique
  after insert or update of stage_id on public.deals
  for each row execute function public.deals_ecrire_historique();

-- 5d. `first_contacted_at` ne se pose qu'une fois : c'est la mesure de la
--     vitesse de premier contact, elle serait fausse si on pouvait la rejouer.
create or replace function public.deals_figer_premier_contact()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if old.first_contacted_at is not null then
    new.first_contacted_at := old.first_contacted_at;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_deals_figer_premier_contact on public.deals;
create trigger trg_deals_figer_premier_contact
  before update on public.deals
  for each row execute function public.deals_figer_premier_contact();

-- 5e. `updated_at` — helper maison déjà utilisé partout.
drop trigger if exists trg_pipelines_ventes_updated on public.pipelines_ventes;
create trigger trg_pipelines_ventes_updated
  before update on public.pipelines_ventes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pipeline_stages_updated on public.pipeline_stages;
create trigger trg_pipeline_stages_updated
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

drop trigger if exists trg_deals_updated on public.deals;
create trigger trg_deals_updated
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────
-- 6. RLS — aucune table sans politique, FORCE pour que le propriétaire de
--    la table lui-même y soit soumis (convention du projet).
-- ───────────────────────────────────────────────────────────────
alter table public.pipelines_ventes   enable row level security;
alter table public.pipelines_ventes   force row level security;
alter table public.pipeline_stages    enable row level security;
alter table public.pipeline_stages    force row level security;
alter table public.deals              enable row level security;
alter table public.deals              force row level security;
alter table public.deal_stage_history enable row level security;
alter table public.deal_stage_history force row level security;

-- Lecture : tout membre de l'organisation.
drop policy if exists pipelines_ventes_select_org on public.pipelines_ventes;
create policy pipelines_ventes_select_org on public.pipelines_ventes
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists pipeline_stages_select_org on public.pipeline_stages;
create policy pipeline_stages_select_org on public.pipeline_stages
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists deals_select_org on public.deals;
create policy deals_select_org on public.deals
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists deal_stage_history_select_org on public.deal_stage_history;
create policy deal_stage_history_select_org on public.deal_stage_history
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

-- Configuration du pipeline (étapes, guidance) : réservée aux administrateurs.
drop policy if exists pipelines_ventes_admin_write on public.pipelines_ventes;
create policy pipelines_ventes_admin_write on public.pipelines_ventes
  for all to authenticated
  using (has_org_admin_role((select auth.uid()), org_id))
  with check (has_org_admin_role((select auth.uid()), org_id));

drop policy if exists pipeline_stages_admin_write on public.pipeline_stages;
create policy pipeline_stages_admin_write on public.pipeline_stages
  for all to authenticated
  using (has_org_admin_role((select auth.uid()), org_id))
  with check (has_org_admin_role((select auth.uid()), org_id));

-- Les deals suivent les permissions « leads » de la page Rôles, comme le
-- reste du CRM (member_has_permission reproduit hasPermission côté client).
drop policy if exists deals_insert_perm on public.deals;
create policy deals_insert_perm on public.deals
  for insert to authenticated
  with check (
    has_org_membership((select auth.uid()), org_id)
    and member_has_permission((select auth.uid()), org_id, 'leads.create')
  );

drop policy if exists deals_update_perm on public.deals;
create policy deals_update_perm on public.deals
  for update to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and member_has_permission((select auth.uid()), org_id, 'leads.update')
  )
  with check (
    has_org_membership((select auth.uid()), org_id)
    and member_has_permission((select auth.uid()), org_id, 'leads.update')
  );

drop policy if exists deals_delete_perm on public.deals;
create policy deals_delete_perm on public.deals
  for delete to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and member_has_permission((select auth.uid()), org_id, 'leads.delete')
  );

-- L'historique n'est jamais écrit à la main : seuls les triggers
-- (SECURITY DEFINER) y insèrent. Aucune policy d'écriture pour les clients.

comment on table public.deals is
  'Pipeline de ventes (avant-job). Aucun montant : la valeur vient du devis puis de la job. Aucune priorité : elle se calcule sur l''inactivité.';
comment on column public.deals.job_id is
  'NULL sur une étape « won » = badge « Job à créer », dérivé, jamais stocké.';
comment on column public.deals.first_contacted_at is
  'Posé par la première activité sortante, figé ensuite (trigger) : base de la vitesse de premier contact.';
comment on table public.deal_stage_history is
  'Source de vérité de l''entonnoir : un deal qui est PASSÉ par une étape y compte, même s''il l''a quittée. Jamais purgé.';

commit;
