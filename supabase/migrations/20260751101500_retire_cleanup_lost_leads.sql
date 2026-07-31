-- ============================================================================
-- Cron cassé : cleanup_lost_leads_10d échoue 7 jours sur 7
-- ============================================================================
-- CONSTAT (cron.job_run_details, 7 derniers jours) :
--   cleanup_lost_leads_10d_daily : 7 exécutions, 7 ÉCHECS.
--   ERROR: relation "public.leads" does not exist
--
-- CAUSE : la table `leads` a été fusionnée dans `clients` (status = 'lead').
-- La fonction n'a jamais été mise à jour et référence une table disparue.
-- Elle échoue donc en silence chaque nuit à 3 h depuis la fusion.
--
-- POURQUOI ON NE LA « RÉPARE » PAS
-- Sa logique n'est pas transposable : elle filtrait sur `stage`, `lost_at` et
-- `converted_job_id`, trois colonnes qui n'existent PAS sur `clients`
-- (vérifié : clients n'a que status, deleted_at, updated_at parmi celles-là).
-- Le concept « opportunité perdue » vit désormais dans `pipeline_deals`, et
-- cleanup_lost_pipeline_deals() — qui tourne avec 0 échec sur la même
-- planification — couvre déjà exactement ce besoin.
--
-- La réécrire reviendrait à inventer une règle métier qui n'existe plus.
-- On retire donc le job et la fonction morte.
--
-- VÉRIFICATIONS PRÉALABLES :
--   - aucune autre fonction SQL n'appelle cleanup_lost_leads_10d (0)
--   - aucun code applicatif ne l'appelle (grep sur .ts/.tsx/.mjs : 0)
--   - seul le cron l'invoquait (1 entrée, supprimée ici)
-- ============================================================================

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
    from cron.job
   where command ilike '%cleanup_lost_leads_10d%';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
    raise notice 'Cron cleanup_lost_leads_10d_daily (jobid %) desactive.', v_jobid;
  else
    raise notice 'Cron cleanup_lost_leads_10d_daily deja absent.';
  end if;
end $$;

drop function if exists public.cleanup_lost_leads_10d();

comment on function public.cleanup_lost_pipeline_deals() is
  'Passe en soft-delete les opportunites perdues depuis plus de 15 jours. '
  'Remplace cleanup_lost_leads_10d(), supprimee : elle visait la table `leads` '
  'fusionnee dans `clients`, et ses colonnes de filtrage (stage, lost_at, '
  'converted_job_id) n''existent pas sur clients.';

-- ----------------------------------------------------------------------------
-- N7.10 — Sonde : un cron qui echoue en silence est un cron qui n'existe pas.
-- Aucune alerte ne couvrait ce cas ; c'est pour cela que l'echec a dure.
-- ----------------------------------------------------------------------------
create or replace function public.check_failing_cron_jobs()
returns table (jobname text, failures_7d bigint, last_error text)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select j.jobname::text,
         count(*) filter (where r.status = 'failed'),
         (array_agg(r.return_message order by r.end_time desc)
            filter (where r.status = 'failed'))[1]
    from cron.job j
    join cron.job_run_details r on r.jobid = j.jobid
   where r.start_time > now() - interval '7 days'
   group by j.jobname
  having count(*) filter (where r.status = 'failed') > 0;
$$;

revoke all on function public.check_failing_cron_jobs() from public, anon, authenticated;

comment on function public.check_failing_cron_jobs() is
  'N7.10 — Doit retourner 0 ligne. Tout cron en echec depuis 7 jours. '
  'A brancher sur check_all_invariants / alerte nocturne.';
