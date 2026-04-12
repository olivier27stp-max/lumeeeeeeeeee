-- Allow org admins/owners to read all course_progress for their org members
-- This enables the "Team Progress" view for bosses/admins
-- Note: existing course_progress_select allows user_id = auth.uid()
-- Postgres OR's multiple SELECT policies, so admins get both their own + team data

CREATE POLICY course_progress_admin_select ON course_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
        AND om.org_id IN (
          SELECT c.org_id FROM courses c WHERE c.id = course_progress.course_id
        )
    )
  );
