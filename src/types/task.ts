export type TaskStatus = 'open' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export type TaskType =
  | 'Meeting'
  | 'Recruit'
  | 'Follow-up'
  | 'Admin'
  | 'Personal'
  | 'Client'
  | 'Sales'
  | 'Finance'
  | 'CRM'
  | 'Reminder'
  | 'Custom';

export type TaskLinkedEntityType = 'client' | 'lead' | 'quote' | 'invoice' | 'job';
export type TaskLinkedPersonType = 'recruit' | 'client' | 'prospect' | 'contact' | 'team_member';

export interface TaskRow {
  id: string;
  org_id: string;
  public_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType | string;
  due_date: string | null;
  linked_entity_type: TaskLinkedEntityType | null;
  linked_entity_id: string | null;
  linked_person_type: TaskLinkedPersonType | null;
  linked_person_id: string | null;
  assignee_user_id: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type TaskStatusFilter = 'all' | 'open' | 'done';
export type TaskPriorityFilter = 'all' | 'low' | 'medium' | 'high';

export type TaskSortKey =
  | 'public_id_asc' | 'public_id_desc'
  | 'title_asc' | 'title_desc'
  | 'status_asc' | 'status_desc'
  | 'priority_asc' | 'priority_desc'
  | 'created_at_asc' | 'created_at_desc'
  | 'due_date_asc' | 'due_date_desc';

export interface TaskCreateInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type: string;
  due_date?: string | null;
  linked_entity_type?: TaskLinkedEntityType | null;
  linked_entity_id?: string | null;
  linked_person_type?: TaskLinkedPersonType | null;
  linked_person_id?: string | null;
  assignee_user_id?: string | null;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: string;
  due_date?: string | null;
  linked_entity_type?: TaskLinkedEntityType | null;
  linked_entity_id?: string | null;
  linked_person_type?: TaskLinkedPersonType | null;
  linked_person_id?: string | null;
  assignee_user_id?: string | null;
}
