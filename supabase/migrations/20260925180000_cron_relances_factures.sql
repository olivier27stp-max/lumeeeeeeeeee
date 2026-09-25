-- Relances de factures : brancher le cron qui n'a jamais tourne.
--
-- POURQUOI CETTE MIGRATION
-- La route POST /api/cron/payment-reminders existe depuis le 2026-05-12, mais
-- RIEN ne l'appelait : absente de cron.job, absente de vercel.json, aucun
-- appelant dans le code. Verifie le 2026-09-25 sur la prod : reminder_log
-- contenait 0 ligne. Les relances de factures etaient vendues dans Scale et
-- Autopilot, et n'etaient jamais parties.
--
-- POURQUOI C'EST SUR MAINTENANT
-- Le correctif #612 a pose une borne basse (90 jours) sur la selection. Sans
-- elle, le premier declenchement aurait envoye 16 messages d'un coup : les 4
-- factures en retard de 138 a 173 jours x les 4 paliers du calendrier
-- (J+1, J+7, J+14, J+30), chacune matchant tous les paliers.
--
-- L'HEURE
-- 9 h 00, heure de Montreal (13 h 00 UTC en heure avancee). Un rappel de
-- paiement se lit le matin ; l'envoyer la nuit le fait arriver en bas de pile.
-- pg_cron raisonne en UTC : 13 h UTC = 9 h l'ete, 8 h l'hiver. On accepte ce
-- decalage d'une heure plutot que de dedoubler le job.
--
-- IDEMPOTENCE
-- La route porte deja son propre verrou (withAdvisoryLock) et refuse
-- d'envoyer deux fois le meme palier pour la meme facture (contrainte UNIQUE
-- sur reminder_log). Un double declenchement ne peut donc pas doubler un
-- rappel.

-- Fonction de declenchement : meme forme que trigger_sms_number_release, meme
-- secret Vault, meme repli d'URL.
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

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url'),
    'https://lumecrm.net'
  ) into v_base;

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

-- Moindre privilege : les defauts Supabase accordent EXECUTE a anon et
-- authenticated sur toute nouvelle fonction. Une fonction SECURITY DEFINER
-- qui porte le secret de cron ne doit etre appelable que par le planificateur.
revoke all on function public.trigger_payment_reminders() from public;
revoke all on function public.trigger_payment_reminders() from anon;
revoke all on function public.trigger_payment_reminders() from authenticated;

comment on function public.trigger_payment_reminders() is
  'Declenche POST /api/cron/payment-reminders (relances de factures). Appelee par le job pg_cron lume_payment_reminders, jamais par un client.';

-- Le job. On le deprogramme d'abord : rejouer la migration ne doit pas creer
-- un doublon, et un doublon enverrait le rappel deux fois le meme matin.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lume_payment_reminders') then
    perform cron.unschedule('lume_payment_reminders');
  end if;
end;
$$;

select cron.schedule(
  'lume_payment_reminders',
  '0 13 * * *',
  $$select public.trigger_payment_reminders()$$
);
