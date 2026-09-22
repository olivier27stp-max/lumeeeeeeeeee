-- ═══════════════════════════════════════════════════════════════
-- Nouvelle grille tarifaire (décision Rafba, 2026-09-22)
--
-- Mensuel inchangé pour Minimum (150) et Autopilot (495) ; Scale passe de
-- 340 à 347. Le rabais annuel devient PROPRE À CHAQUE FORFAIT au lieu d'un
-- 15 % uniforme :
--     Minimum    10 %  →  135/mois  →  1 620/an
--     Scale      15 %  →  295/mois  →  3 540/an
--     Autopilot  30 %  →  347/mois  →  4 164/an
-- Le 30 % d'Autopilot est volontaire : il amène l'annuel d'Autopilot au
-- niveau du mensuel de Scale (347), pour rendre la montée évidente.
--
-- USD = CAD converti au taux du 2026-09-22 (≈ 0,715), arrondi au dollar :
--     Minimum 109 · Scale 249 · Autopilot 359
-- Les utilisateurs supplémentaires suivent la même conversion.
--
-- Montants en CENTS (voir la note « Argent en cents » du projet).
-- Les identifiants Stripe ne sont PAS touchés ici : un prix Stripe est
-- immuable, il faut en créer de nouveaux puis les brancher (fait à part).
-- ═══════════════════════════════════════════════════════════════

begin;

update public.plans set
  monthly_price_cad = 15000, yearly_price_cad = 162000,
  monthly_price_usd = 10900, yearly_price_usd = 117600,
  extra_seat_price_cad = 3500, extra_seat_price_usd = 2500,
  updated_at = now()
where slug = 'starter';

update public.plans set
  monthly_price_cad = 34700, yearly_price_cad = 354000,
  monthly_price_usd = 24900, yearly_price_usd = 254400,
  extra_seat_price_cad = 3000, extra_seat_price_usd = 2100,
  updated_at = now()
where slug = 'pro';

update public.plans set
  monthly_price_cad = 49500, yearly_price_cad = 416400,
  monthly_price_usd = 35900, yearly_price_usd = 301200,
  extra_seat_price_cad = 2500, extra_seat_price_usd = 1800,
  updated_at = now()
where slug = 'autopilot';

commit;
