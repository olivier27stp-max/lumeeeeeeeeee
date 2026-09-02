-- ============================================================================
-- Réalignement staging → prod : FORCE RLS + commentaire deny-all de cron_locks
-- ============================================================================
-- Constat (2026-09-01, via npm run check:invariants) :
--   PROD    : check_rls_coverage → 0 défaillance
--   STAGING : check_rls_coverage → 4 défaillances
--     job_materials, job_time_logs, cron_locks, client_payment_profiles
--
-- Nature exacte de l'écart, vérifiée table par table sur les deux bases :
--   • les 4 tables ont RLS ACTIVÉE et leurs policies des deux côtés
--     (aucune fuite de données : 1, 3 et 1 policies respectivement) ;
--   • mais staging ne les a pas FORCÉES — le propriétaire de la table
--     contourne alors ses propres policies ;
--   • et cron_locks (0 policy, deny-all assumé) n'a pas reçu en staging le
--     commentaire qui déclare ce choix à check_rls_coverage().
--
-- C'est de la dérive : ces deux migrations ont été appliquées en prod et
-- jamais rejouées en staging.
--     20260751100000_force_rls_all_tables.sql
--     20260754000000_cron_locks_lease.sql (commentaire)
--
-- SÉCURITÉ : service_role et postgres ont rolbypassrls = true. BYPASSRLS est
-- évalué AVANT force_row_level_security, donc getServiceClient() n'est pas
-- affecté. Aucun impact applicatif — même raisonnement que la migration
-- d'origine, dont ce fichier ne fait que rejouer l'effet.
--
-- Idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

-- 1. Forcer RLS partout où elle est activée mais pas forcée.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.oid::regclass::text as tbl
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       and not c.relforcerowsecurity
     order by 1
  loop
    execute format('alter table %s force row level security', r.tbl);
    n := n + 1;
  end loop;
  raise notice 'FORCE RLS appliquée sur % table(s).', n;
end $$;

-- 2. Rétablir le commentaire de cron_locks, à l'identique de la production.
--    Sans lui, check_rls_coverage() signale à tort une table sans policy.
do $$
begin
  if to_regclass('public.cron_locks') is not null then
    execute 'comment on table public.cron_locks is ' || quote_literal(
      'Bail de verrous de crons (voir 20260754000000_cron_locks_lease.sql). ' ||
      'RLS forcée SANS policy = deny-all volontaire : accès uniquement via ' ||
      'try_advisory_lock / release_advisory_lock (SECURITY DEFINER). ' ||
      'Ne PAS ajouter de policy pour satisfaire check_rls_coverage().');
  end if;
end $$;

-- 3. Vérification : la sonde doit être muette après cette migration.
do $$
declare
  restant int;
begin
  select count(*) into restant from public.check_rls_coverage();
  if restant > 0 then
    raise exception 'check_rls_coverage() signale encore % table(s) après réalignement.', restant;
  end if;
  raise notice 'check_rls_coverage() : 0 défaillance. Staging aligné sur la prod.';
end $$;
