/* ═══════════════════════════════════════════════════════════════
   Migration — Team Date Availability
   Adds description + is_active to teams.
   Creates team_date_slots for date-specific availability.
   Keeps the existing weekday-based team_availability intact.
   ═══════════════════════════════════════════════════════════════ */

-- ─── Extend teams table ────────────────────────────────────────
alter table public.teams
  add column if not exists description text,
  add column if not exists is_active boolean not null default true;

-- Backfill: all non-deleted teams are active
update public.teams set is_active = true where deleted_at is null and is_active is null;

-- ─── team_date_slots (date-specific availability) ──────────────
create table if not exists public.team_date_slots (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  slot_date   date not null,
  start_time  time not null,
  end_time    time not null,
  status      text not null default 'available'
              check (status in ('available', 'blocked')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint  end_after_start check (end_time > start_time),
  constraint  no_exact_duplicate unique (team_id, slot_date, start_time, end_time)
);

create index idx_team_date_slots_team on public.team_date_slots(team_id);
create index idx_team_date_slots_date on public.team_date_slots(slot_date);
create index idx_team_date_slots_team_date on public.team_date_slots(team_id, slot_date);

-- ─── updated_at trigger ────────────────────────────────────────
create or replace function public.set_team_date_slots_updated_at()
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

create trigger trg_team_date_slots_updated
  before update on public.team_date_slots
  for each row execute function public.set_team_date_slots_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────
alter table public.team_date_slots enable row level security;

create policy "team_date_slots_select" on public.team_date_slots
  for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

create policy "team_date_slots_insert" on public.team_date_slots
  for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

create policy "team_date_slots_update" on public.team_date_slots
  for update using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );

create policy "team_date_slots_delete" on public.team_date_slots
  for delete using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
