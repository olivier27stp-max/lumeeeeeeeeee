-- Quote service plans + agreements on quotes
-- 1) quotes.quote_type ('one_off' | 'service_plan') + quotes.service_plan jsonb
--    service_plan shape: { "year": 2026, "visits": [{ "month": 5, "date": "2026-05-04" }] }
-- 2) job_agreements gains quote_id so the exact same agreement feature
--    (public /contract/:token page, signature, snapshot) works for quotes.
--    Requires 20260721000000_job_agreements.sql to be applied first.

-- ── Quotes: type + service plan ──
alter table public.quotes
  add column if not exists quote_type text not null default 'one_off';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_quote_type_check'
  ) then
    alter table public.quotes
      add constraint quotes_quote_type_check
      check (quote_type in ('one_off', 'service_plan'));
  end if;
end $$;

alter table public.quotes
  add column if not exists service_plan jsonb;

-- ── Agreements: attach to a quote OR a job ──
alter table public.job_agreements
  add column if not exists quote_id uuid references public.quotes(id) on delete cascade;

alter table public.job_agreements
  alter column job_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_agreements_entity_check'
  ) then
    alter table public.job_agreements
      add constraint job_agreements_entity_check
      check (job_id is not null or quote_id is not null);
  end if;
end $$;

create index if not exists idx_job_agreements_quote_id
  on public.job_agreements(quote_id);
