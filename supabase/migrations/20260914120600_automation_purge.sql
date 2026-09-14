-- Audit automatisations 2026-09-13, F21 — migration M6.
-- Purge des journaux techniques du moteur : appelée par le cron serveur
-- (POST /api/cron/purge-automations), pas par pg_cron.
-- R7 : ce sont des journaux techniques, pas des données métier ; la
-- suppression physique est acceptable ici parce que la rétention est la
-- finalité même.
create or replace function public.purge_automation_history(p_months integer default 12)
returns table (logs_supprimes bigint, taches_supprimees bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare l bigint; t bigint;
begin
  if p_months is null or p_months < 1 then
    raise exception 'p_months doit être >= 1';
  end if;
  delete from public.automation_execution_logs
   where created_at < now() - make_interval(months => p_months);
  get diagnostics l = row_count;
  delete from public.automation_scheduled_tasks
   where status in ('completed', 'cancelled', 'failed')
     and coalesce(completed_at, created_at) < now() - make_interval(months => p_months);
  get diagnostics t = row_count;
  return query select l, t;
end;
$$;
revoke all on function public.purge_automation_history(integer) from public, anon, authenticated;
grant execute on function public.purge_automation_history(integer) to service_role;
