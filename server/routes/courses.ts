import express from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

const router = express.Router();

// ── Auto-migrate: ensure tables exist on first request ──
let tablesReady = false;

async function ensureTables() {
  if (tablesReady) return;
  const admin = getServiceClient();
  const { error } = await admin.from('courses').select('id').limit(1);
  if (!error) { tablesReady = true; return; }
  if (error.code !== 'PGRST205' && error.code !== '42P01' && !error.message.includes('schema cache') && !error.message.includes('relation') ) {
    // Some other error (auth, network, etc.) — don't block, let queries fail naturally
    console.warn('[courses] ensureTables check returned unexpected error:', error.code, error.message);
    tablesReady = true;
    return;
  }

  // Tables don't exist — try via DATABASE_URL if available
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

  // No DATABASE_URL — log warning but don't crash. Return empty data gracefully.
  console.warn(
    '[courses] Tables not found and no DATABASE_URL set. Apply migration manually:\n' +
    '  1. Supabase Dashboard > SQL Editor\n' +
    '  2. Paste: supabase/migrations/20260403100000_courses_module.sql\n' +
    '  3. Run'
  );
  // Mark as ready so we don't retry every request — queries will fail with descriptive DB errors
  tablesReady = true;
}

// ── helpers ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(v: string | undefined): boolean { return !!v && UUID_RE.test(v); }

async function requireAdmin(req: express.Request, res: express.Response) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const isAdmin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
  if (!isAdmin) {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  return auth;
}

// ════════════════════════════════════════════════════════════════
// COURSES CRUD
// ════════════════════════════════════════════════════════════════

/** GET /api/courses — list courses for the org */
router.get('/courses', async (req, res) => {
  try {
    await ensureTables();
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    console.log('[courses] GET /courses orgId=', auth.orgId, 'userId=', auth.user.id);
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

    // Attach module/lesson counts
    const courseIds = (data || []).map((c: any) => c.id);
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

    const enriched = (data || []).map((c: any) => {
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
    console.error('courses_list_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to list courses.' });
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

    const summary: Record<string, { total: number; completed: number; last_viewed: string | null }> = {};
    for (const p of data || []) {
      if (!summary[p.course_id]) summary[p.course_id] = { total: 0, completed: 0, last_viewed: null };
      summary[p.course_id].total++;
      if (p.completed) summary[p.course_id].completed++;
      if (!summary[p.course_id].last_viewed || p.last_viewed > summary[p.course_id].last_viewed!) {
        summary[p.course_id].last_viewed = p.last_viewed;
      }
    }
    return res.json(summary);
  } catch (err: any) {
    console.error('progress_summary_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to get progress summary.' });
  }
});

/** GET /api/courses/:id — full course with modules, lessons */
router.get('/courses/:id', async (req, res) => {
  try {
    console.log('[courses] GET /courses/:id called with id=', req.params.id);
    if (!isUUID(req.params.id)) {
      console.warn('[courses] Invalid course ID received:', req.params.id, '— URL:', req.originalUrl);
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

    const { data: modules } = await admin
      .from('course_modules')
      .select('*')
      .eq('course_id', course.id)
      .order('sort_order', { ascending: true });

    const moduleIds = (modules || []).map((m: any) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await admin.from('course_lessons').select('*').in('module_id', moduleIds).order('sort_order', { ascending: true })
      : { data: [] };

    // Attach lessons to modules
    const lessonsByModule: Record<string, any[]> = {};
    for (const l of lessons || []) {
      if (!lessonsByModule[l.module_id]) lessonsByModule[l.module_id] = [];
      lessonsByModule[l.module_id].push(l);
    }
    const enrichedModules = (modules || []).map((m: any) => ({
      ...m,
      lessons: lessonsByModule[m.id] || [],
    }));

    // Get assignments
    const { data: assignments } = await admin
      .from('course_assignments')
      .select('*')
      .eq('course_id', course.id);

    return res.json({ ...course, modules: enrichedModules, assignments: assignments || [] });
  } catch (err: any) {
    console.error('course_get_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to get course.' });
  }
});

/** POST /api/courses — create course (admin only) */
router.post('/courses', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { title, description, cover_image, status } = req.body;
    const { data, error } = await admin
      .from('courses')
      .insert({
        org_id: auth.orgId,
        title: title || '',
        description: description || '',
        cover_image: cover_image || null,
        status: status || 'draft',
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    console.error('course_create_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to create course.' });
  }
});

/** PATCH /api/courses/:id — update course (admin only) */
router.patch('/courses/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { title, description, cover_image, status } = req.body;
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (cover_image !== undefined) updates.cover_image = cover_image;
    if (status !== undefined) updates.status = status;

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
    console.error('course_update_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update course.' });
  }
});

/** DELETE /api/courses/:id — soft delete (admin only) */
router.delete('/courses/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { error } = await admin
      .from('courses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('course_delete_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to delete course.' });
  }
});

