-- ============================================================
-- Quote Templates: reusable pre-configured quote structures
-- ============================================================

CREATE TABLE IF NOT EXISTS quote_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id),

  name         text NOT NULL,
  description  text,

  -- Pre-filled services as JSON array
  -- Each: { id, name, description, unit_price_cents, quantity, is_optional }
  services     jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Image URLs (stored in Supabase Storage)
  images       text[] NOT NULL DEFAULT '{}',

  -- Default notes & terms
  notes        text,
  terms        text,

  -- Custom fields for extensibility: { key: value }
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,

  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_templates_org
  ON quote_templates (org_id, created_at DESC) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE quote_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_templates_org_member" ON quote_templates
  FOR ALL USING (has_org_membership(auth.uid(), org_id));
