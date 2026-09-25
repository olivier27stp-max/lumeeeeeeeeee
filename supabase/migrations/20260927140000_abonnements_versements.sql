-- Plan annuel payable en 3 versements + date d'annulation programmée
--
-- LE BESOIN
-- Un forfait annuel payé en trois fois (tous les 4 mois) donne un an
-- d'engagement pour un tiers du prix encaissé. Sans suivi, un client peut
-- payer un versement, obtenir le rabais annuel, puis annuler : il faut savoir
-- à tout moment combien de versements sont encaissés, quand tombe le
-- prochain, et jusqu'où court l'engagement.
--
-- COMMENT C'EST FACTURÉ CÔTÉ STRIPE
-- Un prix récurrent « tous les 4 mois » (interval=month, interval_count=4)
-- au tiers du prix annuel. Aucun Subscription Schedule : Stripe encaisse,
-- relance (Smart Retries) et l'abonnement continue d'année en année. La
-- notion d'engagement (12 mois = 3 versements) vit ici, et /billing/cancel
-- la fait respecter en programmant l'annulation à la fin de l'engagement
-- (cancel_at) plutôt qu'à la fin du versement en cours.
--
-- Les colonnes restent NULL pour tout abonnement mensuel ou annuel classique :
-- `installments_count` NULL = pas de versements, rien ne change pour eux.

alter table public.subscriptions
  add column if not exists installments_count        integer,
  add column if not exists installments_paid         integer not null default 0,
  add column if not exists installment_amount_cents  integer,
  add column if not exists commitment_end            timestamptz,
  add column if not exists cancel_at                 timestamptz;

comment on column public.subscriptions.installments_count is
  'Nombre de versements par an (3) pour un plan annuel payé en plusieurs fois. NULL = facturation classique.';
comment on column public.subscriptions.installments_paid is
  'Versements encaissés dans l''année d''engagement en cours (1..installments_count). Incrémenté par invoice.paid (subscription_cycle), remis à 1 au renouvellement de l''engagement.';
comment on column public.subscriptions.installment_amount_cents is
  'Montant d''un versement (prix annuel / installments_count, arrondi au cent).';
comment on column public.subscriptions.commitment_end is
  'Fin de l''engagement annuel en cours. /billing/cancel programme l''annulation à cette date, jamais avant.';
comment on column public.subscriptions.cancel_at is
  'Date d''annulation programmée côté Stripe (cancel_at), quand elle diffère de current_period_end. Miroir posé par le webhook customer.subscription.updated.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_installments_check') then
    alter table public.subscriptions add constraint subscriptions_installments_check
      check (
        installments_count is null
        or (installments_count between 2 and 12 and installments_paid between 0 and installments_count)
      );
  end if;
end $$;

-- Retrouver vite les abonnements à versements (rares) pour le tableau de bord.
create index if not exists idx_subscriptions_installments
  on public.subscriptions (commitment_end)
  where installments_count is not null;

-- Prix Stripe persistant du versement (un par devise), même idiome que
-- stripe_yearly_price_id_* : créé paresseusement au premier checkout.
alter table public.plans
  add column if not exists stripe_installment_price_id_cad text,
  add column if not exists stripe_installment_price_id_usd text;

comment on column public.plans.stripe_installment_price_id_cad is
  'Prix Stripe récurrent « tous les 4 mois » (CAD) = yearly_price_cad / 3. Créé au premier checkout en versements.';
comment on column public.plans.stripe_installment_price_id_usd is
  'Prix Stripe récurrent « tous les 4 mois » (USD) = yearly_price_usd / 3. Créé au premier checkout en versements.';
