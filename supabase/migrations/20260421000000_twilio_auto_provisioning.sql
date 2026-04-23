-- ============================================================
-- MIGRATION: Twilio auto-provisioning (post-Stripe checkout)
-- Adds includes_sms flag on plans + provisioning_events observability table.
-- ============================================================

begin;

-- ─── plans.includes_sms ─────────────────────────────────────────
alter table public.plans
  add column if not exists includes_sms boolean not null default false;

update public.plans set includes_sms = true where slug in ('pro', 'enterprise');

-- ─── provisioning_events (observability / retry) ────────────────
create table if not exists public.provisioning_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  subscription_id uuid,
  event_type text not null,                 -- e.g. 'sms_number_purchase'
  status text not null default 'pending',   -- pending | success | failed | retrying
  twilio_number text,
  twilio_sid text,
  error_message text,
  attempt_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_provisioning_events_org on public.provisioning_events (org_id);
create index if not exists idx_provisioning_events_status on public.provisioning_events (status);
create index if not exists idx_provisioning_events_type on public.provisioning_events (event_type);

drop trigger if exists trg_provisioning_events_updated_at on public.provisioning_events;
create trigger trg_provisioning_events_updated_at
  before update on public.provisioning_events
  for each row execute function public.set_updated_at();

alter table public.provisioning_events enable row level security;

drop policy if exists "provisioning_events_select" on public.provisioning_events;
create policy "provisioning_events_select" on public.provisioning_events
  for select using (public.has_org_membership(auth.uid(), org_id));

-- Writes happen only via service_role (server-side). No insert/update policy for authenticated users.

commit;
