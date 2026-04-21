-- ORDER_HINT: 2/2 — timestamp collision with 20260403000000_recurring_jobs.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ============================================================
-- Template defaults: store default layout per company + quote layout persistence
-- ============================================================

-- Default template layout per company
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS default_quote_layout text DEFAULT 'minimal_pro',
  ADD COLUMN IF NOT EXISTS default_invoice_layout text DEFAULT 'clean_billing';

-- Store chosen layout on each quote (persisted, not session-only)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS layout_type text DEFAULT 'minimal_pro';

COMMENT ON COLUMN company_settings.default_quote_layout IS 'Default visual template for new quotes';
COMMENT ON COLUMN company_settings.default_invoice_layout IS 'Default visual template for new invoices';
COMMENT ON COLUMN quotes.layout_type IS 'Visual template layout used for this quote';
