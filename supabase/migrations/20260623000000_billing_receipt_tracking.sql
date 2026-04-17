-- ============================================================
-- MIGRATION: Billing receipt tracking + checkout session dedup
-- Adds fields for tracking receipt emails sent after payment,
-- and a checkout_sessions table for idempotent session processing.
-- ============================================================

begin;

-- ─── Add receipt tracking to subscriptions ─────────────────────
alter table public.subscriptions
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists receipt_email_sent boolean not null default false,
  add column if not exists receipt_email_sent_at timestamptz,
  add column if not exists receipt_email_error text;

-- Index for looking up by checkout session
create index if not exists idx_subscriptions_checkout_session
  on public.subscriptions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ─── Billing receipt log (full history of billing emails) ──────
create table if not exists public.billing_receipt_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  subscription_id uuid references public.subscriptions(id),
  recipient_email text not null,
  email_type text not null default 'payment_receipt',
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  stripe_invoice_id text,
  amount_cents integer not null default 0,
  currency text not null default 'CAD',
  plan_name text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  error_message text,
  message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_receipt_log_org
  on public.billing_receipt_log (org_id);
create index if not exists idx_billing_receipt_log_stripe_pi
  on public.billing_receipt_log (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index if not exists idx_billing_receipt_log_dedup
  on public.billing_receipt_log (stripe_checkout_session_id, email_type)
  where stripe_checkout_session_id is not null;

-- RLS
alter table public.billing_receipt_log enable row level security;

create policy "billing_receipt_log_org_member_select"
  on public.billing_receipt_log for select
  using (public.has_org_membership(auth.uid(), org_id));

-- Service role can insert/update (no user-facing writes)
create policy "billing_receipt_log_service_insert"
  on public.billing_receipt_log for insert
  with check (true);

create policy "billing_receipt_log_service_update"
  on public.billing_receipt_log for update
  using (true);

-- ─── Processed checkout sessions (idempotency) ────────────────
create table if not exists public.processed_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null unique,
  org_id uuid,
  user_id uuid,
  subscription_id uuid references public.subscriptions(id),
  status text not null default 'processed',
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_processed_checkout_sessions_stripe
  on public.processed_checkout_sessions (stripe_checkout_session_id);

-- RLS (service role only — webhook processing)
alter table public.processed_checkout_sessions enable row level security;

create policy "processed_checkout_sessions_service_all"
  on public.processed_checkout_sessions for all
  using (true) with check (true);

commit;
