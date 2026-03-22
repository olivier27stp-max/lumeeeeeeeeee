-- ============================================================
-- Agent System: Index & RLS fixes
-- ============================================================

-- Missing index: agent_messages ordered by created_at (used in session load)
CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
  ON agent_messages (session_id, created_at);

-- Partial index: frequently-queried pending approvals
CREATE INDEX IF NOT EXISTS idx_approvals_pending
  ON approvals (org_id) WHERE status = 'pending';

-- Partial index: active sessions
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active
  ON agent_sessions (org_id, last_message_at DESC NULLS LAST) WHERE status = 'active';

-- ── Tighten RLS on immutable audit tables ──────────────────
-- scenario_options: should be read-only for users (only service role inserts)
DROP POLICY IF EXISTS scenario_options_org_policy ON scenario_options;

CREATE POLICY scenario_options_select ON scenario_options
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

CREATE POLICY scenario_options_insert ON scenario_options
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

-- decision_logs: read + insert only (no update/delete from client)
DROP POLICY IF EXISTS decision_logs_org_policy ON decision_logs;

CREATE POLICY decision_logs_select ON decision_logs
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

CREATE POLICY decision_logs_insert ON decision_logs
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

-- Allow service role to update decision_logs (for approved_by/approved_at)
-- Service role bypasses RLS anyway, so no policy needed

-- memory_events: read + insert only
DROP POLICY IF EXISTS memory_events_org_policy ON memory_events;

CREATE POLICY memory_events_select ON memory_events
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

CREATE POLICY memory_events_insert ON memory_events
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

-- ── Comments ───────────────────────────────────────────────
COMMENT ON INDEX idx_agent_messages_session_created IS 'Speeds up session message loading ordered by time';
COMMENT ON INDEX idx_approvals_pending IS 'Partial index for fast pending approval lookups';
COMMENT ON INDEX idx_agent_sessions_active IS 'Partial index for active session listing';
