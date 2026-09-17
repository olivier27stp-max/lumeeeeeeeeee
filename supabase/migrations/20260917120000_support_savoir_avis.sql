-- Lumi apprend de l'équipe + avis du client sur ses réponses (2026-09-17).
--
-- support_savoir : ce que l'équipe a répondu à un client et veut que Lumi
-- ressorte aux suivants. Une ligne est créée depuis Slack : un message de fil
-- qui commence par 📌 (ou « Lumi, retiens : … »), ou une réponse déjà relayée
-- sur laquelle quelqu'un met la réaction 📌. Le serveur (service_role) seul
-- écrit et lit ; aucun client n'y accède (les réponses peuvent parler d'une
-- autre entreprise).
--
-- support_messages.avis : 👍 / 👎 du client sur une réponse de Lumi. Un 👎
-- fait oublier la réponse mémorisée (cache sémantique) et compte dans le
-- résumé quotidien.
create table if not exists public.support_savoir (
  id                uuid primary key default gen_random_uuid(),
  question          text not null,
  reponse           text not null,
  auteur            text,
  source_ticket_id  uuid references public.support_tickets(id) on delete set null,
  slack_channel_id  text,
  slack_ts          text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
comment on table public.support_savoir is 'Réponses de l''équipe retenues pour Lumi (📌 dans Slack). Lecture/écriture serveur seulement.';
create unique index if not exists support_savoir_slack_ts on public.support_savoir (slack_channel_id, slack_ts) where slack_ts is not null;
create index if not exists support_savoir_actif on public.support_savoir (created_at desc) where deleted_at is null;
alter table public.support_savoir enable row level security;
alter table public.support_savoir force row level security;
-- Les GRANT par défaut de Supabase donnent ALL à authenticated : on retire tout (aucune policy = aucun accès client).
revoke all on public.support_savoir from authenticated, anon;

alter table public.support_messages add column if not exists avis text;
alter table public.support_messages drop constraint if exists support_messages_avis_check;
alter table public.support_messages add constraint support_messages_avis_check check (avis is null or avis in ('bon', 'mauvais'));
comment on column public.support_messages.avis is 'Avis du client sur une réponse de Lumi : bon (👍) ou mauvais (👎).';
