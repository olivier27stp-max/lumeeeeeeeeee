-- ═══════════════════════════════════════════════════════════════
-- Les deux blocs « Bientôt » de la page Statistiques deviennent des chiffres
--
-- Les données étaient là depuis le début — `lost_reason`, `lost_from_stage_id`
-- et `assigned_user_id` sont écrits sur chaque deal — mais aucune fonction ne
-- les agrégeait. La page affichait donc honnêtement « Bientôt » plutôt qu'un
-- chiffre approximatif. On la rend mesurable.
--
-- Mêmes règles que les sept fonctions de statistiques existantes :
-- SECURITY INVOKER (la RLS décide de ce que l'appelant voit), `org_id` JAMAIS
-- en paramètre — il vient de la session, sinon n'importe qui lirait les
-- chiffres d'une autre entreprise en changeant un argument.
--
-- Rappel de la distinction qui structure toute cette page :
--   taux de closing = gagnés ÷ (gagnés + perdus)  → sur les deals FERMÉS
-- Un deal encore ouvert n'est ni une victoire ni une défaite ; l'inclure
-- ferait baisser le taux de tout le monde à mesure que le pipeline grossit.
--
-- NOUVEAU depuis le statut « abandonné » : un deal abandonné (le client ne
-- répond plus) n'est PAS une défaite commerciale. Il est compté à part et
-- EXCLU du taux de closing — sans quoi un vendeur qui relance beaucoup de
-- prospects injoignables paraîtrait mauvais.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Pourquoi on perd, et depuis quelle étape
--
--    L'étape compte autant que la raison : « trop cher » à la qualification
--    et « trop cher » après la visite ne se corrigent pas au même endroit.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.pipeline_raisons_perte(date, date);

create function public.pipeline_raisons_perte(
  p_from date default null,
  p_to   date default null
)
returns table (
  raison         text,
  etape_perdue   text,
  etape_perdue_en text,
  perdus         bigint,
  part           numeric
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
  perdus as (
    select
      -- Une raison vide reste visible : « non renseignée » est en soi un
      -- constat sur la discipline de saisie, pas une ligne à masquer.
      coalesce(nullif(btrim(dl.lost_reason), ''), '(non renseignée)') as raison,
      dl.lost_from_stage_id
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    cross join bornes b
    where dl.deleted_at is null
      and s.kind = 'lost'
      -- Abandonné ≠ perdu : le client n'a pas dit non, il ne répond plus.
      and dl.statut <> 'abandonne'
      and coalesce(dl.lost_at, dl.updated_at) >= b.d1::timestamptz
      and coalesce(dl.lost_at, dl.updated_at) < (b.d2 + 1)::timestamptz
  ),
  total as (select count(*)::numeric as n from perdus)
  select
    p.raison,
    coalesce(st.name_fr, '(étape supprimée)') as etape_perdue,
    coalesce(st.name_en, '(deleted stage)')   as etape_perdue_en,
    count(*)::bigint as perdus,
    case when t.n > 0 then round(count(*)::numeric * 100 / t.n, 1) else 0 end as part
  from perdus p
  cross join total t
  left join public.pipeline_stages st on st.id = p.lost_from_stage_id
  group by p.raison, st.name_fr, st.name_en, t.n
  order by count(*) desc, p.raison;
$fn$;

comment on function public.pipeline_raisons_perte(date, date) is
  'Deals perdus ventilés par raison ET par étape de perte — c''est l''étape qui dit où agir. Les deals abandonnés (client injoignable) sont exclus : ce ne sont pas des défaites commerciales.';

-- ───────────────────────────────────────────────────────────────
-- 2. Par vendeur
--
--    Les non-assignés ont leur propre ligne : ce sont des leads que personne
--    n'a pris, et les noyer dans une moyenne les rendrait invisibles — alors
--    que c'est exactement ce qu'un patron doit voir.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.pipeline_par_vendeur(date, date);

create function public.pipeline_par_vendeur(
  p_from date default null,
  p_to   date default null
)
returns table (
  membre_id            uuid,
  nom                  text,
  deals_pris           bigint,
  gagnes               bigint,
  perdus               bigint,
  abandonnes           bigint,
  ouverts              bigint,
  taux_closing         numeric,
  delai_premier_contact_h numeric,
  revenus_cents        bigint
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
      dl.assigned_user_id,
      s.kind,
      dl.statut,
      dl.job_id,
      -- Délai en heures entre l'arrivée du lead et le premier contact.
      -- Un deal jamais contacté ne compte pas dans la moyenne : il la ferait
      -- exploser sans dire depuis quand il attend (« À traiter » le montre).
      case when dl.first_contacted_at is not null
        then extract(epoch from (dl.first_contacted_at - dl.created_at)) / 3600.0
      end as delai_h
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    cross join bornes b
    where dl.deleted_at is null
      and dl.created_at >= b.d1::timestamptz
      and dl.created_at < (b.d2 + 1)::timestamptz
  ),
  revenus as (
    select d.assigned_user_id, coalesce(sum(j.total_cents), 0) as cents
    from d
    join public.jobs j on j.id = d.job_id and j.deleted_at is null
    group by 1
  ),
  agg as (
    select
      d.assigned_user_id as membre_id,
      count(*)::bigint as deals_pris,
      count(*) filter (where d.kind = 'won')::bigint as gagnes,
      count(*) filter (where d.kind = 'lost' and d.statut <> 'abandonne')::bigint as perdus,
      count(*) filter (where d.statut = 'abandonne')::bigint as abandonnes,
      count(*) filter (where d.kind = 'open')::bigint as ouverts,
      round(avg(d.delai_h)::numeric, 1) as delai_premier_contact_h
    from d
    group by 1
  )
  select
    a.membre_id,
    -- Le nom vient de `team_members` (et non de `profiles`, qui ne porte
    -- qu'un `full_name` sans courriel de repli) : c'est la même source que
    -- le sélecteur « Assigner à » de l'application.
    coalesce(
      nullif(btrim(coalesce(tm.first_name, '') || ' ' || coalesce(tm.last_name, '')), ''),
      tm.email,
      '(non assigné)'
    ) as nom,
    a.deals_pris,
    a.gagnes,
    a.perdus,
    a.abandonnes,
    a.ouverts,
    -- Fermés seulement, abandonnés exclus : un prospect injoignable n'est pas
    -- une défaite commerciale et ne doit pas pénaliser le vendeur.
    case when (a.gagnes + a.perdus) > 0
      then round(a.gagnes::numeric * 100 / (a.gagnes + a.perdus), 1)
      else 0 end as taux_closing,
    a.delai_premier_contact_h,
    coalesce(r.cents, 0)::bigint as revenus_cents
  from agg a
  -- `team_members` est portée par organisation : sans `limit 1` latéral, un
  -- utilisateur membre de deux entreprises dupliquerait sa ligne. La RLS ne
  -- laisse voir que les siennes, mais on ne s'appuie pas là-dessus pour la
  -- forme du résultat.
  left join lateral (
    select t.first_name, t.last_name, t.email
    from public.team_members t
    where t.user_id = a.membre_id
    limit 1
  ) tm on true
  left join revenus r on r.assigned_user_id is not distinct from a.membre_id
  -- Les non-assignés en dernier : c'est une alerte, pas un vendeur.
  order by (a.membre_id is null), a.gagnes desc, a.deals_pris desc;
$fn$;

comment on function public.pipeline_par_vendeur(date, date) is
  'Deals pris, gagnés, perdus, abandonnés, taux de closing (deals fermés seuls, abandonnés exclus) et délai moyen de premier contact, par membre. Les deals non assignés ont leur propre ligne.';

commit;
