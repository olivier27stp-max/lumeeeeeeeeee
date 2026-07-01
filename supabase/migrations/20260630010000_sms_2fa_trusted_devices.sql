-- ════════════════════════════════════════════════════════════════════════
-- SMS-based 2FA + trusted devices (risk-based, payments-scoped)
-- ════════════════════════════════════════════════════════════════════════
-- Owners verify a mobile number once; sensitive payment actions (and logins
-- from an unrecognized device) then require a one-time SMS code — unless the
-- device is already trusted (30 days). Mirrors how modern field-service CRMs
-- handle step-up auth. All writes go through the server (service_role); RLS
-- only lets a user read their own rows.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Verified phone number (one per user) ─────────────────────────────────
create table if not exists public.mfa_phone (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid,
  phone       text not null,               -- E.164
  verified_at timestamptz,                  -- null until confirmed
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Trusted devices — skip the SMS challenge while valid ──────────────────
create table if not exists public.mfa_trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null,              -- sha256(device token); token itself never stored
  label        text,                        -- e.g. "Chrome · macOS"
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  unique (user_id, token_hash)
);
create index if not exists idx_mfa_trusted_devices_user on public.mfa_trusted_devices (user_id);
create index if not exists idx_mfa_trusted_devices_hash on public.mfa_trusted_devices (token_hash);

-- 3. Pending SMS one-time codes (enrollment + step-up) ─────────────────────
create table if not exists public.mfa_sms_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  phone       text not null,
  code_hash   text not null,               -- sha256(6-digit code)
  purpose     text not null default 'stepup' check (purpose in ('enroll', 'stepup')),
  attempts    int  not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_mfa_sms_challenges_user on public.mfa_sms_challenges (user_id, created_at desc);

-- 4. RLS — server (service_role) bypasses; users may read their own only ───
alter table public.mfa_phone            enable row level security;
alter table public.mfa_trusted_devices  enable row level security;
alter table public.mfa_sms_challenges   enable row level security;

drop policy if exists mfa_phone_select_own on public.mfa_phone;
create policy mfa_phone_select_own on public.mfa_phone
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists mfa_trusted_devices_select_own on public.mfa_trusted_devices;
create policy mfa_trusted_devices_select_own on public.mfa_trusted_devices
  for select to authenticated using (auth.uid() = user_id);

-- Challenges are server-only: no client policy (RLS denies all to clients).
