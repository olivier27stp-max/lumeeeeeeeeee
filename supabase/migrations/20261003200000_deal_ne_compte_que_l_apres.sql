-- ═══════════════════════════════════════════════════════════════
-- Un deal ne compte que ce qui arrive APRÈS son entrée dans la pipeline
-- (Rafba, 2026-09-30 : « si le devis est créé après l'apparition dans la
-- pipeline, fine ; sinon non — même s'il y a eu un devis approuvé l'an
-- passé, ça ne devrait pas avancer automatiquement. Même chose pour une job
-- ou n'importe quoi »).
--
-- Cas réel : le deal porte-à-porte de William Hébert (Coquin lavage), créé le
-- 26 septembre dans « Nouveau lead », portait le devis #6 accepté le 31
-- juillet : la fiche affichait « Devis rattaché à ce deal · 793 $ » pour une
-- vente d'avant.
--
--   1. Garde sur `deals` : un devis ou une job créé AVANT le deal ne peut pas
--      lui être rattaché (le lien est ignoré, sans erreur — la création du
--      deal ne doit pas échouer pour ça). Même instant = accepté :
--      `pipeline_creer_deal` crée le devis dans la même transaction.
--   2. `pipeline_montants` : le repère « dernier devis du client » ne compte
--      que les devis faits depuis l'entrée du deal (idem job et devis liés,
--      par cohérence avec la garde).
--   3. Rattrapage : les liens existants vers un document antérieur sont
--      retirés (1 deal en prod au 2026-09-30, 0 job). Le devis lui-même ne
--      bouge pas : il reste dans l'historique du client.
--
-- Le texte de `pipeline_montants` repris ici est celui de la prod
-- (pg_get_functiondef, 2026-09-30), identique à 20260925110000.
--
-- ROLLBACK :
--   drop trigger if exists trg_deals_lien_posterieur on public.deals;
--   drop function if exists public.deals_lien_posterieur();
--   puis rejouer pipeline_montants de 20260925110000.
--   (les liens retirés au point 3 : deal 83aec09a… → quote 3c53c0e2…)
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.deals_lien_posterieur()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_depuis timestamptz := coalesce(new.created_at, now());
  v_cree   timestamptz;
begin
  if new.quote_id is not null
     and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    select created_at into v_cree from public.quotes where id = new.quote_id;
    if v_cree is not null and v_cree < v_depuis then
      new.quote_id := case when tg_op = 'UPDATE' then old.quote_id else null end;
    end if;
  end if;

  if new.job_id is not null
     and (tg_op = 'INSERT' or new.job_id is distinct from old.job_id) then
    select created_at into v_cree from public.jobs where id = new.job_id;
    if v_cree is not null and v_cree < v_depuis then
      new.job_id := case when tg_op = 'UPDATE' then old.job_id else null end;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.deals_lien_posterieur() is
  'Un devis ou une job créé avant le deal ne lui est jamais rattaché : un deal ne compte que ce qui arrive après son entrée dans la pipeline (Rafba, 2026-09-30).';

revoke all on function public.deals_lien_posterieur() from public;
revoke all on function public.deals_lien_posterieur() from anon, authenticated;
grant execute on function public.deals_lien_posterieur() to service_role;

drop trigger if exists trg_deals_lien_posterieur on public.deals;
create trigger trg_deals_lien_posterieur
  before insert or update of quote_id, job_id on public.deals
  for each row execute function public.deals_lien_posterieur();

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
   and j.created_at >= d.created_at
  left join public.quotes q
    on q.id = d.quote_id and q.deleted_at is null
   and q.created_at >= d.created_at
  -- Dernier devis du client fait DEPUIS l'entrée du deal, seulement si le
  -- deal n'a ni job ni devis lié. Un devis d'avant appartient à une autre vente.
  left join lateral (
    select q2.total_cents
    from public.quotes q2
    where q2.client_id = d.client_id
      and q2.org_id = d.org_id
      and q2.deleted_at is null
      and q2.total_cents > 0
      and q2.created_at >= d.created_at
      and d.job_id is null
      and d.quote_id is null
    order by q2.created_at desc
    limit 1
  ) qc on true
  where d.deleted_at is null;
$fn$;

comment on function public.pipeline_montants() is
  'Montant dérivé de chaque deal : job liée, sinon devis lié, sinon dernier devis du client — toujours fait DEPUIS l''entrée du deal (2026-09-30). Une job à 0 $ est ignorée — c''est une absence de chiffrage, pas un chiffrage à zéro (QA 2026-09-24, P0-1).';

-- Rattrapage. Le trigger ne s'applique qu'aux nouveaux liens : on retire
-- directement ceux qui pointent vers un document antérieur.
update public.deals d
   set quote_id = null, updated_at = now()
  from public.quotes q
 where q.id = d.quote_id
   and q.created_at < d.created_at;

update public.deals d
   set job_id = null, updated_at = now()
  from public.jobs j
 where j.id = d.job_id
   and j.created_at < d.created_at;

commit;
