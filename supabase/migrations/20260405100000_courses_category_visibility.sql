-- ============================================================
-- Courses: add category & visibility columns
-- ============================================================

-- Category for filtering/organizing courses
ALTER TABLE courses ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '';

-- Visibility: 'all' = everyone in org, 'assigned' = only assigned users/teams
ALTER TABLE courses ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'all'
  CHECK (visibility IN ('all', 'assigned'));

-- Lesson: add 'pdf' and 'link' content types
ALTER TABLE course_lessons DROP CONSTRAINT IF EXISTS course_lessons_content_type_check;
ALTER TABLE course_lessons ADD CONSTRAINT course_lessons_content_type_check
  CHECK (content_type IN ('video', 'embed', 'text', 'pdf', 'link'));
