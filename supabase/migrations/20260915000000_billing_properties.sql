-- ════════════════════════════════════════════════════════════════════
-- Adresse de facturation = entité « propriété » (properties.kind = 'billing')
-- ────────────────────────────────────────────────────────────────────
-- Avant : l'adresse de facturation d'un client était un simple texte libre
-- (clients.billing_address) à côté du toggle clients.billing_same_as_service,
-- sans ville/code postal/géo, sans historique sur les factures, et
-- impossible à importer comme entité dans la migration assistée.
--
-- Après :
--   • properties.kind ∈ ('service','billing'). Au plus UNE propriété de
--     facturation active par client. Une propriété de facturation n'est
--     jamais « principale » (is_primary) : les jobs/soumissions/factures
--     continuent de se rattacher à une adresse de SERVICE.
--   • clients.billing_address reste, en MIROIR (lecture) de la propriété de
--     facturation : tout code qui le lit reste correct.
--       - properties(billing) insert/update/soft-delete → clients.billing_address
--       - clients.billing_address posé par une RPC/l'agent → propriété créée
--         ou alignée (filet de sécurité, même esprit que
--         clients_auto_property_from_address).
--   • invoices.billing_address_snapshot : figé à la création de la facture
--     (set_invoice_client_snapshot) — modifier le client ne réécrit plus
--     l'adresse des factures déjà émises.
--   • Backfill : une propriété de facturation par client qui avait déjà
--     une adresse de facturation distincte.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 1. kind sur properties ──────────────────────────────────────────
alter table public.properties
  add column if not exists kind text not null default 'service';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_kind_check') then
    alter table public.properties
      add constraint properties_kind_check check (kind in ('service', 'billing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_billing_not_primary') then
    alter table public.properties
      add constraint properties_billing_not_primary check (kind = 'service' or is_primary = false);
  end if;
end $$;

-- au plus une adresse de facturation active par client
create unique index if not exists uq_properties_billing_per_client
  on public.properties (client_id) where kind = 'billing' and deleted_at is null;

-- ── 2. ligne d'adresse d'une propriété (texte, pour le miroir) ──────
create or replace function public.property_address_line(
  p_address text, p_street_number text, p_street_name text,
  p_city text, p_province text, p_postal_code text
) returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', p_street_number, p_street_name)), ''),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_province, '')), ''),
      nullif(btrim(coalesce(p_postal_code, '')), '')
    )), '')
  )
$$;

