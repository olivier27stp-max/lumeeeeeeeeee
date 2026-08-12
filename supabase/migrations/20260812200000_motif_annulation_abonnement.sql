-- ════════════════════════════════════════════════════════════════════════════
-- Motif d'annulation d'abonnement
--
-- POURQUOI
-- Une annulation ne laissait aucune trace de SA RAISON : ni « trop cher », ni
-- « il me manque telle fonctionnalité », ni « j'ai fermé mon entreprise ».
-- Sans cette donnée, on ne peut pas réduire un taux de départ — on devine.
--
-- Les clients annulent depuis le portail Stripe (server/routes/billing.ts,
-- /billing/customer-portal), pas depuis un écran de Lume. Stripe pose lui-même
-- la question quand l'enquête d'annulation est activée dans son tableau de
-- bord, et transmet la réponse au webhook dans `cancellation_details` :
--   - `feedback` : une valeur parmi une liste fermée (too_expensive,
--     missing_features, switched_service, unused, customer_service,
--     too_complex, low_quality, other)
--   - `comment`  : le texte libre, facultatif
--
-- CE QUE FAIT CETTE MIGRATION
-- Deux colonnes sur `subscriptions`, renseignées par le webhook
-- customer.subscription.updated / .deleted.
--
-- PAS DE CONTRAINTE CHECK sur `cancellation_feedback` : la liste appartient à
-- Stripe et peut s'allonger sans préavis. Une valeur inconnue ferait alors
-- échouer TOUTE la mise à jour de l'abonnement — le webhook serait rejoué en
-- boucle et le statut ne serait jamais synchronisé. Perdre un libellé est
-- acceptable ; perdre l'annulation ne l'est pas.
--
-- Idempotent : rejouable sans effet de bord.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.subscriptions
  add column if not exists cancellation_feedback text,
  add column if not exists cancellation_comment  text;

comment on column public.subscriptions.cancellation_feedback is
  'Motif d''annulation choisi par le client dans le portail Stripe '
  '(cancellation_details.feedback). Liste ouverte : aucune contrainte CHECK, '
  'Stripe pouvant ajouter des valeurs.';

comment on column public.subscriptions.cancellation_comment is
  'Commentaire libre laissé à l''annulation (cancellation_details.comment).';

-- Retrouver les départs récents et leurs motifs sans balayer la table.
create index if not exists idx_subscriptions_canceled_at
  on public.subscriptions (canceled_at desc)
  where canceled_at is not null;
