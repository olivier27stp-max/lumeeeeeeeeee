-- Les crons pg_cron n'appellent plus la prod par défaut.
--
-- POURQUOI
-- trigger_payment_reminders et trigger_sms_number_release lisaient l'URL de
-- l'API dans le secret Vault `app_base_url`, avec un REPLI codé en dur sur
-- https://lumecrm.net. Staging n'a pas ce secret (seul `cron_secret` y est) :
-- chaque jour, le pg_cron de STAGING postait vers la PROD, qui l'acceptait —
-- les deux projets partagent le même `cron_secret` depuis le clonage.
-- Constaté le 2026-09-29 : net._http_response de staging, id 52 = 200
-- {"ok":true,"released":0,...} renvoyé par lumecrm.net (audit automatisations
-- V2, C31). Pas d'envoi en double (les relances sont idempotentes :
-- reminder_log UNIQUE + verrou), mais un environnement de test ne doit jamais
-- déclencher la prod.
--
-- CE QUI CHANGE
-- Sans `app_base_url`, la fonction lève une erreur visible dans
-- cron.job_run_details au lieu d'appeler lumecrm.net. Chaque environnement
-- dit explicitement où il appelle.
--
-- ⚠️ PROD — AVANT d'appliquer cette migration, poser le secret (sinon les
-- relances de factures et la libération des numéros s'arrêtent) :
--   select vault.create_secret('https://lumecrm.net', 'app_base_url');
-- Vérifier : select name from vault.secrets where name = 'app_base_url';
-- Staging : NE PAS le poser (aucun serveur n'y écoute ; l'erreur quotidienne
-- dans cron.job_run_details est le comportement voulu).
--
-- DOWN (remet le repli d'origine) : recréer les deux fonctions avec
--   select coalesce((select decrypted_secret from vault.decrypted_secrets
--     where name = 'app_base_url'), 'https://lumecrm.net') into v_base;
-- à la place du bloc « v_base is null » — corps d'origine dans
-- 20260925180000_cron_relances_factures.sql et
-- 20260750000000_schedule_sms_number_release.sql.

create or replace function public.trigger_payment_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_secret text;
  v_base   text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  -- Sans secret, la route repondrait 401 en silence toutes les nuits. Mieux
  -- vaut une erreur visible dans cron.job_run_details.
  if v_secret is null then
    raise exception 'Secret Vault "cron_secret" absent — relances non declenchees';
  end if;

  -- Pas de repli : sans URL declaree, on n'appelle personne (et surtout pas
  -- la prod depuis staging).
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'app_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception 'Secret Vault "app_base_url" absent — relances non declenchees (prod : https://lumecrm.net)';
  end if;

  perform net.http_post(
    url     := v_base || '/api/cron/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret,
      'x-requested-with', 'XMLHttpRequest'
    ),
    body    := '{}'::jsonb
  );
end;
$function$;

revoke all on function public.trigger_payment_reminders() from public;
revoke all on function public.trigger_payment_reminders() from anon;
revoke all on function public.trigger_payment_reminders() from authenticated;

create or replace function public.trigger_sms_number_release()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_secret text;
  v_base   text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  if v_secret is null then
    raise exception 'Secret Vault "cron_secret" absent — liberation SMS non declenchee';
  end if;

  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'app_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception 'Secret Vault "app_base_url" absent — liberation SMS non declenchee (prod : https://lumecrm.net)';
  end if;

  perform net.http_post(
    url     := v_base || '/api/cron/release-sms-numbers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret,
      'x-requested-with', 'XMLHttpRequest'
    ),
    body    := '{}'::jsonb
  );
end;
$function$;

revoke all on function public.trigger_sms_number_release() from public;
revoke all on function public.trigger_sms_number_release() from anon;
revoke all on function public.trigger_sms_number_release() from authenticated;
