-- =====================================================================
-- Email consent tracking — 2026-04-21
-- Gap résiduel : CASL + RGPD (consentement marketing email manquait)
-- Parité avec sms_consent_at déjà présent sur clients.
-- =====================================================================

-- 1. Colonnes consent/opt-out sur clients & leads
alter table public.clients
  add column if not exists email_consent_at      timestamptz,
  add column if not exists email_opt_out_at      timestamptz,
  add column if not exists email_opt_out_reason  text;

alter table public.leads
  add column if not exists email_consent_at      timestamptz,
  add column if not exists email_opt_out_at      timestamptz,
  add column if not exists email_opt_out_reason  text;

comment on column public.clients.email_consent_at is
  'Horodatage du consentement explicite pour le marketing courriel (CASL/RGPD). Null = pas de consentement.';
comment on column public.clients.email_opt_out_at is
  'Horodatage du retrait de consentement. Non-null = ne pas envoyer de marketing courriel.';

-- 2. Table email_opt_outs (parité sms_opt_outs, pour historique global indépendant des clients)
create table if not exists public.email_opt_outs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references public.orgs(id) on delete cascade,
  email          text not null,
  opted_out_at   timestamptz not null default now(),
  reason         text,
  unique (org_id, email)
);

create index if not exists idx_email_opt_outs_email on public.email_opt_outs(email);

alter table public.email_opt_outs enable row level security;

drop policy if exists email_opt_outs_service on public.email_opt_outs;
create policy email_opt_outs_service on public.email_opt_outs
  for all to service_role using (true) with check (true);

drop policy if exists email_opt_outs_select_org on public.email_opt_outs;
create policy email_opt_outs_select_org on public.email_opt_outs for select
  using (org_id is null or public.has_org_membership(auth.uid(), org_id));

-- 3. RPC : record_email_opt_out
create or replace function public.record_email_opt_out(
  p_email text, p_org_id uuid default null, p_reason text default null
) returns void
language sql
security definer
set search_path = public, pg_temp
as $FUNC$
  insert into public.email_opt_outs(org_id, email, reason)
  values (p_org_id, lower(trim(p_email)), p_reason)
  on conflict (org_id, email) do update set opted_out_at = now(), reason = excluded.reason;

  update public.clients set email_opt_out_at = now(), email_opt_out_reason = p_reason
   where lower(email) = lower(trim(p_email))
     and (p_org_id is null or org_id = p_org_id);

  update public.leads set email_opt_out_at = now(), email_opt_out_reason = p_reason
   where lower(email) = lower(trim(p_email))
     and (p_org_id is null or org_id = p_org_id);
$FUNC$;

revoke all on function public.record_email_opt_out(text, uuid, text) from public;
grant execute on function public.record_email_opt_out(text, uuid, text) to authenticated, service_role;

-- 4. Helper: is_email_opted_out
create or replace function public.is_email_opted_out(p_email text, p_org_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $FUNC$
  select exists (
    select 1 from public.email_opt_outs
     where email = lower(trim(p_email))
       and (p_org_id is null or org_id = p_org_id or org_id is null)
  );
$FUNC$;

revoke all on function public.is_email_opted_out(text, uuid) from public;
grant execute on function public.is_email_opted_out(text, uuid) to authenticated, service_role;
