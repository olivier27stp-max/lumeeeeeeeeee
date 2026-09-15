-- Journal des webhooks entrants (2026-09-15). Premier usage : Slack (support).
-- Quand un fournisseur « n'appelle pas », les logs Railway sont le seul témoin,
-- et ils ne sont pas lisibles sans session CLI. Cette table garde, pour chaque
-- appel reçu : signature acceptée ou non, type d'événement, résultat du
-- traitement. Jamais le corps complet (PII) : un résumé.
-- Serveur seulement (service_role) ; personne d'autre ne lit ni n'écrit.
-- Purge : 30 jours, par purge_webhook_receipts() (cron serveur à brancher au
-- besoin ; volume faible).
create table if not exists public.webhook_receipts (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,                   -- 'slack', 'resend', 'stripe'…
  received_at   timestamptz not null default now(),
  signature_ok  boolean,
  event_type    text,                            -- ex. 'event_callback:message'
  reference     text,                            -- ex. thread_ts Slack, id d'événement
  outcome       text,                            -- 'relayed' | 'ignored:<raison>' | 'error:<message>' | 'rejected:signature'
  summary       jsonb not null default '{}'::jsonb
);
create index if not exists webhook_receipts_provider_time on public.webhook_receipts (provider, received_at desc);
alter table public.webhook_receipts enable row level security;
alter table public.webhook_receipts force row level security;
revoke all on public.webhook_receipts from authenticated, anon;

create or replace function public.purge_webhook_receipts(p_days integer default 30)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  delete from public.webhook_receipts where received_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.purge_webhook_receipts(integer) from public, anon, authenticated;
grant execute on function public.purge_webhook_receipts(integer) to service_role;
