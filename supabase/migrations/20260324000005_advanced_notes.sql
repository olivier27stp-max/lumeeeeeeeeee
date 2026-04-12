/* ═══════════════════════════════════════════════════════════════
   Migration — Advanced Notes System
   Tables: notes, notes_files, notes_tags, note_history, notes_checklist
   Separate from the canvas-based note_boards system.
   ═══════════════════════════════════════════════════════════════ */

-- ─── notes ────────────────────────────────────────────────────
create table if not exists public.notes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  content       text not null default '',
  pinned        boolean not null default false,
  color         text default null
                check (color in (null, 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray')),
  entity_type   text default null
                check (entity_type in (null, 'client', 'job', 'lead', 'invoice', 'payment', 'team_member')),
  entity_id     uuid default null,
  reminder_at   timestamptz default null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_notes_org on public.notes(org_id);
create index if not exists idx_notes_entity on public.notes(entity_type, entity_id) where entity_type is not null;
create index if not exists idx_notes_reminder on public.notes(reminder_at) where reminder_at is not null;
create index if not exists idx_notes_pinned on public.notes(org_id, pinned) where pinned = true;

-- ─── notes_files ──────────────────────────────────────────────
create table if not exists public.notes_files (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes(id) on delete cascade,
  file_url      text not null,
  file_name     text not null default '',
  file_type     text not null default '',
  file_size     bigint default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_notes_files_note on public.notes_files(note_id);

-- ─── notes_tags ───────────────────────────────────────────────
create table if not exists public.notes_tags (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes(id) on delete cascade,
  tag           text not null,
  created_at    timestamptz not null default now(),
  unique(note_id, tag)
);

create index if not exists idx_notes_tags_note on public.notes_tags(note_id);
create index if not exists idx_notes_tags_tag on public.notes_tags(tag);

-- ─── note_history ─────────────────────────────────────────────
create table if not exists public.note_history (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes(id) on delete cascade,
  old_content   text not null default '',
  new_content   text not null default '',
  edited_by     uuid not null references auth.users(id),
  edited_at     timestamptz not null default now()
);

create index if not exists idx_note_history_note on public.note_history(note_id);

-- ─── notes_checklist ──────────────────────────────────────────
create table if not exists public.notes_checklist (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes(id) on delete cascade,
  text          text not null default '',
  is_checked    boolean not null default false,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_notes_checklist_note on public.notes_checklist(note_id);

-- ─── updated_at trigger ──────────────────────────────────────
create or replace function public.set_notes_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notes_updated on public.notes;
create trigger trg_notes_updated
  before update on public.notes
  for each row execute function public.set_notes_updated_at();

-- ─── Auto-save history on update ─────────────────────────────
create or replace function public.save_note_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.content is distinct from new.content then
    insert into public.note_history (note_id, old_content, new_content, edited_by)
    values (old.id, old.content, new.content, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notes_history on public.notes;
create trigger trg_notes_history
  before update on public.notes
  for each row execute function public.save_note_history();

-- ─── RLS ──────────────────────────────────────────────────────
alter table public.notes enable row level security;
alter table public.notes_files enable row level security;
alter table public.notes_tags enable row level security;
alter table public.note_history enable row level security;
alter table public.notes_checklist enable row level security;

-- notes
drop policy if exists "notes_select_org" on public.notes;
create policy "notes_select_org" on public.notes
  for select to authenticated
  using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

drop policy if exists "notes_insert_org" on public.notes;
create policy "notes_insert_org" on public.notes
  for insert to authenticated
  with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

drop policy if exists "notes_update_org" on public.notes;
create policy "notes_update_org" on public.notes
  for update to authenticated
  using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  )
  with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

drop policy if exists "notes_delete_org" on public.notes;
create policy "notes_delete_org" on public.notes
  for delete to authenticated
  using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

-- notes_files: access via note org membership
drop policy if exists "notes_files_select" on public.notes_files;
create policy "notes_files_select" on public.notes_files
  for select to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_files_insert" on public.notes_files;
create policy "notes_files_insert" on public.notes_files
  for insert to authenticated
  with check (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_files_delete" on public.notes_files;
create policy "notes_files_delete" on public.notes_files
  for delete to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- notes_tags: access via note org membership
drop policy if exists "notes_tags_select" on public.notes_tags;
create policy "notes_tags_select" on public.notes_tags
  for select to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_tags_insert" on public.notes_tags;
create policy "notes_tags_insert" on public.notes_tags
  for insert to authenticated
  with check (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_tags_delete" on public.notes_tags;
create policy "notes_tags_delete" on public.notes_tags
  for delete to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- note_history: read-only via note org membership
drop policy if exists "note_history_select" on public.note_history;
create policy "note_history_select" on public.note_history
  for select to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "note_history_insert" on public.note_history;
create policy "note_history_insert" on public.note_history
  for insert to authenticated
  with check (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- notes_checklist: access via note org membership
drop policy if exists "notes_checklist_select" on public.notes_checklist;
create policy "notes_checklist_select" on public.notes_checklist
  for select to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_checklist_insert" on public.notes_checklist;
create policy "notes_checklist_insert" on public.notes_checklist
  for insert to authenticated
  with check (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_checklist_update" on public.notes_checklist;
create policy "notes_checklist_update" on public.notes_checklist
  for update to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

drop policy if exists "notes_checklist_delete" on public.notes_checklist;
create policy "notes_checklist_delete" on public.notes_checklist
  for delete to authenticated
  using (
    note_id in (
      select id from public.notes
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- ─── Realtime ────────────────────────────────────────────────
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.notes_checklist;
