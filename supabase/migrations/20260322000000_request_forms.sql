-- ============================================================
-- Request Forms: customizable public intake forms
-- ============================================================

-- ── request_forms ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_forms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id),

  -- API key for embed authentication
  api_key      text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex') UNIQUE,

  -- Form settings
  title        text NOT NULL DEFAULT 'Service Request',
  description  text,
  success_message text NOT NULL DEFAULT 'Thank you! We will get back to you shortly.',
  enabled      boolean NOT NULL DEFAULT true,

  -- Custom fields JSON: array of field definitions
  -- Each: { id, label, type, required, options?, section }
  -- type: 'text' | 'dropdown' | 'multiselect' | 'checkbox' | 'number' | 'paragraph'
  -- section: 'service_details' | 'final_notes'
  custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Notification preferences
  notify_email  boolean NOT NULL DEFAULT true,
  notify_in_app boolean NOT NULL DEFAULT true,

  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Each org gets at most one form (can extend later)
CREATE UNIQUE INDEX IF NOT EXISTS idx_request_forms_org
  ON request_forms (org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_request_forms_api_key
  ON request_forms (api_key) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE request_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "request_forms_org_member" ON request_forms
  FOR ALL USING (has_org_membership(auth.uid(), org_id));

-- ── form_submissions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES request_forms(id) ON DELETE CASCADE,

  -- Contact info
  first_name   text NOT NULL,
  last_name    text NOT NULL,
  company      text,
  email        text NOT NULL,
  phone        text NOT NULL,

  -- Address
  street_address text,
  unit          text,
  city          text,
  country       text,
  region        text,   -- state / province / generic region
  postal_code   text,

  -- Custom field responses: { field_id: value }
  custom_responses jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Additional notes
  notes         text,

  -- Link to CRM entities created from this submission
  lead_id       uuid REFERENCES leads(id),
  deal_id       uuid REFERENCES pipeline_deals(id),
  client_id     uuid REFERENCES clients(id),

  -- Anti-spam
  ip_address    text,
  user_agent    text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_org
  ON form_submissions (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form
  ON form_submissions (form_id, created_at DESC);

-- RLS
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_submissions_org_member" ON form_submissions
  FOR ALL USING (has_org_membership(auth.uid(), org_id));
