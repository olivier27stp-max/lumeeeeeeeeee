-- ============================================================================
-- Jetons OAuth expirés jamais purgés
-- ============================================================================
-- CONSTAT
-- public.cleanup_expired_oauth_states() existe mais :
--   1. elle ne purge QUE integration_oauth_states et oublie email_oauth_states ;
--   2. elle n'est planifiée NULLE PART (0 entrée dans cron.job) et aucune autre
--      fonction ne l'appelle. C'est du code mort depuis sa création.
--
-- ÉTAT RÉEL MESURÉ :
--   email_oauth_states       : 9 lignes, 9 expirées, 3 non consommées,
--                              la plus ancienne date de 16 jours
--   integration_oauth_states : 1 ligne expirée non consommée
--
-- POURQUOI ÇA COMPTE
-- Un state OAuth est un secret à usage unique dont la fenêtre de validité se
-- compte en minutes. Le conserver après expiration n'apporte rien et élargit
-- la surface en cas de fuite de la table. `email_oauth_states` porte en plus
-- une colonne `code_verifier` (secret PKCE) — vide aujourd'hui, mais la
-- colonne existe et sera remplie dès que PKCE sera activé.
--
-- CORRECTIF : purger les DEUX tables, et planifier réellement le job.
-- On supprime les jetons expirés, consommés ou non : un state consommé n'a
-- plus aucune utilité, et un state expiré non consommé encore moins.
-- ============================================================================

-- La version precedente retournait `void` ; Postgres refuse un CREATE OR REPLACE
-- qui change le type de retour. Aucun appelant n'existe (verifie : 0 cron,
-- 0 fonction appelante, 0 occurrence dans le code), le DROP est donc sans risque.
drop function if exists public.cleanup_expired_oauth_states();

create function public.cleanup_expired_oauth_states()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration bigint := 0;
  v_email       bigint := 0;
begin
  delete from public.integration_oauth_states
   where expires_at < now();
  get diagnostics v_integration = row_count;

  -- Etait ABSENTE de la version precedente : c'est la table qui accumulait
  -- le plus de jetons perimes (9 lignes, jusqu'a 16 jours d'anciennete).
  delete from public.email_oauth_states
   where expires_at < now();
  get diagnostics v_email = row_count;

  return jsonb_build_object(
    'integration_oauth_states', v_integration,
    'email_oauth_states',       v_email,
    'purged_at',                now()
  );
end $$;

revoke all on function public.cleanup_expired_oauth_states() from public, anon, authenticated;

comment on function public.cleanup_expired_oauth_states() is
  'Purge les states OAuth expires des DEUX tables (integration + email). '
  'Planifiee toutes les heures : un state OAuth a une duree de vie de quelques '
  'minutes, le conserver au-dela n''a aucune utilite.';

-- ----------------------------------------------------------------------------
-- Planification horaire. La fonction existait depuis sa creation sans jamais
-- etre appelee : c'est l'absence de cron qui la rendait inutile.
-- ----------------------------------------------------------------------------
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'lume_purge_oauth_states';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'lume_purge_oauth_states',
    '25 * * * *',
    $cron$select public.cleanup_expired_oauth_states()$cron$
  );
  raise notice 'Cron lume_purge_oauth_states planifie (toutes les heures).';
end $$;

-- ----------------------------------------------------------------------------
-- Purge immediate du retard accumule.
-- ----------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
begin
  v_res := public.cleanup_expired_oauth_states();
  raise notice 'Purge initiale : %', v_res;
end $$;
