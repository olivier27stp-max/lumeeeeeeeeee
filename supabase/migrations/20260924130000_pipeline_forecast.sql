-- ═══════════════════════════════════════════════════════════════
-- Prévisions : probabilité par étape, date de fermeture, glissements
--
-- CE QUI CHANGE PAR RAPPORT À LA DÉCISION D'ORIGINE. On avait écarté la
-- probabilité par étape (Q5, 2026-09-23) parce qu'un pourcentage fixe est une
-- fiction : ce n'est pas parce qu'un deal est en « Soumission envoyée » qu'il
-- a 60 % de chances de se conclure.
--
-- Cette objection reste vraie, et c'est pour ça que les chiffres sont
-- présentés comme une PROJECTION, jamais comme une prévision. Mais sans
-- probabilité il n'y a pas d'« Expected revenue » du tout, et l'écran de
-- prévisions demandé perd son intérêt. Un chiffre discutable qu'on peut
-- corriger vaut mieux qu'une colonne vide.
--
-- Trois ajouts, tous facultatifs :
--
--   · `pipeline_stages.probability` — 0 à 100, `null` = non renseignée.
--     Une étape sans probabilité ne contribue PAS au revenu attendu : elle
--     n'est pas comptée à zéro, elle est absente du calcul. La différence
--     compte, parce qu'un pipeline non configuré afficherait sinon 0 $
--     attendu tout en ayant des deals bien vivants.
--
--   · `deals.expected_close_date` — la date visée. Sans elle, un deal n'a
--     pas de mois dans la chronologie : il tombe dans « Sans date », que
--     l'écran montre au lieu de le cacher (c'est une donnée à corriger).
--
--   · `deals.slippage_count` / `slippage_days` — combien de fois la date a
--     été repoussée, et de combien. C'est ce qui rend « At-risk » mesurable :
--     un deal qui glisse trois fois ne se comporte pas comme un deal calme.
--     Tenus par un trigger, jamais écrits à la main.
--
-- `show_in_reports` sur l'étape : une colonne « Spam » ou « Doublon » ne
-- doit pas peser dans un entonnoir.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. L'étape porte sa probabilité
-- ───────────────────────────────────────────────────────────────
alter table public.pipeline_stages
  add column if not exists probability integer,
  add column if not exists show_in_reports boolean not null default true;

alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_probability_bornee;
alter table public.pipeline_stages
  add constraint pipeline_stages_probability_bornee
  check (probability is null or (probability >= 0 and probability <= 100));

comment on column public.pipeline_stages.probability is
  'Chance de conclure depuis cette étape, 0-100. NULL = non renseignée : l''étape est alors ABSENTE du revenu attendu, pas comptée à zéro.';
comment on column public.pipeline_stages.show_in_reports is
  'false = l''étape est exclue des entonnoirs et des prévisions (« Spam », « Doublon »…).';

-- Les étapes gagnées valent 100 %, les perdues 0 % : ce ne sont pas des
-- estimations, ce sont des faits. On ne les pose que là où rien n'est déjà
-- renseigné, pour ne jamais écraser un choix de l'utilisateur.
update public.pipeline_stages
set probability = case kind when 'won' then 100 when 'lost' then 0 end
where probability is null and kind in ('won', 'lost');

-- ───────────────────────────────────────────────────────────────
-- 2. Le deal porte sa date visée et ses glissements
-- ───────────────────────────────────────────────────────────────
alter table public.deals
  add column if not exists expected_close_date date,
  add column if not exists slippage_count integer not null default 0,
  add column if not exists slippage_days integer not null default 0;

comment on column public.deals.expected_close_date is
  'Date de fermeture visée. NULL = le deal tombe dans « Sans date » de la chronologie — une donnée à corriger, pas à cacher.';
comment on column public.deals.slippage_count is
  'Combien de fois la date visée a été repoussée. Tenu par trigger.';
comment on column public.deals.slippage_days is
  'Total des jours de report cumulés. Tenu par trigger.';

create index if not exists idx_deals_expected_close
  on public.deals (org_id, expected_close_date)
  where deleted_at is null;

-- ───────────────────────────────────────────────────────────────
-- 3. Le glissement se mesure tout seul
--
--    Seul un report COMPTE : avancer une date n'est pas un glissement, c'est
--    une bonne nouvelle. Sans cette distinction, un deal qu'on rapproche
--    passerait pour à risque.
-- ───────────────────────────────────────────────────────────────
create or replace function public.deals_mesurer_glissement()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.expected_close_date is distinct from old.expected_close_date
     and old.expected_close_date is not null
     and new.expected_close_date is not null
     and new.expected_close_date > old.expected_close_date
  then
    new.slippage_count := coalesce(old.slippage_count, 0) + 1;
    new.slippage_days := coalesce(old.slippage_days, 0)
      + (new.expected_close_date - old.expected_close_date);
  end if;
  return new;
end;
$fn$;

revoke all on function public.deals_mesurer_glissement() from public, anon, authenticated;

