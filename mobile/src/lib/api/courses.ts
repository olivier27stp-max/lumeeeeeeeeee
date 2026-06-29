// Formations (courses) — direct Supabase. Org members can read courses/modules/
// lessons under RLS, and each user reads/writes their OWN course_progress.

import { supabase } from '../supabase';

export type LessonType = 'video' | 'embed' | 'text' | 'pdf' | 'link';

export interface Lesson {
  id: string;
  module_id: string;
  title: string | null;
  content_type: LessonType | string;
  video_url: string | null;
  embed_url: string | null;
  text_content: string | null;
  attachments: { name?: string; url?: string; type?: string }[] | null;
  duration_min: number | null;
  sort_order: number | null;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string | null;
  sort_order: number | null;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  org_id: string;
  title: string | null;
  description: string | null;
  cover_image: string | null;
  category: string | null;
  status: string | null;
  visibility: string | null;
  target_roles: string[] | null;
  target_user_ids: string[] | null;
  created_by: string | null;
}

export interface CourseSummary extends Course {
  module_count: number;
  lesson_count: number;
  duration_min: number;
  progress_pct: number;
}

export interface CourseFull extends Course {
  modules: CourseModule[];
}

function isVisible(c: Course, role: string | null, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (c.created_by && c.created_by === userId) return true;
  // Missing/blank visibility (older schema) → treat as visible to everyone.
  if (!c.visibility || c.visibility === 'all') {
    if (!(c.target_roles && c.target_roles.length) && !(c.target_user_ids && c.target_user_ids.length)) return true;
  }
  if (Array.isArray(c.target_user_ids) && c.target_user_ids.includes(userId)) return true;
  if (Array.isArray(c.target_roles) && role && c.target_roles.includes(role)) return true;
  return false;
}

/** Published courses visible to the user, with counts + the user's progress %. */
export async function listCourses(params: {
  orgId: string;
  role: string | null;
  userId: string;
  isAdmin: boolean;
}): Promise<CourseSummary[]> {
  const { orgId, role, userId, isAdmin } = params;

  // select('*') so a missing column on an older deployed schema can't break it.
  let query = supabase.from('courses').select('*').eq('org_id', orgId).is('deleted_at', null);
  if (!isAdmin) query = query.eq('status', 'published'); // admins see drafts too
  const { data: courses, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const visible = (courses ?? []).filter((c) => isVisible(c as Course, role, userId, isAdmin));
  if (visible.length === 0) return [];

  const courseIds = visible.map((c) => c.id);
  const { data: modules } = await supabase
    .from('course_modules')
    .select('id, course_id')
    .in('course_id', courseIds);
  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: lessons } = moduleIds.length
    ? await supabase.from('course_lessons').select('id, module_id, duration_min').in('module_id', moduleIds)
    : { data: [] as any[] };

  const { data: progress } = await supabase
    .from('course_progress')
    .select('lesson_id, completed')
    .eq('user_id', userId);

  const moduleToCourse = new Map((modules ?? []).map((m) => [m.id, m.course_id]));
  const lessonToCourse = new Map((lessons ?? []).map((l) => [l.id, moduleToCourse.get(l.module_id)]));
  const completedByCourse = new Map<string, Set<string>>();
  for (const p of progress ?? []) {
    if (!p.completed) continue;
    const cid = lessonToCourse.get(p.lesson_id);
    if (!cid) continue;
    if (!completedByCourse.has(cid)) completedByCourse.set(cid, new Set());
    completedByCourse.get(cid)!.add(p.lesson_id);
  }

  return visible.map((c): CourseSummary => {
    const mCount = (modules ?? []).filter((m) => m.course_id === c.id).length;
    const lessonsOfCourse = (lessons ?? []).filter((l) => moduleToCourse.get(l.module_id) === c.id);
    const lCount = lessonsOfCourse.length;
    const dur = lessonsOfCourse.reduce((s, l) => s + (l.duration_min ?? 0), 0);
    const done = completedByCourse.get(c.id)?.size ?? 0;
    return {
      ...(c as Course),
      module_count: mCount,
      lesson_count: lCount,
      duration_min: dur,
      progress_pct: lCount > 0 ? Math.round((done / lCount) * 100) : 0,
    };
  });
}

/** One course with its modules + lessons nested. */
export async function getCourseFull(courseId: string): Promise<CourseFull | null> {
  const { data: course, error } = await supabase
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!course) return null;

  const { data: modules } = await supabase
    .from('course_modules')
    .select('id, course_id, title, sort_order')
    .eq('course_id', courseId)
    .order('sort_order', { ascending: true });
  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: lessons } = moduleIds.length
    ? await supabase
        .from('course_lessons')
        .select('*')
        .in('module_id', moduleIds)
        .order('sort_order', { ascending: true })
    : { data: [] as Lesson[] };

  return {
    ...(course as Course),
    modules: (modules ?? []).map((m): CourseModule => ({
      ...m,
      lessons: ((lessons ?? []) as Lesson[]).filter((l) => l.module_id === m.id),
    })),
  };
}

/**
 * Completed lesson ids for the user in a course. Returns a plain array (not a
 * Set) so it survives JSON serialization in the React Query offline cache — a
 * Set rehydrates as `{}` and breaks `.has()`. The screen builds a Set from it.
 */
export async function getCompletedLessons(courseId: string, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('course_progress')
    .select('lesson_id, completed')
    .eq('user_id', userId)
    .eq('course_id', courseId);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((p) => p.completed).map((p) => p.lesson_id);
}

export async function markLesson(params: {
  courseId: string;
  lessonId: string;
  userId: string;
  completed: boolean;
}): Promise<void> {
  const { error } = await supabase.from('course_progress').upsert(
    {
      user_id: params.userId,
      course_id: params.courseId,
      lesson_id: params.lessonId,
      completed: params.completed,
      completed_at: params.completed ? new Date().toISOString() : null,
      last_viewed: new Date().toISOString(),
    },
    { onConflict: 'user_id,lesson_id' },
  );
  if (error) throw new Error(error.message);
}

/** Build an embeddable URL for YouTube / Loom / Vimeo (mirrors the web). */
export function toEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const loom = url.match(/loom\.com\/(?:share|embed)\/([\w-]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}
