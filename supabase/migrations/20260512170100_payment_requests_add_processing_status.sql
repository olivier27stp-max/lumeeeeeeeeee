-- ============================================================
-- MIGRATION: 20260512170100_payment_requests_add_processing_status.sql
-- Add 'processing' to payment_requests.status CHECK constraint.
--
-- public-pay.ts:185 atomically UPDATEs status='processing' to claim
-- the row before creating a Stripe PaymentIntent. The original
-- constraint (20260405000000_lume_payments_connect.sql:70-71) did
-- not allow 'processing', so the UPDATE was being rejected by
-- Postgres and the lock never held — concurrent paying parties
-- could all create duplicate PIs. (F-11)
-- Idempotent: safe to run multiple times.
-- ============================================================

alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;

alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'sent', 'processing', 'paid', 'expired', 'cancelled'));
