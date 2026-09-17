-- Réglages Lume Payments par organisation (parité avec la page « Jobber
-- Payments », 2026-09-17) :
--   • quote_payments_enabled / invoice_payments_enabled : le client peut-il
--     payer en ligne un dépôt de devis / une facture ? Les deux à false =
--     « paiements désactivés ». Vérifié CÔTÉ SERVEUR sur chaque route
--     publique (public-pay, quotes/public/deposit-intent, payment-requests),
--     jamais seulement dans l'interface.
--   • tips_enabled : pourboire proposé sur la page de paiement publique.
--     Le pourboire est porté par payments.tip_cents et n'est JAMAIS appliqué
--     au solde de la facture.
--   • wallets_enabled : Apple Pay / Google Pay dans le Payment Element.
--   • require_payment_method_default : valeur par défaut de « carte au
--     dossier exigée » sur un nouveau devis.
--   • notify_owner_email : courriel à l'entreprise à chaque paiement reçu.
--
-- Écriture réservée au serveur (service_role) après contrôle admin/owner :
-- aucune policy d'écriture pour authenticated, et les GRANT par défaut
-- (ALL à authenticated sur une table neuve) sont révoqués explicitement —
-- cf. mémoire « revoke à PUBLIC ne suffit pas ».

begin;

create table if not exists public.payment_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  quote_payments_enabled boolean not null default true,
  invoice_payments_enabled boolean not null default true,
  tips_enabled boolean not null default false,
  wallets_enabled boolean not null default true,
  require_payment_method_default boolean not null default false,
  notify_owner_email boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.payment_settings is
  'Réglages Lume Payments par org (paiement en ligne devis/factures, pourboires, portefeuilles, carte au dossier par défaut, courriel au propriétaire). Écrit par le serveur seulement.';

alter table public.payment_settings enable row level security;
alter table public.payment_settings force row level security;

drop policy if exists payment_settings_select_org on public.payment_settings;
create policy payment_settings_select_org on public.payment_settings
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists payment_settings_service on public.payment_settings;
create policy payment_settings_service on public.payment_settings
  to service_role using (true) with check (true);

revoke all on public.payment_settings from anon, authenticated;
grant select on public.payment_settings to authenticated;

drop trigger if exists trg_payment_settings_set_updated_at on public.payment_settings;
create trigger trg_payment_settings_set_updated_at
  before update on public.payment_settings
  for each row execute function public.set_updated_at();

-- Pourboire encaissé avec un paiement en ligne. amount_cents reste le montant
-- appliqué à la facture ; le total débité au client = amount_cents + tip_cents.
alter table public.payments
  add column if not exists tip_cents integer not null default 0;
alter table public.payments
  drop constraint if exists payments_tip_cents_non_negatif;
alter table public.payments
  add constraint payments_tip_cents_non_negatif check (tip_cents >= 0);
comment on column public.payments.tip_cents is
  'Pourboire encaissé en plus du montant appliqué à la facture (amount_cents). Total débité = amount_cents + tip_cents.';

commit;
