-- ───────────────────────────────────────────────────────────────
-- Invariants quotidiens (check_all_invariants) : remettre au vert ce qui
-- était rouge le 2026-09-24, sans rien affaiblir.
--
-- 1. rls_coverage — 5 tables serveur seulement (RLS activée + forcée, aucune
--    policy, privilèges au seul service_role) : c'est voulu, mais la règle
--    exige que ce soit DÉCLARÉ dans le commentaire (« deny-all volontaire »).
--    lumi_traces : RLS non forcée → forcée (écrite et lue par le serveur,
--    service_role contourne la RLS ; la policy membre reste).
-- 2. exposed_trigger_functions — 5 fonctions trigger exécutables par anon /
--    authenticated (oubli des migrations récentes) : révoquées, comme les
--    autres (un trigger se déclenche sans ce droit).
-- 3. failing_cron_jobs — un seul « job startup timeout » (hoquet de pg_cron)
--    sur 864 exécutions de lumi_expire_reservations gardait l'alarme rouge
--    7 jours. Une panne réelle (toute autre erreur) alerte toujours dès la
--    première ; les délais de démarrage, seulement s'ils se répètent (≥ 3).
-- ───────────────────────────────────────────────────────────────

comment on table public.creator_space_notes is
  'Notes internes de la plateforme sur un workspace. deny-all volontaire : RLS activée sans policy + privilèges révoqués pour anon/authenticated : seul le service_role y accède (routes gardées par requireCreatorSpace). Jamais visible par le client.';
comment on table public.failed_login_attempts is
  '[Security] Failed login attempt log (anomaly detection, pre-auth). deny-all volontaire : écrit et lu par le serveur seulement (service_role).';
comment on table public.support_savoir is
  'Réponses de l''équipe retenues pour Lumi (📌 dans Slack). deny-all volontaire : lecture/écriture serveur seulement (service_role).';
comment on table public.support_slack_channels is
  'Canal Slack de support par entreprise cliente (server/lib/support/canaux-slack.ts). deny-all volontaire : serveur seulement (service_role).';
comment on table public.webhook_receipts is
  'Accusés de réception des webhooks (idempotence : un svix-id / MessageId SNS n''est traité qu''une fois). deny-all volontaire : serveur seulement (service_role).';

alter table public.lumi_traces force row level security;

revoke all on function public.clients_portal_token_hash() from public, anon, authenticated;
revoke all on function public.jobs_set_completed_at() from public, anon, authenticated;
revoke all on function public.set_support_tickets_updated_at() from public, anon, authenticated;
revoke all on function public.deals_figer_premier_contact() from public, anon, authenticated;
-- Posée le 2026-09-25 par 20260925120000_deal_delie_job_supprimee (même oubli).
revoke all on function public.jobs_delier_deal() from public, anon, authenticated;

create or replace function public.check_failing_cron_jobs()
 returns table(jobname text, failures_7d bigint, last_error text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
  select j.jobname::text,
         count(*) filter (where r.status = 'failed'),
         (array_agg(r.return_message order by r.end_time desc)
            filter (where r.status = 'failed'))[1]
    from cron.job j
    join cron.job_run_details r on r.jobid = j.jobid
   where r.start_time > now() - interval '7 days'
   group by j.jobname
  having count(*) filter (where r.status = 'failed' and coalesce(r.return_message, '') <> 'job startup timeout') > 0
      or count(*) filter (where r.status = 'failed' and r.return_message = 'job startup timeout') >= 3;
$function$;
