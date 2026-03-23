-- ============================================================
-- MIGRATION: Multi-tenant orgs, invitations, enhanced memberships
-- ============================================================

begin;

-- ─── Orgs table ──────────────────────────────────────────────────
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_id uuid not null,
  industry text,
  company_size text,
  phone text,
  email text,
  address text,
  city text,
  region text,
  country text default 'CA',
  postal_code text,
  currency text not null default 'CAD',
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orgs_owner on public.orgs (owner_id);
create index if not exists idx_orgs_slug on public.orgs (slug);

-- Updated_at trigger
drop trigger if exists trg_orgs_updated_at on public.orgs;
create trigger trg_orgs_updated_at
  before update on public.orgs
  for each row execute function public.set_updated_at();

-- RLS
alter table public.orgs enable row level security;

drop policy if exists "orgs_select" on public.orgs;
create policy "orgs_select" on public.orgs
  for select using (
    id = auth.uid()
    or public.has_org_membership(auth.uid(), id)
  );

drop policy if exists "orgs_update" on public.orgs;
create policy "orgs_update" on public.orgs
  for update using (
    owner_id = auth.uid()
    or public.has_org_membership(auth.uid(), id)
  );

drop policy if exists "orgs_insert" on public.orgs;
create policy "orgs_insert" on public.orgs
  for insert with check (owner_id = auth.uid());

-- ─── Enhance memberships table ──────────────────────────────────
alter table public.memberships add column if not exists id uuid default gen_random_uuid();
alter table public.memberships add column if not exists status text not null default 'active';
alter table public.memberships add column if not exists permissions jsonb default '{}'::jsonb;
alter table public.memberships add column if not exists updated_at timestamptz default now();

-- Add status constraint
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memberships_status_check'
  ) then
    alter table public.memberships add constraint memberships_status_check
      check (status in ('active', 'pending', 'suspended'));
  end if;
end $$;

-- Add role constraint update (now includes sales_rep)
do $$
begin
  -- Drop existing constraint if it exists
  if exists (
    select 1 from pg_constraint
    where conname = 'memberships_role_check'
  ) then
    alter table public.memberships drop constraint memberships_role_check;
  end if;
  alter table public.memberships add constraint memberships_role_check
    check (role in ('owner', 'admin', 'sales_rep', 'technician', 'member'));
end $$;

-- ─── Invitations table ──────────────────────────────────────────
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  email text not null,
  role text not null default 'technician',
  token text not null unique,
  invited_by uuid not null,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invitations_token on public.invitations (token);
create index if not exists idx_invitations_org on public.invitations (org_id);
create index if not exists idx_invitations_email on public.invitations (email);

-- Constraints
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_role_check'
  ) then
    alter table public.invitations add constraint invitations_role_check
      check (role in ('admin', 'sales_rep', 'technician'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_status_check'
  ) then
    alter table public.invitations add constraint invitations_status_check
      check (status in ('pending', 'accepted', 'expired', 'revoked'));
  end if;
end $$;

-- Updated_at trigger
drop trigger if exists trg_invitations_updated_at on public.invitations;
create trigger trg_invitations_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

-- RLS
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

-- ─── Helper: check admin/owner role ─────────────────────────────
create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user is null or p_org is null then return false; end if;
  if p_user = p_org then return true; end if;

  return exists (
    select 1 from public.memberships
    where user_id = p_user
      and org_id = p_org
      and role in ('owner', 'admin')
      and status = 'active'
  );
end;
$$;

commit;
