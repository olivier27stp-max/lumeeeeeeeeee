-- ============================================================
-- activity_notes — free-text notes attached to an entity (client or job),
-- shown in the unified "EVENTS" panel. Additif: no existing table touched.
-- A note written on a job also surfaces on its linked client via the
-- panel's related-entity merge (handled app-side).
-- ============================================================

create table if not exists public.activity_notes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  entity_type  text not null check (entity_type in ('client','job')),
  entity_id    uuid not null,
  body         text not null,
  actor_id     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists idx_activity_notes_entity
  on public.activity_notes(org_id, entity_type, entity_id, created_at desc)
  where deleted_at is null;

-- ── RLS: org members can read/write their org's notes ──────────
alter table public.activity_notes enable row level security;

drop policy if exists "activity_notes_select_org" on public.activity_notes;
create policy "activity_notes_select_org"
  on public.activity_notes for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

drop policy if exists "activity_notes_insert_org" on public.activity_notes;
create policy "activity_notes_insert_org"
  on public.activity_notes for insert to authenticated
  with check (has_org_membership((select auth.uid()), org_id));

drop policy if exists "activity_notes_update_org" on public.activity_notes;
create policy "activity_notes_update_org"
  on public.activity_notes for update to authenticated
  using (has_org_membership((select auth.uid()), org_id))
  with check (has_org_membership((select auth.uid()), org_id));

-- ── updated_at trigger ───────────────────────────────────────
create or replace function public.set_activity_notes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists trg_activity_notes_updated_at on public.activity_notes;
create trigger trg_activity_notes_updated_at
  before update on public.activity_notes
  for each row execute function public.set_activity_notes_updated_at();
