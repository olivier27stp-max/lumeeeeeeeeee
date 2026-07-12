-- ════════════════════════════════════════════════════════════════════════
-- Numérotation automatique des clients — par organisation, atomique
-- ════════════════════════════════════════════════════════════════════════
-- Les jobs, soumissions et factures ont déjà un # séquentiel par org; les
-- clients n'en avaient aucun. On réplique le pattern des jobs
-- (20260708000000_jobs_auto_number_per_org.sql) :
--   • clients.client_number (text) + compteur org_client_counters
--   • trigger BEFORE INSERT = source unique d'attribution, peu importe le
--     chemin de création (form /clients/new, quick-create, requests, D2D…)
--   • un numéro fourni manuellement est respecté et avance le compteur
--   • backfill des clients existants dans l'ordre de création
--   • rpc_peek_next_numbers expose « client » pour le pré-remplissage du form
--   • create_client_with_duplicate_handling accepte/valide client_number
--
-- Idempotent et sûr à re-exécuter.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Colonne + compteur séquentiel par organisation ───────────────────────
alter table public.clients
  add column if not exists client_number text null;

comment on column public.clients.client_number is
  'Numéro séquentiel par org, attribué par trigger (assign_client_number); modifiable à la création.';

create table if not exists public.org_client_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- Accès direct interdit aux clients : seule la fonction SECURITY DEFINER y écrit.
alter table public.org_client_counters enable row level security;

-- 2. Fonction d'attribution (atomique, par org) ───────────────────────────
create or replace function public.assign_client_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  -- Pas d'org résolvable : on laisse les autres contraintes décider.
  if v_org is null then
    return new;
  end if;

  -- Numéro fourni explicitement : on le respecte, mais on garde le compteur
  -- en avance pour qu'un futur numéro auto n'entre jamais en collision.
  if new.client_number is not null and btrim(new.client_number) <> '' then
    if new.client_number ~ '^\s*\d+$' then
      insert into public.org_client_counters (org_id, last_number)
      values (v_org, btrim(new.client_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  -- Attribution séquentielle atomique : l'upsert verrouille la ligne de l'org.
  insert into public.org_client_counters (org_id, last_number)
  values (v_org, 1)
  on conflict (org_id) do update
    set last_number = public.org_client_counters.last_number + 1,
        updated_at  = now()
  returning last_number into v_next;

  new.client_number := v_next::text;
  return new;
end;
$$;

-- 3. Trigger BEFORE INSERT ────────────────────────────────────────────────
--    Nommé "zz" pour s'exécuter après tout trigger de scope (ordre alpha).
drop trigger if exists trg_clients_zz_assign_number on public.clients;
create trigger trg_clients_zz_assign_number
  before insert on public.clients
  for each row execute function public.assign_client_number();

-- 4. Backfill des clients existants sans numéro ───────────────────────────
--    Dans l'ordre de création, en continuant après le max existant par org.
with maxes as (
  select org_id,
         coalesce(max(nullif(regexp_replace(client_number, '\D', '', 'g'), '')::bigint), 0) as mx
  from public.clients
  where client_number is not null and client_number ~ '\d'
  group by org_id
),
to_fill as (
  select c.id, c.org_id,
         row_number() over (partition by c.org_id order by c.created_at nulls first, c.id) as rn
  from public.clients c
  where c.client_number is null or btrim(c.client_number) = ''
)
update public.clients c
set client_number = (coalesce(m.mx, 0) + tf.rn)::text
from to_fill tf
left join maxes m on m.org_id = tf.org_id
where c.id = tf.id;

-- 5. (Ré)initialiser le compteur sur le max courant par org ───────────────
insert into public.org_client_counters (org_id, last_number)
select org_id,
       max(nullif(regexp_replace(client_number, '\D', '', 'g'), '')::bigint)
from public.clients
where client_number is not null and client_number ~ '\d'
group by org_id
on conflict (org_id) do update
  set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
      updated_at  = now();

-- 6. Filet de sécurité : index unique (org_id, client_number) actifs ──────
do $$
begin
  begin
    create unique index if not exists clients_org_client_number_uniq
      on public.clients (org_id, client_number)
      where client_number is not null and deleted_at is null;
  exception when others then
    raise notice 'Index clients_org_client_number_uniq non créé (doublons hérités ?): %', sqlerrm;
  end;
end$$;

-- 7. clients_active doit exposer la nouvelle colonne ──────────────────────
--    (vue select * figée à la création — on la recrée; security_invoker
--    préservé pour que les lectures respectent la RLS de l'appelant)
create or replace view public.clients_active with (security_invoker = true) as
  select * from public.clients where deleted_at is null;

grant select on public.clients_active to authenticated, anon;

-- 8. rpc_peek_next_numbers : ajoute « client » ────────────────────────────
--    Guards idempotents au cas où 20260708/20260716 ne sont pas appliquées
--    dans un environnement (la fonction référence ces tables).
create table if not exists public.org_job_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.org_job_counters enable row level security;

create or replace function public.rpc_peek_next_numbers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid := public.current_org_id();
  v_job        bigint;
  v_quote      bigint;
  v_inv        bigint;
  v_client     bigint;
  v_inv_prefix text;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;

  -- Prefix de facture configurable (20260711140000); défaut 'INV-' si la
  -- colonne/ligne n'existe pas encore.
  begin
    select coalesce(nullif(trim(invoice_prefix), ''), 'INV-') into v_inv_prefix
    from public.company_settings where org_id = v_org;
  exception when others then v_inv_prefix := null; end;
  v_inv_prefix := coalesce(v_inv_prefix, 'INV-');

  select greatest(
    coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
              from public.jobs j
              where j.org_id = v_org and j.job_number ~ '\d'), 0)
  ) + 1 into v_job;

  select greatest(
    coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
              from public.quotes q
              where q.org_id = v_org and q.quote_number ~ '\d'), 0)
  ) + 1 into v_quote;

  select greatest(
    coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
              from public.invoices i
              where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
  ) + 1 into v_inv;

  select greatest(
    coalesce((select c.last_number from public.org_client_counters c where c.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
              from public.clients cl
              where cl.org_id = v_org and cl.client_number ~ '\d'), 0)
  ) + 1 into v_client;

  return jsonb_build_object(
    'job', v_job::text,
    'quote', v_quote::text,
    'invoice_seq', v_inv,
    'invoice', v_inv_prefix || lpad(v_inv::text, 6, '0'),
    'client', v_client::text
  );
end;
$$;

-- 9. create_client_with_duplicate_handling : accepte client_number ────────
--    Même règle que jobs/soumissions/factures : numérique obligatoire,
--    jamais au-delà du prochain numéro disponible, jamais déjà pris.
--    Signature inchangée (payload jsonb) → pas de drop nécessaire.
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
  -- client number (optionnel — le trigger attribue le suivant si absent)
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

  -- client_number fourni : numérique, ≤ prochain disponible, pas déjà pris
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

  -- replace : le client existant garde son client_number (jamais réécrit)
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

notify pgrst, 'reload schema';
