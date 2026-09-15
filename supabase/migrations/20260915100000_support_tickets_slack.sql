-- Support en deux niveaux (2026-09-15) : assistant IA d'abord, humain ensuite,
-- dans Slack. Avant : un formulaire → un courriel, aucune trace, aucune suite.
--
-- support_tickets  : une conversation de support par demande (IA puis humain)
-- support_messages : chaque message (client, IA, agent humain via Slack)
--
-- Écritures par le serveur seulement (service_role) ; le client lit SES propres
-- conversations (user_id = auth.uid()). Les jetons Slack vivent dans l'env
-- (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_SUPPORT_CHANNEL_ID), jamais ici.

create table if not exists public.support_tickets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  subject           text not null,
  category          text,
  priority          text not null default 'normal' check (priority in ('priority', 'normal')),
  plan_slug         text,
  sla_key           text,                                   -- '4h' | '1d' | '2d'
  status            text not null default 'ai' check (status in ('ai', 'open', 'answered', 'closed')),
  company_name      text,
  user_email        text,
  user_name         text,
  slack_channel_id  text,
  slack_thread_ts   text,                                   -- fil Slack du ticket (une fois escaladé)
  escalated_at      timestamptz,
  escalation_reason text,
  last_message_at   timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
comment on table public.support_tickets is 'Conversations de support : IA (status ai) puis humain dans Slack (open/answered), puis closed.';

create index if not exists support_tickets_org_user on public.support_tickets (org_id, user_id, last_message_at desc);
create unique index if not exists support_tickets_slack_thread on public.support_tickets (slack_channel_id, slack_thread_ts) where slack_thread_ts is not null;

create table if not exists public.support_messages (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.support_tickets(id) on delete cascade,
  org_id            uuid not null references public.orgs(id) on delete cascade,
  author            text not null check (author in ('user', 'ai', 'agent', 'system')),
  author_name       text,
  body              text not null,
  slack_ts          text,                                   -- message Slack d'origine (agent) ou miroir (client)
  created_at        timestamptz not null default now(),
  read_by_user_at   timestamptz
);
create index if not exists support_messages_ticket on public.support_messages (ticket_id, created_at);
create unique index if not exists support_messages_slack_ts on public.support_messages (ticket_id, slack_ts) where slack_ts is not null;

alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;
alter table public.support_messages enable row level security;
alter table public.support_messages force row level security;

drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  as permissive for select to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));

drop policy if exists support_messages_select_own on public.support_messages;
create policy support_messages_select_own on public.support_messages
  as permissive for select to authenticated
  using (exists (
    select 1 from public.support_tickets t
     where t.id = support_messages.ticket_id
       and t.user_id = (select auth.uid())
       and public.has_org_membership((select auth.uid()), t.org_id)
  ));

-- Les GRANT par défaut de Supabase donnent ALL à authenticated : on retire
-- l'écriture nommément (voir mémoire secdef-lume-moindre-privilege).
revoke insert, update, delete on public.support_tickets from authenticated, anon;
revoke insert, update, delete on public.support_messages from authenticated, anon;

create or replace function public.set_support_tickets_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_support_tickets_updated on public.support_tickets;
create trigger trg_support_tickets_updated before update on public.support_tickets
  for each row execute function public.set_support_tickets_updated_at();
