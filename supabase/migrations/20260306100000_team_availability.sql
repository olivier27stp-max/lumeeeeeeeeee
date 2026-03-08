-- Team availability: defines working hours per team per weekday
CREATE TABLE IF NOT EXISTS team_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  start_minute int NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute int NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  timezone text NOT NULL DEFAULT 'America/Toronto',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_time_range CHECK (end_minute > start_minute),
  UNIQUE(team_id, weekday, start_minute)
);

-- RLS
ALTER TABLE team_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_availability_org_read" ON team_availability
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "team_availability_org_write" ON team_availability
  FOR ALL USING (
    org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
  );

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_team_availability_team_weekday
  ON team_availability(team_id, weekday) WHERE deleted_at IS NULL;

-- View for active availability
CREATE OR REPLACE VIEW team_availability_active AS
  SELECT * FROM team_availability WHERE deleted_at IS NULL;

-- Batch archive clients RPC
CREATE OR REPLACE FUNCTION batch_soft_delete_clients(
  p_org_id uuid,
  p_client_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_now timestamptz := now();
BEGIN
  UPDATE clients
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = ANY(p_client_ids)
    AND org_id = p_org_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also soft-delete related jobs
  UPDATE jobs
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = ANY(p_client_ids)
    AND org_id = p_org_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object('archived_clients', v_count);
END;
$$;

-- Auto-convert lead to deal+job RPC
CREATE OR REPLACE FUNCTION auto_convert_lead_to_deal_and_job(
  p_lead_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead record;
  v_org_id uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
  v_full_name text;
BEGIN
  -- Get lead
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  v_org_id := v_lead.org_id;
  v_full_name := COALESCE(NULLIF(trim(v_lead.first_name || ' ' || v_lead.last_name), ''), 'Unknown');

  -- Create or find client
  SELECT id INTO v_client_id
  FROM clients
  WHERE org_id = v_org_id
    AND email = v_lead.email
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO clients (org_id, first_name, last_name, email, phone, address, status)
    VALUES (v_org_id, v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone, v_lead.address, 'active')
    RETURNING id INTO v_client_id;
  END IF;

  -- Create job
  INSERT INTO jobs (
    org_id, lead_id, client_id, client_name, title,
    property_address, status, total_amount, total_cents, currency
  )
  VALUES (
    v_org_id, p_lead_id, v_client_id, v_full_name,
    COALESCE(v_lead.title, v_lead.company, 'Job for ' || v_full_name),
    COALESCE(v_lead.address, '-'), 'draft',
    COALESCE(v_lead.value, 0), COALESCE(v_lead.value, 0) * 100, 'CAD'
  )
  RETURNING id INTO v_job_id;

  -- Create pipeline deal
  INSERT INTO pipeline_deals (org_id, lead_id, client_id, job_id, title, value, stage)
  VALUES (
    v_org_id, p_lead_id, v_client_id, v_job_id,
    COALESCE(v_lead.title, v_lead.company, 'Deal for ' || v_full_name),
    COALESCE(v_lead.value, 0), 'Qualified'
  )
  RETURNING id INTO v_deal_id;

  -- Mark lead as converted
  UPDATE leads
  SET converted_to_client_id = v_client_id,
      converted_at = now(),
      status = 'won',
      updated_at = now()
  WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'client_id', v_client_id,
    'job_id', v_job_id,
    'deal_id', v_deal_id,
    'lead_id', p_lead_id
  );
END;
$$;
