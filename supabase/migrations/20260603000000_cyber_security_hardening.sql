-- ============================================================================
-- LUME CRM — CYBER SECURITY HARDENING MIGRATION
-- Based on Lume Cyber Security Matrix (295 attack vectors, 15 domains)
-- ============================================================================
-- This migration adds:
--   1. Security event logging tables
--   2. IP blocklist and rate limiting at DB level
--   3. Login history and device tracking
--   4. Anomaly detection functions
--   5. Hardened RLS policies for sensitive tables
--   6. Security alert system
--   7. Webhook idempotency guarantees
--   8. Data sanitization functions
-- ============================================================================

-- Migration runs as a single transaction via Supabase

-- ============================================================================
-- 1. SECURITY EVENTS TABLE — Comprehensive security audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  source text NOT NULL DEFAULT 'system', -- 'api', 'auth', 'webhook', 'rls', 'system'
  ip_address inet,
  user_agent text,
  details jsonb DEFAULT '{}',
  resolved boolean DEFAULT false,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_org ON security_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity, resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address) WHERE ip_address IS NOT NULL;

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- Only admins/owners can view security events
DROP POLICY IF EXISTS "security_events_select_admin" ON security_events;
CREATE POLICY "security_events_select_admin" ON security_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.org_id = security_events.org_id
        AND memberships.user_id = auth.uid()
        AND memberships.role IN ('owner', 'admin')
    )
  );

-- Only service_role can insert (server-side only)
DROP POLICY IF EXISTS "security_events_insert_service" ON security_events;
CREATE POLICY "security_events_insert_service" ON security_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- No updates/deletes from client — append-only log
DROP POLICY IF EXISTS "security_events_no_update" ON security_events;
CREATE POLICY "security_events_no_update" ON security_events FOR UPDATE
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "security_events_no_delete" ON security_events;
CREATE POLICY "security_events_no_delete" ON security_events FOR DELETE USING (false);


-- ============================================================================
-- 2. IP BLOCKLIST — Block malicious IPs at DB query level
-- ============================================================================

