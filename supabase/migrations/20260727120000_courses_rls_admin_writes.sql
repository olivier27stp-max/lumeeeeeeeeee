-- =============================================================================
-- Courses RLS hardening — les écritures (INSERT/UPDATE/DELETE) sur les cours,
-- modules et leçons exigent le rôle owner/admin, pas seulement l'appartenance
-- à l'org. Avant ce correctif, un simple membre pouvait modifier des cours via
-- un accès PostgREST direct (les routes serveur, elles, exigeaient déjà admin).
-- Le SELECT reste ouvert à tous les membres (le filtrage d'audience se fait au
-- niveau applicatif).
-- =============================================================================

-- ── courses ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS courses_insert ON courses;
CREATE POLICY courses_insert ON courses FOR INSERT
  WITH CHECK (has_org_admin_role(auth.uid(), org_id));

DROP POLICY IF EXISTS courses_update ON courses;
CREATE POLICY courses_update ON courses FOR UPDATE
  USING (has_org_admin_role(auth.uid(), org_id));

DROP POLICY IF EXISTS courses_delete ON courses;
CREATE POLICY courses_delete ON courses FOR DELETE
  USING (has_org_admin_role(auth.uid(), org_id));

-- ── course_modules (via cours parent) ────────────────────────────────────
DROP POLICY IF EXISTS course_modules_insert ON course_modules;
CREATE POLICY course_modules_insert ON course_modules FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_admin_role(auth.uid(), courses.org_id)
  ));

DROP POLICY IF EXISTS course_modules_update ON course_modules;
CREATE POLICY course_modules_update ON course_modules FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_admin_role(auth.uid(), courses.org_id)
  ));

DROP POLICY IF EXISTS course_modules_delete ON course_modules;
CREATE POLICY course_modules_delete ON course_modules FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_modules.course_id
      AND has_org_admin_role(auth.uid(), courses.org_id)
  ));

-- ── course_lessons (via module → cours parent) ───────────────────────────
DROP POLICY IF EXISTS course_lessons_insert ON course_lessons;
CREATE POLICY course_lessons_insert ON course_lessons FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM course_modules m
      JOIN courses c ON c.id = m.course_id
     WHERE m.id = course_lessons.module_id
       AND has_org_admin_role(auth.uid(), c.org_id)
  ));

DROP POLICY IF EXISTS course_lessons_update ON course_lessons;
CREATE POLICY course_lessons_update ON course_lessons FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM course_modules m
      JOIN courses c ON c.id = m.course_id
     WHERE m.id = course_lessons.module_id
       AND has_org_admin_role(auth.uid(), c.org_id)
  ));

DROP POLICY IF EXISTS course_lessons_delete ON course_lessons;
CREATE POLICY course_lessons_delete ON course_lessons FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM course_modules m
      JOIN courses c ON c.id = m.course_id
     WHERE m.id = course_lessons.module_id
       AND has_org_admin_role(auth.uid(), c.org_id)
  ));

-- ── course_assignments : écriture réservée admin (lecture via app) ────────
DROP POLICY IF EXISTS course_assignments_insert ON course_assignments;
CREATE POLICY course_assignments_insert ON course_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_assignments.course_id
      AND has_org_admin_role(auth.uid(), courses.org_id)
  ));

DROP POLICY IF EXISTS course_assignments_delete ON course_assignments;
CREATE POLICY course_assignments_delete ON course_assignments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM courses WHERE courses.id = course_assignments.course_id
      AND has_org_admin_role(auth.uid(), courses.org_id)
  ));
