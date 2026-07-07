-- ════════════════════════════════════════════════════════════════════
-- New Client full-page form: contact labels, lead source, per-client taxes
-- ────────────────────────────────────────────────────────────────────
-- The /clients/new full-page form captures richer contact data than the
-- old quick-create modal:
--   • several phone numbers, each with a label (work/mobile/home/fax/other)
--   • an email label (main/work/personal/other)
--   • a lead source, from an org-level list (defaults + custom entries)
--   • the taxes applied to the client by default (null = org defaults)
--   • a billing address distinct from the property address
--
-- `clients.phone` keeps mirroring the primary (first) number so search,
-- duplicate warnings and every existing screen keep working unchanged.
--
-- Idempotent and safe to re-run.
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. clients: new capture columns -------------------------------------
alter table public.clients
  add column if not exists phones jsonb not null default '[]'::jsonb,
  add column if not exists email_label text not null default 'main',
  add column if not exists lead_source text null,
  add column if not exists tax_ids uuid[] null;

comment on column public.clients.phones is
  'All phone numbers as [{"number","label"}] (label: work/mobile/home/fax/other); clients.phone mirrors the first entry.';
comment on column public.clients.email_label is
  'Label of the email address: main/work/personal/other.';
comment on column public.clients.lead_source is
  'How the client heard about the business (org lead-source list, free text).';
comment on column public.clients.tax_ids is
  'tax_configs ids applied to this client by default; null = follow the org''s default taxes.';

-- Belt-and-braces: the form also writes these columns (introduced by
-- 20260308120000 and 20260706000000); re-declare in case an environment
-- missed those migrations. No-ops where already applied.
alter table public.clients
  add column if not exists street_number text null,
  add column if not exists street_name   text null,
  add column if not exists city          text null,
  add column if not exists province      text null,
  add column if not exists postal_code   text null,
  add column if not exists country       text null,
  add column if not exists latitude      numeric null,
  add column if not exists longitude     numeric null,
  add column if not exists place_id      text null,
  add column if not exists billing_same_as_service boolean not null default true,
  add column if not exists billing_address text null;

-- 2. lead_sources: per-org custom sources ------------------------------
--    Defaults (Existing client, Facebook, Flyer, Google, Instagram, Other,
--    Referral, Vehicle wrap) live in the app; this table only stores the
--    sources created via "Create new lead source".
create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

alter table public.lead_sources enable row level security;

drop policy if exists lead_sources_select on public.lead_sources;
create policy lead_sources_select on public.lead_sources
  for select
  using (public.has_org_membership((select auth.uid()), lead_sources.org_id));

drop policy if exists lead_sources_insert on public.lead_sources;
create policy lead_sources_insert on public.lead_sources
  for insert
  with check (public.has_org_membership((select auth.uid()), lead_sources.org_id));

drop policy if exists lead_sources_update on public.lead_sources;
create policy lead_sources_update on public.lead_sources
  for update
  using  (public.has_org_membership((select auth.uid()), lead_sources.org_id))
  with check (public.has_org_membership((select auth.uid()), lead_sources.org_id));

drop policy if exists lead_sources_delete on public.lead_sources;
create policy lead_sources_delete on public.lead_sources
  for delete
  using (public.has_org_membership((select auth.uid()), lead_sources.org_id));

grant select, insert, update, delete on public.lead_sources to authenticated;

