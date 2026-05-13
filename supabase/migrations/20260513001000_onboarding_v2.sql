-- ============================================================
-- MIGRATION: Onboarding v2 — industry, employee_count, setup tracking
-- ============================================================
-- Adds columns required by the rebuilt 3-step onboarding wizard
-- and the persistent setup checklist widget.

begin;

-- orgs already has `industry` and `address`. Add what's missing.
alter table public.orgs add column if not exists employee_count text;
alter table public.orgs add column if not exists logo_url text;

-- company_settings: industry preset + setup completion flag
alter table public.company_settings add column if not exists industry text;
alter table public.company_settings add column if not exists default_unit text;
alter table public.company_settings add column if not exists setup_completed boolean not null default false;

-- profiles.onboarding_done already exists. Ensure invitations table exists with token_hash.
-- (Server route relies on it but no-op if already there.)

commit;