/** POST /api/courses/:id/duplicate — duplicate course (admin only) */
router.post('/courses/:id/duplicate', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Fetch original
    const { data: original, error: fetchErr } = await admin
      .from('courses')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!original) return res.status(404).json({ error: 'Course not found.' });

    // Create copy
    const { data: newCourse, error: insertErr } = await admin
      .from('courses')
      .insert({
        org_id: auth.orgId,
        title: `${original.title} (copy)`,
        description: original.description,
        cover_image: original.cover_image,
        status: 'draft',
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    // Duplicate modules + lessons
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
    console.error('course_duplicate_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to duplicate course.' });
  }
});

// ════════════════════════════════════════════════════════════════
// MODULES CRUD
// ════════════════════════════════════════════════════════════════

/** POST /api/courses/:courseId/modules */
router.post('/courses/:courseId/modules', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Verify course ownership
    const { data: course } = await admin
      .from('courses').select('id').eq('id', req.params.courseId).eq('org_id', auth.orgId).is('deleted_at', null).maybeSingle();
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    // Get next sort order
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
    console.error('module_create_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to create module.' });
  }
});

/** PATCH /api/courses/modules/:id */
router.patch('/courses/modules/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.sort_order !== undefined) updates.sort_order = req.body.sort_order;

    // Verify module belongs to org via parent course
    const { data: mod } = await admin.from('course_modules').select('id, course_id').eq('id', req.params.id).maybeSingle();
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const { data: course } = await admin.from('courses').select('org_id').eq('id', mod.course_id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const { data, error } = await admin
      .from('course_modules')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    console.error('module_update_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update module.' });
  }
});

/** DELETE /api/courses/modules/:id */
router.delete('/courses/modules/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Verify module belongs to org via parent course
    const { data: mod } = await admin.from('course_modules').select('id, course_id').eq('id', req.params.id).maybeSingle();
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const { data: course } = await admin.from('courses').select('org_id').eq('id', mod.course_id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const { error } = await admin.from('course_modules').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('module_delete_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to delete module.' });
  }
});

/** PUT /api/courses/:courseId/modules/reorder */
router.put('/courses/:courseId/modules/reorder', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { order } = req.body as { order: string[] }; // array of module IDs

    for (let i = 0; i < order.length; i++) {
      await admin.from('course_modules').update({ sort_order: i }).eq('id', order[i]);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('module_reorder_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to reorder modules.' });
  }
});

// ════════════════════════════════════════════════════════════════
// LESSONS CRUD
// ════════════════════════════════════════════════════════════════

/** POST /api/courses/modules/:moduleId/lessons */
router.post('/courses/modules/:moduleId/lessons', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Get next sort order
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
    console.error('lesson_create_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to create lesson.' });
  }
});

/** PATCH /api/courses/lessons/:id */
router.patch('/courses/lessons/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

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
    console.error('lesson_update_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update lesson.' });
  }
});

/** DELETE /api/courses/lessons/:id */
router.delete('/courses/lessons/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Verify lesson belongs to org via module → course chain
    const { data: lesson } = await admin.from('course_lessons').select('id, module_id').eq('id', req.params.id).maybeSingle();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
    const { data: mod } = await admin.from('course_modules').select('course_id').eq('id', lesson.module_id).maybeSingle();
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const { data: course } = await admin.from('courses').select('org_id').eq('id', mod.course_id).maybeSingle();
    if (!course || course.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    const { error } = await admin.from('course_lessons').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('lesson_delete_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to delete lesson.' });
  }
});

/** POST /api/courses/lessons/:id/duplicate */
router.post('/courses/lessons/:id/duplicate', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

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
    console.error('lesson_duplicate_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to duplicate lesson.' });
  }
});

/** PUT /api/courses/modules/:moduleId/lessons/reorder */
router.put('/courses/modules/:moduleId/lessons/reorder', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { order } = req.body as { order: string[] };

    for (let i = 0; i < order.length; i++) {
      await admin.from('course_lessons').update({ sort_order: i }).eq('id', order[i]);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('lesson_reorder_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to reorder lessons.' });
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
    console.error('course_assign_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to assign course.' });
  }
});

/** DELETE /api/courses/assignments/:id */
router.delete('/courses/assignments/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { error } = await admin.from('course_assignments').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('course_unassign_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to unassign.' });
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
    console.error('progress_get_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to get progress.' });
  }
});

/** POST /api/courses/progress — mark lesson viewed/completed */
router.post('/courses/progress', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { course_id, lesson_id, completed } = req.body;
    const now = new Date().toISOString();

    const { data, error } = await admin
      .from('course_progress')
      .upsert({
        user_id: auth.user.id,
        course_id,
        lesson_id,
        completed: completed || false,
        completed_at: completed ? now : null,
        last_viewed: now,
      }, { onConflict: 'user_id,lesson_id' })
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    console.error('progress_update_failed', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update progress.' });
  }
});

export default router;
