begin;

create schema if not exists app;

create or replace function app.current_org_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.org_id', true), '')::uuid,
    auth.uid()
  )
$$;

create or replace function app.leads_force_org_id()
returns trigger
language plpgsql
as $$
begin
  -- Do not read NEW.client_id here: leads does not have that column.
  new.org_id := app.current_org_id();

  if new.org_id is null then
    raise exception 'missing org_id in auth context'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leads_force_org_id on public.leads;
create trigger trg_leads_force_org_id
before insert on public.leads
for each row
execute function app.leads_force_org_id();

commit;
