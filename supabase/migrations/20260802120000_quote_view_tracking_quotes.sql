-- Suivi d'ouverture des DEVIS — les colonnes n'existaient que sur invoices,
-- le /track-view public 404ait pour tous les devis.
alter table public.quotes
  add column if not exists is_viewed boolean not null default false,
  add column if not exists viewed_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists view_count integer not null default 0;

-- Journal détaillé: quote_views était réservé aux factures (FK invoice_id
-- NOT NULL); on l'ouvre aux devis.
alter table public.quote_views
  add column if not exists quote_id uuid references public.quotes(id) on delete cascade;
alter table public.quote_views alter column invoice_id drop not null;
create index if not exists idx_quote_views_quote on public.quote_views(quote_id, viewed_at desc);
