-- ════════════════════════════════════════════════════════════════════
-- Service plan contracts
-- ────────────────────────────────────────────────────────────────────
-- A service-plan job (jobs.job_type = 'recurring') can optionally carry a
-- CONTRACT: a 12-month calendar for a given year where each planned month
-- holds the exact visit date. The visits themselves are regular
-- schedule_events (one per planned month); the contract is the client-facing
-- summary of the plan.
--
--   visits jsonb = [{ "month": 1..12, "date": "YYYY-MM-DD" }, ...]
--
-- Idempotent — safe to run multiple times.
-- Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260712000000_service_contracts.sql
-- ════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.service_contracts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete set null,
  title       text not null default '',
  year        int  not null,
  visits      jsonb not null default '[]',
  status      text not null default 'active',
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists idx_service_contracts_org_id on public.service_contracts (org_id);
create index if not exists idx_service_contracts_job_id on public.service_contracts (job_id);

drop trigger if exists trg_service_contracts_set_updated_at on public.service_contracts;
create trigger trg_service_contracts_set_updated_at
  before update on public.service_contracts
  for each row execute function public.set_updated_at();

-- ── RLS (mirror properties: org members read/write) ─────────────────
alter table public.service_contracts enable row level security;

drop policy if exists service_contracts_select on public.service_contracts;
drop policy if exists service_contracts_insert on public.service_contracts;
drop policy if exists service_contracts_update on public.service_contracts;
drop policy if exists service_contracts_delete on public.service_contracts;

create policy service_contracts_select on public.service_contracts
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), service_contracts.org_id));

create policy service_contracts_insert on public.service_contracts
  for insert to authenticated
  with check (public.has_org_membership((select auth.uid()), service_contracts.org_id));

create policy service_contracts_update on public.service_contracts
  for update to authenticated
  using  (public.has_org_membership((select auth.uid()), service_contracts.org_id))
  with check (public.has_org_membership((select auth.uid()), service_contracts.org_id));

create policy service_contracts_delete on public.service_contracts
  for delete to authenticated
  using  (public.has_org_membership((select auth.uid()), service_contracts.org_id));

commit;

notify pgrst, 'reload schema';
