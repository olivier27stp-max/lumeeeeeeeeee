-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs: sale_date éditable + show_on_leaderboard
-- ═══════════════════════════════════════════════════════════════════════════
-- Contexte : le leaderboard lit pipeline_deals (stage = 'closed_won', classé
-- par won_at). Un job créé avec un vendeur assigné EST un close, mais le
-- trigger historique (trg_auto_pipeline_deal_from_job, 20260513200000) était
-- inopérant : INSERT-only alors que salesperson_id est posé par un UPDATE
-- post-insert (le RPC de création ne le prend pas), et stage 'won' qui viole
-- le CHECK actuel.
--
-- Cette migration :
--   1. jobs.sale_date date — la « journée du close ». Défaut : aujourd'hui.
--      Modifiable au form pour entrer un close oublié sans fausser le
--      leaderboard du jour courant (won_at du deal = sale_date).
--   2. jobs.show_on_leaderboard boolean — cochée par défaut ; décochée, le
--      job ne crée/n'avance aucun deal et son deal 'job' est retiré.
--   3. Recrée la vue jobs_active (SELECT j.* fige la liste de colonnes).
--   4. Remplace le trigger cassé par sync_job_leaderboard_deal() qui écoute
--      INSERT et UPDATE (salesperson_id, sale_date, show_on_leaderboard,
--      totaux, deleted_at).
-- Idempotent : IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Colonnes ---------------------------------------------------------------

alter table public.jobs add column if not exists sale_date date;

-- Backfill : la journée de création (UTC, comme les périodes du leaderboard).
update public.jobs
   set sale_date = (created_at at time zone 'utc')::date
 where sale_date is null;

alter table public.jobs alter column sale_date set default current_date;

alter table public.jobs
  add column if not exists show_on_leaderboard boolean not null default true;

