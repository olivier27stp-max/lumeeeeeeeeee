-- ============================================================
-- Email Accounts: per-OWNER connected Gmail / Outlook mailboxes.
--
-- Unlike app_connections (which is org-scoped, one per org), each
-- owner connects their OWN personal mailbox. Tokens are encrypted
-- at rest by the app (AES-256-GCM via PAYMENTS_ENCRYPTION_KEY),
-- NOT stored in plaintext. RLS ensures a user only ever sees their
-- own connected mailboxes.
-- ============================================================

-- 1. Table
create table if not exists public.email_accounts (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.orgs(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  provider                 text not null check (provider in ('gmail','outlook')),
  email_address            text not null,

  -- Encrypted OAuth tokens (never plaintext). Encrypted by src/lib/crypto.ts.
  encrypted_access_token   text,
  encrypted_refresh_token  text,
  token_expires_at         timestamptz,

  -- Incremental sync cursors (populated in Étape 2)
  history_id               text,   -- Gmail History API cursor
  delta_link               text,   -- Microsoft Graph delta link

  scopes                   text[] not null default '{}',
  status                   text not null default 'connected'
                             check (status in ('connected','error','reconnect_required','disconnected')),
  last_error               text,
  last_synced_at           timestamptz,
  connected_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- one mailbox per (user, provider, address)
  unique (user_id, provider, email_address)
);

-- 2. Indexes
create index if not exists idx_email_accounts_user   on public.email_accounts(user_id);
create index if not exists idx_email_accounts_org    on public.email_accounts(org_id);
create index if not exists idx_email_accounts_status on public.email_accounts(user_id, status);

-- 3. RLS — each owner sees ONLY their own mailboxes.
alter table public.email_accounts enable row level security;

-- Read own accounts
create policy "email_accounts_select_own"
  on public.email_accounts for select
  using (user_id = auth.uid());

-- Insert only for self, and only within an org the user belongs to
create policy "email_accounts_insert_own"
  on public.email_accounts for insert
  with check (
    user_id = auth.uid()
    and org_id in (
      select m.org_id from public.memberships m
      where m.user_id = auth.uid()
    )
  );

-- Update own accounts
create policy "email_accounts_update_own"
  on public.email_accounts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete own accounts
create policy "email_accounts_delete_own"
  on public.email_accounts for delete
  using (user_id = auth.uid());

-- 4. OAuth state table (CSRF protection for the email OAuth flow).
--    Separate from integration_oauth_states so the two flows never collide.
create table if not exists public.email_oauth_states (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('gmail','outlook')),
  state         text not null unique,
  redirect_uri  text not null,
  code_verifier text,                                 -- PKCE (Outlook)
  consumed_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '15 minutes'),
  created_at    timestamptz not null default now()
);

create index if not exists idx_email_oauth_states_state on public.email_oauth_states(state);

-- The OAuth state table is only ever read/written by the server via the
-- service_role client (bypasses RLS). Enable RLS with no policies so it is
-- locked down to anon/authenticated callers.
alter table public.email_oauth_states enable row level security;

-- 5. updated_at trigger
create or replace function public.set_email_accounts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists trg_email_accounts_updated_at on public.email_accounts;
create trigger trg_email_accounts_updated_at
  before update on public.email_accounts
  for each row execute function public.set_email_accounts_updated_at();
