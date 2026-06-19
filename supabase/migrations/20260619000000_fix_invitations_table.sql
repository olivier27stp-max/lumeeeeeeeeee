-- ============================================================================
-- Fix: ensure public.invitations exists in its FINAL shape
-- ============================================================================
-- Prod was returning PGRST205 ("Could not find the table 'public.invitations'
-- in the schema cache") because the invitations migrations were never applied
-- and/or applied out of filename order (the token_hash migration is dated
-- before the create-table migration, so token_hash was never added and `token`
-- stayed NOT NULL while the server inserts token=NULL + token_hash).
--
-- This migration is fully idempotent and reconciles the table to exactly what
-- the server route (server/routes/invitations.ts) inserts:
--   org_id, email, role, scope, team_id, department_id, custom_permissions,
--   token (NULL), token_hash, invited_by, status, expires_at
-- ============================================================================

begin;

-- 1) Table (no-op if it already exists)
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  email text not null,
  role text not null default 'technician',
  token text,
  token_hash text,
  scope text not null default 'self',
  team_id uuid,
  department_id uuid,
  custom_permissions jsonb not null default '{}'::jsonb,
  invited_by uuid not null,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Columns for tables that pre-existed in an older shape
alter table public.invitations add column if not exists token_hash text;
alter table public.invitations add column if not exists scope text not null default 'self';
alter table public.invitations add column if not exists team_id uuid;
alter table public.invitations add column if not exists department_id uuid;
alter table public.invitations add column if not exists custom_permissions jsonb not null default '{}'::jsonb;

-- 3) token must be nullable (server stores only token_hash now)
alter table public.invitations alter column token drop not null;

-- 4) Indexes
create index if not exists idx_invitations_org on public.invitations (org_id);
create index if not exists idx_invitations_email on public.invitations (email);
create index if not exists invitations_token_hash_idx
  on public.invitations (token_hash) where token_hash is not null;

-- 5) Constraints (drop + recreate so they match the four-roles model)
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('admin', 'sales_rep', 'technician'));

alter table public.invitations drop constraint if exists invitations_scope_check;
alter table public.invitations add constraint invitations_scope_check
  check (scope is null or scope in ('self', 'assigned', 'team', 'company'));

alter table public.invitations drop constraint if exists invitations_status_check;
alter table public.invitations add constraint invitations_status_check
  check (status in ('pending', 'accepted', 'expired', 'revoked'));

-- 6) Optional FKs — only if the referenced tables exist (kept loose to avoid
--    failing on envs where teams/departments aren't provisioned yet)
do $$
begin
  if to_regclass('public.teams') is not null
     and not exists (select 1 from pg_constraint where conname = 'invitations_team_id_fkey') then
    alter table public.invitations
      add constraint invitations_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
  if to_regclass('public.departments') is not null
     and not exists (select 1 from pg_constraint where conname = 'invitations_department_id_fkey') then
    alter table public.invitations
      add constraint invitations_department_id_fkey
      foreign key (department_id) references public.departments(id) on delete set null;
  end if;
end $$;

-- 7) updated_at trigger (only if the helper exists)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_invitations_updated_at on public.invitations;
    create trigger trg_invitations_updated_at
      before update on public.invitations
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 8) RLS + policies (server uses service_role which bypasses RLS; these cover
--    any direct client reads)
alter table public.invitations enable row level security;

drop policy if exists "invitations_select" on public.invitations;
create policy "invitations_select" on public.invitations
  for select using (
    public.has_org_membership(auth.uid(), org_id)
    or email = (select email from auth.users where id = auth.uid())
  );

drop policy if exists "invitations_insert" on public.invitations;
create policy "invitations_insert" on public.invitations
  for insert with check (
    public.has_org_membership(auth.uid(), org_id)
  );

drop policy if exists "invitations_update" on public.invitations;
create policy "invitations_update" on public.invitations
  for update using (
    public.has_org_membership(auth.uid(), org_id)
    or email = (select email from auth.users where id = auth.uid())
  );

commit;

-- 9) Tell PostgREST to reload its schema cache (fixes PGRST205 immediately)
notify pgrst, 'reload schema';
