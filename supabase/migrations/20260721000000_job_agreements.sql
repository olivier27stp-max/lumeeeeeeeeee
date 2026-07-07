-- ════════════════════════════════════════════════════════════════════
-- Job agreements (written contracts)
-- ────────────────────────────────────────────────────────────────────
-- A job can optionally carry a written AGREEMENT: a client-facing contract
-- with the company branding, the job's services/prices/taxes, customizable
-- terms & conditions and an optional required client signature (captured on
-- the public /contract/:view_token page, same pad as quote approval).
--
-- The document is composed live from the job (line items, tax_lines) until
-- it is signed; at signature time the server freezes everything into
-- `snapshot` so the signed contract can never drift from what was signed.
--
--   snapshot jsonb = { items, subtotal_cents, tax_lines, total_cents,
--                      client_name, property_address, company }
--
-- Idempotent — safe to run multiple times.
-- Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260721000000_job_agreements.sql
-- ════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.job_agreements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  job_id            uuid not null references public.jobs(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  require_signature boolean not null default true,
  terms             text not null default '',
  logo_url          text,                          -- null → company_settings.logo_url
  status            text not null default 'draft', -- draft | sent | signed
  view_token        uuid not null default gen_random_uuid(),
  sent_at           timestamptz,
  signer_name       text,
  signature_data    text,                          -- base64 data URL (image/png)
  signed_at         timestamptz,
  snapshot          jsonb,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists idx_job_agreements_org_id on public.job_agreements (org_id);
create index if not exists idx_job_agreements_job_id on public.job_agreements (job_id);
create unique index if not exists idx_job_agreements_view_token on public.job_agreements (view_token);

drop trigger if exists trg_job_agreements_set_updated_at on public.job_agreements;
create trigger trg_job_agreements_set_updated_at
  before update on public.job_agreements
  for each row execute function public.set_updated_at();

-- ── RLS (mirror service_contracts: org members read/write) ──────────
alter table public.job_agreements enable row level security;

drop policy if exists job_agreements_select on public.job_agreements;
drop policy if exists job_agreements_insert on public.job_agreements;
drop policy if exists job_agreements_update on public.job_agreements;
drop policy if exists job_agreements_delete on public.job_agreements;

create policy job_agreements_select on public.job_agreements
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), job_agreements.org_id));

create policy job_agreements_insert on public.job_agreements
  for insert to authenticated
  with check (public.has_org_membership((select auth.uid()), job_agreements.org_id));

create policy job_agreements_update on public.job_agreements
  for update to authenticated
  using  (public.has_org_membership((select auth.uid()), job_agreements.org_id))
  with check (public.has_org_membership((select auth.uid()), job_agreements.org_id));

create policy job_agreements_delete on public.job_agreements
  for delete to authenticated
  using  (public.has_org_membership((select auth.uid()), job_agreements.org_id));

commit;

notify pgrst, 'reload schema';
