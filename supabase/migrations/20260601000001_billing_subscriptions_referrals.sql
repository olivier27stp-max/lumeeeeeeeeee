-- ============================================================
-- MIGRATION: Billing, subscriptions, plans, referrals
-- ============================================================

begin;

-- ─── Plans table ─────────────────────────────────────────────────
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  name_fr text not null,
  monthly_price_usd integer not null default 0,
  monthly_price_cad integer not null default 0,
  yearly_price_usd integer not null default 0,
  yearly_price_cad integer not null default 0,
  features jsonb not null default '[]'::jsonb,
  max_clients integer,
  max_jobs_per_month integer,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed default plans
insert into public.plans (slug, name, name_fr, monthly_price_usd, monthly_price_cad, yearly_price_usd, yearly_price_cad, max_clients, max_jobs_per_month, sort_order, features)
values
  ('starter', 'Starter', 'Debutant', 0, 0, 0, 0, 3, 10, 1,
   '["3 clients","10 jobs/month","Basic invoicing","Email support"]'::jsonb),
  ('pro', 'Pro', 'Pro', 2900, 3900, 29000, 39000, null, null, 2,
   '["Unlimited clients","Unlimited jobs","All integrations","Priority support","Automations","Team management"]'::jsonb),
  ('enterprise', 'Enterprise', 'Entreprise', 9900, 12900, 99000, 129000, null, null, 3,
   '["Everything in Pro","SSO/SAML","API access","Custom onboarding","Dedicated account manager","SLA guarantee","Audit logs"]'::jsonb)
on conflict (slug) do nothing;

-- ─── Billing profiles ────────────────────────────────────────────
create table if not exists public.billing_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique,
  billing_email text,
  company_name text,
  full_name text,
  address text,
  city text,
  region text,
  country text default 'CA',
  postal_code text,
  phone text,
  currency text not null default 'CAD',
  stripe_customer_id text,
  tax_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_profiles_org on public.billing_profiles (org_id);
create index if not exists idx_billing_profiles_stripe on public.billing_profiles (stripe_customer_id);

drop trigger if exists trg_billing_profiles_updated_at on public.billing_profiles;
create trigger trg_billing_profiles_updated_at
  before update on public.billing_profiles
  for each row execute function public.set_updated_at();

alter table public.billing_profiles enable row level security;

drop policy if exists "billing_profiles_select" on public.billing_profiles;
create policy "billing_profiles_select" on public.billing_profiles
  for select using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists "billing_profiles_upsert" on public.billing_profiles;
create policy "billing_profiles_upsert" on public.billing_profiles
  for all using (public.has_org_membership(auth.uid(), org_id));

-- ─── Subscriptions ───────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  plan_id uuid not null references public.plans(id),
  status text not null default 'active',
  interval text not null default 'monthly',
  currency text not null default 'CAD',
  amount_cents integer not null default 0,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_end timestamptz,
  promo_code text,
  referral_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_org on public.subscriptions (org_id);
create index if not exists idx_subscriptions_stripe on public.subscriptions (stripe_subscription_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_status_check'
  ) then
    alter table public.subscriptions add constraint subscriptions_status_check
      check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_interval_check'
  ) then
    alter table public.subscriptions add constraint subscriptions_interval_check
      check (interval in ('monthly', 'yearly'));
  end if;
end $$;

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select" on public.subscriptions;
create policy "subscriptions_select" on public.subscriptions
  for select using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists "subscriptions_all" on public.subscriptions;
create policy "subscriptions_all" on public.subscriptions
  for all using (public.has_org_membership(auth.uid(), org_id));

-- ─── Promo codes ─────────────────────────────────────────────────
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null default 'percentage',
  discount_value integer not null default 0,
  max_uses integer,
  current_uses integer not null default 0,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'promo_codes_discount_type_check'
  ) then
    alter table public.promo_codes add constraint promo_codes_discount_type_check
      check (discount_type in ('percentage', 'fixed_cents'));
  end if;
end $$;

-- ─── Referrals ───────────────────────────────────────────────────
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null,
  referrer_org_id uuid not null,
  code text not null unique,
  referred_email text,
  referred_org_id uuid,
  referred_user_id uuid,
  status text not null default 'invited',
  reward_amount_cents integer not null default 15000,
  reward_currency text not null default 'USD',
  converted_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_referrals_referrer on public.referrals (referrer_user_id);
create index if not exists idx_referrals_code on public.referrals (code);
create index if not exists idx_referrals_org on public.referrals (referrer_org_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'referrals_status_check'
  ) then
    alter table public.referrals add constraint referrals_status_check
      check (status in ('invited', 'signed_up', 'subscribed', 'reward_pending', 'rewarded'));
  end if;
end $$;

drop trigger if exists trg_referrals_updated_at on public.referrals;
create trigger trg_referrals_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

alter table public.referrals enable row level security;

drop policy if exists "referrals_select" on public.referrals;
create policy "referrals_select" on public.referrals
  for select using (
    referrer_user_id = auth.uid()
    or public.has_org_membership(auth.uid(), referrer_org_id)
  );

drop policy if exists "referrals_insert" on public.referrals;
create policy "referrals_insert" on public.referrals
  for insert with check (referrer_user_id = auth.uid());

drop policy if exists "referrals_update" on public.referrals;
create policy "referrals_update" on public.referrals
  for update using (
    referrer_user_id = auth.uid()
    or public.has_org_membership(auth.uid(), referrer_org_id)
  );

commit;
