import express from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';

const router = express.Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// ── Auto-migrate: ensure tables exist on first request ──
let tablesReady = false;
let hasTargetingColumns = false;
let hasVisibilityColumn = false;
let hasCategoryColumn = false;

async function checkTargetingColumns() {
  if (hasTargetingColumns) return;
  const admin = getServiceClient();
  const { error } = await admin.from('courses').select('target_roles').limit(1);
  hasTargetingColumns = !error;
  if (!hasTargetingColumns) {
    console.log('[courses] target_roles column not found — audience targeting features disabled until migration is applied.');
    console.log('[courses] Apply: supabase/migrations/20260412100000_courses_audience_targeting.sql');
  }
}

async function checkOptionalColumns() {
  const admin = getServiceClient();
  if (!hasVisibilityColumn) {
    const { error } = await admin.from('courses').select('visibility').limit(1);
    hasVisibilityColumn = !error;
    if (!hasVisibilityColumn) {
      console.log('[courses] visibility column not found — treating all courses as visibility=all.');
    }
  }
  if (!hasCategoryColumn) {
    const { error } = await admin.from('courses').select('category').limit(1);
    hasCategoryColumn = !error;
    if (!hasCategoryColumn) {
      console.log('[courses] category column not found — category filter disabled.');
    }
  }
}

async function ensureTables() {
  if (tablesReady) return;
  const admin = getServiceClient();
  const { error } = await admin.from('courses').select('id').limit(1);
  if (!error) { tablesReady = true; await checkTargetingColumns(); await checkOptionalColumns(); return; }
  if (error.code !== 'PGRST205' && error.code !== '42P01' && !error.message.includes('schema cache') && !error.message.includes('relation') ) {
    console.warn('[courses] ensureTables check returned unexpected error:', error.code, error.message);
    tablesReady = true;
    return;
  }

  console.log('[courses] Tables not found, attempting auto-migration...');
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    try {
      const pg = await import('pg');
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.default.dirname(__filename);
      const sqlPath = path.default.resolve(__dirname, '../../supabase/migrations/20260403100000_courses_module.sql');
      const sql = fs.default.readFileSync(sqlPath, 'utf8');
      const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log('[courses] Migration applied successfully!');
      tablesReady = true;
      return;
    } catch (e: any) {
      console.error('[courses] Migration via DATABASE_URL failed:', e.message);
    }
  }

  console.warn(
    '[courses] Tables not found and no DATABASE_URL set. Apply migration manually:\n' +
    '  1. Supabase Dashboard > SQL Editor\n' +
    '  2. Paste: supabase/migrations/20260403100000_courses_module.sql\n' +
    '  3. Run'
  );
  tablesReady = true;
}

// ── helpers ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(v: string | undefined): boolean { return !!v && UUID_RE.test(v); }

/** Check if user is org admin/owner */
async function requireAdmin(req: express.Request, res: express.Response) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const isAdmin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
  if (!isAdmin) {
    // Log for debugging
    const svc = getServiceClient();
    const { data: membership } = await svc.from('memberships').select('role').eq('org_id', auth.orgId).eq('user_id', auth.user.id).maybeSingle();
    console.warn(`[courses] requireAdmin denied: userId=${auth.user.id}, orgId=${auth.orgId}, role=${membership?.role || 'NOT_FOUND'}`);
    res.status(403).json({ error: `Admin access required. Your role: ${membership?.role || 'unknown'}` });
    return null;
  }
  return auth;
}

/** Check if user can edit a specific course (admin/owner OR creator) */
async function canEditCourse(userId: string, orgId: string, courseId: string): Promise<boolean> {
  const admin = getServiceClient();

  // The course MUST belong to this org — otherwise deny outright. This is the
  // tenant-isolation gate: without it, an admin/owner of org A could edit a
  // course/lesson/module belonging to org B just by supplying its UUID.
  const { data: course } = await admin
    .from('courses')
    .select('created_by, org_id')
    .eq('id', courseId)
    .maybeSingle();

  if (!course || course.org_id !== orgId) return false;

  // Admin/owner of the owning org can edit
  const { data: member } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (member && (member.role === 'owner' || member.role === 'admin')) return true;

  // Otherwise, only the creator can edit
  return course.created_by === userId;
}

