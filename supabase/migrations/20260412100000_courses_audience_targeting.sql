-- ============================================================
-- Courses: audience targeting (roles + specific users)
-- ============================================================

-- Target roles: which roles can see this course
-- Stored as a JSONB array, e.g. ["sales_rep", "technician"]
-- Empty array or null = use visibility rule ('all' or 'assigned')
ALTER TABLE courses ADD COLUMN IF NOT EXISTS target_roles jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Target user IDs: specific users who can see this course (beyond role-based)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS target_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Index for filtering courses by audience
CREATE INDEX IF NOT EXISTS idx_courses_target_roles ON courses USING gin (target_roles);
CREATE INDEX IF NOT EXISTS idx_courses_target_user_ids ON courses USING gin (target_user_ids);

-- Add admin read policy for course_progress (admins can see team progress)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'course_progress_admin_select'
  ) THEN
    CREATE POLICY course_progress_admin_select ON course_progress FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM memberships om
          JOIN courses c ON c.id = course_progress.course_id
          WHERE om.user_id = auth.uid()
            AND om.org_id = c.org_id
            AND om.role IN ('owner', 'admin')
        )
      );
  END IF;
END $$;
