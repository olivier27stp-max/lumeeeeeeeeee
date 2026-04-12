/**
 * API helpers for the courses / LMS module.
 * Tables: courses, course_modules, course_lessons, course_assignments, course_progress
 */

import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ── Types ──

export interface Course {
  id: string;
  org_id: string;
  title: string;
  description: string;
  cover_image: string | null;
  status: 'draft' | 'published';
  category: string;
  visibility: 'all' | 'assigned';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  module_count?: number;
  lesson_count?: number;
  total_duration_min?: number;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  lessons: CourseLesson[];
  created_at: string;
  updated_at: string;
}

export interface CourseLesson {
  id: string;
  module_id: string;
  title: string;
  content_type: 'video' | 'embed' | 'text' | 'pdf' | 'link';
  video_url: string | null;
  embed_url: string | null;
  text_content: string | null;
  attachments: any[];
  duration_min: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CourseFull extends Course {
  modules: CourseModule[];
}

export interface LessonProgress {
  id: string;
  user_id: string;
  course_id: string;
  lesson_id: string;
  completed: boolean;
  completed_at: string | null;
  last_viewed: string;
}

/** Map of courseId → completion percentage */
export type ProgressSummary = Record<string, number>;

export interface TeamMemberProgress {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  completed_count: number;
  total_lessons: number;
  percentage: number;
  last_activity: string | null;
}

// ── Courses CRUD ──

export async function getCourses(opts?: {
  status?: string;
  q?: string;
}): Promise<Course[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  let query = supabase
    .from('courses')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (opts?.status) query = query.eq('status', opts.status);
  if (opts?.q) query = query.ilike('title', `%${opts.q.replace(/[%_]/g, '\\$&')}%`);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Course[];
}

export async function getCourse(id: string): Promise<CourseFull> {
  const { data: course, error } = await supabase
    .from('courses')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;

  // Fetch modules with lessons
  const { data: modules, error: modError } = await supabase
    .from('course_modules')
    .select('*')
    .eq('course_id', id)
    .order('sort_order');

  if (modError) throw modError;

  const moduleIds = (modules || []).map((m: any) => m.id);
  let lessons: any[] = [];
  if (moduleIds.length > 0) {
    const { data: lessonData, error: lessonError } = await supabase
      .from('course_lessons')
      .select('*')
      .in('module_id', moduleIds)
      .order('sort_order');

    if (lessonError) throw lessonError;
    lessons = lessonData || [];
  }

  // Group lessons by module
  const lessonsByModule = new Map<string, CourseLesson[]>();
  for (const l of lessons) {
    const arr = lessonsByModule.get(l.module_id) || [];
    arr.push(l as CourseLesson);
    lessonsByModule.set(l.module_id, arr);
  }

  const fullModules: CourseModule[] = (modules || []).map((m: any) => ({
    ...m,
    lessons: lessonsByModule.get(m.id) || [],
  }));

  return { ...(course as Course), modules: fullModules };
}

export async function createCourse(input: {
  title: string;
  description?: string;
  cover_image?: string | null;
  status?: 'draft' | 'published';
}): Promise<Course> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('courses')
    .insert({
      org_id: orgId,
      title: input.title,
      description: input.description || '',
      cover_image: input.cover_image || null,
      status: input.status || 'draft',
      created_by: user?.id ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as Course;
}

export async function updateCourse(
  id: string,
  updates: Partial<Pick<Course, 'title' | 'description' | 'cover_image' | 'status' | 'category' | 'visibility'>>,
): Promise<Course> {
  const { data, error } = await supabase
    .from('courses')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as Course;
}

export async function deleteCourse(id: string): Promise<void> {
  // Soft delete
  const { error } = await supabase
    .from('courses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function duplicateCourse(id: string): Promise<Course> {
  const source = await getCourse(id);
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();

  // Create new course
  const { data: newCourse, error } = await supabase
    .from('courses')
    .insert({
      org_id: orgId,
      title: `${source.title} (copy)`,
      description: source.description,
      cover_image: source.cover_image,
      status: 'draft',
      category: source.category,
      created_by: user?.id ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;

  // Duplicate modules and lessons
  for (const mod of source.modules) {
    const { data: newMod, error: modErr } = await supabase
      .from('course_modules')
      .insert({ course_id: newCourse.id, title: mod.title, sort_order: mod.sort_order })
      .select('*')
      .single();

    if (modErr) continue;

    for (const lesson of mod.lessons) {
      await supabase.from('course_lessons').insert({
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

  return newCourse as Course;
}

// ── Modules CRUD ──

export async function createModule(courseId: string, title: string): Promise<CourseModule> {
  // Get next sort order
  const { data: existing } = await supabase
    .from('course_modules')
    .select('sort_order')
    .eq('course_id', courseId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const sortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('course_modules')
    .insert({ course_id: courseId, title, sort_order: sortOrder })
    .select('*')
    .single();

  if (error) throw error;
  return { ...(data as any), lessons: [] } as CourseModule;
}

export async function updateModule(
  id: string,
  updates: Partial<Pick<CourseModule, 'title' | 'sort_order'>>,
): Promise<CourseModule> {
  const { data, error } = await supabase
    .from('course_modules')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;

  // Fetch lessons for the module
  const { data: lessons } = await supabase
    .from('course_lessons')
    .select('*')
    .eq('module_id', id)
    .order('sort_order');

  return { ...(data as any), lessons: lessons || [] } as CourseModule;
}

export async function deleteModule(id: string): Promise<void> {
  const { error } = await supabase
    .from('course_modules')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function reorderModules(courseId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from('course_modules')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
  }
}

// ── Lessons CRUD ──

export async function createLesson(
  moduleId: string,
  input: { title: string; content_type?: CourseLesson['content_type'] },
): Promise<CourseLesson> {
  const { data: existing } = await supabase
    .from('course_lessons')
    .select('sort_order')
    .eq('module_id', moduleId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const sortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('course_lessons')
    .insert({
      module_id: moduleId,
      title: input.title,
      content_type: input.content_type || 'video',
      sort_order: sortOrder,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as CourseLesson;
}

export async function updateLesson(
  id: string,
  updates: Partial<Pick<CourseLesson, 'title' | 'content_type' | 'video_url' | 'embed_url' | 'text_content' | 'attachments' | 'duration_min'>>,
): Promise<CourseLesson> {
  const { data, error } = await supabase
    .from('course_lessons')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as CourseLesson;
}

export async function deleteLesson(id: string): Promise<void> {
  const { error } = await supabase
    .from('course_lessons')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function duplicateLesson(id: string): Promise<CourseLesson> {
  const { data: source, error: fetchErr } = await supabase
    .from('course_lessons')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr) throw fetchErr;

  const { data: existing } = await supabase
    .from('course_lessons')
    .select('sort_order')
    .eq('module_id', source.module_id)
    .order('sort_order', { ascending: false })
    .limit(1);

  const sortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('course_lessons')
    .insert({
      module_id: source.module_id,
      title: `${source.title} (copy)`,
      content_type: source.content_type,
      video_url: source.video_url,
      embed_url: source.embed_url,
      text_content: source.text_content,
      attachments: source.attachments,
      duration_min: source.duration_min,
      sort_order: sortOrder,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as CourseLesson;
}

export async function reorderLessons(moduleId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from('course_lessons')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
  }
}

// ── Progress tracking ──

export async function getCourseProgress(courseId: string): Promise<LessonProgress[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('course_progress')
    .select('*')
    .eq('user_id', user.id)
    .eq('course_id', courseId);

  if (error) throw error;
  return (data || []) as LessonProgress[];
}

export async function updateProgress(
  courseId: string,
  lessonId: string,
  completed: boolean,
): Promise<LessonProgress> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('course_progress')
    .upsert(
      {
        user_id: user.id,
        course_id: courseId,
        lesson_id: lessonId,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
        last_viewed: new Date().toISOString(),
      },
      { onConflict: 'user_id,lesson_id' },
    )
    .select('*')
    .single();

  if (error) throw error;
  return data as LessonProgress;
}

export async function getProgressSummary(): Promise<ProgressSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  // Get all progress records for the user
  const { data: progressRows, error: progErr } = await supabase
    .from('course_progress')
    .select('course_id, lesson_id, completed')
    .eq('user_id', user.id);

  if (progErr) throw progErr;
  if (!progressRows || progressRows.length === 0) return {};

  // Get total lesson counts per course
  const courseIds = [...new Set(progressRows.map((r: any) => r.course_id))];
  const summary: ProgressSummary = {};

  for (const cid of courseIds) {
    const { data: modules } = await supabase
      .from('course_modules')
      .select('id')
      .eq('course_id', cid);

    if (!modules || modules.length === 0) continue;

    const { count } = await supabase
      .from('course_lessons')
      .select('id', { count: 'exact', head: true })
      .in('module_id', modules.map((m: any) => m.id));

    const total = count || 0;
    if (total === 0) continue;

    const completed = progressRows.filter(
      (r: any) => r.course_id === cid && r.completed,
    ).length;

    summary[cid] = Math.round((completed / total) * 100);
  }

  return summary;
}

// ── Current user role check ──

export async function getCurrentUserRole(): Promise<string | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single();

  if (error) return null;
  return data?.role || null;
}

// ── Team progress (admin / boss view) ──

export async function getTeamCourseProgress(courseId: string): Promise<TeamMemberProgress[]> {
  const orgId = await getCurrentOrgIdOrThrow();

  // Get total lesson count for this course
  const { data: modules } = await supabase
    .from('course_modules')
    .select('id')
    .eq('course_id', courseId);

  if (!modules || modules.length === 0) return [];

  const { count: totalLessons } = await supabase
    .from('course_lessons')
    .select('id', { count: 'exact', head: true })
    .in('module_id', modules.map((m: any) => m.id));

  if (!totalLessons) return [];

  // Get all progress rows for this course across all org members
  const { data: progressRows, error: progErr } = await supabase
    .from('course_progress')
    .select('user_id, lesson_id, completed, last_viewed')
    .eq('course_id', courseId);

  if (progErr) throw progErr;

  // Get org members
  const { data: members, error: memErr } = await supabase
    .from('org_members')
    .select('user_id, full_name, avatar_url')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (memErr) throw memErr;

  // Build per-member stats
  const result: TeamMemberProgress[] = (members || []).map((m: any) => {
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

  // Sort by percentage descending
  result.sort((a, b) => b.percentage - a.percentage);
  return result;
}
