-- ═══════════════════════════════════════════════════════════════
-- La valeur d'un deal, sans la stocker sur le deal
--
-- Décision Q5 : aucun montant sur `deals`. La valeur vient du devis, puis de
-- la job. Mais l'écran doit l'afficher — un pipeline de ventes sans montant
-- ne dit pas ce qui est en jeu.
--
-- Cette fonction la DÉRIVE, dans cet ordre :
--   1. la job liée (`deals.job_id`) — c'est le montant réel du travail ;
--   2. le devis lié (`deals.quote_id`) — l'engagement pris avec le client ;
--   3. le devis le plus récent du même client, s'il n'y a pas de lien direct
--      — c'est le cas des deals repris, qui n'ont ni job ni devis rattaché.
--
-- Le 3e point est une approximation assumée : un client peut avoir plusieurs
-- devis sans rapport avec ce deal. On rend donc aussi `provenance`, pour que
-- l'écran puisse dire d'où vient le chiffre au lieu de le présenter comme
-- une certitude.
--
-- SECURITY INVOKER : la RLS décide de ce qui est visible, et `org_id` vient
-- de la session — jamais d'un paramètre.
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.pipeline_montants()
returns table (
  deal_id    uuid,
  cents      bigint,
  provenance text
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select
    d.id,
    coalesce(j.total_cents, q.total_cents, qc.total_cents, 0)::bigint,
    case
      when j.total_cents is not null then 'job'
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
  'Valeur d''un deal, DÉRIVÉE : job liée, sinon devis lié, sinon dernier devis du client. Rend aussi la provenance, pour que l''écran dise d''où vient le chiffre plutôt que de le présenter comme une certitude. Aucun montant n''est stocké sur le deal (décision Q5).';

commit;
