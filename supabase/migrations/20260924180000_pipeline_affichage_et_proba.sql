-- ═══════════════════════════════════════════════════════════════
-- Pipeline : mode d'affichage des couleurs + probabilité par deal
--
-- Deux réglages de pipeline demandés à la création, à l'image de GHL :
--
--   * `color_mode` — comment le board teinte ses étapes. Les teintes
--     elles-mêmes restent DÉRIVÉES du rang de l'étape (`presentation.ts`) :
--     une palette stockée par étape devrait être maintenue à la main, et
--     réordonner un pipeline la désaccorderait en silence. Ce réglage dit
--     seulement OÙ la couleur est posée — nulle part, sur une pastille, ou
--     en fond de colonne.
--
--   * `use_deal_probability` — quand c'est vrai, la prévision lit la
--     probabilité écrite SUR LE DEAL, et retombe sur celle de l'étape
--     quand le deal n'en a pas. Sans cette bascule, un gros contrat à
--     90 % et un petit à 10 % coincés dans la même étape pèsent pareil.
--
-- Les deux colonnes ont un défaut qui reproduit le comportement actuel :
-- aucun pipeline existant ne change d'apparence ni de calcul.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.pipelines_ventes
  add column if not exists color_mode text not null default 'none',
  add column if not exists use_deal_probability boolean not null default false;

-- Une valeur libre finirait par contenir « colored », « color » et
-- « couleur » pour la même chose, et le board ne saurait plus quoi en faire.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pipelines_ventes_color_mode_check'
  ) then
    alter table public.pipelines_ventes
      add constraint pipelines_ventes_color_mode_check
      check (color_mode in ('none', 'dot', 'tint'));
  end if;
end $$;

comment on column public.pipelines_ventes.color_mode is
  'Où le board pose la teinte d''une étape : none (aucune), dot (pastille), tint (fond de colonne). Les teintes restent dérivées du rang de l''étape.';

comment on column public.pipelines_ventes.use_deal_probability is
  'Quand vrai, la prévision utilise la probabilité portée par le deal, et retombe sur celle de l''étape si le deal n''en a pas.';

-- La probabilité portée par un deal. Nulle par défaut : sans saisie, c'est
-- l'étape qui décide, exactement comme avant.
alter table public.deals
  add column if not exists probability integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deals_probability_check'
  ) then
    alter table public.deals
      add constraint deals_probability_check
      check (probability is null or (probability >= 0 and probability <= 100));
  end if;
end $$;

comment on column public.deals.probability is
  'Probabilité de closing propre à ce deal, 0-100. Nulle = celle de l''étape. Lue par la prévision seulement si le pipeline a use_deal_probability.';

-- ── Création : les deux réglages passent à la création ──────────
--
-- La signature à deux arguments est REMPLACÉE, pas doublée : deux surcharges
-- laisseraient PostgREST choisir, et un appel sans réglages tomberait
-- silencieusement sur l'ancienne. Les nouveaux paramètres ont un défaut, donc
-- les appels existants à deux arguments continuent de fonctionner.
drop function if exists public.creer_pipeline_sur_mesure(text, jsonb);

create function public.creer_pipeline_sur_mesure(
  p_nom    text,
  -- [{ "nom_fr": "...", "nom_en": "...", "kind": "open|won|lost",
  --    "probability": 20, "show_in_reports": true }, ...]
  p_etapes jsonb,
  p_color_mode text default 'none',
  p_use_deal_probability boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
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
        else nullif(v_etape ->> 'probability', '')::integer
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
$fn$;

revoke all on function public.creer_pipeline_sur_mesure(text, jsonb, text, boolean) from public, anon;
grant execute on function public.creer_pipeline_sur_mesure(text, jsonb, text, boolean) to authenticated;

comment on function public.creer_pipeline_sur_mesure(text, jsonb, text, boolean) is
  'Crée un pipeline avec ses propres étapes, son mode de couleur et sa source de probabilité. L''organisation vient de la session, jamais d''un paramètre. Les étapes « gagné » et « perdu » sont ajoutées si elles manquent : un pipeline qu''on ne peut pas terminer casse le closing et la raison de perte.';

-- ── La prévision suit le réglage du pipeline ────────────────────
--
-- Reprise À L'IDENTIQUE de la version en base (signature, colonnes de
-- retour, filtres, hygiène), avec UNE seule différence : la probabilité
-- retenue. Quand le pipeline du deal demande `use_deal_probability`, on lit
-- celle du deal et on retombe sur celle de l'étape si le deal n'a rien —
-- sinon on garde exactement le comportement actuel.
--
-- Le `join` sur `pipelines_ventes` ne restreint rien : `deals.pipeline_id`
-- est NOT NULL et référence cette table.
create or replace function public.pipeline_previsions(p_pipeline_id uuid default null::uuid)
returns table (
  max_potentiel_cents bigint,
  attendu_cents       bigint,
  gagne_cents         bigint,
  ouverts             bigint,
  sans_date           bigint,
  sans_montant        bigint,
  en_retard           bigint
)
language sql
stable
set search_path to 'public'
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      dl.id, dl.expected_close_date, s.kind,
      case
        when p.use_deal_probability then coalesce(dl.probability, s.probability)
        else s.probability
      end as prob,
      coalesce(m.cents, 0) as cents
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    join public.pipelines_ventes p on p.id = dl.pipeline_id
    left join m on m.deal_id = dl.id
    where dl.deleted_at is null
      and s.show_in_reports
      and (p_pipeline_id is null or dl.pipeline_id = p_pipeline_id)
  )
  select
    coalesce(sum(cents) filter (where kind = 'open'), 0)::bigint,
    -- Pondéré : seuls les deals dont l'étape a une probabilité y entrent.
    coalesce(sum((cents * prob) / 100) filter (where kind = 'open' and prob is not null), 0)::bigint,
    coalesce(sum(cents) filter (where kind = 'won'), 0)::bigint,
    count(*) filter (where kind = 'open')::bigint,
    -- L'hygiène des données : ce qui fausse la projection sans le dire.
    count(*) filter (where kind = 'open' and expected_close_date is null)::bigint,
    count(*) filter (where kind = 'open' and cents = 0)::bigint,
    count(*) filter (where kind = 'open' and expected_close_date < current_date)::bigint
  from d;
$fn$;

commit;
