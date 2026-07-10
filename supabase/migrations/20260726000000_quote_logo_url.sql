-- Logo affiché sur le devis : null = logo d'entreprise (company_settings),
-- sinon override personnalisé par devis — même comportement que les agreements.
-- Migration séparée de 20260725000000 (service plans + agreements sur quotes)
-- pour que chaque déploiement reste indépendant.

alter table public.quotes
  add column if not exists logo_url text;