-- ── 3. la propriété par défaut d'un client est toujours une adresse de SERVICE
create or replace function public.resolve_primary_property(p_client_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.properties p
  where p.client_id = p_client_id
    and p.deleted_at is null
    and p.kind = 'service'
  order by p.is_primary desc, p.created_at asc
  limit 1
$$;

-- idem pour le filet « adresse client → propriété principale » : une adresse
-- de facturation seule ne doit pas empêcher la création de la propriété de service
create or replace function public.clients_auto_property_from_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null then return new; end if;
  if new.address is null or btrim(new.address) = '' then return new; end if;
  if tg_op = 'UPDATE' and old.address is not distinct from new.address then return new; end if;
  if exists (
    select 1 from public.properties p
    where p.client_id = new.id and p.deleted_at is null and p.kind = 'service'
  ) then
    return new;
  end if;
  insert into public.properties (org_id, client_id, name, address, kind, is_primary, created_by)
  values (
    new.org_id,
    new.id,
    'Adresse principale',
    btrim(new.address),
    'service',
    true,
    coalesce(new.created_by, gen_random_uuid())
  )
  on conflict do nothing;
  return new;
end;
$$;

-- ── 4. miroir properties(billing) → clients.billing_address ─────────
create or replace function public.properties_billing_mirror_to_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line text;
begin
  if new.kind <> 'billing' then return new; end if;

  if new.deleted_at is not null then
    -- adresse de facturation retirée : plus rien à refléter
    update public.clients
       set billing_address = null
     where id = new.client_id and billing_address is not null;
    return new;
  end if;

  v_line := public.property_address_line(
    new.address, new.street_number, new.street_name, new.city, new.province, new.postal_code
  );

  if tg_op = 'INSERT' then
    -- créer une adresse de facturation = facturer à cette adresse
    update public.clients
       set billing_address = v_line,
           billing_same_as_service = false
     where id = new.client_id
       and (billing_address is distinct from v_line or billing_same_as_service);
  else
    update public.clients
       set billing_address = v_line
     where id = new.client_id and billing_address is distinct from v_line;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_properties_billing_mirror on public.properties;
create trigger trg_properties_billing_mirror
  after insert or update of address, street_number, street_name, city, province, postal_code, deleted_at, kind
  on public.properties
  for each row execute function public.properties_billing_mirror_to_client();

-- ── 5. filet inverse : clients.billing_address (RPC, agent, formulaire) → propriété
create or replace function public.clients_auto_billing_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
begin
  if new.deleted_at is not null then return new; end if;
  if new.billing_same_as_service then return new; end if;
  v_text := nullif(btrim(coalesce(new.billing_address, '')), '');
  if v_text is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.billing_address is not distinct from new.billing_address
     and old.billing_same_as_service is not distinct from new.billing_same_as_service then
    return new;
  end if;

  if exists (
    select 1 from public.properties p
    where p.client_id = new.id and p.kind = 'billing' and p.deleted_at is null
  ) then
    -- le texte a changé côté client : on aligne la propriété (sans boucle : si la
    -- ligne calculée est déjà identique, aucune écriture)
    update public.properties p
       set address = v_text,
           street_number = null, street_name = null, city = null, province = null,
           postal_code = null, country = null, latitude = null, longitude = null, place_id = null
     where p.client_id = new.id and p.kind = 'billing' and p.deleted_at is null
       and public.property_address_line(p.address, p.street_number, p.street_name, p.city, p.province, p.postal_code)
           is distinct from v_text;
    return new;
  end if;

  insert into public.properties (org_id, client_id, name, address, kind, is_primary, created_by)
  values (
    new.org_id, new.id, 'Adresse de facturation', v_text, 'billing', false,
    coalesce(new.created_by, gen_random_uuid())
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_clients_auto_billing_property on public.clients;
create trigger trg_clients_auto_billing_property
  after insert or update of billing_address, billing_same_as_service on public.clients
  for each row execute function public.clients_auto_billing_property();

-- ── 6. backfill : une propriété de facturation par adresse distincte existante
insert into public.properties (org_id, client_id, name, address, kind, is_primary, created_by)
select
  c.org_id,
  c.id,
  'Adresse de facturation',
  btrim(c.billing_address),
  'billing',
  false,
  coalesce(c.created_by, gen_random_uuid())
from public.clients c
where c.deleted_at is null
  and c.billing_same_as_service = false
  and c.billing_address is not null
  and btrim(c.billing_address) <> ''
  and not exists (
    select 1 from public.properties p
    where p.client_id = c.id and p.kind = 'billing' and p.deleted_at is null
  );

-- ── 7. snapshot de l'adresse de facturation sur la facture ──────────
alter table public.invoices
  add column if not exists billing_address_snapshot text;

create or replace function public.set_invoice_client_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_email text;
  v_property_id uuid;
begin
  if new.client_id is not null and (new.client_name_snapshot is null or new.client_name_snapshot = '') then
    select
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(c.company, ''),
        'Unknown client'
      ),
      c.email
    into v_name, v_email
    from public.clients c
    where c.id = new.client_id;

    new.client_name_snapshot  := coalesce(new.client_name_snapshot,  v_name);
    new.client_email_snapshot := coalesce(new.client_email_snapshot, v_email);
  end if;

  -- Adresse de facturation figée à la création : propriété de facturation du
  -- client si elle facture à une adresse distincte, sinon l'adresse de SERVICE
  -- de la facture (propriété liée → propriété du job → propriété principale),
  -- sinon l'adresse texte héritée du client.
  if new.client_id is not null and new.billing_address_snapshot is null then
    select public.property_address_line(p.address, p.street_number, p.street_name, p.city, p.province, p.postal_code)
      into new.billing_address_snapshot
    from public.clients c
    join public.properties p on p.client_id = c.id and p.kind = 'billing' and p.deleted_at is null
    where c.id = new.client_id and c.billing_same_as_service = false;

    if new.billing_address_snapshot is null then
      v_property_id := new.property_id;
      if v_property_id is null and new.job_id is not null then
        select j.property_id into v_property_id from public.jobs j where j.id = new.job_id;
      end if;
      if v_property_id is null then
        v_property_id := public.resolve_primary_property(new.client_id);
      end if;
      if v_property_id is not null then
        select public.property_address_line(p.address, p.street_number, p.street_name, p.city, p.province, p.postal_code)
          into new.billing_address_snapshot
        from public.properties p where p.id = v_property_id and p.deleted_at is null;
      end if;
    end if;

    if new.billing_address_snapshot is null then
      select nullif(btrim(coalesce(c.address, '')), '')
        into new.billing_address_snapshot
      from public.clients c where c.id = new.client_id;
    end if;
  end if;

  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
