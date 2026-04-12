-- Migration: org_knowledge
-- Purpose: Store org-specific knowledge for AI agent training/prompt injection

CREATE TABLE IF NOT EXISTS org_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  category text NOT NULL, -- 'business_info', 'pricing', 'services', 'zones', 'seasonality', 'team_rules', 'payment_terms', 'vip_clients', 'faq', 'sales_process', 'objections', 'custom'
  key text NOT NULL,
  value text NOT NULL,
  importance int DEFAULT 5, -- 1-10, higher = more important for prompt injection
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, category, key)
);

CREATE INDEX idx_org_knowledge_org ON org_knowledge(org_id, is_active);

ALTER TABLE org_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON org_knowledge
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_org_knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_org_knowledge_updated_at
  BEFORE UPDATE ON org_knowledge
  FOR EACH ROW EXECUTE FUNCTION update_org_knowledge_updated_at();
