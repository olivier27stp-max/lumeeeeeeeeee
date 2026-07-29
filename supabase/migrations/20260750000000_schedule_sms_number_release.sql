-- Planifie l'appel quotidien a /api/cron/release-sms-numbers.
--
-- Pourquoi pg_cron plutot que GitHub Actions : le depot n'a aucun secret
-- Actions configure, et pousser un fichier .github/workflows/ demande le scope
-- `workflow` que l'outillage n'a pas. pg_cron + pg_net sont deja installes et
-- utilises par le projet, donc c'est le chemin qui fonctionne reellement.
--
-- Le secret n'est PAS ecrit en clair dans la definition du job : il est lu
-- depuis Vault a chaque execution. Tant que le secret 'cron_secret' n'existe
-- pas dans Vault, la fonction leve une exception et ne fait aucun appel.
--
-- LE JOB EST CREE INACTIF. Pour l'activer, une fois le secret depose :
--   select vault.create_secret('<valeur CRON_SECRET de Railway>', 'cron_secret');
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'lume_release_sms_numbers'),
--     active := true
--   );

create or replace function public.trigger_sms_number_release()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_secret text;
  v_base   text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  if v_secret is null then
    raise exception 'Secret Vault "cron_secret" absent — liberation SMS non declenchee';
  end if;

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url'),
    'https://lumecrm.net'
  ) into v_base;

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
$$;

revoke all on function public.trigger_sms_number_release() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('lume_release_sms_numbers');
exception when others then null;
end $$;

-- 08:10 UTC (~04:10 heure de l'Est), hors heures de pointe.
select cron.schedule(
  'lume_release_sms_numbers',
  '10 8 * * *',
  $cmd$ select public.trigger_sms_number_release() $cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'lume_release_sms_numbers'),
  active := false
);
