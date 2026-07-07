-- ════════════════════════════════════════════════════════════════════
-- Auto-create a client's primary property from its address
-- ────────────────────────────────────────────────────────────────────
-- Inbound flows (public request form → ensureClientForLead, lead capture,
-- agent tools…) create or update clients with the legacy `address` column
-- but never create a `properties` row, so ClientDetails shows "No
-- properties added yet" even though an address is on file.
--
-- Safety-net trigger (same spirit as trg_jobs_fill_property_id): whenever a
-- client gains an address while having no active property, seed its primary
-- property ("Adresse principale") from that address. One-time backfill
-- included for clients already in that state.
--
-- NOTE: like the 20260707000000 backfill, only the plain-text `address` is
-- copied (this DB's clients table has no structured-address columns); the
-- property's structured/geo fields stay null and can be filled later via
-- the address autocomplete.
-- ════════════════════════════════════════════════════════════════════

begin;

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
    where p.client_id = new.id and p.deleted_at is null
  ) then
    return new;
  end if;
  -- org_id/created_by passed explicitly: server flows run without auth.uid()
  -- and crm_enforce_scope requires them non-null then (see 20260707 backfill).
  insert into public.properties (org_id, client_id, name, address, is_primary, created_by)
  values (
    new.org_id,
    new.id,
    'Adresse principale',
    btrim(new.address),
    true,
    coalesce(new.created_by, gen_random_uuid())
  )
  on conflict do nothing; -- concurrent insert already seeded the primary
  return new;
end;
$$;

drop trigger if exists trg_clients_auto_property on public.clients;
create trigger trg_clients_auto_property
  after insert or update of address on public.clients
  for each row execute function public.clients_auto_property_from_address();

-- ── one-time backfill: address on file but no active property ───────
insert into public.properties (org_id, client_id, name, address, is_primary, created_by)
select
  c.org_id,
  c.id,
  'Adresse principale',
  btrim(c.address),
  true,
  coalesce(c.created_by, gen_random_uuid())
from public.clients c
where c.deleted_at is null
  and c.address is not null
  and btrim(c.address) <> ''
  and not exists (
    select 1 from public.properties p
    where p.client_id = c.id and p.deleted_at is null
  );

commit;

notify pgrst, 'reload schema';
