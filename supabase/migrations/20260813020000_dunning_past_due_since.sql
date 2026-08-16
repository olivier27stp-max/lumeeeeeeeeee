-- Dater le début de l'impayé, pour pouvoir accorder une grâce d'accès
--
-- LE PROBLÈME
-- Aujourd'hui, quand la carte d'un client est refusée :
--   1. Stripe émet `invoice.payment_failed` ;
--   2. le webhook passe l'abonnement en `past_due` ;
--   3. le gate de src/App.tsx n'accepte que `active` et `trialing` — le client
--      se retrouve DEHORS de son CRM le jour même, sans avoir reçu un seul
--      courriel lui expliquant pourquoi.
--
-- Il perd l'accès à ses clients, ses jobs, ses factures, pour une carte
-- expirée qu'il aurait corrigée en trente secondes s'il avait été prévenu.
--
-- POURQUOI UNE COLONNE PLUTÔT QU'UNE DÉRIVATION
-- Pour accorder une grâce de 7 jours, il faut savoir QUAND l'impayé a commencé.
-- La table `subscriptions` n'a ni `updated_at` ni aucune autre date qui
-- bougerait au passage en `past_due` (absence déjà documentée par des
-- commentaires dans server/routes/payments.ts).
--
-- L'alternative envisagée était de dériver la date depuis le journal d'envoi
-- du courriel d'avertissement. Elle est écartée : l'accès d'un client au
-- produit qu'il paie ne doit pas dépendre de la réussite d'un envoi de
-- courriel. Un serveur SMTP qui bronche ne doit pas pouvoir verrouiller
-- quelqu'un dehors, ni lui offrir une grâce éternelle.
--
-- POURQUOI 7 JOURS
-- C'est la fenêtre des Smart Retries de Stripe. Couper avant, c'est couper des
-- clients dont le paiement allait aboutir tout seul au deuxième essai.
-- Le calcul est asymétrique : un client suspendu à tort coûte un départ
-- définitif plus du support ; un client en grâce coûte 7 jours d'usage d'un
-- service déjà provisionné, dont le coût marginal est proche de zéro.
--
-- Cette migration n'ajoute QUE la donnée. Elle ne change aucun comportement :
-- le gate et les courriels arrivent dans le même lot, côté application.

alter table public.subscriptions
  add column if not exists past_due_since timestamptz;

comment on column public.subscriptions.past_due_since is
  'Début du premier échec de paiement non résolu. Posé au passage en past_due, '
  'remis à NULL dès qu''un paiement aboutit. Sert à calculer la grâce d''accès '
  'de 7 jours avant suspension. Ne jamais le poser à chaque relance Stripe : '
  'ça repousserait la suspension indéfiniment.';

-- Retrouver les abonnements en souffrance, sans scanner toute la table.
-- Partiel : seuls les past_due nous intéressent, et ils sont rares.
create index if not exists idx_subscriptions_past_due_since
  on public.subscriptions (past_due_since)
  where past_due_since is not null;

-- Cohérence pour les lignes déjà en past_due au moment du déploiement.
-- Aucune date d'origine n'existe pour elles : on les date de maintenant, ce
-- qui leur accorde la grâce complète. Le sens de l'erreur est délibéré —
-- mieux vaut 7 jours de trop que de suspendre quelqu'un sans préavis.
update public.subscriptions
   set past_due_since = now()
 where status = 'past_due'
   and past_due_since is null;
