-- ============================================================
-- Memory Graph Tables — LIA Brain Visualization & Audit
-- ============================================================

-- ── Memory Nodes ───────────────────────────────────────────
-- Each node represents a concept, entity, or knowledge unit in LIA's brain.
CREATE TABLE IF NOT EXISTS memory_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  node_type       text NOT NULL,
  label           text NOT NULL,
  description     text,
  confidence      numeric(4,2) NOT NULL DEFAULT 0.5,
  importance      numeric(4,2) NOT NULL DEFAULT 0.5,
  freshness_at    timestamptz NOT NULL DEFAULT now(),
  company_id      uuid,
  client_id       uuid,
  source_count    int NOT NULL DEFAULT 0,
  is_orphan       boolean NOT NULL DEFAULT false,
  is_archived     boolean NOT NULL DEFAULT false,
  memory_layer    text NOT NULL DEFAULT 'conversation'
                    CHECK (memory_layer IN ('conversation', 'client', 'company', 'agentic')),
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_nodes_org ON memory_nodes (org_id);
CREATE INDEX idx_memory_nodes_type ON memory_nodes (org_id, node_type);
CREATE INDEX idx_memory_nodes_company ON memory_nodes (org_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX idx_memory_nodes_client ON memory_nodes (org_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_memory_nodes_layer ON memory_nodes (org_id, memory_layer);
CREATE INDEX idx_memory_nodes_orphan ON memory_nodes (org_id) WHERE is_orphan = true AND is_archived = false;
CREATE INDEX idx_memory_nodes_freshness ON memory_nodes (org_id, freshness_at DESC);
CREATE INDEX idx_memory_nodes_importance ON memory_nodes (org_id, importance DESC);

-- ── Memory Edges ───────────────────────────────────────────
-- Relationships between nodes in the memory graph.
CREATE TABLE IF NOT EXISTS memory_edges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  source_id       uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  target_id       uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  relation_type   text NOT NULL,
  weight          numeric(4,2) NOT NULL DEFAULT 0.5,
  confidence      numeric(4,2) NOT NULL DEFAULT 0.5,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_edges_org ON memory_edges (org_id);
CREATE INDEX idx_memory_edges_source ON memory_edges (source_id);
CREATE INDEX idx_memory_edges_target ON memory_edges (target_id);
CREATE INDEX idx_memory_edges_type ON memory_edges (org_id, relation_type);
-- For efficient subgraph queries (neighbors)
CREATE INDEX idx_memory_edges_both ON memory_edges (org_id, source_id, target_id);

-- ── Memory Logs ────────────────────────────────────────────
-- Audit trail for every memory lifecycle event.
CREATE TABLE IF NOT EXISTS memory_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  node_id         uuid REFERENCES memory_nodes(id) ON DELETE SET NULL,
  edge_id         uuid REFERENCES memory_edges(id) ON DELETE SET NULL,
  event_type      text NOT NULL,
  description     text,
  actor           text DEFAULT 'lia',
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_logs_org ON memory_logs (org_id);
CREATE INDEX idx_memory_logs_node ON memory_logs (node_id) WHERE node_id IS NOT NULL;
CREATE INDEX idx_memory_logs_event ON memory_logs (org_id, event_type);
CREATE INDEX idx_memory_logs_time ON memory_logs (org_id, created_at DESC);

-- ── Memory Sources ─────────────────────────────────────────
-- Tracks what evidence supports each memory node.
CREATE TABLE IF NOT EXISTS memory_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  node_id         uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  source_type     text NOT NULL,
  source_id       uuid,
  source_label    text,
  excerpt         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_sources_node ON memory_sources (node_id);
CREATE INDEX idx_memory_sources_org ON memory_sources (org_id);

-- ── Memory Conflicts ───────────────────────────────────────
-- Detected contradictions between memory nodes.
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  node_a_id       uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  node_b_id       uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  conflict_type   text NOT NULL DEFAULT 'contradiction',
  description     text,
  severity        numeric(4,2) NOT NULL DEFAULT 0.5,
  resolved        boolean NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  resolution      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_conflicts_org ON memory_conflicts (org_id);
CREATE INDEX idx_memory_conflicts_unresolved ON memory_conflicts (org_id) WHERE resolved = false;

-- ── Memory Snapshots ───────────────────────────────────────
-- Periodic snapshots for memory health tracking over time.
CREATE TABLE IF NOT EXISTS memory_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  total_nodes     int NOT NULL DEFAULT 0,
  total_edges     int NOT NULL DEFAULT 0,
  orphan_count    int NOT NULL DEFAULT 0,
  conflict_count  int NOT NULL DEFAULT 0,
  avg_confidence  numeric(4,2) DEFAULT 0,
  avg_importance  numeric(4,2) DEFAULT 0,
  layer_counts    jsonb DEFAULT '{}',
  type_counts     jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_snapshots_org ON memory_snapshots (org_id, created_at DESC);

-- ============================================================
-- Triggers
-- ============================================================

CREATE OR REPLACE FUNCTION trg_memory_nodes_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_nodes_updated_at
  BEFORE UPDATE ON memory_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_memory_nodes_updated_at();

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE memory_nodes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_edges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN

EXECUTE format(
  'CREATE POLICY %I ON memory_nodes FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )', 'memory_nodes_org_policy'
);

EXECUTE format(
  'CREATE POLICY %I ON memory_edges FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )', 'memory_edges_org_policy'
);

EXECUTE format(
  'CREATE POLICY %I ON memory_logs FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )', 'memory_logs_org_policy'
);

EXECUTE format(
  'CREATE POLICY %I ON memory_sources FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )', 'memory_sources_org_policy'
);

EXECUTE format(
  'CREATE POLICY %I ON memory_conflicts FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )', 'memory_conflicts_org_policy'
);

EXECUTE format(
  'CREATE POLICY %I ON memory_snapshots FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )', 'memory_snapshots_org_policy'
);

END $$;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE memory_nodes IS 'LIA memory graph nodes — entities, concepts, learned patterns';
COMMENT ON TABLE memory_edges IS 'LIA memory graph edges — relationships between nodes';
COMMENT ON TABLE memory_logs IS 'Audit trail for memory lifecycle events';
COMMENT ON TABLE memory_sources IS 'Evidence sources backing each memory node';
COMMENT ON TABLE memory_conflicts IS 'Detected contradictions in memory';
COMMENT ON TABLE memory_snapshots IS 'Periodic memory health snapshots';
