-- ═══════════════════════════════════════════════════════════════
-- Retrait des colonnes de facturation par bureau (2026-09-17)
--
-- Les bureaux ne sont plus vendus par forfait ni achetables par le
-- tenant (commit 1e1c266) : la capacité de bureaux d'un workspace vient
-- désormais d'un quota posé par la plateforme (Creator Space → Features),
-- stocké dans org_features (feature = 'office_quota'), 1 par défaut.
--
-- Plus aucun code ne lit ni n'écrit ces colonnes (vérifié par grep sur
-- server/ et src/ avant cette migration) :
--   - plans.included_offices, plans.extra_office_price_usd,
--     plans.extra_office_price_cad      (posées par 20260612000000)
--   - subscriptions.extra_offices, subscriptions.stripe_office_item_id
--                                        (posées par 20260612000001)
--
-- Aucune fonction, vue, trigger ni policy ne les référence (vérifié dans
-- supabase/SCHEMA_SNAPSHOT.md). Idempotent.
-- ═══════════════════════════════════════════════════════════════

alter table public.plans
  drop column if exists included_offices,
  drop column if exists extra_office_price_usd,
  drop column if exists extra_office_price_cad;

alter table public.subscriptions
  drop column if exists extra_offices,
  drop column if exists stripe_office_item_id;
