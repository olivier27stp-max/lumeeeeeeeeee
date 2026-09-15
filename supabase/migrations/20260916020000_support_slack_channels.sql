-- Support humain dans Slack : un CANAL PAR ENTREPRISE CLIENTE (2026-09-16).
-- Décision de Rafba : plutôt qu'un fil par demande dans #support, chaque
-- entreprise a son canal (#client-plomberie-tremblay), créé à la première
-- escalade ; toutes ses demandes y arrivent, l'historique complet est au même
-- endroit. #support ne reçoit qu'un pointeur par escalade. Le client, lui,
-- reste dans Lume : il ne voit jamais Slack.
--
-- Serveur seulement (service_role). `last_seen_ts` = dernier message Slack lu
-- par le relevé périodique du canal (conversations.history).
create table if not exists public.support_slack_channels (
  org_id        uuid primary key references public.orgs(id) on delete cascade,
  channel_id    text not null unique,
  channel_name  text not null,
  last_seen_ts  text,
  created_at    timestamptz not null default now()
);
alter table public.support_slack_channels enable row level security;
alter table public.support_slack_channels force row level security;
revoke all on public.support_slack_channels from authenticated, anon;
