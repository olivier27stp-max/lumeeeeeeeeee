-- ═══════════════════════════════════════════════════════════════
-- Rétention des données de géolocalisation — Loi 25
--
-- Appliqué en production; consigné ici pour survivre à un `db reset`.
-- Idempotent.
--
-- CONSTAT : 1842 points GPS d'employés s'accumulaient depuis mars sans
-- aucune purge. `run_retention_job()` couvre déjà les prospects, clients,
-- jetons de portail et journaux d'audit — mais pas la localisation.
--
-- La position d'un travailleur est un renseignement personnel sensible.
-- La Loi 25 impose de ne pas conserver un RP au-delà de la finalité qui a
-- justifié sa collecte. Ici la finalité est opérationnelle — suivre une
-- tournée en cours, prouver une présence sur un chantier — et elle
-- s'épuise en quelques mois, pas indéfiniment. Conserver la trace des
-- déplacements d'un employé pendant des années serait difficile à
-- défendre devant la CAI, et constitue un passif en cas de fuite.
--
-- SEUILS
--   180 jours pour les traces de déplacement : assez pour un litige sur
--     une intervention (facturation contestée, preuve de présence), bien
--     en deçà d'une surveillance permanente. Plancher à 30 jours dans la
--     fonction pour qu'un appel malencontreux ne vide pas la table.
--   3 ans pour proof_of_presence : valeur probatoire (preuve de passage
--     sur un chantier), alignée sur la prescription civile courante.
--
-- NON TOUCHÉES : les données agrégées (fs_rep_stat_snapshots,
-- field_daily_stats) ne permettent pas de reconstituer un trajet et
-- restent nécessaires aux rapports de performance.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.purge_old_location_data(p_days integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_days, 30));
  v_tracking bigint := 0;
  v_fs bigint := 0;
  v_tech bigint := 0;
  v_pop bigint := 0;
begin
  delete from public.tracking_points where recorded_at < v_cutoff;
  get diagnostics v_tracking = row_count;

  delete from public.fs_gps_points where recorded_at < v_cutoff;
  get diagnostics v_fs = row_count;

  delete from public.technician_locations where recorded_at < v_cutoff;
  get diagnostics v_tech = row_count;

  -- NOTE : la colonne est `recorded_at`, pas `created_at` — la première
  -- version de cette fonction échouait là-dessus, et comme elle n'avait
  -- jamais tourné avant d'être planifiée, l'erreur ne serait apparue que
  -- dans les logs du cron, en silence.
  delete from public.proof_of_presence
  where recorded_at < now() - interval '3 years';
  get diagnostics v_pop = row_count;

  return jsonb_build_object(
    'tracking_points', v_tracking,
    'fs_gps_points', v_fs,
    'technician_locations', v_tech,
    'proof_of_presence', v_pop,
    'cutoff', v_cutoff
  );
end $$;

revoke execute on function public.purge_old_location_data(integer)
  from public, anon, authenticated;

comment on function public.purge_old_location_data(integer) is
  'Purge les traces de geolocalisation au-dela de p_days (defaut 180). Loi 25 : un RP ne se conserve pas au-dela de sa finalite.';

-- Exécution nocturne, dans la même fenêtre de maintenance que le job de
-- rétention existant (04h00) : un seul créneau à surveiller.
select cron.unschedule('lume_purge_location_data')
where exists (select 1 from cron.job where jobname = 'lume_purge_location_data');

select cron.schedule(
  'lume_purge_location_data',
  '30 4 * * *',
  $$select public.purge_old_location_data(180)$$
);
