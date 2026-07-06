-- ============================================================
-- Requests page v2: on-site assessment scheduling + archive +
-- soft delete on form_submissions.
--
-- assessment_*  → "On-site assessment" section on /requests/:id
-- archived_at   → "Archive" action in the More menu
-- deleted_at    → "Delete" action (soft delete, per project rule)
-- ============================================================

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS assessment_start_at    timestamptz,
  ADD COLUMN IF NOT EXISTS assessment_end_at      timestamptz,
  ADD COLUMN IF NOT EXISTS assessment_team_id     uuid REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assessment_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assessment_instructions text,
  ADD COLUMN IF NOT EXISTS archived_at            timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at             timestamptz;

CREATE INDEX IF NOT EXISTS idx_form_submissions_active
  ON form_submissions (org_id, created_at DESC)
  WHERE deleted_at IS NULL;
