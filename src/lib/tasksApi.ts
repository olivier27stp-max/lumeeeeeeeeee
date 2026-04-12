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
    linked_entity_type: input.linked_entity_type || null,
    linked_entity_id: input.linked_entity_id || null,
    linked_person_type: input.linked_person_type || null,
    linked_person_id: input.linked_person_id || null,
    assignee_user_id: input.assignee_user_id || null,
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
