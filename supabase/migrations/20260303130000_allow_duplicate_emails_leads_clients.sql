begin;

-- Allow duplicate emails for leads and clients inside the same org.
-- Drop known unique indexes/constraints created across previous migrations.

drop index if exists public.uq_leads_org_email;
drop index if exists public.uq_leads_org_email_notnull;
drop index if exists public.uq_clients_org_email;
drop index if exists public.uq_clients_org_email_notnull;

alter table public.leads drop constraint if exists uq_leads_org_email;
alter table public.leads drop constraint if exists uq_leads_org_email_notnull;
alter table public.clients drop constraint if exists uq_clients_org_email;
alter table public.clients drop constraint if exists uq_clients_org_email_notnull;

commit;
