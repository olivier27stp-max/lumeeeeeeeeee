-- Fix cohérence : create_client_with_duplicate_handling référençait la table
-- leads (supprimée) => la fusion de doublons échouait avec 42P01. Retrait des
-- 2 UPDATE public.leads morts (repointage deja fait via pipeline_deals). 2026-08-02.

CREATE OR REPLACE FUNCTION public.create_client_with_duplicate_handling(p_org_id uuid, p_mode text, p_payload jsonb, p_merge_duplicates boolean DEFAULT true)
 RETURNS clients
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_street_number text := nullif(trim(coalesce(p_payload->>'street_number', '')), '');
  v_street_name text := nullif(trim(coalesce(p_payload->>'street_name', '')), '');
  v_city text := nullif(trim(coalesce(p_payload->>'city', '')), '');
  v_province text := nullif(trim(coalesce(p_payload->>'province', '')), '');
  v_postal_code text := nullif(trim(coalesce(p_payload->>'postal_code', '')), '');
  v_country text := nullif(trim(coalesce(p_payload->>'country', '')), '');
  v_latitude numeric := null;
  v_longitude numeric := null;
  v_place_id text := nullif(trim(coalesce(p_payload->>'place_id', '')), '');
  v_billing_same boolean := coalesce((p_payload->>'billing_same_as_service')::boolean, true);
  v_billing_address text := nullif(trim(coalesce(p_payload->>'billing_address', '')), '');
  v_phones jsonb := case when jsonb_typeof(p_payload->'phones') = 'array' then p_payload->'phones' else '[]'::jsonb end;
  v_email_label text := coalesce(nullif(trim(coalesce(p_payload->>'email_label', '')), ''), 'main');
  v_lead_source text := nullif(trim(coalesce(p_payload->>'lead_source', '')), '');
  v_tax_ids uuid[] := null;
  v_client_number text := nullif(trim(coalesce(p_payload->>'client_number', '')), '');
  v_next_number bigint;
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

  if v_client_number is not null then
    if v_client_number !~ '^\d+$' then
      raise exception 'Invalid client number "%"', v_client_number using errcode = '22023';
    end if;

    select greatest(
      coalesce((select c.last_number from public.org_client_counters c where c.org_id = p_org_id), 0),
      coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
                from public.clients cl
                where cl.org_id = p_org_id and cl.client_number ~ '\d'), 0)
    ) + 1 into v_next_number;

    if v_client_number::bigint > v_next_number then
      raise exception 'Client number % does not exist yet (next available is %)',
        v_client_number, v_next_number using errcode = '22023';
    end if;

    if exists (
      select 1 from public.clients c
      where c.org_id = p_org_id
        and c.deleted_at is null
        and c.client_number = v_client_number
    ) then
      raise exception 'Client number % is already in use', v_client_number using errcode = '23505';
    end if;
  end if;

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
      billing_same_as_service, billing_address, phones, email_label, lead_source, tax_ids, client_number,
      created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company,
      v_street_number, v_street_name, v_city, v_province, v_postal_code, v_country, v_latitude, v_longitude, v_place_id,
      v_billing_same, v_billing_address, v_phones, v_email_label, v_lead_source, v_tax_ids, v_client_number,
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
      billing_same_as_service, billing_address, phones, email_label, lead_source, tax_ids, client_number,
      created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company,
      v_street_number, v_street_name, v_city, v_province, v_postal_code, v_country, v_latitude, v_longitude, v_place_id,
      v_billing_same, v_billing_address, v_phones, v_email_label, v_lead_source, v_tax_ids, v_client_number,
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

      -- (retiré 2026-08-02) update public.leads : la table leads a été supprimée
      -- (modèle migré vers pipeline_deals). Ces UPDATE faisaient échouer la fusion
      -- de doublons avec 42P01. Le repointage des deals est fait ci-dessus.

      delete from public.clients
      where org_id = p_org_id
        and id = v_dup.id;
    end loop;
  end if;

  return v_primary;
end;
$function$
