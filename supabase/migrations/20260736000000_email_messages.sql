-- ============================================================
-- Email inbox storage: threads + messages synced from the owner's
-- connected mailbox (Gmail / Outlook). Per-owner via account_id →
-- email_accounts (which is itself per user_id). Additif.
-- ============================================================

-- ── Threads (conversations) ──────────────────────────────────
create table if not exists public.email_threads (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.email_accounts(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  org_id             uuid not null references public.orgs(id) on delete cascade,
  provider_thread_id text not null,               -- Gmail threadId / Graph conversationId
  subject            text,
  snippet            text,
  last_message_at    timestamptz,
  is_read            boolean not null default false,
  has_attachments    boolean not null default false,
  message_count      int not null default 0,
  folder             text not null default 'inbox',  -- inbox | sent | archive | trash
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (account_id, provider_thread_id)
);

create index if not exists idx_email_threads_account on public.email_threads(account_id, last_message_at desc);
create index if not exists idx_email_threads_user    on public.email_threads(user_id);
create index if not exists idx_email_threads_folder  on public.email_threads(account_id, folder, last_message_at desc);

-- ── Messages ─────────────────────────────────────────────────
create table if not exists public.email_messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references public.email_threads(id) on delete cascade,
  account_id          uuid not null references public.email_accounts(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider_message_id text not null,              -- Gmail messageId / Graph id
  from_name           text,
  from_email          text,
  to_emails           text[] not null default '{}',
  cc_emails           text[] not null default '{}',
  subject             text,
  snippet             text,
  body_html           text,
  body_text           text,
  direction           text not null default 'inbound' check (direction in ('inbound','outbound')),
  is_read             boolean not null default false,
  has_attachments     boolean not null default false,
  attachments         jsonb not null default '[]'::jsonb,  -- [{filename,mimeType,size,attachmentId}]
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (account_id, provider_message_id)
);

create index if not exists idx_email_messages_thread  on public.email_messages(thread_id, sent_at);
create index if not exists idx_email_messages_account on public.email_messages(account_id);

-- ── RLS: owner sees only their own threads/messages ──────────
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

create policy "email_threads_select_own"
  on public.email_threads for select using (user_id = auth.uid());
create policy "email_messages_select_own"
  on public.email_messages for select using (user_id = auth.uid());

-- Writes happen server-side via service_role (bypasses RLS). No client
-- insert/update/delete policies → clients can only read their own rows.

-- ── updated_at trigger on threads ────────────────────────────
create or replace function public.set_email_threads_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists trg_email_threads_updated_at on public.email_threads;
create trigger trg_email_threads_updated_at
  before update on public.email_threads
  for each row execute function public.set_email_threads_updated_at();
