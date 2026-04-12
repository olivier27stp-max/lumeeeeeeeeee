-- ============================================================================
-- LUME CRM — ADVANCED SECURITY MIGRATION
-- PII blind indexes, API keys, password policies, export controls
-- ============================================================================

-- ============================================================================
-- 1. BLIND INDEX COLUMNS for searchable encrypted PII
-- ============================================================================

-- Clients
DO $$ BEGIN
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_blind text;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_blind text;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_email_blind ON clients(email_blind) WHERE email_blind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_phone_blind ON clients(phone_blind) WHERE phone_blind IS NOT NULL;

-- Leads
DO $$ BEGIN
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_blind text;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_blind text;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_email_blind ON leads(email_blind) WHERE email_blind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone_blind ON leads(phone_blind) WHERE phone_blind IS NOT NULL;

-- ============================================================================
-- 2. API KEYS TABLE — Scoped, hashed, revocable
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Store only the SHA-256 hash of the key, never the raw key
  key_hash text NOT NULL UNIQUE,
  -- First 8 chars of the key for identification (e.g., "lk_abc123...")
  key_prefix text NOT NULL,
  -- Scopes: comma-separated list of allowed operations
  scopes text[] NOT NULL DEFAULT ARRAY['read'],
  -- Rate limit specific to this key
  rate_limit_per_minute int NOT NULL DEFAULT 60,
  last_used_at timestamptz,
  last_used_ip inet,
  expires_at timestamptz,
  revoked boolean DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id, revoked);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked = false;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_select_admin" ON api_keys;
CREATE POLICY "api_keys_select_admin" ON api_keys FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships WHERE memberships.org_id = api_keys.org_id
      AND memberships.user_id = auth.uid() AND memberships.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS "api_keys_insert_admin" ON api_keys;
CREATE POLICY "api_keys_insert_admin" ON api_keys FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships WHERE memberships.org_id = api_keys.org_id
      AND memberships.user_id = auth.uid() AND memberships.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS "api_keys_update_admin" ON api_keys;
CREATE POLICY "api_keys_update_admin" ON api_keys FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships WHERE memberships.org_id = api_keys.org_id
      AND memberships.user_id = auth.uid() AND memberships.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS "api_keys_service_all" ON api_keys;
CREATE POLICY "api_keys_service_all" ON api_keys FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 3. DATA EXPORT LOG — Track all exports for compliance
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_export_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  export_type text NOT NULL, -- 'csv', 'pdf', 'json', 'api'
  entity_type text NOT NULL, -- 'clients', 'leads', 'invoices', etc.
  record_count int NOT NULL DEFAULT 0,
  ip_address inet,
  user_agent text,
  -- Watermark: unique hash embedded in export for leak tracing
  watermark text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_log_org ON data_export_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_log_user ON data_export_log(user_id, created_at DESC);

ALTER TABLE data_export_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "export_log_select_admin" ON data_export_log;
CREATE POLICY "export_log_select_admin" ON data_export_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships WHERE memberships.org_id = data_export_log.org_id
      AND memberships.user_id = auth.uid() AND memberships.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS "export_log_insert_service" ON data_export_log;
CREATE POLICY "export_log_insert_service" ON data_export_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "export_log_no_update" ON data_export_log;
CREATE POLICY "export_log_no_update" ON data_export_log FOR UPDATE USING (false);
DROP POLICY IF EXISTS "export_log_no_delete" ON data_export_log;
CREATE POLICY "export_log_no_delete" ON data_export_log FOR DELETE USING (false);

-- ============================================================================
-- 4. SECRET ROTATION TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS secret_rotation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name text NOT NULL, -- 'PAYMENTS_ENCRYPTION_KEY', 'STRIPE_SECRET_KEY', etc.
  rotated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rotated_at timestamptz DEFAULT now(),
  next_rotation_due timestamptz,
  notes text
);

