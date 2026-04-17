-- ============================================================
-- Add registration_number to tax_configs
-- Allows storing tax registration numbers (TPS No, TVQ No, VAT No, etc.)
-- Displayed on invoices when present.
-- ============================================================

ALTER TABLE tax_configs
  ADD COLUMN IF NOT EXISTS registration_number text;