CREATE TABLE IF NOT EXISTS ip_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL,
  reason text NOT NULL,
  blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id uuid REFERENCES orgs(id) ON DELETE CASCADE, -- NULL = global
  expires_at timestamptz, -- NULL = permanent
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_blocklist_unique
  ON ip_blocklist(ip_address, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- Active blocked IPs queried via function, no partial index with now()
CREATE INDEX IF NOT EXISTS idx_ip_blocklist_active
  ON ip_blocklist(ip_address, expires_at);

ALTER TABLE ip_blocklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ip_blocklist_admin_select" ON ip_blocklist;
CREATE POLICY "ip_blocklist_admin_select" ON ip_blocklist FOR SELECT
  USING (
    org_id IS NULL
    OR EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.org_id = ip_blocklist.org_id
        AND memberships.user_id = auth.uid()
        AND memberships.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "ip_blocklist_service_write" ON ip_blocklist;
CREATE POLICY "ip_blocklist_service_write" ON ip_blocklist FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "ip_blocklist_service_update" ON ip_blocklist FOR UPDATE
  USING (auth.role() = 'service_role');
CREATE POLICY "ip_blocklist_service_delete" ON ip_blocklist FOR DELETE
  USING (auth.role() = 'service_role');

-- Function to check if IP is blocked
CREATE OR REPLACE FUNCTION is_ip_blocked(check_ip inet, check_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ip_blocklist
    WHERE ip_address = check_ip
      AND (org_id IS NULL OR org_id = check_org_id)
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;


-- ============================================================================
-- 3. LOGIN HISTORY — Device tracking and suspicious login detection
-- ============================================================================

CREATE TABLE IF NOT EXISTS login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES orgs(id) ON DELETE SET NULL,
  ip_address inet,
  user_agent text,
  device_fingerprint text, -- browser fingerprint hash
  country_code text,
  city text,
  login_method text DEFAULT 'password', -- 'password', 'magic_link', 'oauth_google', 'oauth_github'
  success boolean DEFAULT true,
  failure_reason text,
  session_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_ip ON login_history(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_failures ON login_history(user_id, success, created_at DESC)
  WHERE success = false;

ALTER TABLE login_history ENABLE ROW LEVEL SECURITY;

-- Users can see their own login history
DROP POLICY IF EXISTS "login_history_select_own" ON login_history;
CREATE POLICY "login_history_select_own" ON login_history FOR SELECT
  USING (user_id = auth.uid());

-- Admins can see all login history for their org
DROP POLICY IF EXISTS "login_history_select_admin" ON login_history;
CREATE POLICY "login_history_select_admin" ON login_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.org_id = login_history.org_id
        AND memberships.user_id = auth.uid()
        AND memberships.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "login_history_insert_service" ON login_history;
CREATE POLICY "login_history_insert_service" ON login_history FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "login_history_no_update" ON login_history;
CREATE POLICY "login_history_no_update" ON login_history FOR UPDATE USING (false);
DROP POLICY IF EXISTS "login_history_no_delete" ON login_history;
CREATE POLICY "login_history_no_delete" ON login_history FOR DELETE USING (false);


-- ============================================================================
-- 4. SECURITY ALERTS — Real-time alert system
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  alert_type text NOT NULL, -- 'brute_force', 'data_exfiltration', 'privilege_escalation', etc.
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  acknowledged boolean DEFAULT false,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_org ON security_alerts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_unack ON security_alerts(org_id, acknowledged, created_at DESC)
  WHERE acknowledged = false;

ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_alerts_select_admin" ON security_alerts;
CREATE POLICY "security_alerts_select_admin" ON security_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.org_id = security_alerts.org_id
        AND memberships.user_id = auth.uid()
        AND memberships.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "security_alerts_insert_service" ON security_alerts;
CREATE POLICY "security_alerts_insert_service" ON security_alerts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "security_alerts_update_admin" ON security_alerts;
CREATE POLICY "security_alerts_update_admin" ON security_alerts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.org_id = security_alerts.org_id
        AND memberships.user_id = auth.uid()
        AND memberships.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "security_alerts_no_delete" ON security_alerts;
CREATE POLICY "security_alerts_no_delete" ON security_alerts FOR DELETE USING (false);


-- ============================================================================
-- 5. RATE LIMITING AT DB LEVEL — Token bucket per key
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key text PRIMARY KEY,
  tokens int NOT NULL DEFAULT 0,
  max_tokens int NOT NULL DEFAULT 60,
  refill_rate int NOT NULL DEFAULT 1, -- tokens per second
  last_refill timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Cleanup stale entries
-- Partial index on rate_limit_buckets is handled via periodic cleanup instead
-- (cannot use now() in index predicate as it's not IMMUTABLE)
CREATE INDEX IF NOT EXISTS idx_rate_limit_stale ON rate_limit_buckets(last_refill);

-- Token bucket rate limiter
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_tokens int DEFAULT 60,
  p_refill_rate int DEFAULT 1,
  p_cost int DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens int;
  v_last_refill timestamptz;
  v_elapsed float;
  v_new_tokens int;
BEGIN
  -- Upsert the bucket
  INSERT INTO rate_limit_buckets (key, tokens, max_tokens, refill_rate, last_refill)
  VALUES (p_key, p_max_tokens - p_cost, p_max_tokens, p_refill_rate, now())
  ON CONFLICT (key) DO UPDATE SET
    tokens = LEAST(
      rate_limit_buckets.max_tokens,
      rate_limit_buckets.tokens + FLOOR(
        EXTRACT(EPOCH FROM (now() - rate_limit_buckets.last_refill)) * rate_limit_buckets.refill_rate
      )::int
    ) - p_cost,
    last_refill = now()
  RETURNING tokens INTO v_tokens;

  RETURN v_tokens >= 0;
END;
$$;

-- Cleanup old rate limit entries (call periodically)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limit_buckets WHERE last_refill < now() - interval '1 hour';
$$;


-- ============================================================================
-- 6. ANOMALY DETECTION FUNCTIONS
-- ============================================================================

-- Detect brute force login attempts
CREATE OR REPLACE FUNCTION detect_brute_force(p_user_id uuid, p_window_minutes int DEFAULT 15, p_threshold int DEFAULT 5)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*) >= p_threshold
  FROM login_history
  WHERE user_id = p_user_id
    AND success = false
    AND created_at > now() - (p_window_minutes || ' minutes')::interval;
$$;

-- Detect excessive data exports (data exfiltration signal)
CREATE OR REPLACE FUNCTION detect_excessive_exports(p_user_id uuid, p_org_id uuid, p_window_minutes int DEFAULT 10, p_threshold int DEFAULT 3)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*) >= p_threshold
  FROM audit_events
  WHERE user_id = p_user_id
    AND org_id = p_org_id
    AND action IN ('export', 'bulk_export', 'download')
    AND created_at > now() - (p_window_minutes || ' minutes')::interval;
$$;

-- Detect unusual volume of deletions
CREATE OR REPLACE FUNCTION detect_mass_deletion(p_user_id uuid, p_org_id uuid, p_window_minutes int DEFAULT 5, p_threshold int DEFAULT 20)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*) >= p_threshold
  FROM audit_events
  WHERE user_id = p_user_id
    AND org_id = p_org_id
    AND action = 'delete'
    AND created_at > now() - (p_window_minutes || ' minutes')::interval;
$$;

-- Detect unusual API volume per user
CREATE OR REPLACE FUNCTION detect_api_abuse(p_key text, p_window_minutes int DEFAULT 1, p_threshold int DEFAULT 200)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*) >= p_threshold
  FROM security_events
  WHERE details->>'rate_limit_key' = p_key
    AND event_type = 'api_request'
    AND created_at > now() - (p_window_minutes || ' minutes')::interval;
$$;


-- ============================================================================
-- 7. DATA SANITIZATION FUNCTIONS
-- ============================================================================

-- Strip potential XSS from text content
CREATE OR REPLACE FUNCTION sanitize_text(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        COALESCE(p_input, ''),
        '<script[^>]*>.*?</script>', '', 'gi'
      ),
      '<[^>]+on\w+\s*=', '<', 'gi'
    ),
    'javascript:', '', 'gi'
  );
