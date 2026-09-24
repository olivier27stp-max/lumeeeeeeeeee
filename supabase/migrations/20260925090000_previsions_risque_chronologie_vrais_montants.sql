-- ═══════════════════════════════════════════════════════════════
-- Les deux dernières fonctions de Prévisions comptaient encore
-- l'argent fantôme
--
-- `20260924210000` a corrigé `pipeline_previsions` et
-- `pipeline_previsions_groupees` : seul un montant qui chiffre VRAIMENT le
-- deal (job liée ou devis lié) entre dans un total. Le « dernier devis du
-- client » ('devis_client') est un repère, pas la valeur de ce deal-ci.
--
-- Deux fonctions du MÊME écran avaient été oubliées :
--   · `pipeline_a_risque`     — le montant des deals qui glissent
--   · `pipeline_chronologie`  — le potentiel par mois de fermeture
--
-- Elles additionnaient encore tout. L'onglet Prévisions aurait donc affiché
-- « 0 $ de revenu potentiel » en haut et « 4 900 $ à risque » plus bas, sur
-- les mêmes deals. Aujourd'hui les deux rendent 0 en production, mais
-- seulement parce qu'aucun deal n'a de date de fermeture ni de report : dès
-- qu'on en saisit une, l'écart réapparaîtrait.
--
-- Une seule règle pour tout l'écran : un montant compte s'il chiffre ce
-- deal. Rien d'autre ne change dans ces deux fonctions.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── Deals à risque ──────────────────────────────────────────────
create or replace function public.pipeline_a_risque(
  p_pipeline_id uuid default null::uuid,
  p_haut_fois integer default 2,
  p_haut_jours integer default 14,
  p_moyen_fois integer default 1,
  p_moyen_jours integer default 7
)
returns table (niveau text, deals bigint, montant_cents bigint)
language sql
stable
set search_path to 'public'
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      dl.id, dl.slippage_count, dl.slippage_days,
      -- Même règle que les quatre totaux du haut : un deal non chiffré pèse
      -- 0, il ne emprunte pas le montant d'un autre devis du client.
      case when m.provenance in ('job', 'devis') then coalesce(m.cents, 0) else 0 end as cents
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
  'Deals dont la date visée a été repoussée, par niveau de risque. Seuls les montants qui chiffrent le deal comptent — même règle que pipeline_previsions.';

-- ── Chronologie par mois ────────────────────────────────────────
create or replace function public.pipeline_chronologie(
  p_pipeline_id uuid default null::uuid,
  p_mois integer default 6
)
returns table (mois date, deals bigint, potentiel_cents bigint, gagne_cents bigint)
language sql
stable
set search_path to 'public'
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      date_trunc('month', dl.expected_close_date)::date as mois,
      s.kind,
      case when m.provenance in ('job', 'devis') then coalesce(m.cents, 0) else 0 end as cents
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
  'Deals par mois de fermeture visée. Seuls les montants qui chiffrent le deal comptent — même règle que pipeline_previsions.';

commit;
