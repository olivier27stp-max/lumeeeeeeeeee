/* ═══════════════════════════════════════════════════════════════
   Migration — Note Boards (Infinite Canvas / Miro-style)
   Tables: note_boards, note_items, note_connections, note_entity_links
   ═══════════════════════════════════════════════════════════════ */

-- ─── note_boards ───────────────────────────────────────────────
create table if not exists public.note_boards (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  title         text not null default 'Untitled Board',
  description   text,
  board_type    text not null default 'freeform'
                check (board_type in ('freeform','meeting','brainstorm','project_plan','retrospective','kanban')),
  thumbnail_url text,
  is_template   boolean not null default false,
  tags          text[] default '{}',
  viewport_x    double precision not null default 0,
  viewport_y    double precision not null default 0,
  viewport_zoom double precision not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  archived_by   uuid references auth.users(id)
);

create index idx_note_boards_org on public.note_boards(org_id) where archived_at is null;

-- ─── note_items (nodes on the canvas) ──────────────────────────
create table if not exists public.note_items (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.note_boards(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  item_type     text not null default 'sticky_note'
                check (item_type in (
                  'sticky_note','text','checklist','image','file',
                  'link','shape','diagram_block','frame','section_header'
                )),
  -- Position & size on canvas
  pos_x         double precision not null default 0,
  pos_y         double precision not null default 0,
  width         double precision not null default 200,
  height        double precision not null default 150,
  rotation      double precision not null default 0,
  z_index       integer not null default 0,
  -- Content
  content       text default '',
  rich_content  jsonb,            -- for checklists, formatted text, etc.
  -- Style
  color         text default '#fef08a',  -- yellow sticky default
  font_size     integer default 14,
  text_align    text default 'left' check (text_align in ('left','center','right')),
  shape_type    text check (shape_type in ('rectangle','ellipse','diamond','triangle','arrow_right','cloud',null)),
  border_style  text default 'none' check (border_style in ('none','solid','dashed','dotted')),
  -- Media (for image/file items)
  file_url      text,
  file_name     text,
  file_type     text,
  file_size     bigint,
  -- Link items
  link_url      text,
  link_title    text,
  link_preview  text,
  -- Lock
  locked        boolean not null default false,
  -- Timestamps
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_note_items_board on public.note_items(board_id);

-- ─── note_connections (edges/arrows between items) ─────────────
create table if not exists public.note_connections (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.note_boards(id) on delete cascade,
  source_id     uuid not null references public.note_items(id) on delete cascade,
  target_id     uuid not null references public.note_items(id) on delete cascade,
  label         text,
  line_type     text not null default 'bezier'
                check (line_type in ('bezier','straight','step','smoothstep')),
  color         text default '#6b7280',
  stroke_width  integer default 2,
  animated      boolean not null default false,
  arrow_start   boolean not null default false,
  arrow_end     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint no_self_loop check (source_id <> target_id)
);

create index idx_note_connections_board on public.note_connections(board_id);

-- ─── note_entity_links (link canvas items to CRM entities) ────
create table if not exists public.note_entity_links (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.note_items(id) on delete cascade,
  entity_type   text not null
                check (entity_type in ('lead','client','job','invoice','payment','team_member')),
  entity_id     uuid not null,
  created_at    timestamptz not null default now(),
  unique(item_id, entity_type, entity_id)
);

create index idx_note_entity_links_item on public.note_entity_links(item_id);
create index idx_note_entity_links_entity on public.note_entity_links(entity_type, entity_id);

-- ─── updated_at trigger ────────────────────────────────────────
create or replace function public.set_note_updated_at()
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

create trigger trg_note_boards_updated
  before update on public.note_boards
  for each row execute function public.set_note_updated_at();

create trigger trg_note_items_updated
  before update on public.note_items
  for each row execute function public.set_note_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────
alter table public.note_boards enable row level security;
alter table public.note_items enable row level security;
alter table public.note_connections enable row level security;
alter table public.note_entity_links enable row level security;

-- Boards: org members can read/write
create policy "note_boards_select" on public.note_boards
  for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

create policy "note_boards_insert" on public.note_boards
  for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

create policy "note_boards_update" on public.note_boards
  for update using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

create policy "note_boards_delete" on public.note_boards
  for delete using (
    created_by = auth.uid()
  );

-- Items: access via board org membership
create policy "note_items_select" on public.note_items
  for select using (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_items_insert" on public.note_items
  for insert with check (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_items_update" on public.note_items
  for update using (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_items_delete" on public.note_items
  for delete using (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- Connections: same as items
create policy "note_connections_select" on public.note_connections
  for select using (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_connections_insert" on public.note_connections
  for insert with check (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_connections_update" on public.note_connections
  for update using (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_connections_delete" on public.note_connections
  for delete using (
    board_id in (
      select id from public.note_boards
      where org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- Entity links: same as items
create policy "note_entity_links_select" on public.note_entity_links
  for select using (
    item_id in (
      select ni.id from public.note_items ni
      join public.note_boards nb on nb.id = ni.board_id
      where nb.org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_entity_links_insert" on public.note_entity_links
  for insert with check (
    item_id in (
      select ni.id from public.note_items ni
      join public.note_boards nb on nb.id = ni.board_id
      where nb.org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

create policy "note_entity_links_delete" on public.note_entity_links
  for delete using (
    item_id in (
      select ni.id from public.note_items ni
      join public.note_boards nb on nb.id = ni.board_id
      where nb.org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );

-- ─── Realtime ──────────────────────────────────────────────────
alter publication supabase_realtime add table public.note_items;
alter publication supabase_realtime add table public.note_connections;
