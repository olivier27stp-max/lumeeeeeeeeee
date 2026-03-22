-- ============================================================================
-- Add structured address fields to jobs table.
-- Jobs already have: property_address (text), latitude, longitude, geocode_status.
-- This adds street-level fields to match clients table structure.
-- ============================================================================

-- Add structured address columns (all nullable for now to avoid breaking existing rows)
alter table public.jobs add column if not exists address_line1 text;
alter table public.jobs add column if not exists address_line2 text;
alter table public.jobs add column if not exists city text;
alter table public.jobs add column if not exists province text;
alter table public.jobs add column if not exists postal_code text;
alter table public.jobs add column if not exists country text default 'Canada';
alter table public.jobs add column if not exists place_id text;

-- Backfill: copy property_address into address_line1 for existing rows that have it
update public.jobs
  set address_line1 = property_address
  where property_address is not null
    and property_address <> ''
    and property_address <> '-'
    and address_line1 is null;

-- Index for place_id dedup (matches clients pattern)
create index if not exists idx_jobs_org_place_id on public.jobs (org_id, place_id) where place_id is not null;

-- Comment explaining the fields
comment on column public.jobs.address_line1 is 'Primary street address for the job site';
comment on column public.jobs.city is 'City of the job site';
comment on column public.jobs.province is 'Province/state of the job site';
comment on column public.jobs.postal_code is 'Postal/zip code';
comment on column public.jobs.country is 'Country (default Canada)';
comment on column public.jobs.place_id is 'Google Places ID for address dedup';
