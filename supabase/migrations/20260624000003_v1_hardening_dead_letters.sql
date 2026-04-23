-- ============================================================================
-- V1 Hardening — Dead-letter table for async job failures
-- Idempotent
-- ============================================================================

create table if not exists public.dead_letters (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,           -- e.g. 'sms_inbound', 'paypal_webhook'
  payload      jsonb not null,
  error_msg    text not null,
  attempts     int  not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz
);

create index if not exists idx_dead_letters_source_created
  on public.dead_letters(source, first_seen_at desc);
create index if not exists idx_dead_letters_unresolved
  on public.dead_letters(source, first_seen_at desc)
  where resolved_at is null;

alter table public.dead_letters enable row level security;

drop policy if exists "dead_letters_service" on public.dead_letters;
create policy "dead_letters_service" on public.dead_letters
  for all to service_role using (true) with check (true);
