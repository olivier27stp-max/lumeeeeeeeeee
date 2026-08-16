-- Description libre par ligne de produit/service d'un job.
-- Parité avec quote_line_items.description : la ligne garde le texte descriptif
-- du catalogue (predefined_services.description) ou celui saisi dans le form.
alter table public.job_line_items add column if not exists description text;
