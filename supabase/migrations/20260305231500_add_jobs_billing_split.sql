alter table if exists public.jobs
  add column if not exists billing_split boolean not null default false;
