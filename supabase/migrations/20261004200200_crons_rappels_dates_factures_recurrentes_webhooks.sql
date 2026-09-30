-- Trois tâches quotidiennes qui n'avaient AUCUN déclencheur.
--
-- POURQUOI (audit V2, C29/C30)
-- /api/cron/rappels-dates (« Date atteinte » : fin de contrat, entretien
-- annuel), /api/cron/recurring-invoices (factures récurrentes) et
-- /api/cron/webhook-retries (reprise des webhooks sortants) existent, mais
-- rien ne les appelle : ni pg_cron, ni le dépôt, ni un setInterval. Latent en
-- prod au 2026-09-30 (0 facture récurrente planifiée, 0 règle « date
-- atteinte ») — la première entreprise qui s'en servirait n'aurait rien.
--
-- CE QUI CHANGE
-- Une fonction unique (liste BLANCHE de chemins) sur le modèle de
-- trigger_payment_reminders : même secret, même URL déclarée
-- (app_base_url — sans elle, erreur visible, jamais la prod par défaut ;
-- voir 20261003100200). Les routes tiennent un verrou : un double appel
-- (si un autre planificateur existait) ne produit rien de plus.
--   · rappels-dates       : 8 h 15 Montréal (12:15 UTC), chaque jour
--   · recurring-invoices  : 7 h 45 Montréal (11:45 UTC), chaque jour
--   · webhook-retries     : toutes les 10 minutes
--
-- DOWN :
--   select cron.unschedule('lume_rappels_dates');
--   select cron.unschedule('lume_recurring_invoices');
--   select cron.unschedule('lume_webhook_retries');
--   drop function if exists public.trigger_cron_api(text);

create or replace function public.trigger_cron_api(p_chemin text)
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_secret text;
  v_base   text;
begin
  -- Liste blanche : jamais un chemin arbitraire avec le secret de cron.
  if p_chemin not in ('/api/cron/rappels-dates', '/api/cron/recurring-invoices', '/api/cron/webhook-retries') then
    raise exception 'Chemin de cron non autorisé : %', p_chemin;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    raise exception 'Secret Vault "cron_secret" absent — % non declenche', p_chemin;
  end if;

  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'app_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception 'Secret Vault "app_base_url" absent — % non declenche (prod : https://lumecrm.net)', p_chemin;
  end if;

  perform net.http_post(
    url     := v_base || p_chemin,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret,
      'x-requested-with', 'XMLHttpRequest'
    ),
    body    := '{}'::jsonb
  );
end;
$function$;

revoke all on function public.trigger_cron_api(text) from public;
revoke all on function public.trigger_cron_api(text) from anon;
revoke all on function public.trigger_cron_api(text) from authenticated;

comment on function public.trigger_cron_api(text) is
  'Declenche une route /api/cron/* de la liste blanche (pg_cron). Meme secret et meme URL declaree que trigger_payment_reminders.';

-- Rejouer la migration ne crée pas de doublon de job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lume_rappels_dates') then perform cron.unschedule('lume_rappels_dates'); end if;
  if exists (select 1 from cron.job where jobname = 'lume_recurring_invoices') then perform cron.unschedule('lume_recurring_invoices'); end if;
  if exists (select 1 from cron.job where jobname = 'lume_webhook_retries') then perform cron.unschedule('lume_webhook_retries'); end if;
end;
$$;

select cron.schedule('lume_rappels_dates', '15 12 * * *', $$select public.trigger_cron_api('/api/cron/rappels-dates')$$);
select cron.schedule('lume_recurring_invoices', '45 11 * * *', $$select public.trigger_cron_api('/api/cron/recurring-invoices')$$);
select cron.schedule('lume_webhook_retries', '*/10 * * * *', $$select public.trigger_cron_api('/api/cron/webhook-retries')$$);
