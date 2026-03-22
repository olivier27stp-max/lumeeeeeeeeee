-- ============================================================
-- Mr Lume Agent System Tables
-- ============================================================

-- ── Agent Sessions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  title           text,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'cancelled')),
  state_snapshot  jsonb DEFAULT '{}',
  model_config    jsonb DEFAULT '{"intent":"llama3.2:3b","reasoning":"qwen2.5:7b","scoring":"deepseek-r1:8b"}',
  message_count   int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_sessions_org ON agent_sessions (org_id);
CREATE INDEX idx_agent_sessions_user ON agent_sessions (created_by);
CREATE INDEX idx_agent_sessions_status ON agent_sessions (org_id, status);

-- ── Agent Messages ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  session_id      uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content         text NOT NULL DEFAULT '',
  message_type    text NOT NULL DEFAULT 'text'
                    CHECK (message_type IN ('text', 'scenario', 'approval_request', 'approval_response', 'tool_result')),
  structured_data jsonb,
  model           text,
  tokens_in       int DEFAULT 0,
  tokens_out      int DEFAULT 0,
  duration_ms     int DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_messages_session ON agent_messages (session_id);
CREATE INDEX idx_agent_messages_org ON agent_messages (org_id);

-- ── Decision Logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  session_id      uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  decision_type   text NOT NULL,
  input_summary   text,
  chosen_option   text,
  confidence      numeric(4,2),
  reasoning       text,
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_decision_logs_session ON decision_logs (session_id);
CREATE INDEX idx_decision_logs_org ON decision_logs (org_id);

-- ── Scenario Runs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scenario_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  session_id       uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  decision_log_id  uuid REFERENCES decision_logs(id) ON DELETE SET NULL,
  trigger_type     text NOT NULL,
  context_snapshot jsonb DEFAULT '{}',
  model_used       text,
  duration_ms      int DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_runs_session ON scenario_runs (session_id);
CREATE INDEX idx_scenario_runs_org ON scenario_runs (org_id);

-- ── Scenario Options ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scenario_options (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  scenario_run_id uuid NOT NULL REFERENCES scenario_runs(id) ON DELETE CASCADE,
  label           text NOT NULL,
  score           numeric(5,2) NOT NULL DEFAULT 0,
  benefits        text[] NOT NULL DEFAULT '{}',
  risks           text[] NOT NULL DEFAULT '{}',
  outcome         text,
  confidence      numeric(4,2) NOT NULL DEFAULT 0,
  is_winner       boolean NOT NULL DEFAULT false,
  rank            int NOT NULL DEFAULT 0,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_options_run ON scenario_options (scenario_run_id);

-- ── Approvals ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  session_id      uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  decision_log_id uuid REFERENCES decision_logs(id) ON DELETE SET NULL,
  action_type     text NOT NULL,
  action_params   jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  responded_by    uuid REFERENCES auth.users(id),
  expires_at      timestamptz DEFAULT (now() + interval '1 hour')
);

CREATE INDEX idx_approvals_session ON approvals (session_id);
CREATE INDEX idx_approvals_org_status ON approvals (org_id, status);

-- ── Memory Entities ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  key         text NOT NULL,
  value       jsonb NOT NULL DEFAULT '{}',
  confidence  numeric(4,2) DEFAULT 1.0,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_entities_org ON memory_entities (org_id);
CREATE INDEX idx_memory_entities_type ON memory_entities (org_id, entity_type);
CREATE INDEX idx_memory_entities_entity ON memory_entities (org_id, entity_type, entity_id);

-- ── Memory Events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  event_type  text NOT NULL,
  entity_type text,
  entity_id   uuid,
  summary     text NOT NULL,
  importance  int NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_events_org ON memory_events (org_id);
CREATE INDEX idx_memory_events_type ON memory_events (org_id, event_type);

-- ============================================================
-- RLS Policies (all tables org-scoped)
-- ============================================================

ALTER TABLE agent_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_events    ENABLE ROW LEVEL SECURITY;

-- Helper macro for the policy condition
-- Uses same pattern as existing tables: org_id match via membership or direct owner
DO $$ BEGIN

-- agent_sessions
EXECUTE format(
  'CREATE POLICY %I ON agent_sessions FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'agent_sessions_org_policy'
);

-- agent_messages
EXECUTE format(
  'CREATE POLICY %I ON agent_messages FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'agent_messages_org_policy'
);

-- decision_logs
EXECUTE format(
  'CREATE POLICY %I ON decision_logs FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'decision_logs_org_policy'
);

-- scenario_runs
EXECUTE format(
  'CREATE POLICY %I ON scenario_runs FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'scenario_runs_org_policy'
);

-- scenario_options
EXECUTE format(
  'CREATE POLICY %I ON scenario_options FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'scenario_options_org_policy'
);

-- approvals
EXECUTE format(
  'CREATE POLICY %I ON approvals FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'approvals_org_policy'
);

-- memory_entities
EXECUTE format(
  'CREATE POLICY %I ON memory_entities FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'memory_entities_org_policy'
);

-- memory_events
EXECUTE format(
  'CREATE POLICY %I ON memory_events FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  )',
  'memory_events_org_policy'
);

END $$;

-- ============================================================
-- Auto-update triggers
-- ============================================================

CREATE OR REPLACE FUNCTION trg_agent_sessions_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_sessions_updated_at
  BEFORE UPDATE ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION trg_agent_sessions_updated_at();

-- Auto-increment message_count + last_message_at on agent_sessions
CREATE OR REPLACE FUNCTION trg_agent_messages_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE agent_sessions
  SET message_count = message_count + 1,
      last_message_at = NEW.created_at,
      updated_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_messages_after_insert
  AFTER INSERT ON agent_messages
  FOR EACH ROW EXECUTE FUNCTION trg_agent_messages_after_insert();

-- Memory entities updated_at
CREATE OR REPLACE FUNCTION trg_memory_entities_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_entities_updated_at
  BEFORE UPDATE ON memory_entities
  FOR EACH ROW EXECUTE FUNCTION trg_memory_entities_updated_at();

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE agent_sessions IS 'Mr Lume agent conversation sessions';
COMMENT ON TABLE agent_messages IS 'Messages within agent sessions (text, scenarios, approvals)';
COMMENT ON TABLE decision_logs IS 'Audit log of agent decisions and recommendations';
COMMENT ON TABLE scenario_runs IS 'Scenario engine execution records';
COMMENT ON TABLE scenario_options IS 'Individual scenario options generated per run';
COMMENT ON TABLE approvals IS 'User approval/rejection records for agent-proposed actions';
COMMENT ON TABLE memory_entities IS 'Long-term memory: entities, patterns, preferences';
COMMENT ON TABLE memory_events IS 'Long-term memory: important events and observations';
