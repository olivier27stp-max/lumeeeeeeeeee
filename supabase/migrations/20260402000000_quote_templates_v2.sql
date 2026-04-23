-- ORDER_HINT: 1/2 — timestamp collision with 20260402000000_whiteboard_features.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ============================================================
-- Quote Templates V2: Enhanced template system
-- Adds is_default, is_active, deposit config, sections,
-- layout/style/branding config, intro_text, footer_notes, etc.
-- ============================================================

-- New columns on quote_templates
ALTER TABLE quote_templates
  ADD COLUMN IF NOT EXISTS is_default       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_category text,
  ADD COLUMN IF NOT EXISTS quote_title      text,
  ADD COLUMN IF NOT EXISTS intro_text       text,
  ADD COLUMN IF NOT EXISTS footer_notes     text,
  ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_type     text CHECK (deposit_type IN ('percentage', 'fixed')),
  ADD COLUMN IF NOT EXISTS deposit_value    numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_rate         numeric(8,4) DEFAULT 14.975,
  ADD COLUMN IF NOT EXISTS tax_label        text DEFAULT 'TPS+TVQ (14.975%)',
  ADD COLUMN IF NOT EXISTS sections         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS layout_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS style_config     jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Ensure only one default per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_templates_default_per_org
  ON quote_templates (org_id)
  WHERE is_default = true AND deleted_at IS NULL;

-- Add source_template_id to quotes for traceability (nullable, no FK constraint)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS source_template_id   uuid,
  ADD COLUMN IF NOT EXISTS source_template_name text;

COMMENT ON COLUMN quotes.source_template_id IS 'Snapshot: which template was used to create this quote. No FK — template can be deleted safely.';
COMMENT ON COLUMN quotes.source_template_name IS 'Snapshot: template name at time of application.';
