begin;

create extension if not exists pgcrypto;

create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := null;
  v_exists boolean := false;
begin
  if p_user is null or p_org is null then
    return false;
  end if;

  if p_user = p_org then
    return true;
  end if;

  if to_regclass('public.memberships') is not null then
    select m.role
      into v_role
      from public.memberships m
     where m.user_id = p_user
       and m.org_id = p_org
     limit 1;

    if v_role is not null and lower(v_role) in ('owner', 'admin') then
      return true;
    end if;
  end if;

  if to_regclass('public.org_members') is not null then
    execute $q$
      select exists(
        select 1
          from public.org_members om
         where om.user_id = $1
           and om.org_id = $2
           and (
             coalesce(lower(om.role), '') in ('owner', 'admin')
             or coalesce(om.is_owner, false) = true
             or coalesce(om.is_admin, false) = true
           )
      )
    $q$ into v_exists using p_user, p_org;

    if v_exists then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create table if not exists public.payment_provider_settings (
  org_id uuid primary key,
  default_provider text not null default 'none',
  stripe_enabled boolean not null default false,
  paypal_enabled boolean not null default false,
  stripe_keys_present boolean not null default false,
  paypal_keys_present boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.payment_provider_settings add column if not exists org_id uuid;
alter table public.payment_provider_settings add column if not exists default_provider text;
alter table public.payment_provider_settings add column if not exists stripe_enabled boolean;
alter table public.payment_provider_settings add column if not exists paypal_enabled boolean;
alter table public.payment_provider_settings add column if not exists stripe_keys_present boolean;
alter table public.payment_provider_settings add column if not exists paypal_keys_present boolean;
alter table public.payment_provider_settings add column if not exists updated_at timestamptz;

update public.payment_provider_settings
set org_id = public.current_org_id()
where org_id is null;

update public.payment_provider_settings
set default_provider = 'none'
where default_provider is null or lower(default_provider) not in ('none', 'stripe', 'paypal');

update public.payment_provider_settings
set stripe_enabled = false
where stripe_enabled is null;

update public.payment_provider_settings
set paypal_enabled = false
where paypal_enabled is null;

update public.payment_provider_settings
set stripe_keys_present = false
where stripe_keys_present is null;

update public.payment_provider_settings
set paypal_keys_present = false
where paypal_keys_present is null;

update public.payment_provider_settings
set updated_at = now()
where updated_at is null;

alter table public.payment_provider_settings alter column org_id set not null;
alter table public.payment_provider_settings alter column default_provider set not null;
alter table public.payment_provider_settings alter column stripe_enabled set not null;
alter table public.payment_provider_settings alter column paypal_enabled set not null;
alter table public.payment_provider_settings alter column stripe_keys_present set not null;
alter table public.payment_provider_settings alter column paypal_keys_present set not null;
alter table public.payment_provider_settings alter column updated_at set not null;

alter table public.payment_provider_settings alter column default_provider set default 'none';
alter table public.payment_provider_settings alter column stripe_enabled set default false;
alter table public.payment_provider_settings alter column paypal_enabled set default false;
alter table public.payment_provider_settings alter column stripe_keys_present set default false;
alter table public.payment_provider_settings alter column paypal_keys_present set default false;
alter table public.payment_provider_settings alter column updated_at set default now();

alter table public.payment_provider_settings drop constraint if exists payment_provider_settings_default_provider_check;
alter table public.payment_provider_settings
  add constraint payment_provider_settings_default_provider_check
  check (default_provider in ('none', 'stripe', 'paypal'));

create table if not exists public.payment_provider_secrets (
  org_id uuid primary key,
  stripe_publishable_key text null,
  stripe_secret_key_enc text null,
  paypal_client_id text null,
  paypal_secret_enc text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_provider_secrets add column if not exists org_id uuid;
alter table public.payment_provider_secrets add column if not exists stripe_publishable_key text;
alter table public.payment_provider_secrets add column if not exists stripe_secret_key_enc text;
alter table public.payment_provider_secrets add column if not exists paypal_client_id text;
alter table public.payment_provider_secrets add column if not exists paypal_secret_enc text;
alter table public.payment_provider_secrets add column if not exists created_at timestamptz;
alter table public.payment_provider_secrets add column if not exists updated_at timestamptz;

update public.payment_provider_secrets
set created_at = now()
where created_at is null;

update public.payment_provider_secrets
set updated_at = now()
where updated_at is null;

alter table public.payment_provider_secrets alter column org_id set not null;
alter table public.payment_provider_secrets alter column created_at set not null;
alter table public.payment_provider_secrets alter column updated_at set not null;

alter table public.payment_provider_secrets alter column created_at set default now();
alter table public.payment_provider_secrets alter column updated_at set default now();

insert into public.payment_provider_settings (
  org_id,
  default_provider,
  stripe_enabled,
  paypal_enabled,
  stripe_keys_present,
  paypal_keys_present,
  updated_at
)
select
  pp.org_id,
  case
    when pp.default_provider in ('stripe', 'paypal') then pp.default_provider
    else 'none'
  end as default_provider,
  coalesce(pp.stripe_enabled, false) as stripe_enabled,
  coalesce(pp.paypal_enabled, false) as paypal_enabled,
  false as stripe_keys_present,
  false as paypal_keys_present,
  now()
from public.payment_providers pp
where pp.org_id is not null
on conflict (org_id) do update
set
  default_provider = excluded.default_provider,
  stripe_enabled = excluded.stripe_enabled,
  paypal_enabled = excluded.paypal_enabled,
  updated_at = now();

update public.payment_provider_settings s
set
  stripe_keys_present = (
    ps.stripe_publishable_key is not null
    and btrim(ps.stripe_publishable_key) <> ''
    and ps.stripe_secret_key_enc is not null
    and btrim(ps.stripe_secret_key_enc) <> ''
  ),
  paypal_keys_present = (
    ps.paypal_client_id is not null
    and btrim(ps.paypal_client_id) <> ''
    and ps.paypal_secret_enc is not null
    and btrim(ps.paypal_secret_enc) <> ''
  ),
  updated_at = now()
from public.payment_provider_secrets ps
where ps.org_id = s.org_id;

drop trigger if exists trg_payment_provider_settings_set_updated_at on public.payment_provider_settings;
create trigger trg_payment_provider_settings_set_updated_at
before update on public.payment_provider_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_payment_provider_secrets_set_updated_at on public.payment_provider_secrets;
create trigger trg_payment_provider_secrets_set_updated_at
before update on public.payment_provider_secrets
for each row execute function public.set_updated_at();

alter table public.payment_provider_settings enable row level security;
alter table public.payment_provider_secrets enable row level security;

drop policy if exists payment_provider_settings_select_org on public.payment_provider_settings;
drop policy if exists payment_provider_settings_insert_org on public.payment_provider_settings;
drop policy if exists payment_provider_settings_update_org on public.payment_provider_settings;
drop policy if exists payment_provider_settings_delete_org on public.payment_provider_settings;

create policy payment_provider_settings_select_org on public.payment_provider_settings
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy payment_provider_settings_insert_org on public.payment_provider_settings
for insert to authenticated
with check (public.has_org_admin_role(auth.uid(), org_id));

create policy payment_provider_settings_update_org on public.payment_provider_settings
for update to authenticated
using (public.has_org_admin_role(auth.uid(), org_id))
with check (public.has_org_admin_role(auth.uid(), org_id));

create policy payment_provider_settings_delete_org on public.payment_provider_settings
for delete to authenticated
using (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists payment_provider_secrets_block_all_select on public.payment_provider_secrets;
drop policy if exists payment_provider_secrets_block_all_insert on public.payment_provider_secrets;
drop policy if exists payment_provider_secrets_block_all_update on public.payment_provider_secrets;
drop policy if exists payment_provider_secrets_block_all_delete on public.payment_provider_secrets;

create policy payment_provider_secrets_block_all_select on public.payment_provider_secrets
for select to authenticated
using (false);

create policy payment_provider_secrets_block_all_insert on public.payment_provider_secrets
for insert to authenticated
with check (false);

create policy payment_provider_secrets_block_all_update on public.payment_provider_secrets
for update to authenticated
using (false)
with check (false);

create policy payment_provider_secrets_block_all_delete on public.payment_provider_secrets
for delete to authenticated
using (false);

create or replace function public.ensure_payment_settings_row(p_org uuid default null)
returns public.payment_provider_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.payment_provider_settings;
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  insert into public.payment_provider_settings (org_id)
  values (v_org)
  on conflict (org_id) do nothing;

  select *
    into v_row
    from public.payment_provider_settings
   where org_id = v_org;

  return v_row;
end;
$$;

revoke all on table public.payment_provider_settings from public;
revoke all on table public.payment_provider_secrets from public;
revoke all on function public.ensure_payment_settings_row(uuid) from public;
revoke all on function public.has_org_admin_role(uuid, uuid) from public;

grant execute on function public.ensure_payment_settings_row(uuid) to authenticated, service_role;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

commit;
