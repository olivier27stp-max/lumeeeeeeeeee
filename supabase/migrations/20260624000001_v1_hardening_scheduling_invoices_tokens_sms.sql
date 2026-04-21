-- ============================================================================
-- V1 Hardening — Scheduling, Invoices, Portal Tokens, SMS (CASL)
-- Idempotent: safe to run multiple times
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Scheduling: prevent double-booking of a technician on the same org
-- ---------------------------------------------------------------------------
-- Uses btree_gist + EXCLUDE constraint so Postgres enforces no overlap at
-- commit time. Parallel inserts that would collide get rejected with
-- SQLSTATE 23P01 (exclusion_violation) — the route handler catches that
-- and returns a clean 409.
do $$ begin
  if to_regclass('public.schedule_events') is not null then
    create extension if not exists btree_gist;

    -- Drop existing exclusion constraint if present (idempotent)
    if exists (
      select 1 from pg_constraint
      where conname = 'schedule_events_no_tech_overlap'
        and conrelid = 'public.schedule_events'::regclass
    ) then
      alter table public.schedule_events drop constraint schedule_events_no_tech_overlap;
    end if;

    -- Only enforce when deleted_at is NULL and assigned_user is set.
    -- Uses whichever column pair exists: start_time/end_time or start_at/end_at.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'schedule_events'
        and column_name  = 'start_time'
    ) then
      alter table public.schedule_events
        add constraint schedule_events_no_tech_overlap
        exclude using gist (
          assigned_user with =,
          org_id        with =,
          tstzrange(start_time, end_time) with &&
        )
        where (deleted_at is null and assigned_user is not null);
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'schedule_events'
        and column_name  = 'start_at'
    ) then
      alter table public.schedule_events
        add constraint schedule_events_no_tech_overlap
        exclude using gist (
          assigned_user with =,
          org_id        with =,
          tstzrange(start_at, end_at) with &&
        )
        where (deleted_at is null and assigned_user is not null);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Invoice paid lock — prevent mutating amount or line items after paid
-- ---------------------------------------------------------------------------
create or replace function public.prevent_paid_invoice_edit()
returns trigger language plpgsql as $$
begin
  if OLD.status = 'paid' and NEW.status = 'paid' then
    if coalesce(OLD.total_cents, 0) is distinct from coalesce(NEW.total_cents, 0) then
      raise exception 'Cannot modify total on a paid invoice (use void + new invoice instead)'
        using errcode = 'check_violation';
    end if;
    if coalesce(OLD.balance_cents, 0) is distinct from coalesce(NEW.balance_cents, 0) and NEW.balance_cents > 0 then
      raise exception 'Cannot re-open a paid invoice'
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end; $$;

do $$ begin
  if to_regclass('public.invoices') is not null then
    drop trigger if exists trg_invoice_paid_lock on public.invoices;
    create trigger trg_invoice_paid_lock
      before update on public.invoices
      for each row execute function public.prevent_paid_invoice_edit();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Invoice numbering — per-org sequence with UNIQUE constraint
-- ---------------------------------------------------------------------------
create table if not exists public.org_invoice_sequences (
  org_id      uuid primary key,
  next_number bigint not null default 1,
  updated_at  timestamptz not null default now()
);

alter table public.org_invoice_sequences enable row level security;
drop policy if exists "org_invoice_sequences_service" on public.org_invoice_sequences;
create policy "org_invoice_sequences_service" on public.org_invoice_sequences
  for all to service_role using (true) with check (true);

create or replace function public.claim_next_invoice_number(p_org uuid)
returns bigint
language plpgsql
security definer
set search_path = public as $$
declare
  v_num bigint;
begin
  insert into public.org_invoice_sequences (org_id, next_number)
    values (p_org, 1)
  on conflict (org_id) do nothing;

  update public.org_invoice_sequences
     set next_number = next_number + 1,
         updated_at  = now()
   where org_id = p_org
  returning next_number - 1 into v_num;

  return v_num;
end; $$;

revoke all on function public.claim_next_invoice_number(uuid) from public, authenticated, anon;
grant execute on function public.claim_next_invoice_number(uuid) to service_role;

