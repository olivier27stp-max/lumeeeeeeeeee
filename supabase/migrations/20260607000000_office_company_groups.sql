-- ============================================================
-- MIGRATION: Office company groups
-- Un "office" = un org. Les offices d'une même compagnie partagent
-- un company_group_id. Les données restent 100% séparées par org_id
-- (RLS inchangée) — SEUL le leaderboard agrège sur le groupe via le
-- service client (qui bypass la RLS).
-- ============================================================

begin;

-- ─── Colonne de regroupement + index ─────────────────────────────
alter table public.orgs add column if not exists company_group_id uuid;
create index if not exists idx_orgs_company_group on public.orgs (company_group_id);

-- ─── Backfill : les orgs d'un même propriétaire forment un groupe ──
with groups as (
  select owner_id, gen_random_uuid() as gid
  from public.orgs
  group by owner_id
)
update public.orgs o
set company_group_id = g.gid
from groups g
where o.owner_id = g.owner_id
  and o.company_group_id is null;

-- Filet de sécurité : tout org restant sans groupe en reçoit un.
update public.orgs
set company_group_id = gen_random_uuid()
where company_group_id is null;

-- ─── Trigger BEFORE INSERT : assigner le company_group_id ─────────
-- Couvre tous les chemins de création (onboarding, create-office) :
-- hérite du groupe d'un org existant du même propriétaire, sinon
-- génère un nouveau groupe.
create or replace function public.assign_org_company_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_group_id is null then
    select o.company_group_id into new.company_group_id
    from public.orgs o
    where o.owner_id = new.owner_id
      and o.company_group_id is not null
    limit 1;

    if new.company_group_id is null then
      new.company_group_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orgs_assign_company_group on public.orgs;
create trigger trg_orgs_assign_company_group
  before insert on public.orgs
  for each row execute function public.assign_org_company_group();

-- ─── Helper : ensemble des orgs de la compagnie d'un utilisateur ──
-- Primitive propre (SECURITY DEFINER). Le leaderboard utilise le
-- service client donc n'en dépend pas, mais c'est l'API canonique
-- pour toute lecture cross-office future.
create or replace function public.same_company_orgs(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct o2.id
  from public.memberships m
  join public.orgs o1 on o1.id = m.org_id
  join public.orgs o2 on o2.company_group_id = o1.company_group_id
  where m.user_id = p_user
    and m.status = 'active';
$$;

commit;