-- 3. clients_active exposes the new columns ----------------------------
--    (security_invoker preserved — reads respect the querying user's RLS)
create or replace view public.clients_active with (security_invoker = true) as
  select * from public.clients where deleted_at is null;

grant select on public.clients_active to authenticated, anon;

-- 4. Teach the create RPC the new fields --------------------------------
--    Also passes through the structured-address and billing fields the app
--    already sends but the previous version silently dropped.
create or replace function public.create_client_with_duplicate_handling(
  p_org_id uuid,
  p_mode text,
  p_payload jsonb,
  p_merge_duplicates boolean default true
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := lower(coalesce(trim(p_mode), 'add'));
  v_first_name text := nullif(trim(coalesce(p_payload->>'first_name', '')), '');
  v_last_name text := nullif(trim(coalesce(p_payload->>'last_name', '')), '');
  v_company text := nullif(trim(coalesce(p_payload->>'company', '')), '');
  v_email text := nullif(trim(coalesce(p_payload->>'email', '')), '');
  v_phone text := nullif(trim(coalesce(p_payload->>'phone', '')), '');
  v_address text := nullif(trim(coalesce(p_payload->>'address', '')), '');
  v_status text := coalesce(nullif(trim(p_payload->>'status'), ''), 'active');
  v_display_as_company boolean := coalesce((p_payload->>'display_as_company')::boolean, false);
  -- structured address (Google Places)
  v_street_number text := nullif(trim(coalesce(p_payload->>'street_number', '')), '');
  v_street_name text := nullif(trim(coalesce(p_payload->>'street_name', '')), '');
  v_city text := nullif(trim(coalesce(p_payload->>'city', '')), '');
  v_province text := nullif(trim(coalesce(p_payload->>'province', '')), '');
  v_postal_code text := nullif(trim(coalesce(p_payload->>'postal_code', '')), '');
  v_country text := nullif(trim(coalesce(p_payload->>'country', '')), '');
  v_latitude numeric := null;
  v_longitude numeric := null;
  v_place_id text := nullif(trim(coalesce(p_payload->>'place_id', '')), '');
  -- billing address
  v_billing_same boolean := coalesce((p_payload->>'billing_same_as_service')::boolean, true);
  v_billing_address text := nullif(trim(coalesce(p_payload->>'billing_address', '')), '');
  -- new-client-form fields
  v_phones jsonb := case when jsonb_typeof(p_payload->'phones') = 'array' then p_payload->'phones' else '[]'::jsonb end;
  v_email_label text := coalesce(nullif(trim(coalesce(p_payload->>'email_label', '')), ''), 'main');
  v_lead_source text := nullif(trim(coalesce(p_payload->>'lead_source', '')), '');
  v_tax_ids uuid[] := null;
  v_primary public.clients%rowtype;
  v_dup record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  -- numeric/uuid payload fields: ignore malformed values instead of failing
  begin
    v_latitude := (p_payload->>'latitude')::numeric;
  exception when others then v_latitude := null; end;
  begin
    v_longitude := (p_payload->>'longitude')::numeric;
  exception when others then v_longitude := null; end;
  begin
    if jsonb_typeof(p_payload->'tax_ids') = 'array' then
      select array(select value::uuid from jsonb_array_elements_text(p_payload->'tax_ids'))
        into v_tax_ids;
    end if;
  exception when others then v_tax_ids := null; end;

  if v_first_name is null then
    v_first_name := 'Unknown';
  end if;
  if v_last_name is null then
    v_last_name := 'Client';
  end if;

  if v_mode not in ('add', 'replace') then
    raise exception 'Invalid mode: %', v_mode using errcode = '22023';
  end if;

  if v_mode = 'add' then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, display_as_company,
      street_number, street_name, city, province, postal_code, country, latitude, longitude, place_id,
      billing_same_as_service, billing_address, phones, email_label, lead_source, tax_ids,
      created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company,
      v_street_number, v_street_name, v_city, v_province, v_postal_code, v_country, v_latitude, v_longitude, v_place_id,
      v_billing_same, v_billing_address, v_phones, v_email_label, v_lead_source, v_tax_ids,
      v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  if v_email is null then
    raise exception 'replace mode requires email' using errcode = '22023';
  end if;

  select * into v_primary
  from public.clients c
  where c.org_id = p_org_id
    and c.deleted_at is null
    and lower(coalesce(c.email, '')) = lower(v_email)
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_primary.id is null then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, display_as_company,
      street_number, street_name, city, province, postal_code, country, latitude, longitude, place_id,
      billing_same_as_service, billing_address, phones, email_label, lead_source, tax_ids,
      created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company,
      v_street_number, v_street_name, v_city, v_province, v_postal_code, v_country, v_latitude, v_longitude, v_place_id,
      v_billing_same, v_billing_address, v_phones, v_email_label, v_lead_source, v_tax_ids,
      v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  update public.clients
  set
    first_name = v_first_name,
    last_name = v_last_name,
    company = v_company,
    email = v_email,
    phone = v_phone,
    address = v_address,
    status = v_status,
    display_as_company = v_display_as_company,
    street_number = v_street_number,
    street_name = v_street_name,
    city = v_city,
    province = v_province,
    postal_code = v_postal_code,
    country = v_country,
    latitude = v_latitude,
    longitude = v_longitude,
    place_id = v_place_id,
    billing_same_as_service = v_billing_same,
    billing_address = v_billing_address,
    phones = v_phones,
    email_label = v_email_label,
    lead_source = v_lead_source,
    tax_ids = v_tax_ids,
    updated_at = now()
  where id = v_primary.id
  returning * into v_primary;

  if p_merge_duplicates then
    for v_dup in
      select c.id
      from public.clients c
      where c.org_id = p_org_id
        and c.deleted_at is null
        and lower(coalesce(c.email, '')) = lower(v_email)
        and c.id <> v_primary.id
      order by c.created_at asc, c.id asc
    loop
      update public.jobs
      set client_id = v_primary.id, updated_at = now()
      where org_id = p_org_id and client_id = v_dup.id;

      if to_regclass('public.invoices') is not null then
        begin
          execute 'update public.invoices set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      if to_regclass('public.payments') is not null then
        begin
          execute 'update public.payments set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      update public.pipeline_deals
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set converted_to_client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and converted_to_client_id = v_dup.id;

      delete from public.clients
      where org_id = p_org_id
        and id = v_dup.id;
    end loop;
  end if;

  return v_primary;
end;
$$;

revoke all on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) from public;
grant execute on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
