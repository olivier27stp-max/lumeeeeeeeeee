-- =============================================================================
-- Field Sales Module Migration
-- Created: 2026-03-25
-- Tables: field_territories, field_house_profiles, field_house_events,
--         field_pins, field_daily_stats, field_pin_templates, field_settings
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. field_territories (created before field_house_profiles due to FK ref)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_territories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  name                text NOT NULL,
  color               text DEFAULT '#6366f1',
  polygon_geojson     jsonb NOT NULL,
  assigned_team_id    uuid REFERENCES teams(id) ON DELETE SET NULL,
  assigned_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_exclusive        boolean DEFAULT false,
  stats_knocks        int DEFAULT 0,
  stats_leads         int DEFAULT 0,
  stats_sales         int DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_field_territories_org_id
  ON field_territories (org_id);

CREATE INDEX IF NOT EXISTS idx_field_territories_org_deleted
  ON field_territories (org_id, deleted_at);

-- ---------------------------------------------------------------------------
-- 2. field_house_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_house_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  address             text NOT NULL,
  address_normalized  text,
  lat                 double precision,
  lng                 double precision,
  place_id            text,
  current_status      text NOT NULL DEFAULT 'unknown'
                        CHECK (current_status IN (
                          'unknown','not_interested','no_answer','lead',
                          'quote_sent','sale','callback','do_not_knock','revisit'
                        )),
  house_score         text DEFAULT 'cold'
                        CHECK (house_score IN ('cold','warm','hot')),
  territory_id        uuid REFERENCES field_territories(id) ON DELETE SET NULL,
  assigned_user_id    uuid REFERENCES auth.users(id),
  lead_id             uuid,
  client_id           uuid,
  next_action         text,
  next_action_date    timestamptz,
  visit_count         int DEFAULT 0,
  last_activity_at    timestamptz,
  metadata            jsonb DEFAULT '{}',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz
);