-- UNIQUE (org_id, invoice_number) — add only if column exists and no conflict
do $$ begin
  if to_regclass('public.invoices') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_number'
     )
     and not exists (
       select 1 from pg_constraint
       where conname = 'invoices_org_number_uniq'
         and conrelid = 'public.invoices'::regclass
     )
  then
    begin
      alter table public.invoices
        add constraint invoices_org_number_uniq
        unique (org_id, invoice_number);
    exception
      when unique_violation then
        raise notice 'Skipping invoices_org_number_uniq: existing duplicates present, dedupe before enforcing';
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Portal tokens — expiration + SHA-256 hash
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.portal_tokens') is not null then
    -- expires_at: default 90 days out, not-null after backfill
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'portal_tokens' and column_name = 'expires_at'
    ) then
      alter table public.portal_tokens add column expires_at timestamptz;
      update public.portal_tokens set expires_at = coalesce(expires_at, created_at + interval '90 days');
      alter table public.portal_tokens alter column expires_at set default (now() + interval '90 days');
      alter table public.portal_tokens alter column expires_at set not null;
    end if;

    -- token_hash: sha256 of the plaintext token (hex)
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'portal_tokens' and column_name = 'token_hash'
    ) then
      alter table public.portal_tokens add column token_hash text;
      -- Backfill from existing plaintext if present
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'portal_tokens' and column_name = 'token'
      ) then
        update public.portal_tokens
           set token_hash = encode(digest(token::bytea, 'sha256'), 'hex')
         where token_hash is null and token is not null;
      end if;
      create unique index if not exists idx_portal_tokens_hash on public.portal_tokens(token_hash);
    end if;

    -- revoked_at for explicit revocation
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'portal_tokens' and column_name = 'revoked_at'
    ) then
      alter table public.portal_tokens add column revoked_at timestamptz;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. SMS CASL compliance — opt-out table + helper
-- ---------------------------------------------------------------------------
create table if not exists public.sms_opt_outs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  phone        text not null,
  opted_out_at timestamptz not null default now(),
  reason       text,
  unique (org_id, phone)
);

create index if not exists idx_sms_opt_outs_phone on public.sms_opt_outs(phone);
alter table public.sms_opt_outs enable row level security;

drop policy if exists "sms_opt_outs_service" on public.sms_opt_outs;
create policy "sms_opt_outs_service" on public.sms_opt_outs
  for all to service_role using (true) with check (true);

drop policy if exists "sms_opt_outs_select_org" on public.sms_opt_outs;
create policy "sms_opt_outs_select_org" on public.sms_opt_outs
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = sms_opt_outs.org_id
  ));

-- Normalize phone: strip all non-digits, then prepend +1 if 10 digits (NANP)
create or replace function public.normalize_phone(p_phone text)
returns text language plpgsql immutable as $$
declare
  v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '\D', '', 'g');
  if length(v_digits) = 10 then return '+1' || v_digits; end if;
  if length(v_digits) = 11 and substr(v_digits, 1, 1) = '1' then return '+' || v_digits; end if;
  if length(v_digits) > 0 then return '+' || v_digits; end if;
  return null;
end; $$;

-- Helper used by the SMS sending code path
create or replace function public.is_sms_opted_out(p_org uuid, p_phone text)
returns boolean language plpgsql stable as $$
declare
  v_norm text;
begin
  v_norm := public.normalize_phone(p_phone);
  if v_norm is null then return false; end if;
  return exists (
    select 1 from public.sms_opt_outs
    where org_id = p_org
      and public.normalize_phone(phone) = v_norm
  );
end; $$;

revoke all on function public.is_sms_opted_out(uuid, text) from public, anon;
grant execute on function public.is_sms_opted_out(uuid, text) to authenticated, service_role;

-- SMS consent column on clients (CASL — explicit consent timestamp)
do $$ begin
  if to_regclass('public.clients') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'clients' and column_name = 'sms_consent_at'
     )
  then
    alter table public.clients add column sms_consent_at timestamptz;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Advisory lock wrappers (callable via PostgREST RPC)
-- ---------------------------------------------------------------------------
create or replace function public.try_advisory_lock(p_key bigint)
returns boolean language sql security definer set search_path = public as $$
  select pg_try_advisory_lock(p_key);
$$;

create or replace function public.release_advisory_lock(p_key bigint)
returns boolean language sql security definer set search_path = public as $$
  select pg_advisory_unlock(p_key);
$$;

revoke all on function public.try_advisory_lock(bigint)     from public, anon, authenticated;
revoke all on function public.release_advisory_lock(bigint) from public, anon, authenticated;
grant execute on function public.try_advisory_lock(bigint)     to service_role;
grant execute on function public.release_advisory_lock(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Indexes on agent tables (improves pagination/filtering perf)
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.agent_messages') is not null then
    create index if not exists idx_agent_messages_org_created
      on public.agent_messages(org_id, created_at desc);
  end if;
  if to_regclass('public.decision_logs') is not null then
    create index if not exists idx_decision_logs_org_created
      on public.decision_logs(org_id, created_at desc);
  end if;
  if to_regclass('public.approvals') is not null then
    create index if not exists idx_approvals_org_status
      on public.approvals(org_id, status, created_at desc);
  end if;
end $$;