/** Check if user can edit — returns auth or sends 403 */
async function requireEditor(req: express.Request, res: express.Response, courseId: string) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const allowed = await canEditCourse(auth.user.id, auth.orgId, courseId);
  if (!allowed) {
    res.status(403).json({ error: 'You do not have permission to edit this course.' });
    return null;
  }
  return auth;
}

/**
 * Peut-on VOIR ce cours ? Doit refuser EXACTEMENT ce que le filtre de la liste
 * (`GET /courses`) cache — sinon un non-admin ouvrirait par URL directe un
 * brouillon ou un cours qui ne lui est pas destiné. Cette fonction est la source
 * de vérité unique pour l'accès en lecture (liste + détail).
 */
async function canViewCourse(userId: string, orgId: string, course: any): Promise<boolean> {
  const admin = getServiceClient();

  const { data: member } = await admin
    .from('memberships')
    .select('role, team_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!member) return false;

  // Admin/owner voient tout ; le créateur voit toujours son cours.
  if (member.role === 'owner' || member.role === 'admin') return true;
  if (course.created_by === userId) return true;

  // Brouillon: réservé admin/owner/créateur (déjà écartés ci-dessus).
  if (course.status === 'draft') return false;

  const visibility = course.visibility || 'all';
  const targetRoles: string[] = Array.isArray(course.target_roles) ? course.target_roles : [];
  const targetUserIds: string[] = Array.isArray(course.target_user_ids) ? course.target_user_ids : [];
  const hasTargeting = targetRoles.length > 0 || targetUserIds.length > 0;

  // Ciblage direct (rôle ou user) — vaut pour 'all' ciblé et 'assigned'.
  if (targetUserIds.includes(userId)) return true;
  if (targetRoles.length > 0 && targetRoles.includes(member.role)) return true;

  // Cours ouvert à tous, sans ciblage.
  if (visibility === 'all' && !hasTargeting) return true;

  // Assignations explicites (par user OU par équipe du membre).
  const { data: assignments } = await admin
    .from('course_assignments')
    .select('id, user_id, team_id')
    .eq('course_id', course.id);
  const teamId = (member as any).team_id ?? null;
  if ((assignments || []).some((a: any) => a.user_id === userId || (teamId && a.team_id === teamId))) return true;

  return false;
}

// ════════════════════════════════════════════════════════════════
// COURSES CRUD
// ════════════════════════════════════════════════════════════════

/** GET /api/courses — list courses for the org (filtered by audience) */
router.get('/courses', async (req, res) => {
  try {
    await ensureTables();
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!auth.orgId || !isUUID(auth.orgId)) return res.status(403).json({ error: 'No valid organization context.' });
    const admin = getServiceClient();
    const { status, q } = req.query as { status?: string; q?: string };

    let query = admin
      .from('courses')
      .select('*')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') query = query.eq('status', status);
    if (q) query = query.ilike('title', `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;

    // Get user's role for audience filtering
    const { data: member } = await admin
      .from('memberships')
      .select('role')
      .eq('org_id', auth.orgId)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const userRole = member?.role || 'member';
    const isAdminOrOwner = userRole === 'owner' || userRole === 'admin';

    // Filter courses by audience targeting (admin/owner see all)
    const visibleCourses = isAdminOrOwner
      ? (data || [])
      : (data || []).filter((c: any) => {
          // Creator can always see their course
          if (c.created_by === auth.user.id) return true;

          // Draft courses are only visible to admins/owners/creator
          if (c.status === 'draft') return false;

          const targetRoles: string[] = Array.isArray(c.target_roles) ? c.target_roles : [];
          const targetUserIds: string[] = Array.isArray(c.target_user_ids) ? c.target_user_ids : [];
          const hasTargeting = targetRoles.length > 0 || targetUserIds.length > 0;
          const visibility = c.visibility || 'all';

          if (visibility === 'all' && !hasTargeting) return true;
          if (targetUserIds.includes(auth.user.id)) return true;
          if (targetRoles.length > 0 && targetRoles.includes(userRole)) return true;
          if (!hasTargeting && visibility === 'all') return true;

          return false;
        });

    // Attach module/lesson counts
    const courseIds = visibleCourses.map((c: any) => c.id);
    if (courseIds.length === 0) return res.json([]);

    const { data: modules } = await admin
      .from('course_modules')
      .select('id, course_id')
      .in('course_id', courseIds);

    const moduleIds = (modules || []).map((m: any) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await admin.from('course_lessons').select('id, module_id, duration_min').in('module_id', moduleIds)
      : { data: [] };

    const moduleByCourse: Record<string, string[]> = {};
    for (const m of modules || []) {
      if (!moduleByCourse[m.course_id]) moduleByCourse[m.course_id] = [];
      moduleByCourse[m.course_id].push(m.id);
    }

    const lessonByModule: Record<string, any[]> = {};
    for (const l of lessons || []) {
      if (!lessonByModule[l.module_id]) lessonByModule[l.module_id] = [];
      lessonByModule[l.module_id].push(l);
    }

    const enriched = visibleCourses.map((c: any) => {
      const mIds = moduleByCourse[c.id] || [];
      let lessonCount = 0;
      let totalMin = 0;
      for (const mId of mIds) {
        const mLessons = lessonByModule[mId] || [];
        lessonCount += mLessons.length;
        totalMin += mLessons.reduce((sum: number, l: any) => sum + (l.duration_min || 0), 0);
      }
      return { ...c, module_count: mIds.length, lesson_count: lessonCount, total_duration_min: totalMin };
    });

    return res.json(enriched);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to list courses.', '[courses/list]');
  }
});

/** GET /api/courses/my-role — get current user's org role */
router.get('/courses/my-role', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data } = await admin
      .from('memberships')
      .select('role')
      .eq('org_id', auth.orgId)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    return res.json({ role: data?.role || null });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to get role.', '[courses/my-role]');
  }
});

/** GET /api/courses/org-members — list org members for audience targeting */
router.get('/courses/org-members', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data, error } = await admin
      .from('memberships')
      .select('user_id, role, full_name, avatar_url')
      .eq('org_id', auth.orgId);
    if (error) throw error;

    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to get org members.', '[courses/org-members]');
  }
});

/** GET /api/courses/progress/summary — all course progress for user (catalog view) */
router.get('/courses/progress/summary', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data, error } = await admin
      .from('course_progress')
      .select('course_id, lesson_id, completed, last_viewed')
      .eq('user_id', auth.user.id);
    if (error) throw error;

    if (!data || data.length === 0) return res.json({});

    // Get total lesson counts per course
    const courseIds = [...new Set(data.map((r: any) => r.course_id))];
    const summary: Record<string, number> = {};

    for (const cid of courseIds) {
      const { data: modules } = await admin
        .from('course_modules')
        .select('id')
        .eq('course_id', cid);

      if (!modules || modules.length === 0) continue;

      const { count } = await admin
        .from('course_lessons')
        .select('id', { count: 'exact', head: true })
        .in('module_id', modules.map((m: any) => m.id));

      const total = count || 0;
      if (total === 0) continue;

      const completed = data.filter((r: any) => r.course_id === cid && r.completed).length;
      summary[cid] = Math.round((completed / total) * 100);
    }

    return res.json(summary);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to get progress summary.', '[courses/progress-summary]');
  }
});

/** GET /api/courses/:id — full course with modules, lessons + can_edit flag */
router.get('/courses/:id', async (req, res) => {
  try {
    await ensureTables();
    if (!isUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid course ID.' });
    }
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data: course, error } = await admin
      .from('courses')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    // Check if user can view this course
    const canView = await canViewCourse(auth.user.id, auth.orgId, course);
    if (!canView) return res.status(403).json({ error: 'You do not have access to this course.' });

    // Check if user can edit this course
    const canEdit = await canEditCourse(auth.user.id, auth.orgId, course.id);

    const { data: modules } = await admin
      .from('course_modules')
      .select('*')
      .eq('course_id', course.id)
      .order('sort_order', { ascending: true });

    const moduleIds = (modules || []).map((m: any) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await admin.from('course_lessons').select('*').in('module_id', moduleIds).order('sort_order', { ascending: true })
      : { data: [] };

    const lessonsByModule: Record<string, any[]> = {};
    for (const l of lessons || []) {
      if (!lessonsByModule[l.module_id]) lessonsByModule[l.module_id] = [];
      lessonsByModule[l.module_id].push(l);
    }
    const enrichedModules = (modules || []).map((m: any) => ({
      ...m,
      lessons: lessonsByModule[m.id] || [],
    }));

    const { data: assignments } = await admin
      .from('course_assignments')
      .select('*')
      .eq('course_id', course.id);

    return res.json({ ...course, modules: enrichedModules, assignments: assignments || [], can_edit: canEdit });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to get course.', '[courses/get]');
  }
});

/** POST /api/courses — create course (admin/owner/any authorized role) */
router.post('/courses', async (req, res) => {
  try {
    await ensureTables();
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { title, description, cover_image, status, target_roles, target_user_ids } = req.body;
    const insertData: Record<string, any> = {
      org_id: auth.orgId,
      title: title || '',
      description: description || '',
      cover_image: cover_image || null,
      status: status || 'draft',
      created_by: auth.user.id,
    };
    // Only include audience targeting fields if columns exist in DB
    if (hasTargetingColumns) {
      if (target_roles && target_roles.length > 0) insertData.target_roles = target_roles;
      if (target_user_ids && target_user_ids.length > 0) insertData.target_user_ids = target_user_ids;
    }

    const { data, error } = await admin
      .from('courses')
      .insert(insertData)
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create course.', '[courses/create]');
  }
});

/** PATCH /api/courses/:id — update course (admin/owner/creator) */
router.patch('/courses/:id', async (req, res) => {
  try {
    const auth = await requireEditor(req, res, req.params.id);
    if (!auth) return;
    const admin = getServiceClient();

    const { title, description, cover_image, status, category, visibility, target_roles, target_user_ids } = req.body;
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (cover_image !== undefined) updates.cover_image = cover_image;
    if (status !== undefined) updates.status = status;
    if (category !== undefined && hasCategoryColumn) updates.category = category;
    if (visibility !== undefined && hasVisibilityColumn) updates.visibility = visibility;
    if (hasTargetingColumns) {
      if (target_roles !== undefined) updates.target_roles = target_roles;
      if (target_user_ids !== undefined) updates.target_user_ids = target_user_ids;
    }

    const { data, error } = await admin
      .from('courses')
      .update(updates)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update course.', '[courses/update]');
  }
});

/** DELETE /api/courses/:id — soft delete (admin only) */
router.delete('/courses/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data, error } = await admin
      .from('courses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Course not found.' });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to delete course.', '[courses/delete]');
  }
});

/** POST /api/courses/:id/duplicate — duplicate course (admin only) */
router.post('/courses/:id/duplicate', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data: original, error: fetchErr } = await admin
      .from('courses')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!original) return res.status(404).json({ error: 'Course not found.' });

    const { data: newCourse, error: insertErr } = await admin
      .from('courses')
      .insert({
        org_id: auth.orgId,
        title: `${original.title} (copy)`,
        description: original.description,
        cover_image: original.cover_image,
        status: 'draft',
        ...(hasCategoryColumn ? { category: original.category } : {}),
        created_by: auth.user.id,
        ...(hasTargetingColumns && original.target_roles?.length ? { target_roles: original.target_roles } : {}),
        ...(hasTargetingColumns && original.target_user_ids?.length ? { target_user_ids: original.target_user_ids } : {}),
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    const { data: modules } = await admin
      .from('course_modules')
      .select('*')
      .eq('course_id', original.id)
      .order('sort_order');

    for (const mod of modules || []) {
      const { data: newMod } = await admin
        .from('course_modules')
        .insert({ course_id: newCourse.id, title: mod.title, sort_order: mod.sort_order })
        .select()
        .single();
      if (!newMod) continue;

      const { data: lessons } = await admin
        .from('course_lessons')
        .select('*')
        .eq('module_id', mod.id)
        .order('sort_order');

      for (const lesson of lessons || []) {
        await admin.from('course_lessons').insert({
          module_id: newMod.id,
          title: lesson.title,
          content_type: lesson.content_type,
          video_url: lesson.video_url,
          embed_url: lesson.embed_url,
          text_content: lesson.text_content,
          attachments: lesson.attachments,
          duration_min: lesson.duration_min,
          sort_order: lesson.sort_order,
        });
      }
    }

    return res.status(201).json(newCourse);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to duplicate course.', '[courses/duplicate]');
  }
});

// ════════════════════════════════════════════════════════════════
// MODULES CRUD (editor permission — admin/owner/creator)
// ════════════════════════════════════════════════════════════════

/** POST /api/courses/:courseId/modules */
router.post('/courses/:courseId/modules', async (req, res) => {
  try {
    const auth = await requireEditor(req, res, req.params.courseId);
    if (!auth) return;
    const admin = getServiceClient();

    const { data: course } = await admin
      .from('courses').select('id').eq('id', req.params.courseId).eq('org_id', auth.orgId).is('deleted_at', null).maybeSingle();
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const { data: existing } = await admin
      .from('course_modules').select('sort_order').eq('course_id', course.id).order('sort_order', { ascending: false }).limit(1);
    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data, error } = await admin
      .from('course_modules')
      .insert({ course_id: course.id, title: req.body.title || '', sort_order: nextOrder })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create module.', '[courses/modules/create]');
  }
});

/** PATCH /api/courses/modules/:id */
router.patch('/courses/modules/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data: mod } = await admin.from('course_modules').select('id, course_id').eq('id', req.params.id).maybeSingle();
    if (!mod) return res.status(404).json({ error: 'Module not found.' });

    // Check edit permission on parent course
    const allowed = await canEditCourse(auth.user.id, auth.orgId, mod.course_id);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const { data: course } = await admin.from('courses').select('org_id').eq('id', mod.course_id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.sort_order !== undefined) updates.sort_order = req.body.sort_order;

    const { data, error } = await admin
      .from('course_modules')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update module.', '[courses/modules/update]');
  }
});

/** DELETE /api/courses/modules/:id */
router.delete('/courses/modules/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data: mod } = await admin.from('course_modules').select('id, course_id').eq('id', req.params.id).maybeSingle();
    if (!mod) return res.status(404).json({ error: 'Module not found.' });

    const allowed = await canEditCourse(auth.user.id, auth.orgId, mod.course_id);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const { data: course } = await admin.from('courses').select('org_id').eq('id', mod.course_id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const { error } = await admin.from('course_modules').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to delete module.', '[courses/modules/delete]');
  }
});

/** PUT /api/courses/:courseId/modules/reorder */
router.put('/courses/:courseId/modules/reorder', async (req, res) => {
  try {
    const auth = await requireEditor(req, res, req.params.courseId);
    if (!auth) return;
    const admin = getServiceClient();
    const { order } = req.body as { order: string[] };

    // Scope each update to the course we validated edit rights on, so a caller
    // can't slip another course's/org's module ids into `order`.
    for (let i = 0; i < order.length; i++) {
      await admin.from('course_modules').update({ sort_order: i }).eq('id', order[i]).eq('course_id', req.params.courseId);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to reorder modules.', '[courses/modules/reorder]');
  }
});

// ════════════════════════════════════════════════════════════════
// LESSONS CRUD
// ════════════════════════════════════════════════════════════════

/** Helper to get courseId from moduleId */
async function getCourseIdFromModule(moduleId: string): Promise<string | null> {
  const admin = getServiceClient();
  const { data } = await admin.from('course_modules').select('course_id').eq('id', moduleId).maybeSingle();
  return data?.course_id || null;
}

/** Helper to get courseId from lessonId */
async function getCourseIdFromLesson(lessonId: string): Promise<string | null> {
  const admin = getServiceClient();
  const { data: lesson } = await admin.from('course_lessons').select('module_id').eq('id', lessonId).maybeSingle();
  if (!lesson) return null;
  return getCourseIdFromModule(lesson.module_id);
}

/** POST /api/courses/modules/:moduleId/lessons */
router.post('/courses/modules/:moduleId/lessons', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const courseId = await getCourseIdFromModule(req.params.moduleId);
    if (!courseId) return res.status(404).json({ error: 'Module not found.' });

    const allowed = await canEditCourse(auth.user.id, auth.orgId, courseId);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const { data: existing } = await admin
      .from('course_lessons').select('sort_order').eq('module_id', req.params.moduleId)
      .order('sort_order', { ascending: false }).limit(1);
    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { title, content_type, video_url, embed_url, text_content, attachments, duration_min } = req.body;
    const { data, error } = await admin
      .from('course_lessons')
      .insert({
        module_id: req.params.moduleId,
        title: title || '',
        content_type: content_type || 'video',
        video_url: video_url || null,
        embed_url: embed_url || null,
        text_content: text_content || null,
        attachments: attachments || [],
        duration_min: duration_min || 0,
        sort_order: nextOrder,
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create lesson.', '[courses/lessons/create]');
  }
});

/** PATCH /api/courses/lessons/:id */
router.patch('/courses/lessons/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const courseId = await getCourseIdFromLesson(req.params.id);
    if (!courseId) return res.status(404).json({ error: 'Lesson not found.' });

    const allowed = await canEditCourse(auth.user.id, auth.orgId, courseId);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    const fields = ['title', 'content_type', 'video_url', 'embed_url', 'text_content', 'attachments', 'duration_min', 'sort_order'];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    const { data, error } = await admin
      .from('course_lessons')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update lesson.', '[courses/lessons/update]');
  }
});

/** DELETE /api/courses/lessons/:id */
router.delete('/courses/lessons/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const courseId = await getCourseIdFromLesson(req.params.id);
    if (!courseId) return res.status(404).json({ error: 'Lesson not found.' });

    const allowed = await canEditCourse(auth.user.id, auth.orgId, courseId);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const { error } = await admin.from('course_lessons').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to delete lesson.', '[courses/lessons/delete]');
  }
});

/** POST /api/courses/lessons/:id/duplicate */
router.post('/courses/lessons/:id/duplicate', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const courseId = await getCourseIdFromLesson(req.params.id);
    if (!courseId) return res.status(404).json({ error: 'Lesson not found.' });

    const allowed = await canEditCourse(auth.user.id, auth.orgId, courseId);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const { data: original, error: fetchErr } = await admin
      .from('course_lessons').select('*').eq('id', req.params.id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!original) return res.status(404).json({ error: 'Lesson not found.' });

    const { data: existing } = await admin
      .from('course_lessons').select('sort_order').eq('module_id', original.module_id)
      .order('sort_order', { ascending: false }).limit(1);
    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data, error } = await admin
      .from('course_lessons')
      .insert({
        module_id: original.module_id,
        title: `${original.title} (copy)`,
        content_type: original.content_type,
        video_url: original.video_url,
        embed_url: original.embed_url,
        text_content: original.text_content,
        attachments: original.attachments,
        duration_min: original.duration_min,
        sort_order: nextOrder,
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to duplicate lesson.', '[courses/lessons/duplicate]');
  }
});

/** PUT /api/courses/modules/:moduleId/lessons/reorder */
router.put('/courses/modules/:moduleId/lessons/reorder', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const courseId = await getCourseIdFromModule(req.params.moduleId);
    if (!courseId) return res.status(404).json({ error: 'Module not found.' });

    const allowed = await canEditCourse(auth.user.id, auth.orgId, courseId);
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to edit this course.' });

    const { order } = req.body as { order: string[] };
    // Scope each update to this module (whose course we validated), so a caller
    // can't slip another module's/org's lesson ids into `order`.
    for (let i = 0; i < order.length; i++) {
      await admin.from('course_lessons').update({ sort_order: i }).eq('id', order[i]).eq('module_id', req.params.moduleId);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to reorder lessons.', '[courses/lessons/reorder]');
  }
});

// ════════════════════════════════════════════════════════════════
// ASSIGNMENTS
// ════════════════════════════════════════════════════════════════

/** POST /api/courses/:id/assign */
router.post('/courses/:id/assign', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // The course being assigned must belong to the caller's org.
    const { data: course } = await admin.from('courses').select('org_id').eq('id', req.params.id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const { user_ids, team_ids } = req.body as { user_ids?: string[]; team_ids?: string[] };
    const rows: any[] = [];

    for (const uid of user_ids || []) {
      rows.push({ course_id: req.params.id, user_id: uid, assigned_by: auth.user.id });
    }
    for (const tid of team_ids || []) {
      rows.push({ course_id: req.params.id, team_id: tid, assigned_by: auth.user.id });
    }

    if (rows.length > 0) {
      const { error } = await admin.from('course_assignments').upsert(rows, { onConflict: 'course_id,user_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to assign course.', '[courses/assign]');
  }
});

/** DELETE /api/courses/assignments/:id */
router.delete('/courses/assignments/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // The assignment's course must belong to the caller's org before we delete it.
    const { data: assignment } = await admin.from('course_assignments').select('course_id').eq('id', req.params.id).maybeSingle();
    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
    const { data: course } = await admin.from('courses').select('org_id').eq('id', assignment.course_id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const { error } = await admin.from('course_assignments').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to unassign.', '[courses/unassign]');
  }
});

// ════════════════════════════════════════════════════════════════
// PROGRESS TRACKING
// ════════════════════════════════════════════════════════════════

/** GET /api/courses/:id/progress — get user's progress for a course */
router.get('/courses/:id/progress', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data, error } = await admin
      .from('course_progress')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('course_id', req.params.id);
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to get progress.', '[courses/progress/get]');
  }
});

/** POST /api/courses/progress — mark lesson viewed/completed */
router.post('/courses/progress', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { course_id, lesson_id, completed } = req.body;
    if (!lesson_id) return res.status(400).json({ error: 'lesson_id is required.' });
    const now = new Date().toISOString();

    // Vérifie que la leçon appartient bien à un cours de l'org du caller —
    // sinon un user pourrait écrire de la progression cross-org avec un UUID
    // arbitraire. La leçon est reliée au cours VIA son module (pas de course_id
    // direct sur course_lessons). Résout le vrai course_id (pas celui du body).
    const { data: lessonRow } = await admin
      .from('course_lessons')
      .select('module_id, course_modules!inner(course_id)')
      .eq('id', lesson_id)
      .maybeSingle();
    const realCourseId = (lessonRow as any)?.course_modules?.course_id ?? null;
    if (!realCourseId) return res.status(404).json({ error: 'Lesson not found.' });
    const { data: courseRow } = await admin
      .from('courses')
      .select('org_id, deleted_at')
      .eq('id', realCourseId)
      .maybeSingle();
    if (!courseRow || courseRow.org_id !== auth.orgId || courseRow.deleted_at) {
      return res.status(403).json({ error: 'Lesson not in your organization.' });
    }

    // Ne jamais rétrograder: si la leçon est déjà complétée, on préserve son
    // état (une revisite ne doit pas effacer completed_at).
    const { data: existing } = await admin
      .from('course_progress')
      .select('completed, completed_at')
      .eq('user_id', auth.user.id)
      .eq('lesson_id', lesson_id)
      .maybeSingle();
    const alreadyDone = !!existing?.completed;
    const nextCompleted = completed || alreadyDone;

    const { data, error } = await admin
      .from('course_progress')
      .upsert({
        user_id: auth.user.id,
        course_id: realCourseId,
        lesson_id,
        completed: nextCompleted,
        completed_at: nextCompleted ? (existing?.completed_at || now) : null,
        last_viewed: now,
      }, { onConflict: 'user_id,lesson_id' })
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update progress.', '[courses/progress/update]');
  }
});

/** GET /api/courses/:id/team-progress — admin view of team progress */
router.get('/courses/:id/team-progress', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const courseId = req.params.id;

    // Get total lesson count
    const { data: modules } = await admin
      .from('course_modules')
      .select('id')
      .eq('course_id', courseId);

    if (!modules || modules.length === 0) return res.json([]);

    const { count: totalLessons } = await admin
      .from('course_lessons')
      .select('id', { count: 'exact', head: true })
      .in('module_id', modules.map((m: any) => m.id));

    if (!totalLessons) return res.json([]);

    // Get all progress rows
    const { data: progressRows, error: progErr } = await admin
      .from('course_progress')
      .select('user_id, lesson_id, completed, last_viewed')
      .eq('course_id', courseId);
    if (progErr) throw progErr;

    // Audience du cours: on ne montre la progression QUE des membres qui peuvent
    // voir ce cours (rôle ciblé / user ciblé / assigné), pas toute l'org.
    const { data: courseRow } = await admin
      .from('courses')
      .select('visibility, target_roles, target_user_ids, created_by')
      .eq('id', courseId)
      .maybeSingle();
    const tRoles: string[] = Array.isArray(courseRow?.target_roles) ? courseRow!.target_roles : [];
    const tUsers: string[] = Array.isArray(courseRow?.target_user_ids) ? courseRow!.target_user_ids : [];
    const hasTargeting = tRoles.length > 0 || tUsers.length > 0;
    const { data: assignRows } = hasTargeting || courseRow?.visibility === 'assigned'
      ? await admin.from('course_assignments').select('user_id, team_id').eq('course_id', courseId)
      : { data: [] as any[] };
    const assignedUserIds = new Set((assignRows || []).map((a: any) => a.user_id).filter(Boolean));
    const assignedTeamIds = new Set((assignRows || []).map((a: any) => a.team_id).filter(Boolean));

    // Get org members (avec rôle + équipe pour filtrer par audience)
    const { data: members, error: memErr } = await admin
      .from('memberships')
      .select('user_id, full_name, avatar_url, role, team_id')
      .eq('org_id', auth.orgId);
    if (memErr) throw memErr;

    const canSee = (m: any): boolean => {
      if (m.role === 'owner' || m.role === 'admin') return true;
      if (courseRow?.created_by === m.user_id) return true;
      if (tUsers.includes(m.user_id)) return true;
      if (tRoles.length > 0 && tRoles.includes(m.role)) return true;
      if (!hasTargeting && (courseRow?.visibility ?? 'all') === 'all') return true;
      if (assignedUserIds.has(m.user_id)) return true;
      if (m.team_id && assignedTeamIds.has(m.team_id)) return true;
      return false;
    };

    const result = (members || []).filter(canSee).map((m: any) => {
      const userRows = (progressRows || []).filter((r: any) => r.user_id === m.user_id);
      const completedCount = userRows.filter((r: any) => r.completed).length;
      const lastActivity = userRows.length > 0
        ? userRows.reduce((latest: string | null, r: any) => (!latest || r.last_viewed > latest) ? r.last_viewed : latest, null)
        : null;

      return {
        user_id: m.user_id,
        full_name: m.full_name || 'Unknown',
        avatar_url: m.avatar_url,
        completed_count: completedCount,
        total_lessons: totalLessons,
        percentage: Math.round((completedCount / totalLessons) * 100),
        last_activity: lastActivity,
      };
    });

    result.sort((a: any, b: any) => b.percentage - a.percentage);
    return res.json(result);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to get team progress.', '[courses/team-progress]');
  }
});

export default router;
