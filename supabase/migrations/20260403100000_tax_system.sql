-- ============================================================
-- Tax System: configurable multi-tax, multi-region, multi-tenant
-- ============================================================

-- Individual tax rates (TPS, TVQ, HST, GST, PST, Sales Tax, VAT, etc.)
CREATE TABLE IF NOT EXISTS tax_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,                          -- e.g. "TPS", "TVQ", "HST"
  rate        numeric(8,4) NOT NULL DEFAULT 0,        -- e.g. 5.0000, 9.9750
  type        text NOT NULL DEFAULT 'percentage' CHECK (type IN ('percentage', 'fixed')),
  region      text NOT NULL DEFAULT '',               -- e.g. "QC", "ON", "BC", "US-CA"
  country     text NOT NULL DEFAULT 'CA',             -- ISO country code
  is_compound boolean NOT NULL DEFAULT false,         -- Applied on (subtotal + previous taxes)
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_configs_org ON tax_configs (org_id, region) WHERE is_active = true;

ALTER TABLE tax_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax_configs_org" ON tax_configs FOR ALL USING (has_org_membership(auth.uid(), org_id));

-- Tax groups: bundle multiple taxes together (e.g. "Quebec" = TPS + TVQ)
CREATE TABLE IF NOT EXISTS tax_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,                          -- e.g. "Quebec Taxes", "Ontario HST"
  region      text NOT NULL DEFAULT '',
  country     text NOT NULL DEFAULT 'CA',
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_groups_default ON tax_groups (org_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_tax_groups_org ON tax_groups (org_id) WHERE is_active = true;

ALTER TABLE tax_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax_groups_org" ON tax_groups FOR ALL USING (has_org_membership(auth.uid(), org_id));

-- Junction: which taxes belong to which group
CREATE TABLE IF NOT EXISTS tax_group_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_group_id uuid NOT NULL REFERENCES tax_groups(id) ON DELETE CASCADE,
  tax_config_id uuid NOT NULL REFERENCES tax_configs(id) ON DELETE CASCADE,
  sort_order   integer NOT NULL DEFAULT 0,
  UNIQUE(tax_group_id, tax_config_id)
);

ALTER TABLE tax_group_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax_group_items_access" ON tax_group_items FOR ALL
  USING (EXISTS (SELECT 1 FROM tax_groups g WHERE g.id = tax_group_items.tax_group_id AND has_org_membership(auth.uid(), g.org_id)));

-- Store applied taxes per-document for audit trail
-- Each quote/invoice line shows exactly which taxes were applied
CREATE TABLE IF NOT EXISTS applied_taxes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('quote', 'invoice')),
  document_id   uuid NOT NULL,
  tax_config_id uuid REFERENCES tax_configs(id) ON DELETE SET NULL,
  name          text NOT NULL,                    -- Snapshot of tax name
  rate          numeric(8,4) NOT NULL,            -- Snapshot of rate
  amount_cents  integer NOT NULL DEFAULT 0,       -- Calculated amount
  is_compound   boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applied_taxes_doc ON applied_taxes (document_type, document_id);

-- Add default_tax_group_id to company_settings
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS default_tax_group_id uuid REFERENCES tax_groups(id) ON DELETE SET NULL;