ALTER TABLE secret_rotation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "secret_rotation_service" ON secret_rotation_log;
CREATE POLICY "secret_rotation_service" ON secret_rotation_log FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 5. ACTIVE SESSIONS TABLE — Track and invalidate sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES orgs(id) ON DELETE SET NULL,
  session_token_hash text NOT NULL, -- SHA-256 hash of session token
  device_fingerprint text,
  ip_address inet,
  user_agent text,
  country_code text,
  last_activity timestamptz DEFAULT now(),
  is_valid boolean DEFAULT true,
  invalidated_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id, is_valid);
CREATE INDEX IF NOT EXISTS idx_active_sessions_hash ON active_sessions(session_token_hash) WHERE is_valid = true;

ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select_own" ON active_sessions;
CREATE POLICY "sessions_select_own" ON active_sessions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "sessions_service_all" ON active_sessions;
CREATE POLICY "sessions_service_all" ON active_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 6. FUNCTION: Detect impossible travel (login from 2 countries in < 1 hour)
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_impossible_travel(p_user_id uuid, p_country text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM login_history
    WHERE user_id = p_user_id
      AND success = true
      AND country_code IS NOT NULL
      AND country_code != p_country
      AND created_at > now() - interval '1 hour'
  );
$fn$;

-- ============================================================================
-- 7. FUNCTION: Force invalidate all sessions for a user
-- ============================================================================

CREATE OR REPLACE FUNCTION invalidate_all_sessions(p_user_id uuid, p_reason text DEFAULT 'manual')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_count int;
BEGIN
  UPDATE active_sessions
  SET is_valid = false, invalidated_reason = p_reason
  WHERE user_id = p_user_id AND is_valid = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO security_events (user_id, event_type, severity, source, details)
  VALUES (p_user_id, 'sessions_invalidated', 'high', 'auth',
    jsonb_build_object('reason', p_reason, 'count', v_count));

  RETURN v_count;
END;
$fn$;

-- ============================================================================
-- 8. PASSWORD POLICY FUNCTION — Check password strength
-- ============================================================================

CREATE OR REPLACE FUNCTION check_password_strength(p_password text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $fn$
DECLARE
  v_score int := 0;
  v_issues text[] := '{}';
BEGIN
  IF length(p_password) < 10 THEN
    v_issues := array_append(v_issues, 'Password must be at least 10 characters');
  ELSE
    v_score := v_score + 1;
  END IF;

  IF p_password !~ '[A-Z]' THEN
    v_issues := array_append(v_issues, 'Must contain at least one uppercase letter');
  ELSE
    v_score := v_score + 1;
  END IF;

  IF p_password !~ '[a-z]' THEN
    v_issues := array_append(v_issues, 'Must contain at least one lowercase letter');
  ELSE
    v_score := v_score + 1;
  END IF;

  IF p_password !~ '[0-9]' THEN
    v_issues := array_append(v_issues, 'Must contain at least one number');
  ELSE
    v_score := v_score + 1;
  END IF;

  IF p_password !~ '[^a-zA-Z0-9]' THEN
    v_issues := array_append(v_issues, 'Must contain at least one special character');
  ELSE
    v_score := v_score + 1;
  END IF;

  IF length(p_password) >= 16 THEN
    v_score := v_score + 1;
  END IF;

  RETURN jsonb_build_object(
    'strong', array_length(v_issues, 1) IS NULL OR array_length(v_issues, 1) = 0,
    'score', v_score,
    'max_score', 6,
    'issues', to_jsonb(v_issues)
  );
END;
$fn$;

-- Comments
COMMENT ON TABLE api_keys IS 'Hashed API keys for external integrations — never stores raw keys';
COMMENT ON TABLE data_export_log IS 'Immutable log of all data exports with watermarks for leak tracing';
COMMENT ON TABLE active_sessions IS 'Tracks active user sessions for invalidation and anomaly detection';
COMMENT ON FUNCTION detect_impossible_travel IS 'Detects logins from different countries within 1 hour';
COMMENT ON FUNCTION invalidate_all_sessions IS 'Force-invalidate all active sessions for a user';
COMMENT ON FUNCTION check_password_strength IS 'Validate password meets minimum security requirements';
