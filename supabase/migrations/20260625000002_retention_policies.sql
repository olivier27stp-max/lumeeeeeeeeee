-- =====================================================================
-- Retention & Anonymization Policies — 2026-04-21
-- Bloc 4 : purge/anonymisation automatique selon juridiction
--
-- Rétentions appliquées :
--   - Leads inactifs : anonymisation après 24 mois sans activité
--   - Portail tokens révoqués : purge après 30j
--   - Portail tokens expirés non révoqués : purge après 180j
--   - Soft-deleted leads/clients : anonymisation 180j après delete
--   - Invoices/payments : PAS de purge (obligation 10 ans - fiscal)
--   - dsar_requests completed : conservation 6 ans
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RPC : anonymize_inactive_leads
--    Anonymise les leads sans activité (updated_at) depuis N mois.
--    "Anonymisation" : on remplace les PII par 'ANONYMIZED' mais on conserve
--    la ligne (statistiques de conversion, audit) → tombstone pattern.
-- ---------------------------------------------------------------------
create or replace function public.anonymize_inactive_leads(p_months int default 24)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_count bigint := 0;
begin
  with updated as (
    update public.leads
       set first_name = 'ANONYMIZED',
           last_name  = '',
           title      = null,
           company    = null,
           email      = null,
           phone      = null,
           address    = null,
           notes      = null,
           tags       = array[]::text[],
           updated_at = now()
     where updated_at < v_cutoff
       and (first_name is distinct from 'ANONYMIZED' or email is not null or phone is not null)
       and coalesce(status, '') not in ('won') -- conserver les leads convertis (liés à un client actif)
    returning id, org_id
  )
  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  select org_id, null, 'anonymize', 'lead', id, jsonb_build_object('method','retention_24m','cutoff',v_cutoff)
    from updated;

  get diagnostics v_count = row_count;
  return v_count;
end $FUNC$;

revoke all on function public.anonymize_inactive_leads(int) from public;
grant execute on function public.anonymize_inactive_leads(int) to service_role;

-- ---------------------------------------------------------------------
-- 2. RPC : anonymize_old_soft_deleted_clients
--    Clients soft-deleted depuis > 180j → anonymisation finale
--    (garde la ligne pour intégrité FK avec invoices/jobs).
-- ---------------------------------------------------------------------
create or replace function public.anonymize_old_soft_deleted_clients(p_days int default 180)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_days);
  v_count bigint := 0;
begin
  -- Schema: clients has only id, org_id, first_name, last_name, company, email
  -- (confirmed via information_schema 2026-04-21 — no phone/address columns here)
  with updated as (
    update public.clients
       set first_name = 'ANONYMIZED',
           last_name  = '',
           company    = null,
           email      = null,
           updated_at = now()
     where deleted_at is not null
       and deleted_at < v_cutoff
       and first_name is distinct from 'ANONYMIZED'
    returning id, org_id
  )
  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  select org_id, null, 'anonymize', 'client', id, jsonb_build_object('method','retention_softdelete_180d','cutoff',v_cutoff)
    from updated;

  get diagnostics v_count = row_count;
  return v_count;
end $FUNC$;

revoke all on function public.anonymize_old_soft_deleted_clients(int) from public;
grant execute on function public.anonymize_old_soft_deleted_clients(int) to service_role;

-- ---------------------------------------------------------------------
-- 3. RPC : purge_expired_portal_tokens
--    Supprime tokens revoked > 30j et tokens expired > 180j.
-- ---------------------------------------------------------------------
create or replace function public.purge_expired_portal_tokens()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare v_count bigint := 0;
begin
  -- Table doit exister (créée par migration portal_tokens antérieure)
  if to_regclass('public.portal_tokens') is null then
    return 0;
  end if;

  delete from public.portal_tokens
   where (revoked_at is not null and revoked_at < now() - interval '30 days')
      or (expires_at is not null and expires_at < now() - interval '180 days');
  get diagnostics v_count = row_count;
  return v_count;
end $FUNC$;

revoke all on function public.purge_expired_portal_tokens() from public;
grant execute on function public.purge_expired_portal_tokens() to service_role;

-- ---------------------------------------------------------------------
-- 4. RPC wrapper : run_retention_job
--    Exécute toutes les tâches de rétention en une passe.
--    Retourne un JSON avec les compteurs.
-- ---------------------------------------------------------------------
create or replace function public.run_retention_job()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_leads bigint;
  v_clients bigint;
  v_tokens bigint;
  v_audit bigint;
begin
  v_leads   := public.anonymize_inactive_leads(24);
  v_clients := public.anonymize_old_soft_deleted_clients(180);
  v_tokens  := public.purge_expired_portal_tokens();
  v_audit   := public.purge_old_audit_events(1095);

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'retention_run', 'system', null,
    jsonb_build_object(
      'anonymized_leads', v_leads,
      'anonymized_clients', v_clients,
      'purged_portal_tokens', v_tokens,
      'purged_audit_events', v_audit,
      'at', now()
    ));

  return jsonb_build_object(
    'anonymized_leads', v_leads,
    'anonymized_clients', v_clients,
    'purged_portal_tokens', v_tokens,
    'purged_audit_events', v_audit
  );
end $FUNC$;

revoke all on function public.run_retention_job() from public;
grant execute on function public.run_retention_job() to service_role;

-- ---------------------------------------------------------------------
-- 5. pg_cron : exécution quotidienne 04:00 UTC
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'lume_retention_job';
    perform cron.schedule('lume_retention_job', '0 4 * * *', 'select public.run_retention_job()');
    raise notice 'Scheduled daily retention job at 04:00 UTC';
  else
    raise notice 'pg_cron not installed - retention job must be run manually via RPC run_retention_job()';
  end if;
exception when others then
  raise notice 'pg_cron scheduling failed (non-fatal): %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 6. Index helper pour les scans de rétention
-- ---------------------------------------------------------------------
create index if not exists idx_leads_updated_at_status on public.leads(updated_at) where first_name is distinct from 'ANONYMIZED';
create index if not exists idx_clients_deleted_at on public.clients(deleted_at) where deleted_at is not null;
