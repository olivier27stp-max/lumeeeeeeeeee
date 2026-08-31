-- Éteint le db_invariant_failure quotidien (sonde rls_coverage, N3.4).
--
-- La sonde exige : RLS activée + FORCÉE + au moins une policy (ou un deny-all
-- déclaré dans le commentaire de la table). Quatre tables dérivaient :
--
--   job_time_logs, job_materials, client_payment_profiles
--     RLS activée avec policies, mais non forcée. Le FORCE ne change rien au
--     comportement : service_role et postgres ont rolbypassrls (preuve en
--     prod : run_invariant_checks() tourne en postgres via pg_cron et insère
--     chaque nuit dans security_events, RLS forcée dont la policy d'INSERT
--     exige service_role). Il ferme seulement la porte « owner sans bypass ».
--
--   cron_locks
--     RLS activée SANS policy — deny-all voulu : la table n'est touchée que
--     par try_advisory_lock / release_advisory_lock (SECURITY DEFINER, owner
--     postgres → bypassrls). Même situation assumée que security_canary_runs :
--     on force et on documente le deny-all dans le commentaire, que la sonde
--     reconnaît (« deny-all volontaire »).

alter table public.job_time_logs force row level security;
alter table public.job_materials force row level security;
alter table public.client_payment_profiles force row level security;

alter table public.cron_locks force row level security;

comment on table public.cron_locks is
  'Bail de verrous de crons (voir 20260754000000_cron_locks_lease.sql). RLS '
  'forcée SANS policy = deny-all volontaire : accès uniquement via '
  'try_advisory_lock / release_advisory_lock (SECURITY DEFINER). Ne PAS '
  'ajouter de policy pour satisfaire check_rls_coverage().';
