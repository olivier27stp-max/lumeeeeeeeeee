-- Client billing address
-- ───────────────────────────────────────────────────────────────────
-- A client's billing address defaults to its service (property) address.
-- When `billing_same_as_service` is false, `billing_address` holds a distinct
-- billing address that must be used on invoices.

alter table public.clients
  add column if not exists billing_same_as_service boolean not null default true;

alter table public.clients
  add column if not exists billing_address text null;
