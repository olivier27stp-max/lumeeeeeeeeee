-- ═══════════════════════════════════════════════════════════════
-- Les prévisions comptaient de l'argent qui n'existe pas
--
-- LE SYMPTÔME. Le board affichait 0 $ sur toutes les colonnes pendant que
-- l'onglet Prévisions annonçait 7 806,81 $ de « revenu potentiel maximum ».
-- Deux écrans, deux vérités, sur les mêmes 22 deals.
--
-- LA CAUSE. `pipeline_montants()` étiquette d'où vient chaque montant :
--   · 'job'          — la job liée au deal        → c'est le vrai montant
--   · 'devis'        — le devis lié au deal       → c'est le vrai montant
--   · 'devis_client' — le DERNIER devis du client, qui ne chiffre PAS ce
--                      deal-ci ; c'est un repère, pas une valeur
--   · 'aucun'        — rien de chiffré
--
-- Le board écarte déjà 'devis_client' (`fetchMontants`, src/lib/
-- pipelineVentesApi.ts) : afficher 4 900 $ sur un « Nouveau lead » que
-- personne n'a chiffré ferait gonfler la colonne avec de l'argent imaginaire.
-- Les prévisions, elles, additionnaient tout — d'où l'écart.
--
-- En production les 7 806,81 $ venaient À 100 % de 'devis_client' : aucun
-- des 22 deals n'avait de devis ou de job à lui. Le chiffre annoncé était
-- donc entièrement faux, et c'est sur lui qu'on aurait planifié un mois.
--
-- LA RÈGLE. Un montant n'entre dans une prévision que s'il chiffre CE deal.
-- Le repère « dernier devis du client » reste visible dans la fiche, où il
-- est expliqué — pas dans un total.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── Les quatre totaux du haut ───────────────────────────────────
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
      -- Seul un montant qui chiffre CE deal compte. 'devis_client' est le
      -- dernier devis du client : un repère, pas la valeur de ce deal.
      case when m.provenance in ('job', 'devis') then coalesce(m.cents, 0) else 0 end as cents
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

comment on function public.pipeline_previsions(uuid) is
  'Prévisions du pipeline. Seuls les montants qui chiffrent le deal (job ou devis lié) comptent : le dernier devis du client est un repère, pas une valeur — même règle que le board.';

-- ── La ventilation par étape / responsable / source ─────────────
create or replace function public.pipeline_previsions_groupees(
  p_pipeline_id uuid default null::uuid,
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
      case
        when p.use_deal_probability then coalesce(dl.probability, s.probability)
        else s.probability
      end as prob,
      -- Même règle que ci-dessus : le repère « dernier devis du client »
      -- n'entre pas dans un total.
      case when m.provenance in ('job', 'devis') then coalesce(m.cents, 0) else 0 end as cents
    from public.deals dl
    join public.pipeline_stages s on s.id = dl.stage_id
    join public.pipelines_ventes p on p.id = dl.pipeline_id
    left join m on m.deal_id = dl.id
    where dl.deleted_at is null
      and s.show_in_reports
      and (p_pipeline_id is null or dl.pipeline_id = p_pipeline_id)
  ),
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
      assigned_user_id, source, name_fr, name_en, kind, prob, cents
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
  order by
    case when p_groupe = 'etape' then a.rang end nulls last,
    case when p_groupe = 'etape' then null else (a.potentiel + a.gagne) end desc nulls last;
$fn$;

comment on function public.pipeline_previsions_groupees(uuid, text) is
  'Prévisions ventilées par étape, vendeur ou source. Seuls les montants qui chiffrent le deal comptent. SECURITY INVOKER : la RLS décide, org_id n''est jamais un paramètre.';

commit;