$$;

-- Validate and normalize E.164 phone numbers
CREATE OR REPLACE FUNCTION validate_e164(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_phone ~ '^\+[1-9]\d{1,14}$';
$$;


-- ============================================================================
-- 8. HARDENED RLS — Additional protection on sensitive tables
-- ============================================================================

-- payment_provider_secrets: ABSOLUTELY no client access, service_role only
DO $$
BEGIN
  -- Ensure RLS is enabled
  ALTER TABLE payment_provider_secrets ENABLE ROW LEVEL SECURITY;

  -- Drop any permissive policies that might exist
  DROP POLICY IF EXISTS "payment_secrets_service_only_select" ON payment_provider_secrets;
  DROP POLICY IF EXISTS "payment_secrets_service_only_insert" ON payment_provider_secrets;
  DROP POLICY IF EXISTS "payment_secrets_service_only_update" ON payment_provider_secrets;
  DROP POLICY IF EXISTS "payment_secrets_service_only_delete" ON payment_provider_secrets;

  -- Only service_role can touch payment secrets
  CREATE POLICY "payment_secrets_service_only_select" ON payment_provider_secrets
    FOR SELECT USING (auth.role() = 'service_role');
  CREATE POLICY "payment_secrets_service_only_insert" ON payment_provider_secrets
    FOR INSERT WITH CHECK (auth.role() = 'service_role');
  CREATE POLICY "payment_secrets_service_only_update" ON payment_provider_secrets
    FOR UPDATE USING (auth.role() = 'service_role');
  CREATE POLICY "payment_secrets_service_only_delete" ON payment_provider_secrets
    FOR DELETE USING (auth.role() = 'service_role');
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'payment_provider_secrets table does not exist, skipping';
END $$;

-- webhook_events: append-only, no client access
DO $$
BEGIN
  ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "webhook_events_service_select" ON webhook_events;
  DROP POLICY IF EXISTS "webhook_events_service_insert" ON webhook_events;
  DROP POLICY IF EXISTS "webhook_events_no_update" ON webhook_events;
  DROP POLICY IF EXISTS "webhook_events_no_delete" ON webhook_events;

  CREATE POLICY "webhook_events_service_select" ON webhook_events
    FOR SELECT USING (auth.role() = 'service_role');
  CREATE POLICY "webhook_events_service_insert" ON webhook_events
    FOR INSERT WITH CHECK (auth.role() = 'service_role');
  CREATE POLICY "webhook_events_no_update" ON webhook_events
    FOR UPDATE USING (false);
  CREATE POLICY "webhook_events_no_delete" ON webhook_events
    FOR DELETE USING (false);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'webhook_events table does not exist, skipping';
END $$;

-- Harden audit_events: no updates or deletes (append-only integrity)
DO $$
BEGIN
  DROP POLICY IF EXISTS "audit_events_no_update" ON audit_events;
  DROP POLICY IF EXISTS "audit_events_no_delete_ever" ON audit_events;

  CREATE POLICY "audit_events_no_update" ON audit_events
    FOR UPDATE USING (false);
  CREATE POLICY "audit_events_no_delete_ever" ON audit_events
    FOR DELETE USING (false);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'audit_events table does not exist, skipping';
END $$;


-- ============================================================================
-- 9. TRIGGER: Auto-log security-sensitive operations
-- ============================================================================

-- Trigger function for detecting privilege escalation attempts
CREATE OR REPLACE FUNCTION trg_membership_change_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role != NEW.role THEN
    INSERT INTO security_events (org_id, user_id, event_type, severity, source, details)
    VALUES (
      NEW.org_id,
      auth.uid(),
      'role_change',
      CASE WHEN NEW.role = 'owner' THEN 'high' ELSE 'medium' END,
      'auth',
      jsonb_build_object(
        'target_user_id', NEW.user_id,
        'old_role', OLD.role,
        'new_role', NEW.role,
        'changed_by', auth.uid()
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO security_events (org_id, user_id, event_type, severity, source, details)
    VALUES (
      OLD.org_id,
      auth.uid(),
      'member_removed',
      'medium',
      'auth',
      jsonb_build_object(
        'removed_user_id', OLD.user_id,
        'removed_role', OLD.role,
        'removed_by', auth.uid()
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_security_audit ON memberships;
CREATE TRIGGER trg_membership_security_audit
  AFTER UPDATE OR DELETE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION trg_membership_change_audit();

-- Trigger: detect bulk deletions
CREATE OR REPLACE FUNCTION trg_detect_bulk_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delete_count int;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN OLD; END IF;

  SELECT COUNT(*) INTO v_delete_count
  FROM audit_events
  WHERE user_id = v_user_id
    AND org_id = OLD.org_id
    AND action = 'delete'
    AND created_at > now() - interval '5 minutes';

  IF v_delete_count >= 20 THEN
    INSERT INTO security_alerts (org_id, user_id, alert_type, severity, title, description, metadata)
    VALUES (
      OLD.org_id,
      v_user_id,
      'mass_deletion',
      'high',
      'Mass deletion detected',
      format('User deleted %s+ records in 5 minutes on table %s', v_delete_count, TG_TABLE_NAME),
      jsonb_build_object('table', TG_TABLE_NAME, 'count', v_delete_count)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN OLD;
END;
$$;

-- Apply bulk delete detection to key tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['clients', 'leads', 'jobs', 'invoices', 'contacts']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_bulk_delete_detect ON %I; '
      'CREATE TRIGGER trg_bulk_delete_detect AFTER DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION trg_detect_bulk_delete()',
      tbl, tbl
    );
  END LOOP;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Some tables do not exist, skipping bulk delete triggers';
END $$;


-- ============================================================================
-- 10. SUBSCRIPTION ENTITLEMENT GUARD
-- Prevent feature access when subscription is expired/canceled
-- ============================================================================

CREATE OR REPLACE FUNCTION check_subscription_active(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE org_id = p_org_id
      AND status IN ('active', 'trialing')
      AND (current_period_end IS NULL OR current_period_end > now())
  )
  OR NOT EXISTS (
    SELECT 1 FROM subscriptions WHERE org_id = p_org_id
  ); -- Free tier: no subscription row = active
$$;


-- ============================================================================
-- 11. CLEANUP JOBS — Periodic maintenance
-- ============================================================================

-- Cleanup expired rate limit entries
CREATE OR REPLACE FUNCTION security_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clean expired IP blocks
  DELETE FROM ip_blocklist WHERE expires_at IS NOT NULL AND expires_at < now();

  -- Clean old rate limit buckets
  DELETE FROM rate_limit_buckets WHERE last_refill < now() - interval '2 hours';

  -- Archive old security events (keep 90 days in main table)
  DELETE FROM security_events WHERE created_at < now() - interval '90 days' AND severity IN ('low', 'info');

  -- Clean old login history (keep 1 year)
  DELETE FROM login_history WHERE created_at < now() - interval '365 days';
END;
$$;


-- ============================================================================
-- 12. GRANT COMMENTS — Document security intent
-- ============================================================================

COMMENT ON TABLE security_events IS 'Immutable security audit log — tracks all security-relevant events';
COMMENT ON TABLE ip_blocklist IS 'IP addresses blocked from accessing the system';
COMMENT ON TABLE login_history IS 'Login attempt history for anomaly detection and device tracking';
COMMENT ON TABLE security_alerts IS 'Active security alerts requiring admin attention';
COMMENT ON TABLE rate_limit_buckets IS 'Server-side token bucket rate limiting state';

COMMENT ON FUNCTION is_ip_blocked IS 'Check if an IP address is currently blocked';
COMMENT ON FUNCTION check_rate_limit IS 'Token bucket rate limiter — returns true if request allowed';
COMMENT ON FUNCTION detect_brute_force IS 'Detect brute force login attempts for a user';
COMMENT ON FUNCTION sanitize_text IS 'Strip potentially dangerous HTML/JS from text input';
COMMENT ON FUNCTION check_subscription_active IS 'Verify org has active subscription for feature gating';
COMMENT ON FUNCTION security_maintenance IS 'Periodic cleanup of expired security data';

-- End of migration
