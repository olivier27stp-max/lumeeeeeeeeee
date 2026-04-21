-- ORDER_HINT: 2/2 — timestamp collision with 20260625000002_retention_policies.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ============================================================================
-- V1 Hardening — Create field_sales_reps / field_sales_teams / members
-- These tables are referenced by server/routes/field-sales.ts and
-- server/lib/field-sales/territory-assignment-engine.ts but were never
-- created in any migration. Calling those endpoints would fail with
-- "relation does not exist". Fix: add them now, idempotent.
-- ============================================================================

create table if not exists public.field_sales_reps (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  display_name  text not null,
  role          text not null default 'sales_rep' check (role in ('sales_rep','team_leader','manager','admin')),
  avatar_url    text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_field_sales_reps_org on public.field_sales_reps (org_id, is_active);
create index if not exists idx_field_sales_reps_user on public.field_sales_reps (user_id);

create table if not exists public.field_sales_teams (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  name         text not null,
  leader_id    uuid references public.field_sales_reps(id) on delete set null,
  color        text not null default '#6366f1',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_field_sales_teams_org on public.field_sales_teams (org_id, is_active);

create table if not exists public.field_sales_team_members (
  team_id   uuid not null references public.field_sales_teams(id) on delete cascade,
  rep_id    uuid not null references public.field_sales_reps(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, rep_id)
);
create index if not exists idx_field_sales_team_members_rep on public.field_sales_team_members (rep_id);

-- RLS
alter table public.field_sales_reps        enable row level security;
alter table public.field_sales_teams       enable row level security;
alter table public.field_sales_team_members enable row level security;

drop policy if exists "field_sales_reps_select_org" on public.field_sales_reps;
create policy "field_sales_reps_select_org" on public.field_sales_reps
  for select to authenticated
  using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = field_sales_reps.org_id));

drop policy if exists "field_sales_reps_service" on public.field_sales_reps;
create policy "field_sales_reps_service" on public.field_sales_reps
  for all to service_role using (true) with check (true);

drop policy if exists "field_sales_teams_select_org" on public.field_sales_teams;
create policy "field_sales_teams_select_org" on public.field_sales_teams
  for select to authenticated
  using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = field_sales_teams.org_id));

drop policy if exists "field_sales_teams_service" on public.field_sales_teams;
create policy "field_sales_teams_service" on public.field_sales_teams
  for all to service_role using (true) with check (true);

drop policy if exists "field_sales_team_members_select" on public.field_sales_team_members;
create policy "field_sales_team_members_select" on public.field_sales_team_members
  for select to authenticated
  using (exists (
    select 1 from public.field_sales_teams t
    join public.memberships m on m.org_id = t.org_id
    where t.id = field_sales_team_members.team_id and m.user_id = auth.uid()
  ));

drop policy if exists "field_sales_team_members_service" on public.field_sales_team_members;
create policy "field_sales_team_members_service" on public.field_sales_team_members
  for all to service_role using (true) with check (true);
