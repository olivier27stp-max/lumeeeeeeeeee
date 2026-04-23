-- ============================================================
-- MIGRATION: Twilio A2P 10DLC registration (US orgs)
-- Tracks Brand + Campaign status required to send SMS to US carriers.
-- ============================================================

begin;

-- ─── a2p_registrations ───────────────────────────────────────────
-- One row per org, created when US org starts the A2P wizard.
create table if not exists public.a2p_registrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique,

  -- Brand fields
  legal_business_name text,
  ein text,                         -- US EIN (9 digits) or foreign tax id
  business_type text,               -- 'PRIVATE_PROFIT' | 'PUBLIC_PROFIT' | 'NON_PROFIT' | 'SOLE_PROPRIETOR'
  vertical text,                    -- e.g. 'RETAIL', 'HEALTHCARE', 'TECHNOLOGY'
  street text,
  city text,
  region text,                      -- state code
  postal_code text,
  country text default 'US',
  website text,
  support_email text,
  support_phone text,

  -- Campaign fields
  use_case text,                    -- 'CUSTOMER_CARE' | 'MARKETING' | 'MIXED' | 'LOW_VOLUME'
  campaign_description text,
  message_samples jsonb not null default '[]'::jsonb,        -- array of 2-5 strings
  opt_in_keywords text[] not null default array[]::text[],
  opt_in_message text,
  opt_out_message text default 'Reply STOP to unsubscribe.',
  has_embedded_links boolean default false,
  has_embedded_phone boolean default false,

  -- Twilio IDs
  twilio_customer_profile_sid text,
  twilio_brand_sid text,
  twilio_campaign_sid text,
  twilio_messaging_service_sid text,

  -- Status tracking
  brand_status text not null default 'not_started',
    -- not_started | draft | submitted | in_review | verified | failed
  campaign_status text not null default 'not_started',
    -- not_started | submitted | in_review | verified | failed
  brand_error text,
  campaign_error text,
  last_checked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_a2p_registrations_org on public.a2p_registrations (org_id);
create index if not exists idx_a2p_registrations_brand_status on public.a2p_registrations (brand_status);
create index if not exists idx_a2p_registrations_campaign_status on public.a2p_registrations (campaign_status);

drop trigger if exists trg_a2p_registrations_updated_at on public.a2p_registrations;
create trigger trg_a2p_registrations_updated_at
  before update on public.a2p_registrations
  for each row execute function public.set_updated_at();

alter table public.a2p_registrations enable row level security;

drop policy if exists "a2p_registrations_select" on public.a2p_registrations;
create policy "a2p_registrations_select" on public.a2p_registrations
  for select using (public.has_org_membership(auth.uid(), org_id));

-- Writes happen only via service_role (server-side). No insert/update policy for authenticated users.

-- ─── Helper view: is A2P verified for an org? ─────────────────────
create or replace view public.org_a2p_status as
select
  org_id,
  brand_status,
  campaign_status,
  (brand_status = 'verified' and campaign_status = 'verified') as is_verified
from public.a2p_registrations;

commit;
