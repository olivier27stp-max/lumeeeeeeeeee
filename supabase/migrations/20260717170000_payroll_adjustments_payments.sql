-- Page Paie : ajustements manuels et historique de paiements par période.
-- Écritures via les routes serveur (service_role) ; lecture RLS org.

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null,
  period_start date not null,
  period_end date not null,
  -- positif = bonus / correction en plus ; négatif = retenue
  amount_cents integer not null,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_payroll_adjustments_org_user_period
  on public.payroll_adjustments (org_id, user_id, period_start);

alter table public.payroll_adjustments enable row level security;

drop policy if exists payroll_adjustments_select on public.payroll_adjustments;
create policy payroll_adjustments_select on public.payroll_adjustments
  for select using (public.has_org_membership(auth.uid(), org_id));

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null,
  period_start date not null,
  period_end date not null,
  hours numeric(8,2) not null default 0,
  gross_cents integer not null default 0,
  commission_cents integer not null default 0,
  adjustments_cents integer not null default 0,
  total_cents integer not null default 0,
  note text,
  paid_at timestamptz not null default now(),
  paid_by uuid not null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, period_start, period_end)
);

create index if not exists idx_payroll_payments_org_period
  on public.payroll_payments (org_id, period_start);

alter table public.payroll_payments enable row level security;

drop policy if exists payroll_payments_select on public.payroll_payments;
create policy payroll_payments_select on public.payroll_payments
  for select using (public.has_org_membership(auth.uid(), org_id));
