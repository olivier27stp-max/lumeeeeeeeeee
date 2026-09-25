-- ═══════════════════════════════════════════════════════════════
-- Trois correctifs de l'audit QA du 24 septembre 2026
--
-- P0-3. Une étape ARCHIVÉE gardait sa position et bloquait la création
--       d'une nouvelle étape : « duplicate key value violates unique
--       constraint "pipeline_stages_position_unique" » remontait telle
--       quelle à l'utilisateur. Une étape archivée ne s'affiche plus, elle
--       n'a donc plus de place à réserver dans l'ordre du board.
--
-- P0-4. Une raison de perte retirée puis ré-ajoutée disparaissait : l'index
--       unique sur le libellé compte les lignes archivées, l'insert échoue,
--       et le code rendait la ligne archivée telle quelle. L'écran annonçait
--       « Motif ajouté » sans que rien n'apparaisse. L'index ignore
--       désormais les archivées — une réactivation devient un simple insert.
--
-- P0-1 bis. Le montant d'un deal vient de `coalesce(job, devis, …)`. Une job
--       créée à 0 $ (le cas par défaut quand on gagne un deal sans chiffrer
--       la job) écrasait donc un devis de 1 500 $, et la carte affichait
--       « Montant à venir ». Une job à zéro n'est pas un chiffrage : c'est
--       une absence de chiffrage, et on retombe sur le devis.
--
-- ROLLBACK. Chaque index partiel remplace un index total de même nom. Pour
-- revenir en arrière :
--   drop index public.pipeline_stages_position_unique;
--   alter table public.pipeline_stages
--     add constraint pipeline_stages_position_unique
--     unique (pipeline_id, position) deferrable initially deferred;
--   drop index public.uq_pipeline_raisons_perte_libelle;
--   create unique index uq_pipeline_raisons_perte_libelle
--     on public.pipeline_raisons_perte_liste (org_id, lower(btrim(libelle)));
-- et restaurer `pipeline_montants` depuis la migration précédente.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── P0-3 : les étapes archivées libèrent leur position ──────────
--
-- La contrainte était DEFERRABLE, ce qui permet de permuter deux étapes dans
-- une même transaction sans échouer au milieu. Un index partiel n'est pas
-- « deferrable » : on garde donc le report en vérifiant à la place que
-- `reordonnerEtapes` écrit bien toutes les positions d'un coup — c'est déjà
-- le cas (une seule requête, toutes les lignes).
alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_position_unique;

create unique index if not exists pipeline_stages_position_unique
  on public.pipeline_stages (pipeline_id, position)
  where archived_at is null;

comment on index public.pipeline_stages_position_unique is
  'Unicité de position entre étapes ACTIVES seulement : une étape archivée ne s''affiche plus, elle ne réserve donc plus sa place dans l''ordre du board (QA 2026-09-24, P0-3).';

-- ── P0-4 : un libellé archivé ne bloque plus la réactivation ────
drop index if exists public.uq_pipeline_raisons_perte_libelle;

create unique index if not exists uq_pipeline_raisons_perte_libelle
  on public.pipeline_raisons_perte_liste (org_id, lower(btrim(libelle)))
  where archived_at is null;

comment on index public.uq_pipeline_raisons_perte_libelle is
  'Unicité du libellé entre motifs ACTIFS seulement : ré-ajouter un motif retiré doit le faire réapparaître, pas échouer en silence (QA 2026-09-24, P0-4).';

-- ── P0-1 bis : une job à 0 $ n'écrase plus le devis ─────────────
--
-- Reprise à l'identique de la version en base, avec une seule différence :
-- `nullif(j.total_cents, 0)`. Gagner un deal crée une job sans montant ;
-- sans ce garde-fou, le devis accepté disparaît de la carte et des totaux
-- de colonne au moment même où la vente est conclue.
create or replace function public.pipeline_montants()
returns table (deal_id uuid, cents bigint, provenance text)
language sql
stable
set search_path to 'public'
as $fn$
  select
    d.id,
    coalesce(nullif(j.total_cents, 0), q.total_cents, qc.total_cents, 0)::bigint,
    case
      when nullif(j.total_cents, 0) is not null then 'job'
      when q.total_cents is not null then 'devis'
      when qc.total_cents is not null then 'devis_client'
      else 'aucun'
    end
  from public.deals d
  left join public.jobs j
    on j.id = d.job_id and j.deleted_at is null
  left join public.quotes q
    on q.id = d.quote_id and q.deleted_at is null
  -- Dernier devis du client, seulement si le deal n'a ni job ni devis lié.
  left join lateral (
    select q2.total_cents
    from public.quotes q2
    where q2.client_id = d.client_id
      and q2.org_id = d.org_id
      and q2.deleted_at is null
      and q2.total_cents > 0
      and d.job_id is null
      and d.quote_id is null
    order by q2.created_at desc
    limit 1
  ) qc on true
  where d.deleted_at is null;
$fn$;

comment on function public.pipeline_montants() is
  'Montant dérivé de chaque deal : job liée, sinon devis lié, sinon dernier devis du client. Une job à 0 $ est ignorée — c''est une absence de chiffrage, pas un chiffrage à zéro (QA 2026-09-24, P0-1).';

commit;
