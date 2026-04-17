/**
 * API helpers for the courses / LMS module.
 * Routes through the Express server for proper role-based access control.
 * Tables: courses, course_modules, course_lessons, course_assignments, course_progress
 */

import { supabase } from './supabase';

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
  target_roles?: string[];
  target_user_ids?: string[];
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
  assignments?: any[];
  can_edit?: boolean;
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

// ── Auth helper ──

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Courses CRUD ──

export async function getCourses(opts?: {
  status?: string;
  q?: string;
}): Promise<Course[]> {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.q) params.set('q', opts.q);
  const qs = params.toString();
  return apiFetch<Course[]>(`/api/courses${qs ? `?${qs}` : ''}`);
}

export async function getCourse(id: string): Promise<CourseFull> {
  return apiFetch<CourseFull>(`/api/courses/${id}`);
}

export async function createCourse(input: {
  title: string;
  description?: string;
  cover_image?: string | null;
  status?: 'draft' | 'published';
  target_roles?: string[];
  target_user_ids?: string[];
}): Promise<Course> {
  return apiFetch<Course>('/api/courses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCourse(
  id: string,
  updates: Partial<Pick<Course, 'title' | 'description' | 'cover_image' | 'status' | 'category' | 'visibility' | 'target_roles' | 'target_user_ids'>>,
): Promise<Course> {
  return apiFetch<Course>(`/api/courses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteCourse(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/courses/${id}`, { method: 'DELETE' });
}

export async function duplicateCourse(id: string): Promise<Course> {
  return apiFetch<Course>(`/api/courses/${id}/duplicate`, { method: 'POST' });
}

// ── Modules CRUD ──

export async function createModule(courseId: string, title: string): Promise<CourseModule> {
  const data = await apiFetch<any>(`/api/courses/${courseId}/modules`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return { ...data, lessons: [] } as CourseModule;
}

export async function updateModule(
  id: string,
  updates: Partial<Pick<CourseModule, 'title' | 'sort_order'>>,
): Promise<CourseModule> {
  const data = await apiFetch<any>(`/api/courses/modules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return { ...data, lessons: data.lessons || [] } as CourseModule;
}

export async function deleteModule(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/courses/modules/${id}`, { method: 'DELETE' });
}

export async function reorderModules(courseId: string, orderedIds: string[]): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/courses/${courseId}/modules/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ order: orderedIds }),
  });
}

// ── Lessons CRUD ──

export async function createLesson(
  moduleId: string,
  input: { title: string; content_type?: CourseLesson['content_type'] },
): Promise<CourseLesson> {
  return apiFetch<CourseLesson>(`/api/courses/modules/${moduleId}/lessons`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateLesson(
  id: string,
  updates: Partial<Pick<CourseLesson, 'title' | 'content_type' | 'video_url' | 'embed_url' | 'text_content' | 'attachments' | 'duration_min'>>,
): Promise<CourseLesson> {
  return apiFetch<CourseLesson>(`/api/courses/lessons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteLesson(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/courses/lessons/${id}`, { method: 'DELETE' });
}

export async function duplicateLesson(id: string): Promise<CourseLesson> {
  return apiFetch<CourseLesson>(`/api/courses/lessons/${id}/duplicate`, { method: 'POST' });
}

export async function reorderLessons(moduleId: string, orderedIds: string[]): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/courses/modules/${moduleId}/lessons/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ order: orderedIds }),
  });
}

// ── Progress tracking ──

export async function getCourseProgress(courseId: string): Promise<LessonProgress[]> {
  return apiFetch<LessonProgress[]>(`/api/courses/${courseId}/progress`);
}

export async function updateProgress(
  courseId: string,
  lessonId: string,
  completed: boolean,
): Promise<LessonProgress> {
  return apiFetch<LessonProgress>('/api/courses/progress', {
    method: 'POST',
    body: JSON.stringify({ course_id: courseId, lesson_id: lessonId, completed }),
  });
}

export async function getProgressSummary(): Promise<ProgressSummary> {
  return apiFetch<ProgressSummary>('/api/courses/progress/summary');
}

// ── Org members (for audience targeting) ──

export interface OrgMember {
  user_id: string;
  role: string;
  full_name: string;
  avatar_url: string | null;
}

export async function getOrgMembers(): Promise<OrgMember[]> {
  return apiFetch<OrgMember[]>('/api/courses/org-members');
}

// ── Current user role check ──

export async function getCurrentUserRole(): Promise<string | null> {
  try {
    const data = await apiFetch<{ role: string | null }>('/api/courses/my-role');
    return data.role;
  } catch {
    return null;
  }
}

// ── Team progress (admin / boss view) ──

export async function getTeamCourseProgress(courseId: string): Promise<TeamMemberProgress[]> {
  return apiFetch<TeamMemberProgress[]>(`/api/courses/${courseId}/team-progress`);
}