-- Partial unique index: no duplicate normalized addresses per org (excluding soft-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_house_profiles_org_addr_unique
  ON field_house_profiles (org_id, address_normalized)
  WHERE deleted_at IS NULL;

-- Geo query index
CREATE INDEX IF NOT EXISTS idx_field_house_profiles_geo
  ON field_house_profiles (org_id, lat, lng);

-- Status filter index
CREATE INDEX IF NOT EXISTS idx_field_house_profiles_status
  ON field_house_profiles (org_id, current_status);

-- Territory filter index
CREATE INDEX IF NOT EXISTS idx_field_house_profiles_territory
  ON field_house_profiles (org_id, territory_id);

-- ---------------------------------------------------------------------------
-- 3. field_house_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_house_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  house_id            uuid NOT NULL REFERENCES field_house_profiles(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id),
  event_type          text NOT NULL
                        CHECK (event_type IN (
                          'knock','no_answer','lead','quote_sent','sale','note',
                          'revisit','callback','do_not_knock','status_change'
                        )),
  note_text           text,
  note_voice_url      text,
  ai_summary          text,
  metadata            jsonb DEFAULT '{}',
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_house_events_house_time
  ON field_house_events (house_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_house_events_org_time
  ON field_house_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_house_events_user_time
  ON field_house_events (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. field_pins
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_pins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  house_id    uuid NOT NULL REFERENCES field_house_profiles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  status      text NOT NULL
                CHECK (status IN (
                  'unknown','not_interested','no_answer','lead',
                  'quote_sent','sale','callback','do_not_knock','revisit'
                )),
  has_note    boolean DEFAULT false,
  priority    int DEFAULT 0,
  pin_color   text,
  pin_icon    text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (org_id, house_id)
);

CREATE INDEX IF NOT EXISTS idx_field_pins_org_id
  ON field_pins (org_id);

CREATE INDEX IF NOT EXISTS idx_field_pins_user_id
  ON field_pins (user_id);

-- ---------------------------------------------------------------------------
-- 5. field_daily_stats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_daily_stats (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  user_id           uuid NOT NULL REFERENCES auth.users(id),
  date              date NOT NULL,
  knocks            int DEFAULT 0,
  no_answers        int DEFAULT 0,
  leads             int DEFAULT 0,
  quotes_sent       int DEFAULT 0,
  sales             int DEFAULT 0,
  callbacks         int DEFAULT 0,
  conversion_rate   numeric(5,2) DEFAULT 0,
  revenue_cents     bigint DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_field_daily_stats_org_date
  ON field_daily_stats (org_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_field_daily_stats_user
  ON field_daily_stats (user_id, date DESC);

-- ---------------------------------------------------------------------------
-- 6. field_pin_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_pin_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  label           text NOT NULL,
  icon            text DEFAULT 'pin',
  color           text DEFAULT '#6b7280',
  affects_stats   boolean DEFAULT true,
  sort_order      int DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_pin_templates_org_id
  ON field_pin_templates (org_id, sort_order);

-- ---------------------------------------------------------------------------
-- 7. field_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_settings (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          uuid NOT NULL UNIQUE REFERENCES orgs(id),
  feature_enabled                 boolean DEFAULT false,
  territory_restriction_enabled   boolean DEFAULT false,
  auto_revisit_days               int DEFAULT 3,
  auto_followup_days              int DEFAULT 1,
  voice_notes_enabled             boolean DEFAULT true,
  ai_summaries_enabled            boolean DEFAULT false,
  default_pin_template_id         uuid,
  automation_defaults             jsonb DEFAULT '{}',
  created_at                      timestamptz DEFAULT now(),
  updated_at                      timestamptz DEFAULT now()
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE field_territories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_house_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_house_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_pins             ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_daily_stats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_pin_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_settings         ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- field_territories RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_territories_service_full_access"
  ON field_territories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_territories_select"
  ON field_territories
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_territories_insert"
  ON field_territories
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_territories_update"
  ON field_territories
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- field_house_profiles RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_house_profiles_service_full_access"
  ON field_house_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_house_profiles_select"
  ON field_house_profiles
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_house_profiles_insert"
  ON field_house_profiles
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_house_profiles_update"
  ON field_house_profiles
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- field_house_events RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_house_events_service_full_access"
  ON field_house_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_house_events_select"
  ON field_house_events
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_house_events_insert"
  ON field_house_events
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_house_events_update"
  ON field_house_events
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- field_pins RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_pins_service_full_access"
  ON field_pins
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_pins_select"
  ON field_pins
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_pins_insert"
  ON field_pins
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_pins_update"
  ON field_pins
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- field_daily_stats RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_daily_stats_service_full_access"
  ON field_daily_stats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_daily_stats_select"
  ON field_daily_stats
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_daily_stats_insert"
  ON field_daily_stats
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_daily_stats_update"
  ON field_daily_stats
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- field_pin_templates RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_pin_templates_service_full_access"
  ON field_pin_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_pin_templates_select"
  ON field_pin_templates
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_pin_templates_insert"
  ON field_pin_templates
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_pin_templates_update"
  ON field_pin_templates
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- field_settings RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "field_settings_service_full_access"
  ON field_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "field_settings_select"
  ON field_settings
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_settings_insert"
  ON field_settings
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "field_settings_update"
  ON field_settings
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- field_compute_house_score(p_house_id uuid) → text
-- Computes 'hot', 'warm', or 'cold' based on recent visit activity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION field_compute_house_score(p_house_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_visit_count       int;
  v_has_lead_status   boolean;
  v_last_activity     timestamptz;
BEGIN
  -- Count events in the last 30 days for this house
  SELECT COUNT(*)
  INTO v_visit_count
  FROM field_house_events
  WHERE house_id = p_house_id
    AND created_at >= now() - interval '30 days';

  -- Check whether the house currently has a lead-level status
  SELECT
    (current_status = 'lead'),
    last_activity_at
  INTO v_has_lead_status, v_last_activity
  FROM field_house_profiles
  WHERE id = p_house_id;

  -- Score logic
  IF v_visit_count >= 3 AND v_has_lead_status IS TRUE THEN
    RETURN 'hot';
  ELSIF v_visit_count >= 2
     OR (v_last_activity IS NOT NULL AND v_last_activity >= now() - interval '7 days')
  THEN
    RETURN 'warm';
  ELSE
    RETURN 'cold';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- field_compute_next_action(p_house_id uuid) → text
-- Returns a suggested next-action string based on current_status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION field_compute_next_action(p_house_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT current_status
  INTO v_status
  FROM field_house_profiles
  WHERE id = p_house_id;

  RETURN CASE v_status
    WHEN 'no_answer'   THEN 'Revisit in 2 days'
    WHEN 'lead'        THEN 'Follow up'
    WHEN 'quote_sent'  THEN 'Check if quote opened'
    WHEN 'callback'    THEN 'Call back'
    WHEN 'sale'        THEN 'Send thank you'
    ELSE NULL
  END;
END;
$$;
