-- ORDER_HINT: 2/2 — timestamp collision with 20260412000000_relax_email_check_for_encryption.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ============================================================
-- Add registration_number to tax_configs
-- Allows storing tax registration numbers (TPS No, TVQ No, VAT No, etc.)
-- Displayed on invoices when present.
-- ============================================================

ALTER TABLE tax_configs
  ADD COLUMN IF NOT EXISTS registration_number text;
