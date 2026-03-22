-- ============================================================
-- Feature Flags System (org-scoped)
-- ============================================================

CREATE TABLE IF NOT EXISTS org_features (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  feature    text NOT NULL,
  enabled    boolean NOT NULL DEFAULT false,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_features_unique UNIQUE (org_id, feature)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_org_features_org ON org_features (org_id);

-- RLS
ALTER TABLE org_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_features_select ON org_features
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

CREATE POLICY org_features_insert ON org_features
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    OR org_id = auth.uid()
  );

CREATE POLICY org_features_update ON org_features
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    OR org_id = auth.uid()
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_org_features_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_features_updated_at
  BEFORE UPDATE ON org_features
  FOR EACH ROW EXECUTE FUNCTION trg_org_features_updated_at();

-- Comments
COMMENT ON TABLE org_features IS 'Per-org feature flags for gating new capabilities';
COMMENT ON COLUMN org_features.feature IS 'Feature key: agent, predictions, scenario_engine, voice';
COMMENT ON COLUMN org_features.metadata IS 'Optional config for the feature (model overrides, limits, etc.)';
