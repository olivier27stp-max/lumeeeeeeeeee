-- Désabonnement courriel (CASL / CAN-SPAM)
--
-- Le pendant email de `sms_opt_outs`, qui n'existait pas : les SMS respectent
-- STOP sur les 8 points d'envoi, mais aucun courriel commercial ne portait de
-- lien de désinscription et aucune liste n'était consultée avant l'envoi.
-- Les 23 messages d'automatisation (relances de facture, suivis de soumission,
-- réengagement à 90 jours) sont des communications commerciales au sens de la
-- LCAP : ils exigent un mécanisme de retrait fonctionnel.
--
-- Structure calquée sur `sms_opt_outs` (org_id + destinataire + horodatage +
-- raison), avec deux ajouts :
--   * `token` — permet un lien de désinscription en un clic, sans connexion ;
--   * `category` — un client peut refuser les relances marketing tout en
--     continuant de recevoir ses factures. Les courriels strictement
--     transactionnels (reçu, facture, sécurité) ne consultent pas cette table :
--     c'est légal et attendu.
--
-- Le cloisonnement est par organisation : se désabonner d'un locataire ne
-- coupe pas les communications d'un autre.

create table if not exists public.email_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  -- 'all' couvre toutes les catégories commerciales.
  category text not null default 'all',
  -- Jeton du lien de désinscription : opaque, non devinable, jamais réutilisé.
  token text not null default encode(gen_random_bytes(32), 'hex'),
  unsubscribed_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.email_unsubscribes is
  'Désabonnements courriel par organisation (CASL). Pendant de sms_opt_outs. Les courriels transactionnels ne consultent pas cette table.';
comment on column public.email_unsubscribes.category is
  '''all'' = toutes communications commerciales. Permet un retrait partiel sans couper les courriels transactionnels.';
comment on column public.email_unsubscribes.token is
  'Jeton du lien de désinscription en un clic (aucune authentification requise).';

-- Un seul enregistrement par (org, adresse, catégorie) : le lien peut être
-- cliqué plusieurs fois sans créer de doublon.
create unique index if not exists email_unsubscribes_org_email_category_uq
  on public.email_unsubscribes (org_id, lower(email), category);

-- Chemin de lecture principal : « cette adresse est-elle désabonnée ? », à
-- chaque envoi.
create index if not exists email_unsubscribes_lookup_idx
  on public.email_unsubscribes (org_id, lower(email));

-- Résolution du jeton depuis la route publique de désinscription.
create unique index if not exists email_unsubscribes_token_uq
  on public.email_unsubscribes (token);

alter table public.email_unsubscribes enable row level security;
alter table public.email_unsubscribes force row level security;

-- Lecture réservée aux membres de l'organisation concernée.
drop policy if exists email_unsubscribes_select_org on public.email_unsubscribes;
create policy email_unsubscribes_select_org
  on public.email_unsubscribes
  for select
  to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

-- Écriture réservée au service : la route publique de désinscription n'est pas
-- authentifiée, elle passe par le client de service après validation du jeton.
drop policy if exists email_unsubscribes_service on public.email_unsubscribes;
create policy email_unsubscribes_service
  on public.email_unsubscribes
  to service_role
  using (true)
  with check (true);
