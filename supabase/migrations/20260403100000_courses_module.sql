-- ============================================================
-- Courses / LMS module
-- ============================================================

-- 1. Courses
CREATE TABLE IF NOT EXISTS courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  title         text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  cover_image   text,                            -- public URL
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published')),
  created_by    uuid,                            -- user who created
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz                      -- soft delete
);

CREATE INDEX IF NOT EXISTS idx_courses_org ON courses(org_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(org_id, status);

-- 2. Course modules (chapters)
CREATE TABLE IF NOT EXISTS course_modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT '',
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_modules_course ON course_modules(course_id);

-- 3. Lessons
CREATE TABLE IF NOT EXISTS course_lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT '',
  content_type  text NOT NULL DEFAULT 'video'
                  CHECK (content_type IN ('video', 'embed', 'text')),
  video_url     text,
  embed_url     text,                            -- YouTube / Loom / Vimeo
  text_content  text,                            -- rich text (HTML)
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{name, url, type}]
  duration_min  int NOT NULL DEFAULT 0,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_module ON course_lessons(module_id);

-- 4. Course assignments (who can see a course)
CREATE TABLE IF NOT EXISTS course_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id       uuid,                            -- specific user
  team_id       uuid,                            -- or a whole team
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   uuid,
  UNIQUE (course_id, user_id),
  UNIQUE (course_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_course_assignments_course ON course_assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_user ON course_assignments(user_id);

-- 5. User progress tracking
CREATE TABLE IF NOT EXISTS course_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id     uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  completed     boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,
  last_viewed   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_course_progress_user ON course_progress(user_id, course_id);

-- 6. RLS Policies
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_progress ENABLE ROW LEVEL SECURITY;

-- Courses: org members can read, admins/owners can write
CREATE POLICY courses_select ON courses FOR SELECT
  USING (has_org_membership(auth.uid(), org_id));

CREATE POLICY courses_insert ON courses FOR INSERT
  WITH CHECK (has_org_membership(auth.uid(), org_id));

CREATE POLICY courses_update ON courses FOR UPDATE
  USING (has_org_membership(auth.uid(), org_id));

CREATE POLICY courses_delete ON courses FOR DELETE
  USING (has_org_membership(auth.uid(), org_id));

-- Modules: accessible via course org membership
CREATE POLICY course_modules_select ON course_modules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

CREATE POLICY course_modules_insert ON course_modules FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

CREATE POLICY course_modules_update ON course_modules FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

CREATE POLICY course_modules_delete ON course_modules FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

-- Lessons: via module → course
CREATE POLICY course_lessons_select ON course_lessons FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM course_modules m
    JOIN courses c ON c.id = m.course_id
    WHERE m.id = course_lessons.module_id
      AND has_org_membership(auth.uid(), c.org_id)
  ));

CREATE POLICY course_lessons_insert ON course_lessons FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM course_modules m
    JOIN courses c ON c.id = m.course_id
    WHERE m.id = course_lessons.module_id
      AND has_org_membership(auth.uid(), c.org_id)
  ));

CREATE POLICY course_lessons_update ON course_lessons FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM course_modules m
    JOIN courses c ON c.id = m.course_id
    WHERE m.id = course_lessons.module_id
      AND has_org_membership(auth.uid(), c.org_id)
  ));

CREATE POLICY course_lessons_delete ON course_lessons FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM course_modules m
    JOIN courses c ON c.id = m.course_id
    WHERE m.id = course_lessons.module_id
      AND has_org_membership(auth.uid(), c.org_id)
  ));

-- Assignments: org members can read their own, admins can manage
CREATE POLICY course_assignments_select ON course_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_assignments.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

CREATE POLICY course_assignments_insert ON course_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_assignments.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

CREATE POLICY course_assignments_delete ON course_assignments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_assignments.course_id
      AND has_org_membership(auth.uid(), courses.org_id)
  ));

-- Progress: users can manage their own progress
CREATE POLICY course_progress_select ON course_progress FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY course_progress_insert ON course_progress FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY course_progress_update ON course_progress FOR UPDATE
  USING (user_id = auth.uid());
