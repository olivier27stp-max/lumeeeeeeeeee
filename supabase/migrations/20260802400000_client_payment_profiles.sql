-- Carte au dossier (« payment on file ») pour les CLIENTS des orgs.
-- Les paiements sont des destination charges sur le compte plateforme :
-- le customer Stripe et le payment method vivent donc côté plateforme.
--
-- Conformité Loi 25 (Québec) :
--   • Consentement EXPLICITE : la carte n'est sauvegardée que si le client
--     coche l'option sur la page de paiement publique (opt-in, jamais
--     pré-coché) — consented_at + consent_source en font foi.
--   • Minimisation : AUCUN numéro de carte chez nous — seulement les jetons
--     Stripe (customer/payment method) + marque, 4 derniers chiffres et
--     expiration pour l'affichage.
--   • Droit de retrait : la carte se supprime depuis le hub client
--     (détachement Stripe + soft delete ici).

begin;

create table if not exists public.client_payment_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null references public.clients(id),
  stripe_customer_id text not null,
  payment_method_id text,
  card_brand text,
  card_last4 text,
  card_exp_month integer,
  card_exp_year integer,
  -- Loi 25 : preuve du consentement explicite du client.
  consented_at timestamptz,
  consent_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Une seule carte au dossier active par client.
create unique index if not exists client_payment_profiles_client_unique
  on public.client_payment_profiles (org_id, client_id)
  where deleted_at is null;

alter table public.client_payment_profiles enable row level security;

-- Lecture pour les membres de l'org (affichage hub client). Écriture réservée
-- au serveur (service_role) : la carte n'entre et ne sort que par les flux
-- Stripe contrôlés (webhook de sauvegarde, endpoint de retrait).
drop policy if exists client_payment_profiles_select on public.client_payment_profiles;
create policy client_payment_profiles_select on public.client_payment_profiles
  for select using (public.has_org_membership((select auth.uid()), org_id));

commit;