drop trigger if exists trg_deals_mesurer_glissement on public.deals;
create trigger trg_deals_mesurer_glissement
  before update of expected_close_date on public.deals
  for each row execute function public.deals_mesurer_glissement();

-- ───────────────────────────────────────────────────────────────
-- 4. Les chiffres du haut de l'écran
--
--    SECURITY INVOKER : la RLS décide de ce que l'appelant voit, et `org_id`
--    n'est jamais un paramètre — il vient de la session.
--
--    « Max potentiel » compte TOUS les deals ouverts à leur pleine valeur ;
--    « attendu » les pondère par la probabilité de leur étape. Un deal dont
--    l'étape n'a pas de probabilité est absent de l'attendu mais présent
--    dans le potentiel : on ne prétend pas savoir ce qu'on ignore.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.pipeline_previsions(uuid);

create function public.pipeline_previsions(p_pipeline_id uuid default null)
returns table (
  max_potentiel_cents  bigint,
  attendu_cents        bigint,
  gagne_cents          bigint,
  ouverts              bigint,
  sans_date            bigint,
  sans_montant         bigint,
  en_retard            bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      dl.id, dl.expected_close_date, s.kind,
      coalesce(s.probability, null) as prob,
      coalesce(m.cents, 0) as cents
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
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

comment on function public.pipeline_previsions(uuid) is
  'Chiffres de prévision d''un pipeline (ou de tous). Le revenu attendu ne compte QUE les étapes qui portent une probabilité — une étape non renseignée est absente, pas comptée à zéro.';

-- ───────────────────────────────────────────────────────────────
-- 5. Les deals qui glissent
--
--    Trois niveaux, exclusifs : un deal à haut risque ne compte pas aussi
--    comme moyen, sinon les trois cases additionnées dépasseraient le total.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.pipeline_a_risque(uuid, integer, integer, integer, integer);

create function public.pipeline_a_risque(
  p_pipeline_id uuid default null,
  p_haut_fois   integer default 2,
  p_haut_jours  integer default 14,
  p_moyen_fois  integer default 1,
  p_moyen_jours integer default 7
)
returns table (
  niveau        text,
  deals         bigint,
  montant_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      dl.id, dl.slippage_count, dl.slippage_days,
      coalesce(m.cents, 0) as cents
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    left join m on m.deal_id = dl.id
    where dl.deleted_at is null
      and s.kind = 'open'
      and s.show_in_reports
      and (p_pipeline_id is null or dl.pipeline_id = p_pipeline_id)
  ),
  classe as (
    select
      cents,
      case
        when slippage_count >= p_haut_fois or slippage_days >= p_haut_jours then 'haut'
        when slippage_count >= p_moyen_fois or slippage_days >= p_moyen_jours then 'moyen'
        when slippage_count >= 1 or slippage_days >= 1 then 'faible'
      end as niveau
    from d
  )
  select n.niveau,
         count(c.niveau)::bigint,
         coalesce(sum(c.cents), 0)::bigint
  from (values ('haut'), ('moyen'), ('faible')) as n(niveau)
  left join classe c on c.niveau = n.niveau
  group by n.niveau
  order by case n.niveau when 'haut' then 1 when 'moyen' then 2 else 3 end;
$fn$;

comment on function public.pipeline_a_risque(uuid, integer, integer, integer, integer) is
  'Deals ouverts dont la date visée a été repoussée, par niveau de risque. Les trois niveaux sont exclusifs : leur somme ne dépasse jamais le total.';

-- ───────────────────────────────────────────────────────────────
-- 6. La chronologie : par mois de fermeture visée
-- ───────────────────────────────────────────────────────────────
drop function if exists public.pipeline_chronologie(uuid, integer);

create function public.pipeline_chronologie(
  p_pipeline_id uuid default null,
  p_mois        integer default 6
)
returns table (
  mois           date,
  deals          bigint,
  potentiel_cents bigint,
  gagne_cents    bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      date_trunc('month', dl.expected_close_date)::date as mois,
      s.kind,
      coalesce(m.cents, 0) as cents
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    left join m on m.deal_id = dl.id
    where dl.deleted_at is null
      and s.show_in_reports
      and dl.expected_close_date is not null
      and dl.expected_close_date >= (date_trunc('month', current_date) - make_interval(months => 1))::date
      and dl.expected_close_date < (date_trunc('month', current_date) + make_interval(months => p_mois))::date
      and (p_pipeline_id is null or dl.pipeline_id = p_pipeline_id)
  )
  select mois,
         count(*)::bigint,
         coalesce(sum(cents), 0)::bigint,
         coalesce(sum(cents) filter (where kind = 'won'), 0)::bigint
  from d
  group by mois
  order by mois;
$fn$;

comment on function public.pipeline_chronologie(uuid, integer) is
  'Deals par mois de fermeture visée, avec le potentiel et le déjà gagné. Les deals sans date sont ABSENTS — l''écran les compte à part, via pipeline_previsions.sans_date.';

commit;
