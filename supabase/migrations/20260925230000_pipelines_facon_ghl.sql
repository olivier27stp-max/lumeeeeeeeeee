-- ═══════════════════════════════════════════════════════════════
-- Onglet « Pipelines » façon GoHighLevel — structure et fonctions
--
-- Mission du 2026-09-25. Cette migration pose ce que l'écran GHL exige et que
-- la base n'avait pas. Mesures faites en prod avant de l'écrire :
--
--  · SUPPRIMER UN PIPELINE EFFAÇAIT SES DEALS. `supprimerPipeline` faisait un
--    vrai DELETE et `deals.pipeline_id` est en ON DELETE CASCADE : les deals,
--    les automatisations, les vues et les accès du pipeline partaient avec
--    lui, définitivement. Désormais : archivage (`archived_at`), et les deals
--    sont DÉPLACÉS vers un pipeline + une étape choisis avant.
--  · RÉORDONNER LES ÉTAPES ÉTAIT CASSÉ. `pipeline_reordonner_etapes` faisait
--    `set constraints pipeline_stages_position_unique deferred`, or ce nom
--    désigne un INDEX PARTIEL, pas une contrainte : l'appel échouait
--    toujours (« constraint does not exist », reproduit sur staging avec une
--    liste vide). Réécrite en deux passes.
--  · Aucun ordre ni archivage de pipeline ; probabilité entière (GHL : 14,29) ;
--    un seul interrupteur « rapports » (GHL : entonnoir ET camembert) ; accès
--    par membre en LECTURE seulement.
--
-- DÉCISIONS (validées par Rafba) :
--  · Le pipeline PAR DÉFAUT est le premier de la liste. `is_default` reste la
--    colonne que lit toute la base (ingest_lead, seed, conversion) ; elle est
--    resynchronisée à chaque réordonnancement, création, archivage.
--  · « Sous-comptes » GHL = nos BUREAUX (multi-bureaux) : copie limitée aux
--    bureaux où l'appelant est administrateur.
--  · Déplacer des deals pour supprimer une étape ou un pipeline est un geste
--    ADMINISTRATIF : il ne doit déclencher aucune automatisation (courriel,
--    SMS) chez les clients concernés. L'historique d'étapes, lui, s'écrit.
--
-- ADDITIF : colonnes ajoutées avec défaut, type de `probability` élargi
-- (entier → numeric(5,2), sans perte), fonctions nouvelles ou retouchées,
-- probabilités VIDES remplies (jamais écrasées). Aucune ligne supprimée.
--
-- ROLLBACK (dans l'ordre) :
--   drop function if exists public.pipeline_enregistrer(uuid, text, text, boolean, jsonb);
--   drop function if exists public.pipeline_dupliquer(uuid);
--   drop function if exists public.pipeline_copier_vers_bureaux(uuid, uuid[]);
--   drop function if exists public.pipeline_reordonner(uuid[]);
--   drop function if exists public.pipeline_supprimer(uuid, uuid, uuid);
--   drop function if exists public.pipeline_supprimer_etape(uuid, uuid);
--   drop function if exists public.pipeline_repartition_etapes(uuid);
--   drop function if exists public.pipeline_bureaux_administres();
--   drop function if exists public._pipeline_copier(uuid, uuid, text, uuid);
--   drop trigger if exists trg_pipelines_ventes_position on public.pipelines_ventes;
--   drop function if exists public.pipelines_ventes_position_initiale();
--   drop function if exists public.pipeline_resynchroniser_defaut(uuid);
--   drop function if exists public.peut_modifier_pipeline(uuid, uuid);
--   restaurer les policies *_admin_write d'origine (has_org_admin_role seul) ;
--   rejouer les définitions précédentes de ingest_lead, pipeline_creer_deal,
--   lead_converti_gagne_pipeline, deals_emettre_evenements,
--   pipeline_reordonner_etapes, pipeline_entonnoir, creer_pipeline_sur_mesure ;
--   drop index if exists public.uq_pipelines_ventes_nom;
--   alter table public.pipeline_acces drop column if exists peut_modifier;
--   alter table public.pipeline_stages drop column if exists show_in_pie;
--   alter table public.pipeline_stages alter column probability type integer
--     using round(probability)::integer;
--   alter table public.pipelines_ventes drop column if exists archived_at,
--     drop column if exists position;
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Colonnes ─────────────────────────────────────────────────

alter table public.pipelines_ventes
  add column if not exists position integer,
  add column if not exists archived_at timestamptz;

-- Ordre initial : le défaut d'abord, puis par ancienneté — ce que chaque
-- organisation voit déjà aujourd'hui.
update public.pipelines_ventes p
set position = o.rang
from (
  select id, row_number() over (partition by org_id order by is_default desc, created_at, id) as rang
  from public.pipelines_ventes
) o
where o.id = p.id and p.position is null;

alter table public.pipelines_ventes alter column position set not null;
alter table public.pipelines_ventes alter column position set default 1;

comment on column public.pipelines_ventes.position is
  'Ordre dans la liste « Pipelines » (1 = premier = pipeline par défaut). Utilisé partout où l''on choisit un pipeline.';
comment on column public.pipelines_ventes.archived_at is
  'Suppression douce. Un pipeline archivé n''a plus de deals (déplacés avant) et n''est plus proposé nulle part.';

create index if not exists idx_pipelines_ventes_ordre
  on public.pipelines_ventes (org_id, position) where archived_at is null;

-- Nom unique par organisation, parmi les pipelines actifs, sans tenir compte
-- de la casse ni des espaces : « Ventes » et « ventes  » se confondraient
-- dans un menu. Vérifié : aucun doublon en prod au 2026-09-25.
create unique index if not exists uq_pipelines_ventes_nom
  on public.pipelines_ventes (org_id, lower(btrim(name))) where archived_at is null;

-- Probabilité à deux décimales (GHL répartit 100/7 = 14,29).
alter table public.pipeline_stages
  alter column probability type numeric(5,2) using probability::numeric(5,2);

-- Second interrupteur « Afficher dans les rapports » : le camembert.
-- `show_in_reports` reste l'entonnoir (et les prévisions, qui le lisaient déjà).
alter table public.pipeline_stages
  add column if not exists show_in_pie boolean not null default true;
comment on column public.pipeline_stages.show_in_reports is
  'Icône ENTONNOIR : l''étape compte dans l''entonnoir et les prévisions.';
comment on column public.pipeline_stages.show_in_pie is
  'Icône CAMEMBERT : l''étape apparaît dans la répartition par étape.';

-- Accès par membre : voir (la ligne existe) ET, désormais, modifier.
alter table public.pipeline_acces
  add column if not exists peut_modifier boolean not null default false;

-- ── 2. Qui peut modifier un pipeline ────────────────────────────

create or replace function public.peut_modifier_pipeline(p_user uuid, p_pipeline uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.pipelines_ventes p
    where p.id = p_pipeline
      and (
        public.has_org_admin_role(p_user, p.org_id)
        or (
          public.has_org_membership(p_user, p.org_id)
          and exists (
            select 1 from public.pipeline_acces a
            where a.pipeline_id = p.id and a.user_id = p_user and a.peut_modifier
          )
        )
      )
  );
$fn$;
revoke all on function public.peut_modifier_pipeline(uuid, uuid) from public, anon;
grant execute on function public.peut_modifier_pipeline(uuid, uuid) to authenticated;

-- Pipelines : créer et supprimer restent réservés aux administrateurs ; un
-- membre à qui l'on a donné « Modifier » peut changer CE pipeline.
drop policy if exists pipelines_ventes_admin_write on public.pipelines_ventes;
create policy pipelines_ventes_admin_insert on public.pipelines_ventes
  for insert to authenticated
  with check (has_org_admin_role((select auth.uid()), org_id));
create policy pipelines_ventes_admin_delete on public.pipelines_ventes
  for delete to authenticated
  using (has_org_admin_role((select auth.uid()), org_id));
create policy pipelines_ventes_modifier on public.pipelines_ventes
  for update to authenticated
  using (peut_modifier_pipeline((select auth.uid()), id))
  with check (peut_modifier_pipeline((select auth.uid()), id));

-- Étapes : l'éditeur du pipeline les gère toutes.
drop policy if exists pipeline_stages_admin_write on public.pipeline_stages;
create policy pipeline_stages_modifier on public.pipeline_stages
  for all to authenticated
  using (peut_modifier_pipeline((select auth.uid()), pipeline_id))
  with check (peut_modifier_pipeline((select auth.uid()), pipeline_id));

-- ── 3. Le défaut suit l'ordre ───────────────────────────────────

create or replace function public.pipeline_resynchroniser_defaut(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_premier uuid;
begin
  select id into v_premier
  from public.pipelines_ventes
  where org_id = p_org and archived_at is null
  order by position, created_at, id
  limit 1;

  -- Deux temps : l'index unique « un seul défaut par org » interdit d'en
  -- avoir deux, même un instant.
  update public.pipelines_ventes
  set is_default = false
  where org_id = p_org and is_default and id is distinct from v_premier;

  if v_premier is not null then
    update public.pipelines_ventes
    set is_default = true
    where id = v_premier and not is_default;
  end if;
end;
$fn$;
revoke all on function public.pipeline_resynchroniser_defaut(uuid) from public, anon, authenticated;

-- Un pipeline créé par N'IMPORTE QUEL chemin (seed, modèle, sur mesure,
-- duplication, copie) se range en dernier.
create or replace function public.pipelines_ventes_position_initiale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  select coalesce(max(position), 0) + 1 into new.position
  from public.pipelines_ventes
  where org_id = new.org_id and archived_at is null;
  return new;
end;
$fn$;
revoke all on function public.pipelines_ventes_position_initiale() from public, anon, authenticated;

drop trigger if exists trg_pipelines_ventes_position on public.pipelines_ventes;
create trigger trg_pipelines_ventes_position
  before insert on public.pipelines_ventes
  for each row execute function public.pipelines_ventes_position_initiale();

-- ── 4. Réordonner les étapes (réparé) ───────────────────────────

create or replace function public.pipeline_reordonner_etapes(p_ordre jsonb)
returns void
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  if p_ordre is null or jsonb_typeof(p_ordre) <> 'array' then
    raise exception 'p_ordre doit être un tableau [{id, position}]';
  end if;

  -- L'unicité (pipeline_id, position) est un INDEX PARTIEL : il ne se
  -- reporte pas. Deux passes : on écarte d'abord les étapes visées hors de
  -- toute position existante, puis on pose les positions finales.
  update public.pipeline_stages s
  set position = s.position + 100000
  from jsonb_array_elements(p_ordre) as e
  where s.id = (e.value ->> 'id')::uuid;

  update public.pipeline_stages s
  set position = (e.value ->> 'position')::integer,
      updated_at = now()
  from jsonb_array_elements(p_ordre) as e
  where s.id = (e.value ->> 'id')::uuid;

  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'Aucune étape modifiée : vérifier les identifiants et les droits';
  end if;
end;
$fn$;

-- ── 5. Déplacements administratifs sans automatisations ─────────
-- (deals_emettre_evenements est redéfinie plus bas avec ce garde.)

-- ── 6. Outils internes ──────────────────────────────────────────

-- Un nom libre dans l'organisation : « Ventes », puis « Ventes (2) »…
create or replace function public._pipeline_nom_libre(p_org uuid, p_base text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_nom text := btrim(p_base);
  v_i   integer := 1;
begin
  while exists (
    select 1 from public.pipelines_ventes
    where org_id = p_org and archived_at is null and lower(btrim(name)) = lower(v_nom)
  ) loop
    v_i := v_i + 1;
    v_nom := btrim(p_base) || ' (' || v_i || ')';
  end loop;
  return v_nom;
end;
$fn$;
revoke all on function public._pipeline_nom_libre(uuid, text) from public, anon, authenticated;

-- Copie un pipeline (réglages + étapes actives, SANS les deals) vers une
-- organisation, sous un nom donné. Aucune vérification de droits ici : les
-- fonctions publiques qui l'appellent les font.
create or replace function public._pipeline_copier(p_source uuid, p_org uuid, p_nom text, p_uid uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_nouveau uuid;
begin
  insert into public.pipelines_ventes (org_id, name, is_default, color_mode, use_deal_probability)
  select p_org, public._pipeline_nom_libre(p_org, p_nom), false, s.color_mode, s.use_deal_probability
  from public.pipelines_ventes s
  where s.id = p_source
  returning id into v_nouveau;

  if v_nouveau is null then
    raise exception 'Pipeline introuvable';
  end if;

  insert into public.pipeline_stages (
    org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en,
    position, kind, probability, show_in_reports, show_in_pie
  )
  select
    p_org, v_nouveau, e.name_fr, e.name_en, e.guidance_fr, e.guidance_en,
    row_number() over (order by e.position), e.kind, e.probability,
    e.show_in_reports, e.show_in_pie
  from public.pipeline_stages e
  where e.pipeline_id = p_source and e.archived_at is null;

  perform public.pipeline_resynchroniser_defaut(p_org);
  return v_nouveau;
end;
$fn$;
revoke all on function public._pipeline_copier(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ── 7. Créer / modifier (le modal « Créer un pipeline ») ────────
--
-- p_etapes : [{ id?, nom_fr, nom_en?, kind?, probability?, show_in_reports?,
--               show_in_pie? }] DANS L'ORDRE voulu.
-- Création : p_id null. Modification : p_id = le pipeline ; une étape absente
-- de la liste est supprimée (archivée) — refusé si elle contient des deals
-- (la page du pipeline propose alors de les déplacer).

create or replace function public.pipeline_enregistrer(
  p_id uuid,
  p_nom text,
  p_color_mode text,
  p_use_deal_probability boolean,
  p_etapes jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org      uuid := current_org_id();
  v_uid      uuid := auth.uid();
  v_nom      text := btrim(coalesce(p_nom, ''));
  v_mode     text := coalesce(nullif(btrim(coalesce(p_color_mode, '')), ''), 'none');
  v_pipeline uuid := p_id;
  v_e        jsonb;
  v_kind     text;
  v_proba    numeric;
  v_nb_open  integer := 0;
  v_rang_open integer := 0;
  v_pos      integer := 0;
  v_id       uuid;
  v_gardes   uuid[] := '{}';
  v_a_gagne  boolean := false;
  v_a_perdu  boolean := false;
begin
  if v_org is null or v_uid is null then
    raise exception 'Aucune session';
  end if;
  if v_nom = '' then
    raise exception 'Le nom du pipeline est requis';
  end if;
  if v_mode not in ('none', 'dot', 'tint') then
    raise exception 'Mode de couleur inconnu : %', v_mode;
  end if;
  if jsonb_typeof(p_etapes) is distinct from 'array' then
    raise exception 'Les étapes doivent être une liste';
  end if;

  -- Validation complète AVANT toute écriture.
  for v_e in select * from jsonb_array_elements(p_etapes) loop
    v_kind := coalesce(v_e ->> 'kind', 'open');
    if v_kind not in ('open', 'won', 'lost') then
      raise exception 'Type d''étape inconnu : %', v_kind;
    end if;
    if btrim(coalesce(v_e ->> 'nom_fr', '')) = '' then
      raise exception 'Chaque étape doit avoir un nom';
    end if;
    v_proba := nullif(v_e ->> 'probability', '')::numeric;
    if v_proba is not null and (v_proba < 0 or v_proba > 100) then
      raise exception 'La probabilité doit être comprise entre 0 et 100';
    end if;
    if v_kind = 'open' then v_nb_open := v_nb_open + 1; end if;
  end loop;

  if v_nb_open = 0 then
    raise exception 'Un pipeline a besoin d''au moins une étape';
  end if;

  if exists (
    select 1 from public.pipelines_ventes
    where org_id = v_org and archived_at is null
      and lower(btrim(name)) = lower(v_nom)
      and id is distinct from p_id
  ) then
    raise exception 'Un pipeline porte déjà ce nom. Choisissez-en un autre.';
  end if;

  if p_id is null then
    if not has_org_admin_role(v_uid, v_org) then
      raise exception 'Seuls les administrateurs peuvent créer un pipeline';
    end if;
    insert into public.pipelines_ventes (org_id, name, is_default, color_mode, use_deal_probability)
    values (v_org, v_nom, false, v_mode, coalesce(p_use_deal_probability, false))
    returning id into v_pipeline;
  else
    if not exists (
      select 1 from public.pipelines_ventes
      where id = p_id and org_id = v_org and archived_at is null
    ) then
      raise exception 'Pipeline introuvable';
    end if;
    if not peut_modifier_pipeline(v_uid, p_id) then
      raise exception 'Vous n''avez pas le droit de modifier ce pipeline';
    end if;
    update public.pipelines_ventes
    set name = v_nom, color_mode = v_mode,
        use_deal_probability = coalesce(p_use_deal_probability, use_deal_probability),
        updated_at = now()
    where id = p_id;

    -- Écarter les positions existantes (index partiel non reportable).
    update public.pipeline_stages
    set position = position + 100000
    where pipeline_id = p_id and archived_at is null;
  end if;

  for v_e in select * from jsonb_array_elements(p_etapes) loop
    v_kind := coalesce(v_e ->> 'kind', 'open');
    v_pos := v_pos + 1;
    v_proba := nullif(v_e ->> 'probability', '')::numeric;
    if v_kind = 'open' then
      v_rang_open := v_rang_open + 1;
      -- Non saisie : répartie uniformément, comme GHL (7 étapes → 14,29…).
      if v_proba is null then
        v_proba := round(v_rang_open * 100.0 / (v_nb_open + 1), 2);
      end if;
    elsif v_kind = 'won' then
      v_proba := 100; v_a_gagne := true;
    else
      v_proba := 0; v_a_perdu := true;
    end if;

    v_id := nullif(v_e ->> 'id', '')::uuid;

    if v_id is not null and p_id is not null then
      update public.pipeline_stages
      set name_fr = btrim(v_e ->> 'nom_fr'),
          name_en = coalesce(nullif(btrim(coalesce(v_e ->> 'nom_en', '')), ''), name_en),
          position = v_pos,
          probability = v_proba,
          show_in_reports = coalesce((v_e ->> 'show_in_reports')::boolean, show_in_reports),
          show_in_pie = coalesce((v_e ->> 'show_in_pie')::boolean, show_in_pie),
          updated_at = now()
      where id = v_id and pipeline_id = p_id and archived_at is null;
      if not found then
        raise exception 'Étape introuvable dans ce pipeline';
      end if;
    else
      insert into public.pipeline_stages (
        org_id, pipeline_id, name_fr, name_en, position, kind,
        probability, show_in_reports, show_in_pie
      )
      values (
        v_org, v_pipeline, btrim(v_e ->> 'nom_fr'),
        coalesce(nullif(btrim(coalesce(v_e ->> 'nom_en', '')), ''), btrim(v_e ->> 'nom_fr')),
        v_pos, v_kind::public.pipeline_stage_kind, v_proba,
        coalesce((v_e ->> 'show_in_reports')::boolean, true),
        coalesce((v_e ->> 'show_in_pie')::boolean, true)
      )
      returning id into v_id;
    end if;
    v_gardes := v_gardes || v_id;
  end loop;

  if p_id is not null then
    -- Gagné et Perdu sont verrouillés : les retirer du modal ne les supprime pas.
    if exists (
      select 1 from public.pipeline_stages
      where pipeline_id = p_id and archived_at is null
        and kind in ('won', 'lost') and not (id = any (v_gardes))
    ) then
      raise exception 'Les étapes Gagné et Perdu sont verrouillées : elles ne peuvent pas être supprimées';
    end if;
    -- Les autres étapes retirées sont archivées. Le déclencheur
    -- d'archivage refuse si des deals y sont encore.
    begin
      update public.pipeline_stages
      set archived_at = now(), updated_at = now()
      where pipeline_id = p_id and archived_at is null and not (id = any (v_gardes));
    exception when others then
      raise exception '% — déplacez d''abord ses deals depuis la page du pipeline (menu ⋮ de l''étape → Supprimer).', sqlerrm;
    end;
    -- Recaler les étapes restées écartées (aucune normalement).
    update public.pipeline_stages
    set position = position - 100000
    where pipeline_id = p_id and archived_at is null and position > 100000;
  else
    -- Un pipeline qu'on ne peut pas terminer casse le closing et « Job à
    -- créer » : Gagné et Perdu sont ajoutés s'ils manquent.
    if not v_a_gagne then
      v_pos := v_pos + 1;
      insert into public.pipeline_stages (org_id, pipeline_id, name_fr, name_en, position, kind, probability)
      values (v_org, v_pipeline, 'Gagné', 'Won', v_pos, 'won', 100);
    end if;
    if not v_a_perdu then
      v_pos := v_pos + 1;
      insert into public.pipeline_stages (org_id, pipeline_id, name_fr, name_en, position, kind, probability)
      values (v_org, v_pipeline, 'Perdu', 'Lost', v_pos, 'lost', 0);
    end if;
  end if;

  perform public.pipeline_resynchroniser_defaut(v_org);
  return v_pipeline;
exception
  when unique_violation then
    raise exception 'Un pipeline porte déjà ce nom. Choisissez-en un autre.';
end;
$fn$;
revoke all on function public.pipeline_enregistrer(uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.pipeline_enregistrer(uuid, text, text, boolean, jsonb) to authenticated;

-- ── 8. Dupliquer ────────────────────────────────────────────────

create or replace function public.pipeline_dupliquer(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_nom text;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent dupliquer un pipeline';
  end if;
  select name into v_nom from public.pipelines_ventes
  where id = p_id and org_id = v_org and archived_at is null;
  if v_nom is null then raise exception 'Pipeline introuvable'; end if;
  return public._pipeline_copier(p_id, v_org, v_nom || ' (copie)', v_uid);
end;
$fn$;
revoke all on function public.pipeline_dupliquer(uuid) from public, anon;
grant execute on function public.pipeline_dupliquer(uuid) to authenticated;

-- ── 9. Copier vers d'autres bureaux (« sous-comptes » GHL) ──────

create or replace function public.pipeline_bureaux_administres()
returns table (org_id uuid, nom text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select o.id, o.name
  from public.memberships m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
    and coalesce(m.status, 'active') = 'active'
    and o.id is distinct from public.current_org_id()
    and public.has_org_admin_role(auth.uid(), o.id)
  order by o.name;
$fn$;
revoke all on function public.pipeline_bureaux_administres() from public, anon;
grant execute on function public.pipeline_bureaux_administres() to authenticated;

create or replace function public.pipeline_copier_vers_bureaux(p_id uuid, p_orgs uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_nom text;
  v_cible uuid;
  v_n integer := 0;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent copier un pipeline';
  end if;
  select name into v_nom from public.pipelines_ventes
  where id = p_id and org_id = v_org and archived_at is null;
  if v_nom is null then raise exception 'Pipeline introuvable'; end if;
  if coalesce(array_length(p_orgs, 1), 0) = 0 then
    raise exception 'Choisissez au moins un bureau';
  end if;

  foreach v_cible in array p_orgs loop
    if v_cible = v_org then continue; end if;
    -- Chaque bureau cible est vérifié : administrer celui-ci ne donne aucun
    -- droit sur un autre.
    if not has_org_admin_role(v_uid, v_cible) then
      raise exception 'Vous n''êtes pas administrateur d''un des bureaux choisis';
    end if;
    perform public._pipeline_copier(p_id, v_cible, v_nom, v_uid);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function public.pipeline_copier_vers_bureaux(uuid, uuid[]) from public, anon;
grant execute on function public.pipeline_copier_vers_bureaux(uuid, uuid[]) to authenticated;

-- ── 10. Réordonner les pipelines ────────────────────────────────

create or replace function public.pipeline_reordonner(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent réordonner les pipelines';
  end if;
  -- La liste doit être EXACTEMENT les pipelines actifs de l'organisation :
  -- un id oublié ou étranger laisserait des positions incohérentes.
  if (select array_agg(id order by id) from public.pipelines_ventes
      where org_id = v_org and archived_at is null)
     is distinct from
     (select array_agg(x order by x) from unnest(p_ids) as x) then
    raise exception 'La liste ne correspond pas aux pipelines de ce bureau';
  end if;

  update public.pipelines_ventes p
  set position = o.rang::integer, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, rang)
  where p.id = o.id and p.org_id = v_org;

  perform public.pipeline_resynchroniser_defaut(v_org);
end;
$fn$;
revoke all on function public.pipeline_reordonner(uuid[]) from public, anon;
grant execute on function public.pipeline_reordonner(uuid[]) to authenticated;

-- ── 11. Supprimer un pipeline (en déplaçant ses deals) ──────────

create or replace function public.pipeline_supprimer(p_id uuid, p_dest_pipeline uuid default null, p_dest_etape uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_deals integer;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent supprimer un pipeline';
  end if;
  if not exists (select 1 from public.pipelines_ventes where id = p_id and org_id = v_org and archived_at is null) then
    raise exception 'Pipeline introuvable';
  end if;
  if (select count(*) from public.pipelines_ventes where org_id = v_org and archived_at is null) <= 1 then
    raise exception 'Impossible de supprimer le dernier pipeline';
  end if;

  select count(*) into v_deals from public.deals
  where pipeline_id = p_id and org_id = v_org and deleted_at is null;

  if v_deals > 0 then
    if p_dest_pipeline is null or p_dest_etape is null then
      raise exception 'Ce pipeline contient % deal(s) : choisissez le pipeline et l''étape où les déplacer', v_deals;
    end if;
    if p_dest_pipeline = p_id then
      raise exception 'Choisissez un AUTRE pipeline comme destination';
    end if;
    if not exists (
      select 1 from public.pipeline_stages s
      join public.pipelines_ventes p on p.id = s.pipeline_id
      where s.id = p_dest_etape and s.pipeline_id = p_dest_pipeline
        and s.org_id = v_org and s.archived_at is null and s.kind = 'open'
        and p.archived_at is null
    ) then
      raise exception 'Étape de destination invalide : choisissez une étape ouverte du pipeline de destination';
    end if;

    -- Geste administratif : aucune automatisation ne doit partir chez ces clients.
    perform set_config('lume.deplacement_administratif', 'on', true);
    update public.deals
    set pipeline_id = p_dest_pipeline, stage_id = p_dest_etape, updated_at = now()
    where pipeline_id = p_id and org_id = v_org and deleted_at is null;
    perform set_config('lume.deplacement_administratif', 'off', true);
  end if;

  -- Les formulaires qui visaient ce pipeline repartent vers le défaut.
  update public.request_forms set pipeline_id = null where pipeline_id = p_id;

  update public.pipelines_ventes
  set archived_at = now(), is_default = false, updated_at = now()
  where id = p_id;

  perform public.pipeline_resynchroniser_defaut(v_org);
  return v_deals;
end;
$fn$;
revoke all on function public.pipeline_supprimer(uuid, uuid, uuid) from public, anon;
grant execute on function public.pipeline_supprimer(uuid, uuid, uuid) to authenticated;

-- ── 12. Supprimer une étape (en déplaçant ses deals) ────────────

create or replace function public.pipeline_supprimer_etape(p_etape uuid, p_dest uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_org_id();
  v_pipeline uuid;
  v_kind text;
  v_deals integer;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  select pipeline_id, kind::text into v_pipeline, v_kind
  from public.pipeline_stages
  where id = p_etape and org_id = v_org and archived_at is null;
  if v_pipeline is null then raise exception 'Étape introuvable'; end if;
  if not peut_modifier_pipeline(v_uid, v_pipeline) then
    raise exception 'Vous n''avez pas le droit de modifier ce pipeline';
  end if;
  if v_kind in ('won', 'lost') then
    raise exception 'Les étapes Gagné et Perdu sont verrouillées : elles ne peuvent pas être supprimées';
  end if;

  select count(*) into v_deals from public.deals
  where stage_id = p_etape and deleted_at is null;

  if v_deals > 0 then
    if p_dest is null then
      raise exception 'Cette étape contient % deal(s) : choisissez l''étape où les déplacer', v_deals;
    end if;
    if p_dest = p_etape or not exists (
      select 1 from public.pipeline_stages
      where id = p_dest and pipeline_id = v_pipeline and archived_at is null and kind = 'open'
    ) then
      raise exception 'Étape de destination invalide : choisissez une autre étape ouverte de ce pipeline';
    end if;
    perform set_config('lume.deplacement_administratif', 'on', true);
    update public.deals set stage_id = p_dest, updated_at = now()
    where stage_id = p_etape and deleted_at is null;
    perform set_config('lume.deplacement_administratif', 'off', true);
  end if;

  update public.pipeline_stages set archived_at = now(), updated_at = now() where id = p_etape;
  return v_deals;
end;
$fn$;
revoke all on function public.pipeline_supprimer_etape(uuid, uuid) from public, anon;
grant execute on function public.pipeline_supprimer_etape(uuid, uuid) to authenticated;

-- ── 13. Répartition par étape (le camembert) ────────────────────

create or replace function public.pipeline_repartition_etapes(p_pipeline_id uuid)
returns table (stage_id uuid, nom_fr text, nom_en text, rang integer, deals bigint)
language sql
stable
set search_path to 'public'
as $fn$
  select s.id, s.name_fr, s.name_en, s.position,
         count(d.id) filter (where d.deleted_at is null)::bigint
  from public.pipeline_stages s
  left join public.deals d on d.stage_id = s.id
  where s.pipeline_id = p_pipeline_id
    and s.archived_at is null
    and s.kind = 'open'
    and s.show_in_pie
  group by s.id, s.name_fr, s.name_en, s.position
  order by s.position;
$fn$;
revoke all on function public.pipeline_repartition_etapes(uuid) from public, anon;
grant execute on function public.pipeline_repartition_etapes(uuid) to authenticated;

-- ── 14. Fonctions existantes, retouchées (texte exact de la prod) ──

-- ingest_lead : un pipeline ARCHIVÉ n'est plus une destination (repli sur le défaut).
CREATE OR REPLACE FUNCTION public.ingest_lead(p_org_id uuid, p_source text, p_external_id text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_utm_source text DEFAULT NULL::text, p_utm_medium text DEFAULT NULL::text, p_utm_campaign text DEFAULT NULL::text, p_utm_content text DEFAULT NULL::text, p_fbclid text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_dedup boolean DEFAULT true, p_created_by uuid DEFAULT NULL::uuid, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pipeline    uuid;
  v_etape       uuid;
  v_client      uuid;
  v_deal        uuid;
  v_deal_ouvert uuid;
  v_tel         text := public.normaliser_telephone(p_phone);
  v_courriel    text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_fusionne    boolean := false;
  v_nom         text;
  v_auteur      uuid := coalesce(p_created_by, auth.uid());
begin
  if p_org_id is null then
    raise exception 'org_id requis';
  end if;

  if v_auteur is null then
    select user_id into v_auteur
    from public.memberships
    where org_id = p_org_id and role in ('owner', 'admin')
    order by case role when 'owner' then 0 else 1 end, created_at
    limit 1;
  end if;

  if v_auteur is null then
    raise exception 'Aucun auteur : passer p_created_by, ou avoir un propriétaire dans l''organisation';
  end if;

  -- 2a. Idempotence : la même soumission ne crée jamais deux deals.
  if p_external_id is not null then
    select id into v_deal
    from public.deals
    where org_id = p_org_id and source = p_source
      and external_id = p_external_id and deleted_at is null
    limit 1;

    if v_deal is not null then
      return jsonb_build_object(
        'deal_id', v_deal, 'client_id', (select client_id from public.deals where id = v_deal),
        'cree', false, 'fusionne', false, 'deal_existant', true, 'raison', 'deja_ingere');
    end if;
  end if;

  -- 2b. Le pipeline DEMANDÉ s'il existe encore dans cette organisation,
  --     sinon celui par défaut. Le repli est volontaire : perdre la demande
  --     d'un client parce qu'un pipeline a été supprimé serait pire que de
  --     la classer au mauvais endroit.
  if p_pipeline_id is not null then
    select id into v_pipeline
    from public.pipelines_ventes
    where id = p_pipeline_id and org_id = p_org_id and archived_at is null
    limit 1;
  end if;

  if v_pipeline is null then
    select id into v_pipeline
    from public.pipelines_ventes
    where org_id = p_org_id and is_default
    limit 1;
  end if;

  if v_pipeline is null then
    v_pipeline := public.seed_pipeline_ventes(p_org_id, 'generique');
  end if;

  select id into v_etape
  from public.pipeline_stages
  where org_id = p_org_id and pipeline_id = v_pipeline
    and kind = 'open' and archived_at is null
  order by position
  limit 1;

  -- Le pipeline visé n'a aucune étape ouverte : on retombe sur le défaut
  -- plutôt que de refuser le lead.
  if v_etape is null and p_pipeline_id is not null then
    select id into v_pipeline
    from public.pipelines_ventes
    where org_id = p_org_id and is_default
    limit 1;

    select id into v_etape
    from public.pipeline_stages
    where org_id = p_org_id and pipeline_id = v_pipeline
      and kind = 'open' and archived_at is null
    order by position
    limit 1;
  end if;

  if v_etape is null then
    raise exception 'Aucune étape ouverte dans le pipeline de cette organisation';
  end if;

  -- 2c. Rapprochement : téléphone E.164 OU courriel en minuscules.
  if p_dedup and (v_tel is not null or v_courriel is not null) then
    select id into v_client
    from public.clients
    where org_id = p_org_id
      and deleted_at is null
      and (
        (v_tel is not null and public.normaliser_telephone(phone) = v_tel)
        or (v_courriel is not null and lower(email) = v_courriel)
      )
    order by coalesce(last_client_activity_at, updated_at, created_at) desc
    limit 1;

    v_fusionne := v_client is not null;
  end if;

  -- 2d. Aucun contact retrouvé : on en crée un.
  if v_client is null then
    v_nom := btrim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''));

    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, notes,
      status, lead_status, source, title, value, created_by
    )
    values (
      p_org_id,
      nullif(btrim(coalesce(p_first_name, '')), ''),
      nullif(btrim(coalesce(p_last_name, '')), ''),
      nullif(btrim(coalesce(p_company, '')), ''),
      v_courriel,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      'lead', 'new_prospect', p_source,
      nullif(btrim(coalesce(p_company, '')), ''),
      0, v_auteur
    )
    returning id into v_client;
  else
    update public.clients set
      email   = coalesce(email, v_courriel),
      phone   = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
      address = coalesce(address, nullif(btrim(coalesce(p_address, '')), '')),
      company = coalesce(company, nullif(btrim(coalesce(p_company, '')), '')),
      last_client_activity_at = now(),
      updated_at = now()
    where id = v_client;
  end if;

  -- 2e. Un deal OUVERT existe déjà pour ce contact DANS CE PIPELINE ?
  --     On n'en crée pas un second. La restriction au pipeline est le
  --     changement : un même client peut légitimement avoir un deal en
  --     porte-à-porte ET un deal publicitaire — ce sont deux affaires.
  select d.id into v_deal_ouvert
  from public.deals d
  join public.pipeline_stages s on s.id = d.stage_id
  where d.org_id = p_org_id and d.client_id = v_client
    and d.pipeline_id = v_pipeline
    and d.deleted_at is null and s.kind = 'open'
  order by d.created_at desc
  limit 1;

  if v_deal_ouvert is not null then
    update public.deals set
      last_activity_at = now(),
      raw_payload = raw_payload || jsonb_build_object(
        'relances', coalesce(raw_payload -> 'relances', '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object(
            'a', now(), 'source', p_source, 'external_id', p_external_id,
            'utm_campaign', p_utm_campaign, 'payload', p_payload))
      ),
      updated_at = now()
    where id = v_deal_ouvert;

    return jsonb_build_object(
      'deal_id', v_deal_ouvert, 'client_id', v_client,
      'cree', false, 'fusionne', v_fusionne, 'deal_existant', true,
      'raison', 'deal_ouvert_existant');
  end if;

  -- 2f. Nouveau deal. NON ASSIGNÉ, première étape ouverte.
  insert into public.deals (
    org_id, pipeline_id, stage_id, client_id, source, external_id,
    utm_source, utm_medium, utm_campaign, utm_content, fbclid, raw_payload,
    created_by
  )
  values (
    p_org_id, v_pipeline, v_etape, v_client, p_source, p_external_id,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_fbclid,
    coalesce(p_payload, '{}'::jsonb), v_auteur
  )
  returning id into v_deal;

  return jsonb_build_object(
    'deal_id', v_deal, 'client_id', v_client,
    'cree', true, 'fusionne', v_fusionne, 'deal_existant', false,
    'raison', case when v_fusionne then 'contact_retrouve' else 'nouveau_contact' end);
end;
$function$;
revoke all on function public.ingest_lead(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean, uuid, uuid) from public, anon, authenticated;

-- pipeline_creer_deal : même règle pour le pipeline choisi dans « Nouveau deal ».
CREATE OR REPLACE FUNCTION public.pipeline_creer_deal(p_first_name text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_montant_cents bigint DEFAULT NULL::bigint, p_assigne_a uuid DEFAULT NULL::uuid, p_date_fermeture_visee date DEFAULT NULL::date, p_source text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_quote_id uuid DEFAULT NULL::uuid, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org     uuid := current_org_id();
  v_uid     uuid := auth.uid();
  v_res     jsonb;
  v_deal_id uuid;
  v_source  text := nullif(btrim(coalesce(p_source, '')), '');
  v_client  uuid;
  v_quote   uuid;
  v_montant bigint := p_montant_cents;
  v_prenom  text := p_first_name;
  v_nom     text := p_last_name;
  v_courriel text := p_email;
  v_tel     text := p_phone;
  v_adresse text := p_address;
begin
  if v_org is null or v_uid is null then
    raise exception 'Aucune session';
  end if;

  if not member_has_permission(v_uid, v_org, 'leads.create') then
    raise exception 'Vous n''avez pas la permission de créer un lead';
  end if;

  if p_montant_cents is not null and p_montant_cents < 0 then
    raise exception 'Le montant ne peut pas être négatif';
  end if;

  if p_assigne_a is not null
     and not exists (
       select 1 from public.memberships m
       where m.user_id = p_assigne_a and m.org_id = v_org
     ) then
    raise exception 'La personne assignée ne fait pas partie de l''organisation';
  end if;

  -- ── Le devis choisi donne son client ET son montant ──────────
  -- Un devis porte déjà les deux. Les redemander au vendeur, c'est l'inviter
  -- à saisir un chiffre qui divergera du document.
  if p_quote_id is not null then
    select q.id, q.client_id, q.total_cents
      into v_quote, v_client, v_montant
    from public.quotes q
    where q.id = p_quote_id and q.org_id = v_org and q.deleted_at is null;

    if v_quote is null then
      raise exception 'Devis introuvable';
    end if;
    if v_client is null then
      raise exception 'Ce devis n''est rattaché à aucun client';
    end if;
  end if;

  -- ── Le client choisi fournit le contact ──────────────────────
  -- On LIT la fiche au lieu de faire confiance à ce qui a été retapé : c'est
  -- ce qui garantit zéro doublon. « p_client_id » gagne sur le devis seulement
  -- s'il est cohérent avec lui.
  if p_client_id is not null then
    if v_client is not null and v_client <> p_client_id then
      raise exception 'Le client choisi ne correspond pas à celui du devis';
    end if;
    v_client := p_client_id;
  end if;

  if v_client is not null then
    select
      coalesce(nullif(btrim(coalesce(c.first_name, '')), ''), 'Client'),
      c.last_name, c.email, c.phone, c.address
      into v_prenom, v_nom, v_courriel, v_tel, v_adresse
    from public.clients c
    where c.id = v_client and c.org_id = v_org and c.deleted_at is null;

    if v_prenom is null then
      raise exception 'Client introuvable';
    end if;
  end if;

  if btrim(coalesce(v_prenom, '')) = '' then
    raise exception 'Le nom est requis';
  end if;

  -- Le pipeline cible est VALIDÉ ici : ingest_lead retomberait sur le pipeline
  -- par défaut sans rien dire si l'identifiant venait d'ailleurs, et le deal
  -- atterrirait dans le mauvais tableau. (« pipelines_ventes » n'a pas
  -- d'archivage : l'existence dans l'organisation suffit.)
  if p_pipeline_id is not null
     and not exists (
       select 1 from public.pipelines_ventes p
       where p.id = p_pipeline_id and p.org_id = v_org and p.archived_at is null
     ) then
    raise exception 'Pipeline introuvable';
  end if;

  if v_client is null then
    -- Nouveau contact : le rapprochement d'ingest_lead, inchangé.
    v_res := public.ingest_lead(
      p_org_id      => v_org,
      p_source      => coalesce(v_source, 'manual'),
      p_first_name  => btrim(v_prenom),
      p_last_name   => nullif(btrim(coalesce(v_nom, '')), ''),
      p_email       => nullif(btrim(coalesce(v_courriel, '')), ''),
      p_phone       => nullif(btrim(coalesce(v_tel, '')), ''),
      p_address     => nullif(btrim(coalesce(v_adresse, '')), ''),
      p_created_by  => v_uid,
      p_pipeline_id => p_pipeline_id
    );
  else
    -- Client CHOISI : on ne passe PAS par le rapprochement. Il ne sait
    -- retrouver quelqu'un que par téléphone ou courriel ; un client connu
    -- qui n'a ni l'un ni l'autre serait recréé en double — exactement le
    -- défaut qu'on corrige. Le deal est donc rattaché à CE client.
    -- Même résolution de pipeline et d'étape qu'ingest_lead (§2b), même
    -- règle « un seul deal ouvert par client et par pipeline » (§2e).
    declare
      v_pipeline    uuid;
      v_etape       uuid;
      v_deal_ouvert uuid;
    begin
      if p_pipeline_id is not null then
        v_pipeline := p_pipeline_id;
      else
        select id into v_pipeline from public.pipelines_ventes
        where org_id = v_org and is_default limit 1;
      end if;
      if v_pipeline is null then
        v_pipeline := public.seed_pipeline_ventes(v_org, 'generique');
      end if;

      select id into v_etape from public.pipeline_stages
      where org_id = v_org and pipeline_id = v_pipeline
        and kind = 'open' and archived_at is null
      order by position limit 1;

      if v_etape is null then
        raise exception 'Ce pipeline n''a aucune étape ouverte';
      end if;

      select d.id into v_deal_ouvert
      from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.org_id = v_org and d.client_id = v_client
        and d.pipeline_id = v_pipeline
        and d.deleted_at is null and s.kind = 'open'
      order by d.created_at desc limit 1;

      if v_deal_ouvert is not null then
        update public.deals
        set last_activity_at = now(), updated_at = now()
        where id = v_deal_ouvert;
        v_res := jsonb_build_object(
          'deal_id', v_deal_ouvert, 'client_id', v_client, 'pipeline_id', v_pipeline,
          'cree', false, 'fusionne', true, 'deal_existant', true,
          'raison', 'deal_ouvert_existant');
      else
        insert into public.deals (org_id, pipeline_id, stage_id, client_id, source, created_by)
        values (v_org, v_pipeline, v_etape, v_client, coalesce(v_source, 'manual'), v_uid)
        returning id into v_deal_id;

        update public.clients
        set last_client_activity_at = now(), updated_at = now()
        where id = v_client;

        v_res := jsonb_build_object(
          'deal_id', v_deal_id, 'client_id', v_client, 'pipeline_id', v_pipeline,
          'cree', true, 'fusionne', true, 'deal_existant', false,
          'raison', 'client_choisi');
      end if;
    end;
  end if;

  v_deal_id := (v_res ->> 'deal_id')::uuid;

  if v_deal_id is not null
     and (p_assigne_a is not null or p_date_fermeture_visee is not null) then
    update public.deals d
    set
      assigned_user_id    = coalesce(p_assigne_a, d.assigned_user_id),
      assigned_at         = case
                              when p_assigne_a is not null and d.assigned_user_id is null
                                then now()
                              else d.assigned_at
                            end,
      expected_close_date = coalesce(p_date_fermeture_visee, d.expected_close_date),
      updated_at          = now()
    where d.id = v_deal_id
      and d.org_id = v_org;
  end if;

  -- ── Le devis existant est RATTACHÉ, pas recréé ───────────────
  if v_deal_id is not null and v_quote is not null then
    update public.deals
    set quote_id = coalesce(quote_id, v_quote), updated_at = now()
    where id = v_deal_id and org_id = v_org;

  -- Sinon, et seulement sinon, l'estimation saisie devient un devis
  -- brouillon : visible, modifiable, remplaçable par la vraie soumission.
  -- Un montant repris d'un devis choisi ne repasse JAMAIS ici, sans quoi on
  -- fabriquerait le doublon qu'on cherche à supprimer.
  elsif v_deal_id is not null and v_montant is not null and v_montant > 0 then
    declare
      v_client_deal uuid;
      v_nouveau     uuid;
      v_num         text;
    begin
      select client_id into v_client_deal from public.deals where id = v_deal_id;

      if v_client_deal is not null then
        v_num := 'EST-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_deal_id::text, 1, 6);

        insert into public.quotes (
          org_id, client_id, quote_number, status,
          subtotal_cents, tax_cents, total_cents, created_by
        )
        values (
          v_org, v_client_deal, v_num, 'draft',
          v_montant, 0, v_montant, v_uid
        )
        returning id into v_nouveau;

        update public.deals
        set quote_id = coalesce(quote_id, v_nouveau), updated_at = now()
        where id = v_deal_id and org_id = v_org;
      end if;
    end;
  end if;

  return v_res;
end;
$function$;
revoke all on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.pipeline_creer_deal(text, text, text, text, text, bigint, uuid, date, text, uuid, uuid, uuid) to authenticated;

-- lead_converti_gagne_pipeline : ne jamais convertir vers un pipeline archivé.
CREATE OR REPLACE FUNCTION public.lead_converti_gagne_pipeline(p_org_id uuid, p_client_id uuid, p_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pipeline uuid;
  v_won uuid;
  v_deal uuid;
begin
  if p_org_id is null or p_client_id is null or p_job_id is null then
    return null;
  end if;

  -- Déjà fait ? On ressort le deal tel quel : rappeler la conversion ne doit
  -- pas créer un second deal pour la même job.
  select id into v_deal
  from public.deals
  where org_id = p_org_id and job_id = p_job_id and deleted_at is null
  limit 1;
  if v_deal is not null then
    return v_deal;
  end if;

  -- Le pipeline par défaut de l'organisation, sinon le plus ancien : une org
  -- a toujours un défaut en production, mais s'en remettre à ça seul ferait
  -- échouer la conversion en silence le jour où ce n'est plus vrai.
  select id into v_pipeline
  from public.pipelines_ventes
  where org_id = p_org_id and archived_at is null
  order by is_default desc, position asc, created_at asc
  limit 1;
  if v_pipeline is null then
    return null;  -- Pas de pipeline de ventes : rien à gagner, ce n'est pas une erreur.
  end if;

  select id into v_won
  from public.pipeline_stages
  where pipeline_id = v_pipeline and kind = 'won' and archived_at is null
  order by position asc
  limit 1;
  if v_won is null then
    return null;
  end if;

  -- Un deal vivant pour ce client ? On le fait gagner plutôt que d'en ouvrir
  -- un second : la vente est la même, et deux cartes pour un client feraient
  -- compter la vente en double dans les prévisions.
  select id into v_deal
  from public.deals
  where org_id = p_org_id and client_id = p_client_id and deleted_at is null
  order by created_at desc
  limit 1;

  if v_deal is not null then
    update public.deals
    set stage_id = v_won,
        job_id = p_job_id,
        won_at = coalesce(won_at, now()),
        stage_entered_at = now(),
        last_activity_at = now(),
        updated_at = now()
    where id = v_deal;
  else
    insert into public.deals (
      org_id, pipeline_id, stage_id, client_id, source, job_id, won_at
    )
    values (
      p_org_id, v_pipeline, v_won, p_client_id, 'lead', p_job_id, now()
    )
    returning id into v_deal;
  end if;

  return v_deal;
end;
$function$;

-- deals_emettre_evenements : un déplacement ADMINISTRATIF (suppression d'étape
-- ou de pipeline) ne déclenche aucune automatisation chez les clients.
CREATE OR REPLACE FUNCTION public.deals_emettre_evenements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_setting('lume.deplacement_administratif', true) = 'on' then
    return null;
  end if;

  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.stage_id is not null then
    insert into public.pipeline_events (org_id, deal_id, type, payload, cle_unicite)
    values (
      new.org_id, new.id, 'deal.stage_exited',
      jsonb_build_object(
        'deal_id', new.id,
        'stage_id', old.stage_id,
        'to_stage_id', new.stage_id,
        'pipeline_id', new.pipeline_id,
        'source', new.source,
        'utm_campaign', new.utm_campaign,
        'assigned_user_id', new.assigned_user_id
      ),
      'exit:' || new.id::text || ':' || old.stage_id::text || ':'
        || extract(epoch from old.stage_entered_at)::bigint::text
    )
    on conflict (org_id, cle_unicite) do nothing;
  end if;

  insert into public.pipeline_events (org_id, deal_id, type, payload, cle_unicite)
  values (
    new.org_id, new.id, 'deal.stage_entered',
    jsonb_build_object(
      'deal_id', new.id,
      'stage_id', new.stage_id,
      'from_stage_id', case when tg_op = 'UPDATE' then old.stage_id else null end,
      'pipeline_id', new.pipeline_id,
      'source', new.source,
      'utm_campaign', new.utm_campaign,
      'assigned_user_id', new.assigned_user_id
    ),
    'enter:' || new.id::text || ':' || new.stage_id::text || ':'
      || extract(epoch from new.stage_entered_at)::bigint::text
  )
  on conflict (org_id, cle_unicite) do nothing;

  return null;
end;
$function$;

-- pipeline_entonnoir : l'icône ENTONNOIR décide enfin de ce qui y figure.
CREATE OR REPLACE FUNCTION public.pipeline_entonnoir(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(stage_id uuid, nom_fr text, nom_en text, rang integer, atteints bigint, taux_passage numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with bornes as (
    select coalesce(p_from, (current_date - interval '84 days')::date) as d1,
           coalesce(p_to, current_date) as d2
  ),
  concernes as (
    select d.id
    from public.deals d
    cross join bornes b
    where d.deleted_at is null
      and d.created_at >= b.d1::timestamptz
      and d.created_at < (b.d2 + 1)::timestamptz
  ),
  -- Les étapes du PIPELINE des deals observés. Sans ce filtre, la fonction
  -- agrège les étapes de tous les pipelines (et, appelée avec la clé de
  -- service, de toutes les organisations) : on obtenait « Nouveau lead » en
  -- quinze exemplaires. Vu sur staging pendant l'écriture de ce fichier.
  etapes as (
    select s.id, s.name_fr, s.name_en, s.position
    from public.pipeline_stages s
    where s.kind = 'open'
      and s.show_in_reports
      and s.pipeline_id in (select distinct pipeline_id from public.deals d2 where d2.id in (select id from concernes))
      -- Une étape archivée reste dans l'entonnoir historique : les deals qui
      -- y sont passés existent toujours (décision Q3).
    order by s.position
  ),
  passages as (
    select h.to_stage_id, count(distinct h.deal_id) as n
    from public.deal_stage_history h
    where h.deal_id in (select id from concernes)
    group by h.to_stage_id
  )
  select
    e.id, e.name_fr, e.name_en, e.position,
    coalesce(p.n, 0)::bigint,
    case
      when lag(coalesce(p.n, 0)) over (order by e.position) is null then 100.0
      when lag(coalesce(p.n, 0)) over (order by e.position) = 0 then 0
      else round(coalesce(p.n, 0)::numeric
                 / lag(coalesce(p.n, 0)) over (order by e.position) * 100, 1)
    end
  from etapes e
  left join passages p on p.to_stage_id = e.id
  order by e.position;
$function$;

-- creer_pipeline_sur_mesure : probabilité décimale.
CREATE OR REPLACE FUNCTION public.creer_pipeline_sur_mesure(p_nom text, p_etapes jsonb, p_color_mode text DEFAULT 'none'::text, p_use_deal_probability boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org      uuid := current_org_id();
  v_uid      uuid := auth.uid();
  v_pipeline uuid;
  v_nom      text := btrim(coalesce(p_nom, ''));
  v_etape    jsonb;
  v_position integer := 0;
  v_a_gagne  boolean := false;
  v_a_perdu  boolean := false;
  v_kind     text;
  v_nb       integer := 0;
  v_mode     text := coalesce(nullif(btrim(coalesce(p_color_mode, '')), ''), 'none');
begin
  if v_org is null or v_uid is null then
    raise exception 'Aucune session';
  end if;

  -- Créer un pipeline est un geste d'administration : il s'impose à toute
  -- l'équipe et décide où atterrissent les leads.
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent créer un pipeline';
  end if;

  if v_nom = '' then
    raise exception 'Le nom du pipeline est requis';
  end if;

  if v_mode not in ('none', 'dot', 'tint') then
    raise exception 'Mode de couleur inconnu : %', v_mode;
  end if;

  if jsonb_typeof(p_etapes) is distinct from 'array' then
    raise exception 'Les étapes doivent être une liste';
  end if;

  insert into public.pipelines_ventes (org_id, name, is_default, color_mode, use_deal_probability)
  values (v_org, v_nom, false, v_mode, coalesce(p_use_deal_probability, false))
  returning id into v_pipeline;

  for v_etape in select * from jsonb_array_elements(p_etapes)
  loop
    v_kind := coalesce(v_etape ->> 'kind', 'open');
    if v_kind not in ('open', 'won', 'lost') then
      raise exception 'Type d''étape inconnu : %', v_kind;
    end if;
    if btrim(coalesce(v_etape ->> 'nom_fr', '')) = '' then
      raise exception 'Chaque étape doit avoir un nom';
    end if;

    v_position := v_position + 1;
    v_nb := v_nb + 1;
    if v_kind = 'won'  then v_a_gagne := true; end if;
    if v_kind = 'lost' then v_a_perdu := true; end if;

    insert into public.pipeline_stages (
      org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en,
      position, kind, probability, show_in_reports
    )
    values (
      v_org, v_pipeline,
      btrim(v_etape ->> 'nom_fr'),
      coalesce(nullif(btrim(coalesce(v_etape ->> 'nom_en', '')), ''), btrim(v_etape ->> 'nom_fr')),
      coalesce(v_etape ->> 'guidance_fr', ''),
      coalesce(v_etape ->> 'guidance_en', ''),
      v_position,
      v_kind::public.pipeline_stage_kind,
      -- Gagné et perdu valent 100 % et 0 % : des faits, pas des estimations.
      case v_kind
        when 'won'  then 100
        when 'lost' then 0
        else nullif(v_etape ->> 'probability', '')::numeric
      end,
      coalesce((v_etape ->> 'show_in_reports')::boolean, true)
    );
  end loop;

  if v_nb = 0 then
    raise exception 'Un pipeline a besoin d''au moins une étape';
  end if;

  -- Les deux étapes terminales, ajoutées si elles manquent. Un pipeline
  -- qu'on ne peut pas terminer casse le closing, le badge « Job à créer » et
  -- la raison de perte — c'est un état dont on ne sort plus.
  if not v_a_gagne then
    v_position := v_position + 1;
    insert into public.pipeline_stages (org_id, pipeline_id, name_fr, name_en, position, kind, probability)
    values (v_org, v_pipeline, 'Gagné', 'Won', v_position, 'won', 100);
  end if;

  if not v_a_perdu then
    v_position := v_position + 1;
    insert into public.pipeline_stages (org_id, pipeline_id, name_fr, name_en, position, kind, probability)
    values (v_org, v_pipeline, 'Perdu', 'Lost', v_position, 'lost', 0);
  end if;

  return v_pipeline;
end;
$function$;

-- pipeline_definir_defaut : le défaut = le premier de la liste. Désigner un
-- pipeline par défaut le DÉPLACE donc en position 1 — une seule règle, quel
-- que soit le chemin (écran, Lumi, script).
create or replace function public.pipeline_definir_defaut(p_pipeline_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid;
  v_ids uuid[];
begin
  select org_id into v_org from public.pipelines_ventes
  where id = p_pipeline_id and archived_at is null;
  if v_org is null or v_org is distinct from current_org_id() then
    raise exception 'Pipeline introuvable';
  end if;
  if not has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Changement refusé : seuls les administrateurs peuvent changer le pipeline par défaut';
  end if;

  select array_agg(id order by (id = p_pipeline_id) desc, position, created_at, id) into v_ids
  from public.pipelines_ventes where org_id = v_org and archived_at is null;

  update public.pipelines_ventes p
  set position = o.rang::integer, updated_at = now()
  from unnest(v_ids) with ordinality as o(id, rang)
  where p.id = o.id;

  perform public.pipeline_resynchroniser_defaut(v_org);
end;
$fn$;
revoke all on function public.pipeline_definir_defaut(uuid) from public, anon;
grant execute on function public.pipeline_definir_defaut(uuid) to authenticated;

-- ── Probabilités des pipelines EXISTANTS (demande de Rafba, 2026-09-25) ──
-- Seules les cases VIDES sont remplies, comme GHL à la création : une étape
-- ouverte reçoit rang × 100 / (nb d'étapes ouvertes + 1) — 4 étapes →
-- 20 / 40 / 60 / 80. Gagné = 100, Perdu = 0. Une probabilité déjà saisie
-- n'est JAMAIS écrasée. Le rang compte toutes les étapes ouvertes actives,
-- saisies ou non, pour que la progression reste croissante.
-- Mesuré au 2026-09-25 : prod 40 étapes ouvertes vides sur 47 (10 pipelines),
-- 5 Gagné et 5 Perdu vides.
-- ROLLBACK : aucune trace « avant » n'existe (c'était NULL) ; pour revenir,
-- remettre à NULL les étapes dont la valeur égale exactement la formule.
with rangs as (
  select s.id, s.kind,
         row_number() over (partition by s.pipeline_id, s.kind order by s.position) as rang,
         count(*)     over (partition by s.pipeline_id, s.kind)                    as nb
  from public.pipeline_stages s
  where s.archived_at is null
)
update public.pipeline_stages s
set probability = case r.kind
      when 'won'  then 100
      when 'lost' then 0
      else round(r.rang * 100.0 / (r.nb + 1), 2)
    end,
    updated_at = now()
from rangs r
where s.id = r.id
  and s.probability is null;

-- Resynchroniser le défaut une première fois (positions posées plus haut).
select public.pipeline_resynchroniser_defaut(o.org_id)
from (select distinct org_id from public.pipelines_ventes) o;

commit;
