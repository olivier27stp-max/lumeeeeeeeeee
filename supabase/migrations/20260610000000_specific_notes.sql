-- ════════════════════════════════════════════════════════════════
-- Migration: specific_notes — reusable notes with file attachments
-- Attached to clients, jobs, or quotes
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS specific_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('client', 'job', 'quote')),
  entity_id   uuid NOT NULL,
  text        text,
  files       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- files schema: [{ "name": "...", "url": "...", "path": "...", "file_type": "image|video|document", "size": 123 }]
  tags        text[] DEFAULT '{}',
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast entity lookups
CREATE INDEX idx_specific_notes_entity ON specific_notes (entity_type, entity_id);
CREATE INDEX idx_specific_notes_org    ON specific_notes (org_id);

-- RLS
ALTER TABLE specific_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "specific_notes_select" ON specific_notes
  FOR SELECT USING (has_org_membership(auth.uid(), org_id));

CREATE POLICY "specific_notes_insert" ON specific_notes
  FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));

CREATE POLICY "specific_notes_update" ON specific_notes
  FOR UPDATE USING (has_org_membership(auth.uid(), org_id));

CREATE POLICY "specific_notes_delete" ON specific_notes
  FOR DELETE USING (has_org_membership(auth.uid(), org_id));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_specific_notes_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_specific_notes_updated_at
  BEFORE UPDATE ON specific_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_specific_notes_updated_at();
