-- ═══════════════════════════════════════════════════════════════
-- Migration: Quote Presets Refactor
-- - Repurpose quote_templates table as content presets
-- - Add cover_image column for preset cover images
-- - Zero out pricing fields on existing templates (they become presets)
-- - DO NOT drop any columns to avoid breaking running queries
-- ═══════════════════════════════════════════════════════════════

-- Add cover_image column to quote_templates (now used as presets)
ALTER TABLE quote_templates ADD COLUMN IF NOT EXISTS cover_image text;

-- Zero out pricing fields on all existing templates (presets don't have pricing)
UPDATE quote_templates
SET
  deposit_required = false,
  deposit_type = null,
  deposit_value = 0,
  tax_enabled = false,
  tax_rate = 0,
  tax_label = '',
  layout_config = '{}',
  style_config = '{}'
WHERE deleted_at IS NULL;

-- Zero out unit_price_cents in services JSONB for all existing templates
-- This ensures presets don't carry pricing data
UPDATE quote_templates
SET services = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_set(elem, '{unit_price_cents}', '0'::jsonb)
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(services, '[]'::jsonb)) AS elem
)
WHERE deleted_at IS NULL
  AND services IS NOT NULL
  AND jsonb_array_length(services) > 0;

-- Add comment to clarify the table's new purpose
COMMENT ON TABLE quote_templates IS 'Quote content presets — reusable content bundles for quote creation (no pricing, no layout).';
COMMENT ON COLUMN quote_templates.cover_image IS 'URL of the cover/hero image for this preset';
