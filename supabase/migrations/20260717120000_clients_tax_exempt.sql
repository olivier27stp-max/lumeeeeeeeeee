-- Client exonéré de taxes (gouvernements, Premières Nations, OSBL…).
-- /taxes/resolve retourne alors zéro taxe pour les devis/jobs/factures du client.
alter table public.clients
  add column if not exists tax_exempt boolean not null default false;
