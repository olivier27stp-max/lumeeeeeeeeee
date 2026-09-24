-- ═══════════════════════════════════════════════════════════════
-- Prévisions groupées — le « Group by » de l'onglet Forecast
--
-- L'onglet montrait quatre totaux. Un total ne dit pas D'OÙ vient la
-- prévision : savoir qu'on attend 40 000 $ n'aide pas, savoir que 32 000 $
-- tiennent à trois deals coincés en « Soumission envoyée » se répare.
--
-- Une seule fonction, trois regroupements (étape, vendeur, source), parce
-- que les colonnes retournées sont identiques : trois fonctions jumelles
-- dériveraient l'une de l'autre au premier ajustement du calcul.
--
-- Les colonnes reprennent le tableau de GoHighLevel :
--   nb          — combien de deals (leur « Opportunities »)
--   potentiel   — la somme brute      (« Max potential »)
--   attendu     — pondéré par la probabilité (« Expected »)
--   gagne       — déjà encaissé       (« Won »)
--   total       — potentiel + gagné   (« Total potential »)
--
-- SECURITY INVOKER : c'est la RLS qui décide ce que l'appelant voit, et
-- `org_id` ne peut pas être passé en paramètre. Un deal d'une autre
-- organisation ne peut donc pas entrer dans le calcul.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_previsions_groupees(
  p_pipeline_id uuid default null::uuid,
  -- 'etape' | 'vendeur' | 'source'
  p_groupe text default 'etape'
)
returns table (
  cle             text,
  libelle         text,
  nb              bigint,
  potentiel_cents bigint,
  attendu_cents   bigint,
  gagne_cents     bigint,
  total_cents     bigint,
  rang            integer
)
language sql
stable
set search_path to 'public'
as $fn$
  with m as (select * from public.pipeline_montants()),
  d as (
    select
      dl.id,
      dl.assigned_user_id,
      dl.source,
      dl.statut,
      s.id   as stage_id,
      s.kind,
      s.position,
      s.name_fr,
      s.name_en,
      -- Même règle que `pipeline_previsions` : la probabilité du deal ne
      -- l'emporte que si le pipeline le demande, sinon c'est l'étape.
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
  ),
  -- Un deal abandonné n'est ni gagné ni perdu : le prospect ne répond plus.
  -- L'inclure dans le potentiel ferait espérer un revenu que personne
  -- n'attend plus.
  vivants as (
    select * from d where statut::text is distinct from 'abandonne'
  ),
  groupe as (
    select
      case p_groupe
        when 'vendeur' then coalesce(assigned_user_id::text, '(non assigne)')
        when 'source'  then coalesce(nullif(btrim(source), ''), '(sans source)')
        else stage_id::text
      end as cle,
      case p_groupe
        when 'vendeur' then null::integer
        when 'source'  then null::integer
        else position
      end as rang,
      assigned_user_id,
      source,
      name_fr, name_en,
      kind, prob, cents
    from vivants
  ),
  agg as (
    select
      g.cle,
      min(g.rang) as rang,
      min(g.assigned_user_id::text) as un_membre,
      min(coalesce(nullif(btrim(g.source), ''), '(sans source)')) as une_source,
      min(g.name_fr) as un_nom_fr,
      min(g.name_en) as un_nom_en,
      count(*) filter (where g.kind = 'open')::bigint as nb,
      coalesce(sum(g.cents) filter (where g.kind = 'open'), 0)::bigint as potentiel,
      -- Pondéré : seuls les deals dont la probabilité est connue y entrent.
      -- Compter un deal sans estimation comme 0 % le ferait disparaître du
      -- revenu attendu sans jamais le signaler.
      coalesce(sum((g.cents * g.prob) / 100)
        filter (where g.kind = 'open' and g.prob is not null), 0)::bigint as attendu,
      coalesce(sum(g.cents) filter (where g.kind = 'won'), 0)::bigint as gagne
    from groupe g
    group by g.cle
  )
  select
    a.cle,
    case p_groupe
      when 'vendeur' then coalesce(
        nullif(btrim(coalesce(tm.first_name, '') || ' ' || coalesce(tm.last_name, '')), ''),
        tm.email,
        '(non assigné)'
      )
      when 'source' then a.une_source
      -- Le nom d'étape reste dans les deux langues : c'est l'appelant qui
      -- sait laquelle afficher.
      else coalesce(a.un_nom_fr, a.un_nom_en, '?')
    end as libelle,
    a.nb,
    a.potentiel,
    a.attendu,
    a.gagne,
    (a.potentiel + a.gagne)::bigint as total,
    a.rang
  from agg a
  left join lateral (
    select t.first_name, t.last_name, t.email
    from public.team_members t
    where p_groupe = 'vendeur' and t.user_id = nullif(a.un_membre, '(non assigne)')::uuid
    limit 1
  ) tm on true
  -- Par étape on garde l'ordre du board ; sinon le plus gros potentiel
  -- d'abord, parce que c'est ce qu'on vient chercher.
  order by
    case when p_groupe = 'etape' then a.rang end nulls last,
    case when p_groupe = 'etape' then null else (a.potentiel + a.gagne) end desc nulls last;
$fn$;

revoke all on function public.pipeline_previsions_groupees(uuid, text) from public, anon;
grant execute on function public.pipeline_previsions_groupees(uuid, text) to authenticated;

comment on function public.pipeline_previsions_groupees(uuid, text) is
  'Prévisions ventilées par étape, vendeur ou source. SECURITY INVOKER : la RLS décide, org_id n''est jamais un paramètre. Les deals abandonnés sont exclus du potentiel.';

commit;
