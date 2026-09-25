-- ═══════════════════════════════════════════════════════════════
-- Pipeline de ventes — statistiques (Phase 6)
--
-- SECURITY INVOKER, volontairement : les 13 `rpc_insights_*` existants sont
-- tous SECURITY DEFINER et vérifient l'appartenance à la main
-- (`has_org_membership(auth.uid(), v_org)`). Ici la RLS fait le travail : la
-- fonction ne voit que ce que l'appelant peut voir, et il n'y a aucun
-- contrôle à oublier. `org_id` n'est JAMAIS un paramètre — il vient de la
-- session, sinon n'importe qui pourrait lire les chiffres d'une autre
-- entreprise en changeant un argument.
--
-- Deux définitions coexistent et ne doivent pas être confondues :
--
--   · taux de closing  = gagnés ÷ (gagnés + perdus)    → deals FERMÉS seuls
--   · taux par cohorte = gagnés ÷ TOUS les leads du mois → ouverts INCLUS
--
-- L'entonnoir se calcule sur `deal_stage_history`, pas sur la position
-- actuelle : un deal qui est PASSÉ par une étape y compte, même s'il l'a
-- quittée. Sans ça, les premières étapes paraissent vides et l'entonnoir ment.
--
-- Pas de vue matérialisée : la RLS ne s'y applique pas. Requêtes live,
-- indexées par la migration 20260923100000. Si une organisation de 5 000
-- deals dépasse 500 ms, on proposera une table de rollup quotidienne (avec
-- RLS) — pas avant, et pas sans accord.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Les chiffres du haut : leads, closing, revenus.
--    Les revenus viennent de la JOB liée — jamais du deal (décision Q5).
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_kpis(
  p_from date default null,
  p_to   date default null
)
returns table (
  leads_entrants      bigint,
  leads_precedents    bigint,
  gagnes              bigint,
  perdus              bigint,
  ouverts             bigint,
  taux_closing        numeric,
  revenus_cents       bigint,
  jobs_liees          bigint,
  job_a_creer         bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with bornes as (
    select
      coalesce(p_from, (current_date - interval '84 days')::date) as d1,
      coalesce(p_to, current_date) as d2
  ),
  fenetre as (
    select d1, d2, (d1 - (d2 - d1 + 1)) as d0 from bornes
  ),
  courant as (
    select d.*, s.kind
    from public.deals d
    join public.pipeline_stages s on s.id = d.stage_id
    cross join fenetre f
    where d.deleted_at is null
      and d.created_at >= f.d1::timestamptz
      and d.created_at < (f.d2 + 1)::timestamptz
  ),
  precedent as (
    select count(*) as n
    from public.deals d
    cross join fenetre f
    where d.deleted_at is null
      and d.created_at >= f.d0::timestamptz
      and d.created_at < f.d1::timestamptz
  )
  select
    count(*)::bigint,
    (select n from precedent)::bigint,
    count(*) filter (where kind = 'won')::bigint,
    count(*) filter (where kind = 'lost')::bigint,
    count(*) filter (where kind = 'open')::bigint,
    case
      when count(*) filter (where kind in ('won', 'lost')) = 0 then 0
      else round(
        count(*) filter (where kind = 'won')::numeric
        / count(*) filter (where kind in ('won', 'lost')) * 100, 1)
    end,
    coalesce((
      select sum(j.total_cents)
      from public.jobs j
      where j.id in (select job_id from courant where job_id is not null)
        and j.deleted_at is null
    ), 0)::bigint,
    count(*) filter (where job_id is not null)::bigint,
    -- Badge « Job à créer » : dérivé, jamais stocké.
    count(*) filter (where kind = 'won' and job_id is null)::bigint
  from courant;
$fn$;

comment on function public.pipeline_kpis(date, date) is
  'Leads, taux de closing et revenus sur la période, plus la période précédente de même longueur pour l''écart. Taux de closing = gagnés ÷ (gagnés + perdus), sur les deals FERMÉS. Revenus = somme des jobs liées.';

-- ───────────────────────────────────────────────────────────────
-- 2. Par source et par campagne
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_par_source(
  p_from date default null,
  p_to   date default null
)
returns table (
  source                text,
  campagne              text,
  leads                 bigint,
  gagnes                bigint,
  perdus                bigint,
  taux_closing          numeric,
  revenus_cents         bigint,
  revenu_moyen_par_lead bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with bornes as (
    select coalesce(p_from, (current_date - interval '84 days')::date) as d1,
           coalesce(p_to, current_date) as d2
  ),
  d as (
    select dl.source, dl.utm_campaign, s.kind, dl.job_id
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    cross join bornes b
    where dl.deleted_at is null
      and dl.created_at >= b.d1::timestamptz
      and dl.created_at < (b.d2 + 1)::timestamptz
  ),
  revenus as (
    select d.source, d.utm_campaign, coalesce(sum(j.total_cents), 0) as cents
    from d
    join public.jobs j on j.id = d.job_id and j.deleted_at is null
    group by 1, 2
  )
  select
    d.source,
    d.utm_campaign,
    count(*)::bigint,
    count(*) filter (where d.kind = 'won')::bigint,
    count(*) filter (where d.kind = 'lost')::bigint,
    case
      when count(*) filter (where d.kind in ('won', 'lost')) = 0 then 0
      else round(count(*) filter (where d.kind = 'won')::numeric
                 / count(*) filter (where d.kind in ('won', 'lost')) * 100, 1)
    end,
    coalesce(max(r.cents), 0)::bigint,
    -- Revenu par lead : sur TOUS les leads de la ligne, pas seulement les
    -- gagnés — c'est ce qui permet de comparer deux campagnes.
    (coalesce(max(r.cents), 0) / greatest(count(*), 1))::bigint
  from d
  left join revenus r on r.source = d.source
    and r.utm_campaign is not distinct from d.utm_campaign
  group by d.source, d.utm_campaign
  order by count(*) desc;
$fn$;

comment on function public.pipeline_par_source(date, date) is
  'Leads, closing et revenus ventilés par source et par campagne. Revenu moyen par lead calculé sur TOUS les leads de la ligne, pour que deux campagnes soient comparables.';

-- ───────────────────────────────────────────────────────────────
-- 3. Entonnoir — sur l'HISTORIQUE, pas sur la position actuelle
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_entonnoir(
  p_from date default null,
  p_to   date default null
)
returns table (
  stage_id     uuid,
  nom_fr       text,
  nom_en       text,
  rang         integer,
  atteints     bigint,
  taux_passage numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
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
$fn$;

comment on function public.pipeline_entonnoir(date, date) is
  'Entonnoir calculé sur deal_stage_history : un deal qui est PASSÉ par une étape y compte, même s''il l''a quittée. Les étapes archivées restent comptées.';

-- ───────────────────────────────────────────────────────────────
-- 4. Vitesse : premier contact et durée du cycle
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_vitesse(
  p_from date default null,
  p_to   date default null
)
returns table (
  delai_contact_moyen_h numeric,
  jamais_contactes      bigint,
  closing_moins_1h      numeric,
  closing_moins_24h     numeric,
  closing_plus_24h      numeric,
  n_moins_1h            bigint,
  n_moins_24h           bigint,
  n_plus_24h            bigint,
  cycle_moyen_jours     numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with bornes as (
    select coalesce(p_from, (current_date - interval '84 days')::date) as d1,
           coalesce(p_to, current_date) as d2
  ),
  d as (
    select
      dl.id, s.kind, dl.created_at, dl.first_contacted_at, dl.won_at,
      case when dl.first_contacted_at is null then null
           else extract(epoch from (dl.first_contacted_at - dl.created_at)) / 3600.0
      end as h
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    cross join bornes b
    where dl.deleted_at is null
      and dl.created_at >= b.d1::timestamptz
      and dl.created_at < (b.d2 + 1)::timestamptz
  ),
  taux as (
    select
      case when h is null then null when h < 1 then 'a' when h < 24 then 'b' else 'c' end as tranche,
      kind
    from d
  )
  select
    round(coalesce(avg(h), 0)::numeric, 1),
    count(*) filter (where first_contacted_at is null)::bigint,
    -- Un taux sur zéro deal fermé n'existe pas : on rend NULL, pas 0 %.
    (select case when count(*) filter (where kind in ('won','lost')) = 0 then null
       else round(count(*) filter (where kind = 'won')::numeric
            / count(*) filter (where kind in ('won','lost')) * 100, 1) end
     from taux where tranche = 'a'),
    (select case when count(*) filter (where kind in ('won','lost')) = 0 then null
       else round(count(*) filter (where kind = 'won')::numeric
            / count(*) filter (where kind in ('won','lost')) * 100, 1) end
     from taux where tranche = 'b'),
    (select case when count(*) filter (where kind in ('won','lost')) = 0 then null
       else round(count(*) filter (where kind = 'won')::numeric
            / count(*) filter (where kind in ('won','lost')) * 100, 1) end
     from taux where tranche = 'c'),
    (select count(*) from taux where tranche = 'a')::bigint,
    (select count(*) from taux where tranche = 'b')::bigint,
    (select count(*) from taux where tranche = 'c')::bigint,
    round(coalesce(avg(extract(epoch from (won_at - created_at)) / 86400.0)
                   filter (where won_at is not null), 0)::numeric, 1)
  from d;
$fn$;

comment on function public.pipeline_vitesse(date, date) is
  'Délai moyen de premier contact et taux de closing par tranche (< 1 h, < 24 h, > 24 h), plus la durée moyenne du cycle. Un taux sur zéro deal fermé rend NULL, pas 0 % — la nuance change la lecture.';

-- ───────────────────────────────────────────────────────────────
-- 5. Ce qu'il faut traiter aujourd'hui — une liste, pas un graphique
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_a_traiter(p_jours integer default 7)
returns table (
  deal_id        uuid,
  client_nom     text,
  raison         text,
  stage_nom_fr   text,
  depuis_jours   integer
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select
    d.id,
    btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
    r.raison,
    s.name_fr,
    extract(day from (now() - d.last_activity_at))::integer
  from public.deals d
  join public.pipeline_stages s on s.id = d.stage_id
  join public.clients c on c.id = d.client_id
  cross join lateral (
    select case
      -- Un gagné sans job passe avant tout : c'est du revenu qui n'existe pas.
      when s.kind = 'won' and d.job_id is null then 'job_a_creer'
      when s.kind = 'open' and d.assigned_user_id is null then 'non_assigne'
      when s.kind = 'open'
        and d.last_activity_at <= now() - make_interval(days => greatest(p_jours, 1))
        then 'sans_activite'
      else null
    end as raison
  ) r
  where d.deleted_at is null
    and r.raison is not null
  order by
    case r.raison when 'job_a_creer' then 0 when 'non_assigne' then 1 else 2 end,
    d.last_activity_at;
$fn$;

comment on function public.pipeline_a_traiter(integer) is
  'Liste d''actions : deals gagnés sans job, leads non assignés, deals ouverts sans activité. Seuls les deals OUVERTS remontent pour l''inactivité — un gagné ou un perdu n''a pas à être relancé.';

-- ───────────────────────────────────────────────────────────────
-- 6. Tendance hebdomadaire — 12 semaines par défaut
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_tendance(p_semaines integer default 12)
returns table (
  semaine date,
  leads   bigint,
  gagnes  bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with semaines as (
    select generate_series(
      date_trunc('week', current_date - make_interval(weeks => greatest(p_semaines, 1) - 1)),
      date_trunc('week', current_date),
      interval '1 week'
    )::date as debut
  )
  select
    w.debut,
    (select count(*) from public.deals d
      where d.deleted_at is null
        and d.created_at >= w.debut::timestamptz
        and d.created_at < (w.debut + 7)::timestamptz)::bigint,
    (select count(*) from public.deals d
      where d.deleted_at is null and d.won_at is not null
        and d.won_at >= w.debut::timestamptz
        and d.won_at < (w.debut + 7)::timestamptz)::bigint
  from semaines w
  order by w.debut;
$fn$;

comment on function public.pipeline_tendance(integer) is
  'Leads créés et deals gagnés par semaine. Les gagnés sont comptés à leur date de victoire, pas de création : c''est ce qui montre le rythme réel des ventes.';

-- ───────────────────────────────────────────────────────────────
-- 7. Cohortes du formulaire — DÉNOMINATEUR DIFFÉRENT du taux de closing
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_cohortes(p_mois integer default 6)
returns table (
  mois        date,
  inscrits    bigint,
  gagnes      bigint,
  encore_ouvert bigint,
  taux_gagne  numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select
    date_trunc('month', d.created_at)::date,
    count(*)::bigint,
    count(*) filter (where s.kind = 'won')::bigint,
    count(*) filter (where s.kind = 'open')::bigint,
    -- Dénominateur : TOUS les leads du mois, y compris ceux encore ouverts.
    -- Ce n'est PAS le taux de closing, et l'écran doit le dire.
    round(count(*) filter (where s.kind = 'won')::numeric / greatest(count(*), 1) * 100, 1)
  from public.deals d
  join public.pipeline_stages s on s.id = d.stage_id
  where d.deleted_at is null
    and d.source = 'form_web'
    and d.created_at >= date_trunc('month', current_date - make_interval(months => greatest(p_mois, 1)))
  group by 1
  order by 1;
$fn$;

comment on function public.pipeline_cohortes(integer) is
  'Cohortes du formulaire : « X personnes ont rempli en [mois] → Y gagnées à date ». Le dénominateur inclut les deals ENCORE OUVERTS — formule différente du taux de closing, et le chiffre monte avec le temps.';

commit;
