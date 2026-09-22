-- ═══════════════════════════════════════════════════════════════
-- Branche les 12 nouveaux prix Stripe (mode réel) sur la grille du
-- 2026-09-22 (migration 20260922000000).
--
-- Un prix Stripe est IMMUABLE : on ne modifie pas un montant, on crée un
-- nouveau prix et on archive l'ancien. Les 12 prix ci-dessous ont été créés
-- à la main dans le tableau de bord, en mode réel.
--
-- ORDRE IMPOSÉ : brancher ces identifiants AVANT d'archiver les anciens.
-- Stripe refuse de créer un abonnement sur un prix archivé — archiver avant
-- cette migration couperait le paiement en ligne.
--
-- Les montants (monthly_price_*, yearly_price_*) ne sont PAS retouchés ici :
-- ils sont déjà bons depuis 20260922000000. On ne pose que les liens Stripe,
-- et un test croise les deux (tests/prix-stripe-identifiants).
-- ═══════════════════════════════════════════════════════════════

begin;

update public.plans set
  stripe_monthly_price_id_cad = 'price_1UIUrQ1MfRbVcYlQiauP20K6',
  stripe_yearly_price_id_cad  = 'price_1UIUro1MfRbVcYlQP79QWKhe',
  stripe_monthly_price_id_usd = 'price_1UIUsI1MfRbVcYlQY738Ct7T',
  stripe_yearly_price_id_usd  = 'price_1UIUsg1MfRbVcYlQ8V8NlHxZ',
  updated_at = now()
where slug = 'starter';

update public.plans set
  stripe_monthly_price_id_cad = 'price_1UIUtW1MfRbVcYlQP5Vncyte',
  stripe_yearly_price_id_cad  = 'price_1UIUtw1MfRbVcYlQUnQTIfyU',
  stripe_monthly_price_id_usd = 'price_1UIUuE1MfRbVcYlQnmJt4amD',
  stripe_yearly_price_id_usd  = 'price_1UIUue1MfRbVcYlQKaWsDJEJ',
  updated_at = now()
where slug = 'pro';

update public.plans set
  stripe_monthly_price_id_cad = 'price_1UIUvI1MfRbVcYlQylOgkcrz',
  stripe_yearly_price_id_cad  = 'price_1UIUvg1MfRbVcYlQYCqdADoq',
  stripe_monthly_price_id_usd = 'price_1UIUw51MfRbVcYlQiNzbBAmi',
  stripe_yearly_price_id_usd  = 'price_1UIUwh1MfRbVcYlQEXcYAM10',
  updated_at = now()
where slug = 'autopilot';

commit;