-- 2. Vue jobs_active ----------------------------------------------------------
-- `select j.*` capture la liste de colonnes à la création : il faut recréer la
-- vue pour exposer sale_date / show_on_leaderboard. DROP obligatoire (CREATE OR
-- REPLACE refuse l'insertion de colonnes avant derived_status). Même définition
-- que 20260714000000_jobs_derived_status.sql.

drop view if exists public.jobs_active;

create view public.jobs_active with (security_invoker = true) as
  select
    j.*,
    case
      when lower(coalesce(j.status, '')) = 'completed' and j.requires_invoicing
        then 'requires_invoicing'
      when lower(coalesce(j.status, '')) in ('completed', 'cancelled', 'canceled', 'archived')
        then 'archived'
      when exists (
        select 1 from public.schedule_events se
        where se.job_id = j.id
          and se.deleted_at is null
          and se.start_at >= now()
          and lower(coalesce(se.status, '')) <> 'cancelled'
      )
        then 'upcoming'
      when exists (
        select 1 from public.schedule_events se
        where se.job_id = j.id
          and se.deleted_at is null
          and se.start_at < now()
          and lower(coalesce(se.status, '')) not in ('completed', 'cancelled')
      )
        then 'late'
      else 'action_required'
    end as derived_status
  from public.jobs j
  where j.deleted_at is null;

grant select on public.jobs_active to anon, authenticated, service_role;

-- 3. Trigger leaderboard ------------------------------------------------------

-- L'ancien trigger ne doit plus exister (stage 'won' invalide, INSERT-only).
drop trigger if exists trg_auto_pipeline_deal_from_job on public.jobs;
drop function if exists public.auto_pipeline_deal_from_job();

create or replace function public.sync_job_leaderboard_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id uuid;
  v_value numeric;
  v_value_cents integer;
  v_won_at timestamptz;
begin
  -- Job supprimé, sans vendeur, ou retiré du leaderboard : on retire le deal
  -- créé par ce trigger (source = 'job'). Les deals d'un autre flux (d2d,
  -- manuel) ne sont jamais supprimés ici.
  if new.deleted_at is not null
     or new.salesperson_id is null
     or new.show_on_leaderboard is distinct from true then
    update pipeline_deals
       set deleted_at = now(), updated_at = now()
     where job_id = new.id
       and source = 'job'
       and deleted_at is null;
    return new;
  end if;

  v_value_cents := coalesce(
    new.total_cents,
    round(coalesce(new.total, new.total_amount, 0) * 100)::integer,
    0
  );
  v_value := v_value_cents / 100.0;

  -- La « journée » du leaderboard est calculée en heure serveur (UTC).
  -- sale_date = aujourd'hui → won_at = now() (comportement normal).
  -- sale_date antidatée → midi UTC de cette journée, pour tomber dans le bon
  -- créneau daily/weekly/monthly sans effet de bord de timezone.
  v_won_at := case
    when new.sale_date is null or new.sale_date = (now() at time zone 'utc')::date
      then now()
    else (new.sale_date::timestamp + interval '12 hours') at time zone 'utc'
  end;

  -- 3a. Deal déjà lié à ce job : resynchroniser (vendeur, date, montant).
  select id into v_deal_id
  from pipeline_deals
  where job_id = new.id
  order by created_at asc
  limit 1;

  if v_deal_id is not null then
    update pipeline_deals
       set rep_id = new.salesperson_id,
           stage = 'closed_won',
           won_at = v_won_at,
           value = case when source = 'job' then v_value else greatest(coalesce(value, 0), v_value) end,
           value_cents = case when source = 'job' then v_value_cents else greatest(coalesce(value_cents, 0), v_value_cents) end,
           title = coalesce(nullif(title, ''), new.title, 'Job'),
           -- Un deal 'job' masqué puis ré-affiché est restauré.
           deleted_at = case when source = 'job' then null else deleted_at end,
           updated_at = now()
     where id = v_deal_id;
    return new;
  end if;

  -- 3b. Deal existant du lead (pipeline D2D) : l'avancer à closed_won et le
  -- lier au job — pas de doublon sur le leaderboard.
  if new.lead_id is not null then
    select id into v_deal_id
    from pipeline_deals
    where org_id = new.org_id
      and lead_id = new.lead_id
      and deleted_at is null
    order by created_at asc
    limit 1;

    if v_deal_id is not null then
      update pipeline_deals
         set job_id = coalesce(job_id, new.id),
             rep_id = coalesce(rep_id, new.salesperson_id),
             stage = 'closed_won',
             won_at = v_won_at,
             value = greatest(coalesce(value, 0), v_value),
             value_cents = greatest(coalesce(value_cents, 0), v_value_cents),
             title = coalesce(nullif(title, ''), new.title, 'Job'),
             updated_at = now()
       where id = v_deal_id;
      return new;
    end if;
  end if;

  -- 3c. Aucun deal : en créer un. pipeline_deals exige un client ou un lead.
  if new.client_id is null and new.lead_id is null then
    return new;
  end if;

  insert into pipeline_deals (
    org_id, lead_id, client_id, job_id, rep_id,
    stage, title, value, value_cents, currency,
    source, created_by, won_at
  ) values (
    new.org_id, new.lead_id, new.client_id, new.id, new.salesperson_id,
    'closed_won', coalesce(new.title, 'Job'), v_value, v_value_cents,
    coalesce(new.currency, 'CAD'), 'job', new.salesperson_id, v_won_at
  );

  return new;
end;
$$;

drop trigger if exists trg_sync_job_leaderboard_deal_ins on public.jobs;
create trigger trg_sync_job_leaderboard_deal_ins
  after insert on public.jobs
  for each row
  execute function public.sync_job_leaderboard_deal();

-- salesperson_id / totaux arrivent par des UPDATE séparés après le RPC de
-- création : le trigger UPDATE est le vrai point d'entrée du flux.
drop trigger if exists trg_sync_job_leaderboard_deal_upd on public.jobs;
create trigger trg_sync_job_leaderboard_deal_upd
  after update of salesperson_id, sale_date, show_on_leaderboard,
                  total_cents, total_amount, total, deleted_at
  on public.jobs
  for each row
  execute function public.sync_job_leaderboard_deal();

-- 4. PostgREST ---------------------------------------------------------------
notify pgrst, 'reload schema';
