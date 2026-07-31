-- ============================================================================
-- N7.10 — Brancher les nouvelles sondes sur check_all_invariants()
-- ============================================================================
-- Deux defauts trouves lors de l'exploration post-audit sont restes invisibles
-- longtemps parce qu'AUCUNE sonde ne les couvrait :
--
--   1. cleanup_lost_leads_10d echouait 7 nuits sur 7 (table `leads` disparue).
--      Un cron qui echoue en silence est un cron qui n'existe pas.
--   2. 32 fonctions trigger etaient executables par `authenticated`, dont une
--      creee par cet audit meme (Postgres accorde EXECUTE a PUBLIC par defaut).
--
-- Les sondes correspondantes existent desormais mais n'etaient pas agregees.
-- On les ajoute a la sonde unique appelee par le cron de surveillance.
-- ============================================================================

create or replace function public.check_all_invariants()
returns table (check_name text, failures bigint, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  check_name := 'cross_tenant_references';
  select count(*), coalesce(string_agg(relation || '=' || violations, ', '), '')
    into failures, detail from public.check_cross_tenant_references();
  return next;

  check_name := 'invoice_totals_balance';
  select count(*), coalesce(string_agg(invoice_number, ', '), '')
    into failures, detail from public.check_invoice_totals_balance();
  return next;

  check_name := 'rls_coverage';
  select count(*), coalesce(string_agg(table_name, ', '), '')
    into failures, detail from public.check_rls_coverage();
  return next;

  check_name := 'invoice_numbering';
  select count(*), coalesce(string_agg(invoice_number, ', '), '')
    into failures, detail from public.check_invoice_numbering_invariant();
  return next;

  check_name := 'custom_field_orphans';
  select count(*), coalesce(string_agg(record_id::text, ', '), '')
    into failures, detail from public.check_custom_field_orphans();
  return next;

  -- NOUVEAU — un cron en echec ne se voit nulle part ailleurs.
  check_name := 'failing_cron_jobs';
  select count(*), coalesce(string_agg(jobname, ', '), '')
    into failures, detail from public.check_failing_cron_jobs();
  return next;

  -- NOUVEAU — regression du moindre privilege sur les fonctions trigger.
  check_name := 'exposed_trigger_functions';
  select count(*), coalesce(string_agg(function_name, ', '), '')
    into failures, detail from public.check_exposed_trigger_functions();
  return next;
end $$;

revoke all on function public.check_all_invariants() from public, anon, authenticated;

comment on function public.check_all_invariants() is
  'N7.10 — Sonde unique pour le cron. Toute ligne avec failures > 0 doit '
  'alerter. Couvre : isolation multi-tenant, coherence des totaux, couverture '
  'RLS, numerotation des factures, orphelins de champs personnalises, crons en '
  'echec, et fonctions trigger exposees aux roles clients.';
