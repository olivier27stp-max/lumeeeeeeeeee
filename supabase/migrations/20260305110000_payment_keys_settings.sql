begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

create table if not exists public.payment_provider_settings (
  org_id uuid primary key,
  stripe_keys_present boolean not null default false,
  paypal_keys_present boolean not null default false,
  stripe_enabled boolean not null default false,
  paypal_enabled boolean not null default false,
  default_provider text not null default 'none' check (default_provider in ('none', 'stripe', 'paypal')),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_provider_secrets (
  org_id uuid primary key,
  stripe_publishable_key text null,
  stripe_secret_key_enc text null,
  paypal_client_id text null,
  paypal_secret_enc text null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.orgs') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'payment_provider_settings_org_fk'
    ) then
      alter table public.payment_provider_settings
        add constraint payment_provider_settings_org_fk
        foreign key (org_id) references public.orgs(id) on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'payment_provider_secrets_org_fk'
    ) then
      alter table public.payment_provider_secrets
        add constraint payment_provider_secrets_org_fk
        foreign key (org_id) references public.orgs(id) on delete cascade;
    end if;
  end if;
end $$;

drop trigger if exists trg_payment_provider_settings_updated_at on public.payment_provider_settings;
create trigger trg_payment_provider_settings_updated_at
before update on public.payment_provider_settings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_payment_provider_secrets_updated_at on public.payment_provider_secrets;
create trigger trg_payment_provider_secrets_updated_at
before update on public.payment_provider_secrets
for each row
execute function public.set_updated_at();

alter table public.payment_provider_settings enable row level security;
alter table public.payment_provider_secrets enable row level security;

drop policy if exists pps_select_member on public.payment_provider_settings;
create policy pps_select_member
on public.payment_provider_settings
for select
to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
);

drop policy if exists pps_update_admin on public.payment_provider_settings;
create policy pps_update_admin
on public.payment_provider_settings
for update
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id))
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists pps_insert_admin on public.payment_provider_settings;
create policy pps_insert_admin
on public.payment_provider_settings
for insert
to authenticated
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists pps_delete_admin on public.payment_provider_settings;
create policy pps_delete_admin
on public.payment_provider_settings
for delete
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists ppss_deny_select on public.payment_provider_secrets;
create policy ppss_deny_select
on public.payment_provider_secrets
for select
to authenticated
using (false);

drop policy if exists ppss_deny_insert on public.payment_provider_secrets;
create policy ppss_deny_insert
on public.payment_provider_secrets
for insert
to authenticated
with check (false);

drop policy if exists ppss_deny_update on public.payment_provider_secrets;
create policy ppss_deny_update
on public.payment_provider_secrets
for update
to authenticated
using (false)
with check (false);

drop policy if exists ppss_deny_delete on public.payment_provider_secrets;
create policy ppss_deny_delete
on public.payment_provider_secrets
for delete
to authenticated
using (false);

drop function if exists public.ensure_payment_settings_row(uuid);
create or replace function public.ensure_payment_settings_row(p_org uuid)
returns public.payment_provider_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_provider_settings;
begin
  if p_org is null then
    raise exception 'p_org is required';
  end if;

  insert into public.payment_provider_settings (org_id)
  values (p_org)
  on conflict (org_id) do nothing;

  select *
    into v_row
    from public.payment_provider_settings
   where org_id = p_org;

  return v_row;
end;
$$;

revoke all on table public.payment_provider_settings from public;
revoke all on table public.payment_provider_secrets from public;
revoke all on function public.ensure_payment_settings_row(uuid) from public;

grant select, insert, update on public.payment_provider_settings to authenticated;
grant execute on function public.ensure_payment_settings_row(uuid) to authenticated, service_role;

commit;

