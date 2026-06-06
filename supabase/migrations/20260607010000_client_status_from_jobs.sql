-- ============================================================
-- MIGRATION: Statut client dérivé des jobs
-- Règle : un client avec ≥1 job (non supprimé) = 'active',
--         sinon = 'lead'.
-- Implémenté via trigger sur public.jobs pour couvrir TOUS les
-- chemins de création/suppression (RPC, conversion de devis, etc.).
-- ============================================================

begin;

-- ─── Recalcul du statut d'un client à partir de ses jobs ─────────
create or replace function public.sync_client_status_from_jobs(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text;
begin
  if p_client_id is null then
    return;
  end if;

  if exists (
    select 1 from public.jobs
    where client_id = p_client_id
      and deleted_at is null
  ) then
    v_target := 'active';
  else
    v_target := 'lead';
  end if;

  update public.clients
     set status = v_target
   where id = p_client_id
     and status is distinct from v_target;
end;
$$;

-- ─── Trigger sur jobs : INSERT / UPDATE / DELETE ─────────────────
create or replace function public.jobs_sync_client_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sync_client_status_from_jobs(new.client_id);
  elsif tg_op = 'DELETE' then
    perform public.sync_client_status_from_jobs(old.client_id);
  else -- UPDATE : couvre soft-delete/restore et réassignation de client
    perform public.sync_client_status_from_jobs(new.client_id);
    if old.client_id is distinct from new.client_id then
      perform public.sync_client_status_from_jobs(old.client_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_jobs_sync_client_status on public.jobs;
create trigger trg_jobs_sync_client_status
  after insert or update or delete on public.jobs
  for each row execute function public.jobs_sync_client_status();

-- ─── Nouveau client sans job => 'lead' par défaut ────────────────
alter table public.clients alter column status set default 'lead';

-- ─── Backfill des clients existants ──────────────────────────────
update public.clients c
   set status = 'active'
 where c.deleted_at is null
   and c.status is distinct from 'active'
   and exists (select 1 from public.jobs j where j.client_id = c.id and j.deleted_at is null);

update public.clients c
   set status = 'lead'
 where c.deleted_at is null
   and c.status is distinct from 'lead'
   and not exists (select 1 from public.jobs j where j.client_id = c.id and j.deleted_at is null);

commit;
