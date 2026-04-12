-- ============================================================
-- Tasks table — personal/business task management
-- Replaces old simple tasks table with full-featured version
-- ============================================================

DROP VIEW IF EXISTS public.tasks_active CASCADE;
DROP TRIGGER IF EXISTS trg_tasks_public_id ON public.tasks;
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
DROP FUNCTION IF EXISTS public.generate_task_public_id();
DROP FUNCTION IF EXISTS public.tasks_update_timestamp();
DROP TABLE IF EXISTS public.tasks CASCADE;

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  public_id     text not null default '',
  title         text not null,
  description   text,
  status        text not null default 'open' check (status in ('open', 'done')),
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  type          text not null default 'Admin',
  due_date      date,
  linked_entity_type  text check (linked_entity_type in ('client', 'lead', 'quote', 'invoice', 'job')),
  linked_entity_id    uuid,
  linked_person_type  text check (linked_person_type in ('recruit', 'client', 'prospect', 'contact', 'team_member')),
  linked_person_id    uuid,
  assignee_user_id    uuid,
  completed_at  timestamptz,
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Indexes
create unique index tasks_org_public_id_idx on public.tasks (org_id, public_id);
create index tasks_org_status_idx on public.tasks (org_id, status) where deleted_at is null;
create index tasks_org_priority_idx on public.tasks (org_id, priority) where deleted_at is null;
create index tasks_org_type_idx on public.tasks (org_id, type) where deleted_at is null;
create index tasks_org_created_at_idx on public.tasks (org_id, created_at desc) where deleted_at is null;
create index tasks_org_due_date_idx on public.tasks (org_id, due_date) where deleted_at is null;
create index tasks_assignee_idx on public.tasks (assignee_user_id) where deleted_at is null;
create index tasks_linked_entity_idx on public.tasks (linked_entity_type, linked_entity_id) where linked_entity_id is not null and deleted_at is null;

-- Active tasks view
create or replace view public.tasks_active as
  select * from public.tasks where deleted_at is null;

-- Auto-increment public_id: TASK-1001, TASK-1002, ...
create or replace function public.generate_task_public_id()
returns trigger as $$
declare
  next_num integer;
begin
  select coalesce(max(
    cast(replace(public_id, 'TASK-', '') as integer)
  ), 1000) + 1
  into next_num
  from public.tasks
  where org_id = NEW.org_id
    and public_id like 'TASK-%';

  NEW.public_id := 'TASK-' || next_num;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_tasks_public_id
  before insert on public.tasks
  for each row
  when (NEW.public_id is null or NEW.public_id = '')
  execute function public.generate_task_public_id();

-- Auto-update updated_at
create or replace function public.tasks_update_timestamp()
returns trigger as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$ language plpgsql;

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row
  execute function public.tasks_update_timestamp();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.tasks enable row level security;

create policy tasks_select_org on public.tasks
  for select using (has_org_membership(auth.uid(), org_id));
create policy tasks_insert_org on public.tasks
  for insert with check (has_org_membership(auth.uid(), org_id));
create policy tasks_update_org on public.tasks
  for update using (has_org_membership(auth.uid(), org_id));
create policy tasks_delete_org on public.tasks
  for delete using (has_org_membership(auth.uid(), org_id));
