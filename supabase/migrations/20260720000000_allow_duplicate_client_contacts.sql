-- ════════════════════════════════════════════════════════════════════
-- Allow distinct clients sharing a phone number or email
-- ────────────────────────────────────────────────────────────────────
-- Product decision (2026-07-07): two different people must remain two
-- distinct client records even when they share a phone or an email
-- (couples, landlords/tenants, test data…). Inbound flows no longer
-- resolve to an existing client (see ensureClientForLead); the DB-level
-- uniqueness that enforced one-client-per-phone/email is removed.
--
-- Every drop is IF EXISTS: index names varied across environments and
-- some were already removed (see complete_schema.sql "Keep duplicate
-- emails allowed" section) — this is a catch-all cleanup.
-- ════════════════════════════════════════════════════════════════════

begin;

-- one active client per normalized phone per org (captured in 20260711000000)
drop index if exists public.uq_clients_org_phone_notnull;

-- historical email uniqueness, by every name it ever had
drop index if exists public.uq_clients_org_email;
drop index if exists public.clients_email_key;
drop index if exists public.clients_org_id_email_key;
drop index if exists public.clients_org_email_unique;

-- keep fast (non-unique) lookups for search / duplicate warnings in the UI
create index if not exists idx_clients_org_lower_email_active
  on public.clients (org_id, lower(email))
  where email is not null and deleted_at is null;

create index if not exists idx_clients_org_phone_digits_active
  on public.clients (org_id, regexp_replace(phone, '[^0-9]+', '', 'g'))
  where phone is not null and deleted_at is null;

commit;

notify pgrst, 'reload schema';
