-- payments.card_last4 / card_brand : écrites par le webhook Stripe
-- (payment_intent.succeeded) depuis la migration 20260709000000… qui n'a
-- JAMAIS été appliquée, ni en prod ni en staging (elle redéfinissait aussi
-- rpc_list_invoices, depuis remplacée — on ne la rejoue pas).
--
-- Découvert le 2026-09-17 par un paiement de bout en bout sur staging : le
-- webhook répondait 500 « Could not find the 'card_brand' column of
-- 'payments' », donc AUCUN paiement en ligne n'aurait été enregistré, la
-- facture restait due et Stripe rejouait pendant 3 jours. Prod n'avait encore
-- reçu aucun payment_intent.succeeded : le bug était latent, pas déclenché.
--
-- Colonnes seulement, idempotent.

begin;

alter table public.payments add column if not exists card_last4 text;
alter table public.payments add column if not exists card_brand text;

comment on column public.payments.card_last4 is
  'Quatre derniers chiffres de la carte, posés par le webhook Stripe ; null pour un paiement manuel ou antérieur.';
comment on column public.payments.card_brand is
  'Marque de la carte (visa, mastercard, amex…), posée par le webhook Stripe.';

commit;
