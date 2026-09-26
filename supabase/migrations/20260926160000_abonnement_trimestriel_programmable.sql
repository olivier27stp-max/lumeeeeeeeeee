-- ═══════════════════════════════════════════════════════════════
-- Programmer un passage au trimestriel
--
-- CE QUI BLOQUAIT, et ce qui ne bloquait PAS. Vérifié en base avant d'écrire :
--
--   · `subscriptions.interval` est du TEXTE LIBRE, sans contrainte. Un
--     abonnement trimestriel s'y enregistre donc déjà — prouvé en sonde :
--     l'insertion avec `interval = 'quarterly'` passe.
--
--   · `subscriptions.scheduled_interval` porte un CHECK limité à
--     monthly/yearly. C'est lui, et lui seul, qui refuse le trimestriel.
--
-- La différence compte : ce n'est pas « souscrire un trimestriel » qui était
-- impossible, c'est « programmer un passage AU trimestriel » depuis un autre
-- forfait. Le paiement par lien Stripe passe déjà ; c'est le changement de
-- forfait en cours d'abonnement qui échouait.
--
-- CE QUE LE TRIMESTRIEL EST. Trois fois le prix mensuel, sans remise : le
-- client ne paie pas moins cher, il s'engage moins longtemps qu'à l'année.
-- Aucune colonne de prix n'est ajoutée — `prixCatalogue` le calcule déjà
-- (`monthly × 3`), ce qui évite d'avoir à tenir une colonne de plus en
-- accord avec Stripe.
--
-- ADDITIF ET RÉVERSIBLE. On élargit un CHECK, on ne touche à aucune ligne.
-- Les deux abonnements existants (un monthly, un yearly, tous deux sans
-- identifiant Stripe) gardent `scheduled_interval = null` : ils ne sont même
-- pas relus par cette contrainte.
--
-- ROLLBACK :
--   alter table public.subscriptions
--     drop constraint subscriptions_scheduled_interval_check;
--   alter table public.subscriptions
--     add constraint subscriptions_scheduled_interval_check
--     check (scheduled_interval = any (array['monthly'::text, 'yearly'::text]));
--   -- à ne faire que si aucune ligne ne porte 'quarterly' :
--   --   select count(*) from public.subscriptions
--   --   where scheduled_interval = 'quarterly';
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_scheduled_interval_check;

alter table public.subscriptions
  add constraint subscriptions_scheduled_interval_check
  check (scheduled_interval = any (array['monthly'::text, 'quarterly'::text, 'yearly'::text]));

comment on column public.subscriptions.scheduled_interval is
  'Intervalle visé par un changement de forfait programmé : monthly, quarterly ou yearly. NULL = aucun changement en attente. Le trimestriel vaut 3 × le mensuel, sans remise (2026-09-26).';

commit;
