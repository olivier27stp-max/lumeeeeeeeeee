-- ============================================================================
-- V1 Hardening — Harden clients.portal_token storage
-- Idempotent: safe to run multiple times
-- ============================================================================
-- Adds a SHA-256 hash column + expires_at + revoked_at on clients.
-- Backend will prefer token_hash lookup when available; plaintext stays as
-- fallback during the transition window so existing tokens keep working.
-- After a grace period (weeks), the plaintext column can be dropped.

do $$ begin
  if to_regclass('public.clients') is null then return; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'portal_token_hash'
  ) then
    alter table public.clients add column portal_token_hash text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'portal_token_expires_at'
  ) then
    alter table public.clients add column portal_token_expires_at timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'portal_token_revoked_at'
  ) then
    alter table public.clients add column portal_token_revoked_at timestamptz;
  end if;

  -- Backfill hash for any existing plaintext tokens so new code works immediately.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'portal_token'
  ) then
    update public.clients
       set portal_token_hash = encode(digest(portal_token::bytea, 'sha256'), 'hex'),
           portal_token_expires_at = coalesce(portal_token_expires_at, now() + interval '90 days')
     where portal_token is not null
       and portal_token_hash is null;
  end if;

  create index if not exists idx_clients_portal_token_hash on public.clients(portal_token_hash)
    where portal_token_hash is not null;
end $$;
