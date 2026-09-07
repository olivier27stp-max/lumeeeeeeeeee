import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import type {
  TaskRow,
  TaskStatusFilter,
  TaskPriorityFilter,
  TaskSortKey,
  TaskCreateInput,
  TaskUpdateInput,
} from '../types/task';

const PAGE_SIZE = 20;

// ── Priority order for sorting ──
const PRIORITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 };

// ── List tasks with filters, search, sort, pagination ──
export async function listTasks(params: {
  status: TaskStatusFilter;
  priority: TaskPriorityFilter;
  sort: TaskSortKey;
  page: number;
  q: string;
  pageSize?: number;
}): Promise<{ rows: TaskRow[]; total: number }> {
  const size = params.pageSize || PAGE_SIZE;
  const from = (params.page - 1) * size;
  const to = from + size - 1;

  let query = supabase
    .from('tasks_active')
    .select('*', { count: 'exact', head: false });

  // Status filter
  if (params.status !== 'all') {
    query = query.eq('status', params.status);
  }

  // Priority filter
  if (params.priority !== 'all') {
    query = query.eq('priority', params.priority);
  }

  // Search
  if (params.q) {
    const q = `%${params.q}%`;
    query = query.or(
      `public_id.ilike.${q},title.ilike.${q},description.ilike.${q},type.ilike.${q},status.ilike.${q},priority.ilike.${q}`
    );
  }

  // Sort
  const [col, dir] = parseSortKey(params.sort);
  query = query.order(col, { ascending: dir === 'asc' });

  // Pagination
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return { rows: (data || []) as TaskRow[], total: count || 0 };
}

function parseSortKey(key: TaskSortKey): [string, 'asc' | 'desc'] {
  const parts = key.split('_');
  const dir = parts.pop() as 'asc' | 'desc';
  const col = parts.join('_');
  return [col, dir];
}

// ── Create task ──
export interface AssignableMember {
  user_id: string;
  name: string;
}

// Membres actifs de l'org, pour le sélecteur « Assigné à » d'une tâche.
export async function listAssignableMembers(): Promise<AssignableMember[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, first_name, last_name, full_name')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .not('user_id', 'is', null);
  if (error) throw error;
  const seen = new Set<string>();
  const out: AssignableMember[] = [];
  for (const m of (data || []) as any[]) {
    if (!m.user_id || seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
      || String(m.full_name || '').trim()
      || 'Sans nom';
    out.push({ user_id: m.user_id, name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Tâches planifiées d'une plage (calendrier) ──
// Ne renvoie que les tâches avec une heure (scheduled_at) dans la fenêtre
// affichée. `endAt` est exclusif (cohérent avec le range du calendrier).
export async function listScheduledTasksRange(params: {
  startAt: string;
  endAt: string;
}): Promise<TaskRow[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('tasks_active')
    .select('*')
    .eq('org_id', orgId)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', params.startAt)
    .lt('scheduled_at', params.endAt)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data || []) as TaskRow[];
}

// Déplacer/redimensionner une tâche depuis le calendrier (drag & resize).
export async function rescheduleTask(id: string, scheduledAt: string, durationMinutes: number | null): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ scheduled_at: scheduledAt, duration_minutes: durationMinutes, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function createTask(input: TaskCreateInput): Promise<TaskRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const orgId = await getCurrentOrgIdOrThrow();

  const record: Record<string, unknown> = {
    org_id: orgId,
    created_by: user.id,
    title: input.title,
    description: input.description || null,
    status: input.status || 'open',
    priority: input.priority || 'medium',
    type: input.type || 'Admin',
    due_date: input.due_date || null,
    scheduled_at: input.scheduled_at || null,
    duration_minutes: input.duration_minutes ?? null,
    assignee_user_id: input.assignee_user_id || null,
    team_id: input.team_id || null,
    linked_entity_type: input.linked_entity_type || null,
    linked_entity_id: input.linked_entity_id || null,
    linked_person_type: input.linked_person_type || null,
    linked_person_id: input.linked_person_id || null,
  };

  const { data, error } = await supabase
    .from('tasks')
    .insert(record)
    .select()
    .single();

  if (error) throw error;
  return data as TaskRow;
}

// ── Update task ──
export async function updateTask(id: string, input: TaskUpdateInput): Promise<TaskRow> {
  const updates: Record<string, unknown> = { ...input };

  // Handle completed_at logic
  if (input.status === 'done') {
    updates.completed_at = new Date().toISOString();
  } else if (input.status === 'open') {
    updates.completed_at = null;
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as TaskRow;
}

// ── Delete task (soft delete per CLAUDE.md) ──
export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ── Bulk update status ──
export async function bulkUpdateTaskStatus(ids: string[], status: 'open' | 'done'): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'done') {
    updates.completed_at = new Date().toISOString();
  } else {
    updates.completed_at = null;
  }

  const { error } = await supabase
    .from('tasks')
    .update(updates)
    .in('id', ids);

  if (error) throw error;
}

// ── Bulk update priority ──
export async function bulkUpdateTaskPriority(ids: string[], priority: 'low' | 'medium' | 'high'): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ priority })
    .in('id', ids);

  if (error) throw error;
}

// ── Bulk delete ──
export async function bulkDeleteTasks(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ids);

  if (error) throw error;
}

// ── Duplicate task ──
export async function duplicateTask(id: string): Promise<TaskRow> {
  const { data: source, error: fetchErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !source) throw fetchErr || new Error('Task not found');

  return createTask({
    title: `${source.title} (copy)`,
    description: source.description,
    status: 'open',
    priority: source.priority,
    type: source.type,
    due_date: source.due_date,
    linked_entity_type: source.linked_entity_type,
    linked_entity_id: source.linked_entity_id,
    linked_person_type: source.linked_person_type,
    linked_person_id: source.linked_person_id,
    assignee_user_id: source.assignee_user_id,
  });
}

// ── Get single task ──
export async function getTask(id: string): Promise<TaskRow> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as TaskRow;
}
