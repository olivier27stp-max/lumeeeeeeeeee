-- Réseaux sociaux de l'entreprise (Réglages → Paramètres de l'entreprise).
-- Un seul jsonb plutôt que six colonnes : les clés connues sont
-- facebook, x, instagram, yelp, angi, google_business — chacune une URL
-- absolue https. Les icônes s'affichent au bas des courriels sortants et
-- des pages publiques client (soumission, facture, contrat, paiement).

alter table public.company_settings
  add column if not exists social_links jsonb not null default '{}'::jsonb;

alter table public.company_settings
  drop constraint if exists company_settings_social_links_objet;
alter table public.company_settings
  add constraint company_settings_social_links_objet
  check (jsonb_typeof(social_links) = 'object');

comment on column public.company_settings.social_links is
  'Liens réseaux sociaux {facebook, x, instagram, yelp, angi, google_business} → URL https. Affichés au bas des courriels et des pages publiques client.';
